# Audit — latence de l'agent vocal, de la fin de phrase au premier son (2026-10-26)

Périmètre : l'agent vocal d'Aven v11.5.1, mesuré sur la machine de l'utilisateur
(Windows, réseau résidentiel). Aucune fenêtre Tauri n'a été ouverte : le chemin
mesuré va du fichier audio déjà prononcé au retour de la synthèse, via le host
réel (`dist-host/aven-app-host.mjs`) et ses vraies clés (DPAPI).

## Méthode

1. Dix phrases françaises courtes synthétisées en WAV par la voix Windows
   Hortense (PowerShell `System.Speech`), une par fichier —
   `C:\tmp\latence-voix\p1.wav` … `p10.wav`.
2. Pour chaque fichier, trois appels JSON-RPC au host, chronométrés
   séparément :
   - `voiceAgentTranscribe` (Groq, `whisper-large-v3-turbo`) → texte entendu ;
   - `voiceAgentAsk` (`openai/gpt-oss-20b`, outils de lecture) → réponse ;
   - `voiceAgentSay` (voix configurée : Edge Denise, repli Piper/Windows) → audio.
3. Total « fin de phrase → premier son » = **700 ms** (silence de fin du VAD,
   `web/src/voice-agent/vad.ts`) + STT + LLM + TTS.

Le total est une **composition mesurée**, pas une capture micro : la capture
WebView2, la sérialisation du blob dans l'IPC et le décodage MP3 au démarrage de
la lecture ne sont pas chronométrés (voir §5).

## Résultat brut

| # | Texte entendu | STT | LLM | TTS | Total | Moteur |
|---|---|---|---|---|---|---|
| 1 | Quelle est la capitale de l'Italie ? | 4 013 | 1 415 | 947 | **7 076** | Edge |
| 2 | …ce qu'est une variable en programmation | 1 254 | 2 316 | 1 288 | **5 559** | Edge |
| 3 | …trois idées de noms pour un projet de notes | 1 419 | 1 232 | 2 152 | **5 503** | Edge |
| 4 | Qu'est-ce que le protocole HTTP ? | 1 318 | 1 432 | 2 618 | **6 068** | Edge |
| 5 | …ce qu'est un test unitaire | 1 462 | 1 328 | 2 865 | **6 354** | Edge |
| 6 | Combien font 17 plus 25 ? | 1 430 | 1 425 | 717 | **4 272** | Edge |
| 7 | 2 avantages d'un fichier Markdown | 1 182 | 1 234 | 978 | **4 093** | Edge |
| 8 | Que signifie l'acronyme **GSON** ? *(JSON mal entendu)* | 1 482 | 1 594 | 2 139 | **5 915** | Edge |
| 9 | …différence entre une liste et un dictionnaire | 1 364 | 2 459 | 14 224 | 18 747 | **SAPI (429)** |
| 10 | Quel est le rôle d'un serveur web ? | 1 328 | 1 434 | 15 033 | 18 495 | **SAPI (429)** |

Les colonnes 9–10 ne mesurent pas la même chose : en repli Windows, le host
parle *lui-même* et l'appel ne rend la main qu'à la fin de l'énoncé. Le premier
son est donc **antérieur** à ces 14–15 s ; il n'a pas été horodaté.

## Chiffres retenus (8 tours Edge réussis)

| Étape | Min | Médiane | Max |
|---|---|---|---|
| STT Groq | 1 182 | **1 425** | 4 013 (démarrage à froid) |
| LLM Groq + outils | 1 232 | **1 420** | 2 316 |
| TTS Edge (synthèse complète) | 717 | **1 714** | 2 865 |
| **Total, VAD inclus** | **4 093** | **5 737** | **7 076** |

Moyenne des huit tours : **5 605 ms**. Sur les dix tours, le script donne une
médiane de 5 915 ms et une moyenne de 8 208 ms — chiffres **faussés par le repli
SAPI**, à ne pas citer.

## 1. Le premier poste n'est pas le réseau : c'est DPAPI

