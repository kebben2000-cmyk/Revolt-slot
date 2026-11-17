// Détoure les symboles d'une planche sur FOND BLANC, en PNG 512×512 propres.
//   node tools/detourer-fond-blanc.js
// 1. Couleurs : la planche a une dominante rose dans les gris et les noirs (pavé rosé, matraque violette).
//    On ne neutralise QUE les tons gris/noirs tirant sur le rose ; flammes, gilet, cuir gardent leurs couleurs.
// 2. Fond : remplissage depuis le bord du cadre à travers les pixels blancs/très clairs peu saturés.
// 3. Contours : chaque pixel de bord est « démélangé » du blanc (alpha calculé + couleur corrigée) :
//    bords lisses, AUCUN liseré blanc, même sur fond sombre.
// 4. Morceaux isolés : on ne garde que l'objet (et ses gros morceaux) ; mouche, pointillés et poussières partent.
const sharp = require('sharp'), path = require('path'), fs = require('fs');
const ROOT = path.join(__dirname, '..');
const SRC = path.join(ROOT, 'assets', 'source', 'planche-symboles-5-fond-blanc.webp');
const OUT = path.join(ROOT, 'assets', 'symbols');
// [nom du fichier, x0, y0, x1, y1, garder les morceaux ≥ cette part du plus gros]
const BOXES = [
  ['ticket', 95, 68, 472, 490, .01],
  ['gilet', 590, 42, 942, 558, .01],
  ['pave', 1078, 158, 1432, 466, .01],
  ['poubelle', 150, 562, 445, 1014, .004],  // la poubelle d'en bas à gauche (flammes et braises gardées)
  ['crs', 598, 650, 1038, 1008, .01],
  ['matraque', 1160, 620, 1502, 1004, .01],
  ['portefeuille', 1585, 660, 1895, 1008, .5], // .5 : seulement le portefeuille et sa toile, pas la mouche
];
const SIZE = 512, FIT = 456;

function rgb2hsv(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), d = mx - mn; let h = 0;
  if (d) { if (mx === r) h = ((g - b) / d) % 6; else if (mx === g) h = (b - r) / d + 2; else h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360; }
  return [h, mx ? d / mx : 0, mx / 255];
}
function fixPink(d) { // d : RGB
  for (let i = 0; i < d.length; i += 3) {
    const r = d[i], g = d[i + 1], b = d[i + 2], [h, s, v] = rgb2hsv(r, g, b);
    const pinkHue = h >= 280 || h < 6;
    if (pinkHue && (s < .6 || v < .5)) {
      const L = .299 * r + .587 * g + .114 * b, k = .08; // on garde 8 % de la teinte : gris neutre
      d[i] = Math.round(L + (r - L) * k); d[i + 1] = Math.round(L + (g - L) * k); d[i + 2] = Math.round(L + (b - L) * k);
    }
  }
}

