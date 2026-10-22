# Audit — cohérence graphique, boutons, icônes (2026-10-22)

Périmètre : le Poste v11.0.0 tel qu'il est rendu (binaire `target/debug` construit par
`npm run tauri:check`), plus lecture du code.

> **État au 2026-10-22 — corrigé en v11.0.1.** Traités et vérifiés à l'écran : §1.1
> (grille de conversation), §1.2 (styles Usage et « Dernier message »), §1.3 (version
> du moteur nommée), §1.4 (état traduit, chemins sans `\\?\`), §2.1 (une primaire par
> écran), §2.2–2.3 (boutons icône 36/32 px), §3.1 (plus de 13 px), §4 (66 `type`,
> `aria-label` des Notes, style inline retiré). Restent ouverts : §2.5 (vocabulaire
> Réglages/Configuration), §2.6 (classes hors système), §3.2 (sémantique des icônes —
> seule la collision `file` de la planche est corrigée) et la revue en thème sombre.

## Méthode

- **Rendu réel** : app Tauri lancée avec débogueur WebView2, captures de Aujourd'hui,
  Réglages (Configuration / Apparence / Usage), Notes, Fichiers, Orchestration et une
  conversation (`artifacts/audit-*.png`, non versionnés).
- **Mesures DOM** : `getComputedStyle` sur les familles de boutons et la grille de la
  conversation.
- **Relevé statique** : 94 `<Icon>` et 100 `<button>` analysés dans `web/src/**/*.tsx`.

Non vérifié : rendu en thème **sombre** pour ces six écrans (seules les captures
`prod-poste-dark` / `prod-tasks-dark` de `visual:prod` couvrent le sombre), fenêtre
étroite, contrastes des combinaisons nouvelles, parcours clavier complet.

## 1. Défauts visibles (bugs, pas des goûts)

### 1.1 Conversation : 703 px perdus par une colonne fantôme

`ConversationPage.tsx:243` rend `.workspace-layout`, dont la grille est
`var(--sidebar-width) minmax(0, 1fr)` (`chrome.css:28`). Mais la barre latérale est
**démontée** quand la préférence est off (`{appearance.showSidebar && <aside>}`,
`ConversationPage.tsx:244`), tandis que la classe `.sidebar-hidden` — la seule règle
qui réduit la grille à une colonne (`chrome.css:29`, `dialogs.css:165`) — **n'est
posée nulle part** dans le code React.

Mesuré : `grid-template-columns: 286px 703px`, un seul enfant `.main` de 286 px dans
une scène de 989 px. Le composeur fait 230 px de large et le fil 4 px de haut.
Conséquence visible : une conversation s'affiche dans un tiers de la largeur, le
reste de la scène est vide.

Cause racine : la classe de repli existe mais son déclencheur a disparu en v11.

### 1.2 Réglages → Usage : des feuilles de style absentes

`SettingsDialog.tsx:298` utilise `.stats-grid` et `.stat-tile`. **Aucune règle CSS ne
définit ces classes** — seul un commentaire subsiste (`freebuff.css:5`), et les règles
vivaient vraisemblablement dans `styles/home.css`, supprimée en v11.0.0.

Rendu constaté : « 4conversations actives », « 0archivées », « 23dictées (5
aujourd'hui) » — la valeur et le libellé se touchent, faute de mise en page. Même
problème pour `.scroll-bottom` (`ConversationPage.tsx:288`), cité nulle part dans les
styles : le bouton « Dernier message » est rendu brut.

### 1.3 La version affichée est celle du moteur, pas celle de l'app

`WorkbenchShell.tsx:172` affiche `v{appState.version}`, et `host/aven-app-host.ts:561`
remplit `version` avec `engineState.version`. Résultat mesuré : le bandeau affiche
**V2.0.10** (version d'OpenCode) alors que l'app est en 11.0.0 ; l'inspecteur répète
« Version 2.0.10 » sous POSTE. Le repli `?? "11.0.0"` montre que l'intention était
bien la version de l'app.

### 1.4 Anglais brut et chemins d'API dans l'interface

- Inspecteur du Poste : « Moteur ⟶ `ready` » (`WorkbenchShell.tsx:427`) alors que le
  bandeau dit « EN LIGNE ». Un état interne exposé tel quel.
- Chemins : `\\?\C:\Users\...\aven` affiché dans le bandeau (`WorkbenchShell.tsx:156`)
  et dans l'en-tête de Notes. Préfixe de chemin étendu Windows, jamais destiné à
  l'utilisateur.

## 2. Organisation des boutons

### 2.1 Plusieurs actions « primaires » dans la même vue

La règle §4 dit une seule par vue. Constaté :

| Écran | Primaires visibles simultanément |
|---|---|
| Aujourd'hui | « Nouvelle conversation » (`HomeBoard.tsx:128`) + « Créer la note » (`:191`) |
| Réglages · Configuration | « Enregistrer » par fournisseur (`SettingsDialog.tsx:253`, deux lignes) + « Installer le CLI » (`:268`) |

Les primaires désactivées restent des blocs orange lavé : sur Aujourd'hui, deux zones
orange se disputent le regard pour deux intentions de poids différent.

### 2.2 Quatre familles de « bouton icône », cinq dimensions

Mesuré dans le DOM :

| Classe | Taille | Usage |
|---|---|---|
| `.button.button-icon` | **42×36** | micro du composeur (`ConversationPage.tsx:194`) |
| `.button.small` | **34×32** | « nouvelle conversation » de la barre latérale (`ConversationPage.tsx:247`) |
| `.wb-tab-close` | **24×24** | fermeture d'onglet (`WorkbenchShell.tsx:262`) |
| `.chat-actions button` | **24×24** | renommer/exporter/archiver/supprimer (`chrome.css:67`) |
| `.selbar button` | **30×30** | barre d'actions sur sélection (`chrome.css:140`) |

AGENTS.md §4 annonce `.button-icon` comme « bouton 36px icône seule » : la mesure dit
42×36 (padding horizontal de `.button` conservé). `.button.small` n'est pas carré,
contrairement à ce que son nom suggère.

### 2.3 `font-size` des boutons : la règle et le code divergent

`chrome.css:74` fixe `.button { font-size: var(--font-size-sm) }` → **12 px mesurés**.
AGENTS.md §2 range « texte courant, boutons » sur `--font-size-md` (14 px). L'un des
deux ment ; c'est la règle du projet qui est fausse aujourd'hui, pas le rendu.

### 2.4 La même action, trois boutons, deux styles

« Nouvelle conversation » existe simultanément :

- planche : `.button.primary.full` ;
- barre latérale des conversations : `.button.primary.small` (icône seule) **et**
  `.button.secondary.full` en pied (`ConversationPage.tsx:247` et `:278`) ;
- bande d'onglets : `.button.ghost` « + » (`WorkbenchShell.tsx:273`) ;
- palette : Ctrl+N.

Deux boutons pour la même action dans la même colonne, avec deux niveaux visuels.

### 2.5 Un même lieu, quatre noms

Rail « Réglages » → onglet « Réglages » → titre « Configuration et apparence » →
section inspecteur « Configuration » → tuile « Réglages » avec boutons
« Configuration / Apparence / Usage » (`HomeBoard.tsx:238-240`). L'utilisateur doit
deviner que Configuration ⊂ Réglages.

### 2.6 Classes de bouton hors système

Hors `.button.*`, on trouve des boutons stylés de zéro : `.chat-main`,
`.notes-tree-item`, `.files-item`, `.wb-row`, `.model-select-item`,
`.workspace-picker-item`, `.message-edit`, `.md-wikilink`, `.notes-tag`,
`.wb-command-mic`. Certains sont légitimement des lignes de liste ; `.message-edit`,
`.md-wikilink` et `.notes-tag` sont des affordances inline qu'aucune classe du
système ne couvre — acceptable, mais à documenter, sinon chaque nouvelle surface en
invente une.

## 3. Icônes

### 3.1 Tailles hors grille

94 usages ; distribution mesurée :

`10px=1 · 12px=6 · 13px=23 · 14px=33 · 15px=16 · 16px=5 · 17px=3 · 20px=1 · 24px=5`

La grille §5 autorise 12 / 14–16 / 17 / 24 / 30. **13 px (23 usages) n'y figure pas**,
ainsi que 10 px (pastille d'espace courant, `SettingsDialog.tsx:282`) et 20 px
(`ConversationPage.tsx:276`). Le même rôle « icône de ligne » est rendu en 13 (arbre
Notes), 15 (Fichiers, planche) et 17 (rail).

### 3.2 Un pictogramme, plusieurs sens

| Icône | Sens constatés |
|---|---|
| `sparkle` | marque du rail (`WorkbenchShell.tsx:188`), Orchestration (`:28`), « Demander une synthèse » (`NotesView.tsx:356`), « Expliquer ce code » (`WorkbenchShell.tsx:514`), état vide de conversation (`ConversationPage.tsx:79`) |
| `file` | une note (`HomeBoard.tsx:164`) **et** une conversation d'un autre agent (`HomeBoard.tsx:117`) — dans la même planche |
| `agent` | section « Conversations » du rail (`WorkbenchShell.tsx:24`) et un agent |
| `chevron-right` | « Joindre à … » (`NotesView.tsx:355`), « Citer la sélection » (`WorkbenchShell.tsx:516`) — une action — et la navigation ailleurs |
| `close` | « Interrompre » le tour en cours (`FreebuffAgentPage.tsx:343`) : un X pour arrêter un agent |

### 3.2 bis Décision (v11.0.2, appliquée)

Principe retenu : **une icône dit une chose**. L'étoile reste la marque d'Aven (elle
reprend le losange de `brand-mark.svg`) ; chaque rôle qui empruntait l'étoile ou un
chevron reçoit son propre glyphe.

| Sens | Glyphe | Sites après décision |
|---|---|---|
| marque Aven | `sparkle` | bandeau du rail seulement (1 usage) |
| génération assistée | `wand` | synthèse de note, explication de code |
| conversation | `chat` | rail « Conversations », lignes de reprise, états vides |
| délégation | `branch` | rail « Orchestration », bouton Orchestration de la planche |
| agent | `agent` | carte d'agent, « Préparer une analyse » |
| document | `file` | notes (arbre, planche), fichier de la vue Fichiers |
| arrangement | `folder` | dossier de notes, vue Fichiers |
| interruption | `stop` | « Interrompre » du terminal Freebuff |
| transfert | `paperclip` | « Joindre à {agent} » |
| citation | `quote` | « Citer la sélection » |
| navigation | `chevron-*` | fil d'Ariane, historique — jamais une action |

Mode de délégation « Analyse » : `chart` remplace `sparkle` (l'étoile n'est pas un
outil de spécialiste). Le centrage d'encre de chaque nouveau glyphe a été mesuré
avant pose (§3.4) : `wand`, `paperclip`, `chat`, `quote` portent une correction.

### 3.3 Bon point

Aucune icône locale en `<svg>`, aucun emoji, aucune image externe dans le rendu : la
règle §5 est tenue. Les viewBox et `currentColor` sont cohérents.

### 3.4 Centrage de l'encre (mesuré, corrigé le 2026-10-22)

Le cadre de l'icône était centré, le **dessin** ne l'était pas. Mesure au rendu réel
(`getBBox` puis `getBoundingClientRect` des formes, dans la webview, CDP) :

| Icône | Décalage de l'encre avant | Après nudge |
|---|---|---|
| `restore` (Poubelle des notes) | +2,48 u en x (≈1,8 px) | ≤ 0,05 px |
| `sparkle` (rail, Orchestration) | +1,30 u en y (≈1,0 px) | ≤ 0,05 px |
| `folder`, `check`, `archive`, `chevron-down` | +0,5 à +1 u en y | ≤ 0,05 px |
| `file` (ligne de note) | −1 u en x | ≤ 0,05 px |
| `pencil`, `wrench`, `microphone` | ≈0,7 u (taille 24–30 px : 1–2 px) | ≤ 0,05 px |

Correctif : table `OPTICAL_NUDGE` dans `web/src/icons/Icon.tsx` (décalage de l'encre,
la boîte reste au centre) ; contrôle final sur 31 instances affichées — **29 exactes,
2 à 0,22 px** (`agent`, `search`, sous-pixel).

**Seconde cause, distincte** : `.button .app-icon { margin-right: 6px }` s'appliquait
aussi aux boutons sans texte. Dans un bouton carré, la marge poussait le glyphe de
3 px à gauche (Inbox et capture rapide des Notes, bascule de l'inspecteur). La règle
est supprimée (`voice-notes.css`) : l'écart icône/texte vient du `gap` de `.button`.

Limite : la mesure de l'encre n'est pas figée par une sonde. Elle exige un moteur de
rendu SVG (le navigateur) ; `verify` ne tourne pas dans un DOM. Une nouvelle icône
reste à vérifier visuellement dans un bouton carré.

### 3.5 Barre de sélection (vérifiée dans l'app, 6 boutons)

Sélection de texte dans une conversation réelle (un tour envoyé au modèle gratuit
configuré, puis la conversation supprimée). Barre `role="toolbar"` +
`aria-label="Actions sur la sélection"`, 198 × 38 px, six boutons de 30 × 30 :
`copy`, `wrench`, `wand`, `eye`, `quote`, `close`.

Trois défauts que la mesure de centrage ne voyait pas :

- **Token fantôme** : `.selbar .selbar-close` utilisait `var(--text-muted, var(--text))`
  — token inexistant, donc repli sur la couleur du texte et opacité `.7` : le X pesait
  autant que les actions. Corrigé en `var(--muted)` (`chrome.css:179`).
- **Même classe de bug ailleurs** : `.freebuff-conflict` s'appuyait sur
  `var(--warning-border, var(--accent-border))` ; une alerte prenait la teinte de la
  marque. Remplacé par `color-mix(in srgb, var(--warning) 32%, var(--border))`, comme
  `.status-banner`. La sonde v11.0.2 refuse désormais tout `var()` non défini (§J).
- **Glyphes faibles à 19 px** : `quote` (cadre + ligne) se lisait comme une page
  pliée, `wand` (tige + deux croix) comme un crayon. Redessinés (guillemets ouverts,
  étoile pleine au bout de la baguette) ; `copy` était à +0,5 unité en x, corrigé.

Contrôlé et conforme : « Citer » insère `> Réponds` dans le composeur puis ferme la
barre ; « Fermer » ferme ; focus clavier visible (anneau accent 2 px, offset 1 px) ;
`prefers-reduced-motion` neutralise l'apparition (`animation-duration` ≈ 0).

### 3.6 Autres surfaces (vérifiées à taille réelle, v11.0.2)

| Surface | Ce qui a été observé | Décision |
|---|---|---|
| Carte d'agent (24 px) | `agent` centré, poids cohérent avec le titre | inchangé |
| Modes de délégation (14 px) | `chart` pour Analyse se lit comme un graphique, `wrench`/`search` inchangés | inchangé |
| Barre des Notes (14 px) | `paperclip` lisible ; **`wand` : étoile réduite à une tache à 5 px** | étoile portée à 8,4 unités, tige raccourcie |
| Éditeur de notes (14 px) | guillemets lisibles mais décalés de **+1,5 unité** en x | nudge `[-1.5, 0]`, mesuré à 0 |
| Terminal Freebuff (14 px) | **carré d'arrêt de 10 unités lu comme un point** avant « Interrompre » | carré porté à 11 unités, rayon 1,8 |

Après correction, mesure sur les trois surfaces : aucun décalage d'encre > 0,2 unité
pour les glyphes réécrits (`quote`, `wand`, `paperclip`, `stop`). Restent trois
décalages antérieurs de 0,25 à 0,5 unité sur `text`, `bold`, `list` — sous le pixel au
rendu, hors périmètre de ce lot.

Limite : le bouton « Interrompre » était **désactivé** pendant la vérification
(Freebuff démarrait), donc observé en gris ; le carré n'a pas été vu dans son état
actif.

## 4. Boutons et accessibilité (lié au graphique)

- **Deux boutons icône sans `aria-label`** : `NotesView.tsx:282` (capture rapide) et
  `:283` (nouveau dossier) n'ont qu'un `title` — §12.1 exige un `aria-label` français.
- **66 `<button>` sans `type="button"`** répartis sur 11 fichiers, surtout
  `NotesView.tsx` (19), `ConversationPage.tsx` (15), `SettingsDialog.tsx` (15),
  `WorkbenchShell.tsx` (7). Dans un futur formulaire, le défaut `submit` revient.
- **Libellés incohérents** : « Fermer l'avis » sur un bouton qui affiche « Fermer » ;
  raccourci écrit « Ctrl+N », « Ctrl N » et « CTRL MAJ N » selon la surface.
- **Style inline** : `SettingsDialog.tsx:282` `style={{ flex: 1 }}` — §2 réserve
  l'inline aux valeurs calculées.
- **Couleurs en dur** : `chrome.css:14` utilise `#0b0d12`, `#111` et `white` pour la
  marque ; `chrome.css:188` un repli `#f59e0b`. Le reste du fichier est propre.

## 5. Priorités

1. **P0 — Conversation à 286 px** (§1.1) : bug de mise en page, correctif court
   (poser la classe de repli ou retirer la colonne fantôme).
2. **P0 — Usage non stylé** (§1.2) : rétablir `.stats-grid`/`.stat-tile` (et
   `.scroll-bottom`), sinon la page laisse croire que l'app est cassée.
3. **P1 — Version moteur présentée comme version d'app** (§1.3) et états anglais
   (§1.4).
4. **P1 — Primaires multiples et doublons de « Nouvelle conversation »** (§2.1, §2.4).
5. **P2 — Unifier les boutons icône** (§2.2) et trancher la taille de police des
   boutons (§2.3), puis les tailles d'icône 13/15 hors grille (§3.1).
6. ~~**P3 — Sémantique des icônes** (§3.2)~~ : tranché en v11.0.2 (§3.2 bis).
