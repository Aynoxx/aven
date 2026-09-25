# v8.1 — Assistant vocal Live + intégration agents

Le mode vocal utilise Gemini Live par défaut. Une clé Google AI Studio suffit. OpenAI Realtime est désactivé afin de maintenir Aven en mode strictement gratuit.

**Correction v7.1 :** les jetons éphémères Gemini doivent utiliser le WebSocket `BidiGenerateContentConstrained` avec `access_token` (et non `BidiGenerateContent`). Le jeton `auth_tokens/...` est transmis tel quel dans l’URL. La session attend désormais explicitement `setupComplete` avant d’activer le microphone, avec timeout et diagnostics de fermeture.

## Chaîne vocale

Micro → PCM 16 kHz → WebSocket Gemini Live (jeton éphémère) → audio PCM 24 kHz + transcriptions → lecture locale.

Gemini Live gère la VAD automatiquement, les interruptions et l’audio natif. Les fonctions d’application passent par `run_app_command` puis par `AssistantController`, de sorte que les confirmations métier restent inchangées.

## Sécurité

La clé Google reste dans le processus Electron. Le renderer reçoit uniquement un jeton éphémère à usage unique pour la session Live. Le jeton est créé côté Electron à partir de `GOOGLE_GENERATIVE_AI_API_KEY`.

## Agents

OpenRouter Free est ajouté comme fournisseur gratuit prioritaire via le routeur `openrouter/free`, à condition qu’une clé OpenRouter soit configurée. Les modèles payants ne sont plus chargés dans le routeur Aven.

## Pré-requis

- Vocal gratuit : une clé Google AI Studio dans **Paramètres → Configuration**.
- Agents gratuits : une clé OpenRouter dans **Paramètres → Configuration**.

Le niveau OpenRouter Free est actuellement limité à 50 requêtes/jour et 20 requêtes/minute. Gemini Live dispose actuellement d’un niveau sans frais, avec des limites dépendant du projet et du modèle. Google indique que le niveau sans frais peut être utilisé pour améliorer ses produits ; évite donc d’y envoyer des données sensibles/confidentielles.

## Correction v8.7.6 — jeton Gemini Live

Le endpoint REST `v1beta/auth_tokens` ne reçoit plus `liveConnectConstraints`. Aven crée maintenant un jeton éphémère minimal (`uses`, `expireTime`, `newSessionExpireTime`), puis transmet le modèle, l’audio, les instructions et les outils dans le premier message `setup` du WebSocket Gemini Live. Cela corrige l’erreur `Unknown name "liveConnectConstraints" at 'auth_token'`.
