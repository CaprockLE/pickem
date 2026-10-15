// GET /api/logo?u=<ESPN logo URL>
// Serves team logos from our own address so the share card can draw them onto a canvas
// (a canvas can't export an image drawn from another site). Only ESPN's CDN is allowed.

export default async function handler(req, res) {
  let url;
  try { url = new URL(String(req.query.u || "")); } catch (e) { return res.status(400).end(); }
  if (url.protocol !== "https:" || !/(^|\.)espncdn\.com$/.test(url.hostname)) return res.status(400).end();
  try {
    const r = await fetch(url.toString());
    if (!r.ok) return res.status(502).end();
    res.setHeader("Content-Type", r.headers.get("content-type") || "image/png");
    res.setHeader("Cache-Control", "public, max-age=604800, s-maxage=604800, immutable");
    return res.status(200).send(Buffer.from(await r.arrayBuffer()));
  } catch (e) {
    return res.status(502).end();
  }
}
