# v12.8.0 — rapprochement des notes avec Kortex

Date : 2026-10-31.

## Référence et périmètre

Comparaison avec Kortex.co, dont le site officiel annonce une transition vers Eden.
La cible de ce changement est l'organisation d'une bibliothèque de connaissances,
pas la reproduction d'une interface propriétaire.

## Changements réalisés

- **Étiquettes libres** : nouvelle métadonnée indépendante des tags d'agents. Les
  étiquettes sont normalisées, persistées par espace, chargées en lot, filtrables et
  indexées par la recherche.
- **Recherche étendue** : indexe le titre, le corps Markdown, les tags d'agents,
  les étiquettes et le texte des highlights.
- **Highlights** : capture du texte sélectionné dans une note, citation bornée,
  titre et chemin source conservés. La bibliothèque permet d'ouvrir la note source
  et de supprimer un extrait. Les highlights suivent les déplacements, renommages,
  archivages, mises à la poubelle, restaurations et purges de leur note.
- **Modèles Markdown** : six points de départ modifiables (idée, réunion, recherche,
  journal, projet et plan de contenu). Ils génèrent des fichiers Markdown ordinaires.
- **Organisation** : commandes de renommage et de mise à la poubelle sur les dossiers,
  filtres indépendants « Étiquettes » et « Agents », et mode concentration.
- Les notes restent des fichiers Markdown locaux ; les métadonnées restent dans
  le fichier de métadonnées de l'espace et sont écrites atomiquement.

## Écarts non implémentés

- Import et extraction de highlights à partir de PDF, livres, articles et pages web.
- Connexion Readwise et synchronisation de sources externes.
- Assistant IA contextuel qui consulte plusieurs notes et leurs extraits en mode
  conversationnel directement dans l'espace Notes. Aven conserve les actions
  existantes « Joindre » et « Demander une synthèse » vers l'agent.
- Éléments/modèles créés, modifiés et partagés par l'utilisateur ; les six modèles
  actuels sont intégrés et non un catalogue personnalisable.
- Partage collaboratif et édition multi-utilisateur.

Ces points exigent des contrats de données, des imports et des flux de permission
supplémentaires. Ils ne sont pas simulés par de simples liens ou boutons.

## Validation

- Nouvelle sonde : `scripts/verify-v12.8.0.mjs`.
- Tests dédiés aux étiquettes, à la recherche enrichie, aux highlights et aux modèles.
- Le présent audit ne revendique pas une compilation Tauri ou une capture visuelle :
  celles-ci doivent être confirmées par la CI et un lancement réel de l'application.
