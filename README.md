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
| `sim.js` | Simulation du RTP : `node sim.js 2000000` |
| `serve.js` | Petit serveur local |
| `assets/symbols/` | Symboles détourés (PNG 512×512, fond transparent) |
| `assets/bg.jpg` | Décor de fond (version allégée) |
| `assets/source/` | Visuels d'origine (planches et fond en pleine taille) |
| `tools/detourer.js` | Découpe et détourage d'une planche (demande `npm i sharp`) |

## Règles actuelles

- 5 rouleaux × 3 rangées, 20 lignes fixes.
- 8 symboles : jerrican, porte-monnaie vide, ticket de caisse, gilet jaune, pavé, fumigène, poubelle en feu, CRS.
- Wild : pancarte « RÉVOLTE » (rouleaux 2 à 4). Scatter : barricade (3/4/5 → 10/12/15 tours gratuits).
- Insurrection : les wilds recouvrent leur rouleau, le multiplicateur d'inflation gagne +1 par tour gagnant.
- Achat du bonus : 66× la mise. Gain max : 5 000× la mise.
- RTP simulé : environ 96 % (non certifié).

## À faire

- Visuels finaux du wild (pancarte) et du scatter (barricade).
- Retirer « MONOPRIX » et « POLICE NATIONALE » des visuels avant toute soumission.
- Porter les maths et l'interface vers les outils de Stake Engine.
