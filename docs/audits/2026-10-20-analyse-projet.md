# Analyse du projet Aven — v10.2.2

> **Date** : 20 octobre 2026
> **Version analysée** : `package.json` → `10.2.2` (branche `main`, `7b0cc10`)
> **Méthode** : lecture du code de production, puis exécution réelle des contrôles du
> projet (`typecheck`, `npm test`, `npm run verify`, `cargo check`, `cargo test`,
> `tsc -b`, `vite build`) et mesure d'un banc d'essai temporaire pour les notes.
> Aucune modification du code n'est incluse dans cet audit.
> Les constats sont cités en `fichier:ligne`. Ce qui n'a pas été mesuré est dit
> explicitement (§7).

---

## 1. Verdict

Aven est un projet **au-dessus de la moyenne** : une seule pile (Tauri + host Node),
des modules purs réellement testés, des écritures atomiques, un journal de versions
honnête et une chaîne `npm run verify` qui tient debout. Le contrat `AGENTS.md` n'est
pas décoratif : les 25 sondes de la chaîne passent, et elles ont visiblement déjà
attrapé des régressions réelles.

Deux familles de dettes ressortent, et elles sont liées :

1. **La migration v10.0.0 (Electron → Tauri) a laissé des organes morts en place**
   — dont un registre d'espaces complet et une politique de notification doublée —
   et **des tests qui gardent ces organes morts** au lieu du code vivant (§5.1).
   C'est le seul endroit où le projet se raconte une histoire fausse.
2. **Les sondes vérifient la forme du code, pas son effet.** Elles constatent qu'un
   `.bak` est écrit (jamais relu), qu'un `role="dialog"` présent est complet (six
   dialogues n'en ont pas), qu'un module existe (quatre n'ont aucun importeur). Le
   contrat est mesuré ; le bénéfice promis, non (§5.2, §5.5, §5.10).

À côté de cela, un vrai défaut de performance mesuré : **ouvrir une note coûte un
balayage complet de la base, plusieurs fois** (§5.3) — 4,8 s sur 500 notes dans le
banc d'essai.

---

## 2. Contrôles exécutés

| Commande | Résultat | Note |
|---|---|---|
| `npm ci --ignore-scripts` (racine) | exit 0, 26 paquets | le dépôt livré n'a pas de `node_modules` ; sans lui un test échoue |
| `npm run typecheck:host` | **exit 0** | avant installation : `tsc` introuvable (environnement, pas le code) |
| `npm run typecheck:tests` | **exit 0** | — |
| `npm test` | **exit 0 — 169 tests, 169 passés** | après installation ; le seul échec initial était `ERR_MODULE_NOT_FOUND` (`@opencode/client`) |
| `npm run build:host` | exit 0 | 3 bundles : app-host, engine-host, pty-host |
| `npm run verify` | **exit 0 — 25 sondes** | `conventions`, `docs`, v8.8.0 → v10.2.2, `verify-build` (32 modules, 18 sondes de contenu) |
| `cd web && npm ci` | exit 0, 205 paquets | `web/` a son propre verrou |
| `cd web && npx tsc -b` | **exit 0** | — |
| `cd web && npm run build` | **exit 0** | 1 098,71 kB JS (346,38 kB gzip) en **un seul chunk** + 75,75 kB CSS |
| `node scripts/prepare-tauri-runtime.mjs` | exit 0 | Node 22.14.0 embarqué, SHA-256 vérifié (prérequis du `cargo check`) |
| `cargo check` | **exit 0**, aucun avertissement | échoue **avant** préparation du runtime : `resource path resources\nodejs\node.exe doesn't exist` |
| `cargo test` | **exit 0 — 14 tests Rust** | notifications, budget de redémarrage, noms d'espaces, injection d'état |

Banc d'essai des notes (script temporaire hors dépôt, `mkdtemp`, Windows, antivirus
actif — donc chiffres absolus pessimistes, **facteurs** fiables) :

| Opération | 200 notes | 500 notes |
|---|---|---|
| `listNotes` (une passe) | 378 ms | 1 251 ms |
| `notesTree` | 281 ms | 3 550 ms |
| `searchNotes` | 269 ms | 2 138 ms |
| `noteLinks` (5 wikilinks) | **1 127 ms** | **4 842 ms** |
| `backlinks` | 296 ms | 654 ms |

