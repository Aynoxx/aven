# Aven v8.7.3 — priorités des modèles

Les priorités ont été révisées le 24/09/2026 à partir des capacités documentées des fournisseurs et des données récentes d'usage/benchmarks disponibles.

- **Code** : priorité aux modèles de raisonnement/coding, puis aux modèles agentiques rapides, puis aux modèles de secours.
- **Analyse** : priorité aux modèles avec raisonnement fort, puis aux modèles généralistes rapides.
- **Recherche** : priorité aux modèles généralistes/agentiques avec bon comportement multi-étapes, puis aux modèles de secours.
- **OpenRouter Free automatique** est volontairement en dernier secours afin d'éviter qu'un routeur opaque ne choisisse un modèle inadapté ou indisponible.
- Les quotas, clés valides et indisponibilités restent prioritaires sur la table.

La table reste volontairement modifiable dans `model-priorities.json`.
