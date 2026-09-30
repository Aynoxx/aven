# scripts/package-native.ps1 - packaging phase 7 (MIGRATION-WINUI.md) :
#   1. certificat de signature auto-gere (CurrentUser\My, aligne sur le Publisher
#      du manifeste, cree une fois, reutilise - JAMAIS commite)
#   2. build MSIX SIGNE par architecture (x86/x64/ARM64 via -Archs)
#   3. verification signtool (le paquet est-il reellement signe ?)
#   4. zip portable (layout bin + moteurs sidecar - la meme app sans installation)
#
# ATTENTION : ce fichier doit rester 100% ASCII - PowerShell lit les .ps1 sans BOM
# en code page ANSI et tout accent casse le parsing (piege recurrent du projet).
#
# Usage :
#   powershell -NoProfile -File scripts/package-native.ps1                 # x64
#   powershell -NoProfile -File scripts/package-native.ps1 -Archs arm64    # ARM64
#   powershell -NoProfile -File scripts/package-native.ps1 -NoPortable     # MSIX seul
param(
    [string[]]$Archs = @("x64"),
    [switch]$NoPortable
)

$ErrorActionPreference = "Stop"
$racine = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $racine "tools\dotnet-sdk"
$env:DOTNET_ROOT = $sdk
$env:PATH = "$sdk;$env:PATH"

$manifestPath = Join-Path $racine "native\src\Aven.Native\Package.appxmanifest"
$manifest = [xml](Get-Content $manifestPath)
$publisher = $manifest.Package.Identity.Publisher
$version = $manifest.Package.Identity.Version
Write-Host "Publisher du manifeste : $publisher (version $version)"

