# Vérification Aven v8.4

## UI / accueil
- Police UI unique : `Inter` via `--font-ui`, sans autre famille de police dans l'UI.
- Échelle typographique centralisée : `xs / sm / md / lg / xl / 2xl`.
- Marque visible de l'application : **Aven**.
- Icône Paramètres du bandeau et icône Paramètres du hub utilisent le même composant `HubIcon -> Icon(settings)`.
- Accueil sans panneau latéral de navigation.
- Conversations récentes placées à gauche du hub sur desktop puis repliées sous le hub sur petites largeurs.
- Positions du hub : Agents gauche, Fichiers haut-gauche, Notes haut-droite, Paramètres bas-gauche, Projets bas-droite, assistant vocal au centre.
- Boutons d'interface harmonisés avec `.button` et `.button-icon`.
- Overlays/modales en `position: fixed` et fonds pilotés par les variables de thème.

## Agents / conversations
- Vue Agents autonome avec états chargement, erreur et vide.
- Ouverture d'un agent depuis le hub ou la vue Agents conserve une sélection d'agent cohérente.
- Protection contre les retours réseau tardifs lors du changement d'agent via `chatLoadSeq`.
- Conservation explicite d'une conversation ciblée lors d'un changement d'agent via `preferredChatIdRef`.
- Renommage d'agent et de conversation conservé.
- Retour Accueil et fermeture Échap gèrent correctement la vue Agents et les sélecteurs.
- Correctif du layout lorsqu'un panneau latéral est masqué : `.sidebar-hidden .workspace-layout` ne réserve plus la colonne de sidebar.

## Icônes
- Bibliothèque centralisée : `web/src/icons/Icon.tsx` et `web/src/icons/index.ts`.
- Les usages `Icon` du renderer pointent uniquement vers des noms enregistrés.

## Validation statique
- Parsing TypeScript / TSX / CTS / MTS : 0 diagnostic.
- Parsing CSS PostCSS : OK.
- Accolades CSS : équilibrées.
- JSON : `package.json`, `web/package.json`, `model-priorities.json` valides.
- Version du produit : `8.4.0`.
- Produit Electron : `Aven`.

## Limite de validation
Le dépôt source de l'archive ne contient pas les dépendances `node_modules`. Le build npm/Electron complet n'est donc pas déclaré exécuté dans cet environnement ; la validation ci-dessus couvre le parsing, la structure, les contrats présents dans le code et les régressions ciblées.
