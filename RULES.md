# Règles universelles du projet Aven

> **À lire AVANT toute modification.** Ces règles existent pour que chaque ajout reste
> cohérent avec l'existant. Elles décrivent ce que le code fait DÉJÀ : en cas de doute,
> imite le fichier voisin le plus proche. Une IA (ou une personne) qui saute une règle
> verra sa contribution refusée par `npm run verify` (sondes automatiques).

---

## 0. La boucle obligatoire (tout ajout, quelle que taille)

1. **Lire** les fichiers voisins de ce que tu veux modifier — imite leur style, leurs
   préfixes de commentaire versionnés (`// v9.1.6 : raison du changement`), leur langue.
2. **Implémenter** en respectant les règles ci-dessous.
3. **Vérifier** : `npm run typecheck:host`, `npm test`, `npm run verify`
   (et `cd web && npx tsc -b` si tu as touché au renderer).
4. **Sonder** : si ton ajout introduit une convention nouvelle et stable (composant,
   IPC, module), ajoute une sonde dans le `verify-*` de la version courante — comme
   chaque version précédente l'a fait.
5. **Documenter** : une ligne dans la note de version du README si le changement est
   visible par l'utilisateur.

## 1. Langue et commentaires

- **Tout le texte visible et les commentaires sont en FRANÇAIS** (libellés UI, messages
  d'erreur, docstrings, commits). Le code (identifiants) reste en anglais.
- Chaque bloc modifié porte un commentaire daté de version : `// v9.1.6 : pourquoi ce
  code existe`. Le « pourquoi » prime toujours sur le « quoi ».
- Les pièges documentés valent de l'or : si tu viens de corriger un bug subtil (quoting
  Windows, CRLF, takeover Freebuff…), laisse un commentaire qui l'explique.

## 2. Typographie (renderer, `web/src/App.css`)

**Interdiction absolue : aucune taille, graisse ou police codée en dur.** Tout passe
par les variables `:root` existantes, sinon thèmes et densités cassent.

| Usage | Variable | Valeur |
|---|---|---|
| Police | `var(--font-ui)` | Inter, sans-serif (jamais autre chose) |
| Micro-labels, métadonnées | `var(--font-size-xs)` | 10px |
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

| Classe | Usage |
|---|---|
| `.button.primary` | L'action principale d'un panneau/dialogue (une seule par vue) |
| `.button.secondary` | Actions secondaires (ouvrir un dossier, tester…) |
| `.button.ghost` | Actions tertiaires, retour, liens d'annulation |
| `.button.danger` | Destruction (supprimer conversation, effacer une clé) |
| `.button.full` | Bouton pleine largeur (footer de sidebar) |
| `.button.small` | Bouton carré icône de la sidebar |
| `.button-icon` | Bouton 36px icône seule (fermer, paramètres) |

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

## 6. Composants React (renderer)

- **Fichiers** : un dialogue = un composant-fichier (`SettingsDialog.tsx`,
  `NotesDialog.tsx`, `FormDialog.tsx`). Une sur-structure d'interface (hub, page
  agents) reste une fonction de rendu dans `App.tsx` tant qu'elle partage son état.
- **Texte déjà affiché** : passe par `Markdown`/`RichMarkdown`, jamais de HTML brut.
- **États de panneau** : suivent le modèle existant — `useState` + fermeture dans
  TOUTES les navigations (`selectAgent`, `goHome`, `openAgentsPage`, `closeNotesToHome`,
  Échap, effet `needsWorkspace`). Un modal oublié ouvert = bug, la sonde vérifie.