---

## 3. Carte du code (mesurée)

| Zone | Fichiers | Lignes |
|---|---|---|
| `host/` (moteur Node) | 32 | 4 487 |
| `web/src/` (renderer React) | 29 | 5 652 |
| `src-tauri/src/` (coque Rust) | 7 | 1 429 |
| `tests/` | 29 (27 `.test.mjs`) | 2 327 |
| `scripts/` | 45 (34 sondes) | 4 570 |

Plus gros fichiers : `web/src/App.tsx` (1 700), `web/src/App.css` (1 090),
`host/aven-app-host.ts` (815), `src-tauri/src/runtime.rs` (515),
`web/src/FreebuffAgentPage.tsx` (427).

Architecture réelle, conforme à la doc :

```
webview React (api.* typée)
   → invoke("aven_call")            src-tauri/src/commands.rs
      ├─ Rust : espaces, chemins système, fichiers exportés, notifications, vue
      └─ runtime Node (JSON-RPC stdio)  host/aven-app-host.ts
            → host/aven-engine-host.mjs → opencode serve (HTTP local)
```

---

## 4. Ce qui est solide (à ne pas casser)

- **Une seule porte IPC** (`aven_call`) avec parité typée des deux côtés
  (`web/src/types.ts` ↔ dispatch `host/aven-app-host.ts` ↔ `src-tauri/src/commands.rs`).
  Aucun `invoke` dans un composant.
- **Modules purs + tests** : `model-ref`, `priorities`, `router`, `notify`, `notes`,
  `workspace-files`, `freebuff-pty`, `voice-intent`, `arrow-navigation`,
  `view-transitions`… La logique décisionnelle n'est pas enfouie dans les handlers.
- **Sécurité** : clés chiffrées DPAPI côté host, seuls des booléens remontent ;
  CSP `default-src 'self'` sans `unsafe-eval` ; `safeResolve` refuse absolus et `..`
  (`host/workspace-files.ts:37`) ; liste blanche d'URL (`src-tauri/src/shell.rs:38`).
- **Durabilité** : `writeTextAtomic` est réellement utilisé pour les notes, les
  métadonnées, `settings.json` et `prefs.json` ; reprise du runtime Node après crash
  avec budget de 3 relances/minute **testé** (`src-tauri/src/runtime.rs:36`).
- **Documentation vérifiée** : `verify-docs.mjs` refuse un module cité qui n'existe
  pas, un compteur recopié à la main, un audit mal nommé. Peu de projets vont jusque-là.

---

## 5. Constats

### 5.1 — P1 : quatre modules `host` morts, et des tests qui les gardent

Depuis que Rust possède le registre d'espaces et les notifications (v10.0.0), quatre
modules n'ont **aucun importeur de production** (mesuré : recherche d'import dans
`host/` + `web/src/`) :

| Module mort | Remplacé par | Tests qui le gardent |
|---|---|---|
| `host/workspaces.ts` | `src-tauri/src/workspaces.rs` | `tests/workspaces.test.mjs:14` — **8 tests** |
| `host/notify-policy.ts` | `src-tauri/src/notify.rs` | `tests/notify-policy.test.mjs:3` |
| `host/prefs.ts` | `aven-app-host.ts:374-407` (copie inline) | — |
| `host/settings.ts` | ré-export de `workspace-seed.ts` (ré-export mort) | — |

Conséquences concrètes, au-delà du ménage :

- **Le déséquilibre de test est inversé** : 8 tests couvrent le registre Node mort,
  2 tests couvrent le registre Rust vivant (`src-tauri/src/workspaces.rs:148`).
  Les 169 tests « verts » ne mesurent donc pas ce qui tourne.
- **La duplication a déjà divergé** : la version morte écrivait atomiquement
  (`host/workspaces.ts:33` → `writeJsonAtomic`), la version vivante écrit en place
  (`src-tauri/src/workspaces.rs:62` → `std::fs::write`). Voir §5.4.
- La règle « un module cité doit être vivant » (`AGENTS.md` §7) ne s'applique qu'aux
  modules **cités dans la doc** : ces quatre-là n'étant cités nulle part,
  `verify-docs` reste vert.

