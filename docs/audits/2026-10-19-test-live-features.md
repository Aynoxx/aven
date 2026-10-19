# Test live des fonctionnalités — Aven v10.2.1

> **Date** : 19 octobre 2026
> **Binaire** : `src-tauri/target/debug/aven.exe` (10.2.1, `npm run tauri:check`), WebView2 réel
> **Méthode** : app lancée pour de vrai, pilotée par CDP (port 9555) — clics souris réels
> (`Input.dispatchMouseEvent` + hit-test), clavier réel (`Input.dispatchKeyEvent`), mesures
> dans le DOM (géométrie, styles calculés, fichiers sur disque, IPC `aven_call`).
> **Environnement** : espace de travail = le dépôt lui-même, aucune clé API configurée,
> CLI Freebuff absent. Captures dans `artifacts/live-audit/` (gitignoré, non versionné).

Ce document dit ce qui a été **mesuré**, ce qui n'a **pas pu** être exécuté, et cite ses
constats en `fichier:ligne`. Aucune appréciation visuelle subjective : les jugements
d'ergonomie s'appuient sur des cibles mesurées, des états ARIA lus et des comportements
observés. Les captures sont fournies pour l'œil humain, pas pour remplacer la mesure.

---

## 1. Verdict par écran

| Écran | État | Clarté | Ergonomie | Intégration |
|---|---|---|---|---|
| **Hub** | OK avec réserves | ⚠️ la barre promet « chercher », elle ne cherche pas | ✅ cartes 148×104, focus 2 px | ✅ 4 portes, cohérent |
| **Tâches** | OK | ⚠️ « Ouvrir une conversation » en crée une | ✅ modes 36 px, aria-pressed juste | ✅ persiste `.opencode-app/task-mode.json` |
| **Chat** | **2 défauts** | ✅ auto-titre, bandeau sans clé honnête | ⚠️ menu modèle hors écran | ✅ flux complet en 10 s |
| **Notes** | **1 défaut majeur** | ✅ arbre + aperçu clairs | ⚠️ titre affiché deux fois | ❌ **liens `[[note]]` cassés à la saisie** |
| **Fichiers** | OK | ✅ fil d'Ariane + une action | ✅ 27 entrées, cible unique | ✅ lecture seule |
| **Réglages** | OK avec réserves | ✅ 3 sections nommées | ⚠️ onglets sans état ARIA | ✅ Usage branché sur les vraies données |
| **Projet / Freebuff** | **1 défaut** | ⚠️ statut « démarre… » mensonger | ⚠️ boutons actifs sans session | ✅ page pleine, composer |

Démarrage mesuré à froid : **cible CDP 839 ms → hub monté 861 ms → `state.status = ready` 2 276 ms**.
Aucune exception console sur l'ensemble du parcours ; deux avertissements Chromium bénins
(`Password field is not contained in a form`, dû aux champs de clé hors `<form>`).

---

## 2. Ce qui n'a pas pu être testé

- **Dictée vocale** : aucune clé Groq. Le bouton est visiblement désactivé et son
  `aria-label` explique pourquoi (« Dictée indisponible : configure une clé Groq ») — bon
  comportement, mais aucun test audio réel.
- **Freebuff** : CLI non installé (`freebuffCliStatus → {"installed":false}`), donc pas de
  PTY, pas de transcript, pas de reprise de session.
- **Notifications de bureau**, **annonceur vocal**, **dialogues natifs** (Exporter .md,
  Ouvrir le dossier, choix d'espace) : non déclenchés (effets système, pas de sortie audio).
- **Thème sombre** : non re-mesuré ici ; les contrastes `--muted` des deux thèmes sont
  calculés par `scripts/verify-v10.2.0.mjs` (WCAG réel), et le thème n'a pas été modifié.
- **Réseau** : un seul aller-retour vers un modèle gratuit, réussi (10,2 s).

### Non exercé (par choix ou hors de portée du pilote CDP)

- **Raccourci global `Ctrl+Shift+N`** : enregistré au niveau OS par Rust ; une frappe
  synthétique CDP ne le déclenche pas. La *fonction* a été vérifiée par son API
  (`noteQuickCapture` → `Inbox/pense-bete-de-test.md` créé puis purgé).
- **Drag & drop** d'une note sur un dossier (souris CDP possible mais fragile) et
  **Alt+↑↓** de déplacement : non exercés.
- **« Faire analyser par un agent »** (Fichiers) : bouton cliqué, aucun composeur
  observé ensuite — non concluant, pas classé comme défaut.
- **« Citer dans le composeur »** : la barre `.selbar` a bien été mesurée avec ses six
  actions, mais le clic n'a pas été validé sur du texte (plus aucune conversation avec
  des messages au moment du contrôle).
