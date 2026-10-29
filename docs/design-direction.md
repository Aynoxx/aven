# Aven — direction artistique dérivée de la référence DRONE « Mapping-OS »

Document de direction, pas un audit de code. Il traduit une référence visuelle en
principes réutilisables, puis en un brief d'implémentation pour le dépôt Aven.
Aucune modification de code n'est faite ici : le brief est prêt à être exécuté.

## 1. Référence et statut d'accès

- **Source demandée :** `https://www.instagram.com/p/Dcv7CQ4kViN/` (compte
  `kyleanthonymiller`, 1er septembre 2026).
- **Statut :** la page répond en HTTP 200 mais ne sert qu'une coquille de connexion
  Instagram ; **aucune image n'y est accessible sans compte**. L'analyse s'appuie donc
  sur la **capture fournie avec la demande** (2048 × 1150), qui montre la page
  « MAPPING-OS » de la marque DRONE.
- **Portée :** un seul exemple. Ce document décrit **les traits de cette page**, pas
  une tendance supposée de tout un site. Rien n'est affirmé sur les autres pages.
- **Métadonnée du post (texte, pas image) :** « mixing Swiss design with Neo
  Industrialism ». Elle confirme le vocabulaire, elle ne prouve pas les interactions.

## 2. Analyse visuelle fondée sur l'image

### 2.1 Palette (valeurs estimées sur la capture, compression JPEG comprise)

| Rôle | Valeur observée | Usage dans la référence |
|---|---|---|
| Fond principal | `#0B0D0A` (vert-noir) | plein cadre, légère vignette |
| Surface secondaire | `#141713` (estimée) | zones d'image, cartouche de texte |
| Texte principal | `#F4F5F1` | titre monumental, libellé « Geospatial Awareness » |
| Texte secondaire | `#8C9187` | paragraphe, télémétrie basse |
| Filets clairs | `#D9DBD3` | courbes de niveau, graduations |
| Accent orange | `#E8551F` – `#F0682C` | croisée d'axes, nœuds, « ACTIVE » |
| Trame de points | `#2A2D26` à ~20 % | grille de points sur tout le fond |

L'orange ne couvre **jamais** une surface : il ne porte que des filets de 1 px, des
repères carrés et deux mots d'état. Tout le reste est monochrome.

### 2.2 Typographie

- **Titre :** grotesque large, graisse très forte (700–800), capitales, interlettrage
  serré (≈ −0,04 em), hauteur ≈ 20 % de la fenêtre, largeur ≈ 88 % de la page.
- **Navigation :** petites capitales, 600–700, interlettrage large (≈ 0,12 em),
  répartie sur toute la largeur — pas un menu centré.
- **Titre de section (« Geospatial Awareness ») :** casse de phrase, 500–600,
  tracking légèrement négatif, deux lignes serrées, précédé d'un ® cerclé.
- **Métadonnées :** monospace, 10–11 px, capitales, interlettrage 0,08–0,12 em ;
  orange pour l'état, gris pour les mesures.
- **Corps :** sans-serif, 14 px, interligne ≈ 1,45, gris, largeur ≈ 34 caractères.

### 2.3 Composition

- Plein cadre, marges constantes, **grille éditoriale à filets** : une verticale à
  ≈ 63 % de la largeur, une horizontale à ≈ 66 % de la hauteur, qui se croisent sur
  un petit carré orange.
- Le titre occupe le haut et déborde presque toute la largeur ; l'image (scan aérien,
  silhouette blanche, faisceau) occupe la gauche et le centre, coupée net en bas.
- Le bloc de sens (« Geospatial Awareness » + paragraphe) est **en bas à droite**,
  séparé du titre par un grand vide.
- La marge gauche porte une **échelle graduée** (+30/+15/0/−15) ; les coins portent
  des blocs de télémétrie minuscules.
- Balance : masse sombre + lumière ponctuelle à gauche, typographie monumentale en
  haut, un seul bloc dense en bas à droite, beaucoup de vide entre les deux.

### 2.4 Géométrie

