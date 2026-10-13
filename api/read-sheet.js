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
    ...images.map((img) => {
      const mt = img.media_type || "image/jpeg";
      // a PDF is a document block; everything else is an image block
      return mt === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: img.data } }
        : { type: "image", source: { type: "base64", media_type: mt, data: img.data } };
    }),
    {
      type: "text",
      text:
        `These files show NFL pick'em entries — photos, scans or PDFs. They may be a printed pool sheet ` +
        `(a grid with one row per person) or a screenshot of a text message where someone ` +
        `listed their picks one per line.\n\n` +
        `Games this week, in order: ${legend}\n\n` +
        `Most sheets print the week at the top ("Week 6 Picks", "WEEK 6 PICK SHEET"). Report it if you can read it.\n\n` +
        `Return ONLY JSON, no prose and no markdown fences:\n` +
        `{"week":<number or null>,"entries":[{"name":"<name or null>",` +
        `"picks":{"<gameId>":"<team abbreviation exactly as listed above>"},` +
        `"tiebreaker":<number or null>}]}\n\n` +
        `Rules:\n` +
        `- Always output the abbreviations from the legend, never nicknames or city names.\n` +
        `- Teams may be written as nicknames ("Cowboys", "Bengals"), cities ("Houston", "Denver"), ` +
        `or with typos and missing plurals ("Brown" means the Browns). Map them to the right abbreviation.\n` +
        `- Every team plays exactly once this week, so a named team identifies its game on its own. ` +
        `Match each line to the game containing that team, whatever order the lines are in — a list ` +
        `that starts with the Monday game and ends with the Thursday game is still valid.\n` +
        `- Only fall back to line order if a line is too unclear to name a team.\n` +
        `- If a line could be two teams ("NY", "LA"), omit that game rather than guessing.\n` +
        `- Never put two picks on the same game. If a list names both teams from one game, keep neither.\n` +
        `- Emoji, reactions and commentary are not picks; ignore them.\n` +
        `- A bare number on its own line, or in a separate message bubble, is the tiebreaker.\n` +
        `- A texted list usually has no name on it. Set "name" to null rather than guessing ` +
        `from a contact label or phone number.\n` +
        `- If a cell or line is unreadable, omit that game rather than guessing.\n` +
        `- One entry per person. A grid sheet yields one entry per row; a texted list yields one entry.`,
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
      .filter((e) => e && (e.name || Object.keys(e.picks || {}).length))
      .map((e) => {
        const picks = {};
        for (const [gid, team] of Object.entries(e.picks || {})) {
          if (valid.has(gid) && teams.has(team)) picks[gid] = team;
        }
        return {
          name: e.name ? String(e.name).trim() : "",
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