# --- 1. Certificat (cree une fois, aligne sur le Publisher) ---
$stampFile = Join-Path $racine "native\.cert-thumbprint"
$needNew = -not (Test-Path $stampFile)
if (-not $needNew) {
    $thumb = (Get-Content $stampFile -Raw).Trim()
    $existing = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $thumb }
    $needNew = ($existing | Measure-Object).Count -eq 0
}
if ($needNew) {
    Write-Host "Creation du certificat de signature ($publisher)..."
    $cert = New-SelfSignedCertificate -Type CodeSigningCert -Subject $publisher `
        -KeyUsage DigitalSignature -FriendlyName "Aven native (dev)" `
        -CertStoreLocation "Cert:\CurrentUser\My" `
        -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3", "2.5.29.19={text}")
    Set-Content -Path $stampFile -Value $cert.Thumbprint
} else {
    $cert = Get-ChildItem Cert:\CurrentUser\My | Where-Object { $_.Thumbprint -eq $thumb } | Select-Object -First 1
}
$thumbprint = $cert.Thumbprint
Write-Host "Certificat : $thumbprint (CurrentUser\My - jamais exporte ni commite)"

# Export .cer public + import TrustedPeople (CurrentUser, silencieux) : le flux
# sideload canonique - sans lui, Windows refuse d'installer le MSIX self-signed.
$cerPath = Join-Path $racine "native\.out\aven-dev-signing.cer"
New-Item -ItemType Directory -Path (Split-Path $cerPath) -Force | Out-Null
Export-Certificate -Cert $cert -FilePath $cerPath | Out-Null
$people = Get-ChildItem Cert:\CurrentUser\TrustedPeople | Where-Object { $_.Thumbprint -eq $thumbprint }
if (($people | Measure-Object).Count -eq 0) {
    Import-Certificate -FilePath $cerPath -CertStoreLocation Cert:\CurrentUser\TrustedPeople | Out-Null
    Write-Host "Certificat public importe dans CurrentUser\TrustedPeople"
}

# signtool : livre avec les Windows SDK Build Tools (paquet NuGet du projet).
$signtool = Get-ChildItem (Join-Path $env:USERPROFILE ".nuget\packages\microsoft.windows.sdk.buildtools") -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
    Where-Object { $_.FullName -match "x64" } | Select-Object -First 1 -ExpandProperty FullName
if (-not $signtool) { throw "signtool introuvable (microsoft.windows.sdk.buildtools)." }

$outRoot = Join-Path $racine "native\.out"
foreach ($arch in $Archs) {
    $arch = $arch.ToLowerInvariant()
    Write-Host ""
    Write-Host "=== Architecture $arch ==="
    $bin = Join-Path $racine "native\src\Aven.Native\bin\$arch\Release\net8.0-windows10.0.19041.0"
    # Avec SelfContained, le runtime .NET embarque vit dans le sous-dossier RID
    # (win-x64\...) : c'est LUI le layout d'execution complet a embarquer.
    if (Test-Path (Join-Path $bin "win-x64\Aven.Native.exe")) { $bin = Join-Path $bin "win-x64" }
    if (-not (Test-Path (Join-Path $bin "Aven.Native.exe"))) {
        Write-Host "Build $arch..."
        dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=$arch --nologo
        if ($LASTEXITCODE -ne 0) { throw "Build $arch en echec." }
    }

    # --- 2. MSIX signe ---
    $pkgDir = Join-Path $outRoot "$arch"
    dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=$arch --nologo `
        -p:GenerateAppxPackageOnBuild=true -p:UapAppxPackageBuildMode=SideloadOnly -p:AppxBundle=Never `
        -p:AppxPackageSigningEnabled=true -p:PackageCertificateThumbprint=$thumbprint `
        -p:AppxPackageDir="$pkgDir\"
    if ($LASTEXITCODE -ne 0) { throw "Packaging $arch en echec." }
    $msix = Get-ChildItem $pkgDir -Recurse -Filter "*.msix" | Select-Object -First 1
    if (-not $msix) { throw "Aucun .msix produit pour $arch." }
    Write-Host ("  MSIX signe : " + $msix.FullName)

    # --- 3. Verification : signtool reconnait une signature primaire intacte.
    # Exit 0 = signe ET chaîne ancrée ; "not trusted by the trust provider" = signe
    # (self-signed : racine non ancrée, flux DEV attendu - l'INSTALL de sideload
    # dépend de TrustedPeople, pas de ce verdict) ; toute autre erreur = échec dur.
    # ErrorActionPreference=Stop + 2>&1 : PowerShell 5.1 transforme la 1re ligne
    # stderr native en erreur terminante - on relache localement (classique).
    $ErrorActionPreference = "Continue"
    $verif = (& $signtool verify /pa /v $msix.FullName 2>&1) | Out-String
    $code = $LASTEXITCODE
    $ErrorActionPreference = "Stop"
    if ($code -eq 0) {
        Write-Host "  signtool verify : OK (signature valide et ancree)"
    } elseif ($verif -match "not trusted by the trust provider") {
        Write-Host "  signtool verify : SIGNE (self-signed - racine non ancrée, attendu en dev)"
    } else {
        Write-Host $verif
        throw "signtool verify en echec dur pour $arch (code $code)."
    }

    # --- 4. Zip portable ---
    if (-not $NoPortable) {
        $ptyHost = Join-Path $racine "dist-electron\aven-pty-host.mjs"
        if (-not (Test-Path $ptyHost)) { throw "aven-pty-host.mjs absent - lancer npm run build:electron d'abord." }
        $portable = Join-Path $outRoot "portable-$arch"
        if (Test-Path $portable) { Remove-Item $portable -Recurse -Force }
        New-Item -ItemType Directory -Path $portable | Out-Null
        # Layout d'execution complet (self-contained .NET + WASDK) + hotes sidecar.
        Copy-Item "$bin\*" $portable -Recurse -Force
        New-Item -ItemType Directory -Path (Join-Path $portable "dist-electron") -Force | Out-Null
        Copy-Item (Join-Path $racine "dist-electron\aven-engine-host.mjs") (Join-Path $portable "dist-electron\")
        Copy-Item $ptyHost (Join-Path $portable "dist-electron\")
        # Le micro-host PTY charge @lydell/node-pty relativement a dist-electron/..
        # (meme logique que ptyModulePath) : embarquer le paquet + son binaire de
        # plateforme - sinon le terminal ne demarre que sur une machine de dev.
        $ptyPkgs = @("node-pty", "node-pty-win32-$arch")
        foreach ($pkg in $ptyPkgs) {
            $src = Join-Path $racine "node_modules\@lydell\$pkg"
            if (Test-Path $src) {
                $dst = Join-Path $portable "node_modules\@lydell\$pkg"
                New-Item -ItemType Directory -Path (Split-Path $dst) -Force | Out-Null
                Copy-Item $src $dst -Recurse -Force
            } else {
                Write-Host "  AVERTISSEMENT : $pkg absent (npm install d'abord) - PTY incomplet."
            }
        }
        $zip = Join-Path $outRoot "Aven-native-$arch-$version.zip"
        Compress-Archive -Path "$portable\*" -DestinationPath $zip -Force
        $mo = [math]::Round((Get-Item $zip).Length / 1MB)
        Write-Host "  Portable : $zip ($mo Mo)"
    }
}

Write-Host ""
Write-Host "Packaging termine : $outRoot"
Write-Host "Certificat public : $cerPath (a importer en TrustedPeople sur une machine cible ;" 
Write-Host "le poste de dev est deja configure par ce script)."
