# scripts/launch-native.ps1 - lance l'app native WinUI (phase 2+ du protocole
# MIGRATION-WINUI.md) pour validation visuelle : Mica, title bar, hub, chat,
# vues Fichiers/Notes, terminal Freebuff (PTY via micro-host Node).
#
# ATTENTION : 100% ASCII - PowerShell 5.1 lit les .ps1 sans BOM en code page
# ANSI ; tout accent casse le parsing (piege recurrent du projet).
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
    Write-Host "Build de l'app native (x64, Release)..."
    dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=x64 --nologo
    if ($LASTEXITCODE -ne 0) { throw "Build en echec." }
}

if (-not (Test-Path $exe)) {
    # Self-contained : avec RID explicite l'exe sort dans le sous-dossier win-x64\
    # (meme PIEGE que package-native.ps1) - c'est lui le layout d'execution.
    $rid = Join-Path (Split-Path $exe) "win-x64\Aven.Native.exe"
    if (Test-Path $rid) { $exe = $rid }
}
if (-not (Test-Path $exe)) { throw "Executable introuvable : $exe (build d'abord, sans -NoBuild)." }

# Le PTY natif a besoin du bundle dist-electron/aven-pty-host.mjs (build:electron).
$ptyHost = Join-Path $racine "dist-electron\aven-pty-host.mjs"
if (-not (Test-Path $ptyHost)) {
    Write-Host "Bundle PTY absent - build:electron..."
    Push-Location $racine
    npm run build:electron
    Pop-Location
}

Write-Host "Lancement : $exe"
Start-Process -FilePath $exe -WorkingDirectory $racine
Write-Host "App lancee. Points a verifier (validation visuelle) :
  - Mica + title bar etendue, hub 4 cartes anime (cascade 45 ms)
  - Carte Projet -> chat (streaming, Arreter/Echap, modeles)
  - Cartes Fichiers/Notes -> explorateur et notes (pins/tags)
  - Carte Taches / bouton Freebuff -> terminal : session, quota, Arreter"
