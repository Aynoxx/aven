# Audit — interface utilisateur (captures du 2026-10-29)

> Ces captures proviennent de la session avec l'utilisateur ("regarde l'écran Aven"), **pas** du pipeline de vérification du projet. Les mesures ci-dessous sont des lectures vidéo : je ne peux pas les relire dans la machine cible comme le faisait `scripts/visual-prod-tauri.mjs`. Je l'ai rappelé ci-dessous. Pour les déclarer vérifiées, il faut les relancer dans la webview réelle.

**Séance** : l'utilisateur a soumis quatre captures d'un même appareil. La version affichée est **v11.0.0** ; un écran mentionne `V2.0.10` dans le bandeau, ce qui correspond exactement au défaut noté dans l'audit précédent (`docs/audits/2026-10-22-coherence-graphique.md §1.3`) — la page affiche la version du moteur, pas l'app. Je me base donc sur la spécification **v12.0.0** pour juger du cible, et je le signale chaque fois qu'un point de cible est absent ou différent.

---

## Ce qui est vérifié ici vs ce qui ne l'est pas

### Vérifié sur les captures (lecture visuelle)
- Hiérarchie typographique visible sur les deux écrans.
- Disposition des blocs de métadonnées (gauche, droite, haut, bas).
- État du micro, libellés d'état, présence d'un rail/dock.
- Configuration de la constellation : rail + dock horizontal, pas de poignée et pas de cercles flottants.
- Comparaison des deux états (accueil vs espace de travail).
- Couches de métadonnées, double statut vocal, placement de la liste « Recent conversations ».

### Hypothèses / non vérifiés (images seules)
- Interactivité réelle : focus, flèches, Échap, compositing du repli, temps réel de la réponse vocale.
- Cohérence des couleurs en thème sombre/clair (les captures semblent toutes dans le thème sombre sans contre-exemple numéroté).
- Comportement de la voix, latence, transcription, commandes d'application — rien de l'agent vocal allé au-delà d'un état `EN ÉCOUTE` statique sur les captures.
- Résolution des doublons de texte/bandeau, ou contenu de certains libellés qu'une police stylisée rend illisible (ex. la liste "Recent conversations" avec des mots difficilement lisibles sur l'image).

---

## 1. Description des écrans et hiérarchie visuelle

### 1.1 Écran d'accueil (gauche)

**La structure observée se lit comme suit** :

