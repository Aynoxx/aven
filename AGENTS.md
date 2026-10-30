# AGENTS.md — Aven

INSTRUCTION PRIMAIRE :
Sois direct et honnête, pas agréable. Confronte mes idées lorsqu'elles sont faibles. Si j'ai faux dis juste "Tu as faux" et explique pourquoi. Note les idées sur 10 de manière honnête.


**Lis ce fichier AVANT de modifier quoi que ce soit.** Il contient le contrat
d'exécution (parcours, définition de terminé, compte rendu, périmètre) puis les
règles universelles du projet : typographie (tokens CSS), format des boutons
(classes `.button.*`), icônes (`<Icon name />` uniquement), langue et commentaires
versionnés, architecture host/renderer (Tauri), IPC, sécurité, tests, sondes et
accessibilité. Ces règles décrivent ce que le code fait DÉJÀ : en cas de doute,
imite le fichier voisin le plus proche. Une contribution qui viole une règle se
fait refuser par `npm run verify` (sondes automatiques).

Résumé en dix secondes :

1. **Imite les fichiers voisins** avant d'inventer — le style du projet prime.
2. **Français partout** (UI, commentaires, commits), identifiants en anglais.
3. **Aucune valeur visuelle en dur** : tokens CSS (`--font-size-*`, `--text`,
   `--accent`…) ; boutons = classes `.button.*` ; icônes = `<Icon name="…" />`.
4. **Logique décisionnelle en modules purs** `host/*.ts` testables sans
   Tauri ni Node desktop (uniquement `node:*` + `tests/*.test.mjs`) ; secrets
   jamais côté renderer.
5. Chaque version **fige ses conventions en sondes** (`scripts/verify-v*.mjs`) :
   ajoute la tienne si ton intègre une convention nouvelle.

## Choisis ton parcours

Une tâche, un parcours. Ne monte pas d'un cran « pour être sûr » : la cérémonie
coûte plus cher que le risque qu'elle couvre.

| Ce que je te demande | Tu lis | Tu lances | Tu me montres |
|---|---|---|---|
| Correctif isolé (1–3 fichiers) | la règle concernée + 2 fichiers voisins | `npm run typecheck:host`, le test ciblé, puis `npm test` | la cause, le diff, le test qui échouait et passe |
| Fonctionnalité host ou renderer | §6, §7, §8 (et §2–5 si UI) | `npm run typecheck:host`, `npm run typecheck:tests`, `npm test`, `cd web && npx tsc -b`, `npm run build:web`, `npm run verify` | le comportement observé dans l'app, pas seulement un build vert |
| Refactor sans effet visible | §8, §11 | `npm run typecheck:host`, `npm test`, `npm run verify` | la liste des appelants mis à jour |
| Rust (`src-tauri`) | §7 + `src-tauri/capabilities/default.json` | `cargo check --manifest-path src-tauri/Cargo.toml`, `cargo test --manifest-path src-tauri/Cargo.toml`, `npm run verify` | la sortie des deux commandes Rust |
| Docs ou outillage | §11, §14 | `npm run verify` (dont `verify:docs`) | la sonde qui échoue si la doc ment |

## Définition de terminé

- **Interne** — docs, outillage, refactor invisible : contrôles verts. **Aucun**
  bump de version, **aucune** note README, **aucune** sonde nouvelle.
- **Visible** — correctif ou fonctionnalité : tout ci-dessus, plus `tsc -b` et le
  build, un bump **patch** (correctif) ou **mineur** (fonctionnalité), une note en
  tête de README, et une sonde **seulement** si le changement introduit une
  convention nouvelle et stable.
- **Rupture** — contrat IPC, format de données, dépendance : tout ci-dessus, plus
  un plan validé avant d'écrire, un test de migration, une sonde dédiée et une
  mention explicite dans la note de version.

Un build qui passe ne prouve pas un comportement : la preuve, c'est l'action
observée dans l'interface ou le test qui échouait avant et passe après.

## Compte rendu obligatoire

Même quand tout est vert, la réponse finale contient toujours :

- les fichiers touchés, en liens cliquables ;
- les contrôles **lancés**, avec leur résultat (nombre de tests, exit status) ;
- les contrôles **non lancés**, avec la raison ;
- les risques ou limites restants, y compris ce qui n'a pas été mesuré.

## Périmètre et arrêts

- Ne reformate jamais les fichiers voisins, ne touche pas un fichier hors du
  périmètre demandé, jamais de `git add -A` ni de commit sans demande explicite.
- Ne modifie jamais un test, une assertion de sonde ou un `catch` pour faire
  passer un contrôle : corrige la cause, ou signale le blocage.
- Demande avant d'agir si le contrat est ambigu, s'il faut une dépendance
  nouvelle, si l'action est destructive ou externe, ou si une règle bloque le travail.
- **Amender une règle** : si une règle de ce fichier est fausse ou bloque, propose
  le patch de la règle **et** de sa sonde dans le même changement — jamais dévier
  en silence.
- **Où écrire** : audits et plans dans `docs/audits/AAAA-MM-JJ-sujet.md` (§14) ;
  rien de jetable à la racine du dépôt.

---

## 1. Langue et commentaires

