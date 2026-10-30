# v12.1.0 — CI Windows verte et accueil éditorial

Séance du 2026-10-30. Ce document dit ce qui a été **mesuré**, ce qui n'a pas pu
l'être, et ce qui reste ouvert. Les constats non vérifiés sont présentés comme tels.

## 1. Pourquoi la CI était rouge (mesuré, pas supposé)

Deux défauts distincts, tous deux invisibles sur la machine de développement.

### 1.1 `npm run verify` échouait seulement sur le runner

`actions/checkout` écrit le dépôt en **CRLF** sur `windows-latest`. La sonde
`scripts/verify-v11.16.0.mjs` découpait une fonction avec le repère `"\n}"` : la fin
n'était plus trouvée, `slice()` rendait **tout le reste du fichier**, et son
`assert.doesNotMatch(..., /String\(draft \?\? ""\)/)` tombait sur du code correct.

Reproduction : arbre de travail Git jetable (`git -c core.autocrlf=true worktree add`),
la chaîne `npm run verify` échouait au même endroit, avec la même assertion. Après
normalisation des fins de ligne à la lecture, la chaîne entière passe dans cet arbre.

### 1.2 `cargo check` échouait dans `tauri.yml`

`tauri.conf.json` déclare `resources/pocket-tts/` comme ressource embarquée. Ce
dossier (binaire de 22 Mo) n'est **pas versionné** — `src-tauri/resources/` est dans
`.gitignore`. Sur un runner neuf il n'existe pas :

```
error: failed to run custom build command for `aven v12.0.0`
resource path `resources\pocket-tts` doesn't exist
```

Reproduit localement en renommant le dossier. `scripts/prepare-tauri-runtime.mjs`
(celui qui prépare déjà `node.exe`, exécuté **avant** cargo dans les deux workflows)
pose désormais le dossier vide : le moteur local est introuvable, la voix retombe sur
Windows en le disant — le repli existe depuis v11.15.1.

### 1.3 Résultat

Commit `6e71764`, les trois workflows passent : `CI` (Linux), `Tauri Windows CI`
(tests + bundles NSIS/MSI) et `CI Windows` (typechecks, tests, verify, cargo check,
cargo test, build Tauri debug, **fumée WebView2 réelle**). Les étapes Rust et la
fumée, jusqu'ici `skipped` derrière l'échec de `verify`, ont donc réellement tourné.

## 2. Accueil éditorial (v12.1.0)

### 2.1 Ce qui change

- Le titre monumental `clamp(44px, min(9vw, 18vh), 170px)` est **retiré** : le brief
  du 2026-10-30 (partie 4.1) le juge « remplissage plutôt que composition ».
  `--font-size-display` devient `clamp(30px, min(4.6vw, 8.6vh), 76px)`, toujours
  réservé au titre d'accueil (AGENTS.md §2 mis à jour dans le même changement).
- L'accueil est une grille à trois zones : identité + micro + état à gauche, sphère
  et anneaux de construction à droite, ligne basse pour reprendre / agir / dire le
  mode de délégation.
- « Reprendre » : au plus deux entrées, uniquement des conversations et des notes
  réellement chargées, avec leur âge. La sélection vit dans
  `web/src/workbench/resume.ts` (module pur, 8 tests). Sans donnée, la zone
  disparaît — aucun historique de démonstration.
- Trois actions réelles : nouvelle conversation, dicter une note (ouverture de la
  capture de la vue Notes), parcourir les fichiers.

### 2.2 Écart assumé avec le brief

Le brief demande « Rechercher un fichier ». La vue Fichiers **n'a pas de recherche**
(`web/src/FilesView.tsx` n'expose que la navigation dossier par dossier). L'action
s'appelle donc « Parcourir les fichiers » : une action se nomme par ce qu'elle fait
(AGENTS.md §4 et §6). La recherche de fichiers est un travail distinct, non réalisé.

### 2.3 Mesures

| Contrôle | Résultat |
|---|---|
| `npm test` | 444 tests, 444 pass (8 nouveaux pour `resume.ts`) |
| `cd web && npx tsc -b` | OK |
| `npm run typecheck:host` | OK |
| `npm run build:web` | OK (build de production) |
| `npm run verify` | chaîne complète verte, `build : OK (41 modules, 18 sondes)` |
| `npm run visual:prod` | OK sur le binaire debug embarquant `web/dist` : origine `tauri.localhost`, CSP bloque l'extérieur, accueil monté, thèmes clair et sombre capturés |
| Captures | `artifacts/prod-poste-light.png`, `artifacts/prod-poste-dark.png` (1366 × 700) |

### 2.4 Limites et ce qui n'est pas vérifié

- **Contraste de la sphère en thème clair** : elle reste lisible mais douce — le
  disque suit `--panel-solid` (papier) sur un fond papier. Aucun ratio mesuré ;
  l'ajuster demande une décision graphique, pas un correctif mécanique.
- **Géométries étroites** : seule 1366 × 700 a été capturée dans cette séance. La
  mise en page empilée sous 720 px est écrite mais **non observée**.
- **Parcours vocaux réels** : non rejoués dans cette séance (micro physique). Les
  sondes et tests purs couvrent la logique, pas l'audio de la WebView.
- **Ambiguïté de la « calotte »** : sur la capture, la calotte éclairée est décalée
  du maillage de points. C'est le dessin existant (v12.0.0), non modifié ici ; il
  faudrait une décision graphique pour savoir si le décalage est voulu.
- Le brief de la partie 4.2 demandait aussi des « lignes topographiques » : seuls
  deux arcs incomplets, un trait et un nœud d'accent ont été ajoutés. Le fond reste
  la grille de points existante.
