# Aven — migration Electron → Tauri 2

## Etat

Branche de migration : `feat/tauri-migration-v10`

La version Electron reste la version de référence pendant toute la migration. Aucun
code Electron n'est supprimé pendant les premières étapes.

## Architecture cible

```
React/Vite
   │
   │ Tauri IPC
   ▼
Tauri 2 / Rust
   │
   ├── fenêtre, tray, raccourcis, dialogs, notifications, updater
   │
   └── RPC vers le runtime Aven Node
             │
             ├── aven-engine-host.mjs → OpenCode
             └── aven-pty-host.mjs    → node-pty / Freebuff
```

## Règles

1. React reste la couche UI. `web/src/api.ts` reste la frontière d'abstraction.
2. OpenCode n'est pas réécrit : `aven-engine-host.mjs` reste le moteur.
3. Le PTY n'est pas réécrit : `aven-pty-host.mjs` reste le transport ConPTY.
4. Les données existantes (.opencode-app, .opencodeapp, workspaces, clés) gardent leur format.
5. Electron reste fonctionnel jusqu'à la parité Tauri.
6. Chaque étape doit conserver les tests et vérifications existants.

## Phases de cette branche

### 0 — Socle Tauri
- Ajouter `src-tauri/`.
- Brancher React/Vite sur Tauri.
- Ne modifier aucune fonctionnalité métier.

### 1 — Adaptateur frontend
- Remplacer progressivement `window.opencode` par une implémentation Tauri de `web/src/api.ts`.
- Conserver exactement les signatures exposées à React.
- Ajouter les flux streaming via Tauri Channels.

### 2 — Runtime Aven
- Sortir la logique non-Electron de `electron/main.ts` vers un host Node autonome.
- Garder `aven-engine-host.mjs` et `aven-pty-host.mjs` comme sidecars.

### 3 — Intégration Windows
- Fenêtre frameless/custom titlebar.
- tray + fermeture vers le tray.
- single-instance.
- raccourci global Ctrl+Shift+O.
- dialogs, opener, notifications et updater.

### 4 — Packaging
- Embarquer le runtime Node et les sidecars.
- Construire NSIS/MSI.
- Ajouter une procédure portable.
- Vérifier x64 et ARM64.

### 5 — Parité
- Exécuter les mêmes scénarios fonctionnels côté Electron et Tauri.
- Migrer ensuite les composants un par un.
- Supprimer Electron uniquement après deux releases Tauri stables.

## Premier critère d'acceptation

`npm run tauri dev` doit ouvrir Aven dans une fenêtre Tauri en utilisant le même
frontend React que l'application Electron, sans modification fonctionnelle de l'UI.
