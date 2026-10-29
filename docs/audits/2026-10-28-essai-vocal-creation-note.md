# Essai vocal réel — création de note (2026-10-28)

## Méthode

- Binaire de debug `src-tauri/target/debug/aven.exe`, webview WebView2 et serveur
  Vite local (le binaire de debug charge `devUrl`).
- **Micro simulé** : WAV français 16 kHz mono (Microsoft Hortense, SSML) joué par
  `--use-file-for-fake-audio-capture` de WebView2, avec
  `--use-fake-ui-for-media-stream`. Le chemin `getUserMedia` → VAD →
  `MediaRecorder` → Groq Whisper est donc réel, le microphone physique ne l'est pas.
- **Clé Groq réelle** (déjà chiffrée dans `%APPDATA%/Aven/settings.json`), moteur
  **Pocket TTS réel** (voix clonée `aven.safetensors`), aucune clé ni audio dans
  ce dépôt.
- Phrase : « Aven, note que le micro et le moteur fonctionnent. », puis « Oui. »
  après la question de confirmation.

## Mesures

| Moment | Avant le correctif (17:47–17:55) | Après (18:03–18:04) |
|---|---|---|
| Préférence `micMuted: true` | micro **ouvert** malgré le choix ; l'état affiche « Écoute », et le premier clic coupe le micro | état initial « Micro coupé », aucun segment capturé ; le clic active |
| Rétablissement `micMuted: false` | non mesuré | « Écoute » sans clic, note créée |
| Moteur Pocket | indisponible à chaque phrase (binaire de debug antérieur à `AVEN_POCKET_DIR`), repli Windows | démarre, voix clonée, aucune alerte |
| « Oui. » → note | 17:47:49 → 17:47:54 | 18:03:55 → 18:03:57 |

La première manche utilisait une phrase plus longue et une autre prosodie ; sa
transcription bruitée (« ra symbole copyright… ») n'est **pas** imputable au
correctif, et n'est donc pas comparée ici. Les journaux horodatés complets ont servi
à ces relevés ; les notes d'essai ont été supprimées après vérification.

## Frictions observées et corrigées

1. **Le micro s'ouvrait avant la lecture de la préférence** (`web/src/voice-agent/use-voice-agent.ts:105`) :
   l'état initial était « écoute », et `voiceAgentPrefs()` pouvait échouer ou arriver
   après le montage. Conséquence mesurée : avec `micMuted: true`, l'agent écoutait
   quand même, et le premier clic *coupait* le micro au lieu de l'activer. La session
   démarre maintenant coupée, lit la préférence quand le Poste est prêt, et un geste
   explicite (`micTouchedRef`, ligne 136) prime sur une réponse IPC tardive.
2. **Le repli Pocket répétait son remède** (`host/aven-app-host.ts:424`) :
   `streamPocketSpeech` habillait déjà le détail avec « prépare le modèle… », puis
   l'appelant l'habillait une seconde fois. Le détail est désormais nu, l'appelant
   ajoute le remède une seule fois (ligne 544).
3. **Le binaire de debug était périmé** : il ne posait pas `AVEN_POCKET_DIR` et
   Pocket était déclaré indisponible à chaque phrase. `cargo build` a suffi ; ce
   n'était pas un défaut du code applicatif.

## Contrôles

- `npm test` : 414 tests, 0 échec.
- `npm run typecheck:host`, `npm run typecheck:tests`, `npx tsc -b` (web) : verts.
- `npm run build:web`, `npm run build:host` : verts.
- `npm run verify` : vert (dont `verify-v11.15.1.mjs`).
- Deux parcours réels : préférence coupée puis activation manuelle ; préférence
  ouverte puis écoute automatique. Chaque parcours a créé une note, confirmée par
  un « oui » distinct.

## Limites

- Le microphone physique et l'acoustique de la pièce n'ont pas été mesurés : le
  WAV synthétique est plus propre qu'une voix réelle, et son timbre a déjà fait
  diverger Whisper sur une première phrase (« réel » → « ra symbole copyright »).
- Aucune mesure de la reprise de parole pendant une lecture réelle, ni de la
  latence réseau Groq au-delà des horodatages ci-dessus.
- Le moteur Pocket a été testé avec le profil cloné présent sur cette machine ; le
  premier téléchargement du modèle n'a pas été rejoué.

## v11.16.0 — la note se compose, elle ne se recopie pas (19:20–19:45)

Même harnais (`npm run test:voice-note`, micro remplacé par un WAV français dans
`getUserMedia`, STT et moteur Groq réels), mais la réponse à « Quel texte dois-je
noter ? » **décrit** le contenu : « La note doit contenir un résumé de comment
faire une boucle en Python. »

| Run | Question de confirmation (extrait) | Note écrite |
|---|---|---|
| avant aplatissement | les marqueurs Markdown et l'ouverture d'un bloc python lus tels quels (« ### », « ** », trois accents graves) | résumé complet (for, while, indentation, break/continue) |
| après `spokenDraft` | prose seule : « Pour créer une boucle en Python, utilisez les structures for ou while. Boucle for variable : nom choisi… » | résumé complet, Markdown intact |

Mesuré : la note ne contient **pas** la demande (assertion du harnais), le corps
porte `for`, `while`, `enumerate`, `break`/`continue` et des exemples ; la
confirmation relit 180 caractères de prose, plus aucun marqueur Markdown ni ligne
de code.

Contrôles de la version : `npm test` (421 tests, 0 échec), `npm run typecheck:host`,
`npm run typecheck:tests`, `npx tsc -b` (web), `npm run build`, `npm run verify`
(dont `verify-v11.16.0.mjs`) — tous verts, plus deux passes réelles du harnais.

Limites : le titre de la note reste dérivé des 60 premiers caractères du contenu
(une note composée commence souvent par un `#` ajouté par le modèle, que le
nettoyage ne retire pas) ; les blocs de code sont retirés de la **lecture**, pas du
corps de la note ; aucun micro physique mesuré.
