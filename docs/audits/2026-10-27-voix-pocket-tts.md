# Audit — voix locale Pocket TTS, essai et intégration (2026-10-27)

## Objet

Décider, chiffres et oreille en main, si le moteur **Pocket TTS** (Kyutai) mérite
d'entrer dans Aven comme voix locale, à côté de Piper (Tom, Siwis) et des voix
neuronales d'Edge. La question a été posée après un long cycle d'essais de moteurs
TTS locaux (voir `2026-10-24-voix-tts-locales.md` et
`2026-10-26-voix-piper-modeles.md`), où la conclusion provisoire était « garder
Edge ».

## Méthode

1. **Audition à l'aveugle**, trois prises de la même phrase
   (« C'est noté. J'ai enregistré la note dans Aven, et je te préviens dès que
   Freebuff a fini de compiler. »), ramenées au même format (PCM 16 bits, 24 kHz),
   à la même sonie (RMS −20 dBFS, gains +0,9 à +4,4 dB) et sous des étiquettes
   neutres A/B/C. La correspondance n'a été révélée qu'après le verdict.
2. **Mesure du timbre** : centroïde spectral, rolloff 95 %, énergie au-dessus de
   4 kHz, aplatissement spectral, et hauteur (F0 médiane) par **deux méthodes
   indépendantes** — autocorrélation et cepstre — pour écarter une erreur
   d'octave, qui est le piège classique de ce genre de mesure.
3. **Mesure du moteur** (2026-10-27, sur cette machine, U300) : facteur temps
   réel, temps avant le premier son, avance de génération sur la lecture,
   démarrage à froid, un passage contre quatre fils, int8 contre fp32, `flow_net`
   et décodeur Mimi quantifiés séparément, `torch.compile`, IPEX, GPU.

## Résultats d'écoute

| Lettre | Moteur | Durée | Centroïde | Rolloff 95 % | > 4 kHz | F0 médiane |
|---|---|---:|---:|---:|---:|---:|
| **A** | Pocket TTS, int8, Python | 5,40 s | 911 Hz | 3345 Hz | 4,2 % | **111,6 Hz** |
| **B** | Edge Denise | 7,42 s | 1685 Hz | 8202 Hz | 17,5 % | **205,1 Hz** |
| **C** | Pocket TTS, int8, Rust | 5,32 s | 994 Hz | 3476 Hz | 4,0 % | **109,6 Hz** |

Verdict : **A et C préférées, B dernière**. Deux lectures de ce verdict :

- **A et C sont la même voix** (mêmes poids, même profil, 80 ms d'écart, spectres à
  2 %) : l'auditeur ne les a pas départagées — c'est le résultat attendu avec deux
  prises du même moteur, et cela montre que **l'int8 ne coûte rien à l'oreille**.
- **B se distingue par le registre**, pas par la qualité : une octave entière
  sépare Denise (205 Hz, registre clair) des deux autres (110 Hz, registre grave).
  La voix déjà retenue dans l'app, Tom, mesure 136,5 Hz : la préférence de
  l'utilisateur pour un registre grave est donc **constante** dans l'historique du
  projet, pas propre à cette séance.

Comparaison complémentaire, produite dans les mêmes conditions (même script, même
fenêtrage) :

| Voix | Durée | Centroïde | Rolloff 95 % | > 4 kHz | F0 médiane |
|---|---:|---:|---:|---:|---:|
| Pocket TTS (Rust, int8) | 5,32 s | 994 Hz | 3476 Hz | 4,0 % | 109,6 Hz |
| Edge Henri | 6,70 s | 1359 Hz | 6357 Hz | 10,5 % | **115,9 Hz** |
| Edge Denise | 7,42 s | 1685 Hz | 8202 Hz | 17,5 % | 205,1 Hz |
| Piper Tom (`length_scale` 0,92) | 6,16 s | 2644 Hz | 8953 Hz | 35,5 % | 136,5 Hz |
| Piper Siwis (1,10) | 6,19 s | 1668 Hz | 8549 Hz | 13,0 % | 216,2 Hz |