**Correctif** : supprimer les quatre modules et les deux fichiers de test associés
(ou les déplacer en `tests/legacy/` avec un en-tête explicite), puis ajouter à
`verify-conventions.mjs` une règle « tout `host/*.ts` a un importeur ou est une entrée
de build » — c'est la règle §7 appliquée à la réalité du disque, pas à la prose.

### 5.2 — P1 : six dialogues sur sept n'ont pas de rôle ARIA, et la sonde ne peut pas le voir

`AGENTS.md` §12.1 exige pour chaque dialogue : `role="dialog"` + `aria-modal="true"`
+ `aria-label`. État mesuré :

| Dialogue | `role="dialog"` |
|---|---|
| Toutes les conversations (`App.tsx:1183`) | ✅ |
| Choix d'espace (`App.tsx:1436`) | ❌ |
| Autorisation d'outil (`App.tsx:1684`) | ❌ |
| Formulaire de question (`FormDialog.tsx:68`) | ❌ |
| Réglages (`SettingsDialog.tsx:301`) | ❌ |
| Notes (`NotesView.tsx:262`) | ❌ |
| Fichiers (`FilesView.tsx:68`) | ❌ |

La sonde 9c (`scripts/verify-conventions.mjs:153`) ne valide que les `role="dialog"`
**déjà présents** : elle vérifie qu'ils sont complets, jamais qu'ils existent. Un
lecteur d'écran annonce donc sept surfaces modales comme du contenu ordinaire.
`FormDialog.tsx:77-78` ajoute deux boutons sans classe `.button` (règle §4) et sans
`type="button"`.

**Correctif** : une assertion qui balaie `<div className="dialog` (et
`home-modal-overlay`) dans les fichiers `.tsx` — pas une liste manuelle — et exige
`role="dialog"` + `aria-modal` + `aria-label` sur chacun.

### 5.3 — P1 : ouvrir une note balaie la base plusieurs fois (coût mesuré)

`noteLinks` résout chaque wikilink en appelant `resolveWikilink`
(`host/notes.ts:319`), qui appelle `listNotes` — et `listNotes` relit **tous** les
fichiers de la base (`host/notes.ts:59`). Pour 5 liens : cinq balayages complets.
`backlinks` (`host/notes.ts:348`) en ajoute un sixième. Le renderer déclenche les
deux **à chaque sélection** (`web/src/NotesView.tsx:96-97`), et `notesTree`
lui-même refait un parcours complet après `walkFolders` (`host/notes.ts:292-301`).

Mesuré (banc, Windows, antivirus actif) : **1,1 s à 200 notes, 4,8 s à 500 notes**
pour `noteLinks` seul ; `notesTree` 3,5 s à 500 notes. L'IPC étant sérialisé (§5.6),
c'est toute l'interface qui attend.

S'ajoute un coût linéaire en IPC : à chaque changement d'arbre, `NotesView` demande
les tags **de chaque note**, un appel IPC par note (`web/src/NotesView.tsx:65-78`) —
500 notes = 500 allers-retours Rust ⇄ Node.

**Correctif** : charger la base une fois par opération (`listNotes` mémoïsé par
`mtime` du dossier, ou une fonction `resolveMany(workspace, targets)` qui prend la
liste en paramètre), et une seule commande `noteTagsAll` au lieu de N appels.
Un test de coût borné, comme celui de v9.6.1 pour le transcript, garderait la
régression à distance.

### 5.4 — P2 : `workspaces.json` n'est ni atomique ni récupérable

`src-tauri/src/workspaces.rs:62` écrit le registre avec `std::fs::write` (troncature
en place), alors que `AGENTS.md` §7 impose temp + remplacement pour tout fichier de
données. Un crash pendant l'écriture laisse un JSON partiel ; et
`read_workspace_store` (`src-tauri/src/workspaces.rs:26`) **renvoie une erreur** au
lieu de récupérer : `state` échoue, l'écran de choix d'espace ne s'affiche pas, l'app
reste sur un bandeau d'erreur sans issue. Aucun `.bak`, aucune quarantaine, aucune
trace du fichier fautif.

À comparer au traitement de `settings.json` (v10.2.1) : atomic + `.bak` + journal.
Le fichier qui décide **si l'app démarre** est moins protégé que celui des clés.

