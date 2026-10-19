# 2026-10-18 — Les règles à trier (avant fusion RULES.md → AGENTS.md)

> **Mode d'emploi.** Une case par règle. Coche ce que tu **gardes** dans le futur
> AGENTS.md fusionné (§0–§14 conservés), laisse décoché ce que tu retires. Tu peux
> aussi me renvoyer simplement les numéros (`R2.3`, `R12.2.1`…), ou dire « garde tout ».
> Une fois les coches faites, dis-moi « continue ».
>
> **Marqueurs.**
> - 〔sonde : …〕 = une assertion de `npm run verify` verrouille cette règle ;
>   la retirer implique de patcher l'assertion dans le même changement (règle du projet).
> - 〔code〕 = citée dans un commentaire de code (`RULES.md §n` → sera repointée
>   vers `AGENTS.md §n` quoi qu'il arrive).
> - 〔README〕 = citée dans `README.md`.
> - 〔dédoublonner〕 = recouvre un autre bloc ; la version fusionnée ne la dira qu'une fois.
>
> Toutes les cases sont **décochées** : c'est ton tri qui décide, pas mon défaut.

---

## Contrat d'exécution (blocs actuels d'AGENTS.md)

- [ ] **A1** — Résumé en dix secondes (5 points : imiter les voisins, français, tokens,
  modules purs, sondes). Recouvre §0–§8 ; à garder en tête de fichier ou à élaguer.
- [ ] **A2** — Bloc « Choisis ton parcours » (matrice tâche / lectures / commandes / preuve).
  〔sonde : verify-docs〕
- [ ] **A3** — Bloc « Définition de terminé » (interne / visible / rupture).
  〔sonde : verify-docs〕 〔dédoublonner avec §0, §11, §13〕
- [ ] **A4** — Bloc « Compte rendu obligatoire » (4 points obligatoires en fin de réponse).
  〔sonde : verify-docs〕 〔dédoublonner avec R0.8〕
- [ ] **A5** — Bloc « Périmètre et arrêts » (5 points : périmètre, jamais toucher aux
  tests/sondes/catch, demander si ambigu, amender règle + sonde ensemble, où écrire
  les audits). 〔sonde : verify-docs〕
- [ ] **A6** — Clause de conflit « en cas de conflit, RULES.md fait loi » → **à supprimer
>   de toute façon** : RULES.md disparaît, la phrase n'a plus de sens.
  〔sonde : verify-docs〕

---

## §0 — La boucle obligatoire

- [ ] **R0.1** — Situer : `git status` + branche courante avant tout ; ne jamais écraser,
  stager ni commiter le travail qui n'est pas le tien. 〔code〕
- [ ] **R0.2** — Lire les fichiers voisins avant d'écrire ; imiter style, commentaires
  versionnés (`// vX.Y.Z : raison`), langue.
- [ ] **R0.3** — Implémenter en respectant toutes les règles du fichier.
- [ ] **R0.4** — Vérifier selon la zone touchée (la matrice vit dans AGENTS.md A2).
- [ ] **R0.5** — Sonder : toute convention nouvelle et stable ajoute sa sonde dans le
  `verify-*` de la version courante ; un simple correctif n'en ajoute pas. 〔dédoublonner avec R13.2〕
- [ ] **R0.6** — Documenter : une ligne en tête de README si le changement est visible.
  〔dédoublonner avec A3〕
- [ ] **R0.7** — Prouver le comportement : lancer l'app ou le script qui exerce le
  changement, décrire l'action observée. Un build vert ne prouve rien.
- [ ] **R0.8** — Rendre compte : fichiers touchés, contrôles lancés, contrôles non
  lancés, risques restants. 〔dédoublonner avec A4〕

## §1 — Langue et commentaires

- [ ] **R1.1** — Tout texte visible et tout commentaire en **français** (UI, messages
  d'erreur, docstrings, commits) ; identifiants de code en anglais.
- [ ] **R1.2** — Chaque bloc modifié porte un commentaire daté `// vX.Y.Z : pourquoi`,
  le « pourquoi » prime sur le « quoi ».
- [ ] **R1.3** — Piège subtil corrigé (quoting Windows, CRLF, takeover…) = commentaire
  qui l'explique.

## §2 — Typographie

- [ ] **R2.1** — Interdiction absolue : aucune taille, graisse ou police en dur ;
  tout passe par les tokens `:root`. 〔sonde : verify-conventions〕
- [ ] **R2.2** — Table des tailles : `--font-ui` = pile système `system-ui, "Segoe UI",
  sans-serif` (jamais autre chose) ; xs 11px, sm 12, md 14, lg 16, xl 20, 2xl 28, 3xl 32.
  〔sonde : verify-conventions + verify-v10.2.0〕
- [ ] **R2.3** — Graisses : 400–500 courant, 600 titres de liste/badges/valeurs, 680
  boutons, 700–800 titres ; rien hors échelle sans raison forte. 〔sonde : verify-conventions〕
- [ ] **R2.4** — Italique réservé aux `<em>` sémantiques (les badges restent `font-style: normal`).
- [ ] **R2.5** — Libellés de section majuscules via la classe `.eyebrow` existante,
  jamais recréée.
- [ ] **R2.6** — Nouvelle fonctionnalité = nouvelle classe CSS dans `App.css`, près des
  voisins, avec commentaire `/* v10.x.x : … */` ; pas de style inline sauf valeur
  calculée dynamiquement.

## §3 — Couleurs et espacements

- [ ] **R3.1** — Couleurs uniquement via les tokens `--text`, `--muted`, `--border`,
  `--border-strong`, `--panel`, `--panel-solid`, `--panel-soft`, `--accent`,
  `--accent-soft`, `--accent-border`, `--danger`, `--success`, `--warning`, `--bg`,
  `--shadow`. 〔code〕
- [ ] **R3.2** — Couleur inconnue (API, marque tierce) = `color-mix(in srgb, …)`,
  jamais de hexadécimal brut.
- [ ] **R3.3** — Espacements : `--density-gap`/`--density-pad` dans les vues à densité,
  sinon multiples de 2/4px cohérents avec les voisins.
- [ ] **R3.4** — Rayons uniquement via `--radius-*` (xs 6, sm 10, md 12, lg 14, xl 20,
  pill 999) ; valeur hors échelle = régression. 〔sonde : verify-conventions〕〔code〕

## §4 — Boutons

- [ ] **R4.1** — Un bouton = une classe du système `.button.*` ; jamais recréer un
  style de bouton. 〔sonde : verify-conventions〕
- [ ] **R4.2** — Table des variantes : primary (une seule action principale par vue),
  secondary, ghost, danger, full, small, `.button-icon`.
- [ ] **R4.3** — Icône dans un bouton = `<Icon name size={14–16} />` + texte ; jamais
  d'emoji ni de caractère Unicode décoratif. 〔code〕
- [ ] **R4.4** — `type="button"` explicite sur tout `<button>` hors formulaire.
- [ ] **R4.5** — Boutons désactivables : `disabled={busy || !condition}`, opacité gérée
  par `.button:disabled`, pas d'opacité manuelle.
- [ ] **R4.6** — Confirmation destructrice : le libellé parle de l'effet (« Retirer de
  la liste »), pas de la mécanique interne.

## §5 — Icônes

- [ ] **R5.1** — Toute icône passe par `<Icon name />` ; jamais de `<svg>` local, de
  Unicode décoratif ni d'image externe. 〔sonde : verify-conventions〕
- [ ] **R5.2** — Nouvelle icône = entrée dans `IconName` + `case` dans `paths()`,
  tracé `currentColor`, viewBox 24×24, style Fluent. 〔sonde : verify-conventions〕
- [ ] **R5.3** — Tailles canoniques : 12, 14–16, 17, 24, 30 ; hors grille = à justifier.
- [ ] **R5.4** — Icône porteuse de sens seule → `aria-label` sur le bouton hôte ;
  icône décorative → `aria-hidden` par défaut.

## §6 — Composants React

- [ ] **R6.1** — Un dialogue = un composant-fichier ; une sur-structure partageant son
  état reste une fonction de rendu dans `App.tsx`.
- [ ] **R6.2** — Texte déjà affiché passe par `Markdown`/`RichMarkdown`, jamais de HTML brut.
- [ ] **R6.3** — État de panneau fermé dans TOUTES les navigations (`selectAgent`,
  `goHome`, `openAgentsPage`, `closeNotesToHome`, Échap, effet `needsWorkspace`) ;
  modal oublié ouvert = bug.
- [ ] **R6.4** — Après une action qui redémarre le moteur, relis `api.state()` ;
  `window.location.reload()` interdit (perd l'état visuel).
- [ ] **R6.5** — TypeScript strict : types du domaine dans `web/src/types.ts` (miroirs
  des contrats IPC), aucun `any` neuf.

## §7 — Architecture host/renderer

- [ ] **R7.1** — Le renderer ne voit **jamais** de secret : clés côté host (DPAPI
  Windows), seuls les booléens `keys[provider]` remontent. 〔sonde : verify-conventions〕
- [ ] **R7.2** — Nouvelle fonctionnalité = module autonome `host/*.ts` si testable sans
  Tauri, branché par un `case` de dispatch minimal dans `aven-app-host.ts`.
- [ ] **R7.3** — Un module cité dans la doc doit être vivant (au moins un importeur
  production) ; module mort = supprimé ou marqué legacy, jamais modèle à copier.
  〔sonde : verify-docs〕〔README〕
- [ ] **R7.4** — IPC : une seule commande `aven_call(method, args)` ; espaces de
  travail en Rust, le reste dispatché en camelCase ; jamais d'`invoke` direct dans
  un composant.
- [ ] **R7.5** — Fichiers écrits via `writeTextAtomic`/`writeJsonAtomic` ; jamais de
  `writeFileSync` direct dans `userData` ni l'espace de travail.
  〔sonde : verify-conventions〕
- [ ] **R7.6** — Process Windows : `execFile`/`spawn` à arguments séparés, jamais de
  chaîne concaténée ni `windowsVerbatimArguments` (bug v9.1.3) ; `shell: true`
  uniquement pour les shims `.cmd`. 〔code〕
- [ ] **R7.7** — CSP verrouillée (`default-src 'self'`, sans `unsafe-eval`), navigation
  externe via `openExternal` ; ne pas y toucher. 〔sonde : verify-conventions〕

## §8 — Pureté et testabilité

- [ ] **R8.1** — Module pur = norme pour toute logique décisionnelle, précédé du
  commentaire `// Pur : testable avec Node seul…`. 〔code〕
- [ ] **R8.2** — Tests des modules purs dans `tests/*.test.mjs` (runner `node --test`).
- [ ] **R8.3** — Un comportement à seuil (« notifie si > 8 s ») vit dans une fonction
  pure exportée, pas enfoui dans un handler IPC.

## §9 — Espaces de travail et données utilisateur

- [ ] **R9.1** — Aucun dossier imposé, aucun repli implicite : `activeWorkspace()` = `null`
  tant que l'utilisateur n'a pas choisi ; toute fonctionnalité échoue proprement sans
  espace actif.
- [ ] **R9.2** — Métadonnées par espace dans `<workspace>/.opencode-app/` (notes-meta,
  stats, archived, agent-names), écrites atomiquement ; `userData` réservé aux
  clés/préfs/apparence.
- [ ] **R9.3** — Fichiers de config livrés (`opencode.jsonc`, agents, model-priorities)
  synchronisés via `workspace-sync.ts` en baseline, jamais écrasés si personnalisés.

## §10 — Modèles et gratuité

- [ ] **R10.1** — Catalogue **strictement gratuit** : `isFreeModelRef` rejette tout
  modèle payant, y compris dans un fichier de priorités personnalisé ; aucun modèle
  payant ajouté, même en secours.
- [ ] **R10.2** — `mergeNewModels` fusionne en ajout seul ; les nouveaux modèles
  gratuits sont découverts dynamiquement à `model.list()`.

## §11 — Vérification et sondes

- [ ] **R11.1** — `npm test` = tests unitaires Node ; tout module pur nouveau a son
  `.test.mjs` ; un test flaky temporel se rejoue avant d'être « corrigé ». 〔code〕
- [ ] **R11.2** — `npm run verify` = chaîne de sondes ; **chaque version fige ses
  conventions dans une sonde** ; script courant reçoit les ajouts, anciens scripts
  intacts. 〔dédoublonner avec R0.5, R13.2〕
- [ ] **R11.3** — `verify-docs` vérifie la doc elle-même ; **aucun compteur recopié à
  la main** dans la prose (mesuré par une sonde ou absent). 〔sonde : verify-docs〕
- [ ] **R11.4** — `verify-build.mjs` passe APRÈS `npm run build` ; marqueur manquant =
  build périmé, pas sonde.

## §12 — Accessibilité

### §12.1 Noms accessibles

- [ ] **R12.1.1** — Bouton sans texte = `aria-label` français décrivant l'ACTION
  (« Retirer de la liste »), jamais l'icône (« corbeille ») ; `title` = même libellé.
  〔sonde : verify-conventions〕
- [ ] **R12.1.2** — Icône seule : `aria-label` sur le bouton hôte, pas sur le `<svg>` ;
  icône décorative : rien ajouter (`aria-hidden` par défaut).
- [ ] **R12.1.3** — États qui apparaissent sans interaction → `role="status"` ; erreur
  bloquante → `role="alert"` (modèle `ErrorBoundary`).
- [ ] **R12.1.4** — Dialogues : `role="dialog"` + `aria-modal="true"` + `aria-label`
  nommant le contenu + fermeture clic-fond et Échap dans l'ordre d'empilement.
  〔sonde : verify-conventions〕
- [ ] **R12.1.5** — Groupes de contrôles : un `role` et un `aria-label` nommant la zone.
- [ ] **R12.1.6** — Champs : label visible englobant ou `aria-label` ; jamais un
  `placeholder` comme seule étiquette.
- [ ] **R12.1.7** — Langue déclarée une fois (`<html lang="fr">` dans `index.html`),
  pas redéclarée par composant.

### §12.2 Focus visible

- [ ] **R12.2.1** — Socle `:focus-visible` global ; **jamais** d'`outline: none` sans
  remplacement équivalent (box-shadow accent, modèles `.button:focus-visible` et
  `.dialog input:focus`). 〔sonde : verify-conventions (9b durcie)〕〔code〕
- [ ] **R12.2.2** — Champs incrustés : signal de focus au conteneur (`:focus-within`
  sur `.search-wrap`, `.composer`, `.home-command`, `:has(.ProseMirror-focused)`) ;
  la sonde exige la **PAIRE** racine + règle compagne. 〔sonde : verify-conventions +
  verify-v10.2.0〕〔code〕
- [ ] **R12.2.3** — Ordre de tabulation = ordre du DOM ; aucun `tabIndex` positif ;
  renvois de focus via `requestAnimationFrame` (modèle composeur).
- [ ] **R12.2.4** — Listes navigables aux flèches (bouclage + Home/End) ; logique dans
  le module pur `web/src/arrow-navigation.ts`, DOM dans `App.tsx`.
  〔sonde : verify-conventions〕〔code〕
- [ ] **R12.2.5** — Raccourcis clavier (Ctrl+N, Ctrl+K, F2, Ctrl+Maj+V, Échap)
  documentés dans l'interface (`<kbd>`, `title`) ; tout nouveau suit ce double affichage.

### §12.3 Contrastes et couleurs

- [ ] **R12.3.1** — Jamais l'information par la couleur seule : état actif = fond
  accentué + bordure `--accent-border` + éventuel badge textuel.
- [ ] **R12.3.2** — `--muted` sur `--panel`/`--bg` verrouillé ≥ 4,5:1 dans les deux
  thèmes ; aucun gris intermédiaire plus clair. 〔sonde : verify-v10.2.0〕
- [ ] **R12.3.3** — Surfaces translucides : texte sur `--panel-solid` ou `color-mix`
  ≥ 90 % opaque, jamais sur du verre seul.
- [ ] **R12.3.4** — Accidents (`:hover`, `danger`) gardent un signal non-coloriel :
  libellé, bordure ou icône.

### §12.4 Mouvement et vivant

- [ ] **R12.4.1** — Bloc `prefers-reduced-motion: reduce` présent et actif ; ne pas le
  désactiver, pas d'animation JS hors de son périmètre. 〔sonde : verify-conventions〕
- [ ] **R12.4.2** — Animations discrètes (fade-up .16–.22s, translate 1–4px) ; pas de
  parallaxe, rien > 300 ms, pas de clignotant hors retour push-to-talk.
- [ ] **R12.4.3** — Une animation n'est jamais la seule porteuse d'information ;
  toujours accompagnée d'un texte.

### §12.5 Vérification avant de pousser

- [ ] **R12.5.1** — Parcours complet au clavier seul (Tab/Échap/Entrée) de la
  fonctionnalité ajoutée.
- [ ] **R12.5.2** — Chaque bouton icône nouveau a son `aria-label` français.
- [ ] **R12.5.3** — La fonctionnalité reste utilisable sans animation.
- [ ] **R12.5.4** — Toute couleur introduite est vérifiée sur texte dans les thèmes
  clair ET sombre.

## §13 — Journal de versions

- [ ] **R13.1** — Bump gradué : patch (correctif visible), mineur (fonctionnalité),
  **aucun** (interne) ; note README (①②③, ton « tu », bénéfice utilisateur) seulement
  si l'utilisateur voit la différence.
- [ ] **R13.2** — La sonde nouvelle accompagne une convention nouvelle et stable,
  jamais chaque correctif. 〔dédoublonner avec R0.5〕
- [ ] **R13.3** — Commit : titre `vX.Y.Z : résumé en français`, corps détaillé par
  chantier, footer `🤖 Generated with Codebuff`.

## §14 — Artefacts de travail

- [ ] **R14.1** — Audit/revue/plan vit dans `docs/audits/AAAA-MM-JJ-sujet.md` ;
  rien de jetable à la racine, qui ne contient que les documents de référence
  (README, AGENTS, TAURI-MIGRATION, NOTES-VERIFIEES — RULES.md disparaît de la liste).
  〔sonde : verify-docs〕
- [ ] **R14.2** — Un audit dit ce qu'il a mesuré, ce qu'il n'a pas pu exécuter, et
  cite ses constats en `fichier:ligne` ; un constat non vérifié est présenté comme tel.
- [ ] **R14.3** — Ces fichiers ne sont pas des sources : ni build, ni sondes de
  conventions.

---

## Hors tri (je m'en occupe quoi qu'il arrive)

- Sommaire des sections + check-list express de fin de RULES.md : régénérés dans le
  futur AGENTS.md, purgés de tes retraits.
- `README.md` L17 et les ~10 commentaires de code citant `RULES.md §n` : repointés
  vers `AGENTS.md §n`.
- `verify-docs.mjs`, `verify-conventions.mjs`, `verify-v10.2.0.mjs` : lisent RULES.md
  aujourd'hui → repointés vers AGENTS.md fusionné, assertions remplacées jamais
  supprimées à vide.

---

## Tri appliqué (2026-10-18, fusion effectuée)

Réponses recueillies section par section, puis appliquées dans AGENTS.md :

| Section | Verdict | Effet |
|---|---|---|
| Blocs AGENTS (A1–A5) | gardés tels quels | invariants inchangés |
| A6 clause de conflit | supprimée | remplacement : assertion « Amender une règle » dans verify-docs |
| §0 Boucle | **retiré** | assertion de section « 0 » retirée de la liste canonique de verify-docs |
| §1 Langue | gardé, raccourci | 2 puces |
| §2 Typographie | gardé tel quel | table intacte (sondes inchangées) |
| §3 Couleurs | gardé tel quel | — |
| §4 Boutons | gardé, table → liste | intitulé `## 4. Boutons` conservé (ancre) |
| §5 Icônes | gardé tel quel | — |
| §6 Composants React | gardé, raccourci | 4 puces |
| §7 Architecture | gardé tel quel | — |
| §8 Pureté | gardé tel quel | — |
| §9 Espaces de travail | gardé tel quel + **§10 fondue** | puce « Modèles et gratuité » ; §10 sort du sommaire |
| §11 Sondes | gardé, raccourci | 4 puces |
| §12 Accessibilité | gardé tel quel | 5 sous-sections |
| §13 Versions | gardé tel quel | — |
| §14 Artefacts | gardé tel quel | liste de référence sans RULES.md |

Repointages : `verify-conventions.mjs`, `verify-docs.mjs`, `verify-v10.2.0.mjs`
lisent AGENTS.md ; `RULES.md §n` → `AGENTS.md §n` dans README.md et les
commentaires de `App.css`, `App.tsx`, `arrow-navigation.ts`,
`workspace-files.ts`, `tests/arrow-navigation.test.mjs`. Les anciens
`verify-v*.mjs` restent intacts (règle §11).
