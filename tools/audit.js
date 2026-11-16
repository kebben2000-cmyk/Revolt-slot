// Audit INDÉPENDANT des maths publiées :  node tools/audit.js
// N'utilise PAS le moteur (playRound) : il relit math/publish/ et recalcule chaque gain à partir des seules
// règles affichées (table des gains, lignes, scatter, multiplicateur, plafond), puis compare aux critères Stake.
// Sorties : docs/audit-maths.md (rapport) et docs/replays.md (numéros de parties à fournir à Stake pour les tests de replay).
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const ROOT = path.join(__dirname, '..'), PUB = path.join(ROOT, 'math', 'publish'), DOCS = path.join(ROOT, 'docs');
// seules les DONNÉES des règles (celles que le joueur lit dans le jeu) sont reprises ; aucune fonction du moteur
const { SYMBOLS, PAYLINES, LINES, WILD, SCATTER, EURO, SCATTER_PAY, SCATTER_SPINS, RETRIGGER_MIN, MAX_WIN, EURO_VALUES, MODES } = require('../math.js');
const COIN_VALUES = new Set(EURO_VALUES.map(([v]) => v));
const SAMPLE = 3000;

function lineWins(grid) { // grid[rouleau][rangée] ; gain en × la mise totale
  let total = 0;
  for (const line of PAYLINES) {
    const s = line.map((row, r) => grid[r][row]);
    if (s[0] === SCATTER) continue;
    let w = 0; while (w < 5 && s[w] === WILD) w++;
    let best = SYMBOLS[WILD].pays[w] || 0;
    const t = s.find(x => x !== WILD);
    if (t !== undefined && t !== SCATTER && t !== EURO) { let c = 0; while (c < 5 && (s[c] === t || s[c] === WILD)) c++; best = Math.max(best, SYMBOLS[t].pays[c] || 0); }
    total += best;
  }
  return total / LINES;
}
const scat = g => g.flat().filter(x => x === SCATTER).length;
const expand = g => g.map(col => (col.includes(WILD) ? [WILD, WILD, WILD] : col.slice()));

// Recalcule une partie depuis ses grilles. Renvoie { win, errors[] }.
function recompute(round, cfg) {
  const err = [];
  const b = round.base, n = scat(b.grid);
  let total = lineWins(b.grid) + (n >= 3 ? SCATTER_PAY[Math.min(n, 5)] : 0);
  if (n >= 3 && !round.bonus) err.push('3+ barricades sans bonus');
  if (round.bonus) {
    const B = round.bonus;
    if (n < 3) err.push('bonus sans 3 barricades');
    if (B.spinsAwarded !== SCATTER_SPINS[Math.min(n, 5)]) err.push('nombre de tours gratuits');
    let mult = cfg.startMult, left = B.spinsAwarded, played = 0;
    for (const s of B.spins) {
      played++; left--;
      const g = expand(s.raw);
      if (JSON.stringify(g) !== JSON.stringify(s.grid)) err.push('mégaphones mal étendus');
      const coins = s.euros.map(e => e[2]);
      if (coins.some(v => !COIN_VALUES.has(v))) err.push('valeur de pièce inconnue');
      mult += coins.reduce((a, v) => a + v, 0);
      if (mult !== s.mult) err.push(`multiplicateur ${s.mult} ≠ ${mult}`);
      const lw = lineWins(g); total += lw * mult;
      if (lw > 0) mult += 1;
      if (mult !== s.nextMult) err.push('multiplicateur suivant');
      const rt = scat(s.raw) >= RETRIGGER_MIN ? scat(s.raw) : 0;
      if (rt !== s.retrigger) err.push('relance');
      left += rt;
      if (total >= MAX_WIN) break;
    }
    if (total < MAX_WIN && left !== 0) err.push(`il reste ${left} tours non joués`);
    if (played !== B.spins.length) err.push('tours joués après le plafond');
  }
  return { win: Math.min(total, MAX_WIN), errors: err };
}

