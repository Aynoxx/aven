# Audit — la lecture de la voix Pocket se coupait avant la fin (2026-10-28)

Périmètre : la lecture du flux PCM de la voix locale Pocket TTS (voix par défaut
depuis v11.10.0, y compris la voix clonée) dans la webview réelle de l'app Tauri.
Symptôme rapporté : « la parole de l'agent se coupe encore avant d'avoir fini ».

## Méthode

Trois mesures indépendantes, toutes sur le host ou la webview **réels** — aucune
n'est une déduction de lecture :

1. **Durée livrée par le host** (`artifacts/measure-pocket-stream.mjs`) : le host
   réel (`dist-host/aven-app-host.mjs`, vraies préférences, `AVEN_POCKET_DIR`)
   synthétise **le même texte** par les deux chemins — diffusé
   (`voiceAgentSayStream`) et complet (`voiceAgentSay`), tous deux passant par la
   même mise en forme (`host/pcm-audio.ts`).

   | Chemin | Audio livré | Mesure |
   |---|---|---|
   | Flux PCM | **17,30 s** (26 paquets, 830 400 octets) | 1ʳᵉ trame à 2 283 ms, `end` à 12 178 ms |
   | WAV complet | **17,48 s** | appel rendu à 11 555 ms |

   Écart : **0,18 s**, soit la variabilité de la synthèse d'une prise à l'autre.
   Le host livre donc l'intégralité de la phrase ; la coupe n'est pas chez lui.

2. **Ce que la webview programme** (`artifacts/measure-pcm-long.mjs`) : le binaire
   de développement est lancé avec un port CDP, `AudioBufferSourceNode.start/stop`
   sont instrumentés, puis une vraie demande est injectée par la passerelle DEV
   (`__avenVoice.simulate`, présente seulement en développement). Le texte est une
   **confirmation de note** volontairement longue — c'est du chemin réel : le
   renderer demande `voiceAgentSayStream`, le host renvoie le PCM, le lecteur
   `web/src/voice-agent/pcm-stream.ts` l'empile dans un `AudioContext`.

3. **Un micro factice** (`artifacts/measure-pcm-playback.mjs`) : l'app est lancée
   avec un WAV de phrase en guise de microphone (flags Chromium
   `--use-fake-device-for-media-stream --use-file-for-fake-audio-capture`), ce qui
   fait tourner la chaîne complète VAD → STT → LLM → synthèse → lecture sans que
   personne parle. Utilisé pour vérifier qu'aucun `stop()` n'est appelé pendant la
   lecture (aucun arrêt enregistré, pile d'appel comprise).

## Résultat avant correctif

Réponse prononcée : « Je note : « je dois acheter du pain, du lait, des œufs, de la
farine, du beurre, du sucre, du chocolat, des pommes et du fromage ». Je
l'enregistre ? » — environ **8 à 9 s** de parole.

| Mesure | Valeur |
|---|---|
| Paquets programmés | **2** |
| Audio réellement programmé | **1,07 s** |
| Arrêts (`stop`) | **0** |
| Phase à la fin | « Écoute » (lecture rendue) |

La lecture rendait donc la main après ~1 s alors que 7 s de parole n'avaient jamais
été jouées. Deux défauts, au même endroit (`web/src/voice-agent/pcm-stream.ts`) :

1. **seul le premier lot était programmé** — après le démarrage, un paquet reçu
   restait dans `pending` jusqu'à la fin du flux ;
2. **la fin du flux jetait ce reliquat** — `maybeFinish()` ne regardait que les
   nœuds en cours : le premier lot ayant déjà fini de jouer, il n'y avait plus
   aucun nœud, donc `settle(true)` fermait le lecteur (et son nettoyage) avec tout
   l'audio encore en attente.

Le chemin Edge (`stream.ts`) n'est pas touché : chaque trame y part dans un
`SourceBuffer` dès son arrivée, et `endOfStream()` attend que la file soit vidée.

## Résultat après correctif

Même commande, même texte, même instrument :

| Mesure | Avant | Après |
|---|---|---|
| Paquets programmés | 2 | **9** |
| Audio programmé | 1,07 s | **7,79 s** |
| Étendue sur l'horloge audio | 2,44 → 3,51 s | **2,50 → 10,69 s** |
| Lots programmés | 1 (à +2,4 s) | 5 (à +2,5 / +3,3 / +3,9 / +4,4 / +4,8 s) |
| Phase finale | « Écoute » à +6 s | « Écoute » à +12 s, audio terminé |

Les lots se suivent **bout à bout** : chaque `premierWhenS` vaut exactement la fin
du lot précédent (3,25 = 2,50 + 0,35 ; 5,17 = 3,25 + 1,92 ; 8,77 = 5,17 + 3,60 ;
9,41 = 8,77 + 0,64). Le seul écart interne est une pause de 400 ms entre deux mots,
que le moteur prononce et que la mise en forme conserve (elle ne ramène que les
pauses de plus de 650 ms). Aucun arrêt, aucun trou : la phrase va jusqu'au bout.

## Ce qui n'a pas été mesuré

- **L'écoute subjective** : je n'ai pas d'oreille dans cette machine. Les chiffres
  ci-dessus prouvent que l'audio programmé correspond à ce que le host a livré ;
  ils ne prouvent pas que le timbre ou le débit te conviennent.
- **Le démarrage à froid** du moteur (chargement du profil cloné, 209 Mo au premier
  usage) : la mesure a été faite moteur déjà chaud.
- **Le chemin Edge** n'a pas été re-mesuré ici : il n'a pas été modifié (le défaut
  était propre au PCM), mais rien ne prouve qu'il soit exempt d'un autre défaut.
