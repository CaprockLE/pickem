// Builds lab.html from index.html by layering an experimental skin on top.
// Same logic, same API calls, same data — only the look changes.
// Run:  node make-lab.mjs
import { readFileSync, writeFileSync } from "node:fs";

const LAB_CSS = `
/* ===================== LAB SKIN =====================
   Tokens first, so light and dark each get a real treatment
   instead of dark styling leaking onto a white page.        */
:root{
  --r:18px;
  --n1:#00A472; --n2:#1A78C2; --n3:#6F44CC; --amber:#B4710F;
  --glass:rgba(255,255,255,.82); --glass-2:rgba(255,255,255,.58);
  --brd:rgba(14,30,52,.11); --brd-lit:rgba(14,30,52,.20);
  --lab-shadow:0 14px 38px rgba(14,30,52,.10), inset 0 1px 0 rgba(255,255,255,.7);
  --head-grad:linear-gradient(100deg,#0B2231 6%, #0A6450 46%, #1A5B93 88%);
  --num-grad:linear-gradient(180deg,#14283C,#1A6C9B);
  --row-hover:rgba(26,120,194,.10);
  --aurora-1:rgba(0,164,114,.13); --aurora-2:rgba(26,120,194,.12); --aurora-3:rgba(111,68,204,.10);
  --noise:.028; --mark-glow:0 6px 20px rgba(0,164,114,.30);
}
@media (prefers-color-scheme:dark){:root:not([data-theme=light]){
  --n1:#36C193; --n2:#5AA9DE; --n3:#9B86D8; --amber:#D7B165;
  --glass:rgba(255,255,255,.055); --glass-2:rgba(255,255,255,.02);
  --brd:rgba(255,255,255,.10); --brd-lit:rgba(255,255,255,.20);
  --lab-shadow:0 16px 42px rgba(2,8,16,.46), inset 0 1px 0 rgba(255,255,255,.07);
  --head-grad:linear-gradient(100deg,#FFFFFF 8%, #9FE9D2 48%, #8FD4FF 82%);
  --num-grad:linear-gradient(180deg,#FFFFFF,#A9DFFF);
  --row-hover:rgba(54,200,255,.12);
  --aurora-1:rgba(0,229,155,.11); --aurora-2:rgba(54,200,255,.10); --aurora-3:rgba(169,107,255,.09);
  --noise:.038; --mark-glow:0 6px 22px rgba(0,229,155,.38);
}}
:root[data-theme=dark]{
  --n1:#36C193; --n2:#5AA9DE; --n3:#9B86D8; --amber:#D7B165;
  --glass:rgba(255,255,255,.055); --glass-2:rgba(255,255,255,.02);
  --brd:rgba(255,255,255,.10); --brd-lit:rgba(255,255,255,.20);
  --lab-shadow:0 16px 42px rgba(2,8,16,.46), inset 0 1px 0 rgba(255,255,255,.07);
  --head-grad:linear-gradient(100deg,#FFFFFF 8%, #9FE9D2 48%, #8FD4FF 82%);
  --num-grad:linear-gradient(180deg,#FFFFFF,#A9DFFF);
  --row-hover:rgba(54,200,255,.12);
  --aurora-1:rgba(0,229,155,.11); --aurora-2:rgba(54,200,255,.10); --aurora-3:rgba(169,107,255,.09);
  --noise:.038; --mark-glow:0 6px 22px rgba(0,229,155,.38);
}

/* slow-drifting aurora field */
body{
  background:
    radial-gradient(1200px 680px at 10% -10%, var(--aurora-2), transparent 60%),
    radial-gradient(1000px 620px at 92% 2%, var(--aurora-3), transparent 62%),
    radial-gradient(900px 560px at 46% 112%, var(--aurora-1), transparent 60%),
    var(--bg);
  background-attachment:fixed; background-size:180% 180%,170% 170%,190% 190%;
  animation:drift 34s ease-in-out infinite alternate;
}
@keyframes drift{0%{background-position:0% 0%,100% 0%,50% 100%}100%{background-position:14% 8%,86% 10%,42% 88%}}
body::before{content:"";position:fixed;inset:0;pointer-events:none;z-index:0;opacity:var(--noise);
  background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='.8' numOctaves='3'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E")}
.app{position:relative;z-index:1}

/* sidebar stays dark in both themes — it reads as chrome */
nav{background:linear-gradient(180deg, rgba(8,14,22,.95), rgba(8,14,22,.82));
  backdrop-filter:blur(20px) saturate(150%); border-right:1px solid rgba(255,255,255,.08)}
nav .logo .mark{background:linear-gradient(135deg,var(--n1),var(--n2) 55%,var(--n3));box-shadow:var(--mark-glow)}
nav .logo b{background:linear-gradient(90deg,#fff,#BFE9FF 58%,#C9B9FF);-webkit-background-clip:text;background-clip:text;color:transparent}
nav button.tab{transition:.18s cubic-bezier(.2,.8,.2,1);border-radius:11px;color:#9BA9BA}
nav button.tab:hover{transform:translateX(3px);background:rgba(255,255,255,.07);color:#fff}
nav button.tab.on{background:linear-gradient(90deg, rgba(0,229,155,.26), rgba(54,200,255,.10) 70%, transparent);
  color:#fff;box-shadow:inset 3px 0 0 #00E59B, 0 0 24px rgba(0,229,155,.14)}

/* glass cards with a lit top edge */
.card,.kpis{background:linear-gradient(180deg,var(--glass),var(--glass-2));
  backdrop-filter:blur(15px) saturate(135%); border:1px solid var(--brd);
  box-shadow:var(--lab-shadow); position:relative; overflow:hidden}
.card::before{content:"";position:absolute;left:0;right:0;top:0;height:1.5px;z-index:1;
  background:linear-gradient(90deg,transparent,var(--n1),var(--n2),transparent);opacity:.85}
100%{left:128%}}
.card>.hd{border-bottom:1px solid var(--brd);background:transparent;position:relative;z-index:2}
.card>.hd h2{background:linear-gradient(90deg,var(--n1),var(--n2));-webkit-background-clip:text;background-clip:text;
  color:transparent;letter-spacing:.03em}
.card>.bd{position:relative;z-index:2}

h1{font-size:35px;letter-spacing:.01em;background:var(--head-grad);
  -webkit-background-clip:text;background-clip:text;color:transparent}

/* stat tiles */
.kpi{background:transparent;position:relative}
.kpi .v{background:var(--num-grad);-webkit-background-clip:text;background-clip:text;color:transparent}
.kpi .v.hot{background:none;color:var(--hot)}
.kpi .k{letter-spacing:.16em}

/* game cards */
.gm{border:1px solid var(--brd);border-radius:14px;
  background:linear-gradient(180deg,var(--glass),var(--glass-2));transition:.16s cubic-bezier(.2,.8,.2,1)}
.gm:hover{transform:translateY(-3px) scale(1.015);box-shadow:0 16px 34px rgba(2,8,16,.20), 0 0 0 1px var(--brd-lit)}
.gm.live{border-color:transparent;
  background:linear-gradient(var(--panel),var(--panel)) padding-box,
             linear-gradient(120deg,var(--amber),#FF5E5B,var(--n2),var(--amber)) border-box;
  background-size:auto,300% 300%; border:1.5px solid transparent; animation:ring 5s linear infinite}
@keyframes ring{0%{background-position:0 0,0% 50%}100%{background-position:0 0,300% 50%}}
.tm .pts{font-family:Oswald,Inter;font-size:19px;color:var(--ink)}
.gm .st .odds{font-weight:700;color:var(--n2)}

/* tables */
th{background:transparent;border-bottom:1px solid var(--brd-lit);letter-spacing:.11em;text-transform:uppercase;font-size:10px}
td{border-bottom:1px solid var(--brd)}
tbody tr{transition:background .15s}
tbody tr:hover td{background:var(--row-hover)}
tbody tr:hover td:first-child{box-shadow:inset 2px 0 0 var(--n1)}
.num,.big{color:var(--ink);background:none}
td .num,td .big,td .mono{background:none!important}
td.num,td .num,td.big,td .big,td.mono,td .mono{-webkit-text-fill-color:currentColor!important;color:inherit}
tbody tr:hover td{color:var(--ink);background:var(--row-hover)}
.pos{color:var(--muted)}

/* winner row: slow gold sweep */
tr.winrow td{background:rgba(201,150,44,.13)!important}
tr.winrow td:first-child{box-shadow:inset 3px 0 0 var(--amber)}

/* pills + buttons */
.pill{border-radius:999px;border:1px solid var(--brd-lit);backdrop-filter:blur(6px)}
.pill.ok{background:linear-gradient(90deg,rgba(0,164,114,.26),rgba(0,164,114,.08));border-color:transparent}
.pill.no{background:linear-gradient(90deg,rgba(201,84,46,.24),rgba(201,84,46,.07));border-color:transparent}
.pill.gold{background:linear-gradient(90deg,rgba(201,150,44,.30),rgba(201,150,44,.08));border-color:transparent}
button{border-radius:11px;transition:.16s}
button:hover{transform:translateY(-1px);box-shadow:0 8px 20px rgba(26,120,194,.18)}
button.primary{background:linear-gradient(120deg,var(--n1),var(--n2));border-color:transparent;color:#03211A;font-weight:700}
button.primary:hover{box-shadow:0 12px 28px rgba(26,120,194,.32)}

/* pick grid */
.pg td.hit{background:rgba(0,164,114,.13);box-shadow:inset 0 -2px 0 rgba(0,164,114,.75)}
.pg td.miss{background:rgba(214,44,40,.11);box-shadow:inset 0 -2px 0 rgba(214,44,40,.75);color:#D62C28}
.pg td.hit img.pick{filter:none}
.pg tr.split td{background:var(--panel2)}
.pg td.who,.pg th.who{background:var(--panel)}

/* import */
#drop{border:1.5px dashed var(--brd-lit);background:linear-gradient(180deg,rgba(26,120,194,.07),transparent)}
#drop:hover,#drop.over{border-color:var(--n1);background:linear-gradient(180deg,rgba(0,164,114,.13),transparent);
  box-shadow:0 0 0 1px rgba(0,164,114,.30), 0 12px 32px rgba(0,164,114,.14)}

/* lab badge */
#labTag{position:fixed;right:14px;bottom:14px;z-index:75;font-size:11px;letter-spacing:.14em;text-transform:uppercase;
  padding:8px 14px;border-radius:999px;color:#03211A;font-weight:800;
  background:linear-gradient(120deg,var(--n1),var(--n2));box-shadow:0 10px 26px rgba(26,120,194,.32)}
#labTag a{color:inherit;text-decoration:none}

@media (prefers-reduced-motion:reduce){
  body{animation:none}.gm.live{animation:none}
}
@media (max-width:900px){
  #labTag{bottom:auto;top:9px;right:9px;padding:5px 10px;font-size:10px}
  h1{font-size:24px}
}
`;

let html = readFileSync("index.html", "utf8");
html = html.replace("</style>", LAB_CSS + "\n</style>");
html = html.replace("<title>League Console</title>", "<title>League Console · Lab</title>");
html = html.replace('<canvas id="confetti" hidden></canvas>',
  '<div id="labTag"><a href="/">Lab · back to main</a></div>\n<canvas id="confetti" hidden></canvas>');
html = html.replace(/build-(\d+)/g, "lab-$1");
writeFileSync("lab.html", html);
console.log("wrote lab.html (" + (html.length / 1024).toFixed(0) + " kB)");
