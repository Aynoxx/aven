# Audit — voix de synthèse locales face à Edge (2026-10-24)

## Objet

L'agent vocal d'Aven parle avec les voix neuronales du service de lecture d'Edge
(`host/voice-agent-speech.ts:307`), gratuit et sans compte, mais **non
contractuel** : un HTTP 429 renvoie l'utilisateur sur la voix Windows locale, et
le bandeau le dit. La question posée était : existe-t-il un moteur **local**,
gratuit, sans carte bancaire, qui tienne à la fois le timbre et la latence ?

Réponse mesurée : **non**. Aucun des cinq moteurs essayés ne réunit les deux,
et trois d'entre eux sont même plus lents que le temps réel. Edge reste la voix
de production.

## Méthode

- Matériel : Windows, 6 cœurs logiques, aucun GPU utilisé, Python 3.11 et 3.15.
- Texte unique, celui d'une réponse réelle d'Aven :
  « C'est noté. J'ai enregistré la note dans Aven, et je te préviens dès que
  Freebuff a fini de compiler. » — deux phrases, deux noms propres.
- Edge synthétisé par le **module du projet** (`synthesizeEdgeSpeech`), donc
  exactement la voix de l'application, pas une approximation.
- Niveaux égalisés (crête ramenée à 89 %) avant chaque écoute : une voix 5 dB
  plus faible paraît moins bonne sans que le timbre y soit pour rien. Mesuré sur
  la voix Windows : RMS 9 %, contre 14–16 % pour les autres.
- Écoutes à l'aveugle, ordre tiré au sort, étiquettes révélées après la réponse.
- RTF = temps de synthèse ÷ durée d'audio produit ; au-dessus de 1, le moteur
  est plus lent que la parole.

## Résultats mesurés

| Moteur | Synthèse | Audio | RTF | Format | Poids |
|---|---|---|---|---|---|
| **Edge `fr-FR-DeniseNeural`** | **0,73–2,16 s** | 7,4 s | ~0,1 | MP3 24 kHz | 0 (distant) |
| Piper `fr_FR-siwis-medium` | 0,68 s | 5,55 s | 0,12 | WAV 22,05 kHz | 63 Mo |
| Windows `Hortense Desktop` | instantané | 7,44 s | ~0 | WAV 22,05 kHz | système |
| Kyutai Pocket TTS `french_24l` | 7,63 s | 5,32 s | 1,43 | WAV 24 kHz | binaire 7,9 Mo + ~100 M |
| Kyutai Pocket TTS `french` (distillé) | 2,85 s | 5,40 s | 0,53 | WAV 24 kHz | ~100 M |
| MeloTTS-FR (PyTorch) | 9,8 s (dont 0,41 s texte+BERT) | 5,90 s | 1,66 | WAV 44,1 kHz | 208 Mo + BERT |
| MeloTTS-FR export ONNX fp32 | 7,1 s | 6,0 s | 1,18 | WAV 44,1 kHz | 170 Mo |
| MeloTTS-FR ONNX int8 dynamique | 33,7 s | 6,0 s | 5,6 | WAV 44,1 kHz | 53 Mo |
| MeloTTS-FR ONNX int8 statique (QDQ) | 3,98 s | 5,96 s | 0,60 | WAV 44,1 kHz | 47 Mo |
| Supertonic 3 (8 étapes) | 6,83 s | 6,63 s | 1,03 | WAV 44,1 kHz | 396 Mo d'assets |
| Supertonic 3 (4 étapes) | 5,01 s | 6,63 s | 0,76 | WAV 44,1 kHz | 396 Mo |
| Supertonic 3 (2 étapes) | 4,27 s | 6,63 s | 0,64 | WAV 44,1 kHz | 396 Mo |
| Supertonic 3 (1 étape) | 3,44 s | 6,63 s | 0,52 | WAV 44,1 kHz | 396 Mo |

## Verdicts d'écoute

- **Piper siwis contre Denise** : Denise gagne. Le timbre de siwis est propre mais
  sans chaleur.
- **Hortense contre les autres** : perdante systématique, et structurellement
  ~5 dB plus faible à volume nominal — un défaut du repli actuel, indépendant du
  timbre.
