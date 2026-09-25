# Plugins Aven

## aven-tool-guard

Garde-fou anti-boucle pour les agents :
- bloque les appels `glob` identiques répétés 3 fois ;
- bloque une rafale de 8 appels `glob` en 60 secondes ;
- se réinitialise lorsqu'un autre outil est utilisé ;
- fonctionne au niveau de la session OpenCode.

Le but est d'éviter qu'un modèle reste bloqué dans une découverte de fichiers sans jamais passer à `read`, `grep` ou à l'action demandée.
