# AGENTS.md — Aven

**Lis ce fichier AVANT de modifier quoi que ce soit.** Il contient le contrat
d'exécution (parcours, définition de terminé, compte rendu, périmètre) puis les
règles universelles du projet : typographie (tokens CSS), format des boutons
(classes `.button.*`), icônes (`<Icon name />` uniquement), langue et commentaires
versionnés, architecture host/renderer (Tauri), IPC, sécurité, tests, sondes et
accessibilité. Ces règles décrivent ce que le code fait DÉJÀ : en cas de doute,
imite le fichier voisin le plus proche. Une contribution qui viole une règle se
fait refuser par `npm run verify` (sondes automatiques).

*(Fusion de l'ancien `RULES.md` du 2026-10-18 : §0 — la boucle obligatoire — a
été retiré, ses points vivant dans les blocs ci-dessous ; §10 — modèles et
gratuité — est fondue dans §9 ; la clause de conflit disparaît avec le second
fichier.)*

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

## 2. Typographie (renderer, `web/src/App.css`)

**Interdiction absolue : aucune taille, graisse ou police codée en dur.** Tout passe
par les variables `:root` existantes, sinon thèmes et densités cassent.

| Usage | Variable | Valeur |
|---|---|---|
| Police | `var(--font-ui)` | `system-ui, "Segoe UI", sans-serif` — pile système honnête, chargée au premier pixel (jamais autre chose, v10.2.0) |
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
- Une **nouvelle fonctionnalité = une nouvelle classe CSS** dans `App.css`, sectionnée
  par un commentaire `/* v9.1.x : … */` placé près des styles voisins. Pas de style
  inline sauf valeur calculée dynamiquement (position, largeur issue du state).

## 3. Couleurs et espacements

- Couleurs : uniquement les tokens `--text`, `--muted`, `--border`, `--border-strong`,
  `--panel`, `--panel-solid`, `--panel-soft`, `--accent`, `--accent-soft`,
  `--accent-border`, `--danger`, `--success`, `--warning`, `--bg`, `--shadow`.
- Une couleur inconnue (API, marque tierce) se mélange avec `color-mix(in srgb, …)`,
  jamais avec une valeur hexadécimale brute.
- Espacements : réutilise `--density-gap` / `--density-pad` quand l'élément vit dans
  une vue à densité réglable ; sinon multiples de 2/4px cohérents avec les voisins.
- Rayons : uniquement les tokens `--radius-*` de `:root` (App.css) — `xs` 6px (queues
  de bulles, micro-contrôles), `sm` 10px (champs/boutons), `md` 12px (items de liste),
  `lg` 14px (tuiles/cartes), `xl` 20px (panneaux/dialogues), `pill` 999px (pilules et
  badges). Toute valeur hors échelle = une régression de cohérence.

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

## 6. Composants React et pages (renderer)

> **Règle d'architecture (v10.3.0).** Toutes les sections principales d'Aven doivent
> être implémentées comme des **pages** occupant l'intégralité de la surface de contenu
> de la fenêtre principale, et utiliser le système commun de navigation supérieure avec
> des **actions contextuelles**. Les fenêtres modales et les panneaux superposés sont
> réservés aux véritables interactions ponctuelles et ne doivent pas servir de
> structure principale aux pages. Les pages d'accueil et centrales ne doivent pas
> défiler globalement ; tout défilement nécessaire doit être limité au conteneur
> concerné. Toute exception doit être explicitement justifiée par le besoin fonctionnel.

- **Une page = `PageShell`** (`web/src/PageShell.tsx`) : `eyebrow`, titre, description,
  et **actions déclarées par la page** (`actions`), jamais une barre recopiée. Tâches,
  Projet/Freebuff, Notes, Fichiers et Réglages passent tous par lui ; une nouvelle
  section principale s'ajoute comme une page, pas comme un dialogue.
- **La barre de fenêtre est contextuelle** : « Conversations » n'apparaît que devant
  une conversation ; une page n'affiche que ses propres actions. Un bouton sans usage
  sur la page où il figure est un bug.
- **Pas de défilement global** : `body` et `.page-main` sont en `overflow: hidden`.
  Le scroll vit dans le conteneur qui en a besoin (`.notes-preview`, `.files-list-panel`,
  `.unified-settings-scroll`, l'émulateur de terminal).
- **Un vrai dialogue ponctuel** = un composant-fichier (`FormDialog.tsx`, dialogue de
  permission) ; une sur-structure d'interface partageant son état reste une fonction de
  rendu dans `App.tsx`. Tout texte déjà affiché passe par `Markdown`/`RichMarkdown`,
  jamais de HTML brut.
- Les états de panneau sont fermés dans TOUTES les navigations (`selectAgent`,
  `goHome`, `openAgentsPage`, `closeNotesToHome`, Échap, effet `needsWorkspace`) —
  un modal oublié ouvert est un bug.
- Après une action qui redémarre le moteur, relis l'état (`api.state()`) au lieu de
  recharger la page (`window.location.reload()` interdit : perd l'état visuel).
- TypeScript strict : types du domaine dans `web/src/types.ts` (miroirs des contrats
  IPC ; duplication volontaire et commentée). Pas de `any` neuf.

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
  ajouts, les anciens scripts restent intacts.
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
  global de `App.tsx`, dans l'ordre d'empilement des panneaux).
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
  dans App.tsx — toute nouvelle liste suit ce modèle.
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

- Le socle existe : `@media (prefers-reduced-motion: reduce)` neutralise durées et
  répétitions. **Toute nouvelle animation CSS est couverte automatiquement** — ne
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