Angles vifs partout, un seul cercle (le ®). Filets de 1 px, graduations, petits carrés
pleins aux extrémités d'axes, courbes de niveau en trait fin. Aucune carte, aucune
ombre, aucun arrondi, aucun panneau flottant.

### 2.5 Matières et textures

Grain et dithering dans les noirs, faisceau volumétrique, flou de profondeur, halo
spéculaire blanc. La trame de points est le seul motif régulier. Aucun verre dépoli,
aucun dégradé coloré.

### 2.6 Hiérarchie de lecture

1. `MAPPING-OS` (échelle + blanc pur) ;
2. le faisceau et la silhouette (zone la plus lumineuse) ;
3. `Geospatial Awareness` (blanc, grand) ;
4. la croisée orange et ses nœuds ;
5. la télémétrie monospace.

### 2.7 Langage d'interaction

**Observé :** rien — l'image est statique. Aucun survol, aucune transition, aucun
curseur ne peut être constaté.

**Interprété (proposition, pas observation) :** des filets qui suivent le pointeur
avec une lecture de coordonnées, un changement de page en volet masqué, des libellés
de navigation qui s'éclairent au survol. Ces propositions servent la direction, elles
ne sont pas présentées comme des preuves.

### 2.8 Vocabulaire de design

Grille suisse éditoriale · instrumentation néo-industrielle · cartographie de relevé ·
filets de tracé · scan monochrome · signal orange braise · grotesque monumental ·
marginalia télémétrique · courbes de niveau · contraste de vide · cadrage plein bord.

## 3. Carte de direction

**Evidence.** Un seul spécimen inspecté : page DRONE « MAPPING-OS ». Traits concrets :
titre grotesque monumental sur 88 % de largeur, grille à filets orange avec nœud carré,
échelle graduée en marge, courbes de niveau blanches, télémétrie monospace aux coins,
bloc de sens en bas à droite, image sombre à faisceau lumineux, trame de points.

**Carry over.** Le principe, pas le sujet : échelle typographique monumentale ; grille
de filets avec un seul nœud d'accent ; monochrome + orange réservé au signal ; marges
graduées et télémétrie en mono ; angles vifs, surfaces structurées par l'espace et les
filets ; vide assumé comme élément de composition.

**Invent.** La « matière » d'Aven est la **sphère filaire** — elle remplace le scan
aérien et le faisceau. La croisée devient un **instrument de mesure de l'agent** :
elle passe par le centre réel de la sphère et sert de repère au repli. La télémétrie
n'est **jamais inventée** : elle affiche l'espace de travail, le modèle actif, l'état
du moteur et du micro, valeurs réelles. Le bloc de sens d'Aven est sa phrase de
service, pas une revendication géospatiale. L'axe gradué devient une échelle de
**densité de l'agent** (points/maillage), pas des altitudes fictives.

**Avoid repeating.** Ne pas reprendre : scan aérien + silhouette humaine + faisceau
lumineux ; la croisée exactement à 63 %/66 % avec le même titre occupant la même
proportion ; les coordonnées `LON/LAT/ALT/HOG/GRID` (données fictives dans une app) ;
le bloc « Geospatial Awareness ® » ; le mot-symbole DRONE et sa navigation
(PRODUCTS/ABOUT/CAREERS/SEARCH) ; l'orange saturé en aplat.

**Build scope.** Accueil (titre, sphère, question, micro, télémétrie, repère) ;
constellation (cinq cercles, arc, états) ; en-tête d'espace de travail (agent compact
centré, section, contrôles) ; surfaces Notes/Fichiers/Terminal/Orchestration/Conversations
(conservées, restylées par jetons) ; transition accueil ↔ travail.

## 4. Jetons et correspondance avec l'existant

La DA actuelle (`web/src/styles/da.css`, v11–v12) **descend déjà de cette famille** :
champ forêt, trame de points, orange braise, filets de 1 px. L'écart principal avec la
référence est l'**échelle du titre**, l'**axe gradué** et la **composition asymétrique**.

