# Revue de design — grille `apple-design`

- **Date** : 2026-10-20
- **Version examinée** : 10.3.0 (`61a9357`), renderer Vite `http://127.0.0.1:5173`
- **Grille** : skill `apple-design` (WWDC *Designing Fluid Interfaces* 2018, *Details of UI Typography* 2020, *Principles of Great Design* 2026), traduit pour le web.
- **Portée** : tout le design visible — hub, charpente `PageShell`, Tâches, Réglages, panneaux/dialogues, typographie, mouvement, matériaux, accessibilité.
- **Auteur** : revue assistée, aucun fichier de production modifié par ce document.

---

## 1. Méthode et périmètre

**Lu** : `web/src/App.css` (1 160 lignes, source unique des styles), `PageShell.tsx`, `App.tsx` (hub, ouverture/fermeture des pages, `closePage`), `appearance.ts` (thèmes, accents, densité), `SettingsDialog.tsx`, `view-transitions.ts`, `icons/`.

**Mesuré** dans le renderer (1280×840, thème clair puis sombre, accent **Émeraude** — l'accent par défaut de l'app) :

- contrastes calculés (compositing des fonds alpha le long de l'arbre, `prefers-contrast` ignoré) ;
- tailles de cibles réelles (`getBoundingClientRect` sur `button/input/select/[role]`) ;
- styles calculés (taille, graisse, `letter-spacing`, `line-height`) sur 25 sélecteurs ;
- inventaire des `transition`/`animation` du fichier (22 et 17 déclarations) ;
- dépassement du ressort `--ease-spring` calculé sur la courbe (échantillonnage 1 000 points).

**Non mesuré** (voir §6) : les états qui exigent le host Tauri (conversation, sidebar de conversations, liste d'agents, terminal), les captures sombres, les parcours clavier/lecteur d'écran complets.

---

## 2. Verdict

La charpente est de bon niveau pour la grille : une seule échelle typographique réellement utilisée, des surfaces de texte opaques, des transitions de vue qui savent *d'où* elles partent (morph carte → page), et les trois signaux d'accessibilité du skill (reduced-motion, reduced-transparency, prefers-contrast) déjà câblés.

Trois familles d'écarts restent, par ordre d'impact : **l'encre d'accent est illisible en thème clair** (2,3–2,5:1 sur 27 déclarations), **la chorégraphie des panneaux n'est ni symétrique ni uniforme** (ressort de momentum sur des apparitions sans geste, sortie plus courte que l'entrée, deux destinations sur quatre sans transition), et **quelques affordances sont muettes** (micro actif alors que la dictée est indisponible, « Fermer » haut de 21 px, actions de conversation invisibles hors survol).

---

## 3. Ce qui est déjà juste

| Point | Preuve |
|---|---|
| **Échelle typographique unique** | 7 tailles en tokens `--font-size-xs…3xl` (`App.css:13-18`) ; **une seule** taille littérale dans 1 160 lignes (`font-size:1.45em`, `App.css:660`, dérivée du parent). |
| **Tracking par taille, pas global** | Titre de page `-0.03em` (`App.css:707`), gros titre Agents `-0.035em` (`738`), marque `-0.01em` (`118`), eyebrow `+0.12em` (`143`), id d'agent `+0.1em` (`746`). C'est exactement la règle §15 du skill. |
| **Leading adapté au corps** | h1 `1.1` (`707`), descriptions `1.55` (`708`), messages `1.58` (`194`), notes `1.6` (`870`). |
| **Matériaux : texte sur surface opaque** | `.dialog` 97 % (`App.css:366`), `.hub-picker`/`.home-modal` `--panel-solid` (`App.css:666`), scrim `--bg` 76 % + `blur(14px)` (`App.css:337-338`). |
| **Un seul flou à la fois** | `body:has(.overlay) .home-toolbar, … { backdrop-filter: none }` (`App.css:494-495`) : quand un dialogue s'ouvre, le blur du hub s'éteint. Détail de craft qu'on voit rarement. |
| **Les trois signaux d'accessibilité du skill** | `prefers-reduced-motion` global `.01ms` + `scroll-behavior:auto` (`App.css:827-834`), `prefers-reduced-transparency` (`1131-1134`), `prefers-contrast: more` (`1135-1137`). |
| **Retour au pointer-down** | une douzaine de classes ont un `:active` (dont `.button:active`, `App.css:1114`, `.hub-card:active`, `640`), l'élévation au survol ne touche plus au `transform` de la carte (`App.css:631-639`, correctif v10.3.0 contre le texte flou). |
| **Ancrage spatial des popovers** | `.dictation-popover` `transform-origin: bottom center` (`App.css:257`), `.model-select-menu` `bottom right` (`965`) : le contenu sort de son déclencheur. |
| **Focus jamais supprimé sans remplaçant** | 4 `outline:none` : champ (halo, `376`), item récent (bordure + fond, `588-592`), item de modale (idem, `675-676`), ProseMirror (`:has`, `873`). |
| **Contraste du texte secondaire** | `--muted` : **5,79:1** sur panneau clair, **6,25–6,40:1** en sombre (mesuré). Aucun gris plus clair introduit. |
| **Navigation clavier des listes** | `role="tablist"`, `aria-label` sur les groupes, listes triables `focus-visible` + flèches (`App.css:429`, `460`). |

---

## 4. Écarts

### P1 — L'encre d'accent échoue au contraste en thème clair (mesuré)

L'accent sert à la fois de **remplissage** et d'**encre**. Tant que l'accent était violet (`#8b5cf6` par défaut du `:root`), le blanc sur accent passait à 4,3:1 — à peine. Dès que l'utilisateur garde l'accent par défaut de l'app (**Émeraude `#10b981`**, `appearance.ts:45`), les deux usages tombent sous le seuil :

| Paire (thème clair, accent Émeraude) | Mesure | Seuil |
|---|---|---|
| Blanc sur `--accent` (bouton primaire, bulle utilisateur, micro) | **2,54:1** | 4,5:1 (texte) / 3:1 (graphique) |
| Blanc sur accent survolé (`color-mix(accent 88%, white)`, `App.css:176`) | **2,29:1** | 4,5:1 |
| `--accent` en texte sur `--panel-solid` | **2,54:1** | 4,5:1 |
| `--accent` en texte sur `--bg` | **2,32:1** | 4,5:1 |
| `--text` sur `--accent` (l'encre alternative disponible) | **6,90:1** | — |

Portée : **27 déclarations `color: var(--accent)`** (`App.css`) — badges (`656`, `689`), valeurs de réglage (`402`), liens wiki (`875`), items sélectionnés (`974`), icônes de carte (`641`, `744`) — plus les quatre remplissages à texte blanc (`114`, `175`, `195`, `290`). L'état d'enregistrement de la dictée, blanc sur `--rose`, mesure 3,65:1 (`277`). La palette contient déjà la solution (6,90:1), elle n'est simplement pas utilisée.

**Correctif proposé** (skill §12 « vibrancy », §16.7 « colors that adapt ») :

1. `--accent-ink: color-mix(in srgb, var(--accent) 55%, #0b0d12)` en clair (Émeraude → ≈ 6,5:1 sur blanc), `var(--accent)` inchangé en sombre (6,7:1 mesuré sur `--bg` sombre).
2. `--on-accent` calculé dans `appearance.ts` à partir de la luminance de l'accent. Mesuré sur les 5 presets (blanc / encre `--text`) :

   | Preset | Blanc | Encre sombre | Encre retenue |
   |---|---|---|---|
   | Émeraude `#10b981` | 2,54 | **6,90** | sombre |
   | Ambre `#f59e0b` | 2,15 | **8,15** | sombre |
   | Bleu `#3b82f6` | 3,68 | **4,76** | sombre |
   | Rose `#f43f5e` | 3,67 | **4,77** | sombre |
   | Violet `#8b5cf6` | 4,23 | 4,13 | aucun → assombrir le remplissage de 5 % (`#8558eb`) : blanc à **4,57** |

   Règle : encre sombre dès que l'accent est clair ; Violet reste le seul preset à retoucher (5 % de noir suffit).
3. Une sonde (`scripts/verify-v10.4.0.mjs`) qui recalcule ces deux paires pour les **5 presets × 2 thèmes** : c'est un seuil, donc il vit dans une sonde (§11), pas dans un commentaire.

Coût : ~1 session (tokens + remplacement des 30 usages + sonde), aucun risque de mise en page.

### P1 — Le bouton « Fermer » d'une page mesure 21 px de haut (régression v10.3.0)

`App.css:717` : `.page-actions .dialog-close { width:auto; height:auto; min-height:0; … }` — écrit pour rendre au bouton son libellé (le `36×36` de `.dialog-close` coupait le texte). Effet de bord mesuré : le bouton fait **99 × 21 px**, sous le `min-height: 34px` de `.page-action` (`718`) et sous le plancher de 24 px du projet. C'est la sortie principale des cinq pages.

**Correctif** : retirer `min-height:0` (garder `height:auto`) → 34 px, sans réintroduire la coupure. Vérifier `.page-actions` à 800 px de large.

### P2 — Chorégraphie des panneaux : sortie non symétrique et ressort de momentum

`App.css:343-357` annonce « la SORTIE rejoue le chemin inversé ». Le code dit autre chose :

| | Entrée (`dialog-in`, `347`) | Sortie (`dialog-out`, `348`) |
|---|---|---|
| Translation | `translateY(10px)` | `translateY(6px)` |
| Échelle | `scale(.97)` | `scale(.985)` |
| Courbe | `--ease-spring` (`350`) | `--ease-out` (`355-357`) |

Le skill (§7) demande des chemins symétriques, avec courbes miroir ; ici la sortie est 40 % plus courte et change de courbe. Par ailleurs `--ease-spring` = `cubic-bezier(.34,1.56,.64,1)` dépasse de **9,8 %** à **57 %** de la durée (calculé) : c'est une courbe de *momentum* (`damping ≈ 0.8`) appliquée à des apparitions sans geste — dialogues, popovers, menu de modèle (`350`, `257`, `965`). Le skill (§4) réserve le rebond aux gestes qui portaient de l'élan : « overshoot on a menu that just faded in feels wrong ».

**Correctif** : `dialog-out` = `translateY(10px) scale(.97)` + courbe inverse de `--ease-out` ; `--ease-spring` réservé au push-to-talk et au dépôt d'un drag. Deux valeurs à changer, une animation à regarder en slow motion.

### P2 — Deux destinations sur quatre ne se transforment pas, et aucun retour ne revient à sa carte

La vue partagée est le meilleur atout du produit (morph carte du hub → page) mais elle n'est branchée que sur la moitié des cartes :

- **Projet** et **Tâches** : `withViewTransition(..., "project" | "tasks")` (`App.tsx:976`, `989`) + noms CSS `[data-vt-source=…]` (`App.css:1087-1090`) → morph carte → page.
- **Notes** et **Fichiers** : `openNotesView` / `openFilesView` (`App.tsx:412`, `424`) changent l'état **sans** `withViewTransition` → changement d'écran sec (aucune animation d'entrée : ni `.notes-page` ni `.files-page` n'existe dans `App.css`).
- **Tous les retours** : `closePage` (`App.tsx:395`) appelle `withViewTransition(fn)` **sans source** → fondu du root, jamais le morph inverse. `goHome` est commenté « sans source = fondu root » (`1001`).

Conséquence : quatre cartes visuellement identiques se comportent de deux façons différentes, et une page ne « rentre » jamais dans sa carte — exactement ce que §7 interdit (« If something disappears one way, we expect it to emerge from where it came »).

**Correctif** : `source` sur les quatre ouvertures + CSS `hub-target` pour Notes/Fichiers ; `closePage(source)` avec `data-vt-source` posé avant capture. ~40 lignes, testable au clavier (Échap) et à la souris.

### P2 — La dictée indisponible ne se voit pas

`App.tsx:1186-1216` : le bouton central du hub (le plus gros élément de l'écran, 184–236 px) reste **pleinement saturé, `opacity: 1`, sans `disabled` ni `aria-disabled`** quand aucune clé Groq n'est configurée ; seule l'`aria-label` change (« Dictée indisponible… »). Mesuré dans la preview : `disabled: false`, `opacity: 1`, libellé « Dictée indisponible : configure une clé Groq dans Paramètres ». `.voice-core` n'a aucune règle `:disabled` (`App.css:284`), alors que `.dictation-button:disabled` existe (`278`).

Skill §16.2 (agency) et §16.5 (feedback) : l'affordance dominante d'un écran ne peut pas promettre une action qu'elle refuse. **Correctif** : réutiliser `.dictation-button:disabled` (opacité, curseur) + un libellé sous le micro (« Clé Groq requise ») ; ou masquer le micro au profit de la recherche quand la dictée est absente.

### P3 — Les tokens de motion sont contournés 15 fois sur 22

`--dur-fast/med/slow` et `--ease-out/spring` existent (`App.css:63-68`), mais **15 des 22 `transition`** passent une durée littérale (140–200 ms `ease`) : `.chat` (`154`), `.button` (`171`), `.home-control` (`548`), `.home-recent-item` (`586`), `.window-tab` (`505`), `.toggle-row` (`415`), curseurs (`408`), etc. Idem pour 6 des 17 animations (`fade-up .18s`, `pulse 1.4s`, `shimmer 1.4s`, `presence 2.4s`, `dictation-pulse 1.2s`). Régler `--dur-fast` ne change donc presque rien à l'écran : le token est décoratif.

**Correctif mécanique** : `.16s ease` → `var(--dur-fast) var(--ease-out)`, sans changer les valeurs perçues (120 vs 160 ms : à trancher visuellement, un seul endroit à éditer).

### P3 — Réglages : quatre rôles typographiques en 2 px, valeurs à 11 px

Dans une même section (`App.css:401`, `389`, `440`, `402`) : titre de section 12 px/800, libellé de champ **11 px/400**, valeur **11 px/700 en accent**, hint 11 px/400 muted. Le skill (§15) demande de construire la hiérarchie sur **poids + taille + leading comme un jeu**, et le tableau du projet réserve `--font-size-xs` aux « micro-labels, métadonnées ». Ici c'est la taille du **libellé de contrôle**. Mesures : `.setting-row` 11 px/`line-height: normal` (≈ 13 px), `.segmented button` 11 px, `.settings-tabs button` 11 px, `.accent-choice` 11 px. À l'échelle de l'app, `xs` est utilisée **55 fois** contre 14 pour `md`.

Deux défauts de craft dans la même foulée : `line-height` n'est jamais fixé sur `body` (`App.css:95`) donc tous ces contrôles héritent de `normal` ; et la valeur de réglage est collée au libellé (`SettingsDialog.tsx:209` : `<span>Largeur de la barre latérale <b>286px</b></span>`), sans alignement tabulaire à droite.

**Correctif** : libellés de champ en `--font-size-sm`, une `line-height: 1.35` sur `.setting-row`/`.toggle-row`, valeur alignée à droite (`grid-template-columns: 1fr auto` déjà disponible).

### P3 — Cascade non neutralisée sous `prefers-reduced-motion`

Le bloc global met `animation-duration` à `.01ms`, mais **pas `animation-delay`** (`App.css:828`) ; les cartes du hub gardent `animation-delay: calc(var(--stagger-i) * 45ms)` (`1104-1105`). Avec `animation-fill-mode: both`, chaque carte reste à `opacity: 0` pendant son délai : jusqu'à **135 ms** d'écran vide pour la quatrième carte alors que l'utilisateur a demandé moins de mouvement. Correctif d'une ligne : `animation-delay: 0s !important` dans le bloc `reduce`.

### P3 — Actions de conversation invisibles hors survol

`.chat-actions button { opacity: .15 }` (`App.css:162`) n'est révélé que par `.chat:hover` / `.chat.active` (`165`) — pas de `:focus-within`. Un utilisateur clavier voit le contour de focus sur une icône à 15 % d'opacité : il sait qu'il est *quelque part*, pas *sur quoi*. Skill §10 (« highlight on touch-down », cibles découvrables) et §16.5 (wayfinding). Correctif : ajouter `.chat:focus-within .chat-actions button { opacity: 1 }` (une ligne) et remonter l'opacité de repos à .35.

### P3 — Trois sorties, des identifiants internes, des titres-slogans

- Réglages propose simultanément « Fermer » (barre de page), « Terminé » (pied) et l'onglet « Accueil » de la barre de fenêtre : trois portes pour une seule intention (skill §16.6, simplicité — pas minimalisme : choisir).
- La liste « Ordre des blocs » affiche les identifiants de code sous les libellés : `Messages / messages`, `Événements modèle / notices`… (`SettingsDialog.tsx:229`, listes triables). Noise pour l'utilisateur, utile au développeur.
- Les titres de page sont des slogans (« Un agent principal, des modes par besoin », « Configuration et apparence ») ; le nom réel de la section vit dans l'eyebrow 11 px. §16 : nommer par le contenu, pas par une promesse.

### P3 — Le matériau du hub est un décor, pas une matière

`--home-surface: color-mix(panel 94%, transparent)` (`App.css:481`) **plus** `backdrop-filter: blur(20px)` (`526`, `576`). À 94 % d'opacité, le flou n'a presque rien à flouter : on paie un compositeur plein écran pour un effet invisible — alors que le skill (§12) demande soit un verre franc (80–85 %, avec texte sur couche opaque), soit une surface opaque assumée. En sombre, la même variable passe à 78 % (`App.css:85`) et le matériau, lui, se voit : les deux thèmes ne racontent donc pas la même profondeur.

Autour du hub : **8 couches décoratives** (`::after` anneau, `.hub-grid-glow`, 2 auras floutées, 3 orbites, `.hub-crosshair` — `App.css:613-626`) derrière 4 cartes et un micro. C'est l'identité de l'app, mais §16.1 (« purpose… decide what *not* to build ») invite à en retirer au moins deux (le quadrillage et la croix) pour laisser les orbites porter la constellation.

---

## 5. Plan de correction proposé

| Lot | Contenu | Effort | Risque |
|---|---|---|---|
| **A — Lisibilité** (P1) | `--accent-ink` + `--on-accent`, remplacement des 30 usages, sonde presets × thèmes ; « Fermer » à 34 px | 1 session | Faible — couleurs uniquement |
| **B — Chorégraphie** (P2) | sortie de panneau symétrique, ressort réservé au geste, morph sur Notes/Fichiers + retours, état du micro | 1 session | Moyen — à revoir en slow motion et au clavier |
| **C — Finition** (P3) | tokens de motion, hiérarchie des Réglages, `animation-delay` sous reduce, `:focus-within` des actions, 2 couches de décor en moins | ½ session | Faible |

Chaque lot est **visible** au sens d'`AGENTS.md` : bump patch, note en tête de README, sonde seulement pour le lot A (le seuil de contraste est une convention stable).

---

## 6. Limites de cette revue

- **Pas de host Tauri dans la preview** (`web/src/api.ts` est 100 % Tauri) : la sidebar de conversations, la vue conversation, la liste d'agents et le terminal restent en chargement. Ces écrans ont été relus dans le CSS, pas observés dans cette passe ; les captures du 2026-10-20 18:14 (`docs/audits/2026-10-20-captures-v10.3.0/`, non suivies) en tiennent lieu pour l'historique, mais je ne les ai pas rouvertes image par image ici.
- **Captures incomplètes** : la webview de la preview a cessé de composer après deux captures (« produced no frames »). Seules deux images claires ont pu être conservées (`01-hub.png`, `02-reglages.png`) ; **aucune capture sombre** ni à 800 px dans cette passe. Les contrastes sombres sont mesurés, pas vus.
- **Gestes** : l'ordre des blocs et des agents utilise le drag-and-drop HTML5 (pas de Pointer Events, pas de suivi 1:1, pas de projection de momentum). Le skill §2/§5/§6 n'est donc pas satisfait par construction ; ce n'est pas traité ici comme un défaut (fonction secondaire) mais c'est le seul endroit où l'app n'est pas « fluide » au sens strict.
- **Non testé** : parcours clavier complet de chaque page, lecteur d'écran, `prefers-contrast`/`prefers-reduced-transparency` simulés (lus dans le CSS seulement), fluidité réelle du morph (pas de capture vidéo).
- Aucun fichier de production n'a été modifié par cette revue ; les correctifs des lots A et B sont arrivés ensuite, en v10.3.1 (§7).

---

## 7. Correctifs livrés — v10.3.1 (2026-10-20)

Lots **A** et **B** appliqués ; les points **P3** restent ouverts. Mesures refaites dans
le même renderer (`127.0.0.1:5173`, 1280×840, accent Émeraude, thème clair sauf mention).

| Défaut | Avant | Après | Preuve |
|---|---|---|---|
| Encre d'un remplissage accent (`--accent-fill` / `--on-accent`) | 2,54:1 | **7,66:1** | `getComputedStyle` + ratio WCAG, capture `03-hub-apres.png` |
| Même paire au survol (`--accent-fill-hover`) | 2,29:1 | **8,20:1** | token mesuré dans la page ; le survol s'éloigne toujours de l'encre |
| Accent en texte sur `--panel-solid` (`--accent-ink`) | 2,54:1 | **6,41:1** | `.hub-card-icon` mesuré dans le DOM |
| Encre d'accent sur `--accent-soft`, 5 presets × 2 thèmes | 2,3–2,5:1 | **5,06–6,44:1** | `tests/accent-contrast.test.mjs` + `scripts/verify-v10.3.1.mjs` |
| « Fermer » des pages | 99 × 21 px | **99 × 34 px** | `getBoundingClientRect`, capture `05-notes-fermer-34px.png` |
| Micro indisponible | `disabled:false`, `opacity:1` | `disabled:true`, curseur `not-allowed`, micro gris, libellé « Clé Groq requise » | DOM mesuré, capture `03-hub-apres.png` |
| Morph carte → page (Notes, Fichiers) | changement d'écran sec | `startViewTransition` appelé avec `source:"notes"` / `"files"` ; carte et corps de page portent `hub-target` | `document.startViewTransition` instrumenté dans la page |
| Retour page → carte (Échap, Fermer, Accueil) | fondu du root | source rejouée : `"notes"`, `"files"`, `"tasks"` observés | idem |
| Sortie de panneau | `translateY(6px) scale(.985)` + `--ease-out` | `translateY(10px) scale(.97)` + `--ease-out-mirror` | keyframes + CSSOM |
| Ressort sur une apparition sans geste | dialogues + menu de modèle | retiré des deux ; reste sur `.selbar` (surlignage = geste) | `scripts/verify-v10.3.1.mjs` |

Deux sondes antérieures ont été **amendées** (et non contournées) parce que la
convention qu'elles figeaient change ici, avec justification dans le code :
`verify-v10.2.0` (ressort sur l'entrée des dialogues, `closePage` en expression) et
`verify-v9.6.0` (ouverture de page en expression `=> withViewTransition`).

**Non mesuré dans cette passe** : la fluidité visuelle du morph — la preview force
`prefers-reduced-motion`, donc `withViewTransition` court-circuite ; le morph est
vérifié au niveau DOM/CSSOM, pas à l'œil. Les contrastes sombres sont mesurés dans le
DOM (encre `#10b981` à 7,19:1 sur `--panel-solid` sombre) mais **aucune capture sombre**
n'a pu être prise : le compositeur de la preview redevient muet après quelques images.

---

## 8. Correctifs livrés — v10.3.2 : lot P3 (2026-10-20)

Les cinq points P3 de la mission sont traités. Chaque constat a été **revérifié dans le
code** avant d'être corrigé ; deux prémisses de la revue se sont révélées fausses et sont
signalées plus bas. Mesures dans le même renderer (`127.0.0.1:5173`, 1280×840, accent
Émeraude, thème clair) ; captures `docs/audits/2026-10-20-v1032/`.

| Défaut | Avant | Après | Preuve |
|---|---|---|---|
| Durées/courbes en dur dans les `transition` | 15 déclarations sur 22 | **0** : toutes suivent `--dur-*` + `--ease-*` ; les 4 règles qui mélangeaient un `ease` nu à côté du token sont corrigées | CSSOM de la feuille chargée (valeurs `var(--dur-fast) var(--ease-out)` sur `.chat`, `.button`, `.home-control`, champs, onglets, curseur, bascule de thème) |
| Boucles ambiantes | confondues avec les temps de réponse | 5 boucles `infinite` restantes, documentées dans la feuille **et** dans AGENTS.md §12.4 | `scripts/verify-v10.3.2.mjs` (inventaire + exception nommée) |
| Titre de section des Réglages | 12 px/800 dans « Apparence », 14 px/700 dans les deux autres onglets | **14 px/800 partout** (`.section-title` + `.settings-pane > h4`) | `getComputedStyle` sur les trois onglets |
| Libellés/valeurs/hints | 11 px, interligne `normal` | **12 px**, `line-height: 1.35`, valeur 700 alignée à droite | mesuré : titre 14/800, valeur 12/700, libellé 12/400, hint 12/400 muted ; valeur collée au bord droit (écart 0 px) |
| Cascade sous `prefers-reduced-motion` | délais conservés | `animation-delay: 0s !important` + `transition-delay: 0s !important` | **mesuré** sur l'ancienne vs la nouvelle règle : opacité 0 jusqu'à 135 ms → 1 dès 10 ms ; sur la page : 0 élément avec un délai, 0 animation en cours, 4 cartes du hub `animation-name: none` / opacité 1 |
| Actions de conversation | opacité **0,15** au repos, révélées au seul survol | **0,35** au repos, **1** au survol **et** au clavier (`:focus-within`) | mesuré sur un échantillon portant les classes réelles (sidebar vide sans host) : repos 0,35 → focus 1 → survol 1 → blur 0,35 ; cible 24 × 24 px |
| Couches de décor du hub | 8 (anneau, quadrillage, 2 auras, 3 orbites, croix) | **6** : `.hub-grid-glow` et `.hub-crosshair` retirés du CSS **et** du rendu | DOM : 0 nœud de ces deux classes, 2 auras + 3 orbites + anneau `::after` conservés (capture `hub-apres.png`) |

**Deux prémisses corrigées (vérifiées, puis non retenues comme telles)** :

- « 135 ms d'écran vide » sur le hub sous reduce : **faux tel quel** — le bloc reduce
  portait déjà `.hub-card { animation: none }`, la quatrième carte n'était donc jamais
  blanche. Le défaut réel était la **classe de bug** (toute cascade future restait à
  `opacity: 0` pendant son délai, car `animation-duration` était neutralisé sans
  `animation-delay`). C'est ce que la sonde et le commentaire de la feuille disent
  maintenant ; les 135 ms ont été reproduits sur un élément témoin pour être mesurés.
- « Le flou du hub derrière 94 % d'opacité ne sert à rien » : vrai en clair, **faux en
  sombre**, où la même variable descend à 78 % et où le matériau se voit. Le flou est
  donc conservé ; ce sont les deux décors invisibles (quadrillage, croix) qui sont
  partis, conformément à « retirer sans appauvrir la composition ».

**Hors de cette passe, non traités** (ils ne font pas partie des cinq points demandés) :
les trois sorties de la page Réglages (« Fermer », « Terminé », « Accueil »), les
identifiants de code affichés sous les libellés de la liste triable, et les titres de
page rédigés comme des slogans. Ils restent ouverts dans §4.

**Non mesuré** : les durées perçues **sans** reduce — le renderer de la preview force
`prefers-reduced-motion`, donc les 120/240/380 ms ne sont lisibles qu'en CSSOM ; le
survol des actions de conversation a été mesuré sur un échantillon (la sidebar reste
vide sans host Tauri) ; aucune capture sombre n'a pu être produite.

---

## 9. Vérification dans l'app réelle — deux défauts bloquants trouvés (2026-10-20)

**Méthode** : `src-tauri/target/debug/aven.exe` (v10.3.2, WebView2, host Node
présent), piloté par CDP (port 9555) : clics souris réels (`Input.dispatchMouseEvent`
+ hit-test), clavier réel (`Input.dispatchKeyEvent`), lecture des styles calculés et des
animations en cours. Le réglage Windows **« Effets d'animation »** de cette machine
était **désactivé** (`ClientAreaAnimation=False`) : c'est ce qui explique que toutes les
vérifications précédentes n'aient vu que le chemin « reduce ». Il a été activé le temps
des mesures, puis **restauré à sa valeur d'origine**.

### Défaut A — les quatre cartes du hub s'empilaient au centre

`@keyframes card-in` animait `transform`, alors que `.hub-card` range son **orbite**
dans `transform` (`translate(-50%,-50%) rotate() translateY(--hub-r) …`). Avec
`animation-fill-mode: both`, le `transform: none` final restait appliqué à vie.

- **Avant** : les 4 cartes mesuraient le **même rect** (843, 385) ; `elementFromPoint`
  au centre de la carte Notes renvoyait `.voice-core` (z-index 6) — navigation
  principale invisible et **non cliquable** dès que l'OS autorise les animations.
- **Après** : 4 rects distincts (769/123, 978/333, 769/542, 559/333) et le hit-test
  renvoie `hub-card hub-card-notes`.
- Correctif : la cascade anime `translate`/`scale`, propriétés individuelles qui se
  **composent** avec `transform`. Sonde : `card-in` ne touche plus `transform`.

### Défaut B — aucune transition de vue ne s'animait

`withViewTransition` attendait **deux `requestAnimationFrame`** dans le callback de
mise à jour pour laisser React peindre. Mesuré sur un élément témoin :

| Callback de `startViewTransition` | `ready` | `finished` |
|---|---|---|
| synchrone | 13 ms | 269 ms |
| `microtask` / `setTimeout(0)` | 24 / 12 ms | 277 / 287 ms |
| **deux `requestAnimationFrame`** | **jamais (2,5 s)** | **jamais** |

Pendant la mise à jour, le navigateur suspend le rendu : les rAF demandés *dans* le
callback ne partent pas. Aucune animation `::view-transition-*` n'était créée ; le
morph ne s'est **jamais** joué (seul le filet de 1 s appliquait l'état, et `data-vt-source`
restait posé jusqu'au filet de 2 s). Correctif : callback synchrone + `flushSync` côté
`App.tsx` (React 19) pour committer avant la capture.

### Ce que la surface réelle montre après correctifs

| Point | Mesure |
|---|---|
| Morph des 4 cartes | Notes, Fichiers, Tâches, Projet : `startViewTransition` appelé, `data-vt-source` = `notes`/`files`/`tasks`/`project`, `::view-transition-group(hub-target)` **240 ms**, `old/new(hub-target)` **240 ms**, root entrée 240 ms / sortie 120 ms |
| Retour vers la carte | Échap (Notes, Tâches), « Fermer » (Fichiers), « Accueil » (Projet) : transition rejouée avec la même source, 10 animations par fermeture, hub retrouvé avec ses 4 cartes, `data-vt-source` libéré |
| Symétrie des panneaux | Entrée `.home-modal` : `dialog-in` 240 ms / `cubic-bezier(.22,1,.36,1)` ; sortie `::view-transition-old(dialog)` : `dialog-out` 240 ms / **`cubic-bezier(.64,0,.78,1)`** (le miroir) |
| Groupe du morph | il gardait les valeurs UA (250 ms, `ease`) — aligné sur `--dur-med`/`--ease-out` (mesuré : 0.24 s + la même courbe que ses copies) |
| Clavier (Réglages) | 16 arrêts de tabulation, **tous** avec `outline: 2px solid` accent (Rose `rgb(244,63,94)`), focus des champs visible par `box-shadow: 0 0 0 3px accent-soft` + bordure accent ; Échap ferme la page et rend le hub |
| Échap dans un champ | renommage de conversation (F2) : Échap annule le renommage et **ne quitte pas** la conversation (pas de fuite vers le listener global) |
| « Fermer » | 99 × 34 px sur la page Réglages |
| Actions de conversation | repos **0,35** (24 × 24) → clavier `:focus-within` **→ 1** → survol **1** → état armé **1** (« Confirmer la suppression définitive ») |
| Hub | 2 auras + 3 orbites + anneau, **0** quadrillage, **0** croix, 4 cartes |
| Thème sombre (capture) | `theme=dark`, carte `rgba(18,21,29,0.78)`, `--accent-ink` `#f76f86` — captures `hub-sombre.png`, `reglages-sombre.png` |
| Console | aucune exception ni erreur pendant le parcours |

**Non exercé dans l'app** : le micro désactivé (une clé Groq est configurée dans cet
espace : le bouton est légitimement actif — l'état « Clé Groq requise » reste vérifié
dans la preview) ; lecteur d'écran ; largeur 800 px ; la fluidité perçue du morph (pas
de capture vidéo — seulement les durées et les courbes mesurées). Ces constats sont
consignés avec les captures dans `docs/audits/2026-10-20-live/`.

### Chemin `prefers-reduced-motion` rejoué APRÈS correctif

Le trou de preuve du passage précédent : le chemin reduce n'avait été mesuré qu'AVANT
le correctif du callback (transition sautée). Il est rejoué sur le binaire corrigé,
**mouvement système DÉSACTIVÉ** (réglage de la machine, `SPI_GETCLIENTAREAANIMATION=0`,
`matchMedia("(prefers-reduced-motion: reduce)").matches === true`), CDP réel —
`mesures-reduce.json`.

| Point | Mesure |
|---|---|
| Cartes du hub | 4 rects distincts — Projet (843, 175), Tâches (1052, 385), Fichiers (843, 594), Notes (633, 385) — `elementFromPoint` au centre de chaque carte renvoie **cette carte**, `animation-name: none` |
| Ouverture ×4 | `card.click()` et lecture du DOM dans la **même tâche JS** : la page est déjà finale (titre, corps 512–542 px), le hub a disparu, `data-vt-source` **null**, **0** animation `::view-transition-*`, **0** animation en attente |
| Retour ×4 | Échap (Notes, Tâches), « Fermer » (Fichiers), « Accueil » (Projet) : hub relu dans la tâche du clic ou au premier échantillon CDP, source toujours null |
| Console | **0** exception, **0** erreur pendant les 4 allers-retours |

Le chemin est désormais fixé par deux garde-fous : le cas 5 de
`tests/view-transitions.test.mjs` (reduce → update synchrone, API jamais appelée,
aucune source posée) et la sonde §H de `scripts/verify-v10.3.2.mjs` (garde avant
l'API, personne ne pose `data-vt-source` hors du module, wrapper `flushSync` unique).