- **Export `.md`**, « Ouvrir le dossier », choix d'espace : dialogues natifs Windows,
  non déclenchés pour ne pas bloquer la session.
- **Édition d'un message envoyé**, formulaires de permission, questions de l'agent :
  aucun outil n'a été déclenché (le seul tour exécuté était une réponse texte).

---

## 3. Constats par écran

### 3.1 Hub

- 4 cartes (`Projet`, `Tâches`, `Fichiers`, `Notes`) de **148×104**, un cœur vocal de
  **190×190** (désactivé, nommé), pastille Freebuff, récents, « Tout voir », Paramètres.
  Aucun débordement horizontal, aucune cible sous 24 px, focus clavier visible
  (`outline: solid 2px` accent) sur les cartes et les modes.
- **La barre de commande ne cherche pas.** Placeholder « Demander, chercher, créer… »,
  `aria-label="Rechercher ou commander"`, icône loupe — mais taper `zzz` laisse la liste
  des récents inchangée (mesuré : 1 avant, 1 après) et Entrée **crée une conversation**
  puis préremplit le composeur (`web/src/App.tsx:979-996`). « Chercher » est un faux
  contrat : la barre est un lanceur de demande, pas un filtre.
- Nom accessible des récents concaténé sans séparateur :
  « Nouvelle conversationcode · opencode/mimo-v2.6-flash » (nom lu d'un trait).
- Sous-titre de carte « Notes Markdown par agent » : `scrollWidth 133` pour
  `clientWidth 130` — 3 px de débordement (ellipse sur la dernière lettre).
- `Ctrl+K` place bien le focus dans la barre (`App.tsx:572-574`) ; `Ctrl+N` ouvre une
  nouvelle conversation (vérifié : 2 → 3 conversations).

### 3.2 Tâches

- Une seule carte d'orchestrateur, switch **Auto / Code / Analyse / Recherche**
  (`role="group" aria-label="Mode de l'orchestrateur"`), `aria-pressed` correct à chaque
  clic, persistance vérifiée côté disque : `.opencode-app/task-mode.json → {"mode":"auto"}`.
  C'était le contrat v10.1.0, il tient.
- **« Ouvrir une conversation » crée une conversation** au lieu d'en ouvrir une (mesuré :
  `chats` 1 → 2, vue chat ouverte sur une session neuve). Le libellé promet une
  ouverture, le comportement est une création.
- La page ne montre **aucune liste de conversations** : le composant existe
  (`App.tsx:1504-1526`) mais vit dans la barre latérale, masquée par défaut (voir 3.6).

### 3.3 Chat

- Envoi complet : message utilisateur, état « L'agent travaille… » avec bouton
  **Arrêter**, réponse **« test ok » en 10,2 s**, modèle `MiMo-V2.6-Flash Free`, bouton
  Envoyer réactivé, composeur vidé. Titre de conversation **auto-généré** depuis le
  premier message (« Réponds uniquement : test ok ») — très bon.
- Bandeau permanent « Aucun fournisseur avec clé API n'est configuré. Les modèles sans
  clé restent disponibles. » : honnête et utile, mais il occupe la ligne de statut en
  permanence, y compris hors conversation.
- **Menu « Choisir le modèle » hors écran.** Mesuré : boîte `[704, -66, 260, 300]` —
  **66 px coupés au-dessus de la fenêtre**, le premier choix (`Auto`) est inaccessible à
  la souris. Cause : `.model-select-menu { position: absolute; bottom: calc(100% + 6px) }`
  (`web/src/App.css:899`), ancré au-dessus d'un déclencheur situé en haut de la vue, sans
  garde-fou de viewport. Le menu lui-même est correctement nommé
  (`role="listbox" aria-label="Modèles gratuits disponibles"`, 11 modèles gratuits +
  Auto) ; l'option `Auto` est la seule à ne pas porter `aria-selected`
  (`App.tsx:1258`, les autres l'ont en `App.tsx:1262`).
- **Barre d'actions sur sélection** : présente et fonctionnelle (Copier, Corriger,
  Expliquer, Faire relire, Citer, Fermer — `App.tsx:1596-1603`), `role="toolbar"` nommé.
  Mesurée à `[911, 215, 198×38]`. Deux réserves : les boutons n'ont qu'un `title` (pas
  d'`aria-label`, contraire à §12.1), et **Échap ne la ferme pas** (mesuré : toujours
  présente après Échap). Pire, si l'agent travaille en même temps, Échap tombe dans la
  branche d'interruption (`App.tsx:592-594`) au lieu de fermer la barre.
