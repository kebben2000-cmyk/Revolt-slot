// Détoure toutes les images d'une vidéo de mascotte avec le MÊME cadrage (pas de tremblement).
//   node tools/detourer-video.js <dossier_images_source> <dossier_sortie> [hauteur_finale=549]
// Version 2 (corrige le mégaphone qui clignotait et le trait noir à gauche) :
//  - le cadre dessiné autour de la vidéo source (colonnes 18-21, 745-747, lignes 996-997) est entièrement ignoré (MARGIN 24) ;
//  - avant de remplir le fond, on « colmate » les micro-coupures du contour noir (fermeture de 3 px) : le remplissage
//    ne peut plus entrer dans le cône blanc du mégaphone par une coupure due à la compression vidéo ;
//  - lissage temporel : un pixel n'est retiré que s'il est aussi du fond dans l'image précédente OU suivante
//    (plus de zone qui disparaît sur une seule image).
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const [, , IN, OUT, HEIGHT = '549'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(IN).filter(f => f.endsWith('.png')).sort();
const MARGIN = 24, SEAL = 3;

function dilate(mask, w, h, r) { // carré de rayon r, en deux passes séparables
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) { let run = -1e9; for (let x = 0; x < w; x++) { if (mask[y * w + x]) run = x; tmp[y * w + x] = x - run <= r ? 1 : 0; }
    run = 1e9; for (let x = w - 1; x >= 0; x--) { if (mask[y * w + x]) run = x; if (run - x <= r) tmp[y * w + x] = 1; } }
  for (let x = 0; x < w; x++) { let run = -1e9; for (let y = 0; y < h; y++) { if (tmp[y * w + x]) run = y; out[y * w + x] = y - run <= r ? 1 : 0; }
    run = 1e9; for (let y = h - 1; y >= 0; y--) { if (tmp[y * w + x]) run = y; if (run - y <= r) out[y * w + x] = 1; } }
  return out;
}

function bgMask(data, w, h) {
  const n = w * h;
  const isBgCol = i => { const r = data[i*3], g = data[i*3+1], b = data[i*3+2]; const mn = Math.min(r, g, b), mx = Math.max(r, g, b); return mx > 100 && mx - mn < 28; };
  const inMargin = i => { const x = i % w, y = (i / w) | 0; return x < MARGIN || y < MARGIN || x >= w - MARGIN || y >= h - MARGIN - 6; }; // bas : le cadre est aux lignes 996-997
  const flood = (canPass) => {
    const bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) if (inMargin(i)) { bg[i] = 1; q[qt++] = i; }
    while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0;
      for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1])
        if (k >= 0 && !bg[k] && canPass(k)) { bg[k] = 1; q[qt++] = k; } }
    return bg;
  };
  // 1. remplissage simple, pour connaître la silhouette brute
  const bg1 = flood(isBgCol);
  // 2. on épaissit la silhouette de SEAL px : les micro-coupures du contour sont bouchées
  const fg1 = new Uint8Array(n); for (let i = 0; i < n; i++) fg1[i] = bg1[i] ? 0 : 1;
  const sealed = dilate(fg1, w, h, SEAL);
  // 3. nouveau remplissage qui ne passe pas à travers la silhouette épaissie
  const bg2 = flood(i => !sealed[i] && isBgCol(i));
  // 4. on rend au fond la bande de SEAL px autour (contours précis), mais seulement là où c'était déjà du fond
  const grow = dilate(bg2, w, h, SEAL);
  const bg = new Uint8Array(n);
  for (let i = 0; i < n; i++) bg[i] = inMargin(i) || bg2[i] || (grow[i] && bg1[i]) ? 1 : 0;
  // 5. trous de fond enfermés entre la tête et le poing levé (en haut à droite) : vrais trous, on les vide
  const seen = new Uint8Array(n), q = new Int32Array(n);
  for (let i = 0; i < n; i++) if (!bg[i] && !seen[i] && isBgCol(i)) {
    const comp = []; let sx = 0, sy = 0, qh = 0, qt = 0; q[qt++] = i; seen[i] = 1;
    while (qh < qt) { const j = q[qh++]; comp.push(j); sx += j % w; sy += (j / w) | 0; const x = j % w, y = (j / w) | 0;
      for (const k of [x > 0 ? j-1 : -1, x < w-1 ? j+1 : -1, y > 0 ? j-w : -1, y < h-1 ? j+w : -1])
        if (k >= 0 && !bg[k] && !seen[k] && isBgCol(k)) { seen[k] = 1; q[qt++] = k; } }
    const cx = sx / comp.length / w, cy = sy / comp.length / h;
    if (comp.length > 300 && cx > .6 && cy < .4) comp.forEach(j => bg[j] = 1);
  }
  return bg;
}

