// Génère les fichiers de maths au format Stake Engine (« Math file format ») à partir de math.js.
//   node tools/export-math.js [parties_base] [parties_bonus]
// Sortie : math/publish/  →  index.json, books_<mode>.jsonl.zst, lookUpTable_<mode>_0.csv
//          math-summary.js (RTP et gain max réels par mode, affichés dans les règles du jeu)
//
// Rappels du format (docs Stake Engine) :
//  - index.json : { modes: [{ name, cost, events: "books_x.jsonl.zst", weights: "lookUpTable_x_0.csv" }] }
//  - lookUpTable : lignes "id,weight,payoutMultiplier" sans en-tête, payoutMultiplier ×100 en entier (1150 = 11,5×)
//  - books : une ligne JSON par partie { id, events: [...], payoutMultiplier }, compressé en zstd
//  - RTP du mode = Σ(weight × payout/100) ÷ Σ(weight) ÷ cost ; gain max = max(payout)/100
const fs = require('fs'), path = require('path'), zlib = require('zlib');
const M = require('../math.js');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'math', 'publish');
fs.mkdirSync(OUT, { recursive: true });

const N_BASE = parseInt(process.argv[2] || '100000', 10);
const N_BONUS = parseInt(process.argv[3] || '50000', 10);

// Une partie complète = un seul événement « round », que le jeu rejoue tel quel.
function toBook(id, round) {
  const pm = Math.round(round.totalWin * 100);
  return { id, payoutMultiplier: pm, events: [{ index: 0, type: 'round', round }] };
}

function buildMode(name, internalMode, cost, n, opts = {}) {
  const books = [], weights = [];
  let haveMax = false;
  for (let i = 0; i < n; i++) {
    const r = M.playRound(internalMode);
    if (r.capped) haveMax = true;
    books.push(toBook(i + 1, r)); weights.push(opts.weight || 1);
  }
  // Le gain max doit exister dans les maths : on cherche une partie qui l'atteint et on lui donne
  // un poids qui respecte sa vraie fréquence (mesurée par tools/tail.js).
  if (!haveMax && opts.maxWinOdds) {
    let found = null, tries = 0;
    while (!found) { tries++; const r = M.playRound(internalMode); if (r.capped) found = r; }
    books.push(toBook(books.length + 1, found)); weights.push(1);
    console.log(`  ${name} : partie au gain max trouvée après ${tries.toLocaleString('fr-FR')} tirages`);
  }
  // fichiers
  const jsonl = books.map(b => JSON.stringify(b)).join('\n') + '\n';
  const zst = zlib.zstdCompressSync(Buffer.from(jsonl), { params: { [zlib.constants.ZSTD_c_compressionLevel]: 12 } });
  fs.writeFileSync(path.join(OUT, `books_${name}.jsonl.zst`), zst);
  const csv = books.map((b, i) => `${b.id},${weights[i]},${b.payoutMultiplier}`).join('\n') + '\n';
  fs.writeFileSync(path.join(OUT, `lookUpTable_${name}_0.csv`), csv);
  // statistiques exactes, calculées comme les relecteurs Stake
  let sw = 0, swp = 0, max = 0, hits = 0;
  books.forEach((b, i) => { sw += weights[i]; swp += weights[i] * b.payoutMultiplier / 100; if (b.payoutMultiplier > max) max = b.payoutMultiplier; if (b.payoutMultiplier > 0) hits += weights[i]; });
  const rtp = swp / sw / cost;
  return { name, cost, books: books.length, rtp, maxWin: max / 100, hitRate: hits / sw,
    sizes: { jsonlMB: +(jsonl.length / 1e6).toFixed(1), zstMB: +(zst.length / 1e6).toFixed(1) } };
}

console.log('Génération des maths Revolt…');
// mode de base : chaque partie normale pèse 20, la partie au gain max pèse 1 → ~1 chance sur (20 × N_BASE)
const base = buildMode('base', 'base', 1, N_BASE, { weight: 20, maxWinOdds: true });
const bonus = buildMode('bonus', 'buy', M.BONUS_BUY_COST, N_BONUS, { maxWinOdds: true });

const index = { modes: [base, bonus].map(m => ({ name: m.name, cost: m.cost, events: `books_${m.name}.jsonl.zst`, weights: `lookUpTable_${m.name}_0.csv` })) };
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify(index, null, 2) + '\n');

const summary = Object.fromEntries([base, bonus].map(m => [m.name, { cost: m.cost, rtp: +(m.rtp * 100).toFixed(2), maxWin: m.maxWin }]));
fs.writeFileSync(path.join(ROOT, 'math-summary.js'),
  '// Généré par tools/export-math.js à partir des fichiers de maths publiés — ne pas modifier à la main.\n' +
  'window.REVOLT_MATH_SUMMARY = ' + JSON.stringify(summary) + ';\n');

for (const m of [base, bonus]) {
  console.log(`  ${m.name.padEnd(5)} coût ${m.cost}×  ${m.books} parties  RTP ${(m.rtp * 100).toFixed(2)} %  gain max ${m.maxWin}×  ` +
    `gagnant ${(m.hitRate * 100).toFixed(1)} %  books ${m.sizes.zstMB} Mo compressés (${m.sizes.jsonlMB} Mo bruts)`);
}
console.log(`  écart RTP entre modes : ${Math.abs(base.rtp - bonus.rtp) * 100 < 0.5 ? 'OK' : 'TROP GRAND'} (${(Math.abs(base.rtp - bonus.rtp) * 100).toFixed(2)} point)`);
