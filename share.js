/* Pick'em share card: the picks grid and standings images, shared by / , /lab and /pro.
   Each page passes in its own data, so every site draws the identical card.
   d = { week, games, winnerOf, rows: [{ e, s: { correct } }], outcome (PickCore.weekOutcome),
         tbGame, dark, logoFor(g, side), order, host } */
(function (root) {
  "use strict";
  const tc = n => String(n ?? "").toLowerCase().replace(/\b[a-z]/g, m => m.toUpperCase());

  const DARK = { ink:"#0A111B", panel:"#131F2D", alt:"#101A26", line:"#263445", text:"#E9EEF5",
                 muted:"#8696A8", brand:"#39B28E", brandBg:"#11322A", miss:"#FF4D4D", missBg:"#3B1012",
                 gold:"#D4AC54", cell:"#1B2A3C", cellEdge:null };
  const LIGHT = { ink:"#FFFFFF", panel:"#F3F6FA", alt:"#FFFFFF", line:"#D9E0E9", text:"#101A27",
                  muted:"#64748B", brand:"#0B6B57", brandBg:"#E3F1EC", miss:"#C01616", missBg:"#FCE7E7",
                  gold:"#9A7318", cell:"#EEF2F7", cellEdge:"#DCE3EC" };

  // Logos come through our own /api/logo, because a canvas drawn with images from another
  // site can't be downloaded or copied. Each logo loads once and is reused.
  const shareLogos = new Map();
  function shareLogo(url) {
    if (!url) return Promise.resolve(null);
    if (!shareLogos.has(url)) shareLogos.set(url, new Promise(res => {
      const im = new Image();
      im.onload = () => res(im); im.onerror = () => res(null);
      im.src = "/api/logo?u=" + encodeURIComponent(url);
    }));
    return shareLogos.get(url);
  }
  let shareDrawId = 0;

  async function drawGrid(canvas, d) {
  const SH = d.dark ? DARK : LIGHT;
  const cv = canvas, x = cv.getContext("2d");
  const gs = d.games;
  const myDraw = ++shareDrawId;
  const logos = new Map();
  await Promise.all(gs.flatMap(g => ["away", "home"].map(async side => {
    const u = d.logoFor(g, side); logos.set(g[side], await shareLogo(u));
  })));
  if (myDraw !== shareDrawId) return;                 // a newer draw started while logos loaded
  const L = 26;                                       // logo size in the image
  const putLogo = (team, cx, cy, alpha = 1) => {
    const im = logos.get(team); if (!im) return false;
    x.save(); x.globalAlpha = alpha; x.drawImage(im, cx - L / 2, cy - L / 2, L, L); x.restore();
    return true;
  };
  const finals = gs.filter(g => d.winnerOf(g)).length;
  const showCorrect = finals > 0;                     // nothing to show before kickoff
  const order = d.order || "az";
  let rows = d.rows;
  if (order === "az") rows = [...rows].sort((a, b) => a.e.name.localeCompare(b.e.name, undefined, { sensitivity: "base" }));
  else if (order === "correct") rows = PickCore.standingsSort(rows, d.tbGame, r => r.s.correct);
  const paidW = 68;
  const nameW = 190, colW = 58, tbW = 86, corW = showCorrect ? 72 : 0, rowH = 38, headH = 148, colHead = 80;
  const W = nameW + gs.length * colW + tbW + corW + paidW + 56;
  const H = headH + colHead + rows.length * rowH + 76;
  cv.width = W; cv.height = H;

  x.fillStyle = SH.ink; x.fillRect(0, 0, W, H);
  x.fillStyle = SH.brand; x.fillRect(0, 0, W, 8);
  x.strokeStyle = SH.line; x.lineWidth = 1; x.strokeRect(.5, .5, W - 1, H - 1);

  const o = d.outcome;
  x.fillStyle = SH.text; x.font = "700 46px Oswald, Inter, sans-serif";
  x.fillText(`Week ${d.week} Picks`, 28, 74);
  x.fillStyle = SH.muted; x.font = "400 22px Inter, sans-serif";
  x.fillText(`${rows.length} entries · ${finals} of ${gs.length} games final` +
             (o.complete && o.champs.size ? ` · Won by ${[...o.champs].map(tc).join(" & ")}` : ""), 29, 110);

  // column headers: away over home
  let cx = 28 + nameW;
  x.textAlign = "center"; x.font = "600 17px Inter, sans-serif";
  gs.forEach(g => {
    const mid = cx + colW / 2;
    if (!putLogo(g.away, mid, headH + 14)) { x.fillStyle = SH.muted; x.fillText(g.away, mid, headH + 20); }
    x.fillStyle = SH.muted; x.font = "600 13px Inter, sans-serif"; x.fillText("at", mid, headH + 39);
    x.font = "600 17px Inter, sans-serif";
    if (!putLogo(g.home, mid, headH + 60)) { x.fillStyle = SH.muted; x.fillText(g.home, mid, headH + 66); }
    cx += colW;
  });
  x.fillStyle = SH.muted; x.font = "600 15px Inter, sans-serif";
  x.fillText("Tie", cx + tbW / 2, headH + 35); x.fillText("Breaker", cx + tbW / 2, headH + 52);
  if (showCorrect) x.fillText("Correct", cx + tbW + corW / 2, headH + 44);
  x.fillText("Paid", cx + tbW + corW + paidW / 2, headH + 44);
  x.textAlign = "left";

  let y = headH + colHead;
  rows.forEach((r, i) => {
    const champ = o.champs.has(r.e.name);
    x.fillStyle = champ ? (d.dark ? "rgba(212,172,84,.12)" : "rgba(154,115,24,.14)")
                        : (i % 2 ? SH.alt : SH.panel);
    x.fillRect(28, y, W - 56, rowH - 3);
    if (champ) { x.fillStyle = SH.gold; x.fillRect(28, y, 4, rowH - 3); }
    x.fillStyle = champ ? SH.gold : SH.text; x.font = "600 20px Inter, sans-serif";
    x.fillText(tc(r.e.name), 44, y + 25);

    let c = 28 + nameW;
    x.textAlign = "center"; x.font = "600 17px Inter, sans-serif";
    gs.forEach(g => {
      const p = r.e.picks?.[g.id] || "", w = d.winnerOf(g);
      let good = true;
      const cx0 = c + 4, cy0 = y + 3, cw = colW - 8, ch = rowH - 9;
      const cell = fill => {
        x.fillStyle = fill; x.beginPath();
        if (x.roundRect) x.roundRect(cx0, cy0, cw, ch, 6); else x.rect(cx0, cy0, cw, ch);
        x.fill();
        if (SH.cellEdge) { x.strokeStyle = SH.cellEdge; x.lineWidth = 1; x.stroke(); }
      };
      if (p && w) {
        good = w !== "TIE" && p === w;
        cell(good ? SH.brandBg : SH.missBg);
        x.fillStyle = good ? SH.brand : SH.miss;
      } else {
        cell(SH.cell);
        x.fillStyle = p ? SH.text : SH.line;
      }
      // the pick's logo; a miss is drawn a little faded. Text only if the logo didn't load.
      if (!p || !putLogo(p, c + colW / 2, y + (rowH - 3) / 2, (p && w && !good) ? .55 : 1))
        x.fillText(p || "·", c + colW / 2, y + 25);
      c += colW;
    });
    x.fillStyle = champ ? SH.gold : SH.text; x.font = "700 19px Oswald, Inter, sans-serif";
    x.fillText(String(r.e.tiebreaker ?? "—"), c + tbW / 2, y + 25);
    if (showCorrect) {
      x.fillStyle = champ ? SH.gold : SH.brand; x.font = "700 21px Oswald, Inter, sans-serif";
      x.fillText(String(r.s.correct), c + tbW + corW / 2, y + 25);
    }
    x.fillStyle = r.e.paid ? SH.brand : SH.miss; x.font = "600 17px Inter, sans-serif";
    x.fillText(r.e.paid ? "Paid" : "Unpaid", c + tbW + corW + paidW / 2, y + 25);
    x.textAlign = "left";
    y += rowH;
  });

  const tb = d.tbGame;
  x.fillStyle = SH.line; x.fillRect(28, y + 14, W - 56, 1);
  x.fillStyle = SH.muted; x.font = "400 18px Inter, sans-serif";
  const unpaid = rows.filter(r => !r.e.paid).length;
  x.fillText((tb ? `Tiebreaker: ${tb.away} at ${tb.home}` + (tb.final ? ` · final total ${tb.homeScore + tb.awayScore}` : "") : "") +
             (unpaid ? ` · ${unpaid} unpaid` : " · all paid"), 28, y + 46);
  x.textAlign = "right"; x.fillText((d.host || location.host), W - 28, y + 46); x.textAlign = "left";
}

  function drawStandings(canvas, d) {
  const SH = d.dark ? DARK : LIGHT;
  const cv = canvas, W = 1080, H = 1350, x = cv.getContext("2d");
  cv.width = W; cv.height = H;
  x.fillStyle = SH.ink; x.fillRect(0, 0, W, H);
  x.fillStyle = SH.brand; x.fillRect(0, 0, W, 10);
  const base = d.rows, o = d.outcome;
  const ord = d.order || "rank";
  const rows = ord === "az"
    ? [...base].sort((a, b) => a.e.name.localeCompare(b.e.name, undefined, { sensitivity: "base" }))
    : base;
  const finals = d.games.filter(g => d.winnerOf(g)).length;

  x.fillStyle = SH.text; x.font = "700 62px Oswald, Inter, sans-serif";
  x.fillText(`Week ${d.week} Standings`, 56, 112);
  x.fillStyle = SH.muted; x.font = "400 28px Inter, sans-serif";
  x.fillText(`${rows.length} entries · ${finals} of ${d.games.length} games final`, 56, 156);

  let y = 210;
  if (o.complete && o.champs.size) {
    x.fillStyle = SH.panel; x.fillRect(40, y, W - 80, 120);
    x.fillStyle = SH.gold; x.fillRect(40, y, 7, 120);
    x.fillStyle = SH.muted; x.font = "600 22px Inter, sans-serif"; x.fillText("WINNER", 76, y + 44);
    x.fillStyle = SH.text; x.font = "700 52px Oswald, Inter, sans-serif";
    x.fillText([...o.champs].map(tc).join(" & "), 76, y + 96);
    x.fillStyle = SH.gold; x.font = "700 46px Oswald, Inter, sans-serif";
    x.textAlign = "right"; x.fillText(String(o.top), W - 76, y + 96); x.textAlign = "left";
    y += 160;
  }
  rows.slice(0, 14).forEach((r, i) => {
    const champ = o.champs.has(r.e.name);
    x.fillStyle = i % 2 ? SH.alt : SH.panel; x.fillRect(40, y, W - 80, 62);
    if (champ) { x.fillStyle = d.dark ? "rgba(212,172,84,.13)" : "rgba(154,115,24,.15)"; x.fillRect(40, y, W - 80, 62);
                 x.fillStyle = SH.gold; x.fillRect(40, y, 5, 62); }
    x.fillStyle = champ ? SH.gold : SH.muted; x.font = "600 26px Oswald, Inter, sans-serif";
    x.fillText(String(i + 1), 72, y + 40);
    x.fillStyle = SH.text; x.font = "500 30px Inter, sans-serif"; x.fillText(tc(r.e.name), 128, y + 40);
    x.textAlign = "right"; x.font = "700 32px Oswald, Inter, sans-serif";
    x.fillStyle = champ ? SH.gold : SH.text; x.fillText(String(r.s.correct), W - 150, y + 40);
    x.font = "400 24px Inter, sans-serif"; x.fillStyle = SH.muted;
    x.fillText(String(r.e.tiebreaker ?? "—"), W - 76, y + 40);
    x.font = "600 20px Inter, sans-serif"; x.fillStyle = r.e.paid ? SH.brand : SH.miss;
    x.fillText(r.e.paid ? "Paid" : "Unpaid", W - 230, y + 40);
    x.textAlign = "left";
    y += 66;
  });
  x.fillStyle = SH.line; x.fillRect(56, H - 86, W - 112, 1);
  x.fillStyle = SH.muted; x.font = "400 24px Inter, sans-serif";
  x.fillText("Paid · Correct · Tiebreaker", 56, H - 48);
  x.textAlign = "right"; x.fillText((d.host || location.host), W - 56, H - 48); x.textAlign = "left";
}

  root.PickShare = { drawGrid, drawStandings };
})(window);
