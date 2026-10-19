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
  function bitCount(v) { v = v - ((v >>> 1) & 0x55555555); v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24; }
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


  /* ── Step 2: the sheet with the best chance to finish first ───────────────
     Each simulated week rolls every game from the betting odds and fills in a sheet for
     everyone likely to play (from the backtest's best model and how often each person
     enters). Your sheet is scored against the same simulated weeks for every candidate, so
     comparisons between candidates aren't blurred by luck. */
  function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
  const normal = r => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

  /* games: this week's games (with spread); pHome: chance each home team wins;
     entrants: [{ name, chance }] who might play (not you); predict(name, g, formDiff) → P(favourite);
     formOf: team → +1/-1/0; tb: { mean, sd } of the tiebreaker game's total */
  function simulate({ games, pHome, entrants, predict, formOf = {}, tb, sims = 5000, seed = 7 }) {
    const r = rng(seed), n = games.length, ALL = n >= 32 ? 0xffffffff : (1 << n) - 1;
    const favP = games.map(g => entrants.map(e => {
      if (!usable(g)) return 0.5;
      const fav = favOf(g), dog = fav === g.home ? g.away : g.home;
      return predict(e.name, g, (formOf[fav] || 0) - (formOf[dog] || 0));
    }));
    const favIsHome = games.map(g => usable(g) ? g.spread < 0 : true);
    const W = { n, ALL, sims, outcome: new Uint32Array(sims), total: new Int16Array(sims),
                fieldMax: new Int8Array(sims), tied: [], players: new Uint8Array(sims) };
    for (let s = 0; s < sims; s++) {
      let mask = 0;
      for (let i = 0; i < n; i++) if (r() < pHome[i]) mask |= 1 << i;
      W.outcome[s] = mask >>> 0;
      W.total[s] = Math.max(0, Math.round(tb.mean + tb.sd * normal(r)));
      let best = -1, tied = [], count = 0;
      for (let k = 0; k < entrants.length; k++) {
        if (r() >= entrants[k].chance) continue;
        count++;
        let pick = 0;
        for (let i = 0; i < n; i++) {
          const takesFav = r() < favP[i][k];
          if (takesFav === favIsHome[i]) pick |= 1 << i;          // bit set = took the home team
        }
        const sc = bitCount((~(mask ^ pick)) & ALL);
        const guess = Math.max(0, Math.round(tb.mean + 7 * normal(r)));
        if (sc > best) { best = sc; tied = [guess]; } else if (sc === best) tied.push(guess);
      }
      W.fieldMax[s] = best; W.tied.push(tied); W.players[s] = count;
    }
    return W;
  }
  // chance a sheet (bit set = home team) with this tiebreaker finishes first, ties shared
  function winChance(W, pick, tbGuess) {
    let won = 0;
    for (let s = 0; s < W.sims; s++) {
      const sc = bitCount((~(W.outcome[s] ^ pick)) & W.ALL), top = W.fieldMax[s];
      if (sc > top) { won++; continue; }
      if (sc < top) continue;
      const mine = Math.abs(tbGuess - W.total[s]); let closer = false, same = 0;
      for (const t of W.tied[s]) { const d = Math.abs(t - W.total[s]); if (d < mine) { closer = true; break; } if (d === mine) same++; }
      if (!closer) won += 1 / (1 + same);
    }
    return won / W.sims;
  }
  function winVector(W, pick, tbGuess) {
    const v = new Float32Array(W.sims);
    for (let s = 0; s < W.sims; s++) {
      const sc = bitCount((~(W.outcome[s] ^ pick)) & W.ALL), top = W.fieldMax[s];
      if (sc > top) { v[s] = 1; continue; }
      if (sc < top) continue;
      const mine = Math.abs(tbGuess - W.total[s]); let closer = false, same = 0;
      for (const t of W.tied[s]) { const d = Math.abs(t - W.total[s]); if (d < mine) { closer = true; break; } if (d === mine) same++; }
      if (!closer) v[s] = 1 / (1 + same);
    }
    return v;
  }
  // A flip is kept only if it beats the current sheet clearly: at least half a point of win
  // chance, and more than twice the paired standard error across the same simulated weeks.
  // Smaller "gains" are mostly simulation noise, and every flip costs accuracy.
  const MIN_GAIN = 0.005, MAX_FLIPS = 3;
  function pairedGain(a, b) {
    const n = a.length; let sum = 0, sq = 0;
    for (let s = 0; s < n; s++) { const d = b[s] - a[s]; sum += d; sq += d * d; }
    const mean = sum / n, se = Math.sqrt(Math.max(sq / n - mean * mean, 0) / n);
    return { mean, se };
  }
  function optimizeSheet({ games, pHome, W, tbMean }) {
    const n = games.length;
    const chalk = games.reduce((m, g, i) => (usable(g) ? g.spread < 0 : pHome[i] >= 0.5) ? m | (1 << i) : m, 0) >>> 0;
    const pPick = (mask, i) => ((mask >> i) & 1) ? pHome[i] : 1 - pHome[i];
    const expected = mask => games.reduce((s, g, i) => s + pPick(mask, i), 0);
    let tbBest = Math.round(tbMean), pick = chalk;
    let curV = winVector(W, chalk, tbBest);
    const chalkWin = curV.reduce((a, b) => a + b, 0) / W.sims;
    let cur = chalkWin; const flips = [];
    for (let round = 0; round < MAX_FLIPS; round++) {
      let bestI = -1, bestG = null, bestV = null;
      for (let i = 0; i < n; i++) {
        if (flips.some(f => f.i === i)) continue;
        const v = winVector(W, (pick ^ (1 << i)) >>> 0, tbBest), g = pairedGain(curV, v);
        if (g.mean >= MIN_GAIN && g.mean > 2 * g.se && (!bestG || g.mean > bestG.mean)) { bestI = i; bestG = g; bestV = v; }
      }
      if (bestI < 0) break;
      flips.push({ i: bestI, gain: bestG.mean, cost: pPick(pick, bestI) - pPick((pick ^ (1 << bestI)) >>> 0, bestI) });
      pick = (pick ^ (1 << bestI)) >>> 0; cur += bestG.mean; curV = bestV;
    }
    // tiebreaker: every whole number near the projected total
    let tbWin = cur;
    for (let t = Math.round(tbMean) - 12; t <= Math.round(tbMean) + 12; t++) {
      const p = winChance(W, pick, t); if (p > tbWin + 0.0005) { tbWin = p; tbBest = t; }
    }
    return { chalk, pick, chalkWin, finalWin: tbWin, tb: tbBest, flips,
             chalkExpected: expected(chalk), expected: expected(pick),
             avgPlayers: W.players.reduce((a, b) => a + b, 0) / W.sims };
  }


  /* Walk-forward test: for each past week, build the sheet using only the weeks before it,
     then score it against what actually happened, next to all favourites and the player's
     real sheet. h = { homeWinProb(g), projected(g) → {mean, sd} } from the page. */
  function walkForward({ weeks, me, h, sims = 4000 }) {
    const sorted = [...weeks].sort((a, b) => a.week - b.week), out = [];
    for (const w of sorted) {
      const prior = sorted.filter(x => x.week < w.week);
      if (!prior.length) continue;
      const form = formTable([...prior, { week: w.week, games: [] }]);
      const predict = prior.length >= 2 ? compare(prior).predict
        : ((m => (name, g, d = 0) => usable(g) ? unlogit(score(m, { line: Math.min(Math.abs(g.spread), 14), home: g.spread < 0 ? 1 : 0,
            fav: favOf(g), dog: favOf(g) === g.home ? g.away : g.home, form: d, player: slug(name) })) : null)
          (fitLogit(rowsOf(prior, formTable(prior)), {})));
      // who plays: from the weeks before
      const seen = new Map(); prior.forEach(p => p.entries.forEach(e => seen.set(slug(e.name), e.name)));
      const entrants = [...seen].filter(([k]) => k !== slug(me)).map(([k, name]) => ({ name,
        chance: Math.min(0.98, prior.filter(p => p.entries.some(e => slug(e.name) === k)).length / prior.length) }));
      const pre = w.games.map(g => ({ ...g, state: "pre", final: false, winner: null, homeScore: 0, awayScore: 0 }));
      const pHome = pre.map(g => h.homeWinProb(g));
      const tbg = w.games.find(g => g.id === w.tbId) || w.games[w.games.length - 1];
      const proj = h.projected(pre.find(g => g.id === tbg?.id)) || { mean: 45, sd: 13 };
      const W = simulate({ games: pre, pHome, entrants, predict, formOf: form[w.week] || {}, tb: { mean: proj.mean, sd: Math.max(proj.sd, 6) }, sims, seed: w.week * 101 });
      const R = optimizeSheet({ games: pre, pHome, W, tbMean: proj.mean });
      // what actually happened
      const decided = w.games.filter(g => g.winner);
      const total = tbg && tbg.winner ? (tbg.homeScore || 0) + (tbg.awayScore || 0) : null;
      const scoreMask = mask => decided.reduce((s, g) => { const i = w.games.indexOf(g); return s + (g.winner === (((mask >> i) & 1) ? g.home : g.away) ? 1 : 0); }, 0);
      const others = w.entries.filter(e => slug(e.name) !== slug(me));
      const otherScores = others.map(e => ({ s: decided.filter(g => e.picks?.[g.id] === g.winner).length, tb: e.tiebreaker }));
      const top = Math.max(-1, ...otherScores.map(x => x.s));
      const result = (s, tb) => {
        if (s > top) return 1; if (s < top) return 0;
        if (total == null || tb == null) return 0.5;
        const mine = Math.abs(tb - total), tied = otherScores.filter(x => x.s === top).map(x => Math.abs((x.tb ?? 999) - total));
        const best = Math.min(...tied); return mine < best ? 1 : mine > best ? 0 : 1 / (1 + tied.filter(d => d === best).length);
      };
      const mine = w.entries.find(e => slug(e.name) === slug(me));
      const mineScore = mine ? decided.filter(g => mine.picks?.[g.id] === g.winner).length : null;
      out.push({ week: w.week, games: decided.length, flips: R.flips.length,
        opt: { s: scoreMask(R.pick), won: result(scoreMask(R.pick), R.tb), chance: R.finalWin },
        favs: { s: scoreMask(R.chalk), won: result(scoreMask(R.chalk), Math.round(proj.mean)), chance: R.chalkWin },
        actual: mine ? { s: mineScore, won: result(mineScore, mine.tiebreaker) } : null, top });
    }
    return out;
  }


  /* ── This week's news: injuries and weather ──────────────────────────────
     The line is the best single forecast, and it already reacts to news. These adjustments
     only cover the gap between what the line assumes and what we know on Thursday. */

  // chance a player suits up, by what's known Thursday (historical rates where they exist:
  // ~71% of questionable players play, ~5% of doubtful; practice-only statuses are estimates)
  const STATUS_CHANCE = { "full": 0.97, "limited": 0.85, "dnp": 0.55, "questionable": 0.71,
    "doubtful": 0.06, "out": 0, "expected-to-play": 0.88, "expected-to-sit": 0.15 };
  const STATUS_LABEL = { "full": "Full practice", "limited": "Limited practice", "dnp": "Did not practice",
    "questionable": "Questionable", "doubtful": "Doubtful", "out": "Out",
    "expected-to-play": "Expected to play (reports)", "expected-to-sit": "Expected to sit (reports)" };
  // points to the spread when he sits (betting-market rules of thumb)
  const VALUE_TIERS = [ { label: "Elite QB", value: 6 }, { label: "Starting QB", value: 4 },
    { label: "Weak starting QB", value: 2 }, { label: "Star non-QB", value: 1.5 }, { label: "Other starter", value: 0.75 } ];
  const ASSUMES = [ { label: "Line assumes he plays", value: 1 }, { label: "Mostly plays", value: 0.75 },
    { label: "Unsure", value: 0.5 }, { label: "Mostly sits", value: 0.25 }, { label: "Line assumes he sits", value: 0 } ];

  // inverse of the normal curve (Acklam's approximation), to turn a win chance back into points
  function normInv(p) {
    p = Math.min(1 - 1e-9, Math.max(1e-9, p));
    const a = [-39.6968302866538, 220.946098424521, -275.928510446969, 138.357751867269, -30.6647980661472, 2.50662827745924],
          b = [-54.4760987982241, 161.585836858041, -155.698979859887, 66.8013118877197, -13.2806815528857],
          c = [-0.00778489400243029, -0.322396458041136, -2.40075827716184, -2.54973253934373, 4.37466414146497, 2.93816398269878],
          d = [0.00778469570904146, 0.32246712907004, 2.445134137143, 3.75440866190742], pl = 0.02425;
    if (p < pl) { const q = Math.sqrt(-2 * Math.log(p)); return (((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    if (p > 1 - pl) { const q = Math.sqrt(-2 * Math.log(1 - p)); return -(((((c[0]*q+c[1])*q+c[2])*q+c[3])*q+c[4])*q+c[5]) / ((((d[0]*q+d[1])*q+d[2])*q+d[3])*q+1); }
    const q = p - 0.5, r = q * q;
    return (((((a[0]*r+a[1])*r+a[2])*r+a[3])*r+a[4])*r+a[5])*q / (((((b[0]*r+b[1])*r+b[2])*r+b[3])*r+b[4])*r+1);
  }
  const phi = z => 0.5 * (1 + erf(z / Math.SQRT2));
  function erf(x) { const t = 1 / (1 + 0.3275911 * Math.abs(x)), y = 1 - (((((1.061405429 * t - 1.453152027) * t) + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x); return x >= 0 ? y : -y; }
  const SD = 13.5;

  /* Adjust one game's chance that the home team wins.
     pHome: the market's chance. injuries: this game's entries, each { team, value, chance,
     marketAssumes }. The line already prices each player as playing with probability
     marketAssumes; the home team's margin in a world where he plays is (plays − assumed) × value
     away from the line. Every combination of who plays is weighed by its chance.
     Extreme weather (20+ mph wind or heavy snow) narrows the gap between the teams by 15%. */
  function adjustGame(g, pHome, injuries = [], weather = null) {
    let margin = SD * normInv(pHome);
    const notes = [];
    if (weather && weather.extreme) { margin *= 0.85; notes.push("extreme weather narrows the gap"); }
    const list = injuries.filter(x => x.team === g.home || x.team === g.away).slice(0, 6);
    let p = 0;
    const n = list.length;
    for (let mask = 0; mask < (1 << n); mask++) {
      let w = 1, m = margin;
      for (let i = 0; i < n; i++) {
        const x = list[i], plays = (mask >> i) & 1, sign = x.team === g.home ? 1 : -1;
        w *= plays ? x.chance : 1 - x.chance;
        m += sign * (plays - x.marketAssumes) * x.value;
      }
      if (w > 0) p += w * phi(m / SD);
    }
    for (const x of list) {
      const shift = (x.chance - x.marketAssumes) * x.value;
      if (Math.abs(shift) >= 0.05) notes.push(`${x.player} ${Math.round(x.chance * 100)}% to play (line assumes ${Math.round(x.marketAssumes * 100)}%)`);
    }
    return { pHome: n ? p : phi(margin / SD), notes };
  }

  /* ── Weather ────────────────────────────────────────────────────────────
     Outdoor stadiums only (roof: open; retractable roofs are treated as closed in bad weather).
     Forecasts come from Open-Meteo (free, no key) for the kickoff hour. */
  const STADIUMS = {
    ARI:[33.5276,-112.2626,"dome"], ATL:[33.7554,-84.4008,"dome"], BAL:[39.2780,-76.6227,"open"], BUF:[42.7738,-78.7870,"open"],
    CAR:[35.2258,-80.8528,"open"], CHI:[41.8623,-87.6167,"open"], CIN:[39.0955,-84.5161,"open"], CLE:[41.5061,-81.6995,"open"],
    DAL:[32.7473,-97.0945,"dome"], DEN:[39.7439,-105.0201,"open"], DET:[42.3400,-83.0456,"dome"], GB:[44.5013,-88.0622,"open"],
    HOU:[29.6847,-95.4107,"dome"], IND:[39.7601,-86.1639,"dome"], JAX:[30.3239,-81.6373,"open"], KC:[39.0489,-94.4839,"open"],
    LV:[36.0909,-115.1833,"dome"], LAC:[33.9535,-118.3392,"dome"], LAR:[33.9535,-118.3392,"dome"], MIA:[25.9580,-80.2389,"open"],
    MIN:[44.9737,-93.2577,"dome"], NE:[42.0909,-71.2643,"open"], NO:[29.9511,-90.0812,"dome"], NYG:[40.8135,-74.0745,"open"],
    NYJ:[40.8135,-74.0745,"open"], PHI:[39.9008,-75.1675,"open"], PIT:[40.4468,-80.0158,"open"], SF:[37.4030,-121.9700,"open"],
    SEA:[47.5952,-122.3316,"open"], TB:[27.9759,-82.5033,"open"], TEN:[36.1665,-86.7713,"open"], WSH:[38.9077,-76.8645,"open"],
  };
  // games played away from the home team's stadium (international and neutral sites)
  const VENUES = [
    [/wembley/i, [51.5560,-0.2795,"open"]], [/tottenham/i, [51.6043,-0.0664,"open"]], [/croke|dublin/i, [53.3607,-6.2512,"open"]],
    [/allianz|munich/i, [48.2188,11.6247,"open"]], [/frankfurt|deutsche bank/i, [50.0686,8.6455,"open"]],
    [/bernab[eé]u|madrid/i, [40.4531,-3.6883,"retractable"]], [/maracan|rio/i, [-22.9122,-43.2302,"open"]],
    [/s[aã]o paulo|corinthians|arena/i, [-23.5453,-46.4742,"open"]], [/melbourne|mcg/i, [-37.8200,144.9834,"open"]],
    [/mexico|azteca|banorte/i, [19.3029,-99.1505,"open"]],
  ];
  function stadiumFor(g) {
    const v = g.venue || {};
    const hit = VENUES.find(([re]) => re.test(`${v.name || ""} ${v.city || ""}`));
    if (hit) return { lat: hit[1][0], lon: hit[1][1], roof: hit[1][2], where: v.name || v.city };
    const s = STADIUMS[String(g.home || "").toUpperCase()] || STADIUMS[{ WAS: "WSH", LA: "LAR", JAC: "JAX" }[g.home]];
    if (!s) return null;
    return { lat: s[0], lon: s[1], roof: v.indoor ? "dome" : s[2], where: v.name || g.home };
  }
  // forecast at kickoff; returns null for indoor games or when there's no forecast yet
  async function fetchWeather(g) {
    const st = stadiumFor(g);
    if (!st || st.roof !== "open" || !g.kickoff) return st ? { indoor: true } : null;
    const k = new Date(g.kickoff), day = k.toISOString().slice(0, 10);
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${st.lat}&longitude=${st.lon}` +
      `&hourly=temperature_2m,wind_speed_10m,wind_gusts_10m,precipitation,snowfall&wind_speed_unit=mph` +
      `&temperature_unit=fahrenheit&precipitation_unit=inch&timezone=UTC&start_date=${day}&end_date=${day}`;
    try {
      const r = await fetch(url); if (!r.ok) return null;
      const d = await r.json(), t = d.hourly?.time || [];
      const i = t.indexOf(k.toISOString().slice(0, 13) + ":00"); if (i < 0) return null;
      const at = key => d.hourly[key]?.[i];
      // the whole game, not just the first hour: the worst of the next three hours
      const win = key => Math.max(...[i, i + 1, i + 2].map(j => d.hourly[key]?.[j] ?? 0));
      const w = { indoor: false, temp: at("temperature_2m"), wind: win("wind_speed_10m"), gust: win("wind_gusts_10m"),
                  rain: win("precipitation"), snow: win("snowfall") };
      w.windy = w.wind >= 15; w.extreme = w.wind >= 20 || w.snow >= 0.1;
      // tiebreaker total: wind and snow cut scoring (rough market rules of thumb)
      w.totalShift = -(w.wind >= 20 ? 3 : w.wind >= 15 ? 1.5 : 0) - (w.snow >= 0.1 ? 2 : 0) - (w.rain >= 0.1 ? 1 : 0);
      return w;
    } catch (e) { return null; }
  }
  function weatherLabel(w) {
    if (!w) return "";
    if (w.indoor) return "indoors";
    const bits = [`${Math.round(w.temp)}°`, `wind ${Math.round(w.wind)} mph`];
    if (w.snow >= 0.05) bits.push("snow"); else if (w.rain >= 0.05) bits.push("rain");
    return bits.join(" · ");
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
                   FEATURES, formTable, rowsOf, fitLogit, score, compare, slug, unlogit,
                   simulate, winChance, optimizeSheet, walkForward,
                   STATUS_CHANCE, STATUS_LABEL, VALUE_TIERS, ASSUMES, adjustGame, normInv, stadiumFor, fetchWeather, weatherLabel };
})(typeof window !== "undefined" ? window : globalThis);
