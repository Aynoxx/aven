# Corrections UI — démarrage / personnalisation / hub central

## 1. Démarrage maximisé
La fenêtre Electron est désormais maximisée dès sa création. Cela conserve la barre de fenêtre personnalisée tout en utilisant toute la zone de travail disponible.

## 2. Paramètres dans la barre de fenêtre
Le bouton `Personnalisation` est désormais nommé `Paramètres` directement dans la barre de fenêtre. Il ouvre le panneau de réglages sans nécessiter de revenir à l'accueil.

## 3. Hub central proportionnel
Le hub d'accueil utilise maintenant un centre géométrique commun (`50% / 50%`) et un rayon adaptatif basé sur la taille de la fenêtre. Cinq actions sont réparties autour du cercle central : Agents, Fichiers, Notes, Projets et Configuration. Le bouton circulaire central ouvre l'Assistant vocal.

## 4. Panneau Réglages réparé
Le panneau commun utilise désormais deux sections explicites, `Configuration` et `Apparence`, avec centrage, fond, bordure, champs, boutons, sélecteurs, interrupteurs, sliders et listes réordonnables correctement stylés. Le raccourci d'accueil `Projets` ouvre directement `Configuration` sur les espaces de travail.

## 5. Assistant vocal — robustesse
Les interruptions vocales volontaires (`stop`/`abort`) ne remontent plus comme des erreurs utilisateur. Un champ de commande texte reste disponible dans le panneau vocal lorsque la reconnaissance du microphone n'est pas utilisable.


## 7. Refonte complète de l’accueil — v8

Le shell d’accueil est repensé autour d’un hub central plus large et correctement espacé. Les cinq raccourcis (Agents, Fichiers, Notes, Projets, Paramètres) restent autour du bouton vocal sans chevaucher la zone des conversations récentes. La recherche d’accueil est séparée de la recherche des conversations pour éviter les effets de bord, et un sélecteur « Toutes les conversations » est disponible sans restaurer de panneau latéral sur l’accueil. Les contrôles utilisent une base de boutons harmonisée.

### Assistant vocal Live
Le vocal utilise désormais Gemini Live par défaut : audio bidirectionnel en temps réel, VAD, interruptions et réponse audio native. Le renderer reçoit un jeton éphémère créé par Electron ; la clé Google reste dans le processus principal. OpenAI Realtime n’est plus utilisé. La saisie texte reste disponible comme secours.

## 6. Refonte du hub d’accueil — v7.2

La navigation principale reste organisée autour d’un cercle et d’un bouton vocal central, mais les panneaux latéraux sont supprimés de la vue d’accueil. Une barre supérieure compacte regroupe identité, recherche/commande, agent actif, état et paramètres. Les conversations récentes sont déplacées dans une zone horizontale sous le hub. Les couleurs du hub réutilisent les variables de thème/accent afin de rester cohérentes en clair, sombre et avec un accent personnalisé.

## 8.0 — Passe qualité

L’accueil a été repris autour d’un hub réellement responsive : les cinq actions restent autour du centre sans chevauchement sur les tailles contrôlées, la zone Récents reste intégrée sans panneau latéral et les surfaces suivent directement le thème clair/sombre. Les boutons d’action partagent désormais la base `.button` autant que possible, avec des variantes explicites pour les contrôles spéciaux.

Une vérification responsive a été effectuée sur bureau, fenêtre compacte et mobile, avec tests clair/sombre et plusieurs accents. Les données du mode sombre utilisent des surfaces dédiées plutôt que des mélanges imbriqués pour éviter les rendus blancs inattendus dans Electron/Chromium.

## 8.1. Finitions
- Overlays de l’accueil couvrant toute la fenêtre.
- Overlays thématiques et cohérents avec clair/sombre.
- Icône Paramètres du header unifiée avec celle du hub.

## 8.2. v8.7.6 — Freebuff + Gemini Live
Le composeur peut basculer vers le backend Freebuff/Codebuff SDK avec conservation locale de l’historique et interruption. Le catalogue Aven reste strictement gratuit ; le backend Codebuff est séparé et optionnel.

Le jeton éphémère Gemini Live est désormais créé sans `liveConnectConstraints` dans le POST AuthToken. La configuration complète est envoyée après ouverture du WebSocket, ce qui élimine l’erreur de schéma `Unknown name "liveConnectConstraints" at 'auth_token'`.
