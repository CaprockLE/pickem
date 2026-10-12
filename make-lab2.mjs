// Builds lab2.html from index.html: same logic, a different *layout*.
// Console and Lab are the same page in different paint; this one rearranges it —
// icon rail instead of a sidebar, a fixed scoreboard strip across the top, and a
// two-column body where standings ride alongside the main content.
// Run:  node make-lab2.mjs
import { readFileSync, writeFileSync } from "node:fs";

const CSS = `
/* ================= LAB 2 — scoreboard-first layout ================= */
:root{ --rail:68px; --strip:96px; --r:12px; --accent:#2FB98B; }
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){ --accent:#3FD9A4 }}

/* ---- icon rail replaces the sidebar ---- */
.app{grid-template-columns:var(--rail) 1fr}
nav{padding:10px 8px;align-items:center;display:flex;flex-direction:column;gap:6px}
nav .sec{display:none}
nav button.tab{width:52px;height:52px;padding:0;border-radius:14px;display:grid;place-items:center;
  font-size:0;position:relative;overflow:visible}
nav button.tab::before{font-size:19px;line-height:1}
nav button.tab[data-v=season]::before{content:"\\1F3C6"}
nav button.tab[data-v=week]::before{content:"\\1F4C5"}
nav button.tab[data-v=picks]::before{content:"\\1F4CB"}
nav button.tab[data-v=h2h]::before{content:"\\2694\\FE0F"}
nav button.tab[data-v=import]::before{content:"\\1F4E5"}
nav button.tab[data-v=money]::before{content:"\\1F4B5"}
nav button.tab::after{content:attr(data-v);position:absolute;left:60px;top:50%;transform:translateY(-50%) scale(.92);
  background:#111A26;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:8px;padding:5px 10px;
  font-size:12px;text-transform:capitalize;opacity:0;pointer-events:none;transition:.14s;white-space:nowrap;z-index:50}
nav button.tab:hover::after{opacity:1;transform:translateY(-50%) scale(1)}
nav .foot{margin-top:auto;border:0;padding:0;display:flex;flex-direction:column;gap:6px;width:100%}
nav .foot #navFoot,nav .foot #buildTag{display:none}
nav .foot button{width:52px;height:38px;padding:0;font-size:0;border-radius:11px;margin:0 auto}
nav .foot button::before{font-size:15px}
nav .foot #themeBtn::before{content:"\\1F319"}
nav .foot #unlockBtn::before{content:"\\1F511"}

/* ---- the scoreboard becomes a fixed strip above everything ---- */
main{padding-top:calc(var(--strip) + 14px)}
#v-week .card:has(#board){position:fixed;top:0;left:var(--rail);right:0;z-index:35;
  border-radius:0;border-left:0;border-right:0;border-top:0;margin:0;height:var(--strip);
  background:var(--panel);backdrop-filter:blur(12px)}
#v-week .card:has(#board)>.hd{display:none}
#v-week .card:has(#board)>.bd{padding:0;height:100%}
#board{display:flex;gap:0;overflow-x:auto;height:100%;background:transparent;scrollbar-width:thin}
#board .gm{flex:0 0 190px;border:0;border-right:1px solid var(--rule);border-radius:0;
  padding:12px 14px;display:flex;flex-direction:column;justify-content:center}
#board .gm:hover{transform:none;box-shadow:inset 0 -3px 0 var(--accent)}
#board .slot{display:none}

/* other views sit below a slimmer bar */
#v-season,#v-picks,#v-h2h,#v-import,#v-money{margin-top:calc(-1 * var(--strip))}

/* ---- two-column body: content left, standings rail right ---- */
@media (min-width:1180px){
  #v-week{display:grid;grid-template-columns:minmax(0,1fr) 390px;gap:16px;align-items:start}
  #v-week .head{grid-column:1/-1}
  #v-week .kpis{grid-column:1/-1}
  #v-week .card:has(#board){grid-column:1/-1}
  #v-week .card:has(#stTbl){grid-column:2;position:sticky;top:calc(var(--strip) + 14px);max-height:calc(100vh - var(--strip) - 32px);
    display:flex;flex-direction:column}
  #v-week .card:has(#stTbl)>.bd{overflow:auto}
  #v-week .card:has(#winner),#v-week .card:has(#scenarioTbl){grid-column:1}
}

/* ---- flatter, squarer cards; the layout does the talking ---- */
.card{border-radius:var(--r);box-shadow:none;border:1px solid var(--rule)}
.card>.hd{background:var(--panel2);padding:10px 14px}
.card>.hd h2{font-size:13px;letter-spacing:.1em;text-transform:uppercase;color:var(--muted)}
.kpis{border-radius:var(--r)}
h1{font-size:26px}
.gm .st{font-size:10.5px}
.tm .ab{font-size:13px}
.pill{border-radius:6px}
tbody tr:hover td{background:var(--panel2)}
#stTbl th{font-size:9.5px}
#stTbl td{padding:7px 8px;font-size:13px}

/* badge */
#labTag{position:fixed;right:12px;bottom:12px;z-index:75;font-size:10.5px;letter-spacing:.12em;text-transform:uppercase;
  padding:7px 12px;border-radius:7px;color:#04221A;font-weight:800;background:var(--accent)}
#labTag a{color:inherit;text-decoration:none}

@media (max-width:1179px){
  #v-week .card:has(#board){position:static;height:auto;border:1px solid var(--rule);border-radius:var(--r);margin-bottom:16px}
  #v-week .card:has(#board)>.hd{display:flex}
  main{padding-top:14px}
  #v-season,#v-picks,#v-h2h,#v-import,#v-money{margin-top:0}
  #board{display:grid;grid-template-columns:repeat(auto-fill,minmax(196px,1fr));height:auto}
  #board .gm{flex:none;border:1px solid var(--rule);border-radius:11px}
}
@media (max-width:900px){
  .app{grid-template-columns:1fr}
  nav{flex-direction:row;overflow-x:auto}
  nav button.tab{width:46px;height:42px}
  nav button.tab::after{display:none}
  nav .foot{flex-direction:row;width:auto;margin:0 0 0 auto}
  nav .foot button{width:44px;height:38px}
}
`;

let html = readFileSync("index.html", "utf8");
html = html.replace("</style>", CSS + "\n</style>");
html = html.replace("<title>League Console</title>", "<title>League Console · Lab 2</title>");
html = html.replace('<canvas id="confetti" hidden></canvas>',
  '<div id="labTag"><a href="/">Lab 2 · back to main</a></div>\n<canvas id="confetti" hidden></canvas>');
html = html.replace(/build-(\d+)/g, "lab2-$1");
writeFileSync("lab2.html", html);
console.log("wrote lab2.html (" + (html.length / 1024).toFixed(0) + " kB)");
