# Bibliothèque d’icônes

Toutes les icônes créées ou utilisées par l’interface principale de l’application sont centralisées dans `Icon.tsx`.

## Règle
- Ajouter une nouvelle icône dans le type `IconName` et dans `paths()`.
- Utiliser `<Icon name="..." />` dans les composants au lieu de créer un nouveau `<svg>` ou d’utiliser un caractère Unicode comme icône.
- Garder `currentColor` afin que l’icône hérite automatiquement du thème et de la couleur d’accent.
- Les logos/icônes de services tiers conservés dans `public/icons.svg` restent séparés : ce fichier est un sprite de ressources externes et non la bibliothèque des icônes d’interface.

Le visuel de marque/favicone est conservé séparément dans `web/public/icons/brand-mark.svg`, car il est servi comme ressource statique par le navigateur.