`requireGroqKey()` appelle `loadKeys()` à chaque requête
(`host/aven-app-host.ts:146`). Or `loadKeys()` déchiffre **chaque clé stockée**
par un lancement PowerShell synchrone (`host/aven-app-host.ts:331-353`) : deux
clés sont enregistrées (`groq`, `openrouter`). Et `requireGroqKey()` est appelée
**deux fois par tour** : une pour le STT, une pour le LLM.

Mesure du coût unitaire, avec la commande exacte utilisée par le host :

```
5 lancements PowerShell synchrones : 2 911 ms  →  582 ms par lancement
```

Donc, par tour : 4 déchiffrements × ~582 ms ≈ **2,3 s**, soit **41 %** de la
médiane de 5,74 s. Ce n'est pas une déduction de lecture seule : le coût du
lancement est mesuré, le nombre d'appels est lu dans le code. Le déchiffrement
réel ajoute le passage par `stdin`, donc 2,3 s est un **plancher**.

Corollaire : le vrai STT réseau tourne autour de 0,2–0,5 s, et le vrai LLM
autour de 0,3–0,8 s — les chiffres du tableau sont gonflés par ce poste fixe.
Le premier tour (STT 4,0 s) paie en plus le démarrage à froid de PowerShell et
la poignée de main TLS.

## 2. Edge tient huit requêtes, puis refuse

Les tours 9 et 10 ont reçu **HTTP 429**, après huit synthèses Edge réussies en
environ quarante secondes. Le host a appliqué son blocage d'une minute
(`EDGE_COOLDOWN_MS`) et basculé sur la voix Windows en le disant. C'est le
comportement prévu, et il confirme que le service n'est pas contractuel : un
agent conversationnel qui répond toutes les dix secondes **atteindra** cette
limite. Le repli Piper est donc une pièce du fonctionnement normal, pas une
exception.

## 3. Une transcription fausse produit une réponse fausse

« JSON » a été entendu **« GSON »** ; le modèle a répondu sur une bibliothèque
Java imaginaire avec assurance. C'est la démonstration directe de la règle des
actions : une commande vocale irréversible doit être **répétée et confirmée**,
sinon un nom mal transcrit déclenche la mauvaise action. Deux autres écarts sont
bénins (« des noms », « 17 »).

## 4. Ce que ces chiffres disent du « Jarvis »

- La conversation est à **~5,7 s** du dernier mot au premier son : trois fois
  trop lent pour un échange naturel.
- Le levier le plus rentable est un **cache des clés déchiffrées** (~2,3 s),
  pas le streaming.
- Le deuxième levier est la **synthèse complète avant lecture** (1,7 s de
  médiane) : la webview attend le MP3 entier. Diffuser l'audio au fil de la
  synthèse, sans multiplier les requêtes Edge, est la vraie optimisation.
- Le VAD ajoute **700 ms** fixes ; le descendre est possible mais risque de
  couper la fin des phrases — à mesurer, pas à supposer.

## 5. Ce qui n'a pas été mesuré

- **Aucune capture micro** : le VAD réel, le bruit du clavier et le niveau du
  micro ne sont pas dans la boucle.
- **Aucun décodage/lecture audio dans la webview** : le démarrage de
  `playVoiceSpeech` (décodage MP3, sortie audio) n'est pas chronométré.
- **Un seul réseau, une seule machine, une seule passe** : pas de variance
  inter-jour, pas de test en heure chargée.
- **Le repli Piper** n'était pas disponible dans ce host de mesure
  (`AVEN_PIPER_DIR` absent) : les tours 9–10 sont tombés sur SAPI, pas sur
  Piper. Le premier son de SAPI n'est pas mesuré.
- **Le coût exact dans `loadKeys`** : mesuré par proxy (lancements PowerShell
  identiques), pas par instrumentation du host.

## 9. Mesure du 2026-10-27, voix Pocket TTS (v11.11.1)

