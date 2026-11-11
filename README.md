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
| `serve.js` | Petit serveur local |
| `assets/symbols/` | Symboles détourés (PNG 512×512, fond transparent) |
| `assets/bg.jpg` | Décor de fond (version allégée) |
| `assets/source/` | Visuels d'origine (planches et fond en pleine taille) |
| `tools/detourer.js` | Découpe et détourage d'une planche (demande `npm i sharp`) |

## Règles actuelles

- 5 rouleaux × 3 rangées, 20 lignes fixes.
- 8 symboles : jerrican, porte-monnaie vide, ticket de caisse, gilet jaune, pavé, fumigène, poubelle en feu, CRS.
- Wild : le mégaphone (rouleaux 2 à 4), slogan + rouleaux qui tremblent. Scatter : la barricade (3/4/5 → 10/12/15 tours gratuits).
- General Strike : les mégaphones recouvrent leur rouleau, l'euro doré ajoute +1 à +5 au multiplicateur, qui gagne aussi +1 par tour gagnant.
- Achat du bonus : 67× la mise. Gain max : 5 000× la mise.
- RTP simulé : environ 96 % (non certifié).

## À faire

- Visuels finaux du wild (mégaphone), du scatter (barricade) et de l'euro doré.
- Retirer « MONOPRIX » et « POLICE NATIONALE » des visuels avant toute soumission.
- Porter les maths et l'interface vers les outils de Stake Engine.
