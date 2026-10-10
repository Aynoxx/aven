# Review UI/UX — grille « apple-design » (skill)

> Portée : **toute l'app** (hub, Tâches, Chat, Notes, Éditeur, Fichiers, Réglages,
> apparence), auditée **sans hériter des conventions passées** : seule référence le
> skill `/apple-design` (avec contrôle croisé `RULES.md` quand la règle interne
> diffère). Sources : `web/src/App.css` (989 l.), `App.tsx` (1600 l.),
> `NotesView.tsx`, `NoteEditor.tsx`, `FreebuffAgentPage.tsx`, `appearance.ts`,
> index.html, captures prod `artifacts/*-prod-tauri.png`, sondes existantes
> (`test:features`, `verify-conventions`). Correctifs = recommandations, non appliqués.

---

## ✅ Conforme — ce que le skill valide déjà

1. **Réponse au pointer-down** (§ Response) : `.button:active`, `.hub-card:active`
   en `transform/opacity` avec `--dur-press` — la pression s'anime à l'appui, pas au
   relâchement (correction glitch v10.0.1 conservée).
2. **Transition d'élément partagé hub → page** (§ Spatial consistency) :
   `view-transition-name: homeOrbit/homeCard` + morph natif 380 ms — exactement le
   pattern « shared element » du skill, en pur CSS navigateur.
3. **Feedback continu pendant l'action** (§ Feedback) : dictée en push-to-talk avec
   halo `presence-breathe` **pendant** l'enregistrement ; anneau pulse sur
   « Génération en cours » ; shimmer sur les skeletons.
4. **Causalité** (§ Cause & effect) : le point de présence pulse au changement
   d'état connecté — état visible, déclenché par l'état.
5. **Réparabilité des notes** (§ Agency) : suppression → **poubelle**, dossier
   supprimé → poubelle (`host/notes.ts deleteFolder` : `renameSync` vers `TRASH_DIR`),
   archive réversible — la boucle forgiveness est en place.
6. **Wayfinding** (§ Wayfinding) : chaque écran porte où-je-suis (eyebrow + h1),
   où-aller (hub orbit, onglets fenêtre, bouton Accueil), comment-sortir (Échap
   global `App.tsx:466`, boutons ×, retour). Libellés directs et spécifiques
   (« Tâches », « Notes », « Fichiers ») — pas de jargon.
7. **Typographie : tracking dimensionnel** (§ Typography) : eyebrow `+.12em`
   (petite capitale), h1 `-.035em` (grand titre) — le tracking va dans le bon sens
   selon la taille.
8. **Hiérmatérial** (§ Materials) : ombres croissantes surface ↔ chip
   (`--shadow-panel/-bar/-pop` : blur 70/40/26 px), bordure haute d'inset =
   lumière captée, `.hub-card::after` = reflet incliné façon verre poli.
9. **Respect de la lecture** (§ Agency) : auto-scroll du chat suiveur à 80 px —
   on ne remplit pas sous les yeux du lecteur.
10. **Réduction de mouvement partielle** (§ Reduced motion) : bloc
    `@media (prefers-reduced-motion: reduce)` global (`!important` 0.01 ms) +
    `withViewTransition` court-circuite l'API — solide point de départ.
11. **Familiarité plateforme** (§ Familiarity) : DnD natif HTML5 = métaphore
    Explorer Windows connue ; scrollbars fines custom ; `::selection` accent.

---

## 🔴 Élevé — besoins humains en jeu (sécurité / compréhension)

### E1. Suppression de conversation : ni confirmation, ni annulation
**§ Agency — « undo for slips, confirmation only for irreversible »** · `App.tsx:623 removeChat`
Le × du titre de chat détruit la session OpenCode instantanément, un clic accidentel
(× à côté du titre, zone de survol permanent) est **irréparable**. La règle du skill
inverse la charge : annulation facile pour les glissis, dialogue **uniquement** pour
l'irréversible — ici c'est irréversible et il ne se passe rien des deux.
**Correctif** : au minimum, mécanisme de type « Conversation supprimée — Restaurer »
(une barre `selbar`-like 5 s) ; à défaut, `confirm()` stylé avant purge.

