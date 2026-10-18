/* Pick'em import helpers, shared by / , /lab and /pro.
   The parts of importing sheets that aren't about how the page looks: preparing photos,
   reading them, matching names to the roster, checking tiebreakers, and saving photos to
   the sheet archive. Each page builds its own review screen on top. */
(function (root) {
  "use strict";

  const isPdf = f => f.type === "application/pdf" || /\.pdf$/i.test(f.name || "");
  const slug = n => String(n || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");

  function shrinkImage(file, maxEdge = 1100, quality = 0.62) {
    return new Promise((resolve, reject) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("bad image")); };
      img.src = url;
    });
  }
  const readDataUrl = f => new Promise((res, rej) => {
    const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = rej; fr.readAsDataURL(f);
  });

  // Phone photos run 4-8 MB and base64 adds a third on top, past the 4.5 MB request
  // limit. Re-encode to 1600px first; the text on a pick sheet stays perfectly readable.
  // Returns what can be sent, and the names of files that couldn't.
  async function prepareForReading(files) {
    const images = [], skipped = [];
    for (const f of files) {
      if (isPdf(f)) {
        const data = (await readDataUrl(f)).split(",")[1];
        if (data.length > 4000000) { skipped.push(`${f.name} is too large to send`); continue; }
        images.push({ media_type: "application/pdf", data, name: f.name });
        continue;
      }
      try {
        const shrunk = await shrinkImage(f, 1600, 0.82);
        images.push({ media_type: "image/jpeg", data: shrunk.split(",")[1], name: f.name });
      } catch (e) {
        const data = (await readDataUrl(f)).split(",")[1];
        if (data.length > 4000000) { skipped.push(`couldn't shrink ${f.name}, and it's too large to send`); continue; }
        images.push({ media_type: f.type || "image/jpeg", data, name: f.name });
      }
    }
    return { images, skipped };
  }

  // One photo per request: a batch could run past the server's 60-second limit or the
  // reader's reply length, one sheet never does, and a hiccup only costs that sheet.
  // Errors that can succeed on a second try are retried, up to 3 tries per photo.
  const RETRYABLE = [429, 500, 502, 503, 504, 529];
  async function readSheets({ images, games, pass, onProgress = () => {} }) {
    const gameList = games.map(g => ({ id: g.id, away: g.away, home: g.home }));
    const entries = [], failed = [];
    let week = null;
    for (let i = 0; i < images.length; i++) {
      const tag = images.length > 1 ? `Sheet ${i + 1} of ${images.length}` : "Sheet";
      onProgress(`${tag}: reading…`);
      let out = null, lastErr = "";
      for (let attempt = 1; attempt <= 3 && !out; attempt++) {
        try {
          const r = await fetch("/api/read-sheet", { method: "POST",
            headers: { "content-type": "application/json", "x-admin-key": pass },
            body: JSON.stringify({ images: [{ media_type: images[i].media_type, data: images[i].data }], games: gameList }) });
          const bodyText = await r.text();
          const parsed = (() => { try { return JSON.parse(bodyText); }
            catch (e) { return { error: `HTTP ${r.status}: ` +
              bodyText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().slice(0, 120) }; } })();
          if (r.ok) { out = parsed; break; }
          lastErr = parsed.error || `HTTP ${r.status}`;
          if (r.status === 504) lastErr = "took too long to read";
          if (!RETRYABLE.includes(r.status)) break;          // e.g. wrong passcode: retrying won't help
        } catch (e) { lastErr = "network error"; }
        if (attempt < 3) {
          onProgress(`${tag}: ${lastErr}, trying again (${attempt + 1} of 3)…`);
          await new Promise(res => setTimeout(res, 2500 * attempt));
        }
      }
      if (out) {
        entries.push(...(out.entries || []));
        if (out.week != null && week == null) week = out.week;
      } else failed.push(`${tag.toLowerCase()}: ${lastErr}`);
    }
    return { entries, week, failed };
  }

  // match a scribbled name to the roster; null when it's ambiguous or unknown
  function matchRoster(raw, roster) {
    const norm = x => String(x).toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
    const n = norm(raw);
    if (!n) return null;
    const exact = roster.find(r => norm(r) === n);
    if (exact) return exact;
    const starts = roster.filter(r => norm(r).startsWith(n) || n.startsWith(norm(r)));
    if (starts.length === 1) return starts[0];
    const first = n.split(" ")[0];
    const sameFirst = roster.filter(r => norm(r).split(" ")[0] === first);
    if (sameFirst.length === 1) return sameFirst[0];
    return null;
  }

  // Tiebreaker sanity. NFL finals land roughly 20-80 combined; outside that is almost always
  // a misread or a typo, and a blank is worse than a bad guess: it silently loses every tie.
  const TB_MIN = 20, TB_MAX = 100;
  function tbIssue(v) {
    if (v == null || v === "" || Number.isNaN(Number(v))) return "missing";
    const n = Number(v);
    if (!Number.isInteger(n)) return "not a whole number";
    if (n < TB_MIN) return `unusually low (under ${TB_MIN})`;
    if (n > TB_MAX) return `unusually high (over ${TB_MAX})`;
    return null;
  }

  // a compact copy of a photo for the sheet archive (PDFs can't be shrunk; small ones only)
  async function archiveCopy(file) {
    if (isPdf(file)) {
      const raw = await readDataUrl(file);
      return raw.length < 650000 ? { kind: "pdf", data: raw } : null;
    }
    try { return { kind: "image", data: await shrinkImage(file) }; }
    catch (e) {
      const raw = await readDataUrl(file);
      return raw.length < 900000 ? { kind: "image", data: raw } : null;
    }
  }

  // save photos to the archive one request at a time
  async function saveShots({ week, pass, shots, onProgress = () => {} }) {
    const failed = []; let sheets = null;
    for (let i = 0; i < shots.length; i++) {
      onProgress(`Saving photo ${i + 1} of ${shots.length}…`);
      try {
        const r = await fetch(`/api/sheets?week=${encodeURIComponent(week)}`, { method: "POST",
          headers: { "content-type": "application/json", "x-admin-key": pass }, body: JSON.stringify({ add: shots[i] }) });
        if (r.ok) { sheets = (await r.json()).sheets || sheets; shots[i].saved = true; }
        else failed.push(shots[i].label || "photo");
      } catch (e) { failed.push(shots[i].label || "photo"); }
    }
    return { sheets, failed };
  }

  // put reviewed entries into a week's list, replacing anyone already on it
  function mergeEntries(existing, incoming) {
    const out = [...(existing || [])], replaced = [];
    for (const p of incoming) {
      const i = out.findIndex(e => slug(e.name) === slug(p.name));
      if (i >= 0) { out[i] = { ...out[i], picks: p.picks, tiebreaker: p.tiebreaker }; replaced.push(p.name); }
      else out.push({ name: p.name, picks: p.picks, tiebreaker: p.tiebreaker, paid: !!p.paid });
    }
    return { entries: out, replaced };
  }

  root.PickImport = { isPdf, slug, shrinkImage, prepareForReading, readSheets, matchRoster,
                      TB_MIN, TB_MAX, tbIssue, archiveCopy, saveShots, mergeEntries };
})(window);