const index = JSON.parse(fs.readFileSync(path.join(PUB, 'index.json'), 'utf8'));
const report = ['# Audit indépendant des maths de Revolt', '', `Généré le ${new Date().toISOString().slice(0, 10)} par tools/audit.js (sans utiliser le moteur).`, ''];
const replays = ['# Numéros de parties pour les tests de replay', '', 'À fournir à Stake s\'ils les demandent (event = id du book).', '',
  '| Mode | Perte | Gain normal | Gros gain | Gain max | Déclenchement du bonus |', '|---|---|---|---|---|---|'];
const verdicts = []; let allOk = true;
const rtps = [];

for (const m of index.modes) {
  const cfg = MODES[m.name];
  const table = fs.readFileSync(path.join(PUB, m.weights), 'utf8').trim().split('\n').map(l => l.split(',').map(Number));
  const books = new Map();
  for (const l of zlib.zstdDecompressSync(fs.readFileSync(path.join(PUB, m.events))).toString('utf8').split('\n')) if (l) { const b = JSON.parse(l); books.set(b.id, b); }
  // 1. table de poids
  let W = 0, WP = 0, WP2 = 0, hits = 0, maxP = 0, pMax = 0, top = 0, zeroW = 0, ids = new Set(), mismatch = 0, featW = 0;
  const buckets = [0, 1, 2, 5, 10, 20, 50, 100, 500, 1000, 5000, 10000], bw = new Array(buckets.length + 1).fill(0);
  const tails = { 5000: 0, 10000: 0, 25000: 0 };
  for (const [id, w, p] of table) {
    ids.add(id); if (w <= 0) zeroW++;
    const x = p / 100; W += w; WP += w * x; WP2 += w * x * x; if (x > 0) hits += w; if (w > top) top = w;
    if (p > maxP) { maxP = p; pMax = 0; } if (p === maxP) pMax += w;
    const b = books.get(id); if (!b || b.payoutMultiplier !== p) mismatch++;
    if (b && b.events[0].round.bonus) featW += w;
    let k = 0; if (x > 0) { k = 1; while (k < buckets.length && x >= buckets[k]) k++; } bw[k] += w;
    for (const t in tails) if (x >= +t) tails[t] += w;
  }
  const rtp = WP / W / m.cost, mean = WP / W, sd = Math.sqrt(WP2 / W - mean * mean);
  rtps.push(rtp * 100);
  // 2. recalcul de parties tirées au hasard (+ toutes les parties au gain max)
  const all = [...books.values()], sample = [];
  for (let i = 0; i < SAMPLE; i++) sample.push(all[Math.floor(Math.random() * all.length)]);
  all.filter(b => b.payoutMultiplier === maxP).forEach(b => sample.push(b));
  let diff = 0, ruleErr = 0; const examples = [];
  for (const b of sample) {
    const r = recompute(b.events[0].round, cfg);
    if (Math.abs(Math.round(r.win * 100) - b.payoutMultiplier) > 1) { diff++; if (examples.length < 3) examples.push(`#${b.id} : fichier ${b.payoutMultiplier / 100}× ≠ recalcul ${r.win.toFixed(2)}×`); }
    if (r.errors.length) { ruleErr++; if (examples.length < 3) examples.push(`#${b.id} : ${r.errors.join(', ')}`); }
  }
  // 3. critères
  const checks = [
    ['RTP entre 96,0 % et 96,7 %', rtp >= 0.96 && rtp <= 0.967, `${(rtp * 100).toFixed(3)} %`],
    ['Gain max = 15 000× (annoncé dans les règles)', maxP / 100 === MAX_WIN, `${maxP / 100}×`],
    ['Gain max plus fréquent que 1 sur 10 M', W / pMax < 1e7, `1 sur ${Math.round(W / pMax).toLocaleString('fr-FR')}`],
    ['100 000 à 1 000 000 parties', table.length >= 100000 && table.length <= 1000000, table.length.toLocaleString('fr-FR')],
    ['Aucun poids nul, ids continus', zeroW === 0 && ids.size === table.length && [...ids].reduce((a, b) => Math.max(a, b), 0) === table.length, zeroW ? `${zeroW} poids nuls` : 'oui'],
    ['Table de poids = books', mismatch === 0, mismatch ? `${mismatch} écarts` : 'identiques'],
    ['Recalcul depuis les règles : zéro écart', diff === 0 && ruleErr === 0, `${sample.length} parties, ${diff} écarts de gain, ${ruleErr} écarts de règle`],
    ['Au moins 1 partie gagnante sur 50', hits / W >= 1 / 50, `1 sur ${(W / hits).toFixed(1)} (${(hits / W * 100).toFixed(1)} %)`],
    ['Aucune partie ultra-dominante', top / W < 0.5, `la plus probable : ${(top / W * 100).toFixed(4)} %`],
    // pas de trou : entre la plus petite et la plus grosse tranche de gain atteintes, aucune tranche vide
    (() => { const nz = bw.map((x, i) => (i > 0 && x > 0 ? i : -1)).filter(i => i > 0), lo = Math.min(...nz), hi = Math.max(...nz);
      const holes = bw.slice(lo, hi + 1).filter(x => x === 0).length;
      return ['Pas de trou dans les tranches de gains', holes === 0, holes ? `${holes} tranche(s) vide(s)` : 'aucun trou du plus petit au plus gros gain']; })(),
    ['Écart-type ≥ 0,6 (modes à 1×)', m.cost !== 1 || sd >= 0.6, sd.toFixed(1)],
    ['P(≥ 5 000×) ≤ 5 %', tails[5000] / W <= 0.05, `${(tails[5000] / W * 100).toFixed(4)} %`],
    ['P(≥ 10 000×) ≤ 1 %', tails[10000] / W <= 0.01, `${(tails[10000] / W * 100).toFixed(4)} %`],
    ['Prix ≤ 5 000×', m.cost <= 5000, `${m.cost}×`],
  ];
  const ok = checks.every(c => c[1]); allOk = allOk && ok;
  report.push(`## ${m.name} (coût ${m.cost}×)`, '', '| Critère | Résultat | Verdict |', '|---|---|---|', ...checks.map(([n, v, d]) => `| ${n} | ${d} | ${v ? '✓' : '✗'} |`), '');
  report.push(`En clair pour un joueur : une partie gagnante sur ${(W / hits).toFixed(1)}` + (featW ? `, un General Strike toutes les ${(W / featW).toFixed(0)} parties` : '') +
    `, gain moyen ${(mean).toFixed(2)}× la mise pour un prix de ${m.cost}×.`, '');
  const labels = ['0', ...buckets.map((x, i) => (i + 1 < buckets.length ? `${x}–${buckets[i + 1]}×` : `≥ ${x}×`))];
  report.push('| Tranche de gain | Probabilité |', '|---|---|', ...labels.map((l, i) => `| ${l} | ${(bw[i] / W * 100).toFixed(4)} % |`), '');
  if (examples.length) report.push('Exemples d\'écarts : ' + examples.join(' ; '), '');
  verdicts.push(`${ok ? '✓' : '✗'} ${m.name}`);
  // 4. numéros de replay
  const find = f => { for (const [id, , p] of table) if (f(p / 100, books.get(id))) return id; return '—'; };
  replays.push(`| ${m.name} | ${find(x => x === 0)} | ${find(x => x >= 1 && x < 5)} | ${find(x => x >= 100 && x < MAX_WIN)} | ${find(x => x === MAX_WIN)} | ${find((x, b) => b.events[0].round.bonus && x > 0 && x < MAX_WIN)} |`);
}
report.splice(4, 0, `**Verdict global : ${allOk ? 'tous les critères sont remplis ✓' : 'au moins un critère ✗'}** (${verdicts.join(' · ')}). Écart de RTP entre modes : ${(Math.max(...rtps) - Math.min(...rtps)).toFixed(3)} point.`, '');
fs.mkdirSync(DOCS, { recursive: true });
fs.writeFileSync(path.join(DOCS, 'audit-maths.md'), report.join('\n') + '\n');
fs.writeFileSync(path.join(DOCS, 'replays.md'), replays.join('\n') + '\n');
console.log(report.slice(0, 6).join('\n'));
console.log(verdicts.join('\n'));
console.log('→ docs/audit-maths.md et docs/replays.md');
process.exit(allOk ? 0 : 1);
