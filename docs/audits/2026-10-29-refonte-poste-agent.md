# Refonte du Poste « agent d'abord » (v12.0.0)

Plan approuvé puis implémenté dans le dépôt : la sphère vocale occupe l'accueil, se
replie dans l'en-tête, et la navigation devient une constellation temporaire de cinq
cercles. Ce document consigne ce qui a été **mesuré** à l'écran et ce qui n'a pas pu
l'être.

## Ce qui a été mesuré

Webview réelle du binaire `target/debug/aven.exe` (build 12.0.0), pilotée par CDP,
fenêtre 1366 × 693 :

| Constat | Avant | Après |
|---|---|---|
| Sphère compacte, centre horizontal | 639 px (décalée de 44 px par le libellé d'état) | **683 px** = centre de la fenêtre |
| Agent, accueil → en-tête | deux rendus séparés | un seul canvas, `scale` 0,943 → 0,124, position mesurée sur l'ancre |
| Transition | — | à 120 ms : 5 cercles encore présents, agent à `scale` 0,33 ; à 1 s : 0 cercle, titre « Notes », `.notes-layout` monté |
| Poignée vs barre de commande | `bottom: 60px` fixe sur la fenêtre → chevauchait la barre (28 px de bandeau) | ancrée dans `.wb-body`, `top` poignée 561 < `top` barre 595 |
| Contenu d'accueil | invisible (rangée de grille de hauteur nulle) | titre, question, micro et état rendus |
| Arc | — | 5 nœuds, `x` = 473…893 (pas de 105 px), `y` = 467/439/429/439/467, fond de l'arc `rgba(0,0,0,0)` |
| Échap | — | referme (0 cercle) sans quitter l'accueil |
| Réouverture depuis un espace | — | 5 cercles, `aria-current` = « Notes », focus sur le cercle |

Captures : `artifacts/v12-constellation.png`, `artifacts/v12-notes.png`,
`artifacts/prod-poste-dark.png`, `artifacts/prod-tasks-dark.png`.

## Deuxième passe (brief complet, point par point)

- **Titre d'accueil** : `--font-display` (Bahnschrift SemiCondensed, police **livrée
  avec Windows**, aucun téléchargement) et `--font-size-display`
  `clamp(40px, 6.2vw, 64px)`. Mesuré à l'écran : 64 px, graisse 700.
- **Cadre de fenêtre** : filet 1 px `--border-strong` = `#46534b` (valeur du brief),
  mesuré `rgb(70, 83, 75)`, transparent au pointeur.
- **Repère de navigation** : au repos, trois points seuls (45 px de large, le mot
  n'apparaît qu'au survol, au focus ou ouvert) ; il ne ressemble plus à un bouton.
- **Cercle choisi** : `scale(1.1)` + remplissage d'accent avant la dispersion
  (phase 1 du brief).
- **Composeur de conversation** : l'état vide de 55 vh poussait le composeur sous la
  barre de commande (contenu 601 px dans une scène de 541 px) ; ramené à 38 vh dans
  le Poste — le composeur est visible sans défilement.
- **Notes** : le chemin du dossier, coupé à « ~ » dans l'en-tête compact, est retiré
  (il reste dans le `title` de l'action) ; le champ de recherche reprend la largeur
  disponible au lieu de 76 px.
- **Sphère** : masse lumineuse dégradée côté éclairé (volume de la référence),
  toujours pilotée par `--text`/`--panel-solid` — aucune couleur en dur.
- **Icône Conversations** : deux bulles qui se chevauchent (le brief le demande),
  `chat` gardant son sens unique.

## Défauts trouvés par la mesure (et corrigés)

- **Scène de hauteur nulle** : `.wb-main` réservait une rangée de 0 px pour des
  onglets absents ; `.wb-stage` tombait dedans et tout son contenu était rogné. Le
  calque de l'agent, `position: fixed`, restait seul visible — un build vert et une
  sphère affichée masquaient totalement le défaut.
- **Poignée dans la barre de commande** : la constellation était ancrée sur la
  fenêtre alors que la barre de commande remonte quand un bandeau d'état s'affiche.
- **Agent compact décentré** : la colonne centrale contenait l'ancre *et* le texte
  d'état, donc la sphère se décalait d'une demi-largeur de libellé.
- **Cercles par-dessus l'accueil** : la question, le micro et l'aide se peignaient
  sous les cinq nœuds ; ils s'effacent maintenant quand la constellation s'ouvre.
- **`left: 50%` sur l'arc** : l'arc entier était décalé d'une demi-fenêtre, les
  cercles sortaient de l'écran.

## Points du brief volontairement non repris

- **Télémétrie décorative** (« AVEN CORE ACTIVE », « SYSTEM IDLE », coordonnées) :
  invention de données, refusée par la règle « aucune donnée qui pourrait passer
  pour réelle ». Seuls les états réels sont affichés (micro, espace, moteur).
- **Profil utilisateur** : l'application n'a pas de compte ; aucun avatar factice.

## Ce qui n'a pas été exécuté

- `npm run test:features` (`scripts/test-features-tauri.mjs`) : il pilote encore le
  rail v11 (`.wb-rail-*`), les tuiles d'accueil et un onglet par instrument. Il n'est
  pas dans `npm run verify` et n'a pas été réécrit ici — il échouera au premier
  contrôle de cadre. `npm run visual:prod` a été adapté et passe.
- Parcours vocal réel (micro, STT, TTS) : hors périmètre de la refonte ; la sphère
  consomme `voice.phase` sans le modifier, et `npm test` couvre les modules purs.

## Limites connues

- L'accent suit le **preset d'apparence** de l'utilisateur (ici « blue »), alors que
  la DA du brief est l'orange `signal`. Le choix utilisateur n'a pas été écrasé.
- La transition combinée mesure ~300 ms (240 ms de tokens + cascade), sous les
  400–600 ms du brief : AGENTS.md §12.4 interdit une animation de plus de 300 ms.
  La règle du projet a primé ; l'allonger demande d'amender §12.4 et ses sondes.
- Les transitions ne piègent pas le focus (panneau de navigation, pas un dialogue).
- La constellation ne piège pas le focus : c'est un panneau de navigation temporaire,
  pas un dialogue modal ; Tab en sort naturellement.