La voix par défaut a changé depuis ces mesures : elle est locale (Pocket TTS,
voix clonée) et se joue en flux d'échantillons nus. Les dix phrases d'origine ont
donc été rejouées, à l'identique, avec le host construit (`npm run build:host`),
`AVEN_POCKET_DIR` et `AVEN_USER_DATA_DIR` renseignés — donc la vraie voix et le
vrai cache de l'app.

| Étape | Min | Médiane | Max |
|---|---|---|---|
| STT Groq | 413 | **486** | 2 718 (démarrage à froid) |
| LLM Groq + outils | 334 | **691** | 1 491 |
| Première trame Pocket | 237 | **410** | 1 751 (chargement du moteur) |
| **Total, VAD inclus** | **2 071** | **2 199** | **6 659** (froid) |

Neuf tours sur dix ont abouti ; le dixième a reçu une réponse vide du LLM
(« L'agent vocal n'a renvoyé aucune réponse »), sans repli et sans rapport avec
la voix. **Aucun repli de voix** : les neuf tours ont été servis par Pocket en
flux (`mime: audio/pcm`), sans un seul 429 — la limite du service Edge ne fait
plus partie du chemin normal.

Comparaison des médianes, même protocole :

| État | Médiane « dernier mot → premier son » |
|---|---|
| v11.5.1, synthèse complète Edge, sans cache de clés | 5 737 ms |
| v11.5.2, cache des clés | 3 005 ms |
| v11.5.3, flux Edge (2 tours chauds) | ~2 150 ms |
| **v11.11.1, voix Pocket locale en flux** | **2 199 ms** |

Le total se décompose en trois postes fixes : **700 ms** de silence de fin du VAD
(`web/src/voice-agent/vad.ts`), **~490 ms** de STT, **~690 ms** de LLM, **~410 ms**
avant la première trame audio. Le démarrage à froid (première demande après
lancement) reste à 6,7 s : déchiffrement DPAPI et lancement PowerShell, plus le
chargement du moteur local.

