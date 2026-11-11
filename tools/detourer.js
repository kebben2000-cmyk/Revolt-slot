// Découpe + détourage des visuels d'une planche. node cut.js <planche> <dossier_sortie>
const sharp = require('sharp');
const fs = require('fs'), path = require('path');
const [, , SRC, OUT] = process.argv;
fs.mkdirSync(OUT, { recursive: true });

const BOXES = process.argv[4] ? JSON.parse(process.argv[4]) : {
  ticket:          [85, 55, 480, 488],
  gilet:           [585, 40, 950, 558],
  pave:            [1070, 160, 1445, 470],
  poubelle:        [1590, 40, 1885, 525],
  'poubelle-verte':[140, 560, 450, 1010],
  crs:             [590, 645, 1050, 1010],
  matraque:        [1160, 615, 1510, 1012],
  fumigene:        [1600, 588, 2000, 1012],
};

(async () => {
  const { data, info } = await sharp(SRC).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  const IW = info.width;
  for (const [name, [x0, y0, x1, y1]] of Object.entries(BOXES)) {
    const w = x1 - x0, h = y1 - y0, n = w * h;
    const rgba = Buffer.alloc(n * 4);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      const s = ((y + y0) * IW + (x + x0)) * 3, d = (y * w + x) * 4;
      rgba[d] = data[s]; rgba[d + 1] = data[s + 1]; rgba[d + 2] = data[s + 2]; rgba[d + 3] = 255;
    }
    const isBg = i => { const r = rgba[i*4], g = rgba[i*4+1], b = rgba[i*4+2];
      const mn = Math.min(r, g, b), mx = Math.max(r, g, b); return mn > 218 && mx - mn < 24; };
    // 1. remplissage du fond depuis les bords
    const bg = new Uint8Array(n), q = new Int32Array(n); let qh = 0, qt = 0;
    const push = i => { if (!bg[i] && isBg(i)) { bg[i] = 1; q[qt++] = i; } };
    for (let x = 0; x < w; x++) { push(x); push((h - 1) * w + x); }
    for (let y = 0; y < h; y++) { push(y * w); push(y * w + w - 1); }
    while (qh < qt) { const i = q[qh++], x = i % w, y = (i / w) | 0;
      if (x > 0) push(i - 1); if (x < w - 1) push(i + 1); if (y > 0) push(i - w); if (y < h - 1) push(i + w); }
    // 1b. trous fermés couleur fond (ex. la dragonne de la matraque)
    const seen = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (!bg[i] && !seen[i] && isBg(i)) {
      const comp = []; qh = qt = 0; q[qt++] = i; seen[i] = 1;
      while (qh < qt) { const j = q[qh++]; comp.push(j); const x = j % w, y = (j / w) | 0;
        for (const k of [x > 0 ? j-1 : -1, x < w-1 ? j+1 : -1, y > 0 ? j-w : -1, y < h-1 ? j+w : -1])
          if (k >= 0 && !bg[k] && !seen[k] && isBg(k)) { seen[k] = 1; q[qt++] = k; } }
      if (comp.length > 400) comp.forEach(j => bg[j] = 1);
    }
    // 2. retire le liseré clair restant (2 passes)
    for (let pass = 0; pass < 2; pass++) {
      const kill = [];
      for (let i = 0; i < n; i++) if (!bg[i]) {
        const x = i % w, y = (i / w) | 0;
        const nearBg = (x > 0 && bg[i-1]) || (x < w-1 && bg[i+1]) || (y > 0 && bg[i-w]) || (y < h-1 && bg[i+w]);
        const mn = Math.min(rgba[i*4], rgba[i*4+1], rgba[i*4+2]);
        if (nearBg && mn > 195) kill.push(i);
      }
      kill.forEach(i => bg[i] = 1);
    }
    // 3. garde seulement les gros morceaux (supprime les poussières de la planche)
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
    let minX = w, minY = h, maxX = 0, maxY = 0;
    for (let i = 0; i < n; i++) {
      const keep = !bg[i] && sizes[lab[i]] >= big * (+process.env.KEEP || 0.04);
      if (!keep) { rgba[i*4+3] = 0; continue; }
      const x = i % w, y = (i / w) | 0;
      if (x < minX) minX = x; if (x > maxX) maxX = x; if (y < minY) minY = y; if (y > maxY) maxY = y;
      // adoucit le bord : pixel opaque touchant le vide → semi-transparent
      const nearBg = (x > 0 && bg[i-1]) || (x < w-1 && bg[i+1]) || (y > 0 && bg[i-w]) || (y < h-1 && bg[i+w]);
      if (nearBg) rgba[i*4+3] = 170;
    }
    const cw = maxX - minX + 1, ch = maxY - minY + 1, side = Math.round(Math.max(cw, ch) * 1.06);
    const cropped = await sharp(rgba, { raw: { width: w, height: h, channels: 4 } })
      .extract({ left: minX, top: minY, width: cw, height: ch }).png().toBuffer();
    await sharp({ create: { width: side, height: side, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
      .composite([{ input: cropped, left: Math.round((side - cw) / 2), top: Math.round((side - ch) / 2) }])
      .png().toBuffer()
      .then(b => sharp(b).resize(512, 512).png({ compressionLevel: 9 }).toFile(path.join(OUT, name + '.png')));
    console.log(name, `${cw}x${ch}`, 'morceaux gardés:', sizes.filter(s => s >= big * (+process.env.KEEP || 0.04)).length);
  }
})();
