// Génère les fichiers de maths au format Stake Engine (« Math file format ») à partir de math.js.
//   node tools/export-math.js
// Sortie : math/publish/  →  index.json, books_<mode>.jsonl.zst, lookUpTable_<mode>_0.csv
//          math-summary.js (prix, RTP, gain max et fréquences par mode, affichés dans le jeu)
//
// Exigences Stake (docs « Math verification ») respectées ici :
//  - RTP de chaque mode entre 96,0 % et 96,7 %            → on vise TARGET = 96,30 %
//  - mode le moins cher à 1× ; au plus 20 modes ; gain max ≤ 1 000 000×
//  - gain max « réaliste » : plus fréquent que 1 sur 10 000 000
//  - 100 000 à 1 000 000 parties par mode, des gains intermédiaires sans trou jusqu'au gain max
//
// Méthode (même principe que l'optimiseur du Math SDK de Stake : la table de poids EST le jeu) :
//  1. Parties « normales » tirées au hasard, en strates : sans bonus / avec bonus (< 1 000×) / gros gains (≥ 1 000×).
//     Chaque strate pèse sa vraie probabilité, mesurée sur des millions de parties jouées.
//  2. La strate des gros gains vient d'une recherche parallèle (tous les cœurs) qui joue des millions de bonus.
//  3. Le gain max (15 000×) reçoit une fréquence choisie (MAX_ODDS), plus fréquente que 1 sur 10 M.
//  4. Réglage final du RTP : les poids des parties qui paient plus que la cible sont multipliés par λ (proche de 1).
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const M = require('../math.js');

const BIG = 1000;           // seuil de la strate « gros gains », en × mise
const TAIL_KEEP = 4000;     // nombre de gros gains gardés comme parties dans les fichiers

/* ---------- recherche des gros gains et du gain max (dans les workers) ---------- */
if (!isMainThread) {
  const { mode, natural, keep } = workerData;
  let bonuses = 0, big = 0, kept = 0, batch = [];
  for (;;) {
    let r;
    if (natural) { // jeu de base pur : on tire des grilles jusqu'à un vrai déclenchement, puis on joue la partie
      let g; do { g = M.drawGrid(M.STRIPS_BASE, Math.random, false); } while (M.countScatters(g) < 3);
      r = M.playRound('base', Math.random, { grid: g });
    } else { r = M.playRound(mode); if (!r.bonus) continue; }
    bonuses++;
    if (r.capped) parentPort.postMessage({ cap: r });
    else if (r.totalWin >= BIG) { big++; if (kept < keep) { kept++; batch.push(r); } }
    if (bonuses % 20000 === 0) { parentPort.postMessage({ bonuses, big, batch }); bonuses = 0; big = 0; batch = []; }
  }
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'math', 'publish');
const TARGET = 0.963;
const SCALE = 1e13; // somme des poids d'un mode (entiers)
// Fréquence voulue du gain max, par partie jouée dans le mode (toutes < 1 sur 10 M)
const MAX_ODDS = { base: 5e6, riot_hunt: 3e6, super_riot_hunt: 1.5e6, general_strike: 5e5, super_strike: 2e5 };
const N_BOOKS = { base: [100000, 30000], riot_hunt: [70000, 30000], super_riot_hunt: [70000, 30000], general_strike: [0, 100000], super_strike: [0, 100000] };

function toBook(id, round) {
  return { id, payoutMultiplier: Math.round(round.totalWin * 100), events: [{ index: 0, type: 'round', round }] };
}

// Joue des bonus en parallèle : mesure la part des gros gains, en garde un échantillon, et trouve un gain max.
function searchTail(mode, natural, minBonuses) {
  const n = Math.max(2, os.cpus().length - 1), keep = Math.ceil(TAIL_KEEP / n);
  return new Promise(resolve => {
    let tried = 0, big = 0, cap = null, done = false; const tail = [], workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(__filename, { workerData: { mode, natural, keep } });
      w.on('message', m => {
        if (done) return;
        if (m.cap) { if (!cap) cap = m.cap; }
        else { tried += m.bonuses; big += m.big; tail.push(...m.batch); }
        if (cap && tried >= minBonuses) { done = true; workers.forEach(x => x.terminate()); resolve({ cap, tail, pBig: big / tried, tried }); }
      });
      workers.push(w);
    }
  });
}

// Fréquence du bonus en jeu de base naturel (grilles seules : rapide)
function naturalTriggerRate(n) {
  let t = 0;
  for (let i = 0; i < n; i++) if (M.countScatters(M.drawGrid(M.STRIPS_BASE, Math.random, false)) >= 3) t++;
  return t / n;
}

function calibrate(books, weights, cost) {
  const p = books.map(b => b.payoutMultiplier / 100), t = TARGET * cost;
  let WL = 0, L = 0, WH = 0, H = 0;
  p.forEach((x, i) => { if (x > t) { WH += weights[i]; H += weights[i] * x; } else { WL += weights[i]; L += weights[i] * x; } });
  const lambda = (t * WL - L) / (H - t * WH);
  return { weights: weights.map((x, i) => Math.max(1, Math.round(p[i] > t ? x * lambda : x))), lambda };
}

