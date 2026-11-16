// Serveur local : node serve.js  →  http://localhost:3068
// 1) sert le jeu (fichiers statiques)
// 2) imite le serveur de jeu Stake Engine (RGS) à partir des fichiers de maths publiés (math/publish),
//    pour tester le jeu comme les relecteurs Stake :
//      http://localhost:3068/?sessionID=test&rgs_url=localhost:3068&currency=USD
//    Scénarios selon le début du sessionID :
//      zero-…   solde à 0                    short-…  mises limitées à 1,00–2,00 (défaut au milieu)
//      jpy-… / eur-… / btc-… / usdt-… / xsc-…   devise                 social-… mode Stake.us
//      active-… une partie gagnante est restée ouverte (à reprendre)       bad      session refusée
//      jur-…    réglages de juridiction stricts (turbo, autoplay, bonus coupés ; RTP, chrono, bilan affichés ; 3 s mini)
//      maint-…  /wallet/play répond 423 (maintenance)
//    Comme le vrai RGS : payoutMultiplier est un multiplicateur décimal (2 = 2×), payout en micro-unités.
//    Journal des requêtes reçues : GET /_log
const http = require('http'), fs = require('fs'), path = require('path'), zlib = require('zlib');
const root = __dirname, port = 3068;
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css', '.png': 'image/png', '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml', '.webp': 'image/webp', '.webm': 'video/webm', '.mp3': 'audio/mpeg', '.woff2': 'font/woff2', '.json': 'application/json' };

/* ---------- maths publiées ---------- */
const PUB = path.join(root, 'math', 'publish');
const modes = {};
function loadMath() {
  if (!fs.existsSync(path.join(PUB, 'index.json'))) { console.log('(pas de math/publish : lancez node tools/export-math.js)'); return; }
  const index = JSON.parse(fs.readFileSync(path.join(PUB, 'index.json'), 'utf8'));
  for (const m of index.modes) {
    const lines = zlib.zstdDecompressSync(fs.readFileSync(path.join(PUB, m.events))).toString('utf8').split('\n').filter(Boolean);
    const byId = new Map();
    for (const l of lines) { const id = +l.slice(6, l.indexOf(',')); byId.set(id, l); } // {"id":N,…
    const table = fs.readFileSync(path.join(PUB, m.weights), 'utf8').trim().split('\n').map(r => r.split(',').map(Number));
    let total = 0; const cum = table.map(([, w]) => (total += w));
    modes[m.name] = { cost: m.cost, byId, table, cum, total };
    console.log(`maths « ${m.name} » chargées : ${table.length} parties`);
  }
}
function pick(mode) {
  const M = modes[mode], x = Math.random() * M.total;
  let lo = 0, hi = M.cum.length - 1;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (M.cum[mid] > x) hi = mid; else lo = mid + 1; }
  return JSON.parse(M.byId.get(M.table[lo][0]));
}

/* ---------- sessions ---------- */
const MICRO = 1e6, sessions = new Map(), log = [];
function session(id) {
  if (!sessions.has(id)) {
    const cur = id.startsWith('jpy-') ? 'JPY' : id.startsWith('eur-') ? 'EUR' : id.startsWith('btc-') ? 'BTC' : id.startsWith('usdt-') ? 'USDT' : id.startsWith('xsc-') ? 'XSC' : 'USD';
    const s = { balance: id.startsWith('zero-') ? 0 : 1000 * MICRO, currency: cur, round: null, social: id.startsWith('social-') || id.startsWith('xsc-') };
    if (id.startsWith('active-')) { // une partie gagnante restée ouverte, misée à 2,00
      let b; do { b = pick('base'); } while (b.payoutMultiplier === 0);
      s.round = toRound(b, 2 * MICRO, 'base', 1);
      s.balance -= 2 * MICRO;
    }
    sessions.set(id, s);
  }
  return sessions.get(id);
}
// Forme d'une partie renvoyée par le vrai RGS : payoutMultiplier DÉCIMAL (2 = 2×), payout en micro-unités
function toRound(b, amount, mode, cost) {
  const pm = b.payoutMultiplier / 100; // les books stockent ×100
  return { betID: b.id, amount, payout: Math.round(amount * pm), payoutMultiplier: pm, costMultiplier: cost, active: pm > 0, mode, state: b.events };
}
function config(id) {
  const levels = id.startsWith('short-') ? [1, 1.25, 1.5, 2] : [0.1, 0.2, 0.4, 0.6, 0.8, 1, 2, 3, 4, 5, 10, 20, 50, 100];
  return { minBet: levels[0] * MICRO, maxBet: levels[levels.length - 1] * MICRO, stepBet: 0.1 * MICRO,
    defaultBetLevel: (id.startsWith('short-') ? 1.25 : 1) * MICRO, betLevels: levels.map(v => Math.round(v * MICRO)),
    jurisdiction: { socialCasino: session(id).social, disabledFullscreen: false, disabledTurbo: id.startsWith('jur-'), disabledSuperTurbo: false,
      disabledAutoplay: id.startsWith('jur-'), disabledSlamstop: false, disabledSpacebar: false, disabledBuyFeature: id.startsWith('jur-'),
      displayNetPosition: id.startsWith('jur-'), displayRTP: id.startsWith('jur-'), displaySessionTimer: id.startsWith('jur-'),
      minimumRoundDuration: id.startsWith('jur-') ? 3000 : 0 } };
}

