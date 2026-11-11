// Simulation du RTP : node sim.js [nombre_de_parties]
const M = require('./math.js');
const N = parseInt(process.argv[2] || '2000000', 10);

function run(mode, n) {
  let bet = 0, win = 0, hits = 0, bonuses = 0, bonusWin = 0, maxWin = 0, capped = 0;
  const buckets = { '0': 0, '<1x': 0, '1-5x': 0, '5-20x': 0, '20-100x': 0, '100-1000x': 0, '1000x+': 0 };
  for (let i = 0; i < n; i++) {
    const r = M.playRound(mode);
    bet += r.cost; win += r.totalWin;
    if (r.totalWin > 0) hits++;
    if (r.bonus) { bonuses++; bonusWin += r.bonus.win + r.base.scatterWin; }
    if (r.capped) capped++;
    maxWin = Math.max(maxWin, r.totalWin);
    const w = r.totalWin;
    if (w === 0) buckets['0']++; else if (w < 1) buckets['<1x']++; else if (w < 5) buckets['1-5x']++;
    else if (w < 20) buckets['5-20x']++; else if (w < 100) buckets['20-100x']++;
    else if (w < 1000) buckets['100-1000x']++; else buckets['1000x+']++;
  }
  return { mode, n, rtp: (100 * win / bet).toFixed(2) + ' %', hitRate: (100 * hits / n).toFixed(1) + ' %',
    bonusFreq: bonuses ? '1 / ' + Math.round(n / bonuses) : '-',
    avgBonus: bonuses ? (bonusWin / bonuses).toFixed(1) + 'x' : '-',
    maxWin: maxWin.toFixed(1) + 'x', capped, buckets };
}

console.log(run('base', N));
console.log(run('buy', Math.max(50000, Math.floor(N / 20))));