function stats(books, weights, cost) {
  let sw = 0, swp = 0, swp2 = 0, max = 0, hits = 0, feat = 0, pMax = 0;
  books.forEach((b, i) => { const w = weights[i], x = b.payoutMultiplier / 100; sw += w; swp += w * x; swp2 += w * x * x;
    if (b.payoutMultiplier > max) max = b.payoutMultiplier; if (x > 0) hits += w; if (b.events[0].round.bonus) feat += w; });
  books.forEach((b, i) => { if (b.payoutMultiplier === max) pMax += weights[i]; });
  const mean = swp / sw;
  return { rtp: mean / cost, maxWin: max / 100, hitRate: hits / sw, bonusRate: feat / sw, maxOdds: sw / pMax, sd: Math.sqrt(swp2 / sw - mean * mean) };
}

function write(name, books, weights) {
  const jsonl = books.map(b => JSON.stringify(b)).join('\n') + '\n';
  const zst = zlib.zstdCompressSync(Buffer.from(jsonl), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 12 } });
  fs.writeFileSync(path.join(OUT, `books_${name}.jsonl.zst`), zst);
  fs.writeFileSync(path.join(OUT, `lookUpTable_${name}_0.csv`), books.map((b, i) => `${b.id},${weights[i]},${b.payoutMultiplier}`).join('\n') + '\n');
  return +(zst.length / 1e6).toFixed(1);
}

async function buildMode(name, pNat) {
  const cfg = M.MODES[name], [nPlain, nFeat] = N_BOOKS[name];
  const pFeat = cfg.force >= 1 ? 1 : cfg.force + (1 - cfg.force) * pNat; // probabilité réelle de bonus par partie
  // strates « sans bonus » et « bonus < BIG »
  const plain = [], feat = [];
  while (plain.length < nPlain || feat.length < nFeat) {
    const r = M.playRound(name);
    if (r.bonus) { if (feat.length < nFeat && !r.capped && r.totalWin < BIG) feat.push(r); }
    else if (plain.length < nPlain) plain.push(r);
  }
  // strate « gros gains » et gain max, mesurés sur ≥ 2 millions de bonus
  const t = await searchTail(name === 'base' ? 'base' : name, name === 'base', 2e6);
  const pMax = 1 / MAX_ODDS[name], pBig = pFeat * t.pBig;           // par partie jouée
  const pSmallFeat = pFeat - pBig - pMax;
  const books = [], weights = [];
  const add = (rs, w) => rs.forEach(r => { books.push(toBook(books.length + 1, r)); weights.push(w); });
  add(plain, (1 - pFeat) * SCALE / Math.max(1, plain.length));
  add(feat, pSmallFeat * SCALE / feat.length);
  add(t.tail, pBig * SCALE / t.tail.length);
  add([t.cap], pMax * SCALE);
  return { books, weights: weights.map(Math.round), pBig, tried: t.tried };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f)); // repart de zéro
  console.log('Génération des maths Revolt…');
  const pNat = naturalTriggerRate(20000000);
  console.log(`  bonus naturel : 1 partie sur ${(1 / pNat).toFixed(1)} (20 M grilles)`);
  const index = { modes: [] }, summary = {};
  for (const name of Object.keys(M.MODES)) {
    const cost = M.MODES[name].cost, t0 = Date.now();
    const { books, weights, pBig, tried } = await buildMode(name, pNat);
    const before = stats(books, weights, cost);
    const cal = calibrate(books, weights, cost);
    const st = stats(books, cal.weights, cost);
    const mb = write(name, books, cal.weights);
    index.modes.push({ name, cost, events: `books_${name}.jsonl.zst`, weights: `lookUpTable_${name}_0.csv` });
    summary[name] = { cost, rtp: +(st.rtp * 100).toFixed(2), maxWin: st.maxWin, bonusEvery: +(1 / st.bonusRate).toFixed(1),
      maxWinOdds: Math.round(st.maxOdds), hitRate: +(st.hitRate * 100).toFixed(1) };
    console.log(`  ${name.padEnd(10)} coût ${String(cost).padStart(3)}×  ${books.length} parties  RTP ${(before.rtp * 100).toFixed(2)} → ${(st.rtp * 100).toFixed(3)} % (λ ${cal.lambda.toFixed(3)})  ` +
      `max ${st.maxWin}× 1/${Math.round(st.maxOdds).toLocaleString('fr-FR')}  ≥${BIG}× 1/${Math.round(1 / pBig).toLocaleString('fr-FR')}  ` +
      `bonus 1/${(1 / st.bonusRate).toFixed(1)}  gagnant ${(st.hitRate * 100).toFixed(1)} %  écart-type ${(st.sd / cost).toFixed(1)}  ` +
      `${tried.toLocaleString('fr-FR')} bonus joués  ${mb} Mo  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'math-summary.js'),
    '// Généré par tools/export-math.js à partir des fichiers de maths publiés — ne pas modifier à la main.\n' +
    'window.REVOLT_MATH_SUMMARY = ' + JSON.stringify(summary) + ';\n');
  const r = Object.values(summary).map(m => m.rtp);
  console.log(`  RTP de ${Math.min(...r)} % à ${Math.max(...r)} % (exigé : 96,0 – 96,7 %)`);
  process.exit(0);
})();