**Correctif** : écriture temp + `rename` (côté Rust) et, à la lecture, si le JSON est
illisible → renommer en `workspaces.json.corrupt-<date>`, logguer, repartir sur un
registre vide (l'écran de choix est déjà géré).

### 5.5 — P2 : le `.bak` de `settings.json` est écrit, jamais relu

`host/aven-app-host.ts:166-183` copie le dernier état lisible dans `settings.json.bak`
avant d'écrire. Recherche d'un `.bak` **en lecture** dans tout `host/` : aucun. Si
`settings.json` est corrompu, `loadKeys` se contente d'un `console.error`
(`host/aven-app-host.ts:191-197`) et repart sans clés. La sonde
(`scripts/verify-v10.2.1.mjs:52`) vérifie que la copie est **écrite** — pas qu'elle
sert. C'est le schéma général : la sonde fige le geste, pas le bénéfice.

**Correctif** : dans `loadKeys`, sur erreur de parsing, tenter `settings.json.bak`,
et ne journaliser l'échec qu'après la tentative ; tester le chemin de reprise
(JSON tronqué → clés retrouvées depuis `.bak`).

### 5.6 — P2 : toutes les commandes IPC sont sérialisées derrière un verrou tenu pendant l'appel

`src-tauri/src/runtime.rs:454-463` prend `state.node` (un `Mutex`) et **le garde
pendant `runtime.call(...)`**, avec un délai de 120 s. Chaque `aven_call` qui atteint
le runtime attend donc le précédent. Un appel lent bloque tout : `freebuffCliLaunch`
(`cmd.exe` 8 s + WMI 10 s), `setKey` (PowerShell DPAPI + redémarrage moteur),
`voiceTranscribe` (réseau Groq) — pendant lesquels `api.state()`, la liste des
conversations et les notes ne répondent plus.

**Correctif** : cloner l'`Arc<NodeRuntime>` hors du verrou (le verrou ne protège que
le `Option`), puis appeler sans le tenir. L'atomicité par appel est déjà assurée par
le canal `pending` (id → `Sender`).

### 5.7 — P2 : `App.tsx` est un monolithe, et la logique de navigation n'est pas testée

1 700 lignes, 21 `useState`, 15 `useEffect`, plus de 40 `setShow*` : les panneaux
(Notes, Fichiers, Réglages, Tâches, Freebuff, deux sélecteurs, formulaires) sont
coordonnés à la main. Deux conséquences observées :

- **Ordre d'Échap** : une cascade de `else if` (`App.tsx:598-608`) qu'aucun test ne
  couvre — chaque nouveau panneau doit être inséré au bon rang, à la main.
- **Fermeture de Notes/Fichiers** : `closeNotesToHome` (`App.tsx:364`) force
  `showHome = true`. Or `openNotesView` (`App.tsx:380`) ne masque pas l'accueil :
  ouvert depuis une conversation, « Fermer » ou Échap **quitte la conversation pour
  le hub**, alors que le commentaire promet « la fermeture rend l'écran d'origine ».
  Le comportement n'est pas faux par accident : c'est le nom de la fonction qui a
  décidé du comportement.

C'est exactement le cas que `AGENTS.md` §8 décrit : la logique décisionnelle devrait
vivre dans un module pur. Un petit réducteur `panels` (`{ home, chat, notes, files,
settings, … }` + `open/close/escape`) serait testable en `.test.mjs` et supprimerait
la cascade.

### 5.8 — P3 : un seul chunk de 1,1 Mo pour tout le renderer

`vite build` : 1 098,71 kB (346 kB gzip) dans `index-*.js`. TipTap (~2.27) et son
starter-kit ne servent qu'à l'éditeur de notes ; xterm ne sert qu'à la page Freebuff ;
`highlight.js` ne sert qu'au rendu de code. Tout est chargé au premier pixel, sur une
app qui affiche d'abord un hub statique. Un `lazy()` sur `FreebuffAgentPage` et
`NoteEditor` sortirait probablement 40 % du poids du démarrage. Non mesuré dans cet
audit : le gain réel après découpage.

### 5.9 — P3 : les sondes ne voient que les fichiers listés à la main

