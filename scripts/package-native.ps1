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
    [switch]$NoPortable,
    [string]$NodeExe = "",
    [string]$NodeVersion = "v22.14.0"
)

$ErrorActionPreference = "Stop"
# nodejs.org exige TLS 1.2 (PowerShell 5.1 ne le négocie pas toujours seul).
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$racine = Split-Path -Parent $PSScriptRoot
$sdk = Join-Path $racine "tools\dotnet-sdk"
$env:DOTNET_ROOT = $sdk
$env:PATH = "$sdk;$env:PATH"

$manifestPath = Join-Path $racine "native\src\Aven.Native\Package.appxmanifest"
$manifest = [xml](Get-Content $manifestPath)
$publisher = $manifest.Package.Identity.Publisher
$version = $manifest.Package.Identity.Version
Write-Host "Publisher du manifeste : $publisher (version $version)"

# --- Node par architecture (autonomie du portable) -------------------------
# Machine cible d'un PE (0x8664=x64, 0x014c=x86, 0xaa64=ARM64) : lecture directe
# de l'en-tete sans charger le fichier (e_lfanew a 0x3C, machine a +4).
function Get-PEMachine {
    param([string]$Path)
    $flux = [System.IO.File]::OpenRead($Path)
    try {
        $tete = New-Object byte[] 4096
        [void]$flux.Read($tete, 0, 4096)
        $eLfanew = [BitConverter]::ToInt32($tete, 0x3C)
        if ($eLfanew -le 0 -or ($eLfanew + 6) -gt $flux.Length) { return 0 }
        $pe = New-Object byte[] 4096
        $flux.Position = $eLfanew
        [void]$flux.Read($pe, 0, 4096)
        return [BitConverter]::ToUInt16($pe, 4)
    } finally { $flux.Dispose() }
}

# node.exe de L'architecture demandee : -NodeExe explicite > node systeme si son
# PE matche > cache local > telechargement officiel nodejs.org (exe direct x86/x64,
# zip pour ARM64). Jamais de node d'une autre arch dans un portable.
function Resolve-NodeArchitecture {
    param([string]$arch)
    $machineAttendue = @{ "x64" = 0x8664; "x86" = 0x014c; "arm64" = 0xaa64 }[$arch]

    if ($NodeExe -ne "" -and (Test-Path $NodeExe)) { return $NodeExe }

    # x86 : le paquet ConPTY node-pty-win32-x86 N'EXISTE PAS (npm 404, constat
    # 01/10/2026) - un portable x86 embarque donc le node X64 (l'app 32-bit peut
    # spawner des enfants 64-bit ; seuls les Windows 32-bit purs sont exclus).
    if ($arch -eq "x86") { return (Resolve-NodeArchitecture -arch "x64") }

    $systeme = (Get-Command node -ErrorAction SilentlyContinue).Source
    if ($systeme -and (Test-Path $systeme) -and ((Get-PEMachine $systeme) -eq $machineAttendue)) {
        return $systeme
    }

    $cacheDir = Join-Path $racine "native\.out\node-cache\node-$NodeVersion-win-$arch"
    $cacheExe = Join-Path $cacheDir "node.exe"
    if (Test-Path $cacheExe) { return $cacheExe }
    New-Item -ItemType Directory -Path $cacheDir -Force | Out-Null
    $client = New-Object System.Net.WebClient
    try {
        if ($arch -ne "arm64") {
            $url = "https://nodejs.org/dist/$NodeVersion/win-$arch/node.exe"
            Write-Host "  Telechargement $url ..."
            $client.DownloadFile($url, $cacheExe)
        } else {
            $url = "https://nodejs.org/dist/$NodeVersion/node-$NodeVersion-win-arm64.zip"
            $zipCache = Join-Path $cacheDir "node.zip"
            Write-Host "  Telechargement $url ..."
            $client.DownloadFile($url, $zipCache)
            Expand-Archive -Path $zipCache -DestinationPath $cacheDir -Force
            $extrait = Get-ChildItem $cacheDir -Recurse -Filter node.exe | Select-Object -First 1 -ExpandProperty FullName
            if (-not $extrait) { throw "node.exe absent du zip ARM64." }
            Copy-Item $extrait $cacheExe -Force
            Remove-Item $zipCache -Force
        }
    } catch {
        Write-Host "  Telechargement node $arch en echec : $($_.Exception.Message)"
        return ""
    }
    if ((Test-Path $cacheExe) -and ((Get-PEMachine $cacheExe) -ne $machineAttendue)) {
        Write-Host "  node telecharge : mauvaise architecture (PE non $arch)."
        return ""
    }
    return $cacheExe
}

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
    # Sous-dossier RID du runtime self-contained (PIÈGE 01/10/2026 : hardcoder
    # win-x64 laisse x86/ARM64 à un niveau de trop - nodejs/ et l'exe désalignés).
    if (Test-Path (Join-Path $bin "win-$arch\Aven.Native.exe")) { $bin = Join-Path $bin "win-$arch" }
    if (-not (Test-Path (Join-Path $bin "Aven.Native.exe"))) {
        Write-Host "Build $arch..."
        # RID explicite : sans lui le RID inféré est celui de la machine hôte
        # (win-x64) et x86/ARM64 échouent en NETSDK1032 (PIÈGE, 01/10/2026).
        dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=$arch -p:RuntimeIdentifier=win-$arch --nologo
        if ($LASTEXITCODE -ne 0) { throw "Build $arch en echec." }
    }

    # --- 2. MSIX signe ---
    $pkgDir = Join-Path $outRoot "$arch"
    dotnet build native/src/Aven.Native/Aven.Native.csproj -c Release -p:Platform=$arch -p:RuntimeIdentifier=win-$arch --nologo `
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
        # x86 : node-pty-win32-x86 n'existe pas (npm 404) - le portable x86
        # embarque le paquet x64 (cohérent avec le fallback node x64).
        $archPty = $arch; if ($archPty -eq "x86") { $archPty = "x64" }
        $ptyPkgs = @("node-pty", "node-pty-win32-$archPty")
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
        # Node embarque (autonomie terminal), PAR ARCHITECTURE : le transport
        # resout node.exe adjacent (portable\nodejs\node.exe) avant le PATH.
        $nodeSrc = Resolve-NodeArchitecture -arch $arch
        if ($nodeSrc -and (Test-Path $nodeSrc)) {
            $nodeDir = Join-Path $portable "nodejs"
            New-Item -ItemType Directory -Path $nodeDir -Force | Out-Null
            Copy-Item $nodeSrc (Join-Path $nodeDir "node.exe") -Force
            $nodeMo = [math]::Round((Get-Item (Join-Path $nodeDir "node.exe")).Length / 1MB)
            $archReelle = @{ 0x8664 = "x64"; 0x014c = "x86"; 0xaa64 = "arm64" }[(Get-PEMachine $nodeSrc)]
            Write-Host "  Node embarque : nodejs\node.exe ($nodeMo Mo, PE $archReelle)"
        } else {
            Write-Host "  AVERTISSEMENT : node.exe $arch indisponible - le terminal exigera Node sur la machine cible."
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