- **Changement de modèle vérifié** : « Choisir le modèle » → *Nemotron 3 Ultra Free* →
  l'en-tête passe bien de `MiMo-V2.6-Flash Free` à `Nemotron 3 Ultra Free`.
- **Libellé `null/`** : sur une conversation sans modèle assigné (et après retour à
  `Auto`), la carte « MODÈLE ACTIF » affiche littéralement **`null/`** — mesuré deux
  fois (`bouton: "Choisir le modèle"`, `carte: "MODÈLE ACTIF\nnull/\n…"`). C'est un
  affichage de valeurs internes `null` non formatées, visible par l'utilisateur.
- **Composeur sans étiquette** : seul le `placeholder` porte le sens
  (`App.tsx:1278-1282`), contraire à AGENTS.md §12.1.6 (« jamais un placeholder seul
  comme seule étiquette »).

### 3.4 Notes

- Ouverture en dialogue plein cadre (1000×585), arbre + aperçu, état vide explicite.
- Création, édition et enregistrement réels : la note arrive sur disque
  (`.opencodeapp/notes/audit-live.md`), recherche globale avec extraits, tags d'agent,
  épinglage, poubelle, restauration et **purge en deux clics** (libellé qui change en
  « Confirmer : supprimer définitivement ») : tout fonctionne.
- **Les liens `[[note]]` sont cassés à la saisie (P0).** Taper `[[audit-live]]` dans
  l'éditeur riche écrit sur disque `\[\[audit-live\]\]` (vérifié dans le fichier `.md`).
  Conséquence : `.notes-links` (LIENS SORTANTS) reste vide, les backlinks n'apparaissent
  jamais, et le clic ne mène nulle part. Le bouton dédié de la barre d'outils insère
  pourtant `[[]]` (`web/src/NoteEditor.tsx:45-47`) : l'affordance officielle produit un
  lien mort. Cause racine : la sérialisation Markdown de TipTap (`tiptap-markdown`)
  échappe `[` et `]`; il faut un nœud/une règle wikilien dans le schéma.
- **Titre affiché deux fois** : `saveNote` préfixe le contenu avec `# <titre>`
  (`host/notes.ts:104`) alors que l'aperçu affiche déjà `<h4>{titre}</h4>` en
  `--font-size-xl`. Sur disque c'est cohérent (le `.md` est autonome), à l'écran c'est un
  doublon de hiérarchie.
- **📌 emoji** devant une note épinglée (`web/src/NotesView.tsx:203`) : viole AGENTS.md §5
  (aucun caractère Unicode décoratif ; les icônes passent par `<Icon name>`).
- Métadonnées orphelines : après purge des notes de test, `.opencode-app/notes-meta.json`
  conservait `pinned: ["audit-live-deux.md"]` et deux entrées `tags` pour des fichiers
  disparus. Nettoyé à la main ici ; `purgeNote` devrait purger pins/tags dans le même
  mouvement.
- **Deux dossiers de métadonnées** : `.opencode-app/` (task-mode, notes-meta, archived,
  baseline) et `.opencodeapp/notes` (contenu des notes). AGENTS.md §9 ne cite que
  `.opencode-app/`; cette double graphie est un piège d'exploitation et de sauvegarde.

### 3.5 Fichiers

- 27 entrées à la racine de l'espace, fil d'Ariane « Espace », ouverture de `AGENTS.md`
  (22 683 caractères rendus dans `<pre>`), une seule action contextuelle (« Faire analyser
  par un agent »). Lecture seule respectée, aucune troncature détectée.
- Les dossiers internes de build (`.agents`, `.freebuff`, `artifacts`, `build`,
  `dist-host`) sont listés au même niveau que les sources : c'est fidèle au disque, mais
  bruyant pour un « explorateur de l'espace ».

### 3.6 Réglages

- 3 sections nommées (`<nav aria-label="Sections des paramètres">`), Échap ferme le
  panneau, la section **Usage** affiche des chiffres réels (1 conversation active,
  0 archivée, 0 dictée, modèle `opencode/mimo-v2.6-flash-free`).
