# Revolt

Prototype de machine à sous : la révolte contre la vie chère, à Paris, sous les gyrophares.
Cible à terme : publication sur Stake via Stake Engine.

## Lancer le jeu

```bash
node serve.js
```

Puis ouvrir http://localhost:3068.

## Fichiers

| Fichier | Rôle |
|---|---|
| `index.html` | Le jeu : interface, animations, sons, décor |
| `math.js` | Le moteur : symboles, table des gains, rouleaux, bonus Insurrection |
| `sound.js` | Sons synthétisés : ambiance de manif, rouleaux, gains, musique du bonus |
| `sim.js` | Simulation du RTP : `node sim.js 2000000` |
| `tail.js` | Fréquence des très gros gains : `node tail.js base 6000000` |
| `assets/fonts/` | Polices du jeu (livrées avec le jeu, pas de Google Fonts) |
| `serve.js` | Serveur local + imitation du serveur de jeu Stake (RGS) pour les tests |
| `rgs.js` | Client du serveur de jeu Stake Engine (authenticate, play, end-round, replay) |
| `math-summary.js` | RTP et gain max réels par mode (généré) |
| `tools/export-math.js` | Génère les maths au format Stake : `node tools/export-math.js` |
| `tools/make-upload.js` | Prépare `stake-upload/` (front, math, tile) à déposer sur Stake Engine |
| `math/publish/` | Fichiers de maths à déposer sur Stake Engine (≈70 Mo, non versionnés : `node tools/export-math.js`, ~6 min) |
| `assets/symbols/` | Symboles détourés (PNG 512×512, fond transparent) |
| `assets/bg.jpg` | Décor de fond (version allégée) |
| `assets/source/` | Visuels d'origine (planches et fond en pleine taille) |
| `tools/detourer.js` | Découpe et détourage d'une planche (demande `npm i sharp`) |

## Règles actuelles

- 5 rouleaux × 3 rangées, 20 lignes fixes.
- 8 symboles : jerrican, porte-monnaie vide, ticket de caisse, gilet jaune, pavé, fumigène, poubelle en feu, CRS.
- Wild : le mégaphone (rouleaux 2 à 4), slogan + rouleaux qui tremblent. Scatter : la barricade (3/4/5 → 10/12/15 tours gratuits). Pendant le bonus, 2/3/4/5 barricades → +2/+3/+4/+5 tours. Compteur « SPIN 2/10 ».
- General Strike : les mégaphones recouvrent leur rouleau, l'euro doré ajoute +1 à +5 au multiplicateur, qui gagne aussi +1 par tour gagnant.
- Gain max : 15 000× la mise dans tous les modes.
- Modes (fichiers Stake) : base 1×, Riot Hunt 3× par tour (bonus ~6× plus souvent), Super Riot Hunt 10× par tour (~24×), General Strike 72× (achat), Super Strike 220× (achat, multiplicateur de départ ×10). RTP 96,00 % dans chaque mode.
- Pièces d'or : +1, +2, +3, +5, +10, +25, +50 au multiplicateur.

## Conformité Stake Engine

Paramètres d'URL gérés : `sessionID`, `rgs_url`, `lang`, `currency`, `device`, `social`, et pour le replay `replay=true&game&version&mode&event&amount`.

- Au chargement : `/wallet/authenticate` ; mises, mise par défaut, devise et mode social viennent de la réponse.
- Une partie : `/wallet/play` (montants en micro-unités), puis `/wallet/end-round` seulement si la partie gagne.
- Partie restée ouverte : reprise automatique avec sa mise d'origine.
- Solde insuffisant : aucune requête envoyée, message affiché. Serveur injoignable : écran d'erreur, jeu bloqué.
- Achat du bonus : écran de confirmation avec le coût réel.
- Devises : USD, EUR, CAD, MXN, JPY (sans décimales), BTC (6 décimales), USDT, jetons SC/GC sans « $ ».
- Mode social (Stake.us) : vocabulaire sans mots interdits (bet, buy, pay, cash…), vérifié automatiquement.
- Replay : aucun appel au portefeuille, affiche la mise, le coût réel, bouton Play puis Replay.
- Testé aux formats 1024×576, 800×450, 400×225 et 425×812.

Tester comme un relecteur : `node serve.js` puis par exemple
http://localhost:3068/?sessionID=short-1&rgs_url=localhost:3068 (sessions `zero-`, `short-`, `jpy-`, `btc-`, `usdt-`, `xsc-`, `social-`, `active-`, `bad` : voir `serve.js`).

## Reste à faire (humain)

- Vérifier le contenu des images : panneau de l'image « riot », corps au sol dans « revolution », ressemblance du chat rose avec un personnage connu.
- Déposer `math/publish/` et les fichiers du jeu sur Stake Engine, puis lancer la relecture.