Henri tombe dans le **même registre** que Pocket (116 Hz contre 110 Hz) : la
comparaison a donc été refaite à registre égal, et la préférence pour Pocket s'est
maintenue (0,41 % de F0 d'écart, mais une bande passante nettement plus étroite —
3,5 kHz contre 6,4 kHz — que l'utilisateur n'a pas retenue comme un défaut).

## Résultats de mesure du moteur

| Réglage | Démarrage | 1er son | RTF | Tient la lecture ? |
|---|---:|---:|---:|---|
| Python `serve`, stock (1 fil, int8) | 20,1 s | 413–486 ms | 0,86 | non (−0,19 à −0,83 s) |
| Python, 4 fils en processus | — | ~200 ms | 0,60 (+36 %) | — |
| Python, 4 fils, fp32 | — | ~200 ms | 0,59 | — |
| **Rust `serve`, int8** | **12,7 s** | **264–275 ms** | **0,39–0,41** | **oui (+19 à +79 ms)** |
| Rust `generate`, int8 (une passe) | 2,49 s au total | — | 0,30–0,31 (3,3×) | — |
| Rust `generate`, fp32 | — | — | 0,50–0,55 | — |
| Edge, réseau | — | ~440 ms | ~0,12 | oui (2 × 429 dans la séance) |

Leviers **sans effet** ou nuisibles, mesurés : `flow_net` en int8 (**−5 %**),
décodeur Mimi en int8 (+2 %, dans le bruit), `torch.compile` (**casse le
modèle** : `KeyError` sur les modules renommés), IPEX (**aucune roue Windows
publiée**), GPU (**pas de GPU NVIDIA sur cette machine** — seul un Intel UHD est
présent), priorité et épinglage de cœur (≤ 1 %).

## Décision

Intégrer **le binaire Rust** comme voix locale de plus (`pocket:fr`), avec un flux
PCM joué au fil de la synthèse :

- premier son **270 ms** mesuré (contre ~2,4 s pour un WAV complet, et ~1,1 s pour
  Piper) ; la lecture ne décroche jamais, l'avance de génération reste positive ;
- aucun réseau tiers : le texte part au serveur local du moteur ;
- le modèle français (« estelle », 209 Mo, **CC-BY 4.0**, dépôt ouvert
  `kyutai/pocket-tts-without-voice-cloning`, commit `1e08e6a2`, **aucun jeton**)
  est mis en cache sous les données de l'app ; le dépôt qui sait cloner une voix
  (`kyutai/pocket-tts`) est *gated* et n'est pas utilisé ;
- le binaire est épinglé (`v4.0.1`, zip de 7 914 990 octets) et **vérifié par
  empreinte SHA-256** contre le `SHA256SUMS` publié ;
- repli inchangé : Piper, puis Windows, toujours annoncé (`warning`).

## Ce qui n'a pas été mesuré

- **L'écoute ne portait que sur une seule phrase** et une seule prise par moteur :
  la préférence est nette, mais elle ne dit rien des nombres, des dates ou des
  phrases longues.
- **La prononciation des noms propres sur ce moteur** (« Aven », « Freebuff ») :
  le dictionnaire local lui est appliqué par défaut, sans réaudition — ce n'est
  pas une mesure.
- **La mémoire résidente du serveur** n'a pas été relevée : le processus reste
  vivant pour la session (choix assumé pour ne pas repayer 12,7 s à chaque phrase).
- **La latence de bout en bout dans l'app** (micro → STT → LLM → premier son) :
  mesurée en v11.5.x pour Edge, elle ne l'est pas encore pour cette voix.
- **Le premier téléchargement du modèle** (209 Mo) sur une machine neuve : la
  vitesse observée ici (~4–5 Mo/s) vient d'autres transferts, pas de celui-ci.