- **Onglets sans état ARIA** : `Configuration / Apparence / Usage` sont des `<button>`
  avec une classe `selected` et aucun `role="tab"` ni `aria-selected`
  (`web/src/SettingsDialog.tsx:300`). Idem pour les segments de thème et d'accent
  (`Clair / Système / Sombre`), qui n'exposent pas `aria-pressed`.
- **Champs de clé sans étiquette** : uniquement `placeholder="Coller la clé…"`
  (`SettingsDialog.tsx:249`) — violation directe de §12.1.6, et Chromium le signale
  (« Password field is not contained in a form »).
- L'apparence est très complète (thème, accent, densité, position/largeur de la barre
  latérale, largeur des messages, 6 bascules d'éléments, ordre des blocs au clavier et en
  glisser-déposer). C'est un des endroits les plus soignés de l'app.

### 3.7 Projet / Freebuff

- Page pleine (pas un dialogue), avec suggestions de départ et composeur.
- **Statut mensonger** : « **Freebuff démarre…** » alors que le CLI n'est pas installé et
  qu'aucune session ne peut démarrer (`freebuffCliStatus → installed:false`). Le libellé
  vient de l'état initial (`web/src/FreebuffAgentPage.tsx:45`) et de `state === "starting"`
  (`:33`) ; il ne se résout jamais dans ce cas. L'explication exacte (« Le CLI Freebuff
  n'est pas installé… Paramètres → Freebuff CLI gratuit ») existe, mais plus bas.
- Les boutons **Interrompre / Redémarrer la session / Vue terminal** restent actifs alors
  qu'il n'y a rien à interrompre ni à redémarrer.

### 3.8 Gestion des conversations (transverse)

- **La barre latérale est masquée par défaut** (`showSidebar: false`,
  `web/src/appearance.ts:41`) et c'est le seul endroit qui porte Renommer / Exporter /
  Archiver / Supprimer (`App.tsx:1513-1515`). Depuis le hub, la modale « Tout voir » ou
  une conversation, **aucune porte d'entrée** vers ces actions : il faut d'abord aller
  dans Réglages → Apparence → cocher « Conversations ».
- Une fois visible : groupes par agent (`PROJET 1`), actions 24×24, suppression en deux
  clics (le libellé devient « Confirmer la suppression définitive ») et **Échap désarme**
  — comportement exactement conforme.
- **`F2` (renommer) est inerte quand la barre est masquée** : le raccourci déclenche
  `startRenameChat` (`App.tsx:578`), mais le champ de renommage vit dans la liste non
  montée. Mesuré : aucun `.rename-input` après F2 sans barre latérale ; **avec** la
  barre visible, le champ apparaît, prérempli et focalisé (vérifié). Le raccourci ne
  ment donc qu'en configuration par défaut.
- **Archivage effectif côté host** : après les clics, `chats(null, true)` renvoyait bien
  des conversations archivées. En revanche la liste affichée n'a pas répercuté
  l'archivage pendant la mesure — constat **non concluant** (cache d'état de l'UI vs
  rafraîchissement), à revérifier captures en main.

---

## 4. Défauts classés

### P0 — fonctionnel cassé

| # | Constat | Preuve | Correctif attendu |
|---|---|---|---|
| 1 | Liens `[[note]]` écrits échappés, backlinks vides | fichier `.md` avec `\[\[…\]\]`, `.notes-links` vide | règle wikilien dans le schéma TipTap (ne pas échapper), test de non-régression |
| 2 | Menu modèle 66 px hors écran | boîte `[704, -66, 260, 300]`, `App.css:899` | clamper dans le viewport (ouvrir vers le bas si la place manque) |

### P1 — promesse non tenue ou fonction introuvable

| # | Constat | Preuve |
|---|---|---|
| 3 | Freebuff « démarre… » avec CLI absent | `FreebuffAgentPage.tsx:33,45` + `installed:false` |
| 4 | « Ouvrir une conversation » crée une conversation | `chats` 1 → 2 |
| 5 | La barre du hub ne cherche pas | liste inchangée après saisie, `App.tsx:979` |
| 6 | Gestion des conversations derrière un réglage | `appearance.ts:41`, `App.tsx:1513` |
| 7 | `F2` sans effet visible (barre latérale masquée) | aucun `.rename-input` après F2 |
| 7bis | `MODÈLE ACTIF` affiche `null/` | texte de la carte mesuré deux fois |

