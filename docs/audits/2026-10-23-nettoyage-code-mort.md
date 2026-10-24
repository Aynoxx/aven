# Nettoyage du code mort — 2026-10-23

**Portée** : dépôt entier, version courante 11.1.3. Objectif : supprimer ce qui n'est plus
relié au code exécuté (fichiers, sondes, tests, sélecteurs CSS, artefacts locaux).

**Méthode mesurée**, pas déclarative :

1. graphe d'importeurs réel (chemins relatifs résolus, `.ts`/`.tsx`/`.mjs`), puis
   confirmation par `grep` fichier par fichier ;
2. `npm run typecheck:host`, `npm test`, `npm run verify` avant et après ;
3. `tsc -b` côté `web/` — il a d'ailleurs démenti une conclusion hâtive (voir §5.1) ;
4. comparaison des sélecteurs CSS de `web/src/styles/*.css` avec les classes réellement
   écrites dans les `.ts`/`.tsx`, commentaires exclus.

Une conclusion non mesurée est signalée comme telle (§7).

## 1. Le build host ne compilait plus — un bloc TTS mort en était la cause

`host/voice-agent-speech.ts` portait, après la synthèse Windows System.Speech, une
seconde famille de fournisseurs jamais branchée : Edge TTS (`import("msedge-tts")` sur une
dépendance absente du `package.json`) et Piper (sidecar `python3`). Aucun importeur, aucun
test, et cinq erreurs de compilation :

- `host/voice-agent-speech.ts:279` — `speakWithWindowsVoice` appelée avec 2 arguments sur 3 ;
- `host/voice-agent-speech.ts:309` — module `msedge-tts` introuvable ;
- `host/voice-agent-speech.ts:325`, `:368` — `any` implicites et `stderr` possiblement nul.

Conséquence mesurée : `npm run build:host` sortait en **exit 2**, donc `npm run verify`
échouait sur `verify-build` (dist-host périmé). Le bloc a été supprimé ; le type
`VoiceTurn` (utilisé par `answerVoiceQuestion`) a été conservé à sa place logique.
La synthèse reste Windows System.Speech — seul chemin gratuit, hors ligne, sans
conservation d'audio, conformément au plan de la v11.1.0.

## 2. Neuf sondes 8.7.x orphelines et définitivement rouges

`scripts/verify-v8.7{,.2,.3,.4,.5,.6,.7,.8,.9}.mjs` figeaient une version qui n'existe
plus (`assert.equal(pkg.version, "8.7.4")` face à `11.1.3`) ou lisaient `host/main.ts` et
`host/preload.cts`, supprimés avec Electron en v10.0.0. Cinq d'entre elles avaient encore
une entrée `npm run verify:v8.7*` ; aucune n'était dans la chaîne `verify`, ce qui
explique qu'elles pourrissaient sans bruit. Fichiers et entrées npm supprimés.

**Règle amendée dans le même changement** (AGENTS.md §11) : une sonde dont le sujet a
été supprimé se retire avec lui, et toute sonde présente dans `scripts/` doit être
appelée par `npm run verify`. La sonde est le contrôle ajouté en fin de
`scripts/verify-conventions.mjs` (§10) : elle aurait attrapé ces neuf orphelines.

## 3. Quatre modules sans importeur en production

Constats déjà écrits dans `docs/audits/2026-10-17-revue-complete-v10.2.0.md`
(annexe A) et restés sans suite :

| Module | Importeurs production | Sort |
|---|---|---|
| `host/prefs.ts` | 0 (le host a sa propre implémentation) | supprimé |
| `host/workspaces.ts` | 0 (le registre vit dans `src-tauri/src/workspaces.rs`) | supprimé |
| `host/notify-policy.ts` | 0 (la politique vit dans `src-tauri/src/notify.rs`) | supprimé |
| `host/settings.ts` | 0 (ré-exportation de `workspace-seed.ts`) | supprimé |

Leur suppression entraînait celle de `tests/workspaces.test.mjs` et
`tests/notify-policy.test.mjs` : la suite passe de 265 à 251 tests, sans échec. Les
sondes qui inspectaient un fichier mort ont été recâblées :

- `scripts/verify-v9.1.5.mjs` lit désormais `src-tauri/src/workspaces.rs` ;
- `scripts/verify-v9.1.0.mjs` et `scripts/verify-v10.0.0.mjs` lisent `notify.rs` ;
- `scripts/verify-v9.0.1.mjs` lit `workspace-seed.ts` directement ;
- `scripts/verify-v9.5.0.mjs` lit `aven-app-host.ts` (le vrai écrivain des préférences) ;
- `tests/agent-sync.test.mjs` importe `workspace-seed.ts` : sa couverture est conservée,
  seul le point d'entrée change.

## 4. Sélecteurs CSS sans composant