| Intention | Jeton existant | Valeur actuelle | Décision |
|---|---|---|---|
| Fond | `--bg` | `#0b100e` | conservé |
| Surface | `--panel` / `--panel-solid` | `#131b17` | conservé |
| Texte | `--text` | `#e7ebe7` | conservé |
| Secondaire | `--muted` | `#939f96` | conservé (contraste ≥ 4,5:1) |
| Filet technique | `--border-strong` | `#46534b` | conservé |
| Signal | `--accent` / `--signal` | `#d77a43` | **conservé** : plus braise que le `#E8551F` de la référence, et lisible en petit texte d'état |
| Trame | `--grid-dot` | `rgba(231,235,231,.10)` | conservé, 22 px |
| Voix UI | `--font-ui` | pile système | conservé |
| Voix technique | `--font-mono` | pile mono système | conservé |
| Voix d'affichage | `--font-display` | Bahnschrift SemiCondensed | conservé, mais **étiré** pour l'accueil (voir 5) |
| Taille d'affichage | `--font-size-display` | `clamp(40px, 6.2vw, 64px)` | **proposé : `clamp(56px, 9.4vw, 128px)`** (amendement AGENTS §2 + sonde) |

Nouveaux jetons proposés, sans effet tant qu'ils ne sont pas consommés :

| Jeton | Valeur proposée | Rôle |
|---|---|---|
| `--axis-line` | `color-mix(in srgb, var(--accent) 55%, transparent)` | filets de croisée |
| `--axis-node` | `var(--accent)` | nœud de croisée, 3 px |
| `--tick` | `var(--border-strong)` | graduations de l'échelle |
| `--noise-opacity` | `.035` | grain optionnel, une seule couche |

## 5. Typographie et espacement

- **Titre d'accueil :** `--font-display`, `font-stretch: 100%`, capitales, graisse 700,
  interligne 0,86, tracking −0,02 em, largeur maximale 16 caractères par ligne.
  Deux lignes admises. Il ne sert **qu'à l'accueil**.
- **Titre de section (en-tête) :** `var(--font-mono)`, `xs`, capitales, tracking
  0,16 em — libellé d'instrument, pas titre de page.
- **Titre d'instrument :** `2xl` (28 px), graisse 700, tracking −0,02 em.
- **Corps :** `md` (14 px), interligne 1,5.
- **Métadonnées :** `xs` (11 px) mono, capitales, tracking 0,08–0,12 em.
- **Espacement :** échelle 4/8 px ; marges de page 24 px ; gouttière de colonne 24 px ;
  hauteur d'en-tête 54 px, barre de commande 56 px (jetons existants).

## 6. Surfaces et composants

- Fond `--bg`, trame de points 22 px ; **aucune carte** : les zones sont séparées par
  des filets `--border` / `--border-strong`.
- Le cadre de fenêtre reste un filet 1 px `--border-strong`, transparent au pointeur.
- Les panneaux (inspecteur, dialogues) gardent `--radius-lg` (6 px), sans ombre lourde.
- Les listes (conversations, notes, fichiers) : lignes de 1 px, sélection marquée par
  un fond `--accent-soft` **et** un filet d'accent, jamais par la couleur seule.
- Le composeur garde sa bordure 1 px et son fond `--panel-solid` ; pas d'ombre portée.
- Aucun dégradé décoratif sur les surfaces ; seul le canvas de l'agent a des dégradés
  (volume de la sphère).

## 7. Visualisation de l'agent

- Sphère filaire : points de Fibonacci, parallèles/méridiens, deux orbites de
  construction, deux nœuds d'accent. Volume par dégradé radial côté éclairé.
- **La croisée instrumentale passe par le centre de la sphère** (accueil) et se replie
  avec elle ; en espace de travail, elle disparaît et seule la sphère compacte reste.
- L'échelle graduée verticale, à gauche de la sphère, est une **échelle de densité**
  (étiquettes `+` / `0` / `−` purement graphiques, ou mieux : aucune valeur chiffrée),
  jamais des altitudes. Si une valeur chiffrée ne peut pas être réelle, elle n'est pas
  affichée.
