# Aven — socle natif (WinUI 3 + .NET 8)

Phase 0 du protocole [MIGRATION-WINUI.md](../MIGRATION-WINUI.md) : le socle natif est
créé, buildé en CI, et produit un **artefact MSIX**. L'app Electron reste la version
de production — ce dossier n'a aucun effet sur elle.

## Contenu

| Projet | Rôle | Phase |
|---|---|---|
| `src/Aven.Native` | Coquille WinUI 3 (fenêtre vide, packagée MSIX) | 0 → évolue en phases 2-6 |
| `src/Aven.Bridge` | Pont JSON-RPC 2.0 stdio vers le moteur sidecar — **implémenté et testé** (routage par id, notifications push, erreurs typées, tolérance aux lignes corrompues) | 0 → complété en phase 1 |
| `tests/Aven.Tests` | xUnit : contrat du pont | 0 → s'étofte à chaque phase |

`aven-engine-host.mjs` (le host Node du sidecar) sera extrait de `electron/main.ts`
en phase 1 — il n'existe volontairement pas encore.

## CI

`.github/workflows/native.yml` — job séparé, déclenché sur `native/**` :

1. `dotnet test` sur `Aven.Tests` (le contrat du pont) ;
2. `dotnet build` de la coquille WinUI en Release/x64 avec
   `GenerateAppxPackageOnBuild` → **MSIX** ;
3. upload de l'artefact `Aven.Native-msix`.

Le job Electron (`ci.yml`) continue de tourner en parallèle, inchangé.

## En local

Compiler nécessite le SDK .NET 8 (Windows) : `dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=x64`.
Les assets PNG du manifeste sont régénérables via `node scripts/gen-native-assets.mjs`.
