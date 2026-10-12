// GET /api/scores?week=5&season=2026
// Normalizes ESPN's public scoreboard into the shape the app uses.

export default async function handler(req, res) {
  const week = String(req.query.week || "").trim();
  const season = String(req.query.season || new Date().getFullYear()).trim();
  if (!week) return res.status(400).json({ error: "week is required" });

  const url =
    `https://site.api.espn.com/apis/site/v2/sports/football/nfl/scoreboard` +
    `?seasontype=2&week=${encodeURIComponent(week)}&dates=${encodeURIComponent(season)}`;

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
        homeColor: home.team?.color ? "#" + home.team.color : "",
        awayColor: away.team?.color ? "#" + away.team.color : "",
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
        weather: comp.weather?.displayValue
          ? { text: comp.weather.displayValue, temp: comp.weather.temperature }
          : null,
      };
    });

    games.sort((a, b) => new Date(a.kickoff) - new Date(b.kickoff) || String(a.id).localeCompare(String(b.id)));

    const byes = (data.week?.teamsOnBye || []).map((t) => t.abbreviation);

    res.setHeader("Cache-Control", "s-maxage=20, stale-while-revalidate=40");
    return res.status(200).json({
      season: data.season?.year ?? Number(season),
      week: data.week?.number ?? Number(week),
      byes,
      games,
      fetchedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(500).json({ error: "Could not reach the score feed." });
  }
}
