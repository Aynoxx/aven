# Vérification Aven v8.7.2

Date : 2026-09-24

## Problèmes traités

1. OpenRouter `401 User not found` : test de clé au démarrage ; si l'authentification est refusée, OpenRouter est retiré des modèles utilisables pour ce démarrage et l'erreur est affichée dans Paramètres. Le routeur applique aussi un cooldown au niveau du fournisseur pour éviter de réessayer le même compte sur plusieurs modèles OpenRouter.
2. Boucle `glob` : plugin local `.opencode/plugins/aven-tool-guard.js` chargé automatiquement par OpenCode. Trois appels `glob` identiques successifs sont bloqués ; huit appels `glob` en moins d'une minute sont également bloqués.
3. Gemini agentique : ajout de `google/gemini-3.7-flash` comme priorité agentique gratuite, devant `gemini-3.6-flash` lorsqu'il est disponible.
4. Prompts agents : consignes anti-répétition de `glob` ajoutées et budgets d'étapes légèrement réduits.

## Vérifications

- package version : `8.7.2`
- JSON `package.json` / `model-priorities.json` : OK
- JS plugin : `node --check` OK
- garde-fou + diagnostics provider : contrôles `scripts/verify-v8.7.2.mjs` OK
- analyse syntaxique TypeScript sans résolution de dépendances : aucun diagnostic de syntaxe sur les fichiers modifiés
- ancienne expression `new Blob([audio], ...)` : absente

## Limitation

Le build Electron/Web complet n'est pas déclaré validé ici : les dépendances du projet ne sont pas installées dans cet environnement. Un `npm install` complet est requis pour une validation de compilation finale.
