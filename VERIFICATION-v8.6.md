# Vérification Aven v8.6

## UI
- Hub central agrandi avec positions proportionnelles : Notes en haut, Fichiers/Agents en haut-gauche/haut-droite, Paramètres/Projets en bas-gauche/bas-droite.
- Icônes de la bibliothèque agrandies de 25 % via le registre centralisé.
- Bouton vocal central enrichi : anneau conique, pulsation, halo et micro animé.
- Marque Aven : une seule étoile.

## Vocal Gemini Live
- Correction critique : attente de l’ouverture du WebSocket avant l’envoi du message `setup`.
- Timeout distinct de connexion et de négociation.
- Messages d’erreur plus explicites.
- Réponses d’outils Live avec `scheduling: INTERRUPT` pour les fonctions non bloquantes.
- Jeton éphémère utilisé avec `BidiGenerateContentConstrained` et `access_token`, conformément à l’API Live actuelle.

## Vérifications statiques
- TypeScript/TSX : transpilation syntaxique de tous les fichiers sources.
- CSS : accolades équilibrées.
- Icon registry : icône sparkle à une seule étoile.
- Archive ZIP : racine `Aven/`.
