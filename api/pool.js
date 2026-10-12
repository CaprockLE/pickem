// GET  /api/pool?week=5            -> that week's pool document
// GET  /api/pool?list=1            -> list of weeks that have data
// POST /api/pool?week=5            -> save (requires x-admin-key)
//
// Storage: Upstash Redis REST (UPSTASH_REDIS_REST_URL + UPSTASH_REDIS_REST_TOKEN).

// Vercel's Upstash integration injects KV_REST_API_*; a direct Upstash setup uses UPSTASH_REDIS_REST_*.
const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEASON = process.env.SEASON || "2026";

const key = (week) => `pickem:${SEASON}:w${week}`;
const INDEX = `pickem:${SEASON}:weeks`;
const ROSTER = `pickem:${SEASON}:roster`;

async function redis(path, init = {}) {
  const r = await fetch(`${URL_BASE}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return r.json();
}

const emptyWeek = (week) => ({
  week: Number(week),
  season: Number(SEASON),
  label: `Week ${week}`,
  entries: [],
  manualResults: {},
  tiebreakerGameId: null,
  requirePaid: false,
  updatedAt: null,
});

export default async function handler(req, res) {
  if (!URL_BASE || !TOKEN) {
    return res.status(500).json({ error: "Storage is not configured. Connect a Redis store so KV_REST_API_URL and KV_REST_API_TOKEN are set." });
  }

  try {
    // season roster: the canonical list of player names
    if (req.query.roster) {
      if (req.method === "GET") {
        const out = await redis(`get/${ROSTER}`);
        return res.status(200).json({ names: out.result ? JSON.parse(out.result) : [] });
      }
      if (req.method === "POST") {
        const sent = req.headers["x-admin-key"];
        if (!process.env.ADMIN_PASSCODE || sent !== process.env.ADMIN_PASSCODE) {
          return res.status(401).json({ error: "Wrong or missing manager passcode." });
        }
        const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
        const names = [...new Set((body.names || []).map((n) => String(n).trim()).filter(Boolean))]
          .sort((a, b) => a.localeCompare(b));
        await redis(`set/${ROSTER}`, {
          method: "POST", headers: { "Content-Type": "text/plain" }, body: JSON.stringify(names),
        });
        return res.status(200).json({ names });
      }
    }

    if (req.method === "GET" && req.query.list) {
      const out = await redis(`smembers/${INDEX}`);
      return res.status(200).json({ weeks: (out.result || []).map(Number).sort((a, b) => a - b) });
    }

    const week = String(req.query.week || "").trim();
    if (!week) return res.status(400).json({ error: "week is required" });

    if (req.method === "GET") {
      const out = await redis(`get/${key(week)}`);
      const doc = out.result ? JSON.parse(out.result) : emptyWeek(week);
      return res.status(200).json(doc);
    }

    if (req.method === "POST") {
      const sent = req.headers["x-admin-key"];
      if (!process.env.ADMIN_PASSCODE || sent !== process.env.ADMIN_PASSCODE) {
        return res.status(401).json({ error: "Wrong or missing manager passcode." });
      }
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const doc = {
        ...emptyWeek(week),
        ...body,
        week: Number(week),
        season: Number(SEASON),
        updatedAt: new Date().toISOString(),
      };
      await redis(`set/${key(week)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(doc),
      });
      await redis(`sadd/${INDEX}/${week}`, { method: "POST" });
      return res.status(200).json(doc);
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: "Storage request failed." });
  }
}
