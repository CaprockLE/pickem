// POST /api/read-sheet   (requires x-admin-key)
// body: { images: [{media_type, data}], games: [{id, away, home}] }
// returns: { entries: [{name, picks:{gameId:TEAM}, tiebreaker}] }

export const config = { maxDuration: 60 };

const MODEL = process.env.CLAUDE_MODEL || "claude-sonnet-5-5";

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const sent = req.headers["x-admin-key"];
  if (!process.env.ADMIN_PASSCODE || sent !== process.env.ADMIN_PASSCODE) {
    return res.status(401).json({ error: "Wrong or missing manager passcode." });
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: "ANTHROPIC_API_KEY is not set." });
  }

  const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
  const images = Array.isArray(body.images) ? body.images.slice(0, 6) : [];
  const games = Array.isArray(body.games) ? body.games : [];
  if (!images.length) return res.status(400).json({ error: "No images sent." });
  if (!games.length) return res.status(400).json({ error: "No games provided." });

  const legend = games.map((g) => `${g.id} = ${g.away} at ${g.home}`).join("; ");

  const content = [
    ...images.map((img) => ({
      type: "image",
      source: { type: "base64", media_type: img.media_type || "image/jpeg", data: img.data },
    })),
    {
      type: "text",
      text:
        `These images show pick sheets for an NFL pick'em pool. Each row is one person: their name, ` +
        `one picked team per game, and a tiebreaker number.\n\n` +
        `Games by id: ${legend}\n\n` +
        `Most sheets print the week at the top ("Week 6 Picks", "WEEK 6 PICK SHEET"). Report it if you can read it.\n\n` +
        `Return ONLY JSON, no prose and no markdown fences:\n` +
        `{"week":<number or null>,"entries":[{"name":"...",` +
        `"picks":{"<gameId>":"<team abbreviation exactly as listed above>"},` +
        `"tiebreaker":<number or null>}]}\n\n` +
        `Rules: use the exact abbreviations from the legend; if a cell is unreadable omit that game ` +
        `rather than guessing; preserve the order of rows; if a column header shows two teams, the ` +
        `cell names which of the two was picked.`,
    },
  ];

  try {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4000,
        messages: [{ role: "user", content }],
      }),
    });

    if (!r.ok) {
      const detail = await r.text();
      return res.status(502).json({ error: `Claude API ${r.status}`, detail: detail.slice(0, 400) });
    }

    const data = await r.json();
    const text = (data.content || [])
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("")
      .replace(/```json|```/g, "")
      .trim();

    let parsed;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) return res.status(502).json({ error: "Couldn't parse the sheet." });
      parsed = JSON.parse(m[0]);
    }

    const valid = new Set(games.map((g) => g.id));
    const teams = new Set(games.flatMap((g) => [g.away, g.home]));
    const entries = (parsed.entries || [])
      .filter((e) => e && e.name)
      .map((e) => {
        const picks = {};
        for (const [gid, team] of Object.entries(e.picks || {})) {
          if (valid.has(gid) && teams.has(team)) picks[gid] = team;
        }
        return {
          name: String(e.name).trim(),
          picks,
          tiebreaker: Number.isFinite(Number(e.tiebreaker)) ? Number(e.tiebreaker) : null,
          paid: false,
        };
      });

    const detectedWeek = Number.isInteger(Number(parsed.week)) && Number(parsed.week) >= 1 && Number(parsed.week) <= 22
      ? Number(parsed.week) : null;
    return res.status(200).json({ entries, week: detectedWeek });
  } catch (err) {
    return res.status(500).json({ error: "Sheet reading failed." });
  }
}
