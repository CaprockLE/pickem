// GET /api/season  -> cumulative standings + per-week summaries
// Pulls every saved week from storage and scores it against the live feed.

const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEASON = process.env.SEASON || "2026";

async function redis(path) {
  const r = await fetch(`${URL_BASE}/${path}`, { headers: { Authorization: `Bearer ${TOKEN}` } });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return r.json();
}

async function espnWeek(week) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?seasontype=2&week=${week}&dates=${SEASON}`;
  const r = await fetch(url, { headers: { accept: "application/json" } });
  if (!r.ok) return [];
  const data = await r.json();
  return (data.events || []).map((ev) => {
    const comp = ev.competitions?.[0] || {};
    const cs = comp.competitors || [];
    const home = cs.find((c) => c.homeAway === "home") || {};
    const away = cs.find((c) => c.homeAway === "away") || {};
    const st = comp.status?.type || {};
    const hs = Number(home.score ?? 0), as = Number(away.score ?? 0);
    let winner = null;
    if (st.completed) {
      if (home.winner) winner = home.team?.abbreviation;
      else if (away.winner) winner = away.team?.abbreviation;
      else winner = hs > as ? home.team?.abbreviation : as > hs ? away.team?.abbreviation : "TIE";
    }
    return {
      id: ev.id, home: home.team?.abbreviation, away: away.team?.abbreviation,
      homeScore: hs, awayScore: as, final: !!st.completed, winner,
      kickoff: ev.date,
    };
  }).sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff));
}

export default async function handler(req, res) {
  if (!URL_BASE || !TOKEN) return res.status(500).json({ error: "Storage is not configured." });

  try {
    const idx = await redis(`smembers/pickem:${SEASON}:weeks`);
    const weeks = (idx.result || []).map(Number).sort((a, b) => a - b);
    if (!weeks.length) return res.status(200).json({ weeks: [], players: [], pot: 0 });

    const docs = await Promise.all(weeks.map(async (w) => {
      const out = await redis(`get/pickem:${SEASON}:w${w}`);
      return out.result ? JSON.parse(out.result) : null;
    }));
    const feeds = await Promise.all(weeks.map(espnWeek));

    const players = new Map();
    const summaries = [];

    weeks.forEach((w, i) => {
      const doc = docs[i];
      const games = feeds[i] || [];
      if (!doc) return;
      const result = (g) => doc.manualResults?.[g.id] || g.winner;
      const finals = games.filter((g) => result(g)).length;

      const scored = (doc.entries || []).map((e) => {
        let c = 0;
        for (const g of games) {
          const w2 = result(g);
          if (w2 && w2 !== "TIE" && e.picks?.[g.id] === w2) c++;
        }
        return { name: e.name, correct: c, tiebreaker: e.tiebreaker, paid: !!e.paid };
      });

      const complete = games.length > 0 && finals === games.length;
      let winners = [];
      if (complete && scored.length) {
        const field = scored.filter((s) => !doc.requirePaid || s.paid);
        const top = Math.max(...field.map((s) => s.correct));
        const tied = field.filter((s) => s.correct === top);
        if (tied.length === 1) winners = [tied[0].name];
        else {
          const tb = games.find((g) => g.id === doc.tiebreakerGameId) ||
            [...games].sort((a, b) => new Date(b.kickoff) - new Date(a.kickoff))[0];
          const actual = tb && tb.final ? tb.homeScore + tb.awayScore : null;
          if (actual == null) winners = tied.map((t) => t.name);
          else {
            const byDist = tied.map((t) => ({ n: t.name, d: Math.abs((t.tiebreaker ?? 9999) - actual) }))
              .sort((a, b) => a.d - b.d);
            winners = byDist.filter((x) => x.d === byDist[0].d).map((x) => x.n);
          }
        }
      }

      summaries.push({
        week: w, label: doc.label || `Week ${w}`, games: games.length, finals,
        complete, entries: scored.length, winners,
        paidCount: scored.filter((s) => s.paid).length,
      });

      for (const s of scored) {
        const key = s.name.toLowerCase();
        if (!players.has(key)) players.set(key, { name: s.name, total: 0, weeks: 0, wins: 0, unpaid: 0, byWeek: {} });
        const p = players.get(key);
        p.total += s.correct;
        p.weeks += 1;
        p.byWeek[w] = s.correct;
        if (!s.paid) p.unpaid += 1;
        if (winners.includes(s.name)) p.wins += 1;
      }
    });

    res.setHeader("Cache-Control", "s-maxage=30, stale-while-revalidate=60");
    return res.status(200).json({
      season: Number(SEASON),
      weeks: summaries,
      players: [...players.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    });
  } catch (err) {
    return res.status(500).json({ error: "Couldn't build season standings." });
  }
}
