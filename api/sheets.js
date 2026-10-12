// GET  /api/sheets?week=5   -> archived sheet photos for that week
// POST /api/sheets?week=5   -> replace the archive (requires x-admin-key)
// Images arrive already downscaled by the browser, as JPEG data URLs.

export const config = { maxDuration: 30 };

const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEASON = process.env.SEASON || "2026";
const key = (week) => `pickem:${SEASON}:sheets:w${week}`;
const MAX_IMAGES = 24;
const MAX_BYTES = 700_000;           // per image, after the browser resizes it

async function redis(path, init = {}) {
  const r = await fetch(`${URL_BASE}/${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${TOKEN}`, ...(init.headers || {}) },
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return r.json();
}

export default async function handler(req, res) {
  if (!URL_BASE || !TOKEN) return res.status(500).json({ error: "Storage is not configured." });
  const week = String(req.query.week || "").trim();
  if (!week) return res.status(400).json({ error: "week is required" });

  try {
    if (req.method === "GET") {
      const out = await redis(`get/${key(week)}`);
      return res.status(200).json({ sheets: out.result ? JSON.parse(out.result) : [] });
    }

    if (req.method === "POST") {
      const sent = req.headers["x-admin-key"];
      if (!process.env.ADMIN_PASSCODE || sent !== process.env.ADMIN_PASSCODE) {
        return res.status(401).json({ error: "Wrong or missing manager passcode." });
      }
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      const sheets = (body.sheets || [])
        .filter((s) => s && typeof s.data === "string" && s.data.length < MAX_BYTES)
        .slice(0, MAX_IMAGES)
        .map((s) => ({
          id: String(s.id || Date.now() + "-" + Math.random().toString(36).slice(2, 8)),
          label: String(s.label || "").slice(0, 60),
          uploadedAt: s.uploadedAt || new Date().toISOString(),
          data: s.data,
        }));
      await redis(`set/${key(week)}`, {
        method: "POST",
        headers: { "Content-Type": "text/plain" },
        body: JSON.stringify(sheets),
      });
      return res.status(200).json({ sheets, count: sheets.length });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: "Sheet archive request failed." });
  }
}