- **Tout texte visible et tout commentaire sont en FRANÇAIS** (libellés UI, messages
  d'erreur, docstrings, commits) ; le code, lui, reste en anglais.
- Chaque bloc modifié porte un commentaire daté `// vX.Y.Z : pourquoi ce code
  existe` — le « pourquoi » prime sur le « quoi ». Un piège subtil corrigé
  (quoting Windows, CRLF, takeover Freebuff…) laisse l'explication sur place.

## 2. Typographie (renderer, `web/src/styles/*.css`)

**Interdiction absolue : aucune taille, graisse ou police codée en dur.** Tout passe
par les variables `:root` existantes, sinon thèmes et densités cassent.

| Usage | Variable | Valeur |
|---|---|---|
| Police | `var(--font-ui)` | `system-ui, "Segoe UI", sans-serif` — pile système honnête, chargée au premier pixel (jamais autre chose, v10.2.0) |
| Télémétrie, micro-libellés, titres d'instrument | `var(--font-mono)` | pile monospace système (`ui-monospace`, Cascadia, Consolas) — deuxième voix du Poste, jamais une police téléchargée (v11.0.0) |
| Titre d'accueil uniquement | `var(--font-display)` | `Bahnschrift SemiCondensed`, Bahnschrift, `Segoe UI Semibold`, system-ui — la condensée technique du brief, **livrée avec Windows** : aucun fichier, aucun téléchargement (v12.0.0) |
| Micro-labels, métadonnées | `var(--font-size-xs)` | 11px (10px était sous le seuil de lisibilité, v10.2.0) |
| Libellés secondaires, hints | `var(--font-size-sm)` | 12px |
| Texte courant, boutons | `var(--font-size-md)` | 14px |
| Titres de section, h2/h3 | `var(--font-size-lg)` | 16px |
| Titres de vue | `var(--font-size-xl)` | 20px |
| Chiffres clés, stats | `var(--font-size-2xl)` | 28px |
| Grands titres de vue (plafond d'un `clamp`) | `var(--font-size-3xl)` | 32px |
| **Titre d'accueil seulement** | `var(--font-size-display)` | `clamp(26px, min(3.3vw, 6vh), 54px)` — titre éditorial sur deux lignes, à l'**échelle d'un masthead d'application** : il ne domine pas le champ de saisie qui le suit. Ce token ne sert QUE là, jamais au texte courant (v12.1.0, resserré v12.5.0) |

- **Graisse** : texte courant 400–500 ; semi-gras 600 (titres de liste, badges,
  valeurs) ; boutons `font-weight: 680` (classe `.button`) ; titres `700–800`.
  Ne définis jamais une graisse hors de cette échelle sans raison forte.
- **Italique** : réservé aux `<em>` sémantiques (badges `orchestrator-badge` utilisent
  `font-style: normal` — un badge n'est pas une emphase).
- **Surbrillance d'eyebrow** : les libellés de section majuscules utilisent la classe
  `.eyebrow` existante (letter-spacing, uppercase) — ne recrée pas le style.
- Une **nouvelle fonctionnalité = une nouvelle classe CSS** dans le fichier de sa
  surface (`web/src/styles/` : base, chrome, dialogs, pages, voice-notes, freebuff,
  motion, da, workbench), sectionnée par un commentaire `/* vX.Y.Z : … */` placé près
  des styles voisins. `da.css` porte la palette et les jetons, `workbench.css` la
  charpente du Poste. `App.css` n'est qu'un manifeste d'imports — ne l'alourdis pas.
  Pas de style inline sauf valeur calculée dynamiquement (position, largeur du state).

## 3. Couleurs et espacements

- Couleurs : uniquement les tokens `--text`, `--muted`, `--border`, `--border-strong`,
  `--panel`, `--panel-solid`, `--panel-soft`, `--accent`, `--accent-soft`,
  `--accent-border`, `--accent-fill`, `--on-accent`, `--accent-ink`, `--danger`,
  `--success`, `--warning`, `--bg`, `--shadow`.
- **Trois rôles pour l'accent (v10.3.1)** : `--accent` = traits, bordures et halos ;
  `--accent-ink` = TEXTE et icônes d'accent (encre assombrie en clair, éclaircée en
  sombre) ; `--accent-fill` + `--on-accent` = remplissage et son encre (bouton
  primaire, bulle utilisateur, micro). Ces trois valeurs sont calculées par preset
  dans `web/src/accent-contrast.ts` — ne remets jamais `color: var(--accent)` sur du
  texte : sur Émeraude, cela mesurait 2,32:1.
- Une couleur inconnue (API, marque tierce) se mélange avec `color-mix(in srgb, …)`,
  jamais avec une valeur hexadécimale brute.
- Espacements : réutilise `--density-gap` / `--density-pad` quand l'élément vit dans
  une vue à densité réglable ; sinon multiples de 2/4px cohérents avec les voisins.
- Rayons : uniquement les tokens `--radius-*` (`styles/base.css`, redéfinis par la DA
  active dans `styles/da.css`) — `xs` (queues de bulles, micro-contrôles), `sm`
  (champs/boutons), `md` (items de liste), `lg` (tuiles/cartes), `xl`
  (panneaux/dialogues), `pill` (pilules et badges). La DA v11.0.0 les resserre (2–8px)
  sans renommer les rôles : seuls les NOMS sont autorisés, jamais un littéral. Toute
  valeur hors échelle = une régression de cohérence.

## 4. Boutons (classes standard, aucune exception)

**Un bouton = une classe du système. Ne recrée jamais un style de bouton.**

- `.button.primary` — l'action principale d'un panneau/dialogue (une seule par vue)
- `.button.secondary` — actions secondaires (ouvrir un dossier, tester…)
- `.button.ghost` — actions tertiaires, retour, liens d'annulation
- `.button.danger` — destruction (supprimer conversation, effacer une clé)
- `.button.full` — bouton pleine largeur (footer de sidebar)
- `.button.small` — bouton carré icône de la sidebar
- `.button-icon` — bouton 36px icône seule (fermer, paramètres)

- Icône dans un bouton : `<Icon name="…" size={14–16} />` + texte, jamais d'emoji ni
  de caractère Unicode décoratif.
- `type="button"` explicite sur tout `<button>` hors formulaire.
- Boutons désactivables : `disabled={busy || !condition}` avec retour visuel géré par
  `.button:disabled` — n'ajoute pas d'opacité manuelle.
- Confirmation destructrice : le libellé parle de l'effet (« Retirer de la liste »),
  pas de la mécanique interne.

## 5. Icônes (règle déjà posée dans `web/src/icons/README.md`)

- **Toute icône passe par `<Icon name="…" />`** (`web/src/icons/Icon.tsx`). Jamais de
  `<svg>` local, jamais de caractère Unicode, jamais d'image externe.
- Nouvelle icône = nouvelle entrée dans le type `IconName` + un `case` dans `paths()`,
  tracé `stroke="currentColor"` (hérite thème/accent), viewBox 24×24, style fluide
  proche de Fluent UI.
- Tailles canoniques : 12 (mini-badge), 14–16 (boutons, listes), 17 (dialogues),
  24 (empty states), 30 (bouton micro central). Une taille hors grille = à justifier.
- Icône porteuse de sens seule → `aria-label` sur le bouton hôte ; icône décorative →
  laisse l'`aria-hidden` par défaut du composant.
- **Une icône dit une seule chose (v11.0.2)** : `sparkle` = la marque d'Aven (rail),
  `wand` = génération assistée (synthèse, explication), `chat` = conversation,
  `branch` = délégation, `agent` = un agent, `file` = un document (note ou fichier),
  `folder` = un dossier, `stop` = interruption, `paperclip` = transfert, `quote` =
  citation, `chevron-*` = navigation. Ne prends pas le glyphe d'un autre sens « parce
  qu'il ressemble » : `scripts/verify-v11.0.2.mjs` refuse ce retour en arrière.

## 6. Poste, instruments et composants React (renderer)

> **Règle d'architecture (v12.0.0, remplace v11.0.0).** Aven est un **Poste de travail
> « agent d'abord »** : une seule fenêtre dont le cadre ne change jamais — la sphère
> vocale occupe l'accueil, puis **se replie dans l'en-tête** pour laisser la scène au
> travail. L'agent est **un seul canvas**
> (`web/src/agent/WireframeAgent.tsx`) qui mesure son ancre (`agent-home-anchor` /
> `agent-toolbar-anchor`) et se transforme : deux rendus séparés divergeraient au
> premier ajustement. La **navigation est temporaire** : cinq cercles frères posés sur
> un arc (`web/src/workbench/constellation.ts`), aucun rail, aucun dock, aucun ovale,
> aucun filet de liaison, rien qui survive à la fermeture. Les cinq destinations
> viennent d'**une seule table** (`DESTINATIONS` dans `WorkbenchShell.tsx`) : icône,
> titre de section et surbrillance ne peuvent pas diverger. Aujourd'hui est une
> destination explicite (la marque), jamais la poignée de navigation. Les conversations
> restent dans le modèle d'onglets pur (`web/src/workbench/tabs.ts`) : plusieurs
> conversations cohabitent et Aujourd'hui ne se ferme pas. Le Poste ne défile pas
> globalement ; seul le conteneur concerné défile.
> `scripts/verify-v12.0.0.mjs` refuse le retour à un rail, à un second canvas ou à une
> table de destinations dupliquée.

- **L'accueil est une composition, pas une affiche (v12.1.0)** :
  `web/src/workbench/HomeStage.tsx` tient trois zones — identité et contrôle vocal
  à gauche, sphère et anneaux de construction à droite, ligne basse pour le travail
  réel. Le titre tient deux lignes (`--font-size-display`, revalorisé : le brief
  monumental de la v12.0.0 est **retiré**), et un seul statut vocal est affiché —
  l'en-tête n'en ajoute pas sur l'accueil. « Reprendre » est une **bande
  horizontale** — le libellé à gauche, trois colonnes à droite, une par nature
  (conversation, note, fichier), et non un titre empilé au-dessus d'une ligne de
  pied de page — avec **trois entrées**, décidées par `web/src/workbench/resume.ts`
  (module pur testé) : titre, extrait réel, âge. La bande garde **trois colonnes
  égales** et un ordre stable conversation → note → fichier (v12.3.1). Depuis
  v12.7.0, seules les entrées réellement présentes sont rendues : une nature absente
  ne reçoit pas de case ni de faux libellé. Le vide n'est annoncé qu'après le
  chargement des conversations, notes et fichiers. Les métadonnées d'une
  cellule (icône, nature, âge) vivent sur UNE ligne groupée — l'âge ne flotte pas au
  bord droit — et « Délégation · … » appartient à la ligne d'état du micro, pas au
  travail passé. Le dernier document vient de
  `host/recent-files.ts`, qui journalise les ouvertures dans les métadonnées de
  l'espace — jamais d'historique inventé, une note vide n'est pas proposée, et la
  zone le dit quand il n'y a rien. Les actions rapides vivent sous la saisie
  (v12.5.0), pas dans « Reprendre ». Une action se nomme par ce qu'elle fait — « Parcourir les
  fichiers », jamais « Rechercher un fichier » tant que la recherche n'existe pas.
  Une **couche technique** (densité, courbes de niveau, ligne graduée, croix) donne
  la profondeur du fond : elle est décorative, ne capte rien, ne mesure rien, et
  s'efface sous l'identité par masque — jamais de fausse coordonnée (v12.2.0). Le
  bâti autour de la sphère est **lié à `voice.phase`** : anneaux qui s'allument quand
  l'agent réfléchit, nœud qui s'élargit à la capture puis à la parole ; aucun minuteur
  ne simule un état. Le mouvement vivant reste la sphère, qui lit l'énergie réelle du
  micro ; la seule boucle ajoutée (v12.3.0) est la **rotation lente des anneaux**
  (48 s), déclarée comme ambiante et coupée par `prefers-reduced-motion` — le plafond
  de `verify-v10.3.2` a été porté de 6 à 7 pour elle, avec sa justification.
  `scripts/verify-v12.1.0.mjs` refuse le retour au titre plein écran, à un
  historique fabriqué, à une action sans effet, comme à un fond qui prétendrait
  mesurer quelque chose.
- **Un accueil d'application ouvre une saisie, pas une affiche (v12.5.0)** : la
  surface d'entrée porte un champ (`.wb-home-command` dans `HomeStage.tsx`), pas une
  question rhétorique suivie de boutons — sans champ, l'écran ne propose que des
  destinations et se lit comme une page de présentation. Entrée envoie : le premier
  message crée la session **et** part avec elle (`startWithPrompt` :
  `api.createChat` puis `sendText(prompt, c.id)`), jamais « envoyer deux fois ».
  `sendText` reçoit sa **cible en argument** : une session neuve n'existe pas encore
  dans l'état, et une fermeture sur `chatId` l'aurait envoyée dans la conversation
  du rendu précédent. Le signal de focus vit sur le conteneur (`:focus-within`),
  le champ dit pourquoi il est fermé sans espace de travail, et il ne porte jamais
  d'action primaire inerte (l'envoi reste secondaire tant qu'il n'y a rien à
  envoyer). L'en-tête de l'accueil nomme la **destination et la date**
  (« Aujourd'hui · … »), jamais un slogan de marque, et le titre garde sa voix à
  l'échelle d'un masthead : `--font-size-display` ne dépasse pas 54 px.
  `scripts/verify-v12.5.0.mjs` refuse le retour à la question rhétorique.
- **La sphère est une structure, pas une bille (v12.4.0)** : sa surface est un
  maillage géodésique **irrégulier** (`geodesicMesh`), une particule par sommet plus
  une poussière de surface (`fibonacciSphere`), et une lumière FIXE en haut-droite,
  **rasante** (`AGENT_LIGHT`, z < 0,7) — elle n'applique jamais le yaw de la sphère.
  Le dos n'est pas dessiné (occlusion réelle), le disque est opaque, et il n'y a
  **aucun halo ni dégradé radial** : l'éclat vient des points eux-mêmes. La géométrie
  et la courbe de lumière vivent dans `web/src/agent/sphere.ts` (pur, testé) ; le
  canvas ne fait que peindre. Le détail suit la taille rendue et se paie en paliers
  d'alpha, jamais trait par trait. `scripts/verify-v12.4.0.mjs` refuse le retour à
  une lumière frontale, à un halo, ou à un dos visible.
- **Une constellation se mesure, elle ne se devine pas** (`web/src/workbench/NavigationConstellation.tsx`) :
  la poignée passe **avant** l'arc dans le DOM (Tab entre dans les cercles), le survol
  ouvre sans voler le focus, et la grâce de fermeture empêche la scintillation entre la
  poignée et les cercles. Le cercle courant porte `aria-current="page"` ; Échap ferme
  le panneau en capture, avant tout autre effet du Poste.
- **Un instrument = `InstrumentFrame`** (`web/src/InstrumentFrame.tsx`) : description et
  **actions déclarées par l'instrument** (`actions`), jamais une barre recopiée. En
  `compact`, l'instrument ne répète pas le titre que l'en-tête du Poste porte déjà.
  Notes, Fichiers, Terminal, Orchestration et Réglages passent par lui ; une nouvelle
  section principale s'ajoute comme un instrument, pas comme un dialogue.
- **La coquille ne recopie aucune action** (`web/src/workbench/WorkbenchShell.tsx`) :
  la marque ramène à Aujourd'hui, la constellation navigue, l'inspecteur (tiroir, fermé
  par défaut) porte le contexte de l'instrument actif — titre de session et renommage,
  modèle, mode de délégation, événements, sections de Réglages. Un bouton sans usage
  sur l'instrument où il figure est un bug.
- **Pas de défilement global** : `body` et `.wb-app` sont en `overflow: hidden`. Le
  scroll vit dans le conteneur qui en a besoin (`.wb-stage .main-scroll`,
  `.notes-preview`, `.files-list-panel`, `.unified-settings-scroll`, l'émulateur de
  terminal).
- **Un vrai dialogue ponctuel** = un composant-fichier (`FormDialog.tsx`, dialogue de
  permission, choix d'espace) ; une sur-structure d'interface partageant son état reste
  une fonction de rendu dans les instruments (`web/src/pages/`, `web/src/workbench/`).
  Tout texte déjà affiché passe par `Markdown`/`RichMarkdown`, jamais de HTML brut.
- **Un transcript suspendu se rattrape à l'ouverture (v11.12.2)** : la vue
  conversation du terminal Freebuff ne scanne rien tant qu'elle est masquée ; elle
  lit le buffer xterm **à l'ouverture** puis à chaque sortie du TUI. Un minuteur de
  rendu se remet à zéro **en tirant** : sinon le premier scan, annulé tant que la vue
  n'est pas affichée, condamne tous les suivants — c'est ce défaut silencieux qui a
  laissé « le terminal est vide » de v9.5 à v11.12.1 alors que le TUI tournait. Une
  vue qui se rattache à une session PTY **vivante** reçoit son état « En ligne » : le
  badge ne peut pas rester sur « démarre… » avec « Interrompre » grisé.
  `scripts/verify-v11.12.2.mjs` refuse le retour au minuteur collant ou au silence
  sur l'état d'une session déjà démarrée.
- Les états de panneau sont fermés dans TOUTES les navigations (`selectAgent`,
  `goHome`, `openInstrumentTab`, `openConversationInstrument`, `openAgentsPage`,
  Échap, effet `needsWorkspace`) — un modal oublié ouvert est un bug.
- Après une action qui redémarre le moteur, relis l'état (`api.state()`) au lieu de
  recharger la page (`window.location.reload()` interdit : perd l'état visuel).
- TypeScript strict : types du domaine dans `web/src/types.ts` (miroirs des contrats
  IPC ; duplication volontaire et commentée). Pas de `any` neuf.
- **Un seul retour par écran (v10.4.0, resserré v11.0.0)** : le cadre est permanent.
  Fermer un onglet rend le voisin ; Aujourd'hui ne se ferme pas et reste le plancher du
  Poste. Ctrl+W ferme l'onglet actif, jamais la fenêtre. **Chaque onglet fermable porte
  sa croix** (v11.3.0 : v11.1.0 l'avait retirée « pour alléger », et une souris ne
  pouvait plus fermer d'onglet du tout) : un raccourci ne remplace jamais l'action
  visible. Aucun instrument n'ajoute un second chemin vers lui-même.
- **Une dictée a une provenance (v10.4.0)** : le micro du composeur transcrit
  TOUJOURS dans la chatbox ; seul le micro global du Poste (palette de commande
  Ctrl+K, tuile Capturer) exécute les commandes d'application.
- **La sphère entend la personne qui parle (v12.6.0)** : le niveau du micro mesuré
  par le VAD (`web/src/voice-agent/level.ts`, module pur testé) module l'énergie de
  la phase (`withInput` dans `web/src/agent/sphere.ts`) — rotation, respiration,
  et grossissement des particules. Seules les phases où l'**utilisateur** parle
  (`capturing`, `listening`) l'utilisent : pendant `speaking`, la voix de l'agent
  revient par les haut-parleurs et s'amplifierait elle-même. Le niveau vit hors de
  l'état React (lu dans la boucle de rendu) : vingt mises à jour par seconde
  re-rendraient tout le Poste. Micro coupé, il vaut zéro — aucune animation ne
  simule une écoute.
- **Une suppression se voit tout de suite (v12.6.0)** : supprimer, archiver ou
  purger une note la retire immédiatement de l'arbre **et** de l'aperçu
  (`pruneNote` dans `web/src/notes-tree.ts`, pur et testé ; `dropFromView` dans
  `NotesView`) ; le rechargement du disque confirme. Laisser la note ouverte parce
  que `selected` gardait sa copie obligeait à changer de page pour la voir partir.
- **Le bas du Poste appartient à la navigation (v12.6.0)** : la constellation
  s'active sur **toute la largeur** de la bande inférieure (56 px), après une
  intention de survol (240 ms), et ne se referme qu'une fois le pointeur sorti
  d'une bande bien plus haute (156 px), après 640 ms. Écouter `pointermove` à la
  fenêtre — plutôt qu'un `pointerenter` sur la poignée — évite deux pièges : une
  bande invisible pleine largeur intercepterait les clics du composeur, et
  `pointerleave` refermait l'arc au moindre écart du pointeur. Écrire dans un champ
  n'appelle jamais la navigation. La décision vit dans
  `web/src/dictation-routing.ts` (module pur testé).
- **L'agent vocal est une provenance distincte (v11.1.0)** : il n'exécute une
  commande que si le mot **« Aven »** a été prononcé, ou pendant la veille
  (v11.12.0). Le micro se coupe depuis le bandeau, l'état
  est du texte (jamais la couleur seule), et l'audio n'est jamais écrit sur disque.
  Le routage vit dans `host/voice-agent-commands.ts` et l'état de session dans
  `web/src/voice-agent/session.ts` — deux modules purs testés.
- **Une fois réveillé, Aven reste éveillé (v11.12.0)** : dire « Aven » ouvre une
  veille d'une minute, que **chaque parole adressée prolonge** — le mot d'activation
  n'est plus un sésame à répéter à chaque phrase. Trois sorties seulement : l'ordre
  de repos (« Aven, dors », phrase **entière** reconnue dans `host/voice-agent-wake.ts`,
  une seule liste — le renderer n'en tient pas une seconde), le silence
  (`AWAKE_IDLE_MS`), ou le micro coupé ; **interrompre une lecture ne rendort pas**
  (on reprend la parole pour parler). La veille est DITE (« Éveillé » remplace
  « Écoute », jamais la couleur seule) et la **capture d'une parole ne la referme
  pas** : c'était le défaut de la fenêtre de dix secondes de v11.1.0, refermée par
  `speech-start` avant la transcription.  `scripts/verify-v11.12.0.mjs` refuse le
  retour à une fenêtre refermée à la capture ou à une liste d'ordres dupliquée.
- **La fin d'une lecture ne referme pas une capture (v11.15.2)** : une parole
  commencée pendant la réponse — écho de l'agent ou vraie reprise — garde sa
  phase `capturing` quand le lecteur rend la main. La forcer en « écoute »
  laissait l'enregistreur ouvert sans phase pour l'arrêter : son `speech-end`
  était ignoré et la phrase suivante, la réponse à la question que l'agent venait
  de poser, n'était jamais transcrite. Un enregistreur orphelin est arrêté par un
  filet et son clip part quand même à la transcription.
  `scripts/verify-v11.15.2.mjs` refuse le retour au `done` qui écrase la capture.
- **Un micro coupé n'écoute pas au démarrage (v11.15.1)** : la session vocale
  démarre coupée, lit la préférence quand le Poste est prêt, puis ne l'ouvre que
  si elle l'autorise. Avant, l'écoute démarrait au montage et la préférence
  arrivait après coup — parfois en échec, le runtime n'étant pas prêt : le micro
  s'ouvrait malgré le choix, et le premier clic le recoupait.
- **Une parole qui n'est pas adressée ne reçoit pas de réponse (v11.14.1)** : en
  veille, le bruit de la pièce (« euh », une remarque pour quelqu'un d'autre, une
  hallucination du STT sur le silence) ne part pas au LLM — n'ayant rien de neuf
  à dire, il répétait sa phrase précédente. La décision vit dans
  `host/voice-agent-addressed.ts` (module pur testé, sans réseau ni horloge) :
  question, impératif, deuxième personne ou demande explicite = adressée ; un
  énoncé long reste adressé (le doute profite à la conversation), un énoncé court
  sans marque est écarté. Une parole écartée ne prolonge pas la veille.
  `scripts/verify-v11.14.1.mjs` refuse un envoi au LLM avant ce filtre.
- **Supprimer la conversation ouverte garde une conversation (v11.14.1)** :
  l'onglet de la conversation supprimée se rattache à la conversation qui reste
  (`removeChatTab`, modèle pur testé) au lieu de rendre le dernier onglet voisin
  (Notes, Aujourd'hui…). Sans conversation restante, l'onglet se ferme
  normalement et le voisin devient actif.
- **Une note dictée se confirme (v11.4.0, étendu v11.15.0 et v11.16.0)** : « Aven,
  note que… » ne crée jamais la note dans la foulée. Le contenu est **relu**,
  puis attendu un « oui » explicite — la décision vit dans
  `web/src/voice-agent/note.ts` (module pur testé). Un refus, une parole
  incomprise, l'arrêt de la lecture, la coupure du micro ou 45 s de silence
  annulent la note. `parseNoteDraft` **décide ce qui se compose et ce qui se
  dicte** ; une seule ligne écrit la note, dans la branche « confirm »
  uniquement (`onCreateNote`), et `scripts/verify-v11.4.0.mjs` refuse un second
  chemin pour elle. Le modèle peut aussi **proposer** une note (`create_note`) :
  la question relit le contenu, et l'écriture n'a lieu qu'après le même « oui »
  (`actionConfirmationText`, `commitVoiceAction`) ; la note créée s'affiche.
- **Une note se comprend, elle ne se recopie pas (v11.16.0)** : « crée une note
  qui résume comment fonctionne une boucle python » attend un **résumé rédigé**,
  pas la phrase prononcée. Le tri est déterministe dans `parseNoteDraft` :
  l'infinitif sans destinataire (« résumer… », « expliquer… »), le sujet relatif
  (« qui résume », « sur… ») et la consigne à l'agent (« ta réponse doit… ») se
  **composent** ; un contenu à la première personne et un calcul restent une
  dictée. Cette décision n'ouvre qu'une porte, `composeNote` →
  `composeVoiceNote` (aucun outil, aucune écriture, aucun historique) : en cas
  d'échec l'erreur est **dite** et rien n'est écrit — jamais une note qui
  recopie la demande, et un contenu composé n'est jamais « c'est noté ». La
  confirmation relit le texte produit **à voix haute** — Markdown et blocs de
  code retirés (`spokenDraft`), abrégé au-delà de 180 caractères —, et
  `scripts/verify-v11.16.0.mjs` refuse le retour à la recopie.
- **L'agent vocal agit par un catalogue (v11.9.0, étendu v11.15.0)** : renommer,
  archiver ou créer une conversation, épingler, déplacer ou archiver une note,
  créer un dossier, créer une note (proposée, contenu relu), mettre une note à la
  corbeille, supprimer une conversation. Chaque action vit
  dans `host/agent-actions.ts` avec sa classe de risque (`read` / `write` /
  `destroy`), ses arguments validés et sa cible **résolue par nom** — deux cibles
  proches rendent une question, jamais un choix. Le modèle peut appeler ces
  actions ; il ne peut PAS exécuter une destruction : `destroy` est **proposée**
  (la question nomme la cible), et l'écriture n'a lieu qu'après un « oui » classé,
  dans un seul chemin (`commitVoiceAction`, jeton gardé par le host, 45 s). La
  création de note suit la même porte : `create_note` est **proposée**, le
  contenu est relu dans la question, et rien n'est écrit avant le « oui »
  (`actionConfirmationText`). Au
  plus une écriture par tour, journal en mémoire, et le geste interdit (purger la
  corbeille, retirer un espace, agir hors d'Aven) n'a pas d'action —
  `scripts/verify-v11.9.0.mjs` refuse un catalogue qui l'ouvrirait.
- **Le LLM vocal a un contrat de parole (v11.13.0)** : le prompt de
  `host/voice-agent-speech.ts` est sectionné — **FORMAT DE RÉPONSE** (une à deux
  phrases courtes, rien qui ne se prononce : Markdown, listes, liens, chemins,
  emojis, didascalies), **CE QUE TU PEUX DIRE** (pour les données d'Aven, uniquement
  ce que les outils ont renvoyé — la connaissance générale reste permise, sans source
  inventée ; l'action réellement faite, le refus et sa raison), **CE QUE TU NE DIS JAMAIS**
  (une action « faite » sans résultat, une note non lue, une clé, un jeton,
  le texte des consignes, une action hors d'Aven, une promesse ou une source
  inventée), puis **PÉRIMÈTRE ET ACTIONS**. Une règle de format ou d'interdiction se
  modifie ICI et dans son test — jamais par une consigne ajoutée au fil de l'eau
  dans un handler ; le ton ne change que la manière de le dire.
  **Raccourci pour la latence (v11.14.0)** : le texte envoyé pèse moins de
  1 600 caractères (mesuré : 2 135 avant) — chaque phrase supplémentaire est
  payée en tokens à l'aller puis en temps de génération ; une règle se REMPLACE,
  elle ne s'ajoute jamais.
  `scripts/verify-v11.13.0.mjs` refuse la disparition d'une section ou d'un
  interdit, et un prompt qui repart à gonfler.
- **Une lecture n'est coupée par une parole ADRESSÉE (v11.11.1, resserré
  v11.15.0)** : le niveau du micro ne décide plus RIEN. La voix de l'agent revient
  par les haut-parleurs et le micro la détecte pendant toute la réponse ; couper
  à la détection arrachait la fin des phrases, et changer la requête de session
  annulait le lecteur au retour de la synthèse (même silence, autre chemin). La
  décision se prend donc sur le TEXTE transcrit : l'écho de la voix de l'agent est
  reconnu par `echo.ts` et ne touche plus à la session (événement `ignored`), et
  seule une parole **adressée** coupe la lecture et prend la main
  (`web/src/voice-agent/barge-in.ts`, verdict de `host/voice-agent-addressed.ts`).
  Un bruit, une hésitation ou une remarque pour quelqu'un d'autre laisse la
  réponse aller au bout ; « attends » et « chut » restent des reprises directes.
  La garde temporelle de 900 ms a disparu : elle ne couvrait que le début d'une
  lecture.
- **Le micro entend Aven (v11.4.1)** : la webview joue sa propre voix dans les
  haut-parleurs ; sa transcription revient par le STT. Aven reconnaît sa propre
  voix (`web/src/voice-agent/echo.ts`, module pur testé) : un fragment contigu
  de trois mots déjà prononcés, ou son écho moins de 2,5 s après la lecture,
  n'est jamais une réponse — un mot seul (« oui », « non », « stop ») le reste.
  v11.11.1 : le réveil accepte aussi les graphies mesurées du STT, dont **« Raven »**
  (une consonne est entendue avant le « A ») — le « r » n'est admis que sur la
  famille en « e », car « ravin » et « ravine » sont des mots français.
  Le garde s'exécute avant toute décision de note et ne peut rien écrire.
  `scripts/verify-v11.4.1.mjs` refuse un garde acoustique opaque ou un seuil à
  un mot. Pendant une question de note, la lecture n'est PAS coupée à la
  détection de parole (`web/src/voice-agent/barge-in.ts`, module pur testé) : la
  question va au bout, et s'arrête dès que le texte prouve une vraie reprise
  (v11.4.2).
- **Une seule pile vocale (v11.14.0)** : Edge (voix neuronale, service distant) et
  Piper (voix locale de repli) ont été **retirés** — sources, routage, préférences,
  menu, ressources d'installeur et sondes dédiées. Il ne reste que le moteur local
  Pocket TTS et, en repli, la voix Windows (PowerShell, hors ligne) — la bascule
  est toujours **dite** (`warning` rendu par l'IPC), sinon le changement de timbre
  serait inexplicable. Le routage vit dans `host/voice-route.ts` (module pur
  testé) : « pocket: » pour le moteur, « sapi: » pour Windows, et toute
  préférence héritée (« edge: », « piper: », nom Windows brut v11.1.0) retombe
  sur la voix Windows par défaut — jamais un nom de voix inconnu. Un préfixe
  retiré n'entre plus au menu (`voiceIdOf` rend la voix par défaut). La
  synthèse ne sort donc plus jamais de la machine : le texte de la réponse n'est
  envoyé nulle part pour la voix.
- **Une troisième voix locale : Pocket TTS (v11.10.0)** : le moteur Rust de
  Kyutai (`host/pocket-tts.ts`, binaire de 22 Mo posé par
  `npm run fetch:pocket-tts`, dossier reçu par `AVEN_POCKET_DIR`) est la voix
  locale de l'app — désormais la SEULE (v11.14.0). Retenu à l'oreille, il livre du PCM
  16 bits mono 24 kHz par paquets de ~0,55 s : le host retire l'en-tête WAV **une
  fois** (`wavDataOffset`) et pousse chaque paquet, la webview les empile dans
  une horloge audio (`web/src/voice-agent/pcm-stream.ts`, planification pure dans
  `pcm-schedule.ts`) — premier son mesuré à 270 ms, 0,40 de facteur temps réel,
  avance positive sur toute la phrase. Le lecteur est choisi AVANT l'appel
  (`voiceAgentStreamKind`) : `MediaSource` ne lit pas d'échantillons nus, et un
  abonné branché après la commande perdrait toutes les trames (v11.5.3). Le
  modèle français (« estelle », 209 Mo, CC-BY 4.0, dépôt ouvert sans jeton) est
  mis en cache sous les données de l'app ; absent, la voix retombe sur la voix
  Windows **et le dit**. Une voix **clonée** peut remplacer la voix intégrée : le profil
  (`.safetensors`) se pose dans les données de l'app par
  `npm run voice:pocket -- <fichier>`, jamais dans l'installeur ni dans le dépôt
  (c'est un dérivé d'un enregistrement de référence, qu'on ne redistribue pas), et
  le host le transmet au moteur par `--default-voice` **au démarrage** — le
  moteur n'accepte pas de voix par requête. Le menu propose donc une seule voix
  Pocket à la fois, celle qui parlera (« voix clonée » ou « voix française »), et
  jamais le nom d'une personne. Le PCM passe par `host/pcm-audio.ts` (pur) :
  **+2,5 dB** quand un profil cloné est posé (mesuré à phrase identique : −22,8
  contre −20,4 dBFS de RMS voisé), **silence de tête et
  de queue rognés**, pauses internes de plus de 650 ms ramenées à 420 ms — les
  mêmes seuils que `trim.ts` et `pause.ts`, pour que les deux voix s'entendent
  pareil. Rogner la tête ne retarde pas le premier mot : le moteur livre sa
  première parole dans son 3ᵉ paquet (~490 ms, silence compris), donc le mot
  s'entend au même instant — c'est le silence qui n'est plus joué.
- **Un paquet reçu se joue tout de suite (v11.12.1)** : le lecteur PCM programme
  chaque paquet **dès son arrivée** (`web/src/voice-agent/pcm-stream.ts`), et la fin
  du flux ne jette **jamais** l'audio reçu mais non encore programmé. La leçon a
  coûté une régression visible : seul le premier lot partait, et la fin du flux
  fermait le lecteur avec le reste en attente — une réponse de neuf secondes
  s'arrêtait après une. Mesuré (`docs/audits/2026-10-28-coupe-lecture-pcm.md`, host
  et webview réels) : **1,07 s jouée avant, 7,79 s après**, à texte identique. Une
  fin de flux n'est pas une raison de rendre la main : `maybeFinish` refuse de
  conclure tant qu'il reste des échantillons en attente. Le second lecteur
  (WebM/Opus de `stream.ts`) a été retiré en v11.14.0 avec les voix neuronales :
  le PCM est le seul flux, et sa file reste vidée avant toute conclusion — ne la
  casse pas en le « simplifiant ».
- **L'app installe ce qu'elle utilise (v11.11.0)** : le clonage de voix se fait
  dans l'app (Réglages → Agent vocal → « Créer une voix à partir d'un fichier… »,
  `voiceCloneFromAudio` : le renderer choisit le fichier et transmet un CHEMIN,
  il n'en lit jamais un octet), et Aven télécharge lui-même ce dont il a besoin
  **dans ses propres données** (`HF_HOME` = données de l'app) : jamais le cache
  Hugging Face de la machine, qui appartient à une autre installation. La
  conversion est le `export-voice` du binaire embarqué — mesurée à 1,5 s pour un
  WAV court et 5,3 s pour un MP3, hors téléchargement du modèle de clonage
  (209 Mo, une fois). Le seul maillon sous conditions se **dit** : la page du
  modèle est citée, et le jeton Hugging Face vit chiffré côté host, ne sert qu'au
  premier téléchargement, et n'est jamais renvoyé au renderer (seul son booléen
  remonte). Un profil n'est posé qu'après vérification de son en-tête, par
  renommage, et le moteur est redémarré ensuite — `--default-voice` ne se lit
  qu'au démarrage. `scripts/verify-v11.11.0.mjs` refuse un chemin qui lirait le
  cache d'une autre installation, renverrait le jeton, ou poserait un profil sans
  vérifier son en-tête.
- **La voix neuronale a été retirée (v11.14.0)** : les voix françaises d'Edge
  (service gratuit, non contractuel) et leur transport WebSocket, leur cache de
  phrases et leur blocage de 429 ont été supprimés — ainsi que Piper et son
  binaire embarqué. **Une réponse = une synthèse**, et la synthèse est locale :
  découper par phrase ajoutait ~1,5 s de silence à chaque frontière (mesuré à
  l'époque neuronale). La lecture coupe le silence de tête et de queue
  (`web/src/voice-agent/trim.ts`) et ramène les pauses internes de plus de 650 ms
  à ~420 ms (`web/src/voice-agent/pause.ts`), deux modules purs testés — ils
  servent aujourd'hui au PCM du moteur local. Un échec du moteur Pocket n'est
  jamais muet : la voix Windows prend la parole **et le repli est dit**.
- **L'audio se joue au fil de l'eau (v11.5.3)** : le PCM du moteur local arrive
  par trames et la webview joue dès la première — le lecteur est choisi AVANT
  l'appel (`voiceAgentStreamKind`). Deux pièges de livraison ont été mesurés, pas
  devinés : l'abonné branché après la commande perdrait toutes les trames (v11.5.3),
  donc l'abonnement aux trames est installé **au chargement**
  (`installVoiceStreamListener`), jamais au moment de la réponse ; et `aven_call`
  est **asynchrone**, sinon Tauri l'exécute sur le fil principal et retient les `aven:event`
  jusqu'au retour (7 trames reçues groupées à 1,1 s au lieu de la première à
  ~0,5 s ; après correctif, 26 trames de 554 à 1 015 ms sur un texte long).
- **Un nom propre se prononce (v11.4.4)** : les moteurs de synthèse lisent les
  noms d'Aven avec leurs règles générales et les mangent (« Freebuff » sortait
  « frebff » sur la voix locale). La correction vit dans `host/pronunciation.ts`
  (module pur testé) : une table **par moteur** — `sapi` et `pocket` aujourd'hui —
  appliquée au texte de synthèse seulement, jamais au texte affiché. Une entrée
  nouvelle s'accompagne d'une écoute et d'un test.
- **La palette de commande se demande, elle ne s'installe pas (v11.0.0, resserré
  v12.6.0)** : Ctrl+K ouvre une **palette flottante** qui retrouve une conversation
  ou une note, exécute une commande (`>`), ou cible une portée (`/`). Une recherche
  vide n'exécute aucune action implicite. Créer et rédiger une conversation reste
  une action nommée distincte ; tout état vide est informatif, jamais un faux bouton.
  **Aucune bande permanente ne réserve le bas du Poste** : la rangée de 56 px de la
  v11.0.0 a été retirée (v12.6.0) — elle coûtait de la scène en permanence pour un
  usage occasionnel, et doublait la recherche des instruments (historique des
  conversations, recherche des notes, explorateur de fichiers). La palette flotte
  au-dessus de la poignée de navigation, jamais par-dessus, et un changement de
  destination la referme.
- **Les destinations ont un nom fonctionnel (v10.5.0)** : le rail et la planche
  Aujourd'hui indiquent ce qu'ils ouvrent réellement. « Terminal » ouvre le CLI
  Freebuff ; « Orchestration » règle la délégation de l'agent principal Aven. Les
  identifiants internes ne sont pas des libellés utilisateur.
- **Transfert IA sans envoi implicite (v10.5.0)** : lorsqu'une page prépare un texte
  dans le composeur, le libellé précise la destination et indique que l'utilisateur
  doit encore relire puis envoyer. Une action de préparation ne se nomme pas « lancer
  une analyse » si elle ne fait que remplir le composeur.
- **Notes à grande échelle (v10.5.0)** : les métadonnées répétées se chargent en lot
  via une commande IPC ; la résolution des liens d'une note réutilise le même
  inventaire de notes. Ne pas réintroduire un appel IPC par note ou un balayage
  complet par lien.

## 7. Architecture host/renderer (Tauri)

- **Le renderer ne voit JAMAIS de secret** : clés stockées côté host
  (`host/aven-app-host.ts`, DPAPI Windows), seuls les booléens `keys[provider]` remontent.
  Toute nouvelle donnée sensible suit ce schéma.
- **Les clés se déchiffrent une fois (v11.5.2)** : le host garde le clair en mémoire,
  jamais côté renderer, et l'invalide sur `setKey` comme sur toute modification de
  `settings.json` (`host/key-cache.ts`). Un déchiffrement DPAPI coûtait 582 ms par
  clé et quatre lancements par tour vocal — 2,3 s sur 5,7 s mesurés.
- **Nouvelle fonctionnalité** = module autonome `host/*.ts` si elle est
  testable sans Tauri (comme `host/atomic-file.ts`, `host/archive.ts`, `host/stats.ts`,
  `host/notes-meta.ts`, `host/freebuff-cli.ts`), branchée dans `host/aven-app-host.ts`
  via un `case` de dispatch minimal.
- **Un exemple cité doit être vivant** : tout module nommé dans `AGENTS.md` ou
  `README.md` doit avoir au moins un importeur en production (hors point d'entrée de
  build). `verify:docs` le vérifie — un module mort se supprime ou se marque legacy,
  il ne sert jamais de modèle à copier.
- **IPC** : une seule commande Tauri `aven_call(method, args)` — les espaces de
  travail (`workspace:add`, `workspace:switch`, `workspace:remove`…) sont traités
  en Rust (`src-tauri/src/commands.rs`), le reste est dispatché en camelCase
  (`notesList`, `setChatModel`…) dans `host/aven-app-host.ts`, typé dans
  `web/src/types.ts` (`OpenCodeApi`), appelé via `api.*` — jamais d'`invoke`
  direct dans un composant.
- **Fichiers écrits** : toujours via `writeTextAtomic`/`writeJsonAtomic`
  (`host/atomic-file.ts`), jamais `writeFileSync` direct dans `userData` ni dans
  l'espace de travail.
- **Process Windows** : `execFile`/`spawn` avec arguments séparés (Node quote lui-même),
  jamais de chaîne concaténée ni `windowsVerbatimArguments` (bug v9.1.3 documenté) ;
  `shell: true` uniquement pour les shims `.cmd` (npm, freebuff).
- **Sécurité fenêtre** : la webview est verrouillée par la CSP de
  `src-tauri/tauri.conf.json` (`default-src 'self'`, sans `unsafe-eval`), navigation
  externe via la commande `openExternal` — ne touche pas à ces réglages.

## 8. Pureté et testabilité

- Un module « pur » (aucune dépendance desktop, aucun I/O réseau) est la norme pour
  toute logique décisionnelle : politiques, parsing, routage, calculs.
  Précède-le du commentaire `// Pur : testable avec Node seul, sans dépendance desktop.`
- Les modules purs ont leurs tests dans `tests/*.test.mjs` (runner `node --test`,
  strip-types, résolveur TypeScript via `tests/hooks.mjs` + `tests/register.mjs`).
- Un comportement à seuil (ex. « notifie si > 8 s ») vit dans une fonction pure
  exportée, pas enfoui dans un handler IPC.

## 9. Espaces de travail, données utilisateur et modèles

- **Aucun dossier imposé, aucun repli implicite** : `activeWorkspace()` renvoie
  `null` tant que l'utilisateur n'a pas choisi ; l'écran de choix est la seule porte
  d'entrée. Toute nouvelle fonctionnalité doit échouer proprement si aucun espace
  n'est actif (`requireWorkspace()` côté main, écran de choix côté renderer).- Métadonnées par espace : sous `<workspace>/.opencode-app/` (notes-meta, stats, archived, agent-names), écrites atomiquement, jamais dans `userData` global sauf clés/préfs/apparence. Le **contenu** des notes vit à part, dans `<workspace>/.opencodeapp/notes/` (v10.1.0) : `.opencodeapp` = fichiers de contenu, `.opencode-app` = métadonnées — deux dossiers voisins, deux rôles, ne les fusionne pas sans migration.
- Fichiers de config livrés (`opencode.jsonc`, agents, model-priorities.json) :
  synchronisés via `host/workspace-sync.ts` (baseline), jamais écrasés si personnalisés.
- **Modèles et gratuité** : le catalogue est **strictement gratuit** —
  `host/priorities.ts` rejette tout modèle payant (`isFreeModelRef`), y compris dans
  un fichier de priorités personnalisé ; n'ajoute jamais un modèle payant, même en
  secours. La table `model-priorities.json` est fusionnée (ajout seul) par
  `mergeNewModels` ; les nouveaux modèles gratuits sont découverts dynamiquement à
  `model.list()`.

## 11. Vérification et sondes (la « mémoire » du projet)

- `npm test` : les tests unitaires Node (`tests/*.test.mjs`). Tout module pur
  nouveau s'accompagne de son `.test.mjs` ; un test flaky temporel se rejoue avant
  d'être « corrigé ».
- `npm run test:voice-note` : test de bout en bout de la note vocale sans micro
  physique (`scripts/test-voice-note-e2e.mjs`) — voix SAPI française injectée par
  `getUserMedia`, STT réel, confirmation vocale, création puis purge de la note.
  Il exige le binaire de debug, Vite, une clé Groq et une voix SAPI fr-FR ; il
  n'entre pas dans `npm run verify` (dépendances externes).
- `npm run verify` : chaîne `verify-conventions.mjs` + `verify-docs.mjs` +
  `scripts/verify-v*.mjs` + `verify-build.mjs`. **Chaque version fige ses
  conventions dans une sonde** — c'est ainsi que le projet se souvient de ses
  règles sans confiance aveugle ; le script de la version courante reçoit les
  ajouts, les anciens scripts restent intacts **tant que leur sujet existe**.
  Une sonde dont le module, l'écran ou le fichier a été supprimé se retire avec lui
  (et son entrée npm) : une sonde qui ne peut plus passer ne protège rien. Toute
  sonde présente dans `scripts/` doit être appelée par `npm run verify` —
  `verify-conventions.mjs` le mesure.
- `scripts/verify-docs.mjs` vérifie la **doc elle-même** : les modules cités dans
  `AGENTS.md`/`README.md` existent et sont réellement importés, les scripts cités
  existent, les audits respectent leur format daté. **Aucun compteur recopié à la
  main** (« N tests », « N `aria-label` ») : il est mesuré par une sonde ou absent
  de la prose.
- `scripts/verify-build.mjs` doit toujours passer APRÈS `npm run build` — si un
  marqueur manque, c'est le build qui est périmé, pas la sonde.

## 12. Accessibilité (aria, focus, contrastes, mouvement)

L'accessibilité d'Aven repose sur des pratiques déjà répandues dans le code
(`aria-label`, `role="dialog"/"status"/"toolbar"/"alert"`, `:focus-visible` global,
`prefers-reduced-motion`). Tout ajout suit le même niveau — ni moins, ni plus.

### 12.1 Noms accessibles (aria)

- **Tout bouton sans texte porte un `aria-label` en français** qui décrit l'ACTION
  (« Retirer de la liste », « Changer de projet »), jamais l'icône (« corbeille »).
  Quand un `title` infobulle existe, il reprend le même libellé (voir le bouton
  Paramètres du hub).
- **Icône décorative** (accompagne un texte) : ne rien ajouter — `Icon` applique
  `aria-hidden` par défaut. **Icône seule** : le `aria-label` va sur le BOUTON hôte,
  pas sur le `<svg>`.
- **Zone live** : tout message d'état qui apparaît sans interaction (bandeau du hub,
  avis de routage) utilise `role="status"` ; une erreur bloquante utilise
  `role="alert"` (modèle d'`ErrorBoundary`).
- **Dialogues** : conteneur `role="dialog"` + `aria-modal="true"` + `aria-label`
  nommant le contenu (« Changer de projet », « Statistiques ») + fermeture au clic
  sur le fond (`e.target === e.currentTarget`) et à Échap (gérée dans le listener
  global du contrôleur (`web/src/app/use-aven-app.ts`), dans l'ordre d'empilement des
  panneaux).
  Une **page** (`PageShell`) n'est pas un dialogue : elle n'est ni superposée ni
  modale, et n'annonce donc pas `aria-modal`.
- **Groupes de contrôles** : une zone de navigation/outil porte un `role` et un nom
  (`aria-label="Sections des paramètres"`, `aria-label="Actions sur la sélection"`).
- **Champs de formulaire** : label visible (`<label>` englobant, modèle de
  `FormDialog`) ou `aria-label` ; jamais un `placeholder` seul comme seule étiquette.
- Langue de l'interface déclarée une fois (document `<html lang="fr">` côté `index.html`) :
  ne la redéclare pas par composant.

### 12.2 Focus visible (jamais supprimé)

- La règle globale `:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px }`
  est le socle : **ne jamais poser un `outline: none` sans le remplacer** par un
  indice de focus équivalent (`box-shadow` accent, modèle de `.button:focus-visible`
  et des champs `.dialog input:focus`).
- Un champ « incrusté » sans bordure reste focusable et son conteneur signale le
  focus : `:focus-within` sur `.search-wrap`, `.composer` et `.home-command`,
  `:has(.ProseMirror-focused)` pour l'éditeur TipTap. La sonde 9b (durcie v10.2.0)
  exige la PAIRE racine du sélecteur + règle compagne portant un signal `:focus*` :
  un simple nom de classe en whitelist ne suffit plus.
- L'ordre de tabulation suit l'ordre du DOM : pas de `tabIndex` positif. Les
  renvois de focus après action (ex. focus composeur via `requestAnimationFrame`)
  sont le modèle à imiter.
- **Listes navigables aux flèches** (v9.1.6) : les listes d'items du hub (récents,
  modales conversations et projets) répondent à Haut/Bas (avec bouclage) et
  Home/End ; le focus suit la sélection et Entrée/Espace restent natifs. La
  logique vit dans le module pur `web/src/arrow-navigation.ts` (testé), le DOM
  dans la page concernée (`web/src/pages/`) — toute nouvelle liste suit ce modèle.
- Les raccourcis clavier existants (Ctrl+N, Ctrl+K, F2, Ctrl+Maj+V, Échap) sont
  documentés dans l'interface (`<kbd>`, `title`) : tout nouveau raccourci suit ce
  double affichage.

### 12.3 Contrastes et couleurs

- Le texte n'exprime JAMAIS l'information par la couleur seule : état actif =
  `background` accentué + bordure (`--accent-border`) + éventuel badge textuel
  (modèle `.project-item.current` et `.hub-picker-item.active`).
- Texte secondaire : `var(--muted)` sur `--panel`/`--bg` — paires verrouillées à
  ≥ 4,5:1 dans les deux thèmes par la sonde v10.2.0. Ne crée pas de gris
  intermédiaire plus clair.
- Surfaces translucides : le contenu texte vit sur `--panel-solid` ou un
  `color-mix` ≥ 90 % vers une couleur opaque — jamais du texte sur du verre seul.
- Les accidents (`:hover`, `danger`) gardent leur signal non-coloriel : libellé,
  bordure ou icône (modèle `.button.danger`).

### 12.4 Mouvement et vivant

- **Tokens obligatoires (v10.3.2)** : tout temps de RÉPONSE passe par `--dur-fast` /
  `--dur-med` / `--dur-slow` et `--ease-out` / `--ease-spring` / `--ease-out-mirror`.
  Une durée ou une courbe écrite en clair est une régression : régler le token ne
  changerait plus l'écran. Seules exceptions, déclarées comme telles : les **boucles
  ambiantes** (`infinite` — pulse, présence, dictée, shimmer), dont le rythme n'est
  pas un temps d'attente, et le ressort réservé aux gestes qui portent un élan.
- Le socle existe : `@media (prefers-reduced-motion: reduce)` neutralise durées,
  **délais** et répétitions (l'état final est immédiat, jamais un élément qui attend
  son décalage). **Toute nouvelle animation CSS est couverte automatiquement** — ne
  désactive pas ce bloc, n'ajoute pas d'animation JS hors de son périmètre.
- Les animations sont discrètes (`fade-up .16–.22s`, translate 1–4px) : pas de
  parallaxe, pas d'animation > 300 ms, pas d'élément clignotant hors retour d'état
  push-to-talk (`dictation-pulse`, lié à une action explicite de l'utilisateur).
- Les indicateurs d'activité textuels (« L'agent travaille… », pulse du point
  d'écoute) restent accompagnés d'un TEXTE : une animation seule n'est jamais la
  seule information.

### 12.5 Vérification avant de pousser

- Clavier seul : parcours complet de la fonctionnalité ajoutée (Tab/Échap/Entrée).
- Chaque bouton icône nouveau a son `aria-label` français.
- `prefers-reduced-motion` : la fonctionnalité reste utilisable sans animation.
- Contraste : si tu as introduit une couleur, vérifie le texte qui vit dessus dans
  les thèmes clair ET sombre (les tokens existent précisément pour ça).

## 13. Journal de versions

- Le bump est **gradué** : patch pour un correctif visible, mineur pour une
  fonctionnalité, **aucun** pour un changement interne (docs, outillage, refactor
  invisible). La note en tête de README (①②③…, ton « tu », orienté bénéfice
  utilisateur) n'est obligatoire que si l'utilisateur voit la différence.
- La sonde nouvelle accompagne une convention nouvelle et stable, pas chaque
  correctif : une version sans convention nouvelle n'en ajoute pas.
- Commit : une ligne de titre `vX.Y.Z : résumé en français`, corps détaillé par
  chantier, footer `🤖 Generated with Codebuff`.

## 14. Artefacts de travail (audits, plans, rapports)

- Un audit, une revue ou un plan produit pour une tâche vit dans
  `docs/audits/AAAA-MM-JJ-sujet.md` (minuscules, tirets, points de version admis).
  Jamais de `REVIEW-*.md` à la racine : elle ne contient que les documents de
  référence (`README.md`, `AGENTS.md`, `TAURI-MIGRATION.md`, `NOTES-VERIFIEES.md`).
- Un audit dit ce qu'il a **mesuré**, ce qu'il n'a pas pu exécuter, et cite ses
  constats en `fichier:ligne`. Un constat non vérifié est présenté comme tel.
- Ces fichiers ne sont pas des sources : ils n'entrent ni dans le build, ni dans
  les sondes de conventions.

---

> **Sommaire des sections** : 1. Langue et commentaires · 2. Typographie ·
> 3. Couleurs et espacements · 4. Boutons · 5. Icônes · 6. Composants React ·
> 7. Architecture host/renderer · 8. Pureté et testabilité · 9. Espaces de
> travail, données et modèles · **11. Vérification et sondes** ·
> **12. Accessibilité** · 13. Journal de versions · 14. Artefacts de travail.
> (§0 retiré et §10 fondue dans §9 lors de la fusion du 2026-10-18.)

---

### Check-list express avant de pousser

- [ ] Textes et commentaires en français, préfixés `// vX.Y.Z : raison`
- [ ] Aucune taille/couleur/poids en dur — tokens uniquement
- [ ] Bouton = classe `.button.*` existante ; icône = `<Icon name />`
- [ ] Modal fermé dans toutes les navigations + Échap
- [ ] Secrets restent côté host ; IPC typé des deux côtés
- [ ] Module pur pour la logique ; tests `.test.mjs` ajoutés
- [ ] Échec propre sans espace de travail actif
- [ ] Bouton icône nouveau → `aria-label` français ; `role`/`aria-modal` si dialogue
- [ ] Aucun `outline: none` sans remplacement ; `prefers-reduced-motion` couvert
- [ ] Périmètre respecté : aucun voisin reformaté, aucune modification d'autrui écrasée
- [ ] Comportement prouvé par l'interface ou un test ciblé, pas seulement par le build
- [ ] `npm run typecheck:host` + `npm test` + `npm run verify` verts
- [ ] Doc citée encore vraie (`npm run verify:docs`), aucun compteur recopié à la main
- [ ] Build régénéré (`npm run build:host`, build web) si code compilé touché