- **Kyutai Pocket TTS** : meilleure intonation que Denise, mais prononciation
  floue. Vérifié : ce n'est pas un réglage — 1, 2 puis 3 étapes de décodage
  donnent le même flou.
- **MeloTTS-FR** : timbre préféré à Denise. Rejeté pour la latence (8 à 10 s),
  et l'int8 qui passe sous le temps réel (RTF 0,60) introduit des artéfacts
  audibles.
- **Supertonic 3, voix F1** : timbre préféré à Denise, avec des syllabes
  « détachées ». À 1, 2 et 4 étapes le rendu est jugé inutilisable ; seul le
  réglage à 8 étapes (6,83 s) tient. Signal objectif concordant : à 2 étapes la
  forme d'onde sature à 100 % de crête (débruitage non convergé), contre 31 % à
  8 étapes.

## Constats techniques

- **L'int8 dynamique d'ONNX Runtime est un piège sur un vocodeur** : il ne
  quantifie que les couches linéaires et ajoute des conversions autour de chaque
  convolution (33,7 s contre 7,1 s en fp32). Seule la quantification statique
  QDQ accélère réellement (3,98 s), au prix du timbre.
- **La version d'ONNX Runtime change le verdict de vitesse** : Supertonic à
  8 étapes passe de 9,14 s (ORT 1.23.1, version épinglée par son dépôt) à 6,83 s
  (ORT 1.31.0). Toute mesure de RTF sans version de runtime n'est pas
  reproductible.
- **MeloTTS n'est pas installable proprement sur Windows** : le paquet PyPI est
  cassé (archive sans `src/requirements.txt`), le module japonais initialise
  MeCab à l'import (échec sans dictionnaire), et PyTorch n'a pas de wheel pour
  Python 3.15. Trois contournements ont été nécessaires pour un simple essai.
- **Licences** : Piper (MIT pour l'ancien dépôt, GPL-3.0 pour `piper1-gpl`),
  Pocket TTS (code MIT, poids CC BY 4.0), MeloTTS (MIT), Supertonic 3 (code MIT,
  poids **OpenRAIL-M** — restrictions d'usage à transmettre). Écartés pour
  licence non commerciale : MMS, XTTS-v2, F5 français. Écartés pour le poids :
  Parler-TTS (3,75 Go), ZONOS2 (4,9 Go quantifié), Kyutai TTS 1.6B (pas de
  chemin CPU).

## Ce qui n'a pas été mesuré

- Une seule phrase, un seul locuteur par moteur : la tenue sur un paragraphe
  long n'est pas évaluée.
- Aucun MOS, aucune mesure de prosodie objective — les verdicts d'écoute sont
  ceux d'un auditeur unique.
- Le mode streaming de Pocket TTS (≈200 ms avant le premier son annoncé par
  l'éditeur) n'a pas été exercé : seul le mode fichier l'a été.
- L'export ONNX de MeloTTS forçait `sdp_ratio = 0` au lieu de 0,2 ; la perte
  d'intonation constatée sur cet export peut venir de là et non du modèle. Non
  isolé.
- Aucune intégration dans Aven n'a été tentée : la conclusion rend l'exercice
  sans objet.

## Décision

1. **Garder Edge comme voix de production** : c'est le seul moteur qui tienne le
   timbre et la latence, gratuitement et sans compte.
2. **Ne pas intégrer de moteur local** pour l'agent vocal : le meilleur d'entre
   eux coûte 3,4 à 6,8 s avant le premier mot, contre 0,7 à 2,2 s.
3. Le coût réel d'Edge reste le 429, déjà traité : une requête par réponse
   (`host/aven-app-host.ts:164`), cache borné des phrases fixes
   (`host/aven-app-host.ts:160`), une seconde tentative, puis une minute sans
   aucune requête (`host/voice-agent-edge.ts:44`), et le repli toujours annoncé.
4. **Condition de réexamen** : un moteur local qui produit une phrase de 6 s en
   moins de 1 s sur un CPU de bureau, avec un timbre jugé au moins égal à Denise.
   Aucun modèle évalué ici n'en approche à ce jour.

## Artefacts

Tous les essais ont vécu hors du dépôt, dans `%TEMP%` (`supertonic`,
`melo311`, `melo-run`, `voix2`, `pocket`), et ont été supprimés après la
décision. Aucun fichier du projet n'a été modifié pour ces mesures.
