/* Pick'em core — the scoring model, win chances and logo choice, shared by /, /lab and /pro.
   There is one copy of each so the three sites can never disagree on a number. Everything
   here works only from what it's given; each page passes in its own games and entries. */
(function (root) {
  "use strict";

  /* ── Live win probability ───────────────────────────────────────────
     Final NFL margins scatter with a standard deviation near 13.5 points over a full
     game. Shrink that with the clock: sd ≈ 1.74 * √(minutes left). A lead of 8 with
     2:30 left is then worth far more than the same lead in the first quarter.
     Pre-game we lean on the betting line when the feed has one, otherwise a small
     home-field nudge. */
  function normCdf(z) {
    const t = 1 / (1 + 0.2316419 * Math.abs(z));
    const d = 0.3989423 * Math.exp(-z * z / 2);
    const p = d * t * (1.330274 * t ** 4 - 1.821256 * t ** 3 + 1.781478 * t * t - 0.356538 * t + 0.3193815);
    return z > 0 ? 1 - p : p;
  }

  function minutesLeft(g) {
    if (g.state === "pre") return 60;
    if (g.final) return 0;
    const per = g.period || 1;
    const secs = g.clockSeconds == null ? 0 : g.clockSeconds;
    if (per >= 5) return Math.max(secs / 60, 0.1);              // overtime
    return Math.max(0, 4 - per) * 15 + secs / 60;
  }

  // probability the HOME team wins, 0..1. `winner` is the game's result if it's decided
  // (a team, "TIE", or nothing), which each page works out its own way.
  function homeWinProb(g, winner) {
    if (winner) return winner === "TIE" ? 0.5 : (winner === g.home ? 1 : 0);
    const mins = minutesLeft(g);
    const margin = (g.homeScore || 0) - (g.awayScore || 0);
    if (g.state === "pre") {
      const line = typeof g.spread === "number" ? -g.spread : 1.6;   // home spread -3 → +3 edge
      return normCdf(line / 13.5);
    }
    // variance from the clock, plus a floor: football scores in chunks, so even a
    // two-score lead in the last minutes isn't settled (touchdown + two-point try).
    const sd = Math.sqrt(1.74 ** 2 * Math.max(mins, 0) + 9);
    let expected = margin + (mins / 60) * 1.6;                        // residual home edge
    // Having the ball is worth little early and a lot late, when there may be only one
    // possession left. Red zone adds to that.
    if (g.possession) {
      const late = Math.min(1, Math.max(0, 1 - mins / 15));
      const bonus = (0.9 + 1.7 * late) + (g.redZone ? 1.6 : 0);
      expected += g.possession === g.home ? bonus : -bonus;
    }
    return Math.min(0.98, Math.max(0.02, normCdf(expected / sd)));
  }

  /* ── Projected final total for the tiebreaker game ──────────────────
     Pre-game we take the market over/under. Once it's running we blend the market's
     scoring rate with the rate actually being produced, trusting the observed pace more
     as the game goes on. Uncertainty shrinks with the clock. */
  function projectedTotal(g) {
    if (!g) return null;
    const market = typeof g.overUnder === "number" ? g.overUnder : 44;
    if (g.final) return { mean: g.homeScore + g.awayScore, sd: 0 };
    if (g.state === "pre") return { mean: market, sd: 13.2 };
    const mins = minutesLeft(g);
    const elapsed = Math.max(60 - mins, 0.1);
    const scored = (g.homeScore || 0) + (g.awayScore || 0);
    const trustSeen = Math.min(0.75, elapsed / 60);        // never fully abandon the market
    const rate = (market / 60) * (1 - trustSeen) + (scored / elapsed) * trustSeen;
    return { mean: scored + rate * mins, sd: Math.max(13.2 * Math.sqrt(mins / 60), 0.8) };
  }

  // chance each tied player's guess ends up closest to the real total
  function tiebreakerShares(entries, g) {
    const proj = projectedTotal(g);
    const floor = g && !g.final ? (g.homeScore || 0) + (g.awayScore || 0) : null;
    const out = new Map();
    if (!entries.length) return out;
    const closest = total => {
      let best = Infinity, winners = [];
      for (const e of entries) {
        const d = Math.abs((e.tiebreaker ?? 9999) - total);
        if (d < best) { best = d; winners = [e.name]; } else if (d === best) winners.push(e.name);
      }
      return winners;
    };
    if (!proj || proj.sd < 0.5) {                           // total already known
      if (!proj) { entries.forEach(e => out.set(e.name, 1 / entries.length)); return out; }
      const w = closest(proj.mean);
      w.forEach(n => out.set(n, 1 / w.length));
      return out;
    }
    // walk plausible totals, hand each one to whoever guessed closest
    const lo = Math.max(floor != null ? floor : 0, Math.round(proj.mean - 4 * proj.sd));
    const hi = Math.round(proj.mean + 4 * proj.sd);
    let mass = 0;
    for (let t = lo; t <= hi; t++) {
      const z = (t - proj.mean) / proj.sd, wt = Math.exp(-z * z / 2);
      const w = closest(t);
      w.forEach(n => out.set(n, (out.get(n) || 0) + wt / w.length));
      mass += wt;
    }
    if (mass > 0) for (const [k, v] of out) out.set(k, v / mass);
    return out;
  }

  /* ── Every way the open games can finish ─────────────────────────────
     Each combination of open-game results is a number: bit i set = the home side of open
     game i wins. A player's picks become two masks (which games they picked, and which of
     those they picked the home side in), so their score in any combination is a bit count.
     A full 16-game week is 65,536 combinations and runs in about 150 ms. */
  function bitCount(v) {
    v = v - ((v >>> 1) & 0x55555555);
    v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
    return (((v + (v >>> 4)) & 0x0F0F0F0F) * 0x01010101) >>> 24;
  }

  // open: the unfinished games. players: [{ e: entry, base: correct so far }].
  // Returns who can still finish top (alive), each player's chance of winning the week
  // (chance), and, when asked and 3 or fewer games are left, every combination (combos).
  function analyse({ open, players, tbGame, scenarios = false }) {
    const alive = new Set(), chance = new Map(), combos = [];
    if (!players.length) return { alive, chance, combos };
    const n = open.length;
    if (n > 20) { players.forEach(p => alive.add(p.e.name)); return { alive, chance, combos }; }
    const masks = players.map(p => {
      let home = 0, picked = 0;
      open.forEach((g, i) => {
        const pk = p.e.picks?.[g.id];
        if (pk === g.home) { home |= 1 << i; picked |= 1 << i; }
        else if (pk === g.away) picked |= 1 << i;
      });
      return { e: p.e, base: p.base, home, picked };
    });
    const ph = open.map(g => homeWinProb(g, null));
    const shareCache = new Map(), total = 1 << n;
    for (let mask = 0; mask < total; mask++) {
      let best = -1, top = [];
      for (const m of masks) {
        const sc = m.base + bitCount(m.picked & ~(mask ^ m.home));
        if (sc > best) { best = sc; top = [m]; } else if (sc === best) top.push(m);
      }
      for (const t of top) alive.add(t.e.name);
      let pr = 1;
      for (let i = 0; i < n; i++) pr *= (mask >> i) & 1 ? ph[i] : 1 - ph[i];
      if (pr > 0) {
        if (top.length === 1) chance.set(top[0].e.name, (chance.get(top[0].e.name) || 0) + pr);
        else {
          // the same group often ties in many combinations; split its tiebreaker once
          const key = top.map(t => t.e.name).sort().join("|");
          let sh = shareCache.get(key);
          if (!sh) { sh = tiebreakerShares(top.map(t => t.e), tbGame); shareCache.set(key, sh); }
          // a name missing from the split lost the tiebreaker outright: zero, not an equal share
          for (const t of top) {
            const share = sh.size ? (sh.get(t.e.name) || 0) : 1 / top.length;
            chance.set(t.e.name, (chance.get(t.e.name) || 0) + pr * share);
          }
        }
      }
      if (scenarios && n <= 3) {
        const picks = {};
        open.forEach((g, i) => { picks[g.id] = (mask >> i) & 1 ? g.home : g.away; });
        combos.push({ picks, p: pr, best, top: top.map(t => t.e) });
      }
    }
    return { alive, chance, combos };
  }

  /* ── Logos ───────────────────────────────────────────────────────────
     ESPN's standard marks are drawn for light backgrounds. These teams' marks disappear on a
     dark one, so dark backgrounds use ESPN's light version. A fixed list: judging by team
     colour missed the Giants and Colts, whose navies sit just above any sensible cut-off. */
  const DARK_MARKS = new Set(["BAL", "CAR", "CHI", "DAL", "HOU", "IND", "LV", "NE", "NYG", "NYJ", "PHI", "SEA"]);
  function needsLightLogo(team) { return DARK_MARKS.has(String(team || "").toUpperCase()); }
  function logoFor(g, side, darkBackground) {
    const std = side === "home" ? g.homeLogo : g.awayLogo;
    const light = side === "home" ? g.homeLogoDark : g.awayLogoDark;
    if (darkBackground && needsLightLogo(side === "home" ? g.home : g.away)) return light || std || "";
    return std || light || "";
  }

  /* ── Who won the week ─────────────────────────────────────────────────
     players: [{ e: entry, base: correct picks }]. Once every game is final, the top score
     wins; a tie goes to the tiebreaker guess closest to the tiebreaker game's real total. */
  function weekOutcome({ games, winnerOf, players, tbGame }) {
    const open = games.filter(g => !winnerOf(g)).length;
    const complete = games.length > 0 && open === 0 && players.length > 0;
    if (!players.length) return { complete: false, champs: new Set(), tiedNames: new Set(), top: 0, actual: null, tbGame: null, open };
    const top = Math.max(...players.map(p => p.base));
    const tied = players.filter(p => p.base === top);
    const actual = complete && tbGame && tbGame.final ? tbGame.homeScore + tbGame.awayScore : null;
    const champs = new Set();
    if (complete) {
      if (tied.length === 1) champs.add(tied[0].e.name);
      else if (actual != null) {
        const d = tied.map(p => ({ n: p.e.name, d: Math.abs((p.e.tiebreaker ?? 9999) - actual) })).sort((a, b) => a.d - b.d);
        d.filter(x => x.d === d[0].d).forEach(x => champs.add(x.n));
      }
    }
    return { complete, champs, tiedNames: new Set(tied.map(p => p.e.name)), top, actual, tbGame, open };
  }

  root.PickCore = { normCdf, minutesLeft, homeWinProb, projectedTotal, tiebreakerShares,
                    bitCount, analyse, weekOutcome, DARK_MARKS, needsLightLogo, logoFor };
})(typeof window !== "undefined" ? window : globalThis);
