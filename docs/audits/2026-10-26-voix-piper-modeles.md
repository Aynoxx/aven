# Voix Piper supplémentaires — essai du 2026-10-26

> **Révision en fin de document (2026-10-26) : après écoute, deux voix locales
> sont livrées — Tom (défaut) et Siwis ; Voix A et Voix B ont été retirées.**

## Objet

Tester les trois modèles français du dépôt
[French-tts-model-piper](https://github.com/tjiho/French-tts-model-piper) avec le
binaire Piper déjà embarqué dans Aven (`2023.11.14-2`), puis les rendre
disponibles dans **Réglages → Agent vocal**. Après écoute, **Voix A** a été
retenue comme voix par défaut, avec un débit calé sur celui de Siwis.

Les fichiers ont été téléchargés dans `src-tauri/resources/piper/voices` sous des
noms neutres :

| Identifiant Aven | Fichier source | Entraînement (README du dépôt) |
|---|---|---|
| `fr_FR-voix-a-medium` | `model 1/tom1.onnx` | deux corpus (articles + Baudelaire) |
| `fr_FR-voix-b-medium` | `model 2/tom2.onnx` | corpus Baudelaire seul |
| `fr_FR-voix-c-medium` | `model 3/next.onnx` | Baudelaire, 300 époques de plus |

## Méthode

- Même phrase pour les quatre voix : « Bonjour, je suis Aven. Freebuff est un
  poste de travail pour les agents, les notes et le code. »
- `length_scale = 1.0` pour comparer les modèles à leur débit d'origine ; l'app
  applique ensuite `PIPER_LENGTH_SCALE = 1.1`.
- Mesure du temps mural autour du processus Piper, puis lecture de l'en-tête WAV
  pour la durée réelle et la fréquence d'échantillonnage.
- Aucun GPU : Piper tourne sur le CPU.

## Résultats

| Voix | Synthèse | Audio produit | RTF (synthèse / audio) | Fréquence |
|---|---:|---:|---:|---:|
| Siwis | 2 201 ms | 6,37 s | 0,35 | 22 050 Hz |
| Voix A | 3 322 ms | 6,77 s | 0,49 | 44 100 Hz |
| Voix B | 3 099 ms | 6,52 s | 0,47 | 44 100 Hz |
| Voix C | 3 334 ms | 7,57 s | 0,44 | 44 100 Hz |

Les trois modèles sont plus lents que Siwis d'environ 50 % en temps de calcul,
mais restent **plus rapides que le temps réel** (RTF < 1). Leur audio est en
44,1 kHz, contre 22,05 kHz pour Siwis.

## Essai dans l'app

Le host réel, lancé avec `AVEN_PIPER_DIR`, expose les quatre identifiants
`piper:` et répond à `voiceAgentPreview` :

| Voix | Synthèse host | Audio |
|---|---:|---:|
| Siwis | 1 455 ms | 6,76 s |
| Voix A | 2 460 ms | 7,08 s |
| Voix B | 2 333 ms | 6,79 s |
| Voix C | 2 690 ms | 8,09 s |

Ces mesures utilisent le débit de l'app (`PIPER_LENGTH_SCALE = 1.1`), d'où des
durées légèrement plus longues que le tableau précédent. Dans la webview, le
bouton « Tester la voix » a lu les quatre voix sans erreur ; le temps entre le
clic et le retour du bouton (synthèse + lecture de la phrase d'aperçu) était de
**5,1 s** pour Siwis, **6,3 s** pour A, **6,8 s** pour B et **7,0 s** pour C.
La voix a ensuite été remise sur Siwis pour l'essai, puis Voix A a été retenue
comme voix par défaut.

## Calage du débit de Voix A

Le réglage global de Siwis (`PIPER_LENGTH_SCALE = 1.1`) ne convient pas à Voix A :
à 1,1 elle dure 7,22 s sur la phrase de référence, soit ~9 % de plus que Siwis
(6,64 s). Trois mesures par réglage ont été prises :

| Réglage | Durée médiane | Écart vs Siwis 1,1 |
|---|---:|---:|
| Siwis, 1,1 | 6,681 s | — |
| Voix A, 1,0 | 6,971 s | +4,3 % |
| Voix A, 0,98 | 6,739 s | +0,9 % |
| Voix A, 0,96 | 6,547 s | −2,0 % |

**0,98** est retenu : c'est le réglage le plus proche du rythme de Siwis sans
accélérer au-delà. Le débit est désormais **par voix** dans
`PIPER_LENGTH_SCALES` ; Siwis garde 1,10, B et C aussi.

## Ce qui n'a pas été mesuré

- **Le timbre** : l'agent ne peut pas juger une voix à l'oreille. Les WAV de
  comparaison sont dans `artifacts/piper-voices/` pour une écoute humaine.
- La latence d'un tour vocal complet (STT + LLM + TTS) avec ces voix : seule la
  synthèse et la lecture de l'aperçu sont mesurées ici.
- La qualité sur des phrases longues ou des nombres.

## Licence et conditions d'usage

Les poids sont publiés sous **AGPL-3.0**. Le dépôt précise qu'un programme qui
charge les poids tels quels n'en devient pas une œuvre dérivée, mais que leur
redistribution reste soumise à l'AGPL et à ses obligations de mention. Toute
modification des poids (fine-tuning, quantification, conversion) est une œuvre
dérivée.

La voix reproduit une personne réelle : la licence interdit de la présenter
comme celle d'une personne réelle ou identifiée, et demande que l'identité de
l'auteur ne soit ni mentionnée dans le service ni communiquée aux utilisateurs
finaux. Les libellés d'Aven restent donc neutres (« Voix A/B/C »), et le
fichier `LICENSE-french-tts-model-piper.txt` est livré avec les poids.

**Conséquence pratique** : usage personnel et local conforme ; une
redistribution d'Aven avec ces poids devrait fournir la licence et la source,
et ne pourrait pas les présenter comme une voix identifiée. Voix A est la voix
par défaut ; Siwis reste disponible et sert de secours si A manque.

## Révision du 2026-10-26 — une seule voix : Tom

Après écoute des quatre voix, l'utilisateur a retenu **Tom**, qui était déjà
livrée sous le nom neutre « Voix C » : `fr_FR-tom-medium.onnx` (catalogue Piper
officiel) et `fr_FR-voix-c-medium.onnx` ont le même sha256 (`bf65074c…`). Le
fichier officiel a été renommé `fr_FR-tom-medium.*` ; Siwis, Voix A et Voix B
ont été supprimées du disque et du menu.

### Calage du débit

Mesures sur la phrase de référence, passes entrelacées (7 prises par réglage) :

| Réglage | Durée médiane | Écart vs Siwis 1,10 |
|---|---:|---:|
| Siwis, 1,10 | 6,635 s | — |
| Tom, 0,98 | 7,006 s | +5,6 % |
| Tom, 0,96 | 6,890 s | +3,8 % |
| Tom, 0,94 | 6,727 s | +1,4 % |

**0,92** est retenu : il avait mesuré +0,9 % lors d'une passe antérieure, et
l'écart restant est sous le bruit des prises (6,5 à 7,5 s selon la prise).

### Décision

Une seule voix locale : Tom, défaut, 0,92. `npm run fetch:piper` ne pose plus
que le binaire, ce modèle et la licence — environ 90 Mo au lieu de 280 Mo. Edge
reste la voix principale et la voix Windows le dernier recours. Le libellé de
l'interface reste neutre, comme l'exige la licence de la voix.

### Révision du même soir — Siwis restaurée

L'utilisateur a demandé de garder **deux voix locales** : Tom (défaut, 0,92) et
Siwis (secours, 1,10). Siwis est retéléchargée par `npm run fetch:piper` ; les
deux variantes de Tom (ex-Voix A et B) restent supprimées. L'installeur repasse
d'environ 90 Mo à 155 Mo.
