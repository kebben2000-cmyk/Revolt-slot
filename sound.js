/* REVOLT — moteur sonore « chaos de manif »
 * Tout est synthétisé en direct (Web Audio), aucun fichier audio.
 * Ambiance permanente : rumeur de foule, crépitement du feu, et au hasard :
 * deux-tons de police au loin, sifflets, pétards, slogans scandés, tambours, hélico.
 * Événements du jeu : RueSound.play('spin' | 'stop' | 'scatter' | 'wild' | 'tease' |
 *   'win' (v = gain en × mise) | 'lose' | 'barricade' | 'inflation' | 'retrigger' |
 *   'bonus' | 'bonusEnd' | 'bigwin' (v = × mise))
 * Quand de vrais fichiers son existeront, il suffira de remplacer les fonctions ici.
 */
(function (root) {
  'use strict';
  let ctx = null, master, verb, bed = null, enabled = false, intensity = 0;
  let schedTimer = null, crackleTimer = null, lastSiren = -99;
  const buffers = {};
  const R = (a, b) => a + Math.random() * (b - a);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const now = () => ctx.currentTime;

  /* ---------- Mise en place ---------- */
  function init() {
    if (ctx) return true;
    const AC = root.AudioContext || root.webkitAudioContext;
    if (!AC) return false;
    try { ctx = new AC(); } catch (e) { return false; }
    master = ctx.createGain(); master.gain.value = 0;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16; comp.ratio.value = 4; comp.attack.value = .005; comp.release.value = .2;
    master.connect(comp).connect(ctx.destination);
    verb = ctx.createConvolver(); verb.buffer = impulse(2.6, 2.4); // écho de rue entre les immeubles
    const wet = ctx.createGain(); wet.gain.value = .4; verb.connect(wet).connect(master);
    buffers.white = noise('white'); buffers.pink = noise('pink'); buffers.brown = noise('brown');
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) ctx.suspend(); else if (enabled) ctx.resume();
    });
    return true;
  }
  function impulse(sec, decay) {
    const len = ctx.sampleRate * sec, b = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = b.getChannelData(c);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
    }
    return b;
  }
  function noise(type) {
    const len = ctx.sampleRate * 4, b = ctx.createBuffer(1, len, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0, b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (type === 'brown') { last = (last + .02 * w) / 1.02; d[i] = last * 3.5; }
      else if (type === 'pink') {
        b0 = .99886 * b0 + w * .0555179; b1 = .99332 * b1 + w * .0750759; b2 = .969 * b2 + w * .153852;
        b3 = .8665 * b3 + w * .3104856; b4 = .55 * b4 + w * .5329522; b5 = -.7616 * b5 - w * .016898;
        d[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * .5362) * .11; b6 = w * .115926;
      } else d[i] = w;
    }
    return b;
  }

  /* ---------- Briques de base ---------- */
  // node → panoramique → sortie sèche + envoi dans la réverbération
  function out(node, { pan = 0, rev = .3 } = {}) {
    const p = ctx.createStereoPanner ? ctx.createStereoPanner() : ctx.createGain();
    if (p.pan) p.pan.value = Math.max(-1, Math.min(1, pan));
    node.connect(p); p.connect(master);
    if (rev > 0) { const s = ctx.createGain(); s.gain.value = rev; p.connect(s); s.connect(verb); }
    return p;
  }
  function env(g, t, a, peak, d, hold = 0) {
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(Math.max(peak, .0002), t + a);
    g.gain.setValueAtTime(Math.max(peak, .0002), t + a + hold);
    g.gain.exponentialRampToValueAtTime(.0001, t + a + hold + d);
  }
  function burst(type, t, dur, { filter = 'lowpass', freq = 1000, q = .7, vol = .3, pan = 0, rev = .3, a = .002, sweepTo } = {}) {
    const s = ctx.createBufferSource(); s.buffer = buffers[type];
    const f = ctx.createBiquadFilter(); f.type = filter; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + a + dur);
    const g = ctx.createGain(); env(g, t, a, vol, dur);
    s.connect(f).connect(g); out(g, { pan, rev });
    s.start(t, R(0, 3)); s.stop(t + a + dur + .05);
  }
  function osc(type, freq, t, dur, { vol = .2, a = .005, to, pan = 0, rev = .3, lp } = {}) {
    const o = ctx.createOscillator(); o.type = type; o.frequency.setValueAtTime(freq, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + a + dur);
    const g = ctx.createGain(); env(g, t, a, vol, dur);
    let n = o;
    if (lp) { const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = lp; o.connect(f); n = f; }
    n.connect(g); out(g, { pan, rev });
    o.start(t); o.stop(t + a + dur + .05);
  }

  /* ---------- La foule ---------- */
  const VOWELS = { o: [450, 800], a: [750, 1250], e: [480, 1750], i: [320, 2300], on: [400, 900] };
  // Limite le nombre de groupes de voix joués en même temps : au-delà, le moteur audio sature
  // et TOUT le son décroche (musique comprise). Pendant la musique du bonus, on en laisse moins.
  let activeVoices = 0;
  function voices(t, dur, vowel, { vol = .12, n = 10, pitch = [140, 260], glide = 1, pan = 0, a = .05, rev = .45, far = false } = {}) {
    const busy = !!(music && music.s);
    if (activeVoices >= (busy ? 5 : 9)) return;
    activeVoices++; setTimeout(() => { activeVoices--; }, (Math.max(0, t - now()) + dur + .7) * 1000);
    n = Math.min(n, busy ? 6 : 10);
    const [f1, f2] = VOWELS[vowel];
    const sum = ctx.createGain(); sum.gain.value = 1 / Math.sqrt(n);
    for (let i = 0; i < n; i++) {
      const o = ctx.createOscillator(); o.type = 'sawtooth';
      const f = R(pitch[0], pitch[1]);
      o.frequency.setValueAtTime(f, t);
      if (glide !== 1) o.frequency.exponentialRampToValueAtTime(f * glide, t + dur);
      o.detune.value = R(-35, 35);
      o.connect(sum); o.start(t + R(0, far ? .18 : .06)); o.stop(t + dur + .6);
    }
    const ns = ctx.createBufferSource(); ns.buffer = buffers.pink;
    const ng = ctx.createGain(); ng.gain.value = 1.2; ns.connect(ng).connect(sum);
    ns.start(t, R(0, 3)); ns.stop(t + dur + .5);
    const g = ctx.createGain(); env(g, t, a, vol, Math.max(.08, dur * .6), dur * .4);
    [[f1, far ? 3 : 5], [f2, far ? 4 : 6]].forEach(([f, q]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      sum.connect(bp).connect(g);
    });
    if (far) { // à travers les rues : on perd les aigus, l'écho des façades domine
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = R(700, 1100);
      g.connect(lp); out(lp, { pan, rev: .9 });
    } else out(g, { pan, rev });
  }
  const hey = (t, vol = .1, pan = R(-.3, .3)) => voices(t, .2, 'e', { vol, n: 12, pitch: [180, 340], a: .015, pan });
  const ooh = (t, vol = .06) => voices(t, 1.1, 'o', { vol, n: 12, pitch: [160, 280], glide: .72, a: .15, pan: R(-.4, .4) });
  function cheer(t, dur, vol) {
    voices(t, dur, 'a', { vol, n: 16, pitch: [200, 430], a: .12 });
    voices(t + .08, dur * .85, 'e', { vol: vol * .7, n: 12, pitch: [250, 520], a: .12, pan: R(-.5, .5) });
    burst('pink', t, dur, { filter: 'bandpass', freq: 1600, q: .8, vol: vol * .6, a: .2, rev: .45 });
    swell(dur);
  }
  // Slogans scandés : le rythme et les voyelles, sans paroles intelligibles
  const CHANTS = [
    [['on', .26], ['a', .26], ['i', .5]],             // « On lâche rien »
    [['e', .22], ['o', .22], ['i', .22], ['on', .5]],  // « Ré-vo-lu-tion »
    [['o', .3], ['a', .3], ['e', .3], ['o', .55]],     // « Tous en-sem-ble »
  ];
  function chant(t, vol = .08, reps = 2, far = false) {
    const pat = pick(CHANTS), pan = far ? R(-.95, .95) : R(-.6, .6);
    let tt = t;
    for (let r = 0; r < reps; r++) {
      for (const [v, d] of pat) { voices(tt, d, v, { vol, pan, n: far ? 22 : 12, far, pitch: far ? [120, 300] : [140, 260] }); tt += d + .08; }
      tt += .4;
    }
  }

  // Une manif plus loin dans la rue : on l'entend crier, huer, scander
  function farProtest(t) {
    const pan = R(-.95, .95), kind = Math.random();
    if (kind < .45) chant(t, R(.05, .08), Math.floor(R(2, 4)), true);
    else if (kind < .8) { // clameur qui monte puis retombe
      const d = R(1.5, 3);
      voices(t, d, pick(['a', 'o', 'e']), { vol: R(.04, .07), n: 24, pitch: [130, 380], a: d * .4, pan, far: true });
      burst('pink', t, d, { filter: 'bandpass', freq: 900, q: .7, vol: .025, a: d * .4, pan, rev: .8 });
    } else { // huée « hou ! »
      voices(t, R(1, 1.8), 'o', { vol: R(.04, .06), n: 24, pitch: [110, 240], glide: .85, a: .3, pan, far: true });
    }
  }

  /* ---------- La rue ---------- */
  // Sirène deux-tons de police (La 435 Hz / Ré 580 Hz), à la française.
  // Son de pavillon : onde riche, petit glissé entre les deux notes, résonances du klaxon,
  // et quand elle passe au loin : Doppler, aigus étouffés, écho des façades.
  function pinpon(t, { dur = 6, vol = .05, pan = R(-.8, .8), near = false } = {}) {
    const HALF = .5, GLIDE = .045;
    const d0 = near ? 1 : R(1.025, 1.04), d1 = near ? 1 : R(.955, .97);
    const oscs = [0, 7].map(cents => { const o = ctx.createOscillator(); o.type = 'sawtooth'; o.detune.value = cents; return o; });
    const sq = ctx.createOscillator(); sq.type = 'square';
    for (let k = 0, tt = t; tt < t + dur + HALF; k++, tt += HALF) {
      const fr = (k % 2 ? 580 : 435) * (d0 + (d1 - d0) * Math.min(1, (tt - t) / dur));
      [...oscs, sq].forEach(o => {
        if (k === 0) o.frequency.setValueAtTime(fr, tt);
        else { o.frequency.setValueAtTime(o._last, tt); o.frequency.linearRampToValueAtTime(fr, tt + GLIDE); }
        o._last = fr;
      });
    }
    const mix = ctx.createGain(); mix.gain.value = .5;
    const sqg = ctx.createGain(); sqg.gain.value = .25;
    oscs.forEach(o => o.connect(mix)); sq.connect(sqg).connect(mix);
    const ws = ctx.createWaveShaper(); ws.curve = (() => { const n = 512, c = new Float32Array(n); for (let i = 0; i < n; i++) { const x = i / n * 2 - 1; c[i] = Math.tanh(x * 2.2); } return c; })();
    const horn = ctx.createGain(); horn.gain.value = 1;
    [[1050, 2.5, .9], [2350, 3, .5], [3600, 4, .2]].forEach(([f, q, gn]) => {
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f; bp.Q.value = q;
      const bg = ctx.createGain(); bg.gain.value = gn; ws.connect(bp).connect(bg).connect(horn);
    });
    const body = ctx.createBiquadFilter(); body.type = 'lowpass'; body.frequency.value = 1600;
    const bodyG = ctx.createGain(); bodyG.gain.value = .6; ws.connect(body).connect(bodyG).connect(horn);
    mix.connect(ws);
    const dist = ctx.createBiquadFilter(); dist.type = 'lowpass';
    dist.frequency.setValueAtTime(near ? 6000 : 1400, t);
    if (!near) { dist.frequency.linearRampToValueAtTime(2600, t + dur * .5); dist.frequency.linearRampToValueAtTime(1100, t + dur); }
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur * (near ? .08 : .45));
    g.gain.setValueAtTime(vol, t + dur * (near ? .75 : .55));
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    horn.connect(dist).connect(g);
    const p = out(g, { pan, rev: near ? .3 : .75 });
    if (p.pan && !near) { p.pan.setValueAtTime(pan, t); p.pan.linearRampToValueAtTime(-pan * .6, t + dur); }
    [...oscs, sq].forEach(o => { o.start(t); o.stop(t + dur + .1); });
  }
  // Sifflet à roulette
  function whistle(t, { vol = .04, pan = R(-.7, .7), pattern = [.12, .12, .45] } = {}) {
    let tt = t;
    for (const d of pattern) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = R(2700, 3100);
      const lfo = ctx.createOscillator(); lfo.frequency.value = R(24, 34);
      const lg = ctx.createGain(); lg.gain.value = 170; lfo.connect(lg).connect(o.frequency);
      const g = ctx.createGain(); env(g, tt, .01, vol, .05, d);
      o.connect(g); out(g, { pan, rev: .45 });
      o.start(tt); lfo.start(tt); o.stop(tt + d + .12); lfo.stop(tt + d + .12);
      tt += d + .09;
    }
  }
  function petard(t, { vol = .3, pan = R(-.8, .8), dist = 0 } = {}) {
    const k = 1 - dist * .65;
    burst('white', t, .14, { freq: 7000 * k, sweepTo: 250, vol: vol * k, pan, rev: .45 + dist * .4 });
    osc('sine', 130, t, .3, { vol: vol * .9 * k, to: 38, pan, rev: .3 });
  }
  function firecrackers(t, n = 10, vol = .08) {
    const pan = R(-.8, .8); let tt = t;
    for (let i = 0; i < n; i++) {
      burst('white', tt, .025, { filter: 'highpass', freq: 1200, vol: vol * R(.5, 1), pan: pan + R(-.15, .15), rev: .4 });
      tt += R(.04, .14);
    }
  }
  function tom(t, vol = .25, pan = 0, len = 1) {
    osc('sine', 150, t, .22 * len, { vol, to: 55, pan, rev: .25, a: .003 });
    burst('brown', t, .06, { freq: 500, vol: vol * .5, pan, rev: .2 });
  }
  function snare(t, vol = .1, pan = 0) {
    burst('white', t, .08, { filter: 'highpass', freq: 1600, vol, pan, rev: .3 });
    osc('triangle', 230, t, .05, { vol: vol * .6, to: 160, pan });
  }
  function drums(t, bars = 2, vol = .2) {
    const step = .125, pan = R(-.5, .5), pat = 'X.x.X.xxX.x.X.x.';
    for (let r = 0; r < bars; r++) for (let i = 0; i < 16; i++) {
      const tt = t + (r * 16 + i) * step, c = pat[i];
      if (c === 'X') tom(tt, vol, pan); else if (c === 'x') snare(tt, vol * .45, pan);
    }
  }
  function roll(t, dur = 1.2, vol = .1) {
    for (let tt = t; tt < t + dur; tt += .045) snare(tt, vol * (.25 + .75 * (tt - t) / dur), 0);
  }
  function helico(t, dur = 12, vol = .06) {
    const s = ctx.createBufferSource(); s.buffer = buffers.brown; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = 280;
    const am = ctx.createGain(); am.gain.value = .5;
    const lfo = ctx.createOscillator(); lfo.frequency.value = R(11, 15);
    const lg = ctx.createGain(); lg.gain.value = .5; lfo.connect(lg).connect(am.gain);
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur * .45);
    g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f).connect(am).connect(g);
    const p = out(g, { pan: -.8, rev: .3 });
    if (p.pan) { p.pan.setValueAtTime(-.8, t); p.pan.linearRampToValueAtTime(.8, t + dur); }
    s.start(t); lfo.start(t); s.stop(t + dur + .1); lfo.stop(t + dur + .1);
  }
  // Casserolade : plusieurs personnes tapent sur des casseroles, chacune à son rythme
  function pot(t, vol = .08, pan = 0) {
    const base = R(1800, 3200);
    burst('white', t, .035, { filter: 'bandpass', freq: base, q: 2.5, vol, pan, rev: .3 });
    burst('white', t, .015, { filter: 'highpass', freq: 4000, vol: vol * .5, pan, rev: .2 });
  }
  function casseroles(t, dur = R(3, 6), vol = .06) {
    const n = Math.floor(R(2, 5));
    for (let p = 0; p < n; p++) {
      const pan = R(-.9, .9), rate = R(.18, .32);
      for (let tt = t + R(0, .15); tt < t + dur; tt += rate * R(.85, 1.15))
        pot(tt, vol * R(.5, 1) * (1 - .4 * (tt - t) / dur), pan);
    }
  }
  // La foule qui manifeste et crie derrière : clameur, slogans, cris éparpillés
  function riot(t, dur = 3, vol = .14) {
    cheer(t, dur, vol);
    chant(t + .3, vol * .8, Math.max(1, Math.round(dur / 1.6)));
    for (let tt = t; tt < t + dur; tt += R(.18, .45)) hey(tt, vol * R(.4, .9), R(-.9, .9));
    voices(t + .1, dur, 'o', { vol: vol * .5, n: 14, pitch: [120, 220], a: .3, pan: R(-.5, .5) });
  }

  // Barrière métallique qui tombe
  function clang(t, vol = .25) {
    burst('white', t, .09, { filter: 'highpass', freq: 700, vol, rev: .4 });
    [310, 745, 1210, 1890, 2650].forEach((f, i) =>
      osc('sine', f * R(.98, 1.02), t, 1.2 - i * .17, { vol: vol * .5 / (i + 1), a: .002, rev: .5 }));
  }
  // Caisse enregistreuse (l'inflation grimpe)
  function ching(t, vol = .1) {
    burst('white', t, .05, { filter: 'bandpass', freq: 3000, q: 2, vol: vol * .6, rev: .1 });
    osc('sine', 2637, t + .06, .5, { vol, rev: .3 });
    osc('sine', 3520, t + .06, .4, { vol: vol * .5, rev: .3 });
  }
  function applause(t, dur = 3, vol = .12) {
    for (let tt = t; tt < t + dur; tt += R(.006, .025)) {
      const fade = 1 - (tt - t) / dur;
      burst('white', tt, .018, { filter: 'bandpass', freq: R(1100, 2600), q: 1.2, vol: vol * fade * R(.3, 1), pan: R(-.9, .9), rev: .3 });
    }
  }
  function whoosh(t) {
    burst('pink', t, .25, { filter: 'bandpass', freq: 280, sweepTo: 2600, q: 2.2, vol: .35, a: .12, rev: .15 });
  }

  /* ---------- La ville ---------- */
  // Voiture qui passe (moteur + pneus), avec effet de passage gauche → droite
  function car(t, dur = R(4, 7), vol = .03) {
    const dir = Math.random() < .5 ? 1 : -1;
    const s = ctx.createBufferSource(); s.buffer = buffers.brown; s.loop = true;
    const f = ctx.createBiquadFilter(); f.type = 'lowpass';
    f.frequency.setValueAtTime(250, t); f.frequency.linearRampToValueAtTime(750, t + dur / 2); f.frequency.linearRampToValueAtTime(250, t + dur);
    const o = ctx.createOscillator(); o.type = 'sawtooth'; o.frequency.setValueAtTime(R(48, 62), t);
    o.frequency.linearRampToValueAtTime(R(40, 50), t + dur);
    const of = ctx.createBiquadFilter(); of.type = 'lowpass'; of.frequency.value = 180;
    const og = ctx.createGain(); og.gain.value = .35;
    const g = ctx.createGain();
    g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(vol, t + dur / 2); g.gain.exponentialRampToValueAtTime(.0001, t + dur);
    s.connect(f).connect(g); o.connect(of).connect(og).connect(g);
    const p = out(g, { pan: -dir * .9, rev: .25 });
    if (p.pan) { p.pan.setValueAtTime(-dir * .9, t); p.pan.linearRampToValueAtTime(dir * .9, t + dur); }
    s.start(t, R(0, 3)); o.start(t); s.stop(t + dur + .1); o.stop(t + dur + .1);
  }
  function horn(t, vol = .018) {
    const pan = R(-.9, .9), d = R(.25, .6);
    osc('square', 392, t, d, { vol, lp: 1400, pan, rev: .55, a: .01 });
    osc('square', 466, t, d, { vol: vol * .8, lp: 1400, pan, rev: .55, a: .01 });
  }
  // Discussions de la foule au loin
  function chatter(t) {
    voices(t, R(.4, 1.1), pick(['a', 'e', 'o', 'i', 'on']), { vol: R(.008, .016), n: 5, pitch: [100, 230], pan: R(-.95, .95), rev: .7, a: .08 });
  }

  /* ---------- Mécanique des rouleaux ---------- */
  let rolling = 0, rollTimer = null;
  function rollTick() {
    if (rolling <= 0 || !enabled) { rollTimer = null; return; }
    const t = now() + .01;
    burst('white', t, .012, { filter: 'bandpass', freq: R(1700, 2600), q: 4, vol: .02 + .008 * rolling, rev: .05 });
    osc('square', 95, t, .02, { vol: .018, lp: 400, rev: 0 });
    rollTimer = setTimeout(rollTick, 58);
  }
  function ratchet(t) { // le levier qu'on arme
    for (let i = 0; i < 6; i++) burst('white', t + i * .03, .01, { filter: 'bandpass', freq: 2200 - i * 150, q: 5, vol: .09, rev: .05 });
    osc('sine', 180, t + .19, .12, { vol: .12, to: 70, rev: .05 });
  }
  function metalHit(t, vol = .09) { // petit impact métallique à l'arrêt
    burst('white', t, .02, { filter: 'highpass', freq: 3000, vol: vol * .6, rev: .15 });
    burst('white', t, .04, { filter: 'bandpass', freq: R(1200, 1600), q: 3, vol: vol * .9, rev: .08 });
  }

  /* ---------- Montée électro (gains) ---------- */
  function riser(t, dur = 1.4, vol = .06) {
    const o = ctx.createOscillator(); o.type = 'sawtooth';
    o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(880, t + dur);
    const o2 = ctx.createOscillator(); o2.type = 'sawtooth';
    o2.frequency.setValueAtTime(111.5, t); o2.frequency.exponentialRampToValueAtTime(892, t + dur);
    const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.Q.value = 6;
    f.frequency.setValueAtTime(300, t); f.frequency.exponentialRampToValueAtTime(7000, t + dur);
    const g = ctx.createGain(); g.gain.setValueAtTime(.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + dur); g.gain.exponentialRampToValueAtTime(.0001, t + dur + .08);
    o.connect(f); o2.connect(f); f.connect(g); out(g, { rev: .35 });
    o.start(t); o2.start(t); o.stop(t + dur + .1); o2.stop(t + dur + .1);
    burst('white', t, dur, { filter: 'highpass', freq: 400, sweepTo: 9000, vol: vol * .7, a: dur * .9, rev: .3 });
    kick(t + dur + .02, .5);
  }

  /* ---------- Musique du General Strike : électro « French touch » ----------
     Morceau original (aucun sample, aucune mélodie empruntée) dans l'esprit électro française :
     kick 4/4 à 124 BPM, basse saturée filtrée qui « respire » au rythme du kick (sidechain),
     accords saturés, charleston, clap, montée en fin de boucle.
     La boucle de 8 mesures est calculée UNE fois à l'avance (OfflineAudioContext), puis jouée en
     boucle : elle ne dépend plus du reste du jeu et ne peut plus saccader. */
  let music = null, musicBuf = null, musicRendering = null, musicError = null;
  const M_BPM = 124, BEAT = 60 / M_BPM, BARS = 8, LOOP = BARS * 4 * BEAT, S16 = BEAT / 4;
  const mkCurve = k => { const n = 1024, c = new Float32Array(n); for (let i = 0; i < n; i++) c[i] = Math.tanh((i / n * 2 - 1) * k); return c; };
  // kick ponctuel (utilisé aussi par la montée électro des gains)
  function kick(t, vol = .55, bus) {
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(160, t); o.frequency.exponentialRampToValueAtTime(42, t + .18);
    const g = ctx.createGain(); env(g, t, .002, vol, .32);
    o.connect(g); g.connect(bus || master); o.start(t); o.stop(t + .4);
  }
  function renderMusic() {
    if (musicBuf) return Promise.resolve(musicBuf);
    if (musicRendering) return musicRendering;
    const OAC = root.OfflineAudioContext || root.webkitOfflineAudioContext;
    if (!OAC || !ctx) return Promise.resolve(null);
    const TAIL = 2, sr = ctx.sampleRate, c = new OAC(2, Math.ceil((LOOP + TAIL) * sr), sr);
    const nb = c.createBuffer(1, sr, sr); { const d = nb.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
    const eg = (g, t, at, peak, d) => { g.gain.setValueAtTime(.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + at); g.gain.exponentialRampToValueAtTime(.0001, t + at + d); };
    const mix = c.createGain(); mix.gain.value = .9;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -12; comp.ratio.value = 5; comp.attack.value = .003; comp.release.value = .12;
    mix.connect(comp).connect(c.destination);
    const drums = c.createGain(); drums.connect(mix);
    const synths = c.createGain(); synths.connect(mix);
    const noise = (t, dur, type, freq, q, vol, dest, pan = 0) => {
      const sN = c.createBufferSource(); sN.buffer = nb;
      const f = c.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = c.createGain(); eg(g, t, .001, vol, dur);
      const p = c.createStereoPanner ? c.createStereoPanner() : c.createGain(); if (p.pan) p.pan.value = pan;
      sN.connect(f).connect(g).connect(p).connect(dest); sN.start(t, Math.random() * .5); sN.stop(t + dur + .05);
    };
    // batterie
    const kickC = t => {
      const o = c.createOscillator(); o.frequency.setValueAtTime(155, t); o.frequency.exponentialRampToValueAtTime(44, t + .11);
      const ws = c.createWaveShaper(); ws.curve = mkCurve(1.6);
      const g = c.createGain(); eg(g, t, .002, .95, .34);
      o.connect(ws).connect(g).connect(drums); o.start(t); o.stop(t + .4);
      noise(t, .012, 'highpass', 3500, .7, .22, drums);
    };
    const clap = t => { for (let i = 0; i < 3; i++) noise(t + i * .011, .025, 'bandpass', 1500, 1.3, .32, drums); noise(t + .033, .2, 'bandpass', 1350, 1, .26, drums); };
    const hat = (t, open, vol, pan) => noise(t, open ? .15 : .028, 'highpass', 8200, .7, vol, drums, pan);
    for (let bt = 0; bt < BARS * 4; bt++) {
      const t = bt * BEAT;
      kickC(t);
      if (bt % 2 === 1) clap(t);
      hat(t + BEAT / 2, true, .11, .2);
      for (let k = 0; k < 4; k++) if (k !== 2) hat(t + k * S16, false, k % 2 ? .045 : .07, -.25);
      // sidechain : tout le reste s'efface sur chaque kick puis remonte (effet « pompe »)
      synths.gain.setValueAtTime(.18, t); synths.gain.linearRampToValueAtTime(1, t + BEAT * .6);
    }
    // basse saturée : la mineur, octaves qui sautent, progression la-la-sol-sol-fa-fa-mi-sol
    const A1 = 55, PROG = [0, 0, -2, -2, -4, -4, -5, -2];
    const LINE = [0, 12, 0, 12, 0, 12, 0, 10, 0, 12, 0, 12, 3, 15, 3, 14];
    const bWS = c.createWaveShaper(); bWS.curve = mkCurve(5);
    const bF = c.createBiquadFilter(); bF.type = 'lowpass'; bF.Q.value = 10;
    bF.frequency.setValueAtTime(320, 0); bF.frequency.exponentialRampToValueAtTime(2800, LOOP * .72); bF.frequency.exponentialRampToValueAtTime(600, LOOP);
    const bG = c.createGain(); bG.gain.value = .2;
    bWS.connect(bF).connect(bG).connect(synths);
    for (let bar = 0; bar < BARS; bar++) for (let i = 0; i < 16; i++) {
      const t = (bar * 16 + i) * S16, f = A1 * Math.pow(2, (PROG[bar] + LINE[i]) / 12);
      [-7, 7].forEach(det => {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det;
        const g = c.createGain(); eg(g, t, .003, .5, S16 * .8);
        o.connect(g).connect(bWS); o.start(t); o.stop(t + S16);
      });
    }
    // accords saturés (mesures 5 à 8)
    const STAB = [1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 0];
    const sWS = c.createWaveShaper(); sWS.curve = mkCurve(3);
    const sF = c.createBiquadFilter(); sF.type = 'lowpass'; sF.frequency.value = 3000; sF.Q.value = 2;
    const sG = c.createGain(); sG.gain.value = .075;
    sWS.connect(sF).connect(sG).connect(synths);
    for (let bar = 4; bar < BARS; bar++) for (let i = 0; i < 16; i++) if (STAB[i]) {
      const t = (bar * 16 + i) * S16, rt = A1 * 4 * Math.pow(2, PROG[bar] / 12);
      [0, 3, 7, 12].forEach(iv => [-6, 6].forEach(det => {
        const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = rt * Math.pow(2, iv / 12); o.detune.value = det;
        const g = c.createGain(); eg(g, t, .004, .35, S16 * 1.7);
        o.connect(g).connect(sWS); o.start(t); o.stop(t + S16 * 2.2);
      }));
    }
    // cymbale au début, montée de bruit sur la dernière mesure
    noise(0, 1.8, 'highpass', 5200, .5, .1, mix);
    const rs = c.createBufferSource(); rs.buffer = nb; rs.loop = true;
    const rf = c.createBiquadFilter(); rf.type = 'bandpass'; rf.Q.value = 3;
    const rg = c.createGain(), rt0 = LOOP - BEAT * 4;
    rf.frequency.setValueAtTime(400, rt0); rf.frequency.exponentialRampToValueAtTime(8000, LOOP - .01);
    rg.gain.setValueAtTime(.0001, rt0); rg.gain.exponentialRampToValueAtTime(.13, LOOP - .03); rg.gain.linearRampToValueAtTime(0, LOOP);
    rs.connect(rf).connect(rg).connect(mix); rs.start(rt0); rs.stop(LOOP);
    musicRendering = c.startRendering().then(buf => {
      // les notes qui débordent après la fin de la boucle sont ajoutées au début : raccord parfait, sans clic
      const len = Math.round(LOOP * sr), loopBuf = ctx.createBuffer(2, len, sr);
      for (let ch = 0; ch < 2; ch++) {
        const src = buf.getChannelData(ch), dst = loopBuf.getChannelData(ch);
        dst.set(src.subarray(0, len));
        for (let i = len; i < src.length && i - len < len; i++) dst[i - len] += src[i];
      }
      return (musicBuf = loopBuf);
    }).catch(e => { musicError = String(e); return null; });
    return musicRendering;
  }
  function musicStart() {
    if (music) return;
    music = { s: null, g: null, wanted: true };
    const m = music;
    renderMusic().then(buf => {
      if (!buf || music !== m || !enabled) return;
      const sN = ctx.createBufferSource(); sN.buffer = buf; sN.loop = true;
      const g = ctx.createGain(); g.gain.setValueAtTime(.0001, now()); g.gain.exponentialRampToValueAtTime(.5, now() + 1.2);
      sN.connect(g).connect(master); sN.start();
      m.s = sN; m.g = g;
    });
  }
  function musicStop(fade = 1.5) {
    if (!music) return;
    const m = music; music = null;
    if (!m.s) return;
    const t = now();
    m.g.gain.cancelScheduledValues(t); m.g.gain.setValueAtTime(Math.max(.0001, m.g.gain.value), t);
    m.g.gain.exponentialRampToValueAtTime(.0001, t + fade);
    m.s.stop(t + fade + .05);
  }

  /* ---------- Fond permanent ---------- */
  function startBed() {
    if (bed) return;
    const mk = (buf, type, freq, q, lfoHz, depth) => {
      const s = ctx.createBufferSource(); s.buffer = buffers[buf]; s.loop = true;
      const f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
      const g = ctx.createGain(); g.gain.value = 0;
      const lfo = ctx.createOscillator(); lfo.frequency.value = lfoHz;
      const lg = ctx.createGain(); lg.gain.value = depth; lfo.connect(lg).connect(g.gain);
      s.connect(f).connect(g); s.start(0, R(0, 3)); lfo.start();
      return g;
    };
    const g1 = mk('brown', 'bandpass', 420, .6, .11, .025); // rumeur grave de la foule
    const g2 = mk('pink', 'bandpass', 1150, 1.4, .27, .012); // brouhaha des voix
    const g3 = mk('brown', 'lowpass', 90, .5, .05, .02);     // grondement de la ville
    [g1, g2, g3].forEach(g => out(g, { rev: .25 }));
    bed = { g1, g2, g3 };
    setBed(0, 2);
  }
  function setBed(boost = 0, time = 1.5) {
    if (!bed) return;
    const t = now(), k = intensity;
    bed.g1.gain.setTargetAtTime(.08 + k * .07 + boost, t, time / 3);
    bed.g2.gain.setTargetAtTime(.03 + k * .035 + boost * .6, t, time / 3);
    bed.g3.gain.setTargetAtTime(.12 + k * .06, t, time / 3);
  }
  let swellTimer = null;
  function swell(dur) {
    setBed(.09, .3);
    clearTimeout(swellTimer);
    swellTimer = setTimeout(() => setBed(0, 2), dur * 1000);
  }
  function crackleLoop() {
    if (!enabled) return;
    const t = now() + .05, n = Math.random() < .3 ? 3 : 1;
    for (let i = 0; i < n; i++) {
      burst('white', t + R(0, .05), R(.003, .012), { filter: 'highpass', freq: R(1500, 4200),
        vol: R(.01, .045) * (1 + intensity), pan: R(-.9, .9), rev: .15 });
    }
    crackleTimer = setTimeout(crackleLoop, R(40, 280) / (1 + intensity));
  }
  function tick() {
    if (!enabled) return;
    const t = now() + .1, k = 1 + intensity * (music && music.s ? .5 : 1.6);
    if (Math.random() < .09 * k && t - lastSiren > 6) { lastSiren = t; pinpon(t, { dur: R(5, 9), vol: .03 + intensity * .03 }); }
    if (Math.random() < .012 * k) whistle(t, { vol: .008 + intensity * .01, pattern: pick([[.12, .12, .4], [.55], [.08, .08, .08, .08]]) });
    if (Math.random() < .03 * k) petard(t, { dist: R(.5, 1), vol: .22 });
    if (Math.random() < .012 * k) firecrackers(t, 8 + Math.floor(R(0, 10)), .05);
    if (Math.random() < .14 * k) farProtest(t + R(0, .6));
    if (Math.random() < .02 * k) chant(t, .04 + intensity * .035, 2);
    if (Math.random() < .06) car(t, R(4, 7), .025);
    if (Math.random() < .25) chatter(t + R(0, .8));
    if (Math.random() < .035 * k) casseroles(t, R(3, 6), .045 + intensity * .03);
    if (!music && Math.random() < .015 * k) drums(t, 2, .08 + intensity * .08);
    if (Math.random() < .005 * k) helico(t, R(10, 16), .05);
    schedTimer = setTimeout(tick, 1000);
  }

  /* ---------- API ---------- */
  function enable(on) {
    enabled = !!on;
    clearTimeout(schedTimer); clearTimeout(crackleTimer);
    if (enabled) {
      if (!init()) return;
      ctx.resume();
      master.gain.setTargetAtTime(.9, now(), .2);
      startBed();
      setTimeout(() => { try { renderMusic(); } catch (e) { musicError = String(e); } }, 300);
      schedTimer = setTimeout(tick, 1200);
      crackleLoop();
    } else if (ctx) {
      rolling = 0; musicStop(.2);
      master.gain.setTargetAtTime(0, now(), .1);
      setTimeout(() => { if (!enabled) ctx.suspend(); }, 500);
    }
  }

  function play(name, v = 0) {
    if (!enabled || !ctx) return;
    const t = now() + .01;
    switch (name) {
      case 'spin':
        ratchet(t); whoosh(t + .12); if (Math.random() < .4) hey(t + .05, .045);
        rolling = 5; if (!rollTimer) rollTick();
        break;
      case 'stop': // le rouleau se bloque : choc sourd + petit impact métallique
        rolling = Math.max(0, rolling - 1);
        burst('brown', t, .1, { freq: 520, vol: .5, rev: .1 });
        metalHit(t); break;
      case 'scatter':
        whistle(t, { vol: .025, pan: R(-.3, .3), pattern: [.09, .09] });
        petard(t + .05, { vol: .28, pan: R(-.3, .3) }); hey(t + .1, .09); break;
      case 'wild':
        hey(t, .11); clang(t, .1); break;
      case 'tease':
        roll(t, 1.2, .09); swell(1.3);
        osc('sawtooth', 220, t, 1.1, { vol: .02, to: 440, lp: 1500 }); break;
      case 'win':
        if (v >= 10) { riser(t, 1.2, .06); riot(t + .9, 2.6, .15); drums(t + .9, 2, .2); whistle(t + 1, { vol: .02 }); casseroles(t + 1, 2.5, .06); }
        else if (v >= 3) { riser(t, .9, .045); riot(t + .6, 1.6, .11); drums(t + .6, 1, .15); }
        else if (v >= 1) cheer(t, .9, .085);
        else hey(t, .07);
        break;
      case 'lose':
        if (Math.random() < .25) ooh(t); break;
      case 'barricade':
        clang(t, .28); tom(t, .32); hey(t + .1, .11); break;
      case 'euro':
        ching(t, .11); osc('sine', 1568, t, .12, { vol: .06 }); osc('sine', 2093, t + .09, .3, { vol: .07 });
        hey(t + .05, .08); break;
      case 'inflation':
        ching(t, .09); hey(t + .05, .08); break;
      case 'retrigger':
        pinpon(t, { dur: 2.6, vol: .07, near: true, pan: R(-.3, .3) }); casseroles(t + .2, 2, .06); hey(t + .1, .1); break;
      case 'bonus':
        intensity = 1; setBed(0, 2); musicStart();
        pinpon(t, { dur: 4.4, vol: .1, near: true, pan: -.25 });
        cheer(t, 2.4, .16);
        firecrackers(t + 1, 14, .09); casseroles(t + .5, 4, .07); break;
      case 'bonusEnd':
        musicStop(2.5); applause(t, 3.2, .11); cheer(t, 2, .11);
        intensity = 0; setBed(0, 3); break;
      case 'bigwin': {
        const big = v >= 100, mid = v >= 30;
        riser(t - .01, .8, .06);
        riot(t, big ? 4.5 : mid ? 3.5 : 2.8, big ? .22 : .18);
        casseroles(t + .3, big ? 5 : 3.5, .08);
        for (let i = 0; i < (big ? 6 : mid ? 4 : 2); i++) petard(t + .15 + i * R(.15, .35), { vol: .3 });
        firecrackers(t + .5, big ? 24 : 12, .09);
        if (mid) pinpon(t + .2, { dur: 3.5, vol: .08, near: true });
        whistle(t + .3, { vol: .03 });
        if (big) drums(t + .6, 4, .26);
        break;
      }
    }
  }

  root.RueSound = { enable, play, isOn: () => enabled,
    status: () => ({ musicReady: !!musicBuf, musicSeconds: musicBuf ? +musicBuf.duration.toFixed(2) : 0, musicPlaying: !!(music && music.s), musicError }) };
})(typeof self !== 'undefined' ? self : this);
