/* REVOLT — client du serveur de jeu Stake Engine (RGS)
 * Docs : https://stake-engine.com/docs/rgs
 *  - toutes les requêtes partent de rgs_url (jamais d'adresse en dur) ; https:// ajouté s'il manque
 *  - montants en micro-unités : 1 000 000 = 1,00
 *  - erreurs : { error, message } avec ERR_VAL, ERR_IPB, ERR_GLE, ERR_ACT, ERR_GEN
 */
(function (root) {
  'use strict';
  const MICRO = 1000000;

  function normalizeHost(u) {
    if (!u) return null;
    u = String(u).trim();
    if (!/^https?:\/\//i.test(u)) u = 'https://' + u;
    return u.replace(/\/+$/, '');
  }

  function fail(code, message, status) { const e = new Error(message || code); e.code = code; e.status = status; return e; }

  async function request(url, init) {
    let res;
    try { res = await fetch(url, init); }
    catch (e) { throw fail('NETWORK', 'The game server could not be reached.'); }
    let data = null;
    try { data = await res.json(); } catch (e) { /* réponse vide ou non JSON */ }
    if (!res.ok || (data && data.error)) throw fail((data && data.error) || 'HTTP_' + res.status, data && data.message, res.status);
    if (!data) throw fail('BAD_RESPONSE', 'Unexpected answer from the game server.', res.status);
    return data;
  }

  const post = (base, path, body) => request(base + path, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  });

  function client(rgsUrl, sessionID) {
    const base = normalizeHost(rgsUrl);
    return {
      authenticate: () => post(base, '/wallet/authenticate', { sessionID }),
      balance: () => post(base, '/wallet/balance', { sessionID }),
      play: (amount, mode) => post(base, '/wallet/play', { sessionID, amount, mode }),
      endRound: () => post(base, '/wallet/end-round', { sessionID }),
    };
  }

  // Replay : aucune session, aucun appel au portefeuille.
  function replay(rgsUrl, game, version, mode, event) {
    const base = normalizeHost(rgsUrl), e = encodeURIComponent;
    return request(`${base}/bet/replay/${e(game)}/${e(version)}/${e(mode)}/${e(event)}`, { method: 'GET' });
  }

  root.RGS = { MICRO, client, replay, normalizeHost };
})(typeof self !== 'undefined' ? self : this);