Retirés dans `chrome.css`, `dialogs.css`, `voice-notes.css`, `freebuff.css`,
`pages.css`, `workbench.css` et `da.css` : `.brand` (le rail pose `brand-mark`),
`.chat-titlebar`, `.session-id`, `.notes-dir-row`, `.agent-card-chats`,
`.voice-ring*`, `.voice-mic`, `.bridge-actions`, `.unified-settings-header`,
`.settings-tabs`, `.titlebar-rename`, `.notes-item-tags`, `.notes-editor-textarea`,
`.assistants-map*`, `.assistants-freebuff*`, `.agent-quick*`, `.agent-composer*`,
`.tasks-principal-actions`, `.agents-page-header`, `.agents-grid`, `.agent-card-actions`,
`.readonly-badge`, `.agent-card-chats-more`, et les primitives `da.css` jamais posées
(`.wb-mono`, `.wb-rule`, `.wb-grid`, `.wb-corners`, `.wb-ruler`).

**Deux exceptions assumées** :

- `.sidebar-left` / `.sidebar-right` : conservés. Le réglage « Position de la barre
  latérale » existe toujours (`web/src/SettingsDialog.tsx:235`,
  `web/src/appearance.ts:15`) mais aucun composant n'appliquait la classe — voir §5.2
  (corrigé en v11.1.4) ;
- `.ProseMirror-focused` : faux positif, classe posée par TipTap et consommée par
  `:has(...)` (`web/src/styles/voice-notes.css:43`, exigée par AGENTS.md §12.2).

Trois sondes vérifiaient ces règles mortes et ont été réalignées sur l'élément vivant
(`verify-v10.3.2` onglets, `verify-v10.3.1` micro du hub, `verify-v10.2.0` h1 de vue et
`:active`), une quatrième est devenue plus stricte (`verify-v9.1.4` : la grille visée
n'existe plus, l'invariant « auto-fit » est vérifié sur `.stats-grid` ; `verify-v9.4.0` :
le tableau Assistants est désormais absent du CSS, pas seulement masqué).

## 5. Défauts trouvés en chemin

### 5.1 Une conclusion fausse corrigée à temps

`web/src/icons/index.ts` avait été classé mort (aucun `from "./icons/index"`). `tsc -b` a
prouvé le contraire : onze fichiers importent le dossier (`from "../icons"`). Le fichier a
été restauré à l'identique.

### 5.2 Le réglage « Position de la barre latérale » ne fait rien — non corrigé

`appearance.sidebarPosition` est lu par les Réglages et écrit dans les préférences, mais
`web/src/pages/ConversationPage.tsx:246` ne compose que `workspace-layout` et
`sidebar-hidden` : ni `sidebar-left` ni `sidebar-right` n'est jamais posé. Le réglage est
inerte depuis la v11.0.1. Hors périmètre de ce nettoyage (c'est une correction de
comportement), signalé ici pour ne pas l'enterrer.

**Suivi (v11.1.4)** : corrigé. `ConversationPage` pose `sidebar-${appearance.sidebarPosition}`
sur la grille, et les règles CSS visent l'élément lui-même (`.workspace-layout.sidebar-right`)
avec leur variante ≤ 860 px. La sonde `scripts/verify-v11.0.1.mjs` vérifie désormais les
deux moitiés de la chaîne : la classe appliquée et la règle qui la consomme.

### 5.3 Une règle CSS cassée réparée

`web/src/styles/chrome.css` contenait `.dictation-button.dictation-recording.dictation-paused,`
suivi d'un commentaire puis d'une ligne vide : la virgule orpheline rattachait la règle
suivante (`.workspace-picker`) à ce sélecteur, et l'état « dictée en pause » n'avait plus
de déclaration. Réparé en `{ animation: none; }`, conforme au commentaire survivant
(« le pulse s'arrête »).

## 6. Artefacts locaux

Supprimés : `artifacts/` (40 captures d'audits antérieurs, gitignoré, régénérable par
`scripts/visual-prod-tauri.mjs`), `build/icon.png` (vestige electron-builder, l'icône
Windows vient de `src-tauri/icons/icon.ico` via `scripts/build-app-icon.mjs`), et les
quatre journaux à la racine (`smoke-tauri-*.log`, `visual-prod-tauri.log*`, gitignorés).
`dist-host/` a été reconstruit, pas simplement supprimé.

## 7. Ce qui n'a pas été exécuté

- `cargo check` / `cargo test` : aucun fichier Rust modifié ; seules des sondes JS lisent
  `src-tauri/src/*.rs`.
- Aucune vérification visuelle (captures ou parcours Tauri) : le changement est invisible
  par construction, et le build web est vert.
- Aucun test de comportement du registre d'espaces côté Rust.

## 8. Risques restants

1. **Couverture perdue** : `tests/workspaces.test.mjs` couvrait « registre vide → aucun
   espace actif » et « espace actif retiré → plus d'actif ». Les tests Rust de
   `src-tauri/src/workspaces.rs:147` ne couvrent que la validation des noms. Le
   comportement n'est plus testé automatiquement.
2. **Parité notifications réduite** : le seuil de 8 s n'est plus comparé entre deux
   implémentations ; `verify-v10.0.0` le fige désormais sur `notify.rs` seul.
3. **Réglage inerte** (§5.2) : un utilisateur qui choisit « Droite » ne voit aucun effet.
