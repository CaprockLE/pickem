// Builds lab.html from index.html by layering an experimental skin on top.
// The logic, API calls and data stay identical — only the look changes.
// Run:  node make-lab.mjs
import { readFileSync, writeFileSync } from "node:fs";

const LAB_CSS = `
/* ================= LAB SKIN ================= */
:root{
  --r:18px;
  --neon1:#00E59B; --neon2:#36C8FF; --neon3:#A96BFF; --amber:#FFC14D;
}
body{
  background:
    radial-gradient(1100px 620px at 12% -8%, rgba(54,200,255,.17), transparent 60%),
    radial-gradient(900px 560px at 88% 4%, rgba(169,107,255,.15), transparent 62%),
    radial-gradient(800px 500px at 50% 108%, rgba(0,229,155,.13), transparent 60%),
    var(--bg);
  background-attachment:fixed;
}
body::before{            /* fine noise so the gradients don't band */
  content:"";position:fixed;inset:0;pointer-events:none;z-index:0;opacity:.035;
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.85' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E");
}
.app{position:relative;z-index:1}

/* glass sidebar */
nav{
  background:linear-gradient(180deg, rgba(10,16,25,.92), rgba(10,16,25,.72));
  backdrop-filter:blur(18px) saturate(140%);
  border-right:1px solid rgba(255,255,255,.07);
}
nav .logo .mark{
  background:linear-gradient(135deg,var(--neon1),var(--neon2) 55%,var(--neon3));
  box-shadow:0 6px 22px rgba(0,229,155,.38);
}
nav .logo b{
  background:linear-gradient(90deg,#fff,#BFE9FF 60%,#C3B4FF);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}
nav button.tab{transition:.16s}
nav button.tab:hover{transform:translateX(2px)}
nav button.tab.on{
  background:linear-gradient(90deg, rgba(0,229,155,.22), rgba(54,200,255,.10) 70%, transparent);
  color:#fff;box-shadow:inset 2px 0 0 var(--neon1), 0 0 20px rgba(0,229,155,.12);
}

/* glass cards with a lit top edge */
.card, .kpis{
  background:linear-gradient(180deg, rgba(255,255,255,.055), rgba(255,255,255,.015));
  backdrop-filter:blur(13px) saturate(130%);
  border:1px solid rgba(255,255,255,.10);
  box-shadow:0 16px 40px rgba(2,8,16,.42), inset 0 1px 0 rgba(255,255,255,.07);
  position:relative;overflow:hidden;
}
.card::before{
  content:"";position:absolute;left:0;right:0;top:0;height:1px;
  background:linear-gradient(90deg,transparent,var(--neon1),var(--neon2),transparent);opacity:.75;
}
.card>.hd{border-bottom:1px solid rgba(255,255,255,.08);background:transparent}
.card>.hd h2{
  background:linear-gradient(90deg,var(--neon1),var(--neon2));
  -webkit-background-clip:text;background-clip:text;color:transparent;letter-spacing:.04em;
}

/* headline type */
h1{
  font-size:34px;letter-spacing:.01em;
  background:linear-gradient(100deg,#FFFFFF 10%, #9FE9D2 48%, #8FD4FF 78%);
  -webkit-background-clip:text;background-clip:text;color:transparent;
}

/* stat tiles glow */
.kpi{background:transparent}
.kpi .v{
  background:linear-gradient(180deg,#FFFFFF,#9FE0FF);
  -webkit-background-clip:text;background-clip:text;color:transparent;
  text-shadow:0 0 26px rgba(54,200,255,.25);
}
.kpi .v.hot{background:linear-gradient(180deg,#FFD59A,#FF7A45);-webkit-background-clip:text;background-clip:text}

/* game cards */
.gm{
  border:1px solid rgba(255,255,255,.09);border-radius:14px;
  background:linear-gradient(180deg, rgba(255,255,255,.05), rgba(255,255,255,.015));
}
.gm:hover{transform:translateY(-3px) scale(1.012);box-shadow:0 14px 30px rgba(2,8,16,.5), 0 0 0 1px rgba(54,200,255,.35)}
.gm.live{border-color:transparent;background:linear-gradient(var(--panel),var(--panel)) padding-box,
  linear-gradient(120deg,var(--amber),#FF5E5B,var(--amber)) border-box;border:1px solid transparent;
  animation:liveSweep 3.4s linear infinite}
@keyframes liveSweep{0%{filter:hue-rotate(0deg)}100%{filter:hue-rotate(14deg)}}
.tm .pts{font-family:Oswald,Inter;font-size:19px;
  background:linear-gradient(180deg,#fff,#A9DFFF);-webkit-background-clip:text;background-clip:text;color:transparent}

/* tables */
th{background:rgba(255,255,255,.04);border-bottom:1px solid rgba(255,255,255,.10);
  letter-spacing:.09em;text-transform:uppercase;font-size:10px}
td{border-bottom:1px solid rgba(255,255,255,.055)}
tbody tr{transition:background .14s, box-shadow .14s}
tbody tr:hover td{background:linear-gradient(90deg, rgba(54,200,255,.12), transparent 70%)}
.pos{background:linear-gradient(180deg,#fff,#7FD9FF);-webkit-background-clip:text;background-clip:text;color:transparent}
.num,.big{background:linear-gradient(180deg,#fff,#B9ECD9);-webkit-background-clip:text;background-clip:text;color:transparent}

/* winner row shimmer */
tr.winrow td{background:linear-gradient(90deg, rgba(255,193,77,.20), rgba(255,193,77,.05) 60%, transparent)!important}
tr.winrow td:first-child{box-shadow:inset 3px 0 0 var(--amber)}
tr.winrow .pos{background:linear-gradient(180deg,#FFE8B0,#FFB03A);-webkit-background-clip:text;background-clip:text;color:transparent}

/* pills */
.pill{border-radius:999px;backdrop-filter:blur(6px);border:1px solid rgba(255,255,255,.14)}
.pill.ok{background:linear-gradient(90deg, rgba(0,229,155,.28), rgba(0,229,155,.10));color:#9FFFD8;border-color:transparent}
.pill.no{background:linear-gradient(90deg, rgba(255,110,80,.26), rgba(255,110,80,.08));color:#FFC2AE;border-color:transparent}
.pill.gold{background:linear-gradient(90deg, rgba(255,193,77,.30), rgba(255,193,77,.08));color:#FFE2A6;border-color:transparent}

/* buttons */
button{border-radius:11px;transition:.15s}
button:hover{transform:translateY(-1px);box-shadow:0 6px 18px rgba(0,229,155,.18)}
button.primary{background:linear-gradient(120deg,var(--neon1),var(--neon2));border-color:transparent;color:#04221A;font-weight:700}
button.primary:hover{box-shadow:0 10px 26px rgba(54,200,255,.35)}

/* grid cells */
.pg td.hit{background:linear-gradient(180deg, rgba(0,229,155,.20), rgba(0,229,155,.05));box-shadow:inset 0 -2px 0 var(--neon1)}
.pg td.miss{background:linear-gradient(180deg, rgba(255,110,80,.16), rgba(255,110,80,.04));box-shadow:inset 0 -2px 0 #FF6E50}
.pg td.hit img.pick{filter:drop-shadow(0 0 6px rgba(0,229,155,.55))}
.pg tr.split td{background:rgba(255,255,255,.05);color:#9FD6FF}

/* drop zone */
#drop{border:1.5px dashed rgba(54,200,255,.45);background:linear-gradient(180deg, rgba(54,200,255,.07), transparent)}
#drop:hover,#drop.over{border-color:var(--neon1);background:linear-gradient(180deg, rgba(0,229,155,.14), transparent);
  box-shadow:0 0 0 1px rgba(0,229,155,.3), 0 10px 30px rgba(0,229,155,.15)}

/* lab ribbon */
#labTag{position:fixed;right:14px;bottom:14px;z-index:75;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  padding:7px 13px;border-radius:999px;color:#04221A;font-weight:800;
  background:linear-gradient(120deg,var(--neon1),var(--neon2));box-shadow:0 8px 24px rgba(0,229,155,.35)}
#labTag a{color:inherit;text-decoration:none}
@media (prefers-reduced-motion:reduce){ .gm.live{animation:none} }
@media (max-width:900px){ #labTag{bottom:auto;top:10px;right:10px;padding:5px 10px} }
`;

let html = readFileSync("index.html", "utf8");
html = html.replace("</style>", LAB_CSS + "\n</style>");
html = html.replace("<title>League Console</title>", "<title>League Console · Lab</title>");
html = html.replace('<canvas id="confetti" hidden></canvas>',
  '<div id="labTag"><a href="/">Lab build · back to main</a></div>\n<canvas id="confetti" hidden></canvas>');
html = html.replace(/build-(\d+)/g, "lab-$1");
writeFileSync("lab.html", html);
console.log("wrote lab.html (" + (html.length / 1024).toFixed(0) + " kB)");
