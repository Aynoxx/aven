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
| Télémétrie, micro-libellés | `var(--font-mono)` | pile monospace système (`ui-monospace`, Cascadia, Consolas) — deuxième voix du Poste, jamais une police téléchargée (v11.0.0) |
| Micro-labels, métadonnées | `var(--font-size-xs)` | 11px (10px était sous le seuil de lisibilité, v10.2.0) |
| Libellés secondaires, hints | `var(--font-size-sm)` | 12px |
| Texte courant, boutons | `var(--font-size-md)` | 14px |
| Titres de section, h2/h3 | `var(--font-size-lg)` | 16px |
| Titres de vue | `var(--font-size-xl)` | 20px |
| Chiffres clés, stats | `var(--font-size-2xl)` | 28px |
| Grands titres de vue (plafond d'un `clamp`) | `var(--font-size-3xl)` | 32px |

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

> **Règle d'architecture (v11.0.0).** Aven est un **Poste de travail** : une seule
> fenêtre dont le cadre ne change jamais. Bandeau de télémétrie, rail d'instruments,
> barre d'onglets, scène et inspecteur restent visibles en permanence. Une section
> principale (Aujourd'hui, conversation, Notes, Fichiers, Terminal, Orchestration,
> Réglages) est un **instrument rendu dans la scène**, jamais une page plein écran ni
> un dialogue superposé. La navigation vit dans le modèle d'onglets pur
> (`web/src/workbench/tabs.ts`) : Aujourd'hui est le premier onglet et ne se ferme pas,
> un instrument n'a qu'un onglet, une conversation peut en avoir plusieurs. Le Poste ne
> défile pas globalement ; seul le conteneur concerné défile. Toute exception doit être
> explicitement justifiée par le besoin fonctionnel.

- **Un instrument = `InstrumentFrame`** (`web/src/InstrumentFrame.tsx`) : micro-libellé,
  titre de scène, description, et **actions déclarées par l'instrument** (`actions`),
  jamais une barre recopiée. Notes, Fichiers, Terminal, Orchestration et Réglages
  passent par lui ; une nouvelle section principale s'ajoute comme un instrument, pas
  comme un dialogue.
- **La coquille ne recopie aucune action** (`web/src/workbench/WorkbenchShell.tsx`) : le
  rail et les onglets naviguent, l'inspecteur porte le contexte de l'instrument actif
  (titre de session et renommage, modèle, mode de délégation, événements, sections de
  Réglages). Un bouton sans usage sur l'instrument où il figure est un bug.
- **Pas de défilement global** : `body` et `.wb-app` sont en `overflow: hidden`. Le
  scroll vit dans le conteneur qui en a besoin (`.wb-home-scroll`, `.wb-tile-body`,
  `.notes-preview`, `.files-list-panel`, `.unified-settings-scroll`, l'émulateur de
  terminal).
- **Un vrai dialogue ponctuel** = un composant-fichier (`FormDialog.tsx`, dialogue de
  permission, choix d'espace) ; une sur-structure d'interface partageant son état reste
  une fonction de rendu dans les instruments (`web/src/pages/`, `web/src/workbench/`).
  Tout texte déjà affiché passe par `Markdown`/`RichMarkdown`, jamais de HTML brut.
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
  TOUJOURS dans la chatbox ; seul le micro global du Poste (barre de commande, tuile
  Capturer) exécute les commandes d'application. La décision vit dans
  `web/src/dictation-routing.ts` (module pur testé).
- **L'agent vocal est une provenance distincte (v11.1.0)** : il n'exécute une
  commande que si le mot **« Aven »** a été prononcé (ou pendant la fenêtre de suivi
  de dix secondes après une réponse). Le micro se coupe depuis le bandeau, l'état
  est du texte (jamais la couleur seule), et l'audio n'est jamais écrit sur disque.
  Le routage vit dans `host/voice-agent-commands.ts` et l'état de session dans
  `web/src/voice-agent/session.ts` — deux modules purs testés.
- **Une note dictée se confirme (v11.4.0)** : « Aven, note que… » ne crée jamais
  la note dans la foulée. Le contenu est **relu**, puis attendu un « oui »
  explicite — la décision vit dans `web/src/voice-agent/note.ts` (module pur
  testé). Un refus, une parole incomprise, l'arrêt de la lecture, la coupure du
  micro ou 45 s de silence annulent la note. Une demande de note ne part jamais
  au LLM, qui répondrait « c'est noté » sans rien écrire ; une seule ligne écrit
  la note (`onCreateNote`, appelée dans la branche « confirm » uniquement), et
  `scripts/verify-v11.4.0.mjs` refuse tout autre chemin.
- **Le micro entend Aven (v11.4.1)** : la webview joue sa propre voix dans les
  haut-parleurs ; sa transcription revient par le STT. Aven reconnaît sa propre
  voix (`web/src/voice-agent/echo.ts`, module pur testé) : un fragment contigu
  de trois mots déjà prononcés, ou son écho moins de 2,5 s après la lecture,
  n'est jamais une réponse — un mot seul (« oui », « non », « stop ») le reste.
  Le garde s'exécute avant toute décision de note et ne peut rien écrire.
  `scripts/verify-v11.4.1.mjs` refuse un garde acoustique opaque ou un seuil à
  un mot. Pendant une question de note, la lecture n'est PAS coupée à la
  détection de parole (`web/src/voice-agent/barge-in.ts`, module pur testé) : la
  question va au bout, et s'arrête dès que le texte prouve une vraie reprise
  (v11.4.2).
- **Le repli parle avec Piper (v11.5.0)** : quand le service neuronal est
  injoignable (429, réseau), Aven bascule sur **Piper** (`host/piper-tts.ts`,
  binaire et modèle posés par `npm run fetch:piper` dans
  `src-tauri/resources/piper`, embarqués par l'installeur, dossier reçu par
  `AVEN_PIPER_DIR`). Pas de PyTorch, pas de Python, pas de réseau : le repli ne
  peut pas tomber en 429. La voix Windows (Hortense) ne sert plus que si Piper
  manque — et la bascule est toujours **dite** (`warning`). Une voix locale
  ajoutée se choisit par le préfixe `piper:` et passe par le dictionnaire de
  prononciation. Le débit vit dans `PIPER_LENGTH_SCALE` (1,10 en v11.5.1) : la
  parité avec Denise avait été mesurée à 1,44, mais **écoutée puis rejetée** —
  trop lente. Un réglage de prosodie se mesure sur une phrase de référence,
  puis s'écoute dans l'app : la mesure fixe l'ordre de grandeur, l'oreille
  tranche la valeur.
- **La voix neuronale est gratuite et sans compte (v11.3.0)** : les voix françaises
  passent par le service de lecture d'Edge, gratuit (aucune clé, aucune carte),
  jamais par un service facturé. Ce service n'est pas contractuel : un échec ou une
  limite (429) ne rend jamais l'agent muet — Aven repasse sur la voix locale Piper
  (v11.5.0, la voix Windows n'étant plus que le dernier recours)
  **et le dit** (`warning` rendu par l'IPC), sinon le changement de timbre serait
  inexplicable. La décision et le jeton vivent dans `host/voice-agent-edge.ts`
  (module pur testé), le transport WebSocket dans `host/voice-agent-tts.ts` — le
  protocole est à nous, la bibliothèque `msedge-tts` ne passait plus la poignée de
  main le 23/10/2026 (HTTP 200 au lieu de 101, 3 fois sur 3) — et la synthèse dans
  `host/voice-agent-speech.ts` ; l'audio arrive en base64 au renderer, qui le joue —
  aucun fichier audio n'est écrit sur disque. **Une réponse = une synthèse** :
  découper par phrase ajoutait ~1,5 s de silence à chaque frontière ; la lecture
  coupe le silence de tête et de queue (`web/src/voice-agent/trim.ts`) et ramène
  les pauses internes de plus de 650 ms à ~420 ms (`web/src/voice-agent/pause.ts`),
  deux modules purs testés. Le débit (`rate`) reste à 0 % : c'est la longueur des
  silences qui faisait paraître la voix lente, pas la vitesse des mots.
  **Une phrase déjà synthétisée n'est pas redemandée** (`host/voice-cache.ts`,
  cache borné en mémoire) et un 429 ouvre un blocage d'une minute respecté sans
  aucune requête (`EDGE_COOLDOWN_MS`) : insister entretient la limite du service
  et coûte 1,2 s par phrase (v11.4.3). Le repli reste toujours dit.
- **Un nom propre se prononce (v11.4.4)** : les moteurs de synthèse lisent les
  noms d'Aven avec leurs règles générales et les mangent (« Freebuff » sortait
  « frebff » sur la voix locale). La correction vit dans `host/pronunciation.ts`
  (module pur testé) : une table **par moteur**, appliquée au texte de synthèse
  seulement — jamais au texte affiché — et **vide pour la voix neuronale**, qui
  prononce juste. Une entrée nouvelle s'accompagne d'une écoute et d'un test.
- **Barre de commande et nouvelle conversation (v11.0.0)** : la barre permanente
  (Ctrl+K) sert à retrouver une conversation ou une note, à exécuter une commande
  (`>`), ou à cibler une portée (`/`). Une recherche vide n'exécute aucune action
  implicite. Créer et rédiger une conversation reste une action nommée distincte ;
  tout état vide est informatif, jamais un faux bouton.
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
