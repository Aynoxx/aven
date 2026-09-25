# Modèles gratuits — Aven v8.7.5

Aven utilise désormais un catalogue explicitement gratuit et ne sélectionne jamais un modèle payant.

## OpenCode gratuits intégrés

- DeepSeek V4 Flash Free — `opencode/deepseek-v4-flash-free`
- MiMo-V2.5 Free — `opencode/mimo-v2.5-free`
- Laguna S 2.1 Free — `opencode/laguna-s-2.1-free`
- Ling-3.0-tiny Free — `opencode/ling-3.0-tiny-free`
- LongCat-2.0 Free — `opencode/longcat-2.0-free`
- North Mini Code Free — `opencode/north-mini-code-free`
- Nemotron 3 Ultra Free — `opencode/nemotron-3-ultra-free`
- Big Pickle — `opencode/big-pickle`

## Secours OpenRouter

Les variantes explicitement marquées `:free` restent possibles en dernier recours. Le routeur automatique OpenRouter reste volontairement tout à la fin, notamment pour éviter de reproduire le problème `User not found` avant d'avoir essayé les modèles OpenCode gratuits.

## Correction du problème « modèle qui ne fonctionne pas »

Aven ne fait plus confiance aveuglément à `model-priorities.json` : au démarrage, il compare la table avec `model.list()` d'OpenCode. Les modèles gratuits réellement découverts mais absents d'une ancienne table sont ajoutés dynamiquement. Un modèle absent, désactivé ou obsolète n'est pas attribué.

Le routeur v8.7.3 est conservé : sélection explicite par agent, cooldown modèle/fournisseur, bascule sur erreur et protection contre les répétitions.