(async () => {
  const { data: all, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  fixPink(all);
  const SW = info.width;
  for (const [name, x0, y0, x1, y1, keepRatio] of BOXES) {
    const w = x1 - x0, h = y1 - y0, n = w * h;
    const rgb = Buffer.alloc(n * 3);
    for (let y = 0; y < h; y++) all.copy(rgb, y * w * 3, ((y0 + y) * SW + x0) * 3, ((y0 + y) * SW + x1) * 3);
    const L = i => .299 * rgb[i * 3] + .587 * rgb[i * 3 + 1] + .114 * rgb[i * 3 + 2];
    if (name === 'ticket') { // papier thermique : blanc à peine crème, pas rosé
      for (let i = 0; i < n; i++) { const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], l = L(i), mx = Math.max(r, g, b), mn = Math.min(r, g, b);
        if (l > 150 && (mx - mn) / mx < .2) { rgb[i * 3] = Math.min(255, Math.round(l + 3)); rgb[i * 3 + 1] = Math.min(255, Math.round(l + 1)); rgb[i * 3 + 2] = Math.max(0, Math.round(l - 6)); } }
    }
    const isBg = i => { const r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2]; return Math.min(r, g, b) > 212 && Math.max(r, g, b) - Math.min(r, g, b) < 30; };
    // 2. fond par remplissage depuis le bord
    const bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
    for (let x = 0; x < w; x++) for (const y of [0, h - 1]) { const i = y * w + x; if (!bg[i] && isBg(i)) { bg[i] = 1; q[qt++] = i; } }
    for (let y = 0; y < h; y++) for (const x of [0, w - 1]) { const i = y * w + x; if (!bg[i] && isBg(i)) { bg[i] = 1; q[qt++] = i; } }
    while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0;
      for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (k >= 0 && !bg[k] && isBg(k)) { bg[k] = 1; q[qt++] = k; } }
    // trous blancs purs enfermés (boucle de la dragonne, intérieur du cintre…) : c'est du fond aussi
    const seen = new Uint8Array(n);
    for (let s = 0; s < n; s++) if (!bg[s] && !seen[s] && isBg(s)) {
      const comp = []; qh = qt = 0; q[qt++] = s; seen[s] = 1; let sumMin = 0;
      while (qh < qt) { const i = q[qh++]; comp.push(i); sumMin += Math.min(rgb[i * 3], rgb[i * 3 + 1], rgb[i * 3 + 2]); const x = i % w, y = (i / w) | 0;
        for (const k of [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, y > 0 ? i - w : -1, y < h - 1 ? i + w : -1]) if (k >= 0 && !bg[k] && !seen[k] && isBg(k)) { seen[k] = 1; q[qt++] = k; } }
      if (sumMin / comp.length >= 248 && comp.length > 40 && name !== 'ticket') comp.forEach(i => bg[i] = 1); // le papier du ticket reste
    }
    // 4. morceaux : on garde l'objet
    const lab = new Int32Array(n).fill(-1), sizes = [];
    for (let s = 0; s < n; s++) if (!bg[s] && lab[s] < 0) { const id = sizes.length; let c = 0; qh = qt = 0; q[qt++] = s; lab[s] = id;
      while (qh < qt) { const i = q[qh++]; c++; const x = i % w, y = (i / w) | 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue; const k = ny * w + nx; if (!bg[k] && lab[k] < 0) { lab[k] = id; q[qt++] = k; } } }
      sizes.push(c); }
    const big = Math.max(...sizes);
    for (let i = 0; i < n; i++) if (!bg[i] && sizes[lab[i]] < big * keepRatio) bg[i] = 1;
    // 3. contours démélangés du blanc
    const out = Buffer.alloc(n * 4);
    const nearBg = i => { const x = i % w, y = (i / w) | 0; for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && bg[ny * w + nx]) return true; } return false; };
    for (let i = 0; i < n; i++) {
      if (bg[i]) continue;
      let r = rgb[i * 3], g = rgb[i * 3 + 1], b = rgb[i * 3 + 2], a = 255;
      if (nearBg(i)) {
        // couleur « pleine » de référence : le pixel le plus sombre de l'objet tout près (le trait de contour)
        const x = i % w, y = (i / w) | 0; let ref = 255;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < w && ny < h && !bg[ny * w + nx]) ref = Math.min(ref, L(ny * w + nx)); }
        const al = Math.max(0, Math.min(1, (255 - L(i)) / Math.max(1, 255 - ref)));
        if (al < .04) continue;
        a = Math.round(al * 255);
        const un = c => Math.max(0, Math.min(255, Math.round((c - (1 - al) * 255) / al)));
        r = un(r); g = un(g); b = un(b);
      }
      out[i * 4] = r; out[i * 4 + 1] = g; out[i * 4 + 2] = b; out[i * 4 + 3] = a;
    }
    // cadrage : centré dans 512×512, plus grand côté = FIT
    const img = sharp(out, { raw: { width: w, height: h, channels: 4 } });
    const trimmed = await img.png().toBuffer().then(buf => sharp(buf).trim({ threshold: 1 }).toBuffer({ resolveWithObject: true }));
    const tw = trimmed.info.width, th = trimmed.info.height, k = FIT / Math.max(tw, th);
    const rw = Math.round(tw * k), rh = Math.round(th * k);
    const resized = await sharp(trimmed.data).resize(rw, rh, { kernel: 'lanczos3' }).toBuffer();
    await sharp({ create: { width: SIZE, height: SIZE, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: resized, left: Math.round((SIZE - rw) / 2), top: Math.round((SIZE - rh) / 2) }])
      .png({ compressionLevel: 9, adaptiveFiltering: true }).toFile(path.join(OUT, name + '.png'));
    console.log(`${name}.png  objet ${tw}×${th} → ${rw}×${rh}`);
  }
})();
