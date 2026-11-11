// Queue de distribution des gains : node tail.js <mode> <parties>
// Sert à fixer un gain max réellement atteignable (exigence Stake : plus souvent que 1 sur 10 millions).
const M = require('./math.js');
const mode = process.argv[2] || 'base', n = parseInt(process.argv[3] || '5000000', 10);
const TH = [500, 1000, 1500, 2000, 2500, 3000, 4000, 5000];
const cnt = Object.fromEntries(TH.map(t => [t, 0]));
let win = 0, cost = 0, top = [];
for (let i = 0; i < n; i++) {
  const r = M.playRound(mode);
  win += r.totalWin; cost += r.cost;
  for (const t of TH) if (r.totalWin >= t) cnt[t]++;
  if (r.totalWin >= 1500) top.push(Math.round(r.totalWin));
}
console.log(mode, n, 'RTP', (100 * win / cost).toFixed(2) + ' %');
for (const t of TH) console.log(`>= ${t}x : ${cnt[t]}  (1 sur ${cnt[t] ? Math.round(n / cnt[t]).toLocaleString('fr-FR') : '∞'})`);
console.log('plus gros gains :', top.sort((a, b) => b - a).slice(0, 10).join(', '));
