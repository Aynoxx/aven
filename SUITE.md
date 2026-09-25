# Suite — Refonte du menu d'accueil (hub circulaire) et réparation du panneau Réglages

> Les éléments historiques ci-dessous documentent les passes précédentes. Pour l’état courant, voir la section v8 ajoutée dans `CORRECTIONS-UI.md`.

Fait dans cette passe, sur demande explicite (refonte graphique du menu de base + debug) :

- **Bug CSS majeur corrigé** : `.overlay` ne centrait rien (aucun `display:flex`/`place-items:center`) et
  `.dialog` n'existait dans **aucune** règle CSS. Résultat avant correction : le panneau Réglages, les Notes,
  le formulaire d'agent et la demande de permission s'affichaient sans fond, sans bordure, collés en haut à
  gauche de l'écran. C'était très probablement l'essentiel de ce que l'utilisateur appelait « le menu buggé ».
  Voir `.overlay` / `.dialog` dans `App.css` (juste après les styles du composeur).
- Tout le CSS de l'onglet Configuration (`.field`, `.hint`, `.row`, `.settings-input`, `.dialog input/select`)
  et de l'onglet Apparence (`.settings-section`, `.segmented`, `.accent-grid`, `.setting-row`, `.toggle-row`,
  `.sortable-list`, `.range-control`, `.drag-handle`, `.drawer-footer`) était absent — probablement perdu lors
  d'une fusion précédente. Réécrit en entier (repris et adapté d'une version antérieure du projet où ce CSS
  existait et fonctionnait).
- `SettingsDialog.tsx` : onglets renommés **« Configuration »** et **« Apparence »** (demande explicite). Le
  bouton en haut à gauche de la fenêtre est renommé **« Personnalisation » → « Paramètres »** (`App.tsx`).
- Bug corrigé : les cartes **« Fichiers » et « Projets »** du hub appelaient exactement la même fonction
  (`api.openWorkspace()`). « Projets » ouvre maintenant Réglages → Configuration, avec défilement automatique
  jusqu'à « Espaces de travail » (`focusWorkspaces`, `#workspaces-section`).
- Bug corrigé : la carte **« Agents »** rebasculait à l'aveugle sur le dernier agent actif, sans possibilité
  de choisir, la barre d'onglets historique étant masquée en CSS (`.app > .tabs { display:none !important }`,
  volontaire depuis la fusion précédente). Ajout d'un petit sélecteur d'agents (`.hub-picker-*`) — seul moyen
  actuel de changer d'agent sans passer par la voix.
- Organisation du hub conservée à l'identique (cercle + bouton central), comme demandé. Ajouts : bandeau de
  salutation discret en haut du hub (`.hub-greeting`, heure du jour + nom de l'espace de travail), légère
  animation de respiration/rotation au repos sur le bouton vocal central (`.voice-core`, `.voice-ring-*`),
  désactivée sous `prefers-reduced-motion`.
- Vérification : `tsc --noEmit` (mode syntaxe seule, pas de `node_modules` dans ce bac à sable) sur tous les
  `.tsx`/`.ts` de `web/src` → aucune erreur de syntaxe. Pas de build Vite complet possible ici faute de réseau ;
  à faire côté utilisateur avant publication (`npm install && npm run build`).

## Reste à faire (pas commencé, non demandé explicitement mais à surveiller)

- La barre d'onglets `.tabs` reste masquée en CSS (héritage de la fusion précédente) plutôt que supprimée du
  JSX : c'est un choix delibéré pour ce shell, mais le code JSX correspondant dans `App.tsx` est donc mort tant
  qu'elle reste masquée. À trancher : soit la retirer proprement, soit la réutiliser un jour.
- La documentation `CORRECTIONS-UI.md`/`MERGE-NOTES.md` décrit encore un hub à **six** actions ; le code (et
  cette passe) en a **cinq** (pentagone, pas hexagone). Mettre ces notes à jour si on veut qu'elles restent
  fiables pour la suite.
- Pas de bouton pour changer d'agent directement depuis une conversation (seulement depuis l'accueil via la
  nouvelle carte) — acceptable pour l'instant mais à revoir si ça s'avère gênant à l'usage.

---

# Suite — Lot 1 (v6.1 → v6.2)

Fait dans cette passe : Étape 0 (stabilisation), C (streaming regroupé), B (défilement auto), A (Markdown enrichi),
F (titre de conversation), E (raccourcis). Détails et niveau de confiance de chaque point dans le README, section
« Nouveautés de cette passe (v6.1) ».

Budget épuisé avant D, G et les tests. Voici, dans l'ordre du protocole, ce qu'il reste et comment le faire.

## D — Notifications de bureau (pas commencé)

Dans `electron/main.ts`, avec `Notification` d'Electron :

1. Isoler d'abord la décision dans une fonction **pure**, testable sans Electron :
   ```ts
   // electron/notify-policy.ts
   export function shouldNotify(input: {
     windowFocused: boolean
     kind: "turn-done" | "turn-error" | "permission" | "form"
     turnDurationMs?: number
     enabled: boolean // interrupteur des préférences
   }): boolean {
     if (!input.enabled || input.windowFocused) return false
     if (input.kind === "permission" || input.kind === "form") return true
     return (input.turnDurationMs ?? 0) > 8000
   }
   ```
