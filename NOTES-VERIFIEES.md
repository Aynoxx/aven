# Faits vérifiés sur OpenCode 2.0.10 (à ne pas « corriger » de mémoire)

- Paquets : `@opencode/client` et `@opencode/cli` (scope **@opencode**, sans « -ai »), versions exactes identiques.
  `@opencode-ai/client@next` = pré-version périmée (0.0.0-next-17444).
- Version du serveur : `client.server.info()` (route `GET /api/info`). **`client.health` n'existe pas**, `/api/health` → 404,
  `/global/health` → page HTML (route de la V1).
- CLI : `opencode debug agents` existe ; `opencode agent list` n'existe pas. `opencode api` / `debug` visent le service d'arrière-plan
  sauf `--server URL`.
- Les agents se chargent **en tâche de fond** : la liste est vide au début → toujours attendre (voir `waitUntilReady`).
- Fin de tour : `session.execution.succeeded | failed | interrupted` **de la session principale** (pas `session.idle`, jamais vu ;
  la fin d'un sous-agent n'est pas la fin du tour).
- Événements utiles : `session.text.delta` (assistantMessageID, delta), `session.tool.input.started` (id, name),
  `session.tool.success|failed`, `permission.asked` (id, sessionID, action, resources), `permission.replied` (requestID),
  `session.created` (parentID → sessions de sous-agents).
- Une permission peut venir d'un **sous-agent** : répondre avec le `sessionID` de la demande, pas celui de la conversation ouverte.
- Outils vus côté modèle : edit, glob, grep, question, read, shell, skill, subagent, webfetch, websearch, write, execute.
  L'outil `question` crée un **formulaire** : `form.created` (data.form = {id, sessionID, title, fields[]}, sessionID absent à la racine),
  réponse par `client.session.form.reply({sessionID, formID, answer:{[field.key]: valeur}})` ; le modèle reçoit « User has answered… ».
  Sans règle `question: allow` dans l'agent, une `permission.asked` (action `question`) précède le formulaire.
- Agents V2 : `permissions:` liste `{action, resource, effect}`, la dernière règle correspondante gagne ; `bash`→`shell`, `task`→`subagent`.
- Modèles : `openrouter/<id OpenRouter>` (clé `OPENROUTER_API_KEY` dans l'environnement du **serveur**) ; `opencode models` liste les
  modèles gratuits `opencode/…-free`. La variante gratuite de DeepSeek V4 Flash n'existe plus sur OpenRouter (404).
- Sous Windows : un `.cmd` (shim npm) ne se lance pas avec `spawn` sans shell ; le CLI embarqué (`bin/opencode.exe`) évite le problème.
  Avec un shell, `child.kill()` ne tue pas le serveur : utiliser `taskkill /T /F` (fait dans `killTree`).

## Modèles et fournisseurs (vérifié sur 2.0.10)
- Chaque variable active son fournisseur, testée une par une : `GOOGLE_GENERATIVE_AI_API_KEY` (ou `GEMINI_API_KEY`) → `google`,
  `GROQ_API_KEY` → `groq`, `CEREBRAS_API_KEY` → `cerebras`, `MISTRAL_API_KEY` → `mistral`, `OPENROUTER_API_KEY` → `openrouter`.
  `opencode/…-free` (Zen) n'a pas besoin de clé. `client.model.list()` ne renvoie que les modèles des fournisseurs activés.
- Référence de modèle = `fournisseur/modèle`, le modèle pouvant contenir des « / » : on coupe au PREMIER « / » (`groq/openai/gpt-oss-120b`).
- Chaque requête au modèle = un événement `session.step.started` dont `data.model` donne le modèle (sert de compteur).
  Une erreur 429 provoque d'abord ~10 `session.retry.scheduled` (≈ 1 min 30) avant `session.execution.failed` : le routeur bascule dès le 1er
  signal (`session.interrupt` + `switchModel` + nouveau `prompt`). `error.status` et `error.message` permettent de classer l'erreur.
- `session.create({ model: { providerID, id } })` est respecté (vérifié : le serveur de modèle reçoit bien ce modèle) ;
  `session.switchModel({ sessionID, model })` prend effet au message suivant. Sans modèle, la session utilise celui de `opencode.jsonc`.
- Le catalogue vient de models.dev, chargé au démarrage : il peut différer de celui testé ici. L'app filtre donc à l'exécution.
- Limites des offres gratuites (Gemini, Groq, OpenRouter…) : à revérifier chez les fournisseurs, elles changent souvent.

- v8.7.4 : catalogue agentique strictement gratuit ; les modèles payants sont filtrés à la lecture et ne peuvent plus être utilisés par le routeur. Le fallback vocal OpenAI payant est supprimé.
- v8.7.6 : les nouveaux modèles gratuits autorisés sont découverts depuis `client.model.list()` puis ajoutés aux chaînes si leur référence est explicitement reconnue comme gratuite. Le backend Freebuff/Codebuff est séparé de ce catalogue et la clé `CODEBUFF_API_KEY` n’est pas injectée dans l’environnement OpenCode.
