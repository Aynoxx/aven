# Intégration Freebuff / Codebuff — Aven v8.7.6

Aven v8.7.6 ajoute un backend `Freebuff / Codebuff SDK` optionnel directement dans les conversations.

## Fonctionnement

- Le backend OpenCode existant reste inchangé et reste prioritaire par défaut.
- Un bouton `Freebuff` apparaît dans le composeur lorsque `CODEBUFF_API_KEY` est configurée.
- La commande `/freebuff <demande>` force ponctuellement le backend Freebuff.
- Les agents Aven `code`, `analyse` et `recherche` sont mappés respectivement vers `codebuff/base@latest`, `codebuff/thinker@latest` et `codebuff/researcher@latest`.
- Le `RunState` Codebuff est conservé localement pour permettre les tours suivants.
- L'historique Freebuff est stocké dans les données utilisateur d'Aven et fusionné au transcript de la conversation.
- Le bouton Arrêter envoie une annulation au run Freebuff via `AbortSignal` lorsque le SDK l'honore.

## Important : gratuité

Le client Freebuff officiel est gratuit et ad-supported, mais sa CLI actuelle n'expose pas de mode headless/programmatique permettant à Aven de piloter un run directement. Le SDK `@codebuff/sdk` officiel, lui, nécessite une clé API Codebuff. Aven n'essaie donc pas de réutiliser ou de contourner le jeton d'authentification du client Freebuff.

Conséquence : `Freebuff / Codebuff SDK` est un backend externe optionnel et peut consommer des crédits Codebuff. Il ne fait pas partie du catalogue de modèles gratuits Aven.

## Dépendances

- `@codebuff/sdk` 0.10.7
- Electron 35.4.0, qui embarque Node.js 22.15.0, nécessaire au SDK actuel.
