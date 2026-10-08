# AGENTS.md — Aven

**Lis `RULES.md` AVANT de modifier quoi que ce soit.** Il contient les règles
universelles du projet : typographie (tokens CSS, tailles, graisses), format des
boutons (classes `.button.*`), icônes (`<Icon name />` uniquement), langue et
commentaires versionnés, architecture host/renderer (Tauri), IPC, sécurité, tests et sondes.

Résumé en dix secondes :

1. **Imite les fichiers voisins** avant d'inventer — le style du projet prime.
2. **Français partout** (UI, commentaires, commits), identifiants en anglais.
3. **Aucune valeur visuelle en dur** : tokens CSS (`--font-size-*`, `--text`,
   `--accent`…) ; boutons = classes `.button.*` ; icônes = `<Icon name="…" />`.
4. **Logique décisionnelle en modules purs** `host/*.ts` testables sans
   Tauri ni Node desktop (uniquement `node:*` + `tests/*.test.mjs`) ; secrets
   jamais côté renderer.
5. **Boucle obligatoire** : `npm run typecheck:host` && `npm test` &&
   `npm run verify` verts, build régénéré si du compilé change.
6. Chaque version **fige ses conventions en sondes** (`scripts/verify-v*.mjs`) :
   ajoute la tienne si ton intègre une convention nouvelle.

En cas de conflit entre ce fichier et `RULES.md`, `RULES.md` fait foi.
