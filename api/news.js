// This week's news for the optimizer: injuries that matter (with each player's chance to suit
// up and what the line already assumes) and public pick percentages from the big free pick'em
// games. Read by /pro; written by the manager.
//
// GET  /api/news?week=7  -> { week, updatedAt, injuries:[...], publicPct:{ "AWAY@HOME": 0-100 } }
// POST /api/news?week=7  { injuries, publicPct }   (manager only; replaces the week's news)

const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEASON = process.env.SEASON || "2026";
const key = (w) => `pickem:${SEASON}:news:w${w}`;

async function redis(cmd) {
  const r = await fetch(URL_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

const clamp01 = (v) => Math.min(1, Math.max(0, Number(v)));
const STATUSES = ["full", "limited", "dnp", "questionable", "doubtful", "out", "expected-to-play", "expected-to-sit"];

// keep only well-formed entries, so a typo can't break the optimizer
function clean(body) {
  const injuries = (Array.isArray(body.injuries) ? body.injuries : []).slice(0, 60).map((x) => ({
    team: String(x.team || "").toUpperCase().slice(0, 4),
    player: String(x.player || "").slice(0, 60),
    pos: x.pos === "QB" ? "QB" : "other",
    value: Math.min(10, Math.max(0, Number(x.value) || 0)),           // points to the spread if he sits
    status: STATUSES.includes(x.status) ? x.status : "questionable",
    chance: clamp01(x.chance ?? 0.7),                                 // chance he suits up
    marketAssumes: clamp01(x.marketAssumes ?? 1),                     // what the current line assumes
    note: String(x.note || "").slice(0, 280),
    source: String(x.source || "").slice(0, 200),
  })).filter((x) => x.team && x.player);
  const publicPct = {};
  for (const [k, v] of Object.entries(body.publicPct || {})) {
    const n = Number(v);
    if (/^[A-Z]{2,4}@[A-Z]{2,4}$/.test(k) && n >= 0 && n <= 100) publicPct[k] = n;
  }
  return { injuries, publicPct };
}

export default async function handler(req, res) {
  const week = Number(req.query.week);
  if (!Number.isInteger(week) || week < 1 || week > 23) return res.status(400).json({ error: "week required" });
  if (!URL_BASE || !TOKEN) return res.status(500).json({ error: "storage not configured" });
  try {
    if (req.method === "GET") {
      const raw = await redis(["GET", key(week)]);
      res.setHeader("Cache-Control", "no-store");
      return res.status(200).json(raw ? JSON.parse(raw) : { week, updatedAt: null, injuries: [], publicPct: {} });
    }
    if (req.method === "POST") {
      const sent = req.headers["x-admin-key"];
      if (!process.env.ADMIN_PASSCODE || sent !== process.env.ADMIN_PASSCODE) return res.status(401).json({ error: "Wrong or missing manager passcode." });
      const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
      const doc = { week, updatedAt: new Date().toISOString(), ...clean(body) };
      await redis(["SET", key(week), JSON.stringify(doc)]);
      return res.status(200).json(doc);
    }
    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: "News storage failed." });
  }
}