1. **Colle des icônes** en haut à gauche (trois points de fenêtre macOS).
2. **Bandeau utilisateur** en haut à gauche : photo miniature + `AVEN`.
3. **Bandeau de configuration** en haut à droite : `USER SETTINGS` + icône engrenage + photo utilisateur.
4. **Titre monumental** : `BONJOUR. JE SUIS AVEN.` — visiblement une seule masse de texte, centrée horizontalement (selon la capture).
5. **Sphère vocale** (calotte + réseau de points + charpente d'instrument) occupant le centre de la scène.
6. **Étiquette de statut** à côté de la sphère : lecture difficile sur l'image.
7. **Question** sous la sphère : `Que souhaitez-vous accomplir aujourd'hui ?` (largeur pleine, centré).
8. **Micro au centre** : glyphe dans un cercle pointillé, sous-jacent.
9. **État vocal** : `ÉCOUTE EN ATTENTE` juste sous le micro.
10. **Repère de navigation** en bas : une pastille/circle avec un point, en pied de page.

**Hiérarchie** : Titre > sphère > question > micro > état. La capture laisse penser que l'accueil tient son équilibre sur une masse centrale (titre + sphère + question alignés verticalement), avec le micro/oût-attente en bas. Cette disposition est cohérente avec l'idée d'une scène « agent d'abord ».

### 1.2 Écran de navigation (droite)

**La structure observée se lit comme suit** :

1. **En-tête des métadonnées (haut gauche)** :
   - `AVEN CORE: ACTIVE`
   - `USER: N. DUPONT`
   - `SYSTEM: IDLE`
   - sous ces lignes, un second groupe : `AVEN: ACTIVE` / `SYSTEM: IDLE`
2. **Sphère vocale** centrée, avec des lignes d'appel pointant vers des repères sur la calotte (label `ACTIVE`, point orange).
3. **Gauche de l'espace** : un panneau avec `Messagerie` + `Recent conversations` et une liste déroulante d'entrées avec heure (format 2023/2022, incohérent).
4. **Bas de l'espace** : métadonnées, notamment `CONSTELLATION NAV: NODE: ACTIVE` à gauche et catégorie visible à droite.
5. **Dock de navigation horizontale** en bas de fenêtre : cinq pastilles (« Conversations », « Notes », « Fichiers », « Terminal », « Orchestration »), la première surlignée en orange avec un point d'accent.

**Hiérarchie** : la capture révèle une surcharge d'états en haut (deux groupes « AVEN / SYSTEM » distincts mais quasi redondants), un centre de lecture très chargé (sphère + annotations), un panneau latéral qui reprend une navigation de conversation, puis un dock en bas.

---

## 2. Éléments graphiques réussis / nuisant à la lisibilité

### Réussis
- Le titre monumental « BONJOUR. JE SUIS AVEN. » fonctionne comme **l'ancre de lecture** : c'est la masse typographique qu'on lit en premier.
- La sphère est nette, lisible en première lecture, et son état semble communicatif (point d'accent orange).
- Le dock en bas donne une **présence de navigation immédiate**, avec un point de focus sur la section active.

### Nuisant à la lisibilité
- **Superposition de métadonnées** : deux blocs « AVEN / SYSTEM: IDLE » en haut, l'un à gauche, l'autre à droite. En règle générale, c'est du bruit saillant : le même message est affiché deux fois, ailleurs, ce qui attire l'œil sans apporter d'information nouvelle.
- **Double statut vocal** : la capture laisse penser à une hiérarchie de statuts (AVEN CORE / USER / SYSTEM puis AVEN / SYSTEM) qui n'est pas ordonnée de façon lisible dans l'espace. Au premier coup d'œil, on ne sait pas quel statut est le « vrai ».
- **Dock + rail d'icônes** : le rail se comporte comme une répétition partielle de la navigation, ce qui ajoute un second canal visuel.
- **Textes de menu peu lisibles** sur la capture (titres de conversation avec caractères stylisés, heures datées de 2023/2022 sur un écran de 2026-10-29 — ou du contenu de test/peu réaliste). Même si c'est une image, le contraste et la forme des mots rendent la lisibilité douteuse sur certains noms.
- **Étiquettes flottantes** autour de la sphère : des annotations orthodromiques/géographiques stylisées (`33:32 N`, `-3:54° W`, etc.) qui paraissent être un choix graphique fort, mais qui ressemblent à un hors-sujet technique dans une interface utilisateur vocale ; à part si c'est volontaire, c'est du bruit perçu.

---

## 3. Comportement réel de la constellation de navigation

La capture de droite montre **un rail horizontal d'icônes de navigation en bas**, pas la constellation temporaire décrite dans v12.0.0 (`scripts/verify-v12.0.0.mjs`).

**Ce que j'ai lu dans l'image** :
- Navigation permanente sous forme de dock de pastilles en bas de fenêtre.
- Une pastille active visible (Conversations, encadrée en orange, point d'accent).
- Le reste est en gris, sans transformer/apparaître sélectivement.

**Ce qu'implique la comparaison avec la spécification v12.0.0** :
- v12.0.0 n'autorise pas de rail ni de dock permanent : la sonde vérifie `!shell.includes("wb-rail")` et `!css.includes(".wb-dock")`.
- v12.0.0 attend cinq cercles indépendants, posés sur un arc, pas une pastille dock, et la navigation se rouvre depuis n'importe quel espace de travail par une poignée.
- Sur la capture, le rail semble **permanent**, pas temporaire.

**Observation** : dans la capture, il n'y a pas de poignée distincte, pas de panneau d'arc, pas de cercle actif positionné autour de l'espace — ce qui suggère un rail/navigation dock différent de la spécification. **Je ne sais pas si le rail est récent, un vestige, ou le comportement d'une ancienne version**, car la capture ne contient pas le DOM ni la chronologie ; j'affine ce point donc comme une hypothèse.

---

## 4. Transformation de l'agent vocal entre l'accueil et l'espace de travail

Selon les deux captures, l'agent vocal est principalement lisible par **l'icône micro + le texte d'état sous la sphère**.

- À l'accueil : le micro semble disponible et l'état indique `ÉCOUTE EN ATTENTE`. La sphère est présente et lisible, c'est cohérent avec l'idée d'un agent vocal visible.
- Dans l'espace de travail (droite) : l'image conserve la sphère et montre apparemment un second ensemble de métadonnées vocales/cœur (AVEN, SYSTEM).

**J'ai pas observé** (image seule) : un changement de forme ou de comportement du microphone autre que son état, ni le passage de l'état « écoute en attente » à une action « écran de réponse vocale ». Je n'ai pas non plus vérifié si le micro a réellement changé de comportement, ni si la phrase d'état est bien lue à voix haute, ni si le microphone se fermait depuis le bandeau. Ce point reste donc **une lecture d'état statique**, pas un comportement vérifié.

L'image suggère que l'agent vocal est bien visible dans les deux écrans. Ce qui change, c'est surtout **ce qui l'entoure** : en accueil, il occupe l'immense part du centre ; dans l'espace de travail, il reste au centre, entouré par des métadonnées et un rail, ce qui peut finir par éclater la scène.

---

## 5. Incohérences de navigation, problèmes d'espacement, défauts de responsive design

### Incohérences probables (images + comparaison avec v12.0.0)
- Navigation par rail dock au lieu de constellation temporaire. Ce n'est pas un bug graphique dans l'image, mais un écart de modèle.
- Utilisation de deux entêtes d'état en haut : doublon d'information, probable sur-fragmentation de l'information.
- L'écran gauche semble ancré sur la mise en page, l'écran droit ajoute beaucoup de choses « en haut », « en bas gauche » et « en bas droite ». La densité visuelle n'est pas incrémentale entre les deux : c'est une rupture de débit visuel.

### Espacement / hiérarchie
- La position du dock en bas capte l'attention, mais en même temps, tous les infos secondaires (métadonnées, categories, repères) reposent autour. Sur la capture, la hiérarchie visuelle n'est pas encore bien tranchée entre « heading principal » et « métadonnées contextuelles ».
- La proximité des éléments d'état en haut est visiblement serrée et peut générer du brouillard de lecture.

### Responsive
- J'ai pas mesuré les dimensions (pas d'outil DOM ici). Mais la composition centre une sphère qui peut masquer le contenu sous-jacent et grise le reste. Sur une fenêtre plus étroite, cette sphère risque d'entrer en collision avec les métadonnées, ou pire, avec le dock si la sphère reste centrée et que l'espace se réduit.
- Aucun signal visible de repli réactif dans l'image : ni test de cervicalisation, ni preuve que la constellation dissimule bien pour laisser la place.

---

## 6. Écarts par rapport à la specification UI/UX d'Aven

Vu les fichiers source de référence et les captures, voici les écarts les plus visibles :

**Écart fort (navigation)** : la navigation n'est pas une constellation temporaire à cinq cercles, mais un rail/dock permanent. C'est l'écart le plus évident par rapport à v12.0.0, où la vérification exige l'absence de rail et dock.

**Écart fort (information)** : présence d'un double statut « AVEN / SYSTEM: IDLE » en haut, et de multiples blocs dans la section supérieure, ce qui dégrade la lisibilité et peut dépasser le principe de bruit minimal du côté utilisateur.

**Écart modéré (écosystème vocal)** : l'agent vocal semble passer d'un accueil occupé à un espace de travail où il coexiste avec un rail, un panneau et des métadonnées. C'est cohérent dans le principe, mais l'image suggère qu'en pratique, il partage l'espace centrale avec beaucoup de bruit.

**Écart modéré (état de version)** : selon l'image, l'écran indique V2.0.10 dans un bandeau, ce qui reproduit l'incohérence connue du moteur affiché comme version d'application.

**Écart à confirmer (éventuel rail de destination)** : l'image semble montrer des étiquettes de destination, éventuellement un fil ou navigation permanente, ce n'est pas une preuve mais c'est un point à vérifier.

---

## 7. Corrections recommandées

### Priorité 1 — cibler en premier, car ils dégradent la structure globale
- Supprimer ou condenser l'état vocal en un seul lieu/état lu, au lieu de deux blocs distincts « AVEN / SYSTEM ». Sélectionner un bandeau d'état unique au poste, correctement structuré.
- Retirer la copie / doublon du statut et unifier l'affichage du statut vocal pour que l'état lisible unique corresponde à l'action réelle (écoute, capture, réponse, erreur…).
- Rétablir le trait de l'accentuation en cohérence, non pas comme symbole du rail, mais comme **état unique de navigation**.

### Priorité 2 — lisibilité et densité visuelle
- Parer les annotations flottantes du sphère (points, repères orthodromiques) : déduire les éléments qui veulent être décoratifs mais deviennent du bruit.
- Réduire la saturation des blocs de métadonnées qui n'apportent rien de différent : "AVEN CORE: ACTIVE" + "AVEN: ACTIVE" ressemblent à un doublon.
- Fournir une bonne lisibilité sur les menus d'historique : renommer les items en français lisible, éviter les pseudonymisations mystérieuses.

### Priorité 3 — navigation et responsive
- Remplacer le rail/dock de navigation par la constellation temporaire à cinq cercles (poignée + arc + cercles indépendants). Idéalement, identifier d'où vient le rail dans le code actuel pour savoir s'il faut le retirer ou le neutraliser.
- S'assurer que la sphère ne bloque pas la coordination avec le dock/panneau : en responsive, la sphère peut être réduite, repliée en en-tête (comme prévu par v12.0.0) ou réduite dans l'espace de travail.

---

## Fichiers sources concernés et corrections à apporter

**Composants UI/Poste**
- `web/src/workbench/WorkbenchShell.tsx`
- `web/src/workbench/HomeStage.tsx`
- `web/src/workbench/NavigationConstellation.tsx`
- `web/src/workbench/WorkbenchShell.tsx` (bandeau d'état, gestion des destinations)
- `web/src/workbench/tabs.ts`
- `web/src/workbench/constellation.ts`
- `web/src/app/AppShell.tsx`
- `web/src/app/use-aven-app.ts`

**Agent vocal / état**
- `web/src/agent/WireframeAgent.tsx`
- `web/src/agent/sphere.ts`
- `web/src/voice-agent/use-voice-agent.ts`
- `web/src/voice-agent/session.ts`
- `web/src/voice-agent/barge-in.ts`
- `web/src/voice-agent/echo.ts`
- `web/src/voice-agent/vad.ts`
- `web/src/voice-agent/intro.ts` (si intro/presentation visible)

**Styles**
- `web/src/styles/workbench.css`
- `web/src/styles/da.css`
- `web/src/styles/chrome.css`
- `web/src/styles/motion.css`
- `web/src/styles/pages.css`
- `web/src/App.css` (manifeste des imports)
- `web/src/styles/voice-notes.css`
- `web/src/styles/dialogs.css`
- `web/src/styles/base.css`

**Pages concernées (liste, métadonnées, vue avec navigation)**
- `web/src/pages/HomePage.tsx`
- `web/src/pages/ConversationPage.tsx` (liste « Recent conversations »)
- `web/src/pages/NotesView.tsx`
- `web/src/pages/FilesView.tsx`
- `web/src/pages/SettingsDialog.tsx`
- `web/src/InstrumentFrame.tsx`

**Types et API**
- `web/src/types.ts`
- `web/src/api.ts` / `web/src/api-tauri.ts`
- `web/src/app/constants.ts`

**Checks / sondes à inclure si l'écran est confirmé**
- `scripts/verify-v12.0.0.mjs`
- `scripts/verify-v11.0.0.mjs`
- `scripts/verify-v11.5.3.mjs`
- `scripts/verify-v11.1.0.mjs`
- `scripts/verify-v11.12.0.mjs`
- `scripts/verify-v11.1.1.mjs`

**Modèles de test les plus probables**
- `tests/constellation.test.mjs`
- `tests/wireframe-agent.test.mjs`
- `tests/wireframe-agent.test.mjs` (géométrie et state)
- `tests/arrow-navigation.test.mjs`
- `tests/view-transitions.test.mjs`
- `tests/voice-agent-session.test.mjs`

**Correctifs à apporter (constats de cette audit, avant la finition v12)**
- Supprimer/réduire le double bloc d'état vocal.
- Résoudre la superposition de métadonnées en haut à gauche / droite.
- Nettoyer les annotations de repères sur l'agent sphérique (peut-être les déplacer ou les supprimer).
- Remplir les lacunes de lisibilité dans la liste d'historique (si elle appartient bien à l'écran-boutique).

> **Suites (2026-10-29)** : ces constats portent sur des captures v11.0.0. La refonte
> v12 a retiré la télémétrie décorative, le second bloc d'état et les annotations de
> la sphère ; l'historique des conversations est désormais visible par défaut. Les
> preuves d'exécution sont consignées dans
> `docs/audits/2026-10-29-refonte-poste-agent.md` (section « Finition du 2026-10-29 »).

**Observations sans validation**
- Tout ce qui concerne le comportement interactif réel de la constellation et de l'agent vocal (transitions, focus, capture, réponse vocale, etc.) n'est **pas vérifié ici** et demeure à tester dans une session sur l'app Tauri.
- La correction précise du rail Android n'est pas encore tracée dans un fichier source précis ; identifier le point d'origine est un préalable pour corriger.

---

Cette version a été écrite à partir de la demande de l'utilisateur ("analyse visuellement les captures d'écran d'Aven") et du routage existant des composants, sans modification de code ni exécution serveur.
