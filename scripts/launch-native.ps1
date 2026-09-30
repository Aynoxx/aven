# scripts/launch-native.ps1 — lance l'app native WinUI (phase 2+ du protocole
# MIGRATION-WINUI.md) pour validation visuelle : Mica, title bar, hub, chat,
# vues Fichiers/Notes, terminal Freebuff (PTY via micro-host Node).
#
# Usage :
#   powershell -NoProfile -File scripts/launch-native.ps1           # build si besoin + lance
#   powershell -NoProfile -File scripts/launch-native.ps1 -NoBuild  # lance sans rebuilder
param(
    [switch]$NoBuild
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $racine "tools\dotnet-sdk"
$env:DOTNET_ROOT = $sdk
$env:PATH = "$sdk;$env:PATH"
$exe = Join-Path $racine "native\src\Aven.Native\bin\x64\Release\net8.0-windows10.0.19041.0\Aven.Native.exe"

if (-not $NoBuild) {
    Write-Host "Build de l'app native (x64, Release)…"
    dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=x64 --nologo
    if ($LASTEXITCODE -ne 0) { throw "Build en échec." }
}

if (-not (Test-Path $exe)) { throw "Exécutable introuvable : $exe (build d'abord, sans -NoBuild)." }

# Le PTY natif a besoin du bundle dist-electron/aven-pty-host.mjs (build:electron).
$ptyHost = Join-Path $racine "dist-electron\aven-pty-host.mjs"
if (-not (Test-Path $ptyHost)) {
    Write-Host "Bundle PTY absent — build:electron…"
    Push-Location $racine
    npm run build:electron
    Pop-Location
}

Write-Host "Lancement : $exe"
Start-Process -FilePath $exe -WorkingDirectory $racine
Write-Host "App lancée. Points à vérifier (validation visuelle) :
  - Mica + title bar étendue, hub 4 cartes animé (cascade 45 ms)
  - Carte Projet -> chat (streaming, Arrêter/Échap, modèles)
  - Cartes Fichiers/Notes -> explorateur et notes (pins/tags)
  - Carte Tâches / bouton Freebuff -> terminal : session, quota, Arrêter"
