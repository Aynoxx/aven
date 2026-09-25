# Vérification v8.1

## Passe UI
- Hub central à 5 actions, sans panneau latéral sur l'accueil.
- Layout vérifié sur 1366×768, 1024×768, 800×700, 520×800 et 390×844.
- Aucun chevauchement carte/carte ou carte/centre sur les tailles contrôlées.
- Les conversations récentes restent séparées du hub et accessibles sur mobile.
- Clair, sombre et accents violet/émeraude/rose rendus avec les tokens de thème.
- Contrôles d'action harmonisés autour de `.button` et variantes explicites.

## Fonctionnalités ciblées
- Accès Agents, Fichiers, Notes, Projets et Paramètres conservé.
- `Tout voir` ouvre la liste complète des conversations.
- `Nouvelle conversation` depuis l'accueil ouvre bien la conversation créée.
- La barre de commande d'accueil est indépendante de la recherche de la vue conversation.
- Une commande d'accueil crée une conversation si nécessaire avant de transférer le texte au composeur.
- Les modales Agent/Conversations restent fermables par clic extérieur ou Échap.

## Corrections v8.1
- Overlays Agent/Conversations passés en `position: fixed` avec couverture viewport complète.
- Fonds des overlays rendus dépendants de `--bg` pour rester cohérents en thème clair/sombre.
- Icône Paramètres du header remplacée par le composant `HubIcon kind="settings"`, identique à celle du hub.

## Validation technique
- Parsing TypeScript/TSX/CTS/MTS : OK sur 32 fichiers.
- JSON : `package.json`, `web/package.json`, `model-priorities.json` OK.
- CSS : accolades équilibrées.
- Vérification responsive et thèmes via Chromium local avec attentes de transition.
- Les dépendances npm ne sont pas présentes dans l'archive source ; une tentative d'installation complète a dépassé le délai disponible. Le build Electron/Vite complet n'est donc pas déclaré comme exécuté dans cet environnement.
