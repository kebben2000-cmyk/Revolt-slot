// Détoure toutes les images d'une vidéo avec le MÊME cadrage (pas de tremblement).
// node batch-cut.js <dossier_images> <dossier_sortie> <hauteur_finale>
const sharp = require('sharp'), fs = require('fs'), path = require('path');
const [, , IN, OUT, HEIGHT = '640'] = process.argv;
fs.mkdirSync(OUT, { recursive: true });
const files = fs.readdirSync(IN).filter(f => f.endsWith('.png')).sort();
const MARGIN = 18; // on ignore le cadre dessiné autour de la vidéo

function cutFrame(data, w, h) {
  const n = w * h, rgba = Buffer.alloc(n * 4);
  for (let i = 0; i < n; i++) { rgba[i*4] = data[i*3]; rgba[i*4+1] = data[i*3+1]; rgba[i*4+2] = data[i*3+2]; rgba[i*4+3] = 255; }
  // fond = gris / blanc peu saturé (le contour noir du dessin arrête le remplissage)
  const isBg = i => { const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2]; const mn = Math.min(r, g, b), mx = Math.max(r, g, b); return mx > 100 && mx - mn < 28; };
  const bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
  const push = i => { if (!bg[i] && isBg(i)) { bg[i] = 1; q[qt++] = i; } };
  // tout ce qui est dans la marge (cadre de la vidéo) est du fond
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (x < MARGIN || y < MARGIN || x >= w - MARGIN || y >= h - MARGIN) { const i = y * w + x; if (!bg[i]) { bg[i] = 1; q[qt++] = i; } }
  while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0;
    if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
  // trous de fond enfermés entre la tête et le poing levé (côté droit, en haut) — les yeux sont au centre, on n'y touche pas
  const seen = new Uint8Array(n);
  for (let i = 0; i < n; i++) if (!bg[i] && !seen[i] && isBg(i)) {
    const comp = []; let sx = 0, sy = 0; qh = qt = 0; q[qt++] = i; seen[i] = 1;
    while (qh < qt) { const j = q[qh++]; comp.push(j); sx += j % w; sy += (j / w) | 0; const x = j % w, y = (j / w) | 0;
      for (const k of [x > 0 ? j-1 : -1, x < w-1 ? j+1 : -1, y > 0 ? j-w : -1, y < h-1 ? j+w : -1])
        if (k >= 0 && !bg[k] && !seen[k] && isBg(k)) { seen[k] = 1; q[qt++] = k; } }
    const cx = sx / comp.length / w, cy = sy / comp.length / h;
    if (comp.length > 300 && cx > .6 && cy < .4) comp.forEach(j => bg[j] = 1);
  }
  // retire le liseré clair restant
  for (let pass = 0; pass < 2; pass++) {
    const kill = [];
    for (let i = 0; i < n; i++) if (!bg[i]) {
      const x = i % w, y = (i / w) | 0;
      const near = (x > 0 && bg[i-1]) || (x < w-1 && bg[i+1]) || (y > 0 && bg[i-w]) || (y < h-1 && bg[i+w]);
      if (near && Math.min(rgba[i*4], rgba[i*4+1], rgba[i*4+2]) > 190) kill.push(i);
    }
    kill.forEach(i => bg[i] = 1);
  }
  // ne garde que le personnage (plus gros morceau + gros morceaux)
  const lab = new Int32Array(n).fill(-1), sizes = [];
  for (let i = 0; i < n; i++) if (!bg[i] && lab[i] < 0) {
    const id = sizes.length; let cnt = 0; qh = qt = 0; q[qt++] = i; lab[i] = id;
    while (qh < qt) { const j = q[qh++]; cnt++; const x = j % w, y = (j / w) | 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
        const k = ny * w + nx; if (!bg[k] && lab[k] < 0) { lab[k] = id; q[qt++] = k; } } }
    sizes.push(cnt);
  }
  const big = Math.max(...sizes);
  let bb = [w, h, 0, 0];
  for (let i = 0; i < n; i++) {
    if (bg[i] || sizes[lab[i]] < big * .06) { rgba[i*4+3] = 0; continue; }
    const x = i % w, y = (i / w) | 0;
    if (x < bb[0]) bb[0] = x; if (y < bb[1]) bb[1] = y; if (x > bb[2]) bb[2] = x; if (y > bb[3]) bb[3] = y;
    const near = (x > 0 && bg[i-1]) || (x < w-1 && bg[i+1]) || (y > 0 && bg[i-w]) || (y < h-1 && bg[i+w]);
    if (near) rgba[i*4+3] = 160; // bord adouci
  }
  return { rgba, bb };
}

(async () => {
  const cut = [];
  let U = [Infinity, Infinity, 0, 0], W = 0, H = 0;
  for (const f of files) {
    const { data, info } = await sharp(path.join(IN, f)).removeAlpha().raw().toBuffer({ resolveWithObject: true });
    W = info.width; H = info.height;
    const { rgba, bb } = cutFrame(data, W, H);
    cut.push(rgba);
    U = [Math.min(U[0], bb[0]), Math.min(U[1], bb[1]), Math.max(U[2], bb[2]), Math.max(U[3], bb[3])];
  }
  // cadrage commun à toutes les images, pieds en bas
  const left = Math.max(0, U[0] - 4), top = Math.max(0, U[1] - 4);
  const cw = Math.min(W - left, U[2] - left + 5), ch = Math.min(H - top, U[3] - top + 2);
  const outH = parseInt(HEIGHT, 10), outW = Math.round(cw * outH / ch / 2) * 2;
  for (let k = 0; k < cut.length; k++) {
    await sharp(cut[k], { raw: { width: W, height: H, channels: 4 } })
      .extract({ left, top, width: cw, height: ch }).resize(outW, outH).png()
      .toFile(path.join(OUT, 'c' + String(k + 1).padStart(3, '0') + '.png'));
  }
  console.log(JSON.stringify({ frames: cut.length, crop: [left, top, cw, ch], out: [outW, outH] }));
})();