### E2. Purge définitive d'une note en un clic
**§ Agency — destructive/irréversible → confirmation** · `NotesView.tsx:249 notePurge`
« Supprimer définitivement » depuis la corbeille est **le** geste que le skill
réserve au dialogue de confirmation : définitif, sans undo, bouton petit à côté de
« Restaurer ». La poubelle existe (bon), mais la sortie de la poubelle ne doit pas
être aussi facile que l'entrée.
**Correctif** : double-confirmation (type « cliquer à nouveau pour purger ») sur
`purgeNote` uniquement.

### E3. Contraste du texte secondaire sur surfaces translucides
**§ Materials — « vibraney text: boost weight/tracking for legibility »** + WCAG ·
sonde `test:features` WARN : **4.14:1 < 4.5** (muted `#707689` clair sur `--bg`)
et le cas réel est pire : la toolbar `.home-toolbar` et `.home-recent` sont
**translucides** (`color-mix(panel 94/82%, transparent)`) — la couleur de fond
effective bouge sous le texte. `.hint` à **10 px** porte le même muted.
**Correctif** : darkener le token muted côté clair (viser ≥ 4.5 : 1 mesuré),
ou passer `.home-toolbar`/`.home-recent-item` en poids `+1` et tracker `+.01em`
comme le skill l'exige au-dessus d'un flou ; idéalement fonder le muted sur une
couleur opaque de la surface, pas sur rgba global.

### E4. Focus clavier perdu dans le composeur et l'éditeur
**§ Craft / lisibilité du focus** · `App.css:84` vs `:222`, `:738`
Cascade vérifiée : `textarea:focus-visible` (0,1,1) et `.composer textarea`
(0,1,1) ont la **même spécificité** → l'ordre source l'emporte : `outline: 0`
(L222, après) **écrase l'anneau de focus**. Aucun `.composer:focus-within` de
remplacement (seul `.home-command:focus-within` existe). Même trou pour
`.note-editor-content .ProseMirror { outline: none }` (L738, sans règle
`.ProseMirror-focused`). Le probe « Règle 9b » de `verify-conventions` passe à
tort : il ne vérifie que le **nom** du sélecteur, pas l'existence du signaleur.
Atténuation partielle : le curseur clignote dans le champ — mais un Tab depuis le
hub ne laisse aucune trace visible du focus.
**Correctif** : `.composer:focus-within { border-color: var(--accent); box-shadow: … }`
(+ idem `.ProseMirror-focused { border-color }`) ; durcir le probe 9b pour exiger
la paire `:focus-within`/`:focus-visible` correspondante.

---

## 🟠 Moyen — écarts nets au skill, correctifs directs

### M1. Police « Inter » déclarée mais jamais chargée
**§ Typography — « default to the platform font; override only with a reason »**
Aucun `@font-face` ni `<link>` dans `index.html`/CSS ; Inter absent de la machine
(vérifié `C:/Windows/Fonts`) → **fallback silencieux Segoe UI** sur toute l'app.
Soit la stack système est assumée (et on retire « Inter » du `font-family` pour
dire la vérité), soit on bundle Inter (raison : cohérence de marque) — mais le
statut actuel « fonte custom fantôme » contredit « nothing is random ».
Lecture actuelle : le tracking `-.035em` est calibré sur Segoe UI, pas sur Inter.

### M2. `--font-size-xs: 10 px` pour hints, méta, légendes
**§ Typography — lisibilité** · `App.css` (token) : `.hint` (raccourcis, contenus
d'onglets), `.chat-meta` (11-12 px), descriptions de cartes hub tronquées à 10 px
(visible sur les captures : « Agents spécialisés par… »). Sur captures, c'est le
texte le plus lisible-compromis de l'app. **Correctif** : xs → 11 px min,
hints importants → 12 px.

### M3. Dialogues : entrées asymétriques, sorties inexistantes
**§ Spatial consistency / Materials — « materialize, don't just fade »** :
- `.overlay` (Réglages, Notes, Fichiers, Modèle) : **aucune animation** (App.css:287),
  alors que `.hub-picker-overlay`/`.home-modal-overlay` ont fade-up 160 ms (L506/548)
  → deux systèmes pour le même geste.
- **Aucun** dialogue ne s'anime à la fermeture (React unmount instantané) → entrée
  et sortie ne suivent pas le même chemin (asymétrie centrale du skill).
**Correctif** : unifier sur `overlay-in` (fade + `scale(.97→1)` sur le panneau) +
support d'exit (retarder l'unmount de ~140 ms ou View Transition « except »).

