/* LA RUE GRONDE — moteur mathématique (prototype)
 * 5 rouleaux × 3 rangées, 20 lignes fixes.
 * Tous les gains sont exprimés en multiples de la MISE TOTALE.
 * Le même fichier tourne dans le navigateur et dans Node (sim.js).
 *
 * Comme sur Stake Engine, une partie complète (tour de base + bonus éventuel)
 * est calculée d'un coup, puis l'interface ne fait que la rejouer.
 */
(function (root) {
  'use strict';

  const LINES = 20;

  // pays[n] = gain pour n symboles alignés, en multiples de la mise PAR LIGNE
  const SYMBOLS = [
    { key: 'bidon',        name: "Jerrican d'essence",       pays: [0, 0, 0, 10, 25, 75] },
    { key: 'portefeuille', name: 'Porte-monnaie vide',     pays: [0, 0, 0, 10, 25, 75] },
    { key: 'ticket',       name: 'Ticket de caisse',      pays: [0, 0, 0, 10, 30, 100] },
    { key: 'gilet',        name: 'Gilet jaune',           pays: [0, 0, 0, 15, 40, 150] },
    { key: 'pave',         name: 'Pavé',                  pays: [0, 0, 0, 15, 50, 200] },
    { key: 'fumigene',     name: 'Fumigène',              pays: [0, 0, 0, 20, 75, 300] },
    { key: 'poubelle',     name: 'Poubelle en feu',       pays: [0, 0, 0, 30, 100, 400] },
    { key: 'crs',          name: 'CRS',                   pays: [0, 0, 0, 40, 150, 750] },
    { key: 'wild',         name: 'WILD — Pancarte RÉVOLTE', pays: [0, 0, 0, 50, 200, 1500] },
    { key: 'scatter',      name: 'SCATTER — Barricade',   pays: [0, 0, 0, 0, 0, 0] },
  ];
  const WILD = 8, SCATTER = 9;

  // Scatter : gain (× mise totale) et nombre de tours gratuits
  const SCATTER_PAY = { 3: 2, 4: 6, 5: 25 };
  const SCATTER_SPINS = { 3: 10, 4: 12, 5: 15 };
  const RETRIGGER_SPINS = 5;
  const MAX_WIN = 5000;      // plafond, en × mise
  const BONUS_BUY_COST = 66; // prix de l'achat du bonus, en × mise

  const PAYLINES = [
    [1,1,1,1,1],[0,0,0,0,0],[2,2,2,2,2],[0,1,2,1,0],[2,1,0,1,2],
    [0,0,1,2,2],[2,2,1,0,0],[1,0,0,0,1],[1,2,2,2,1],[1,0,1,2,1],
    [1,2,1,0,1],[0,1,0,1,0],[2,1,2,1,2],[0,1,1,1,0],[2,1,1,1,2],
    [1,1,0,1,1],[1,1,2,1,1],[0,2,0,2,0],[2,0,2,0,2],[0,2,2,2,0],
  ];

  // Poids des symboles par rouleau. Ordre : les 10 symboles ci-dessus.
  //            bid port tick gil pav fum pou crs wild scat
  const W_BASE = [
    [ 14, 14, 13, 11, 10,  8,  6,  5,  0,  2 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  4,  2 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  4,  2 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  4,  2 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  0,  2 ],
  ];
  // Pendant l'Insurrection : wilds un peu plus fréquents, ils s'étendent (barricade)
  const W_FREE = [
    [ 14, 14, 13, 11, 10,  8,  6,  5,  0,  1 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  5,  1 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  5,  1 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  5,  1 ],
    [ 14, 14, 13, 11, 10,  8,  6,  5,  0,  1 ],
  ];

  // Construit des bandes de rouleaux fixes (déterministes) à partir des poids,
  // en évitant deux scatters ou deux wilds collés.
  function buildStrips(weights, seed) {
    let s = seed >>> 0;
    const rnd = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
    return weights.map((w) => {
      const strip = [];
      w.forEach((n, sym) => { for (let i = 0; i < n; i++) strip.push(sym); });
      for (let i = strip.length - 1; i > 0; i--) {
        const j = Math.floor(rnd() * (i + 1));
        [strip[i], strip[j]] = [strip[j], strip[i]];
      }
      // écarte les specials adjacents
      for (let pass = 0; pass < 20; pass++) {
        let moved = false;
        for (let i = 0; i < strip.length; i++) {
          const a = strip[i], b = strip[(i + 1) % strip.length];
          if ((a === SCATTER || a === WILD) && a === b) {
            const k = (i + 2 + Math.floor(rnd() * (strip.length - 3))) % strip.length;
            [strip[(i + 1) % strip.length], strip[k]] = [strip[k], strip[(i + 1) % strip.length]];
            moved = true;
          }
        }
        if (!moved) break;
      }
      return strip;
    });
  }

  const STRIPS_BASE = buildStrips(W_BASE, 1968);
  const STRIPS_FREE = buildStrips(W_FREE, 1789);

  // grid[reel][row]
  function drawGrid(strips, rng, forceScatters) {
    const grid = strips.map((strip) => {
      const stop = Math.floor(rng() * strip.length);
      return [0, 1, 2].map((r) => strip[(stop + r) % strip.length]);
    });
    if (forceScatters) {
      // Achat du bonus : on garantit au moins 3 barricades
      let count = countScatters(grid);
      const reels = [0, 1, 2, 3, 4].sort(() => rng() - 0.5);
      for (const r of reels) {
        if (count >= 3) break;
        if (!grid[r].includes(SCATTER)) { grid[r][Math.floor(rng() * 3)] = SCATTER; count++; }
      }
    }
    return grid;
  }

  function countScatters(grid) {
    let n = 0;
    grid.forEach((col) => col.forEach((s) => { if (s === SCATTER) n++; }));
    return n;
  }

  // Barricade : en Insurrection, chaque wild recouvre tout son rouleau
  function expandWilds(grid) {
    const expanded = [];
    const g = grid.map((col, r) => {
      if (col.includes(WILD)) { expanded.push(r); return [WILD, WILD, WILD]; }
      return col.slice();
    });
    return { grid: g, expanded };
  }

  function evalLines(grid) {
    const wins = [];
    let total = 0; // en × mise par ligne
    PAYLINES.forEach((line, li) => {
      const syms = line.map((row, reel) => grid[reel][row]);
      if (syms[0] === SCATTER) return;
      // meilleur entre "ligne de wilds pure" et "symbole + wilds"
      let wildRun = 0;
      while (wildRun < 5 && syms[wildRun] === WILD) wildRun++;
      const target = syms.find((s) => s !== WILD);
      let best = { sym: WILD, count: wildRun, pay: SYMBOLS[WILD].pays[wildRun] || 0 };
      if (target !== undefined && target !== SCATTER) {
        let c = 0;
        while (c < 5 && (syms[c] === target || syms[c] === WILD)) c++;
        const p = SYMBOLS[target].pays[c] || 0;
        if (p > best.pay) best = { sym: target, count: c, pay: p };
      }
      if (best.pay > 0) {
        wins.push({ line: li, sym: best.sym, count: best.count, pay: best.pay / LINES,
          cells: line.slice(0, best.count).map((row, reel) => [reel, row]) });
        total += best.pay;
      }
    });
    return { wins, total: total / LINES };
  }

  function scatterCells(grid) {
    const cells = [];
    grid.forEach((col, r) => col.forEach((s, row) => { if (s === SCATTER) cells.push([r, row]); }));
    return cells;
  }

  /**
   * Joue une partie complète.
   * mode : 'base' (mise normale) ou 'buy' (achat du bonus)
   * Renvoie { cost, totalWin, base, bonus|null } — tout en × mise.
   */
  function playRound(mode, rng) {
    rng = rng || Math.random;
    const buy = mode === 'buy';
    const grid = drawGrid(STRIPS_BASE, rng, buy);
    const lines = evalLines(grid);
    const scN = countScatters(grid);
    const scKey = Math.min(scN, 5);
    const scWin = scN >= 3 ? SCATTER_PAY[scKey] : 0;
    const base = {
      grid, wins: lines.wins, lineWin: lines.total, scatters: scN,
      scatterCells: scatterCells(grid), scatterWin: scWin,
      win: lines.total + scWin,
    };
    let totalWin = base.win;
    let bonus = null;

    if (scN >= 3) {
      bonus = { spinsAwarded: SCATTER_SPINS[scKey], spins: [], win: 0 };
      let left = bonus.spinsAwarded;
      let mult = 1; // compteur d'INFLATION
      while (left > 0) {
        left--;
        const raw = drawGrid(STRIPS_FREE, rng, false);
        const { grid: g, expanded } = expandWilds(raw);
        const ev = evalLines(g);
        const sN = countScatters(raw);
        const retrig = sN >= 3 ? RETRIGGER_SPINS : 0;
        left += retrig;
        const usedMult = mult;
        const win = ev.total * usedMult;
        if (ev.total > 0) mult += 1; // chaque tour gagnant fait grimper l'inflation
        bonus.spins.push({ raw, grid: g, expanded, wins: ev.wins, baseWin: ev.total,
          mult: usedMult, nextMult: mult, win, retrigger: retrig,
          scatterCells: scatterCells(raw), left });
        bonus.win += win;
        if (totalWin + bonus.win >= MAX_WIN) { bonus.capped = true; break; }
      }
      totalWin += bonus.win;
    }
    const capped = totalWin >= MAX_WIN;
    totalWin = Math.min(totalWin, MAX_WIN);
    return { mode, cost: buy ? BONUS_BUY_COST : 1, totalWin, capped, base, bonus };
  }

  const api = { SYMBOLS, PAYLINES, LINES, WILD, SCATTER, SCATTER_PAY, SCATTER_SPINS,
    RETRIGGER_SPINS, MAX_WIN, BONUS_BUY_COST, STRIPS_BASE, STRIPS_FREE, playRound };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RueMath = api;
})(typeof self !== 'undefined' ? self : this);