function finish(data, bg, w, h) {
  const n = w * h, rgba = Buffer.alloc(n * 4), q = new Int32Array(n);
  // liseré clair restant
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    for (let i = 0; i < n; i++) if (!bg[i]) { const x = i % w, y = (i / w) | 0;
      const near = (x > 0 && bg[i-1]) || (x < w-1 && bg[i+1]) || (y > 0 && bg[i-w]) || (y < h-1 && bg[i+w]);
      if (near && Math.min(data[i*3], data[i*3+1], data[i*3+2]) > 190) kill.push(i); }
    kill.forEach(i => bg[i] = 1);
  }
  // on ne garde que le personnage (plus gros morceau + gros morceaux)
  const lab = new Int32Array(n).fill(-1), sizes = [];
  for (let i = 0; i < n; i++) if (!bg[i] && lab[i] < 0) {
    const id = sizes.length; let cnt = 0, qh = 0, qt = 0; q[qt++] = i; lab[i] = id;
    while (qh < qt) { const j = q[qh++]; cnt++; const x = j % w, y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (!bg[k] && lab[k] < 0) { lab[k] = id; q[qt++] = k; } } }
    sizes.push(cnt);
  }
  const big = Math.max(...sizes); let bb = [w, h, 0, 0];
  for (let i = 0; i < n; i++) {
    rgba[i*4] = data[i*3]; rgba[i*4+1] = data[i*3+1]; rgba[i*4+2] = data[i*3+2]; rgba[i*4+3] = 255;
    if (bg[i] || sizes[lab[i]] < big * .06) { rgba[i*4+3] = 0; continue; }
    const x = i % w, y = (i / w) | 0;
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    const near = (x > 0 && bg[i-1]) || (x < w-1 && bg[i+1]) || (y > 0 && bg[i-w]) || (y < h-1 && bg[i+w]);
    if (near) rgba[i*4+3] = 160; // bord adouci
  }
  return { rgba, bb };
}

(async () => {
  const frames = []; let W = 0, H = 0;
  for (const f of files) { const { data, info } = await sharp(path.join(IN, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true }); W = info.width; H = info.height; frames.push(data); }
  const masks = frames.map(d => bgMask(d, W, H));
  // lissage temporel : fond seulement si c'est aussi du fond dans une image voisine
  const smooth = masks.map((m, k) => { const p = masks[Math.max(0, k - 1)], nx = masks[Math.min(masks.length - 1, k + 1)];
    const out = new Uint8Array(m.length); for (let i = 0; i < m.length; i++) out[i] = m[i] && (p[i] || nx[i]) ? 1 : 0; return out; });
  const cut = []; let U = [Infinity, Infinity, 0, 0];
  for (let k = 0; k < frames.length; k++) { const { rgba, bb } = finish(frames[k], smooth[k], W, H); cut.push(rgba);
    U = [Math.min(U[0], bb[0]), Math.min(U[1], bb[1]), Math.max(U[2], bb[2]), Math.max(U[3], bb[3])]; }
  // cadrage commun à toutes les images, pieds en bas
  const left = Math.max(0, U[0] - 4), top = Math.max(0, U[1] - 4);
  const cw = Math.min(W - left, U[2] - left + 5), ch = Math.min(H - top, U[3] - top + 2);
  const outH = parseInt(HEIGHT, 10), outW = Math.round(cw * outH / ch / 2) * 2;
  for (let k = 0; k < cut.length; k++)
    await sharp(cut[k], { raw: { width: W, height: H, channels: 4 } }).extract({ left, top, width: cw, height: ch }).resize(outW, outH).png()
      .toFile(path.join(OUT, 'c' + String(k + 1).padStart(3, '0') + '.png'));
  console.log(JSON.stringify({ frames: cut.length, crop: [left, top, cw, ch], out: [outW, outH] }));
})();
