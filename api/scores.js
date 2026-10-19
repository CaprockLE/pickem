// GET /api/scores?week=5&season=2026
// Normalizes ESPN's public scoreboard into the shape the app uses.

// ── last known betting lines ────────────────────────────────────────────
// ESPN's feed sometimes drops a game's odds (near kickoff, or when it changes sportsbooks).
// Without a line the model treats that game as close to a coin flip, which shifts everyone's
// win %. So every line the feed carries is saved, and a game that loses its line keeps the
// last one seen. Saved per game id for the season; never allowed to break the scoreboard.
const R_URL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const R_TOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
async function rcmd(cmd) {
  const r = await fetch(R_URL, { method: "POST",
    headers: { Authorization: `Bearer ${R_TOK}`, "Content-Type": "application/json" }, body: JSON.stringify(cmd) });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}
// the saved lines, held in memory for two minutes so live-game refreshes don't each read them
let linesMemo = { at: 0, key: null, saved: null };
async function keepLines(games, season) {
  // lines only matter before kickoff, so once every game has started there's nothing to do
  if (!R_URL || !R_TOK || !games.some(g => g.state === "pre")) return;
  const key = `pickem:${season}:lines`;
  try {
    let saved;
    if (linesMemo.key === key && Date.now() - linesMemo.at < 120000) saved = linesMemo.saved;
    else {
      const flat = (await rcmd(["HGETALL", key])) || [];
      saved = {};
      for (let i = 0; i + 1 < flat.length; i += 2) { try { saved[flat[i]] = JSON.parse(flat[i + 1]); } catch (e) {} }
      linesMemo = { at: Date.now(), key, saved };
    }
    const updates = [];
    for (const g of games) {
      const prev = saved[g.id] || {};
      const KEYS = ["spread", "overUnder", "mlHome", "mlAway"];
      const cur = Object.fromEntries(KEYS.map(k => [k, g[k] ?? prev[k] ?? null]));
      for (const k of KEYS) if (g[k] == null && prev[k] != null) { g[k] = prev[k]; g.lineFrom = "saved"; }
      if (KEYS.some(k => cur[k] != null) && KEYS.some(k => cur[k] !== (prev[k] ?? null))) updates.push(g.id, JSON.stringify(cur));
    }
    if (updates.length) {
      await rcmd(["HSET", key, ...updates]);
      for (let i = 0; i < updates.length; i += 2) saved[updates[i]] = JSON.parse(updates[i + 1]);
    }
  } catch (e) { /* lines are a nicety; the scoreboard works without them */ }
}