- **L'effet du codec** : les deux voix Edge ont été écoutées en MP3 48 kbit/s (le
  format du chemin complet), alors que l'app diffuserait de l'Opus pour Edge.

## Voix clonée (essai du même jour, après intégration)

L'utilisateur a préféré, à l'oreille, la voix **clonée** du moteur à Edge Henri, à
Tom (Piper) et à la voix intégrée « estelle ». L'essai a donc été refait sur le
binaire livré, avec un profil `.safetensors` (18 tenseurs, 9,9 Mo) extrait d'un
enregistrement de référence de 3,96 s (24 kHz mono).

| Configurations du serveur | 1er paquet PCM | Audio produit | Distance spectrale à la référence |
|---|---:|---:|---:|
| Profil cloné (`--default-voice <profil>`) | 12–16 ms | 5,80 s | **0,9 %** |
| Voix intégrée (sans argument) | 14–23 ms | 5,40 s | 18,8 % |

La distance est celle des spectres de mel moyens (26 bandes, trames voisées,
normalisés) : le profil est donc bien appliqué — 20 fois plus proche de la
référence que la voix intégrée. La durée change aussi (5,80 s contre 5,40 s), ce qui
aurait pu suffire à tort : un conditionnement ignoré produirait la même durée que
la voix intégrée, pas une durée voisine. Hauteur médiane mesurée par
autocorrélation (seuil 0,35, méthode vulnérable à l'octave) : référence 96,8 Hz,
profil 112,1 Hz, voix intégrée 233,0 Hz — le registre grave est celui de la
référence, et « estelle » est nettement plus haut.

Démarrage du moteur avec un profil : 0,7 s à chaud, 7,3 s disque froid, 28,9 s
juste après un `cargo build` — le modèle reste chargé pour la session, comme
avant.

L'essai a été refait **dans le host de l'app** (harnais `artifacts/test-voix-clonee.mjs`,
host compilé, préférence écrite par le même chemin que Réglages) : la liste de voix
propose « pocket:clone », le lecteur demandé au renderer est « pcm », et sur la
phrase de référence le premier paquet arrive à **107 ms moteur chaud** contre
**1976 ms moteur froid** (chargement du modèle compris). La sortie du host sur
cette même phrase mesure **0,9 %** de distance spectrale à la référence — identique
au profil lu en direct, donc c'est bien le profil qui parle. (Le 4,9 % mesuré sur
la phrase courte ne se compare pas : le contenu diffère.)

**Correction du 2026-10-27.** La section « Décision » ci-dessus affirme que le
dépôt *gated* n'est pas utilisé. C'est vrai pour un profil déjà extrait, et faux
pour l'extraction : `export-voice` (convertir un enregistrement en profil) passe
par `kyutai/pocket-tts`, dont l'accès est soumis à conditions. Mesure : dépôt
gated écarté du cache et serveur hors ligne, le profil produit **les mêmes 5,80 s**
avec un premier paquet à 16 ms. Le journal du serveur, lui, nomme toujours le
dépôt gated — c'est le chemin déclaré par `french.yaml`, pas une preuve de
lecture.

**Sonde amendée le même jour.** `scripts/verify-v11.8.0.mjs` figeait l'expression
exacte de `loadPrefs` (`voiceName: normalizePiperPreference(piperDir(), stored) ||
defaultVoiceName()`). L'ajout du mur Pocket a changé l'expression, pas l'exigence —
rien n'est lu sans normalisation, et le défaut vient en dernier. L'assertion a donc
été réécrite pour exiger la chaîne complète ; aucune autre assertion de cette sonde
n'a bougé.

## Niveau et silences, corrigés le même jour