- **Poll d'état** : l'app relit `api.state()` toutes les 500 ms au démarrage ; après
  une action qui redémarre le moteur, relis l'état (`api.state()`) au lieu de
  recharger la page (`window.location.reload()` interdit : perd l'état visuel).
- **TypeScript strict** : types du domaine dans `web/src/types.ts` (miroirs des
  contrats IPC ; duplication volontaire et commentée). Pas de `any` neuf.

## 7. Architecture host/renderer (Tauri)

- **Le renderer ne voit JAMAIS de secret** : clés stockées côté host
  (`settings.ts`), seuls les booléens `keys[provider]` remontent. Toute nouvelle
  donnée sensible suit ce schéma.
- **Nouvelle fonctionnalité** = module autonome `host/*.ts` si elle est
  testable sans Tauri (comme `workspaces.ts`, `notify-policy.ts`, `freebuff-cli.ts`),
  branchée dans `host/aven-app-host.ts` via un `case` de dispatch minimal.
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
  `src-tauri/tauri.conf.json` (`default-src 'self'`, sans `unsafe-eval`),
  navigation externe via la commande `openExternal` — ne touche pas à ces réglages.

## 8. Pureté et testabilité

- Un module « pur » (aucune dépendance Electron, aucun I/O réseau) est la norme pour
  toute logique décisionnelle : politiques, parsing, routage, calculs.
  Précède-le du commentaire `// Pur : testable avec Node seul, sans Electron.`
- Les modules purs ont leurs tests dans `tests/*.test.mjs` (runner `node --test`,
  strip-types, résolveur TypeScript via `tests/hooks.mjs` + `tests/register.mjs`).
- Un comportement à seuil (ex. « notifie si > 8 s ») vit dans une fonction pure
  exportée, pas enfoui dans un handler IPC.

## 9. Espaces de travail et données utilisateur

- **Aucun dossier imposé, aucun repli implicite** : `activeWorkspace()` renvoie
  `null` tant que l'utilisateur n'a pas choisi ; l'écran de choix est la seule porte
  d'entrée. Toute nouvelle fonctionnalité doit échouer proprement si aucun espace
  n'est actif (`requireWorkspace()` côté main, écran de choix côté renderer).
- Métadonnées par espace : sous `<workspace>/.opencode-app/` (notes-meta, stats,
  archived, agent-names), écrites atomiquement, jamais dans `userData` global sauf
  clés/préfs/apparence.
- Fichiers de config livrés (`opencode.jsonc`, agents, model-priorities.json) :
  synchronisés via `workspace-sync.ts` (baseline), jamais écrasés si personnalisés.

## 10. Modèles et gratuité

- Catalogue **strictement gratuit** : `priorities.ts` rejette tout modèle payant
  (`isFreeModelRef`), y compris dans un fichier de priorités personnalisé. N'ajoute
  jamais un modèle payant, même en secours.
- La table `model-priorities.json` est fusionnée (ajout seul) par `mergeNewModels` ;
  les nouveaux modèles gratuits sont découverts dynamiquement à `model.list()`.

## 11. Vérification et sondes (la « mémoire » du projet)

- `npm test` : 105+ tests unitaires Node. Tout module pur nouveau s'accompagne de
  son `.test.mjs`. Un test flaky temporel se rejoue avant d'être « corrigé ».
- `npm run verify` : chaîne de sondes `scripts/verify-v*.mjs` + `verify-build.mjs`
  (build périmé détecté par mtime + marqueurs de contenu). **Chaque version fige ses
  conventions dans une sonde** — c'est ainsi que le projet se souvient de ses règles
  sans confiance aveugle. Le script de la version courante reçoit les sondes des
  ajouts, les anciens scripts restent intacts.
- `verify-build.mjs` doit toujours passer APRÈS `npm run build` — si un marqueur
  manque, c'est le build qui est périmé, pas la sonde.

## 12. Accessibilité (aria, focus, contrastes, mouvement)

L'accessibilité d'Aven repose sur des pratiques déjà répandues dans le code (38
`aria-label`, `role="dialog"/"status"/"toolbar"/"alert"`, `:focus-visible` global,
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
- Un champ « incrusté » sans bordure (recherche, composeur) reste focusable et son
  conteneur signale le focus (`:focus-within` sur `.home-command`).
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
- Texte secondaire : `var(--muted)` sur `--panel`/`--bg` (paires déjà conformes
  dans les deux thèmes). Ne crée pas de gris intermédiaire plus clair.
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

## 13. Journal de versions (habituel, pas une règle nouvelle)

- Bump de version `package.json` + note en tête de README (①②③…, ton « tu »,
  orienté bénéfice utilisateur).
- Commit : une ligne de titre `vX.Y.Z : résumé en français`, corps détaillé par
  chantier, footer `🤖 Generated with Codebuff`.

---

> **Sommaire des sections** : 0. Boucle obligatoire · 1. Langue et commentaires ·
> 2. Typographie · 3. Couleurs et espacements · 4. Boutons · 5. Icônes ·
> 6. Composants React · 7. Architecture main/renderer · 8. Pureté et testabilité ·
> 9. Espaces de travail · 10. Modèles et gratuité · 11. Vérification et sondes ·
> **12. Accessibilité** · 13. Journal de versions.

---

### Check-list express avant de pousser

- [ ] Textes et commentaires en français, préfixés `// vX.Y.Z : raison`
- [ ] Aucune taille/couleur/poids en dur — tokens uniquement
- [ ] Bouton = classe `.button.*` existante ; icône = `<Icon name />`
- [ ] Modal fermé dans toutes les navigations + Échap
- [ ] Secrets restent côté main ; IPC typé des deux côtés
- [ ] Module pur pour la logique ; tests `.test.mjs` ajoutés
- [ ] Échec propre sans espace de travail actif
- [ ] Bouton icône nouveau → `aria-label` français ; `role`/`aria-modal` si dialogue
- [ ] Aucun `outline: none` sans remplacement ; `prefers-reduced-motion` couvert
- [ ] `npm run typecheck:host` + `npm test` + `npm run verify` verts
- [ ] Build régénéré (`npm run build:host`, build web) si code compilé touché