function send(res, code, obj) {
  res.writeHead(code, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(obj));
}
const err = (res, code, error, message) => send(res, code, { error, message });

function wallet(route, body, res) {
  const id = body.sessionID;
  if (!id || id === 'bad') return err(res, 400, 'ERR_VAL', 'invalid session');
  const s = session(id);
  const balance = () => ({ amount: s.balance, currency: s.currency });
  if (route === '/wallet/authenticate') {
    const out = { balance: balance(), config: config(id) };
    if (s.round && s.round.active) out.round = s.round;
    return send(res, 200, out);
  }
  if (route === '/wallet/balance') return send(res, 200, { balance: balance() });
  if (route === '/wallet/play') {
    if (id.startsWith('maint-')) { res.writeHead(423, { 'Access-Control-Allow-Origin': '*' }); return res.end(); } // jeux en pause (maintenance)
    const mode = modes[body.mode]; if (!mode) return err(res, 400, 'ERR_VAL', 'unknown mode');
    if (s.round && s.round.active) return err(res, 400, 'ERR_VAL', 'round still active');
    const cost = body.amount * mode.cost;
    if (!(body.amount > 0) || cost > s.balance) return err(res, 400, 'ERR_IPB', 'insufficient balance');
    const b = pick(body.mode);
    s.balance -= cost;
    s.round = toRound(b, body.amount, body.mode, mode.cost);
    return send(res, 200, { balance: balance(), round: s.round });
  }
  if (route === '/wallet/end-round') {
    if (!s.round || !s.round.active) return err(res, 400, 'ERR_VAL', 'no active round');
    s.balance += s.round.payout; s.round.active = false;
    return send(res, 200, { balance: balance() });
  }
  return err(res, 404, 'ERR_VAL', 'unknown endpoint');
}

loadMath();
http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (p === '/_log') return send(res, 200, log.slice(-200));
  if (p === '/_reset') { sessions.clear(); log.length = 0; return send(res, 200, { ok: true }); }
  if (p.startsWith('/wallet/')) {
    let raw = ''; req.on('data', c => (raw += c));
    req.on('end', () => { let body = {}; try { body = JSON.parse(raw || '{}'); } catch (e) {}
      log.push({ t: Date.now(), route: p, body }); wallet(p, body, res); });
    return;
  }
  if (p.startsWith('/bet/replay/')) { // /bet/replay/{game}/{version}/{mode}/{event}
    const [, , , , , mode, event] = p.split('/');
    log.push({ t: Date.now(), route: '/bet/replay', mode, event });
    const M = modes[mode], line = M && M.byId.get(+event);
    if (!line) return err(res, 404, 'ERR_VAL', 'replay not found');
    const b = JSON.parse(line);
    return send(res, 200, { payoutMultiplier: b.payoutMultiplier / 100, costMultiplier: M.cost, state: b.events });
  }
  if (p === '/') p = '/index.html';
  const file = path.join(root, path.normalize(p));
  if (!file.startsWith(root)) { res.writeHead(403); return res.end(); }
  fs.readFile(file, (e, data) => {
    if (e) { res.writeHead(404); return res.end('404'); }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  });
}).listen(port, () => console.log('Revolt : http://localhost:' + port));
