# Vérification v8.8.0 — Routage d'intention de la dictée vocale

Date : 25 septembre 2026 · branche de travail unique, non versionné (choix utilisateur)

## Ce qui a été ajouté

**Problème** : « ouvre une note » dicté partait comme texte vers l'agent de code, et aucune dictée ne changeait d'agent.

**Solution** : 3ᵉ passe de classification d'intention (Groq gratuit, `openai/gpt-oss-20b`, temp 0, max_tokens 60, timeout 6 s) exécutée **en parallèle** du reformage — latence de dictée inchangée.

1. **`electron/voice-intent.ts`** (nouveau) : `classifyIntent()` + `intentOfCompletion()`.
   - Liste **fermée** : 5 commandes app (`open-notes`, `open-settings`, `open-agents`, `open-projects`, `open-workspace`) et 3 agents (`code`, `recherche`, `analyse`) ; toute autre valeur est rejetée (anti-hallucination).
   - **Anti-injection** : le verdict vient de la structure de la réponse du classifieur, jamais du contenu dicté (testé).
   - Routage d'agent **sémantique** : descriptions par agent injectées dans le prompt (pas de mots-clés littéraux).
2. **`electron/voice.ts`** : `transcribeSpeech` lance reformage et classification via `Promise.allSettled` ; `DictationResult.intent` absent si la passe échoue (dégradation gracieuse, dictée jamais bloquante) ; `AVEN_VOICE_INTENT_MODEL` surchargeable.
3. **`electron/main.ts`** : log `[dictée] … intention: app:open-notes | agent:recherche | chat | absente`.
4. **`web/src/types.ts`** : miroir `DictationIntent` (contrat IPC inchangé, même canal `voice:transcribe`).
5. **`web/src/App.tsx`** (`onText`) :
   - `intent === "app"` → exécution **directe** via `routeAppAction()` (mêmes handlers que le hub) ; le texte ne va **pas** au composeur ; confirmation dans le journal des événements de routage.
   - `intent === "agent"` avec cible connue → `selectAgent(target)` ; la conversation suit via `loadChats`/auto-création existants ; texte prérempli dans le composeur du bon agent.
   - `chat` / intention absente → comportement v8.7.9 (agent courant).
   - **L'envoi au modèle exige toujours Entrée** — rien n'est envoyé automatiquement.

## Résultats

| Contrôle | Résultat |
|---|---|
| `npm test` | **46/46** (31 existants + 15 nouveaux `tests/voice-intent.test.mjs`) |
| `npm run typecheck:electron` | 0 erreur |
| `cd web && npm run build` (inclut `tsc -b`) | ✓ 3,8 s |
| `npm run build:electron` | ✓ |
| `npm run verify` (v8.8.0 + build) | OK — 19 modules, 17 sondes de contenu |

## Garde-fous vérifiés par les tests

- Action ou catégorie hallucinée (`delete-everything`, `musique`) → rejetée.
- Texte dicté imitant un ordre JSON → classifié `chat`, jamais exécuté.
- 429/échec du classifieur → texte conservé, `intent` absent, warning de la seule passe en échec.
- Échec de transcription → aucune passe texte lancée (1 seul appel réseau constaté).

## Hors périmètre (phases suivantes)

Phase 2 : désambiguïsation parlée (« ouvre une note » → laquelle ?), nouvelles commandes (`new-note`, `new-conversation`). Phase 3 : contexte court (« et ouvre-la »). Design complet : conversation du 25/09/2026.
