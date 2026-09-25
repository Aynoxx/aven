# Aven v8.7 — vérification

## Fonctionnalités demandées
- Hub circulaire : centres des 5 cartes placés sur un rayon commun avec 5 angles espacés de 72°.
- Notes : la fermeture du panneau ramène systématiquement à l’accueil, y compris via Échap et l’action vocale `close-notes`.

## Robustesse v8.7
- Chargements de conversations protégés contre les réponses réseau obsolètes.
- Création automatique des conversations sérialisée par agent.
- Démarrages/arrêts Electron sérialisés avec génération de boot.
- Écriture des métadonnées persistantes atomique (temporaire + remplacement).
- Router : aucun modèle en cooldown n’est sélectionné ; nettoyage des sessions terminées.
- Lecture des transcripts de sous-agents parallélisée avec concurrence limitée.
- Vocal Gemini : connexion attend explicitement l’ouverture WebSocket puis `setupComplete`, capture via AudioWorklet avec fallback, fermeture complète des ressources.

## Contrôles exécutés
- 36 fichiers TypeScript/TSX/CTS/MTS parsés avec TypeScript 5.8.3 : 0 erreur de syntaxe.
- 18 contrôles automatisés : 18/18 OK (`npm run verify:v8.7`).
- CSS : accolades équilibrées (525/525).
- Test mathématique du pentagone : 5 distances adjacentes identiques.
- Archive : structure racine `Aven/`, validation ZIP OK.

## Limitation
Le build Electron complet dépend des paquets npm non embarqués dans l’archive. L’installation complète a dépassé le délai de l’environnement de vérification ; aucune prétention de build complet n’est faite sur cette base.