export default async function handler(req, res) {
  const week = String(req.query.week || "").trim();
  const season = String(req.query.season || process.env.SEASON || new Date().getFullYear()).trim();

  // no week given: ask the feed what week it is right now
  const url = week
    ? `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
      `?seasontype=2&week=${encodeURIComponent(week)}&dates=${encodeURIComponent(season)}`
    : `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard`;

  try {
    const r = await fetch(url, { headers: { accept: "application/json" } });
    if (!r.ok) return res.status(502).json({ error: `ESPN responded ${r.status}` });
    const data = await r.json();

    const games = (data.events || []).map((ev) => {
      const comp = (ev.competitions && ev.competitions[0]) || {};
      const cs = comp.competitors || [];
      const home = cs.find((c) => c.homeAway === "home") || {};
      const away = cs.find((c) => c.homeAway === "away") || {};
      const st = (comp.status && comp.status.type) || (ev.status && ev.status.type) || {};
      const final = st.completed === true;
      const hs = Number(home.score ?? 0);
      const as = Number(away.score ?? 0);

      let winner = null;
      if (final) {
        if (home.winner === true) winner = home.team?.abbreviation;
        else if (away.winner === true) winner = away.team?.abbreviation;
        else if (hs > as) winner = home.team?.abbreviation;
        else if (as > hs) winner = away.team?.abbreviation;
        else winner = "TIE";
      }

      return {
        id: ev.id,
        name: ev.shortName,
        kickoff: ev.date,
        neutral: comp.neutralSite === true,
        home: home.team?.abbreviation || "",
        away: away.team?.abbreviation || "",
        homeName: home.team?.shortDisplayName || "",
        awayName: away.team?.shortDisplayName || "",
        homeLogo: home.team?.logo || "",
        awayLogo: away.team?.logo || "",
        // ESPN publishes a light-on-dark variant at the same path
        homeLogoDark: (home.team?.logo || "").replace("/500/", "/500-dark/"),
        awayLogoDark: (away.team?.logo || "").replace("/500/", "/500-dark/"),
        homeColor: home.team?.color ? "#" + home.team.color : "",
        awayColor: away.team?.color ? "#" + away.team.color : "",
        homeAlt: home.team?.alternateColor ? "#" + home.team.alternateColor : "",
        awayAlt: away.team?.alternateColor ? "#" + away.team.alternateColor : "",
        homeRecord: home.records?.[0]?.summary || "",
        awayRecord: away.records?.[0]?.summary || "",
        homeScore: hs,
        awayScore: as,
        state: st.state || "pre",          // pre | in | post
        final,
        detail: st.shortDetail || "",
        clock: comp.status?.displayClock || "",
        period: comp.status?.period || 0,
        winner,
        // betting line (home-relative) when the feed carries it, for pre-game odds
        spread: (() => {
          const o = (comp.odds || [])[0];
          if (!o || typeof o.spread !== "number") return null;
          const size = Math.abs(o.spread);
          // Who's favoured: ESPN flags it directly on each side; failing that, the
          // moneylines (the lower one is the favourite); failing that, the team named in
          // the details text. Home-relative: negative means the home team is favoured.
          if (o.homeTeamOdds?.favorite === true) return -size;
          if (o.awayTeamOdds?.favorite === true) return size;
          const hm = Number(o.homeTeamOdds?.moneyLine), am = Number(o.awayTeamOdds?.moneyLine);
          if (Number.isFinite(hm) && Number.isFinite(am) && hm !== am) return hm < am ? -size : size;
          const fav = String(o.details || "").split(" ")[0].toUpperCase();
          const names = t => [t?.abbreviation, t?.shortDisplayName, t?.name].filter(Boolean).map(x => String(x).toUpperCase());
          if (fav && names(away.team).includes(fav)) return size;
          if (fav && names(home.team).includes(fav)) return -size;
          return null;                      // can't tell who's favoured: better no line than a backwards one
        })(),
        // who has the ball, and where — only present while a game is live
        possession: (() => {
          const pid = comp.situation?.possession;
          if (!pid) return null;
          if (String(pid) === String(home.team?.id)) return home.team?.abbreviation || null;
          if (String(pid) === String(away.team?.id)) return away.team?.abbreviation || null;
          return null;
        })(),
        redZone: comp.situation?.isRedZone === true,
        downDistance: comp.situation?.shortDownDistanceText || comp.situation?.downDistanceText || null,
        overUnder: (() => { const o = (comp.odds || [])[0]; return typeof o?.overUnder === "number" ? o.overUnder : null; })(),
        // moneylines: the market's win probability directly (American odds, e.g. -180 / +150)
        mlHome: (() => { const v = Number((comp.odds || [])[0]?.homeTeamOdds?.moneyLine); return Number.isFinite(v) && v !== 0 ? v : null; })(),
        mlAway: (() => { const v = Number((comp.odds || [])[0]?.awayTeamOdds?.moneyLine); return Number.isFinite(v) && v !== 0 ? v : null; })(),
        // where it's played, for the weather: indoors needs no forecast
        venue: comp.venue ? { name: comp.venue.fullName || null, city: comp.venue.address?.city || null,
                              indoor: comp.venue.indoor === true } : null,
        clockSeconds: (() => {
          const c = comp.status?.displayClock || "";
          const m = /^(\d+):(\d+)$/.exec(c.trim());
          return m ? Number(m[1]) * 60 + Number(m[2]) : null;
        })(),
        weather: comp.weather?.displayValue
          ? { text: comp.weather.displayValue, temp: comp.weather.temperature }
          : null,
      };
    });

    games.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || String(a.id).localeCompare(String(b.id)));
    await keepLines(games, process.env.SEASON || data.season?.year || "2026");

    const byes = (data.week?.teamsOnBye || []).map((t) => t.abbreviation);

    // The league's own week flips Wednesday ~2am CT. Our pool rolls over at
    // Tuesday 00:00 CT, right after Monday night. When no week was requested and
    // we're inside that gap, report the next week instead.
    let reportedWeek = data.week?.number ?? (Number(week) || null);
    let rolledForward = false;
    if (!week && reportedWeek) {
      const cal = (data.leagues?.[0]?.calendar || []).find((c) => String(c.value) === "2");
      const entry = (cal?.entries || []).find((e) => Number(e.value) === reportedWeek);
      if (entry?.endDate) {
        const rolloverAt = new Date(entry.endDate).getTime() - 26 * 60 * 60 * 1000; // ≈ Tue 00:00 CT
        if (Date.now() >= rolloverAt) { reportedWeek += 1; rolledForward = true; }
      }
    }

    // ESPN updates every 10-15 seconds during games; hold its answer 8 seconds then, longer otherwise
    const anyLive = games.some(g => g.state === "in");
    res.setHeader("Cache-Control", anyLive ? "s-maxage=8, stale-while-revalidate=8" : "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({
      season: data.season?.year ?? Number(season),
      week: reportedWeek,
      feedWeek: data.week?.number ?? null,
      rolledForward,
      byes,
      games,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not reach the score feed." });
  }
}
