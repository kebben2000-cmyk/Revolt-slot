// Prépare le dossier à déposer sur Stake Engine :  node tools/make-upload.js
//   stake-upload/front/  → le jeu (fichiers statiques uniquement : ce que les joueurs téléchargent)
//   stake-upload/math/   → les fichiers de maths (index.json, books, lookUpTables)
//   stake-upload/tile/   → images pour l'éditeur de vignette de Stake Studio (fond lumineux + mascotte détourée)
// Les originaux (assets/source), les outils et les fichiers inutilisés ne sont PAS copiés.
const fs = require('fs'), path = require('path');
const ROOT = path.join(__dirname, '..'), OUT = path.join(ROOT, 'stake-upload');

const FRONT_FILES = ['index.html', 'math.js', 'math-summary.js', 'rgs.js', 'sound.js'];
// symboles et mascotte en PNG pleine qualité ; les originaux (assets/source) et les symboles abandonnés ne partent pas chez Stake
const SKIP = [/^assets[\\/]source([\\/]|$)/, /chat-anime\.webp$/, /(fumigene|poubelle-verte)\.(png|webp)$/,
  /\.DS_Store$/, /Thumbs\.db$/, /desktop\.ini$/];

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
    await sharp(bgSrc).modulate({ brightness: 1.55, saturation: 1.15 }).gamma(1.3).jpeg({ quality: 90 }).toFile(path.join(tile, 'Revolt-BG.jpg'));
    // logo du studio : une seule couleur, blanc, sans fond (à déposer une fois dans les réglages de l'équipe)
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="300"><text x="600" y="215" text-anchor="middle" font-family="Impact, Arial Black, sans-serif" font-size="210" letter-spacing="6" fill="#ffffff">DEADBEATS</text></svg>';
    await sharp(Buffer.from(svg)).png().toFile(path.join(tile, 'deadbeats-Logo.png'));
  } else fs.copyFileSync(path.join(ROOT, 'assets', 'bg.jpg'), path.join(tile, 'Revolt-BG.jpg'));
  fs.copyFileSync(path.join(ROOT, 'assets', 'mascot', 'chat.png'), path.join(tile, 'Revolt-FG.png'));
  // fiche d'envoi : description, modes, numéros de replay, version
  const sum = JSON.parse(fs.readFileSync(path.join(ROOT, 'math-summary.js'), 'utf8').match(/=\s*(\{.*\});/)[1]);
  const version = (fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').match(/const VERSION = '([^']+)'/) || [])[1];
  const replays = fs.existsSync(path.join(ROOT, 'docs', 'replays.md')) ? fs.readFileSync(path.join(ROOT, 'docs', 'replays.md'), 'utf8').split('\n').filter(l => l.startsWith('|')).join('\n') : '(lancer node tools/audit.js)';
  const names = { base: 'Base game', riot_hunt: 'Riot Hunt', super_riot_hunt: 'Super Riot Hunt', general_strike: 'General Strike', super_strike: 'Super Strike' };
  fs.writeFileSync(path.join(OUT, 'ENVOI.md'), [
    "# Revolt — fiche d'envoi Stake Engine", '', `Version du front : ${version}`, '',
    '## Description (à coller dans le formulaire, en anglais — sans mot interdit en mode social)', '',
    'Prices keep climbing, wages stay frozen, and Paris takes to the streets. Revolt is a 5×3, 20-line slot set on a burning night of protest. ' +
    'The Megaphone Wild lands on reels 2 to 4. Three or more Barricades start the General Strike: 10, 12 or 15 free spins where every Megaphone takes over its whole reel ' +
    'and Golden Coins add +1 to +50 to a multiplier that never goes down and grows after every winning spin. Two or more Barricades during the feature add extra spins. ' +
    'Riot Hunt modes make the General Strike up to 25 times more frequent, the Super Strike starts the feature at ×10, and the top win is 15,000× the play amount.', '',
    '## Modes', '', '| Mode (nom dans les maths) | Nom affiché | Coût | RTP | Gain max | Gain max ≈ 1 partie sur |', '|---|---|---|---|---|---|',
    ...Object.entries(sum).map(([k, m]) => `| ${k} | ${names[k] || k} | ${m.cost}× | ${m.rtp.toFixed(2)} % | ${m.maxWin.toLocaleString('en-US')}× | ${(m.maxWinOdds || 0).toLocaleString('fr-FR')} |`), '',
    '## Numéros de replay (si Stake les demande)', '', replays, '',
    '## Étapes dans Stake Studio', '',
    '1. Math : nouvelle version → déposer le contenu de math/ → publier.',
    '2. Front : nouvelle version → déposer le contenu de front/ (index.html à la racine) → publier.',
    '3. Media › Create tile : fond = tile/Revolt-BG.jpg, premier plan = tile/Revolt-FG.png, en 3:4 ET en 16:9. Logo du studio (blanc, sans fond) dans les réglages de l\'équipe : tile/deadbeats-Logo.png.',
    '4. Lancer le jeu depuis Studio : jouer chaque mode, tester le mode social (interrupteur Social Mode), un replay.',
    '5. Demander la validation avec la description ci-dessus.', ''].join('\n'));

  const mb = d => (size(d).n / 1e6).toFixed(1);
  console.log(`stake-upload prêt :`);
  console.log(`  front/  ${size(front).files} fichiers, ${mb(front)} Mo  → Studio : nouvelle version « front »`);
  console.log(`  math/   ${size(math).files} fichiers, ${mb(math)} Mo  → Studio : nouvelle version « math » (modes : ${index.modes.map(m => m.name).join(', ')})`);
  console.log(`  tile/   Revolt-BG.jpg + Revolt-FG.png (+ deadbeats-Logo.png) → Studio : Media › Create tile (3:4 et 16:9)`);
  console.log(`  ENVOI.md : description en anglais, modes, numéros de replay, étapes`);
})();