### M4. Bascule de thème instantanée = saut de luminosité
**§ Reduced motion — « ease abrupt brightness jumps (dark ↔ light) »** ·
`appearance.ts:110/122 root.dataset.theme = …`, aucun `transition` de couleurs.
Sur un thème clair → sombre plein écran, le skill demande un fondu.
**Correctif** : classe `.theme-easing` posée 250 ms autour du switch :
`* { transition: background-color .25s, border-color .25s, color .25s }`.

### M5. Signaux `prefers-reduced-transparency` et `prefers-contrast` absents
**§ Reduced motion — trois signaux** : seul `prefers-reduced-motion` est traité.
Les panneaux `.overlay` (blur 14 px), `.home-toolbar` (blur 20), `.home-recent`
(blur 18) restent translucides pour qui demande la transparence réduite ; aucun
ajustement `prefers-contrast: more`. **Correctif** : media queries → fonds opaques
(`--panel-solid`) et bordures/boutons renforcés.

### M6. `scroll-behavior: smooth` non désactivé en reduced-motion
**§ Reduced motion** · `App.css:171`, `:617` : le défilement animé reste actif sous
`reduce` (le bloc `*` ne touche pas `scroll-behavior`). **Correctif** : une ligne
`scroll-behavior: auto` dans le media query existant.

### M7. Le bouton toggle anime `left` (layout), pas `transform`
**§ Performance — compositor : transform/opacity only** (+ règle interne écrite
dans le fichier v9.7.0) · `App.css:366-370` : `left: 3px → 19px` en transition →
layout paint à chaque frame. **Correctif** : `left` fixe + `transform: translateX()`.
(idem : `.pulse`/`.dictation-pulse`/`.freebuff-pulse` animent `box-shadow` = paint ;
acceptable sur petite zone mais non conforme au « transform/opacity only ».)

### M8. Drag & drop : 100 % natif, sans suivi direct ni alternative clavier
**§ Direct manipulation / Flexibility** · `SettingsDialog.tsx:201,209`,
`NotesView.tsx:173-189` : DnD HTML5 (fantôme OS, réordonnancement au drop, zone
de drop en pointillés statiques). Le skill veut détection dès le premier
mouvement avec suivi 1:1 du doigt/pointeur (`setPointerCapture`), indicateur
**directionnel** de l'emplacement cible, et **aucune interaction non offerte au
clavier**. Le crédit « métaphore native » existe, mais : pas d'indicateur
d'insertion (flèche/écart), pas de touches ↑↓ pour réordonner, feedback de drop
sans transition. **Correctif** : au minimum mode clavier (↑/↓ avec aria) +
indicateur d'insertion animé ; idéalement pointer events sur l'arbre Notes.

### M9. Cibles sous le seuil du projet (24 px) et sous l'idéal Apple
**§ Tap targets** · `.chat-actions button` **20×20** (`App.css:146`, opacité .15 au
repos), `.home-notice-close` ~20, `.dictation-toggle` min-height 22. La propre sonde
du projet (24 px) n'a rien signalé parce que ces contrôles n'étaient pas montés au
moment du test — le probe est donc optimiste. **Correctif** : grille 24 px mini,
28-32 px pour les actions de titre de conversation.

### M10. Aucun `overscroll-behavior` : chaining entre scrollers imbriqués
**§ Boundaries / soft edges** : `.chat-list` dans `.main-scroll`, listes hub/notes —
un wheel en butée fait défiler le parent (secousse). **Correctif** :
`overscroll-behavior: contain` sur les listes scrollables internes
(`.chat-list`, `.home-recent-list`, `.notes-list-panel`, `.files-list`).

### M11. Page Tâches : carte seule dans le vide
**§ Simplicity & hierarchy — chaque écran répond « where am I / what's here »** ·
captures : sous la carte orchestrateur, ~60 % de la hauteur en vide non composé
(pas d'état vide illustré, pas de liste d'activité récente). Le hub a son empty
state en pointillés (« Commencer une conversation… ») ; Tâches n'en a pas.
**Correctif** : état vide typographique (« Aucune tâche en cours — lancez une
conversation ») ou dernières activités, même maille que `.home-recent-empty`.