### P2 — accessibilité, cohérence, finition

| # | Constat | Preuve |
|---|---|---|
| 8 | Composeur étiqueté par son seul placeholder | `App.tsx:1278-1282` |
| 9 | Champs de clé idem | `SettingsDialog.tsx:249` |
| 10 | Onglets/segments sans `role`/état ARIA | `SettingsDialog.tsx:300` |
| 11 | `.selbar` : boutons `title` seulement, Échap inopérant | `App.tsx:582-594`, `1596-1603` |
| 12 | Option `Auto` sans `aria-selected` | `App.tsx:1258` |
| 13 | 📌 Unicode décoratif | `NotesView.tsx:203` |
| 14 | Titre de note rendu deux fois | `host/notes.ts:104` + `<h4>` |
| 15 | `notes-meta.json` conserve pins/tags de notes purgées | fichier mesuré après purge |
| 16 | Deux graphies `.opencode-app` / `.opencodeapp` | AGENTS.md §9 vs `notes.ts:9` |
| 17 | Nom accessible des récents concaténé | « Nouvelle conversationcode · … » |
| 18 | Sous-titre de carte sur 3 px | `scrollWidth 133 / clientWidth 130` |

---

## 5. Écarts documentation ↔ réalité

- **README v10.1.0 ②** : « liens `[[note]]` cliquables avec backlinks » — vrai au niveau
  du moteur (`noteLinks`/`backlinks` existent et sont testés), **faux au niveau de la
  saisie** : l'éditeur écrit des liens échappés. C'est l'écart le plus coûteux.