- États : immobile (micro coupé, aucune onde), écoute (respiration lente), capture,
  transcription, réflexion (rotation plus rapide), parole (onde), erreur (teinte
  d'alerte + texte). Une animation ne remplace jamais le texte d'état.

## 8. Navigation, apparence et états

- **Au repos :** trois points seuls au bord inférieur, 45 px de large ; pas de pilule,
  pas de dock.
- **Ouvert :** cinq cercles de 64 px sur un arc (`x = ±210`, `y` 0–38), fond
  transparent, filet `--border-strong`, libellé mono sous chaque cercle.
- **Survol/focus :** `scale(1.07)`, filet d'accent, libellé en `--text`.
- **Section courante :** filet d'accent, `--accent-soft` en fond, `aria-current="page"`.
- **Choisi :** `scale(1.1)` + remplissage d'accent avant la dispersion.
- **En espace de travail :** même constellation, section courante marquée ; l'agent
  compact reste dans l'en-tête, centré sur la fenêtre.

## 9. Transition accueil → espace de travail

| Phase | Durée | Contenu |
|---|---|---|
| 1. Emphase | 120 ms | le cercle choisi grossit et s'allume |
| 2. Dispersion | 240 ms (cascade 28 ms) | les quatre autres s'écartent vers les bords et fondent |
| 3. Repli | 240 ms, simultané | la sphère se translate et se met à l'échelle vers l'ancre d'en-tête |
| 4. Révélation | 160 ms, chevauchée | le contenu de la section apparaît ; l'arc a disparu |

Total perçu ≈ 520 ms (les phases se chevauchent), sans rebond. Le brief initial
demandait 400–600 ms ; `AGENTS.md` §12.4 plafonne une animation à 300 ms. **Arbitrage :**
soit on garde le plafond du projet (~300 ms au total), soit on amende §12.4 et sa sonde
pour autoriser un enchaînement de 520 ms — la seconde option est la seule qui satisfait
la référence, elle doit être explicite.

## 10. Mouvement et accessibilité

- Transitions courtes, courbe de sortie uniquement ; aucun rebond hors du ressort
  réservé aux gestes.
- `prefers-reduced-motion` : durées et délais remis à zéro, état final immédiat.
- Tout état est **écrit** (micro, phase, section) : la couleur ne porte jamais seule
  l'information.
- Focus visible partout ; Échap ferme la constellation ; Tab entre dans les cercles ;
  aucune couche décorative ne capte le clic.
- Contraste : `--muted` sur `--bg` et sur `--panel-solid` ≥ 4,5:1 dans les deux thèmes ;
  orange réservé aux filets et à l'encre d'accent (`--accent-ink`), jamais en petit
  texte sur fond clair.

## 11. Responsive (fenêtre de bureau)

- ≥ 1200 px : titre monumental, sphère 340 px, télémétrie aux quatre coins.
- 980–1200 px : titre plafonné à 96 px, libellé d'état de l'agent masqué, télémétrie
  réduite à deux blocs.
- 760–980 px : titre 64–80 px, sphère 280 px, cercles 56 px, arc resserré.
- < 760 px : titre 48 px, sphère 240 px, télémétrie masquée, contrôles de droite
  conservés (jamais supprimés), en-tête sur une seule rangée.
- Aucun défilement global : la scène, la liste de notes, l'explorateur et le terminal
  gardent leur propre défilement.

## 12. Traitements interdits

- Cartes arrondies, ombres portées lourdes, verre dépoli, dégradés colorés décoratifs.
- Dock, ovale, rail, barre de navigation permanente, conteneur commun aux cercles.
- Données fictives : coordonnées, altitudes, statuts « système » inventés, compteurs
  qui ne mesurent rien.
- Visuel copié : scan aérien, silhouette humaine, faisceau, ®, mot-symbole DRONE.
- Orange en aplat large ou en texte principal.
- Animation de plus de 300 ms sans amendement explicite de §12.4.

## 13. Brief d'implémentation prêt à coller

> **Objectif.** Appliquer la direction DRONE « instrument de relevé » à Aven sans
> copier son sujet : titre d'accueil monumental, croisée de mesure passant par la
> sphère, télémétrie **réelle** aux marges, constellation inchangée dans son principe.

**Fichiers concernés**

| Fichier | Rôle actuel | Changement |
|---|---|---|
| `web/src/styles/da.css` | palette et jetons | `--font-size-display` à `clamp(56px, 9.4vw, 128px)` ; jetons `--axis-line`, `--axis-node`, `--tick` |
| `web/src/styles/workbench.css` | charpente du Poste | `.wb-home-title` étiré et monumental ; `.wb-home` en grille asymétrique ; `.wb-axes` (croisée + graduations) |
| `web/src/workbench/HomeStage.tsx` | accueil | titre plein bord, croisée, télémétrie réelle (espace, modèle, moteur, micro), question + micro |
| `web/src/workbench/WorkbenchShell.tsx` | coquille | fournit les valeurs réelles de télémétrie ; repli de l'agent inchangé |
| `web/src/agent/WireframeAgent.tsx` | rendu de la sphère | aucune régression : la croisée est un calque DOM, pas un dessin de plus |
| `web/src/workbench/NavigationConstellation.tsx` | constellation | graduations optionnelles sur l'arc, sans conteneur |
| `AGENTS.md` §2 | échelle typographique | documente le nouveau plafond du titre d'accueil |
| `scripts/verify-v12.0.0.mjs` | sonde de la version | fige le token, la croisée et l'absence de données inventées |

**Étapes**

1. Amender `AGENTS.md` §2 (plafond du titre d'accueil) **et** sa sonde dans le même
   changement.
2. Ajouter les jetons d'axe et ajuster `--font-size-display`.
3. Construire `.wb-axes` : deux filets de 1 px (`--axis-line`), un nœud carré de 3 px
   à l'intersection, graduations `--tick` ; `pointer-events: none`, `aria-hidden`.
4. Positionner la croisée sur le centre réel de l'ancre `agent-home-anchor`
   (mesure JS, pas de valeur devinée) ; la masquer hors accueil.
5. Recomposer l'accueil : titre en haut à gauche (marges 24 px), sphère centrée,
   question + micro sous la sphère, télémétrie réelle en bas à gauche, repère au centre
   du bord inférieur.
6. Vérifier que la télémétrie n'affiche **que** des valeurs disponibles : espace actif,
   modèle, état du moteur, état du micro. Sinon, la ligne disparaît.
7. Réduire les animations à l'enchaînement décrit au §9, ou amender §12.4.
8. Vérifier à l'écran (webview réelle) : accueil, constellation, chaque destination,
   repli de l'agent, Échap, mouvement réduit.

**Critères d'acceptation**

- Le titre est le plus grand élément typographique de l'app, et le seul à utiliser le
  plafond monumental.
- La croisée passe exactement par le centre de la sphère, mesuré, et disparaît dès
  qu'on quitte l'accueil.
- Aucune valeur affichée n'est fictive ; retirer une donnée retire sa ligne.
- La sphère reste le point focal : le titre ne la pousse jamais hors de l'écran à
  760 px de large.
- Aucun conteneur commun aux cinq cercles, aucun dock, aucun rail.
- Contrastes ≥ 4,5:1 pour `--muted` et pour toute nouvelle encre d'accent.
- `npm test`, `npm run verify`, `npm run build` verts ; vérification visuelle de la
  webview réelle consignée.

## 14. Risques et limites

- **Police large :** la référence utilise une grotesque large propriétaire. Aucune
  police téléchargée n'est admise ; Bahnschrift (Windows) est le seul substitut
  disponible, et sa largeur diffère. La direction assume une grotesque **condensée**
  comme signature propre d'Aven plutôt qu'une imitation impossible.
- **Échelle :** un titre à 128 px dans une fenêtre de 693 px de haut laisse peu de
  place ; la composition doit être vérifiée à 760 px de large avant validation.
- **Télémétrie :** le charme de la référence vient en partie de données inventées.
  Les afficher serait un mensonge d'interface ; la direction les remplace par des
  mesures réelles, moins nombreuses mais vraies.
- **Interactions :** l'image ne prouve aucun comportement ; les propositions de survol
  et de volet restent des hypothèses à valider à l'usage.