2. Dans `main.ts`, mesurer la durée du tour (timestamp à `session.execution.started` de la session principale, comparé à
   `succeeded`/`failed`), et appeler `shouldNotify` avec `win.isFocused() && win.isVisible()` comme `windowFocused` (attention :
   caché dans le tray → `isVisible()` est `false`, c'est voulu).
3. Préférence : fichier `prefs.json` dans `app.getPath("userData")` (même pattern que `settings.ts`/`workspaces.ts`), une
   seule clé `{ notifications: boolean }`, activée par défaut. IPC `prefs:get`/`prefs:set` (3 endroits, comme toute IPC — voir
   section 2 du protocole). Case à cocher dans `SettingsDialog.tsx`.
4. `new Notification({ title: <titre de la conversation>, body: ... }).show()`, avec `.on("click", () => { showWindow(); /* +
   envoyer un event au renderer pour ouvrir cette conversation */ })`. Ajouter un canal `app:openChat` : `main.ts` envoie
   `win.webContents.send("app:openChat", { agent, chatId })`, `App.tsx` écoute et fait `setTab(agent); setChatId(chatId)`.
5. **Piège Windows** (à ne pas oublier, cf. protocole) : `app.setAppUserModelId("com.local.aven")` (même valeur que
   `appId` dans `package.json > build`), sinon pas de toast ou nom « Electron » à la place du nom de l'app.
6. Non testable ici (pas de Windows, pas d'Electron avec fenêtre réelle) : le toast lui-même. Mais `shouldNotify` peut et doit
   être testé (voir section Tests plus bas).

## G — Diagnostic copiable (pas commencé)

1. Petit tampon circulaire dans `main.ts` (ex. `const log: string[] = []`, `function trace(s: string) { log.push(s); if
   (log.length > 30) log.shift() }`), appelé depuis `boot()`, le routeur (`notify`) et les erreurs du relais d'événements.
2. `ipcMain.handle("app:diagnostic", () => buildDiagnostic())` où `buildDiagnostic()` (fonction pure, dans un fichier à part
   pour rester testable, ex. `electron/diagnostic.ts`) assemble : `process.versions` (electron/node/chrome), `process.platform`,
   `state.version`/`state.cli`, `Object.keys(state.keys).filter(k => state.keys[k])` (**jamais les valeurs**), `state.assignments`,
   `state.warning`/`state.sync`, `state.workspace`/`state.workspaces`, les 30 dernières lignes du tampon.
3. Bouton dans `SettingsDialog.tsx` : `navigator.clipboard.writeText(JSON.stringify(diag, null, 2))`.
4. **Test avant livraison, sans exception** : mets une fausse clé reconnaissable (`sk-TEST-123`) dans `settings.ts` en dur
   temporairement, appelle `buildDiagnostic()`, `JSON.stringify` le résultat et vérifie que la chaîne `sk-TEST-123`
   n'apparaît nulle part — pas seulement dans les clés, aussi dans les lignes du tampon de log (une clé pourrait fuiter dans
   un message d'erreur loggé ailleurs par erreur).

## Tests automatisés (pas commencé)

`tests/` avec `node --test`, sur le code compilé (`dist-electron/`) ou directement en import ESM depuis les `.ts` compilés à
la volée. Candidats, du plus simple au plus utile :
- `router.ts` : `classifyError` (429/quota/payant → bon type de mise de côté), `buildChains` ou équivalent (ordre de priorité
  respecté, modèle sans clé jamais choisi).
- `workspace-sync.ts` : `syncTrackedFiles` — fichier absent → copié + baseline créée ; fichier identique à la baseline et
  gabarit changé → mis à jour ; fichier différent de la baseline → jamais touché, marqué `custom`. `mergeNewModels` — ajoute
  les nouveaux, ne touche jamais aux existants. Ces deux fonctions sont déjà écrites pour être pures (pas d'Electron), donc
  directement testables avec de vrais fichiers dans un dossier temporaire (`node:fs`, `node:os.tmpdir()`).
- `notify-policy.ts` (à créer pour D, voir plus haut) : la fonction `shouldNotify`.
- `electron/diagnostic.ts` (à créer pour G) : vérifie qu'aucune clé n'apparaît dans la sortie.

Script `npm test` dans `package.json` (`"test": "node --test tests/"`), à ajouter.

## Rappel des invariants (section 3 du protocole) à respecter en continuant

Pas de module natif, preload en `.cts`, clé API jamais hors du process principal, `workspace-sync.ts` n'écrase jamais un
fichier modifié, fin de tour = événement de la session principale seulement, `@opencode/client@2.0.10` exact, pas de
`dangerouslySetInnerHTML`. Ajouter une fonction IPC = 3 endroits (`main.ts`, `preload.cts`, `types.ts`).

## État final de cette passe

- Hub circulaire conservé et réorganisé avec bouton central `Agent vocal`.
- Bouton de fenêtre `Paramètres` présent en haut à gauche.
- Onglets `Configuration` / `Apparence` présents dans le panneau Réglages.
- CSS des dialogues et contrôles restauré, avec adaptations mobile.
- Bug des `abort` vocaux volontaires corrigé ; saisie texte de secours ajoutée au panneau vocal.
- Parsing syntaxique des TS/TSX modifiés : OK. Équilibre structurel du CSS : OK.
- Build Vite/Electron complet non exécuté dans cet environnement : les dépendances `node_modules` ne sont pas incluses dans l'archive source.
