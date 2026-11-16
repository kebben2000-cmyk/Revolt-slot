// Génère les fichiers de maths au format Stake Engine (« Math file format ») à partir de math.js.
//   node tools/export-math.js
// Sortie : math/publish/  →  index.json, books_<mode>.jsonl.zst, lookUpTable_<mode>_0.csv
//          math-summary.js (prix, RTP, gain max et fréquence du bonus par mode, affichés dans le jeu)
//
// Format (docs Stake Engine) :
//  - index.json : { modes: [{ name, cost, events: "books_x.jsonl.zst", weights: "lookUpTable_x_0.csv" }] }
//  - lookUpTable : lignes "id,weight,payoutMultiplier" sans en-tête, payoutMultiplier ×100 en entier
//  - books : une ligne JSON par partie { id, events: [...], payoutMultiplier }, compressé en zstd
//  - RTP du mode = Σ(weight × payout/100) ÷ Σ(weight) ÷ cost
//
// Méthode :
//  1. Modes avec jeu de base (base, hunt, superhunt) : « stratifiés ». On garde N parties sans bonus et
//     K parties avec bonus, chaque groupe pesant sa vraie fréquence. Sinon ~500 bonus sur 100 000 parties
//     feraient varier le RTP de plusieurs points d'un tirage à l'autre.
//  2. Chaque mode contient une partie au gain max (15 000×), cherchée en parallèle sur tous les cœurs,
//     avec un poids égal à sa fréquence mesurée pendant la recherche.
//  3. Réglage final du RTP à TARGET (comme l'optimiseur du Math SDK de Stake) : les poids des parties
//     qui paient plus que la cible sont multipliés par un même facteur λ, proche de 1.
const fs = require('fs'), path = require('path'), zlib = require('zlib'), os = require('os');
const { Worker, isMainThread, parentPort, workerData } = require('worker_threads');
const M = require('../math.js');

/* ---------- recherche du gain max (dans les workers) ---------- */
if (!isMainThread) {
  const { mode, natural } = workerData;
  let bonuses = 0;
  for (;;) {
    let r;
    if (natural) { // jeu de base : on tire des grilles jusqu'à un vrai déclenchement, puis on joue la partie
      let g; do { g = M.drawGrid(M.STRIPS_BASE, Math.random, false); } while (M.countScatters(g) < 3);
      r = M.playRound('base', Math.random, { grid: g });
    } else r = M.playRound(mode);
    bonuses++;
    if (r.capped) { parentPort.postMessage({ round: r, bonuses }); bonuses = 0; }
    else if (bonuses % 50000 === 0) { parentPort.postMessage({ bonuses }); bonuses = 0; }
  }
}

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'math', 'publish');
const TARGET = 0.96;
const SCALE = 1e12; // somme des poids d'un mode (entiers)

function toBook(id, round) {
  return { id, payoutMultiplier: Math.round(round.totalWin * 100), events: [{ index: 0, type: 'round', round }] };
}

