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

## Finition du 2026-10-29 — corrigé et mesuré

- **Parcours fonctionnel réécrit pour la v12** : `scripts/test-features-tauri.mjs`
  n'emploie plus aucun sélecteur du rail (`.wb-rail*`) ni des tuiles d'accueil. Il
  ouvre la constellation, vérifie les **cinq destinations dans l'ordre**, la phase de
  sortie (cercle choisi, autres écartés), le repli de la sphère sur l'ancre d'en-tête
  (écart mesuré 0×1 px), le retour par la marque, la réouverture depuis Notes sans
  agrandir la sphère, Échap et le retour du focus à la poignée, puis l'absence de
  rail, de dock et de panneau fantôme. Résultat : `PARCOURS FONCTIONNEL : OK`,
  **0 échec, 0 avertissement**, zéro erreur console.
- **Accueil minimal** : la barre de commande n'est plus permanente ; `Ctrl+K`
  l'ouvre et y place le focus, un second Échap (saisie vide) la referme. Le micro
  d'en-tête n'est plus rendu à l'accueil (un seul contrôle vocal, celui de la
  sphère) ; l'arrêt d'une réponse reste offert. Sans barre, le corps reprend une
  seule rangée et la poignée descend au bord inférieur au lieu de flotter.
- **Conversations** : une configuration neuve montre l'historique (`showSidebar`
  vrai par défaut, réglage toujours maître). Mesuré : historique ≈ 0,25 de la
  largeur, fil et composeur rendus.
- **ARIA de la scène** : `.wb-stage` n'est `tabpanel` que si le bandeau de
  conversations existe réellement ; sinon c'est une région nommée par la
  destination. Plus de `aria-labelledby` vers un onglet démonté.
- **Sphère et thèmes** : le canvas relit `--text`, `--accent` et `--panel-solid`
  sur mutation du document et sur changement `prefers-color-scheme`, sans
  rechargement. Mesuré sur la WebView réelle : la signature du rendu change de
  `2731240830` à `404477864` en passant au sombre, puis change encore au changement
  d'accent.
- **Mouvement réduit** : cascade, dispersion et repli mesurés instantanés
  (`animation-duration`, `animation-delay`, `transition-duration` ≤ 0,02 ms).
- **Géométries** : 1280×820, 1024×700 et 900×680 — aucun débordement, titre
  entier, cinq cercles dans le cadre, en-tête 54 px.
- **Accessibilité mesurée** : tous les contrôles visibles ont un nom accessible,
  aucune cible interactive sous 24 px, `:focus-visible` présent, contrastes texte
  15,6:1 (clair) / 15,9:1 (sombre) et texte secondaire ≥ 5,7:1.
- **Voix de bout en bout** : `npm run test:voice-note` passe sur la WebView de
  développement réelle (voix SAPI française injectée, STT réel). La demande est
  transcrite, le contenu est **rédigé** (blocs `for`/`while`, 200+ caractères) et non
  recopié, la confirmation relit le texte, la note est créée une seule fois puis
  purgée.
- **Chaîne de contrôles** : `typecheck:host`, `typecheck:tests`, `tsc -b`,
  `npm test` (**436 tests, 0 échec**), `build:web`, `npm run verify` (exit 0),
  `cargo check`, `cargo test` (0 test Rust défini, exit 0), `test:features` (exit 0),
  `visual:prod` (exit 0), `smoke:tauri` (5 PASS, 0 FAIL).

## Ce qui n'a pas été exécuté

- **CI distante** : aucun push n'a été demandé ; les étapes du workflow
  `ci-windows.yml` ont été rejouées localement, pas sur un runner GitHub.
- **Fumée, étape dev** : ignorée localement car un Vite Aven occupait déjà
  `127.0.0.1:5173` (le script ne touche pas un serveur existant). Le binaire de
  production, lui, a été fumé (CSP, origine, barre native).
- **Voix Pocket et repli Windows à l'oreille** : le parcours de note passe par le
  STT et la synthèse réels, mais je n'ai pas écouté le timbre produit ni provoqué
  l'indisponibilité de Pocket pour vérifier que le repli Windows est annoncé.
- **Interruption vocale par une parole adressée** : couverte par les tests purs
  (`barge-in`, `echo`, `voice-agent-addressed`), pas par une voix physique dans la
  pièce ; l'écho réel des haut-parleurs n'a pas été mesuré.
- **Thème système** : le changement d'apparence a été émulé par CDP ; un changement
  réel du thème Windows pendant que l'app tourne n'a pas été observé.

## Limites connues

- L'accent suit le **preset d'apparence** de l'utilisateur (ici « blue »), alors que
  la DA du brief est l'orange `signal`. Le choix utilisateur n'a pas été écrasé.
- La transition combinée mesure ~300 ms (240 ms de tokens + cascade), sous les
  400–600 ms du brief : AGENTS.md §12.4 interdit une animation de plus de 300 ms.
  La règle du projet a primé ; l'allonger demande d'amender §12.4 et ses sondes.
- Les transitions ne piègent pas le focus (panneau de navigation, pas un dialogue).
- La constellation ne piège pas le focus : c'est un panneau de navigation temporaire,
  pas un dialogue modal ; Tab en sort naturellement.
