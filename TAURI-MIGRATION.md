# Aven v10.0.0 — état de la migration Tauri 2

## Décision d'architecture

La branche `feat/tauri-migration-v10` est la version cible d'Aven. L'application utilise une seule pile de bureau :

```
React / Vite
    │
    │ Tauri IPC : commande aven_call + événement aven:event
    ▼
Tauri 2 / Rust
    ├── fenêtre Windows, dialogues système, raccourcis et notifications
    ├── registre des espaces de travail, ouverture des chemins et écriture de fichiers
    └── runtime Node.js embarqué
          ├── aven-app-host.mjs   → API métier / état applicatif
          ├── aven-engine-host.mjs → OpenCode
          └── aven-pty-host.mjs    → node-pty / terminal Freebuff
```

Le renderer React reste partagé. `web/src/api.ts` est la frontière d'abstraction et `web/src/api-tauri.ts` traduit les appels frontend vers l'IPC Tauri. Les contrats métier restent dans le runtime Node ; Rust garde les opérations système qui lui appartiennent.

## Suppression des anciennes piles

La v10 n'embarque plus le shell Electron, son preload, electron-builder, son updater ni le prototype WinUI 3/C#. Les dossiers `electron/` et `native/`, leurs workflows et le protocole de migration WinUI sont retirés. Les dépendances supprimées doivent aussi disparaître de `package-lock.json` : le test de convention v10 verrouille cette exigence.

Les mentions d'Electron dans l'historique du README décrivent les versions v9 antérieures et ne sont pas des dépendances ou des chemins d'exécution de la v10.

## Parité avec la version v9 de référence

La migration conserve les fonctionnalités d'application du renderer et les contrats métier qui existaient côté Electron : démarrage OpenCode, agents, conversations, approbations, notes, fichiers, espaces de travail, réglages, statistiques, dictée et terminal Freebuff. Les contrôles de fenêtre personnalisés ne sont plus exposés par le renderer : la barre native Windows les remplace.

Les appels d'espaces de travail ont des correspondances explicites et testées :
- `workspaces` → `workspace:list`
- `switchWorkspace` → `workspace:switch`
- `removeWorkspace` → `workspace:remove`
- création/ajout → `workspace:add`

La vérification de mises à jour n'est pas activée dans cette migration : elle dépend de l'existence d'une release Tauri publiée. Ce travail ne publie aucune release et ne prétend pas valider le processus d'updater.

## Validation obligatoire avant de faire de Tauri le main

La CI Windows `.github/workflows/ci-windows.yml` exécute, dans cet ordre :
1. installation des dépendances et synchronisation des verrous ;
2. vérification TypeScript, tests Node, build web et build des hosts ;
3. `npm run verify` ;
4. téléchargement contrôlé du runtime Node embarqué, puis `cargo check` et `cargo test` ;
5. build Tauri de debug et fumée de la vraie WebView2.

La fumée contrôle le rendu de la version embarquée, la CSP de production (y compris un blocage externe observable), la barre système native, l'API Tauri et la reprise après un crash du processus Node. Le test de fumée est distinct du build de packaging et doit réussir sur le commit final.

Commandes équivalentes sur Windows :

```powershell
npm install
npm run typecheck:host
npm run typecheck:tests
cd web; npx tsc -b; cd ..
npm test
npm run build:web
npm run build:host
npm run verify
node scripts/prepare-tauri-runtime.mjs
cargo check --manifest-path src-tauri/Cargo.toml
cargo test --manifest-path src-tauri/Cargo.toml
npm run tauri:check
npm run smoke:tauri
```

Aucune release ou publication d'installateurs n'est requise pour ces contrôles. La bascule de `main` vers cette pile n'est faite qu'après les vérifications de CI et les corrections de parité.
