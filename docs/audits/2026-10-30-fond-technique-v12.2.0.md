# v12.2.0 — fond technique de l'accueil et bâti lié à la phase

Séance du 2026-10-30, suite de `2026-10-30-accueil-editorial-v12.1.0.md`. Ce document
dit ce qui a été **mesuré** et ce qui reste ouvert.

## 1. Ce qui est ajouté

- **Couche de fond décorative** (`wb-home-field`, v12.2.0) : deux lueurs de densité,
  des courbes de niveau (`repeating-radial-gradient` masqué au centre), une ligne de
  construction graduée et un repère en croix. Elle est `aria-hidden`, en
  `pointer-events: none`, sous `overflow: hidden`, et la composition passe au-dessus
  (`z-index: 1`). Aucun texte, aucune coordonnée, aucune mesure : ce sont des tracés.
- **Bâti lié à la phase réelle** : `data-phase={voice.phase}`. Réflexion → anneaux
  qui s'allument ; écoute → halo du nœud ; capture → nœud élargi ; parole → nœud plus
  large encore. Ce sont des changements d'état transitionnés (tokens de temps), pas
  des animations.

## 2. Décision : aucune boucle ambiante ajoutée

Le premier jet animait les anneaux et le nœud en `infinite`. La sonde v10.3.2 plafonne
les boucles ambiantes à 6 et a refusé les 5 déclarations supplémentaires — elle a
raison : le mouvement vivant de l'accueil est la **sphère**, qui lit déjà l'énergie
réelle du micro. Le bâti signale donc un état par sa forme, sans consommer de boucle.
Conséquence : aucun changement du plafond, aucune exception ajoutée à la règle.

## 3. Mesures

| Contrôle | Résultat |
|---|---|
| `npm test` | 444 tests, 444 pass |
| `cd web && npx tsc -b` | OK |
| `npm run build:web` | OK |
| `npm run verify` | chaîne complète verte (sonde v12.2.0 incluse) |
| `npm run visual:prod` | OK sur le binaire embarquant `web/dist`, thèmes clair et sombre capturés |
| `npm run test:features` | **OK, 0 échec, 0 avertissement** : 1280×820, 1024×700 et 900×680 sans débordement, titre entier, DOM 131 nœuds (+4), zéro erreur console |
| Contrastes | clair 15,64:1 / 15,93:1 ; muted 5,75:1 / 6,98:1 (mesurés par le parcours) |

Captures : `artifacts/prod-poste-light.png`, `artifacts/prod-poste-dark.png`
(1366 × 700).

## 4. Limites

- **Troisième entrée « Reprendre » (dernier fichier consulté)** : non affichée. Aven
  ne conserve aucune trace d'ouverture de fichier ; en fabriquer une serait un faux
  historique, et un historique local au renderer mélangerait les espaces de travail.
  Il faut une commande host + le dossier de métadonnées de l'espace — travail
  distinct, non réalisé.
- **« Rechercher un fichier »** : toujours nommé « Parcourir les fichiers », la vue
  Fichiers n'offrant aucune recherche.
- **Sphère en thème clair** : lisible mais douce ; aucun ratio mesuré sur le canvas.
- **Calottes décalées** : la calotte éclairée reste décalée du maillage de points —
  dessin existant, non modifié ; savoir si c'est voulu demande une décision graphique.
- **Écran étroit empilé (< 720 px)** : règles écrites, non observées.
- Une capture sombre a été prise sans espace actif (« Aucun espace ») : la mise en
  page tient, mais ce n'est pas l'état d'un utilisateur configuré.