### M12. Jeton `--ease-spring` défini, jamais utilisé
**§ Delight / springs** : `App.css:56` le déclare, zéro `animation-timing-function`
l'utilise. Aucune animation de l'app n'a de rebond — la token est morte.
**Correctif** : l'appliquer là où une entrée « se pose » (dialogues, cartes hub
en entrée, sélection de mode) OU la supprimer (« rien n'est décoratif pour rien »).

### M13. Menu modèle et barre de sélection : apparition brute
**§ Materials — animer le flou à l'entrée, origine ancrée** · `.model-select-menu`
(App.css:825) et `.selbar` (233) apparaissent sans transition, sans `transform-origin`
vers le déclencheur. Le skill demande `scale + flou` depuis le point d'ancrage.
**Correctif** : `overlay-in` avec origine basse (menu) / centre (selbar), ~120 ms.

---

## 🟡 Faible — polish « craft »

| # | Écart | Skill | Lieu | Correctif |
|---|-------|-------|------|-----------|
| F1 | `.window-chrome` : `backdrop-filter: blur(16px)` sur fond **opaque** — flou mort, déclaration mensongère | Materials | `App.css:439` | retirer le filter ou translucider le fond |
| F2 | Empilement GPU : overlay (blur 14) au-dessus de toolbar (blur 20) + recent (blur 18) = 3 backdrop-filters simultanés | Performance | `App.css:290,714,447` | sous `overlay`, simplifier les couches derrière |
| F3 | h1 sans `line-height` serré (défaut ~1.25 au lieu de 1.05-1.15) | Typography — leading | `App.css:638-646` | `line-height: 1.08` sur `.home-h1`/`.agents-page-header h1` |
| F4 | Pas de `font-optical-sizing: auto` ni d'axe optical (fonte non variable actuellement) | Typography | base | à activer avec M1 |
| F5 | Boucles infinies multiples simultanées (presence + pill + pulse) — la « restraint » demande un seul foyer vivant | Restraint | `1347, 471, 198` | n'animer que l'élément d'état courant |
| F6 | Dictée : `pointerleave` annule, mais le retour du doigt ne **reprend** pas (`and back` du skill) | Gestes | `App.tsx:1261-1263` | reprendre si le pointeur revient sur la cible |
| F7 | Recherche Notes : debounce 200 ms (l'audit du skill vise < 100 ms perçu) | Latence | `NotesView:120` | 120 ms + résultat immédiat sur 1 caractère déjà présent |
| F8 | Pas de `will-change` sur les cartes hub (transform 3D permanent) | Performance | `App.css:589` | `will-change: transform` sur `.hub-card` |
| F9 | `.segmented`, `.settings-tabs`, `.home-recent-item` : hover mais **pas d'` :active`** (les `.button` oui) | Response | `App.css:861, 606, 721` | press-state `scale(.98)` homogène |
| F10 | Champs `input`/`select` globaux sans `:focus-visible` propre (la règle globale L84 ne couvre que button/input/textarea/select — `select` oui, mais `.field select` écrase ?) | Craft | `App.css:117` | vérifier la cascade des `.field` |

---

## ⚪ Hors périmètre constaté (à ne pas « inventer »)

- **§ Momentum / velocity handoff / rubber-band (§ « fluid gestures »)** : l'app n'a
  **aucun carrousel, sheet ni zone flickable** — le scroll est natif (momentum OS
  inclus, chaining traité en M10). Rien à projeter : ces sections du skill n'ont
  pas d'objet ici aujourd'hui.
- **Son / haptique (§ multimodal)** : desktop Tauri — Vibration API indisponible ;
  aucun son d'UI (choix respectable, « restraint »).
- **Dynamic Type OS** : la mise en échelle passe par le zoom webview (px), pas par
  des `rem` — acceptable sur Windows desktop, à revoir si la webview expose un
  facteur de texte.

---

## Verdict

L'app **respecte déjà l'ossature** du skill : réponse à la pression, morph partagé
hub→page, wayfinding complet, poubelle/annulation sur les notes, hiérmatérial
convaincante. Les manques se concentrent sur trois axes, dans l'ordre :

1. **Agency sur les gestes destructifs** (E1, E2) — le seul endroit où le skill
   parle de sécurité humaine et où l'app échoue aujourd'hui ;
2. **Lisibilité sous contrainte** (E3, E4, M1, M2) — contraste, focus, polices :
   le craft « rien n'est random » ;
3. **Cohérence des transitions** (M3, M4, M13) — un seul système d'entrée/sortie
   pour tous les panneaux, y compris la sortie.

Aucun écart « bloquant » de build ; tout est corrigeable dans `App.css` + deux
fichiers de vue, sans toucher à l'architecture.
