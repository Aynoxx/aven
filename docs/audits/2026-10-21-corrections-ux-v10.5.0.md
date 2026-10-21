# Corrections UX d’Aven — v10.5.0

**Date :** 21 octobre 2026  
**Base :** `main` v10.4.0  
**Branche :** `ux/review-corrections-v10.5.0`

## Périmètre

Cette passe traduit les conclusions de la review fonctionnelle en modifications du produit lancé, et non une refonte de l’architecture générale.

## Modifications

### Navigation et recherche

- Le hub affiche **Freebuff** pour le terminal CLI et **Orchestration** pour les modes de délégation de l’agent principal. Les identifiants internes restent stables afin de préserver les routes et les transitions.
- La barre supérieure de l’accueil sert uniquement à rechercher des conversations. Entrée ouvre le premier résultat correspondant ou le sélecteur complet lorsque le champ est vide ; elle ne transforme plus le champ de recherche en demande adressée à l’agent.
- L’état « aucun résultat » est informatif et ne ressemble plus à un bouton de création.
- La page de conversation nomme l’agent actif ; son accès contextuel vers les modes s’appelle **Orchestration**.
- La page CLI porte le titre **Terminal Freebuff** et explique qu’il s’agit d’une session distincte de la conversation Aven.
- Les commandes vocales du hub reconnaissent explicitement « ouvre Freebuff » et privilégient l’ouverture de la page plutôt que l’action CLI générique.

### Tâches, notes et fichiers

- La page **Orchestration** explique que le mode choisi s’applique aux prochaines demandes envoyées à l’agent principal dans l’espace actif, et distingue ce fonctionnement d’une conversation dédiée à un spécialiste.
- Dans Fichiers et Notes, le libellé indique l’agent destinataire. Les actions de transfert précisent que le texte est préparé dans le composeur et n’est pas envoyé automatiquement.
- Les actions moins fréquentes d’une note (archivage, corbeille, export) sont regroupées sous **Autres actions**, sans être supprimées.
- L’arbre Notes charge toutes les étiquettes par un appel IPC groupé. La résolution des liens sortants d’une note réutilise un inventaire de notes au lieu de le reconstruire pour chaque lien.

### Configuration et espaces

- La configuration regroupe séparément les services IA, les notifications, le terminal Freebuff, les priorités des modèles et les espaces de travail.
- Le sélecteur initial explique qu’un espace représente un dossier de projet et que les conversations, agents, priorités et explorations de fichiers dépendent de l’espace actif.
- Les libellés vocaux distinguent le bouton de conversation sur l’accueil de la dictée dans le composeur.

## Vérifications ajoutées ou réalignées

- La version est portée à **10.5.0** dans les manifests npm, Tauri et Cargo.
- `scripts/verify-v10.5.0.mjs` fixe les conventions nouvelles : destination réelle des cartes, distinction recherche/demande, agent ciblé, préparation sans envoi, accès groupé aux tags et version.
- Les sondes v9.3.0 et v9.6.0 ainsi que le smoke test Tauri attendent les nouveaux libellés visibles.
- La sonde v10.4.0 continue de vérifier les comportements qu’elle avait introduits, sans imposer que la version du produit reste 10.4.0.

## Validation à terminer

Les fichiers ont été modifiés sur la branche dédiée. La compilation TypeScript, les tests unitaires, `npm run verify` et le smoke test Tauri doivent être confirmés par l’exécution CI avant de considérer la passe comme validée. Un test du binaire graphique actuel n’a pas été lancé directement pendant la modification.
