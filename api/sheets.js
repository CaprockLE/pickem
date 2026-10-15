// Sheet photo archive, one Redis key per photo.
//
// GET  /api/sheets?week=5              -> { sheets: [ {id,label,uploadedAt,kind} ] }   (no image data)
// GET  /api/sheets?week=5&img=ID       -> the photo itself (JPEG, PNG or PDF), cacheable
// POST /api/sheets?week=5  {add:{...}} -> store one photo and add it to the list      (manager only)
// POST /api/sheets?week=5  {labels:{id:"Name"}} -> rename photos                      (manager only)
// POST /api/sheets?week=5  {remove:[id]}        -> drop photos                        (manager only)
//
// Earlier builds kept every photo in a single key and rewrote the whole set on each save, which
// broke once a week's photos outgrew one request. Those weeks are read and split up automatically.

export const config = { maxDuration: 30 };

const URL_BASE = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const TOKEN = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
const SEASON = process.env.SEASON || "2026";
const legacyKey = (w) => `pickem:${SEASON}:sheets:w${w}`;
const indexKey = (w) => `pickem:${SEASON}:sheets:w${w}:index`;
const imgKey = (w, id) => `pickem:${SEASON}:sheets:w${w}:img:${id}`;
const MAX_PHOTOS = 40;               // a full pool plus re-shoots
const MAX_BYTES = 900_000;           // one photo, after the browser shrinks it

async function redis(cmd) {
  const r = await fetch(URL_BASE, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  if (!r.ok) throw new Error(`redis ${r.status}`);
  return (await r.json()).result;
}

async function readIndex(week) {
  const raw = await redis(["GET", indexKey(week)]);
  if (raw) return JSON.parse(raw);
  // a week saved by an older build: split it into the new layout once
  const old = await redis(["GET", legacyKey(week)]);
  if (!old) return [];
  const list = JSON.parse(old).filter((s) => s && s.data);
  for (const s of list) await redis(["SET", imgKey(week, s.id), s.data]);
  const index = list.map(({ data, ...meta }) => meta);
  await redis(["SET", indexKey(week), JSON.stringify(index)]);
  return index;
}

const safeId = (v) => String(v || "").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 60);

export default async function handler(req, res) {
  if (!URL_BASE || !TOKEN) return res.status(500).json({ error: "Storage is not configured." });
  const week = String(req.query.week || "").replace(/\D/g, "");
  if (!week) return res.status(400).json({ error: "week is required" });

  try {
    if (req.method === "GET") {
      if (req.query.img) {
        const data = await redis(["GET", imgKey(week, safeId(req.query.img))]);
        const m = /^data:([^;]+);base64,(.*)$/s.exec(data || "");
        if (!m) return res.status(404).json({ error: "Photo not found" });
        res.setHeader("Content-Type", m[1]);
        res.setHeader("Cache-Control", "private, max-age=86400");
        return res.status(200).send(Buffer.from(m[2], "base64"));
      }
      return res.status(200).json({ sheets: await readIndex(week) });
    }

    if (req.method === "POST") {
      const sent = req.headers["x-admin-key"];
      if (!process.env.ADMIN_PASSCODE || sent !== process.env.ADMIN_PASSCODE) {
        return res.status(401).json({ error: "Wrong or missing manager passcode." });
      }
      const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body || {};
      let index = await readIndex(week);

      if (body.add) {
        const s = body.add;
        if (typeof s.data !== "string" || !s.data.startsWith("data:")) return res.status(400).json({ error: "No photo data." });
        if (s.data.length > MAX_BYTES) return res.status(413).json({ error: "Photo too large to archive." });
        if (index.length >= MAX_PHOTOS) return res.status(409).json({ error: `Archive is full (${MAX_PHOTOS} photos).` });
        const id = safeId(s.id) || Date.now() + "-" + Math.random().toString(36).slice(2, 8);
        await redis(["SET", imgKey(week, id), s.data]);
        index = index.filter((x) => x.id !== id);
        index.push({ id, label: String(s.label || "").slice(0, 60), uploadedAt: s.uploadedAt || new Date().toISOString(),
                     kind: s.kind === "pdf" ? "pdf" : "image" });
      }
      if (body.labels && typeof body.labels === "object") {
        index = index.map((x) => (x.id in body.labels ? { ...x, label: String(body.labels[x.id] || "").slice(0, 60) } : x));
      }
      if (Array.isArray(body.remove)) {
        const drop = new Set(body.remove.map(safeId));
        for (const id of drop) await redis(["DEL", imgKey(week, id)]);
        index = index.filter((x) => !drop.has(x.id));
      }
      await redis(["SET", indexKey(week), JSON.stringify(index)]);
      return res.status(200).json({ sheets: index });
    }

    return res.status(405).json({ error: "Method not allowed" });
  } catch (err) {
    return res.status(500).json({ error: "Sheet archive request failed." });
  }
}