// Cherche une partie au gain max ; renvoie la partie et la fréquence mesurée (par bonus joué)
function findMaxWin(mode, natural) {
  const n = Math.max(2, os.cpus().length - 1);
  return new Promise(resolve => {
    let tried = 0, done = false; const workers = [];
    for (let i = 0; i < n; i++) {
      const w = new Worker(__filename, { workerData: { mode, natural } });
      w.on('message', m => {
        tried += m.bonuses;
        if (m.round && !done) { done = true; workers.forEach(x => x.terminate()); resolve({ round: m.round, perBonus: 1 / tried, tried }); }
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
  const w = weights.map((x, i) => Math.max(1, Math.round(p[i] > t ? x * lambda : x)));
  return { weights: w, lambda };
}

function stats(books, weights, cost) {
  let sw = 0, swp = 0, max = 0, hits = 0, feat = 0;
  books.forEach((b, i) => { const w = weights[i]; sw += w; swp += w * b.payoutMultiplier / 100;
    if (b.payoutMultiplier > max) max = b.payoutMultiplier; if (b.payoutMultiplier > 0) hits += w;
    if (b.events[0].round.bonus) feat += w; });
  return { rtp: swp / sw / cost, maxWin: max / 100, hitRate: hits / sw, bonusRate: feat / sw };
}

function write(name, cost, books, weights) {
  const jsonl = books.map(b => JSON.stringify(b)).join('\n') + '\n';
  const zst = zlib.zstdCompressSync(Buffer.from(jsonl), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 12 } });
  fs.writeFileSync(path.join(OUT, `books_${name}.jsonl.zst`), zst);
  fs.writeFileSync(path.join(OUT, `lookUpTable_${name}_0.csv`), books.map((b, i) => `${b.id},${weights[i]},${b.payoutMultiplier}`).join('\n') + '\n');
  return +(zst.length / 1e6).toFixed(1);
}

async function buildBaseLike(name, N, K, pNat) {
  const cfg = M.MODES[name];
  const pFeat = cfg.force + (1 - cfg.force) * pNat; // probabilité réelle de déclencher le bonus
  const plain = [], feat = [];
  while (plain.length < N || feat.length < K) {
    const r = M.playRound(name);
    if (r.bonus) { if (feat.length < K) feat.push(r); } else if (plain.length < N) plain.push(r);
  }
  const books = [], weights = [];
  const wPlain = (1 - pFeat) * SCALE / N, wFeat = pFeat * SCALE / K;
  plain.forEach(r => { books.push(toBook(books.length + 1, r)); weights.push(wPlain); });
  feat.forEach(r => { books.push(toBook(books.length + 1, r)); weights.push(wFeat); });
  // gain max : en jeu de base pur, déclenchement naturel uniquement ; dans les « hunt », bonus forcé (le plus fréquent)
  const mw = await findMaxWin(name === 'base' ? 'base' : 'bonus', name === 'base');
  const pMax = pFeat * mw.perBonus;
  books.push(toBook(books.length + 1, mw.round)); weights.push(pMax * SCALE);
  return { books, weights, pFeat, pMax, tried: mw.tried };
}

async function buildBuy(name, N) {
  const books = [], weights = [];
  for (let i = 0; i < N; i++) { const r = M.playRound(name); if (!r.capped) { books.push(toBook(books.length + 1, r)); weights.push(1); } }
  const mw = await findMaxWin(name, false);
  const per = SCALE / books.length;
  for (let i = 0; i < weights.length; i++) weights[i] = per * (1 - mw.perBonus);
  books.push(toBook(books.length + 1, mw.round)); weights.push(mw.perBonus * SCALE);
  return { books, weights, pFeat: 1, pMax: mw.perBonus, tried: mw.tried };
}

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) fs.unlinkSync(path.join(OUT, f)); // repart de zéro (anciens modes compris)
  console.log('Génération des maths Revolt…');
  const pNat = naturalTriggerRate(20000000);
  console.log(`  bonus naturel : 1 partie sur ${(1 / pNat).toFixed(1)} (20 M grilles)`);
  const plan = [
    ['base', () => buildBaseLike('base', 100000, 30000, pNat)],
    ['hunt', () => buildBaseLike('hunt', 60000, 30000, pNat)],
    ['superhunt', () => buildBaseLike('superhunt', 30000, 30000, pNat)],
    ['bonus', () => buildBuy('bonus', 50000)],
    ['superbonus', () => buildBuy('superbonus', 50000)],
  ];
  const index = { modes: [] }, summary = {};
  for (const [name, build] of plan) {
    const cost = M.MODES[name].cost;
    const t0 = Date.now();
    const { books, weights, pFeat, pMax, tried } = await build();
    const before = stats(books, weights, cost);
    const cal = calibrate(books, weights.map(w => Math.round(w)), cost);
    const st = stats(books, cal.weights, cost);
    const mb = write(name, cost, books, cal.weights);
    index.modes.push({ name, cost, events: `books_${name}.jsonl.zst`, weights: `lookUpTable_${name}_0.csv` });
    summary[name] = { cost, rtp: +(st.rtp * 100).toFixed(2), maxWin: st.maxWin, bonusEvery: +(1 / pFeat).toFixed(1), maxWinOdds: Math.round(1 / pMax) };
    console.log(`  ${name.padEnd(10)} coût ${String(cost).padStart(3)}×  ${books.length} parties  RTP brut ${(before.rtp * 100).toFixed(2)} % → ${(st.rtp * 100).toFixed(2)} % (λ ${cal.lambda.toFixed(3)})  ` +
      `gain max ${st.maxWin}× (≈1 sur ${Math.round(1 / pMax).toLocaleString('fr-FR')}, ${tried.toLocaleString('fr-FR')} bonus pour le trouver)  ` +
      `bonus 1 sur ${(1 / pFeat).toFixed(1)}  ${mb} Mo  ${((Date.now() - t0) / 1000).toFixed(0)} s`);
  }
  fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');
  fs.writeFileSync(path.join(ROOT, 'math-summary.js'),
    '// Généré par tools/export-math.js à partir des fichiers de maths publiés — ne pas modifier à la main.\n' +
    'window.REVOLT_MATH_SUMMARY = ' + JSON.stringify(summary) + ';\n');
  const r = Object.values(summary).map(m => m.rtp);
  console.log(`  écart de RTP entre modes : ${(Math.max(...r) - Math.min(...r)).toFixed(2)} point`);
  process.exit(0);
})();