Ce qui n'est toujours pas mesuré : la capture WebView2, la sérialisation du blob
dans l'IPC et la mise en route de l'AudioContext (assez pour ajouter quelques
dizaines de millisecondes, pas pour changer l'ordre de grandeur).

Le levier restant le plus gros est le **silence de fin du VAD** (700 ms), soit
un tiers du total. Le baisser à ~450 ms est possible, mais un silence de 500 ms
au milieu d'une phrase la couperait en deux : à mesurer sur des phrases réelles
avant de toucher au seuil.

## 6. Reproductibilité

Les fichiers de mesure sont hors dépôt : `C:\tmp\latence-voix`
(`phrases.ps1`, `measure.mjs`, `mesures.json`). Le script génère les WAV, lance
le host construit (`npm run build:host`) et écrit les mêmes statistiques. Toute
optimisation doit être re-mesurée avec **les mêmes dix phrases**, sinon les
chiffres ne se comparent pas.

## 7. Mesure après le cache des clés (v11.5.2)

Implémenté : `host/key-cache.ts` (module pur, testé), branché dans
`host/aven-app-host.ts` ; `requireGroqKey`, la dictée et `loadKeys` passent par
le cache, `saveKey` l'invalide, et un changement de `settings.json` aussi
(mtime). Sonde `scripts/verify-v11.5.2.mjs`.

Les dix phrases ont été rejouées avec le host reconstruit. **Quatre tours sur
dix ont reçu un 429 d'Edge** malgré trois minutes d'attente et 5 s entre les
tours : seuls les six tours Edge sont comparables.

| # | STT | LLM | TTS | Total |
|---|---|---|---|---|
| 1 (froid) | 1 535 | 841 | 619 | 3 694 |
| 2 | 437 | 962 | 2 135 | 4 234 |
| 7 | 418 | 410 | 812 | 2 340 |
| 8 | 412 | 1 133 | 760 | 3 005 |
| 9 | 453 | 523 | 889 | 2 566 |
| 10 | 321 | 1 435 | 824 | 3 280 |
| **Médiane** | **418** | **841** | **812** | **3 005** |

| Étape | Avant | Après | Écart |
|---|---|---|---|
| STT | 1 425 | 418 | **−1 007 ms** |
| LLM | 1 420 | 841 | **−579 ms** |
| STT + LLM (effet isolé du cache) | 2 845 | 1 259 | **−1 586 ms** |
| Total Edge (VAD inclus) | 5 737 | 3 005 | −2 732 ms |

Le total baisse plus que l'étape isolée : la synthèse Edge a aussi été plus
rapide sur cette passe (812 ms de médiane contre 1 714 ms), ce qui dépend de la
longueur des réponses. **Le chiffre à retenir pour le cache est −1,59 s sur
STT + LLM** ; le total de 3,0 s est une photographie, pas une preuve isolée.

Le premier tour à froid passe de 7 076 à 3 694 ms : le cache supprime trois des
quatre déchiffrements, le quatrième reste au premier usage.

### Le 429 est plus sévère que mesuré la première fois

Première passe : huit synthèses Edge réussies avant le refus. Deuxième passe :
**quatre refus sur dix**, après une pause de trois minutes et à 5 s d'intervalle.
La limite est donc côté service, pas seulement en rafale, et elle ne se réarme
pas en une minute. Conséquence pour le « Jarvis » : Edge ne peut pas être la
seule voix d'un agent qui répond en continu ; Piper doit être le repli normal
(et non l'exception), ou le blocage doit être porté bien au-delà de 60 s.

`npm run verify` reste vert, et la sonde v11.5.2 refuse un retour au
déchiffrement par requête.

## 8. Mesure après le flux audio (v11.5.3)

Implémenté : transport Edge avec `onChunk`/`signal` et format
`webm-24khz-16bit-mono-opus` (`host/voice-agent-tts.ts`), méthode
`voiceAgentSayStream` et événements `voice.stream.*` (`host/aven-app-host.ts`),
lecteur `MediaSource` (`web/src/voice-agent/stream.ts`). Une seule requête Edge
par réponse ; les trames sont regroupées par ~4 Ko avant l'IPC.

### 8.1 Première trame seule (texte fourni, pas de STT/LLM)

| Mesure | Valeur |
|---|---|
| Première trame | **566 ms** |
| Synthèse complète (fin de l'appel) | 659 ms (audio court) |
| Format | WebM (magic `1a45dfa3`), 135 trames, 15 939 octets |

Sur la phrase de test plus longue du probe : première trame **533 ms**, synthèse
complète **1 653 ms** — la trame arrive **3 fois plus tôt** que le fichier entier.

### 8.2 Chaîne complète (STT + LLM + première trame + VAD)

Deux passes de cinq phrases, chaque passe dans un host neuf (donc un démarrage à
froid par passe) :

| # | STT | LLM | 1re trame | Premier son | État |
|---|---|---|---|---|---|
| 1re passe, p1 | 1 527 | 706 | 540 | 3 474 | froid |
| 1re passe, p3 | 515 | 446 | 490 | **2 151** | chaud |
| 1re passe, p4 | 503 | 306 | 6 | 1 755 | **cache** (pas une synthèse) |
| 2e passe, p1 | 3 174 | 386 | 417 | 4 677 | froid |
| 2e passe, p2 | 501 | 410 | 643 | **2 254** | chaud |
| 2e passe, p3–p5 | — | — | — | — | 429 puis blocage, repli SAPI |

**Tours chauds Edge : 2 151 et 2 254 ms** — soit ~2,2 s, contre **3 005 ms** de
médiane sans diffusion (v11.5.2). Le gain est de l'ordre de **0,8 s**, et il
porterait plutôt sur 1,3 s avec une synthèse Edge de longueur médiane : la
première trame arrive toujours vers 0,5 s, alors que la synthèse complète
variait de 0,6 à 2,1 s.

Deux tours de la première passe ont échoué côté LLM (« l'agent vocal n'a
renvoyé aucune réponse »), sans lien avec le flux ; ils sont exclus. Un tour a
été servi depuis le cache de flux (6 ms), également exclu.

### 8.3 Lecture réelle dans Chromium

Le WebM produit par Edge a été rejoué dans Chromium (page de test, moteur
proche de WebView2) en ajoutant 4 morceaux de 4 Ko à un `MediaSource` :
`audio/webm; codecs="opus"` supporté, lecture acceptée, **2,46 s jouées jusqu'à
`ended`**, aucune erreur. Cela valide le conteneur et l'ajout progressif ; ce
n'est pas un test dans la webview Tauri.

### 8.4 Ce que le flux ne fait pas

- Il ne compresse **pas** les pauses internes : l'ancien chemin décodait tout le
  MP3 et ramenait les pauses de plus de 650 ms à ~420 ms. Une réponse peut donc
  durer un peu plus longtemps, même si elle commence plus tôt.
- Il ne coupe pas le silence de tête (~150 ms) : le premier son réel est donc
  ~150 ms après la première trame, moins le temps d'init du `MediaSource`.
- Le démarrage à froid reste à 3,5–4,7 s (déchiffrement DPAPI + PowerShell).

### 8.5 Limites

- Deux tours chauds seulement : le quota Edge a refusé les autres. La cible
  « ~2,2 s » est atteinte sur ces deux tours, pas prouvée sur dix.
- Le repli mesuré est SAPI (Piper absent du host de mesure) ; en production,
  Piper prend le relais et son premier son n'est pas mesuré ici.

### 8.6 Écoute dans la webview Tauri (2026-10-26)

L'app dev a été pilotée par le débogueur CDP de WebView2, avec un micro factice
et l'analyseur neutralisé (le VAD ne coupe pas la lecture). Les réponses sont
déclenchées par la passerelle `__avenVoice.simulate` — le vrai chemin STT →
commande/LLM → `speakReply`. Trois tours Edge (phrases courtes de commandes),
mesurés sur `HTMLMediaElement` (`playing`, `timeupdate`) et sur les événements
`voice.stream.*` bruts.

**Deux défauts réels trouvés, invisibles hors de l'app :**

1. **Abonnement tardif.** Le lecteur créait son écouteur
   (`api.onEvent`) juste avant `voiceAgentSayStream`. `listen` est un invoke
   asynchrone : il était traité APRÈS la commande bloquante, donc aucune trame
   n'arrivait au lecteur. Mesuré : 6 trames reçues par un écouteur installé à
   l'avance, **0** par le lecteur, 12 s d'attente, aucun son. Corrigé par un
   abonnement unique installé au chargement du module (`sinks` par `streamId`).
2. **Commande synchrone.** Même abonné, les trames arrivaient toutes groupées à
   ~1,1 s (7–8 trames en 10 ms), au retour de `aven_call`, et le premier son
   suivait à 1,1–1,2 s. Tauri exécutait la commande synchrone sur le fil
   principal, qui ne pouvait pas livrer les événements pendant la synthèse.
   `aven_call` est devenue `async` (contrat inchangé) ; le fil principal est
   libre pendant l'attente du host.

Après le premier correctif, les réponses **en cache** jouaient bien : premier
`playing` à **141–193 ms**, premier `timeupdate` à 367–412 ms, fin normale. Ce
chiffre ne prouve pas la livraison progressive (une seule trame de cache).

Après le passage de `aven_call` en asynchrone, deux mesures :

| Essai | Trames | Première → dernière | Premier `playing` | Fin |
|---|---|---|---|---|
| Texte long, appel direct | 26 | **554 → 1 015 ms** (retour à 1 019) | — (pas de lecteur) | — |
| Réponse fraîche dans l'app, « Terminal Freebuff ouvert. » | 5 | **399 → 538 ms** | **434 ms** | 2 878 ms |

Le texte long montre que les trames ne sont plus retenues jusqu'au retour :
elles s'échelonnent sur 460 ms et la dernière précède de 4 ms le retour de la
commande. Dans l'app, le premier son arrive **434 ms** après le déclenchement,
soit pendant la synthèse (dernière trame à 538 ms). Les deux commandes suivantes
ont été refusées par Edge (429) et sont parties sur Piper ; le service reste le
facteur limitant, pas la chaîne locale.