- **README v9.6.0 ③ / v10.0.0** : démarrage rapide et hub 4 cartes — conformes
  (2,3 s jusqu'à `ready`).
- **AGENTS.md §12.1.6** (champ étiqueté) : non respecté au composeur et aux clés.
- **AGENTS.md §5** (aucune icône Unicode) : non respecté par `📌`.
- **AGENTS.md §9** (métadonnées dans `.opencode-app/`) : le contenu des notes vit dans
  `.opencodeapp/notes`, ce que la règle ne mentionne pas.
- Le reste de la doc testée (Tâches à modes, notes disque, fichiers lecture seule,
  suppression en deux clics, focus visible, cibles ≥ 24 px) est **exact**.

---

## 6. Ce qui marche bien (à préserver)

1. **Démarrage** : 2,3 s jusqu'à l'état prêt, hub interactif en moins d'une seconde après
   la cible CDP.
2. **Cohérence visuelle mesurable** : focus `outline: solid 2px` accent partout, aucune
   cible sous 24 px, aucun débordement horizontal, aucune exception console.
3. **Tâches** : les 4 modes changent d'état, se persiste par espace et ne se perdent pas.
4. **Chat** : flux complet en 10 s, bouton Arrêter, auto-titre, message éditable, modèle
   gratuit affiché en clair, **changement de modèle opérationnel** (en-tête mis à jour).
5. **Gestes destructeurs** : armement + Échap désarme, libellés qui décrivent l'effet.
6. **Notes** : de vrais fichiers, recherche, tags, poubelle, restauration, purge sûre.
7. **Fichiers** : explorateur lisible, cloisonné, une seule action pertinente.

---

## 7. Ordre de correction proposé

1. **Wikilinks** (P0) — sans lui, la promesse centrale des Notes v10.1.0 est morte.
2. **Menu modèle** (P0) — deux lignes, un utilisateur sur deux n'a pas accès à `Auto`.
3. **Freebuff** (P1) — état « CLI absent », boutons désactivés : c'est un mensonge d'état.
4. **Découvrabilité des conversations** (P1) — entrée visible (hub ou conversation) et
   `F2` qui ne ment pas.
5. **Étiquettes et rôles ARIA** (P1/P2) — composeur, clés, onglets, segments, `Auto`.
6. **Notes finitions** (P2) — titre non dupliqué, 📌 → `<Icon>`, purge des métadonnées,
   graphie unique du dossier.
7. **Hub** : soit la barre cherche, soit elle s'appelle « Demander / créer ».

---

## Annexe — captures

`artifacts/live-audit/` (gitignoré) : `00-hub`, `11-taches`, `13-fichiers`,
`14-fichiers-preview`, `15-reglages-configuration`, `16-reglages-apparence`,
`17-reglages-usage`, `18-projet-freebuff`, `20-modale-conversations`, `21-notes-vide`,
`22-notes-edition`, `23-notes-recherche`, `24-notes-poubelle`, `25-notes-purge-arme`,
`26-conversation`, `28-conversation-reponse`, `29-modele`, `32-menu-modele`
(le hors-écran), `36-selbar`, `38-suppression-armee`, `41-sidebar-conversations`.

---

## 8. Corrections v10.2.2 — vérification après coup

Chaque défaut ci-dessous a été corrigé, puis **re-mesuré dans l'app reconstruite**
(`npm run tauri:check`, pilotage CDP, mêmes gestes que l'audit initial). Les
constats ci-dessous sont des sorties de mesure, pas des relectures de code.

| # | Défaut initial | Correctif | Preuve live |
|---|---|---|---|
| 1 | `[[note]]` écrit en `\[\[note\]\]` | `restoreWikilinks` côté host, appliqué dans `saveNote` avant écriture | note créée dans l'éditeur → disque : `Voir [[Cible test]] pour le détail.` ; `noteLinks` → `cible-test.md` ; backlinks → `source-test.md` |
| 2 | Menu modèle hors écran (66 px visibles) | mesure du bouton, ouverture vers le bas + `max-height` calculé | rect menu `top 275 → bottom 575` dans une fenêtre de 697 px, 11 options |
| 3 | `MODÈLE ACTIF` affichait `null/` | `usableModelRef` + libellé « Auto — le routeur choisit » | nouvelle conversation → `MiMo-V2.6-Flash Free` (modèle réel) ; tests unitaires couvrent `null`, `null/…`, `undefined` |
| 4 | Freebuff « démarre… » sans CLI | statut CLI vérifié avant montage, état nommé + bouton Installer | `freebuffCliStatus.installed=false` → présence « CLI Freebuff non installé », bannière, `Interrompre` désactivé |
| 5 | « Ouvrir une conversation » créait | libellé « Ouvrir la conversation » + infobulle : ouvre la plus récente, crée seulement s'il n'en existe aucune | page Tâches : bouton lu « Ouvrir la conversation » |
| 6 | Barre du hub sans recherche | filtrage des conversations par titre + libellé « Chercher… » | frappe → liste filtrée, eyebrow « RÉSULTATS » |
| 7 | Conversations introuvables / F2 inerte | onglet « Conversations » dans la barre de fenêtre + renommage dans l'en-tête | barre masquée : F2 ouvre `titlebar-rename` ; l'onglet affiche la barre |
| 8 | Composeur, clés, onglets, `Auto` sans nom accessible | `aria-label`, `role=tab`/`tablist`, `aria-selected`, `aria-pressed` | composeur « Message à l’agent » ; clés « Clé API OpenRouter Free », « Clé API Groq (chat + dictée) » ; onglets `tablist` |
| 9 | Barre de sélection : titres seuls, Échap inopérant | 6 `aria-label`, Échap ferme la barre avant l'interruption | 6 libellés mesurés ; Échap ferme sans quitter la conversation |
| 10 | Notes : 📌, titre dupliqué, dossiers vides, métadonnées fantômes | `<Icon name="pin">`, `stripLeadingTitle`, scan des dossiers, `forgetNote` | épingle `svg` sans emoji ; aperçu « Voir Cible test… » sans H1 ; purge → `notePins` vide et tags vides |

**Défaut découvert pendant la correction** (absent de l'audit initial) : l'arbre ne
listait que les dossiers **contenant des notes**. « Nouveau dossier » créait donc un
dossier invisible — impossible d'y glisser une note, et `Alt+↑` n'avait aucune cible.
`notesTree` scanne maintenant le disque (hors `.trash`/`.archive`) ; vérifié en live :
le dossier vide apparaît, puis `Alt+↑` et le glisser-déposer y déplacent la note.

**Gestes re-testés** : « Faire analyser par un agent » remplit le composeur
(`Analyse le fichier « .gitignore »…`) ; « Citer » produit `> OK` dans le composeur ;
le glisser-déposer HTML5 (mêmes handlers que la souris, événements `DragEvent`
synthétiques) déplace réellement le fichier ; thème sombre appliqué avec un contraste
texte secondaire/panneau mesuré à **6,4:1**.

**Toujours non exercé** : dialogue natif « Exporter .md », dictée (aucune clé Groq sur
le poste), notifications système, formulaires de permission, édition d'un message
utilisateur, session Freebuff réelle (CLI absent), glisser-déposer à la souris
physique (les handlers ont été exercés, pas le geste OS).