`scripts/verify-conventions.mjs:75` énumère dix fichiers `.tsx`. `web/src/NoteEditor.tsx`
n'y est pas : aujourd'hui il respecte les règles (icônes `<Icon>`, `aria-label`
français), mais rien ne le garantit. Le prochain composant échappera de la même
façon aux règles icônes / ARIA / boutons. Un `readdirSync("web/src")` filtré sur
`.tsx` (moins `icons/Icon.tsx`) supprimerait la dérive.

### 5.10 — P3 : `verify-build` ne regarde jamais le bundle du renderer

`scripts/verify-build.mjs` ne contrôle que `dist-host/` (fraîcheur des modules `host`
+ marqueurs de contenu). Or `src-tauri/tauri.conf.json:10` empaquette
`../web/dist`. **Mesuré pendant cet audit** : `verify-build` a répondu « OK (32
modules, 18 sondes) » alors que `web/dist` n'existait pas encore. Un bundle renderer
périmé (sources modifiées, seul `build:host` relancé) passerait donc toutes les
sondes, alors qu'il part dans l'installeur.

**Correctif** : ajouter à `verify-build.mjs` la même paire de contrôles pour
`web/dist` (mtime de `index.html` ≥ dernier `.tsx` modifié + marqueur de version) et
nommer `npm run build:web` dans le message d'échec.

### 5.11 — P3 : deux écarts mineurs repérés en passant

- **`saveKey` réécrit un schéma fermé** : `host/aven-app-host.ts:233` construit
  `{ keysEnc }` (plus l'ancien `openrouterKeyEnc`) puis remplace tout le fichier —
  tout autre champ futur de `settings.json` serait silencieusement perdu. Un
  `{ ...stored, keysEnc }` suffirait.
- **`searchNotes`** (`host/notes.ts:366`) calcule la position de l'extrait sur le
  texte **normalisé** (accents retirés) puis découpe le markdown **brut** : sur un
  texte accentué, l'extrait peut être décalé de quelques caractères. Cosmétique,
  mais faux par construction.

---

## 6. Priorisation proposée

| # | Constat | Impact | Effort | Ordre |
|---|---|---|---|---|
| 5.1 | Modules morts + tests trompeurs | confiance dans la suite de tests | 1 h | **1** |
| 5.2 | Rôles ARIA des dialogues | accessibilité, règle du projet violée | 1 h | **2** |
| 5.5 | `.bak` jamais relu | perte de clés silencieuse | 1 h | **3** |
| 5.4 | `workspaces.json` non atomique | app bloquée si corruption | 2 h | **4** |
| 5.3 | Notes quadratiques | 4,8 s à 500 notes | 1 j | **5** |
| 5.6 | IPC sérialisé | interface figée pendant les appels lents | 1 h | **6** |
| 5.7 | `App.tsx` + fermeture Notes | maintenabilité, régression UX | 2 j | 7 |
| 5.8 | Chunk unique | démarrage | ½ j | 8 |
| 5.10 | `verify-build` aveugle au renderer | un installeur peut partir périmé | ½ h | 9 |
| 5.9 | Sondes par liste + 5.11 | dette de vérification | ½ h | 10 |

Les cinq premiers sont indépendants et corrigeables sans toucher au contrat
`AGENTS.md`. Les 5.1, 5.2, 5.5, 5.9 demandent **règle + sonde dans le même
changement** (§ « Amender une règle »), sinon la sonde suivante repassera à côté.

---

## 7. Ce que cet audit n'a pas mesuré

- **L'app lancée** : aucun parcours CDP dans cette session — les constats UX
  (5.7) sont lus dans le code, pas observés à l'écran.
- **Freebuff** (CLI, PTY, reprise de session), **dictée Groq**, **notifications
  Windows**, **dialogues natifs** : dépendent de clés, d'un CLI installé ou
  d'effets système ; non exercés ici.
- **Thème sombre et contrastes** : non re-mesurés (couverts par
  `verify-v10.2.0.mjs`).
- **Performance des notes sur un vrai espace** : le banc utilise un dossier
  temporaire ; les facteurs (×3 à ×5 pour `noteLinks`) sont fiables, les valeurs
  absolues sont pessimistes.
- **Gain réel du découpage de bundle** (5.8) : non chiffré.
- **Installateurs** (`npm run tauri:build`) : non produits (long, hors périmètre).
