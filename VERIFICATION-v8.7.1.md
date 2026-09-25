# Aven v8.7.1 — correctif agents

## Problème corrigé
Le routeur filtrait les modèles avec `status === "active"`. La documentation OpenCode actuelle décrit la sélection via des modèles activés et précise que `status: "deprecated"` correspond au retrait d’un modèle ; un filtrage strict sur `status === "active"` pouvait donc vider la liste des modèles utilisables. La session OpenCode conserve par ailleurs son modèle séparément de l’agent sélectionné.

## Correctifs
- Détection des modèles : `enabled !== false`, `disabled !== true`, `status !== "deprecated"`.
- Création de conversation : sélection obligatoire d’un modèle depuis la chaîne de priorité de l’agent.
- Relecture immédiate de la session après `session.create()` pour récupérer le modèle effectivement enregistré.
- Refus explicite d’une session sans modèle au lieu d’une attribution silencieuse par OpenCode.
- Libellé UI remplacé par `Modèle de priorité` / `Aucun modèle assigné`.
- Garde-fou sur l’identifiant d’agent dans le routeur.
- Texte des paramètres clarifié : la priorité est automatique, mais la session reçoit bien un modèle explicite.

## Vérifications
- `scripts/verify-v8.7.mjs` : 22/22 contrôles OK.
- 33 fichiers TS/TSX/CTS/MTS parsés sans erreur syntaxique.
- CSS équilibré : 525/525 accolades.
- Archive ZIP vérifiée après génération.