Écoute faite, puis corrigée : la voix clonée sortait **2,4 dB sous Piper Tom** à
phrase identique (RMS des trames voisées : −22,8 contre −20,4 dBFS ; crête
−7,1 contre 0,0) et **chaque réponse se terminait par 420 à 600 ms de silence**
(590 ms pour la voix intégrée du même moteur). Le chemin Edge rognait déjà ces
silences et ramenait les pauses internes de plus de 650 ms à 420 ms : le chemin
local reçoit la même règle, dans un module pur, `host/pcm-audio.ts`.

| Prise (trames de 10 ms, seuil −54 dBFS) | Durée | Silence de tête | Silence de queue | Crête | RMS voisé |
|---|---:|---:|---:|---:|---:|
| Voix clonée, brute | 5,96 s | 200 ms | 550 ms | −7,1 dBFS | −22,8 dBFS |
| Réponse A, après mise en forme | 2,99 s | 40 ms | 0 ms | −5,2 dBFS | −20,4 dBFS |
| Réponse B, après | 3,71 s | 40 ms | 0 ms | −3,7 dBFS | −19,3 dBFS |
| Réponse C, après | 8,55 s | 40 ms | 0 ms | −3,3 dBFS | −20,0 dBFS |
| Piper Tom (référence) | 6,16 s | 0 ms | 360 ms | 0,0 dBFS | −20,4 dBFS |

Le gain (+2,5 dB) est calé sur l'écart mesuré, et il ne s'applique **qu'au profil
cloné** : la voix intégrée du même moteur est déjà au niveau de Piper.

Le rognage de tête ne coûte pas de latence perçue. Chronologie mesurée des paquets
du moteur sur la phrase B : en-tête à 14 ms, 80 ms d'audio à 245 ms, 320 ms à
489 ms, puis une salve de 958 ms à 1121 ms. La première parole est donc déjà dans
le 3ᵉ paquet (~490 ms) : avant comme après, le premier mot s'entend au même
instant — c'est le silence qui n'est plus joué. Le lecteur de la webview reste
inchangé (il démarre après 250 ms d'audio reçu, ce qui compte désormais de la
parole et non du silence).

## Licence et conditions

Moteur : MIT (binaire Rust `kyutai-labs/pocket-tts`, `LICENSE` livré avec le
binaire). Poids : CC-BY 4.0 — l'attribution (Kyutai et le modèle) est donc requise
là où l'app les embarque ou les cite. Aucune donnée utilisateur ne quitte la
machine pour cette voix, ni pour la voix clonée.

**Provenance du profil de voix clonée — à traiter comme tel.** L'enregistrement de
référence vient d'un service tiers de synthèse vocale (fichier
`ElevenLabs_2026-10-27T13_23_05_Guillaume - Narrator…mp3`, voix « Guillaume —
Narrator »). Le profil est donc un *dérivé* d'un audio produit par un autre moteur :
il reste **hors du dépôt et hors de l'installeur** (une sonde refuse tout
`.safetensors` sous `src-tauri/resources/`), il n'est utilisé que sur cette
machine, et le libellé d'interface dit « voix clonée » sans jamais nommer la voix
d'origine — même règle que pour Tom. Les conditions du service tiers n'ont **pas**
été reverifiées ici : la clause qui encadre l'usage d'un audio généré pour
alimenter un autre moteur doit être relue avant tout partage du profil.

## Artefacts

`artifacts/pocket-tts/` (ignoré par git) : `blind-audit.py` (audition à l'aveugle),
`analyse-timbre.py`, `controle-octave.py`, `analyse-voix.py`, `blind-henri.py`
(mesures), `blind/A.wav`, `blind/B.wav`, `blind/C.wav`, `blind/H.wav` et
`blind/mapping.json` (les prises et leur correspondance), `bench-*.py`
(facteur temps réel), `stream-compare.mjs` (flux et avance), `edge-henri.mjs`
(prise Edge), `rust/` (binaire conservé), `check-clone.mjs` (profil lu par le
binaire), `probe-profile.mjs` (même essai, sans le dépôt gated),
`verifie-profil.py` (distance spectrale à la référence), `clone-check/` (prises
comparées).
