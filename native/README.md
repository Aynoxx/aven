# Aven — socle natif (WinUI 3 + .NET 8)

Phase 0 du protocole [MIGRATION-WINUI.md](../MIGRATION-WINUI.md) : le socle natif est
créé, buildé en CI, et produit un **artefact MSIX**. L'app Electron reste la version
de production — ce dossier n'a aucun effet sur elle.

## Contenu

| Projet | Rôle | Phase |
|---|---|---|
| `src/Aven.Native` | Coquille WinUI 3 (fenêtre vide, packagée MSIX) | 0 → évolue en phases 2-6 |
| `src/Aven.Bridge` | Pont JSON-RPC 2.0 stdio : `JsonRpcConnection` (socle) + `EngineClient` (spawn du host, push d'événements) — **testés** | 1 → complété en phase 4 |
| `tests/Aven.Tests` | xUnit : contrat du pont + **conversation complète** (create → send → events → messages) + test du vrai bundle `aven-engine-host.mjs` | 1 → s'étofte à chaque phase |

L'acceptation de la **phase 1** est en place : `aven-engine-host.mjs` (extrait de
`electron/main.ts`, bundlé esbuild via `npm run build:electron`) pilote le moteur
et l'Electron lui-même lui parle désormais par JSON-RPC — le même host que
consommera Aven.Native. Les tests C# rejouent le protocole (scénario factice
fidèle) et exercent le vrai bundle quand `dist-electron/` est présent (le fait
dans CI après `npm run build:electron`).

## CI

`.github/workflows/native.yml` — job séparé, déclenché sur `native/**` :

1. `dotnet test` sur `Aven.Tests` (le contrat du pont) ;
2. `dotnet build` de la coquille WinUI en Release/x64 avec
   `GenerateAppxPackageOnBuild` → **MSIX** ;
3. upload de l'artefact `Aven.Native-msix`.

Le job Electron (`ci.yml`) continue de tourner en parallèle, inchangé.

## En local — tout se prouve SANS GitHub

    npm run test:native

Installe le SDK .NET 8 dans `tools/dotnet-sdk` au premier lancement (gitignoré,
sans droits admin), puis enchaîne : **10 tests xUnit** du pont + **build MSIX**
de la coquille dans `native/.tmp-msix/` (installable via le `Install.ps1`
généré). `--no-msix` pour les seuls tests. Les assets PNG du manifeste sont
régénérables via `node scripts/gen-native-assets.mjs`.
