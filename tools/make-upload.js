// Prépare le dossier à déposer sur Stake Engine :  node tools/make-upload.js
//   stake-upload/front/  → le jeu (fichiers statiques uniquement : ce que les joueurs téléchargent)
//   stake-upload/math/   → les fichiers de maths (index.json, books, lookUpTables)
//   stake-upload/tile/   → images pour l'éditeur de vignette de Stake Studio (fond lumineux + mascotte détourée)
// Les originaux (assets/source), les outils et les fichiers inutilisés ne sont PAS copiés.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'stake-upload');

const FRONT_FILES = ['index.html', 'math.js', 'math-summary.js', 'rgs.js', 'sound.js'];
const SKIP = [/^assets[\\/]source([\\/]|$)/, /chat-anime\.webp$/, /\.DS_Store$/, /Thumbs\.db$/];

function copyDir(src, dst, rel = '') {
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const r = path.join(rel, e.name);
    if (SKIP.some(re => re.test(r))) continue;
    const s = path.join(src, e.name), d = path.join(dst, e.name);
    if (e.isDirectory()) { fs.mkdirSync(d, { recursive: true }); copyDir(s, d, r); }
    else fs.copyFileSync(s, d);
  }
}
function size(dir) {
  let n = 0, files = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { const s = size(p); n += s.n; files += s.files; } else { n += fs.statSync(p).size; files++; }
  }
  return { n, files };
}

fs.rmSync(OUT, { recursive: true, force: true });
const front = path.join(OUT, 'front'), math = path.join(OUT, 'math'), tile = path.join(OUT, 'tile');
[front, math, tile].forEach(d => fs.mkdirSync(d, { recursive: true }));

// 1. le jeu
for (const f of FRONT_FILES) fs.copyFileSync(path.join(ROOT, f), path.join(front, f));
fs.mkdirSync(path.join(front, 'assets'));
copyDir(path.join(ROOT, 'assets'), path.join(front, 'assets'), 'assets');
// garde-fou : aucune ressource externe (exigence Stake : fichiers statiques uniquement)
for (const f of FRONT_FILES) {
  const txt = fs.readFileSync(path.join(front, f), 'utf8').replace(/^\s*(\/\/|\*|\/\*).*$/gm, '');
  const ext = txt.match(/["'(]https?:\/\/[^"')\s]+/g);
  if (ext) { console.error(`ERREUR : ${f} charge une ressource externe : ${ext.join(', ')}`); process.exit(1); }
}

// 2. les maths
const pub = path.join(ROOT, 'math', 'publish');
const index = JSON.parse(fs.readFileSync(path.join(pub, 'index.json'), 'utf8'));
fs.copyFileSync(path.join(pub, 'index.json'), path.join(math, 'index.json'));
for (const m of index.modes) for (const f of [m.events, m.weights]) fs.copyFileSync(path.join(pub, f), path.join(math, f));

// 3. la vignette : fond éclairci (Stake demande une vignette lumineuse) + mascotte détourée
(async () => {
  let sharp = null;
  try { sharp = require('sharp'); } catch (e) { try { sharp = require(process.env.SHARP_PATH); } catch (e2) { /* pas de sharp */ } }
  const bgSrc = path.join(ROOT, 'assets', 'source', 'fond-paris-v3-nuit.jpg');
  if (sharp && fs.existsSync(bgSrc)) {
    await sharp(bgSrc).modulate({ brightness: 1.55, saturation: 1.15 }).gamma(1.3).jpeg({ quality: 90 }).toFile(path.join(tile, 'background.jpg'));
  } else fs.copyFileSync(path.join(ROOT, 'assets', 'bg.jpg'), path.join(tile, 'background.jpg'));
  fs.copyFileSync(path.join(ROOT, 'assets', 'mascot', 'chat.png'), path.join(tile, 'foreground.png'));

  const mb = d => (size(d).n / 1e6).toFixed(1);
  console.log(`stake-upload prêt :`);
  console.log(`  front/  ${size(front).files} fichiers, ${mb(front)} Mo  → Studio : nouvelle version « front »`);
  console.log(`  math/   ${size(math).files} fichiers, ${mb(math)} Mo  → Studio : nouvelle version « math » (modes : ${index.modes.map(m => m.name).join(', ')})`);
  console.log(`  tile/   background.jpg + foreground.png → Studio : Media › Create tile (3:4 et 16:9)`);
})();
