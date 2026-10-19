/* Pick'em optimizer — predicting how the pool picks, shared by the sites.
   Nobody sees anyone's sheet before the deadline, so this learns each player's habits from
   their past sheets: how often they take the favourite, by the size of the line, plus a
   league-wide lean toward home teams. The backtest checks those predictions against weeks
   that already happened, each one predicted only from the other weeks. */
(function (root) {
  "use strict";
  const slug = n => String(n || "").toLowerCase().trim().replace(/[^a-z0-9]+/g, "-");
  const logit = p => Math.log(p / (1 - p));
  const unlogit = x => 1 / (1 + Math.exp(-x));
  const clamp = p => Math.min(0.985, Math.max(0.015, p));

  // close games (3 or less), medium (3.5 to 7), big favourites (over 7)
  const BUCKETS = ["close", "medium", "big"];
  function bucket(spread) { const a = Math.abs(spread); return a <= 3 ? 0 : a <= 7 ? 1 : 2; }
  // a game the model can use: it has a line, and someone is favoured
  const usable = g => typeof g.spread === "number" && g.spread !== 0;
  const favOf = g => (g.spread < 0 ? g.home : g.away);

  /* weeks: [{ week, games:[{id,home,away,spread}], entries:[{name,picks}] }]
     Returns league rates by bucket (and by whether the favourite is at home) and each
     player's own rates, shrunk toward the league so a few weeks don't define anyone. */
  const SHRINK = 6;                       // worth this many picks at the league rate
  function learn(weeks) {
    const L = [0, 1, 2].map(() => ({ fav: 0, n: 0, h: [{ fav: 0, n: 0 }, { fav: 0, n: 0 }] }));
    const P = {};
    for (const w of weeks) for (const g of w.games) {
      if (!usable(g)) continue;
      const b = bucket(g.spread), fav = favOf(g), home = g.spread < 0 ? 1 : 0;
      for (const e of w.entries) {
        const pk = e.picks?.[g.id];
        if (pk !== g.home && pk !== g.away) continue;
        const hit = pk === fav ? 1 : 0, k = slug(e.name);
        L[b].fav += hit; L[b].n++; L[b].h[home].fav += hit; L[b].h[home].n++;
        const p = P[k] || (P[k] = { name: e.name, fav: [0, 0, 0], n: [0, 0, 0], weeks: new Set() });
        p.fav[b] += hit; p.n[b]++; p.weeks.add(w.week);
      }
    }
    const league = L.map(x => (x.fav + 1) / (x.n + 2));
    const leagueHome = L.map((x, b) => x.h.map(y => (y.fav + league[b]) / (y.n + 1)));
    const players = {};
    for (const [k, p] of Object.entries(P))
      players[k] = { name: p.name, weeks: p.weeks.size, n: p.n,
                     rate: p.fav.map((f, b) => (f + SHRINK * league[b]) / (p.n[b] + SHRINK)) };
    return { league, leagueHome, players };
  }

  // chance this player takes the favourite in this game (unknown players get the league rate)
  function favChance(model, name, g, { leagueOnly = false } = {}) {
    if (!usable(g)) return null;
    const b = bucket(g.spread), home = g.spread < 0 ? 1 : 0;
    const base = model.league[b];
    const own = leagueOnly ? base : (model.players[slug(name)]?.rate[b] ?? base);
    // the league's home lean, as an adjustment on top of the player's own rate
    const homeShift = logit(clamp(model.leagueHome[b][home])) - logit(clamp(base));
    return unlogit(logit(clamp(own)) + homeShift);
  }

  // expected number of these players on each side of a game
  function predictSplit(model, g, names, opts) {
    let fav = 0;
    for (const n of names) fav += favChance(model, n, g, opts);
    const favTeam = favOf(g);
    return { fav, dog: names.length - fav, favTeam, dogTeam: favTeam === g.home ? g.away : g.home };
  }

  /* Leave-one-week-out: each week is predicted from all the others, then compared with what
     the pool actually picked. The baseline gives everyone the league's average habits; if
     knowing individual players doesn't beat that, the model isn't worth using. */
  function backtest(weeks) {
    const out = { weeks: [], games: 0, skipped: 0, miss: 0, missBase: 0, floor: 0, sideRight: 0 };
    for (const w of weeks) {
      const others = weeks.filter(x => x !== w);
      if (!others.length) continue;
      const model = learn(others);
      const names = w.entries.map(e => e.name);
      const rows = [];
      for (const g of w.games) {
        if (!usable(g)) { out.skipped++; rows.push({ g, skipped: true }); continue; }
        const pred = predictSplit(model, g, names), base = predictSplit(model, g, names, { leagueOnly: true });
        const picked = w.entries.filter(e => e.picks?.[g.id] === g.home || e.picks?.[g.id] === g.away);
        const actDog = picked.filter(e => e.picks[g.id] === pred.dogTeam).length;
        const scale = picked.length / Math.max(names.length, 1);     // a few may have left it blank
        const pDog = pred.dog * scale, bDog = base.dog * scale;
        const miss = Math.abs(pDog - actDog), missBase = Math.abs(bDog - actDog);
        // did it call which way the pool would lean?
        // the miss even a perfect model would have: people's choices have chance in them
        // (expected absolute deviation of a sum of yes/no picks ≈ 0.8 × its standard deviation)
        const floor = 0.798 * Math.sqrt(names.reduce((v, n) => { const p = favChance(model, n, g); return v + p * (1 - p); }, 0)) * Math.sqrt(scale);
        const half = picked.length / 2;
        const sideRight = (pDog > half) === (actDog > half) || Math.abs(actDog - half) < 0.5;
        rows.push({ g, spread: g.spread, favTeam: pred.favTeam, dogTeam: pred.dogTeam,
                    predDog: pDog, baseDog: bDog, actDog, of: picked.length, miss, missBase, floor, sideRight });
        out.games++; out.miss += miss; out.missBase += missBase; out.floor += floor; out.sideRight += sideRight ? 1 : 0;
      }
      out.weeks.push({ week: w.week, players: names.length, rows });
    }
    out.avgMiss = out.games ? out.miss / out.games : null;
    out.avgMissBase = out.games ? out.missBase / out.games : null;
    out.sideRate = out.games ? out.sideRight / out.games : null;
    out.avgFloor = out.games ? out.floor / out.games : null;
    return out;
  }

  root.PickOpt = { BUCKETS, bucket, usable, learn, favChance, predictSplit, backtest };
})(typeof window !== "undefined" ? window : globalThis);
