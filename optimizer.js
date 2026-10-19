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


  /* ── A fuller model: one logistic regression over every pick ─────────────
     chance of taking the favourite = σ( b0 + b1·line + b2·favourite-at-home
                                         + player lean + (fav popularity − dog popularity)
                                         + b3·(fav form − dog form) )
     Player leans and team popularity are held near zero unless the data clearly says
     otherwise (an L2 penalty), so a week or two can't define anyone. Fitted by gradient
     descent; a full season of picks takes a few milliseconds. */
  const FEATURES = [
    { key: "line",    label: "League habits (line size + home)", use: {} },
    { key: "players", label: "+ each player's own lean",         use: { players: true } },
    { key: "teams",   label: "+ team popularity",               use: { players: true, teams: true } },
    { key: "form",    label: "+ recent form",                   use: { players: true, teams: true, form: true } },
  ];
  // +1 if a team won its most recent earlier game, -1 if it lost, 0 if unknown
  function formTable(weeks) {
    const sorted = [...weeks].sort((a, b) => a.week - b.week), out = {};
    let last = {};
    for (const w of sorted) {
      out[w.week] = { ...last };
      for (const g of w.games) if (g.winner) {
        if (g.winner === "TIE") { last[g.home] = 0; last[g.away] = 0; }
        else { last[g.winner] = 1; last[g.winner === g.home ? g.away : g.home] = -1; }
      }
    }
    return out;
  }
  function rowsOf(weeks, form) {
    const rows = [];
    for (const w of weeks) for (const g of w.games) {
      if (!usable(g)) continue;
      const fav = favOf(g), dog = fav === g.home ? g.away : g.home, f = form?.[w.week] || {};
      const base = { line: Math.min(Math.abs(g.spread), 14), home: g.spread < 0 ? 1 : 0, fav, dog,
                     form: (f[fav] || 0) - (f[dog] || 0) };
      for (const e of w.entries) {
        const pk = e.picks?.[g.id];
        if (pk !== g.home && pk !== g.away) continue;
        rows.push({ ...base, player: slug(e.name), y: pk === fav ? 1 : 0 });
      }
    }
    return rows;
  }
  function fitLogit(rows, use) {
    const m = { b: [0, 0.3, 0, 0], u: {}, t: {}, use };
    if (!rows.length) return m;
    const LP = 10, LT = 60, LB = 0.01, lr = 0.06;      // hold-backs tuned on a made-up league with planted effects
    // Adam on all parameters
    const mom = new Map(), vel = new Map();
    const step = (key, g, get, set) => {
      const a = (mom.get(key) || 0) * 0.9 + 0.1 * g, v = (vel.get(key) || 0) * 0.999 + 0.001 * g * g;
      mom.set(key, a); vel.set(key, v); set(get() - lr * a / (Math.sqrt(v) + 1e-8));
    };
    for (let it = 0; it < 350; it++) {
      const gb = [0, 0, 0, 0], gu = {}, gt = {};
      for (const r of rows) {
        const p = unlogit(score(m, r)), d = (p - r.y) / rows.length;
        gb[0] += d; gb[1] += d * r.line; gb[2] += d * r.home; if (use.form) gb[3] += d * r.form;
        if (use.players) gu[r.player] = (gu[r.player] || 0) + d;
        if (use.teams) { gt[r.fav] = (gt[r.fav] || 0) + d; gt[r.dog] = (gt[r.dog] || 0) - d; }
      }
      const n = rows.length;
      for (let i = 0; i < 4; i++) step("b" + i, gb[i] + LB * m.b[i], () => m.b[i], v => m.b[i] = v);
      for (const k in gu) step("u" + k, gu[k] + LP * (m.u[k] || 0) / n, () => m.u[k] || 0, v => m.u[k] = v);
      for (const k in gt) step("t" + k, gt[k] + LT * (m.t[k] || 0) / n, () => m.t[k] || 0, v => m.t[k] = v);
    }
    return m;
  }
  function score(m, r) {
    let s = m.b[0] + m.b[1] * r.line + m.b[2] * r.home;
    if (m.use.form) s += m.b[3] * r.form;
    if (m.use.players) s += m.u[r.player] || 0;
    if (m.use.teams) s += (m.t[r.fav] || 0) - (m.t[r.dog] || 0);
    return s;
  }

  // every model, each week predicted from the others; lower miss is better
  function compare(weeks) {
    const form = formTable(weeks);
    const results = FEATURES.map(f => ({ ...f, games: 0, miss: 0, side: 0, weeks: [] }));
    const buckets = { key: "buckets", label: "Simple habits (three line sizes)", games: 0, miss: 0, side: 0 };
    for (const w of weeks) {
      const others = weeks.filter(x => x !== w);
      if (!others.length) continue;
      const trainRows = rowsOf(others, form);
      const models = FEATURES.map(f => fitLogit(trainRows, f.use));
      const bm = learn(others);
      const names = w.entries.map(e => e.name);
      FEATURES.forEach((f, fi) => results[fi].weeks.push({ week: w.week, players: names.length, rows: [] }));
      for (const g of w.games) {
        if (!usable(g)) continue;
        const fav = favOf(g), dog = fav === g.home ? g.away : g.home, fw = form[w.week] || {};
        const picked = w.entries.filter(e => e.picks?.[g.id] === g.home || e.picks?.[g.id] === g.away);
        if (!picked.length) continue;
        const actDog = picked.filter(e => e.picks[g.id] === dog).length, half = picked.length / 2;
        const judge = (acc, predDog) => {
          acc.games++; acc.miss += Math.abs(predDog - actDog);
          acc.side += ((predDog > half) === (actDog > half) || Math.abs(actDog - half) < 0.5) ? 1 : 0;
        };
        // simple-habits baseline
        judge(buckets, picked.reduce((s, e) => s + (1 - favChance(bm, e.name, g)), 0));
        const base = { line: Math.min(Math.abs(g.spread), 14), home: g.spread < 0 ? 1 : 0, fav, dog,
                       form: (fw[fav] || 0) - (fw[dog] || 0) };
        models.forEach((m, fi) => {
          const predDog = picked.reduce((s, e) => s + (1 - unlogit(score(m, { ...base, player: slug(e.name) }))), 0);
          judge(results[fi], predDog);
          results[fi].weeks.at(-1).rows.push({ g, spread: g.spread, favTeam: fav, dogTeam: dog,
            predDog, actDog, of: picked.length, miss: Math.abs(predDog - actDog) });
        });
      }
    }
    const fin = r => ({ ...r, avgMiss: r.games ? r.miss / r.games : null, sideRate: r.games ? r.side / r.games : null });
    const all = [fin(buckets), ...results.map(fin)];
    const best = all.filter(r => r.games).sort((a, b) => a.avgMiss - b.avgMiss)[0];
    // the fullest model, fitted on every week, describes the pool; the optimizer predicts with
    // whichever model actually did best in the backtest
    const final = fitLogit(rowsOf(weeks, form), FEATURES[3].use);
    const bestUse = FEATURES.find(f => f.key === best?.key)?.use;
    const bestFit = bestUse ? fitLogit(rowsOf(weeks, form), bestUse) : learn(weeks);
    const predict = (name, g, formDiff = 0) => {
      if (!usable(g)) return null;
      if (!bestUse) return favChance(bestFit, name, g);
      const fav = favOf(g), dog = fav === g.home ? g.away : g.home;
      return unlogit(score(bestFit, { line: Math.min(Math.abs(g.spread), 14), home: g.spread < 0 ? 1 : 0,
                                      fav, dog, form: formDiff, player: slug(name) }));
    };
    return { models: all, best, final, predict, form };
  }

  // lines from the season file (lines-2026.json), for games the feed carried no line for
  const ALIAS = { WAS: "WSH", LA: "LAR", JAC: "JAX" };
  const norm = t => ALIAS[String(t || "").toUpperCase()] || String(t || "").toUpperCase();
  function lineFor(file, week, away, home) {
    const wk = file?.weeks?.[String(week)]; if (!wk) return null;
    const v = wk[`${norm(away)}@${norm(home)}`];
    return typeof v === "number" ? v : null;
  }

  root.PickOpt = { BUCKETS, bucket, usable, learn, favChance, predictSplit, backtest, lineFor,
                   FEATURES, formTable, rowsOf, fitLogit, score, compare, slug, unlogit };
})(typeof window !== "undefined" ? window : globalThis);
