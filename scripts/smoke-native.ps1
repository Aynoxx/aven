# scripts/smoke-native.ps1 - suite de smoke UIA reutilisable pour CHAQUE release
# portable (protocole MIGRATION-WINUI.md, validation phase 7+). Pas un one-shot :
# chaque zip Aven-native-<arch>-<version>.zip passe par ce parcours avant release.
#
# Principe : extraire le zip dans un dossier scratch, lancer Aven.Native.exe,
# piloter l'app via COM UI Automation (assembly UIAutomationClient - sans
# WinAppDriver ni dependance externe) et verrouiller le parcours critique :
#   1. hub       : les 4 cartes sont presentes et cliquables
#   2. notes     : carte Notes -> "+ Nouvelle" -> editeur visible -> "Annuler" le ferme
#   3. retour    : "Retour au hub" ramene bien le hub
#   4. fichiers  : carte Fichiers -> liste remplie -> clic dossier -> "Dossier
#                  parent" monte d'un niveau puis disparait a la racine
#   5. chat      : moteur pret AU BOOT (statut "En ligne" au hub), AUCUN spawn
#                  ni re-spawn a l'ouverture (garde _chatOuvert - non regression)
#   6. terminal  : ouverture de la vue + spawn node PTY (descendant du process app)
#   7. parametres: panneau version affiche
# Verdict : "SMOKE_OK" + code 0, ou "SMOKE_KO - etape [...] : ..." + code 1
# (avec dump UIA complet dans native\.out\smoke-uia-<arch>.txt pour diagnostic).
#
# Mode multi-arch : -Archs x64,x86,arm64 fume TOUTES les cibles en une execution.
# Une arch non executable sur la machine hote (zip arm64 sous Windows x64 : aucune
# emulation dans ce sens) est SAUTER avec une ligne SMOKE_SKIP explicite - la
# validation arm64 se fait donc sur un hote ARM64 (CI ou machine cible).
#
# ATTENTION : ce fichier doit rester 100% ASCII - PowerShell lit les .ps1 sans
# BOM en code page ANSI et tout accent casse le parsing (piege recurrent du
# projet). Les caracteres UI (accents, fleches, emoji dossier) sont construits
# via [char]0x....
#
# Usage :
#   powershell -NoProfile -File scripts/smoke-native.ps1                       # zip x64 le plus recent
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Zip <zip>            # zip portable precis
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Archs x64,x86,arm64  # multi-arch d'un coup
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Dump                 # dump UIA puis sortie
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Conserver            # garde le dossier scratch
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Dossier <dossier>    # layout deja extrait
#
# PIEGES project evites ici : variable locale JAMAIS homonyme d'un parametre
# (les variables sont insensibles a la casse), match de noms UIA en PREFIXE
# (-like "nom*") car l'egalite stricte echoue (entites XAML/accents), et
# purge des node orphelins LIMITEE aux descendants du PID de l'app lancee
# (jamais les nodes des autres sessions du poste).
param(
    [string]$Zip = "",
    [string]$Archs = "",
    [string]$Dossier = "",
    [switch]$Conserver,
    [switch]$Dump
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.IO.Compression.FileSystem

$racine = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $racine "native\.out"

$script:Tag = "zip"   # tag du zip en cours (x64/x86/arm64) : dump + messages
$script:Etape = "init"
$script:Raison = ""
$script:Fen = $null

# --- UIA : arbre, recherche par prefixe, clic Invoke --------------------------

function Elements($fen) {
    return $fen.FindAll([System.Windows.Automation.TreeScope]::Descendants,
        [System.Windows.Automation.Condition]::TrueCondition)
}

# Presence : prefixe sur le nom UIA (ou AutomationId exact avec -Id). Renvoie
# l'element ou $null apres le delai. -Cliquable exige un pattern Invoke.
function Trouver-El {
    param([string]$prefixe = "", [int]$attenteMs = 15000,
          [switch]$Cliquable, [switch]$Id, [string]$valeur = "")
    $deadline = (Get-Date).AddMilliseconds($attenteMs)
    while ($true) {
        try {
            foreach ($e in (Elements $script:Fen)) {
                try {
                    $c = $e.Current
                    $ok = if ($Id) { $c.AutomationId -eq $valeur }
                           else { $c.Name -like ($prefixe + "*") }
                    if (-not $ok) { continue }
                    if ($Cliquable) {
                        try { $null = $e.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) }
                        catch { continue }
                    }
                    return $e
                } catch { }
            }
        } catch { } # arbre en mutation pendant une animation : on refait
        if ((Get-Date) -ge $deadline) { return $null }
        Start-Sleep -Milliseconds 250
    }
}

function Scan-Presente([string]$prefixe) {
    try {
        foreach ($e in (Elements $script:Fen)) {
            try { if ($e.Current.Name -like ($prefixe + "*")) { return $true } } catch { }
        }
    } catch { }
    return $false
}

function Attendre-Absent([string]$prefixe, [int]$attenteMs = 8000) {
    $deadline = (Get-Date).AddMilliseconds($attenteMs)
    while ($true) {
        if (-not (Scan-Presente $prefixe)) { return $true }
        if ((Get-Date) -ge $deadline) { return $false }
        Start-Sleep -Milliseconds 250
    }
}

function Cliquer-El([string]$prefixe, [int]$attenteMs = 15000) {
    $el = Trouver-El -prefixe $prefixe -attenteMs $attenteMs -Cliquable
    if ($null -eq $el) { Echec "bouton introuvable (ou sans Invoke) : '$prefixe'." }
    try {
        $pat = $el.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
        $pat.Invoke() # synchrone : le handler de l'app se termine avant le retour
    } catch { Echec "clic impossible sur '$prefixe' : $($_.Exception.Message)" }
    Start-Sleep -Milliseconds 350 # laisse la bascule de vue s'installer
}

function Dump-Arbre {
    if ($null -eq $script:Fen) { return }
    $lignes = New-Object System.Collections.Generic.List[string]
    try {
        $w = $script:Fen.Current
        $lignes.Add("WINDOW | id=" + $w.AutomationId + " | name=" + $w.Name)
    } catch { }
    try {
        foreach ($e in (Elements $script:Fen)) {
            try {
                $c = $e.Current
                $ct = $c.ControlType.ProgrammaticName -replace "^ControlType\.", ""
                $lignes.Add($ct + " | id=" + $c.AutomationId + " | off=" + $c.IsOffscreen + " | name=" + $c.Name)
            } catch { }
        }
    } catch { }
    New-Item -ItemType Directory -Path $outDir -Force | Out-Null
    $fichierDump = Join-Path $outDir ("smoke-uia-" + $script:Tag + ".txt")
    $lignes | Set-Content -Path $fichierDump -Encoding UTF8
    Write-Host ("[smoke] dump UIA [" + $script:Tag + "] (" + $lignes.Count + " noeuds) : " + $fichierDump)
}

function Echec([string]$raison) {
    $script:Raison = $raison
    try { Dump-Arbre } catch { }
    throw "SMOKE_ECHEC"
}

# --- Process : fenetre + node descendants (attribution par PID) --------------

function Attendre-Fenetre([int]$pidApp, [int]$attenteMs) {
    $root = [System.Windows.Automation.AutomationElement]::RootElement
    $deadline = (Get-Date).AddMilliseconds($attenteMs)
    while ($true) {
        try {
            $cond = New-Object System.Windows.Automation.PropertyCondition(
                [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $pidApp)
            $fen = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $cond)
            if ($fen) { return $fen }
        } catch { }
        if ((Get-Date) -ge $deadline) { return $null }
        Start-Sleep -Milliseconds 400
    }
}

# node.exe appartenant a l'arbre de l'app : -Direct = enfant direct du PID
# (spawn EngineClient/transport), sinon tout descendant (via CIM ParentProcessId,
# chaaine de 12 niveaux max). Ne touche JAMAIS aux nodes des autres sessions.
function Nodes-App {
    param([int]$pidApp, [switch]$Direct)
    $parents = @{}
    $nodes = @()
    foreach ($p in (Get-CimInstance Win32_Process)) {
        $pidP = [int]$p.ProcessId
        $parents[$pidP] = [int]$p.ParentProcessId
        if ($p.Name -eq "node.exe") { $nodes += $pidP }
    }
    $resultat = @()
    foreach ($n in $nodes) {
        if ($Direct) {
            if ($parents[$n] -eq $pidApp) { $resultat += $n }
            continue
        }
        $courant = $n
        for ($i = 0; $i -lt 12; $i++) {
            if (-not $parents.ContainsKey($courant)) { break }
            $par = $parents[$courant]
            if ($par -eq $pidApp) { $resultat += $n; break }
            if ($par -le 0) { break }
            $courant = $par
        }
    }
    return $resultat
}

# Attend l'apparition d'au moins un node NON connu ; tableau vide = delai depasse.
function Attendre-Nouveaux {
    param([int]$pidApp, [int[]]$dejaConnus, [int]$attenteMs, [switch]$Direct)
    $deadline = (Get-Date).AddMilliseconds($attenteMs)
    while ($true) {
        $nouveaux = @(Nodes-App -pidApp $pidApp -Direct:$Direct |
            Where-Object { $dejaConnus -notcontains $_ })
        if ($nouveaux.Count -gt 0) { return $nouveaux }
        if ((Get-Date) -ge $deadline) { return ,@() }
        Start-Sleep -Milliseconds 300
    }
}

# Stabilite : plus aucun changement pendant 5 sondes consecutives (1 s chacune).
function Nodes-Stables([int]$pidApp, [int]$attenteMs = 30000) {
    $deadline = (Get-Date).AddMilliseconds($attenteMs)
    $dernier = -1
    $calmes = 0
    while ($true) {
        $n = (Nodes-App -pidApp $pidApp).Count
        if ($n -eq $dernier) { $calmes++ } else { $calmes = 0; $dernier = $n }
        if ($calmes -ge 5) { return $n }
        if ((Get-Date) -ge $deadline) { return $n }
        Start-Sleep -Seconds 1
    }
}

# --- Multi-arch : tag, hote, executabilite -----------------------------------

function Tag-De([string]$chemin) {
    if ($chemin -match "Aven-native-(x64|x86|arm64)-") { return $Matches[1] }
    return "zip"
}

# Arch de la machine : PROCESSOR_ARCHITEW6432 (PS 32 bits sous OS 64) gagne
# sur PROCESSOR_ARCHITECTURE. Resultat : x64 | x86 | arm64.
function Hote-Arch {
    $a = $env:PROCESSOR_ARCHITEW6432
    if (-not $a) { $a = $env:PROCESSOR_ARCHITECTURE }
    if (-not $a) { return "x86" }
    $a = $a.ToLowerInvariant()
    if ($a -eq "amd64") { return "x64" }
    return $a
}

# Un zip ne peut tourner que si la machine l'emule/execute nativement :
#   hote x64   : x64 + x86 natifs, arm64 IMPOSSIBLE (aucune emulation x64->arm64)
#   hote arm64 : tout (Windows on ARM emule x64 et x86)
#   hote x86   : x86 seul
# Tag inconnu (zip livre par -Zip avec un nom exotique) : on tente quand meme.
function Arch-Lancable([string]$arch, [string]$hote) {
    if ($arch -ne "x64" -and $arch -ne "x86" -and $arch -ne "arm64") { return $true }
    if ($hote -eq "arm64") { return $true }
    if ($hote -eq "x64") { return ($arch -ne "arm64") }
    return ($arch -eq "x86")
}

# --- Purge : app + SEULEMENT ses node orphelins + scratch --------------------

function Purge {
    param([int]$pidApp, [System.Diagnostics.Process]$procApp,
          [string]$dossier, [bool]$garder, [bool]$succes, [bool]$dossierFourni)
    if ($pidApp -gt 0) {
        $attribues = @(Nodes-App -pidApp $pidApp) # capture AVANT la mort du pere
        try {
            if ($null -ne $procApp -and -not $procApp.HasExited) {
                Stop-Process -Id $pidApp -Force -ErrorAction SilentlyContinue
            }
        } catch { }
        $deadline = (Get-Date).AddSeconds(8)
        while ((Get-Date) -lt $deadline) {
            if ($null -eq (Get-Process -Id $pidApp -ErrorAction SilentlyContinue)) { break }
            Start-Sleep -Milliseconds 300
        }
        foreach ($n in $attribues) { Stop-Process -Id $n -Force -ErrorAction SilentlyContinue }
        # passe de securite : enfants directs encore attaches au pid (la chaine
        # CIM peut avoir casse, mais la valeur ParentProcessId reste lisible)
        try {
            foreach ($p in (Get-CimInstance Win32_Process -Filter "Name='node.exe'")) {
                if ([int]$p.ParentProcessId -eq $pidApp) {
                    Stop-Process -Id ([int]$p.ProcessId) -Force -ErrorAction SilentlyContinue
                }
            }
        } catch { }
        Write-Host ("[smoke] purge [" + $script:Tag + "] : app pid " + $pidApp + " + " + $attribues.Count + " node orphelin(s)")
    }
    if ($dossier -ne "" -and -not $dossierFourni -and -not $garder -and $succes) {
        try { Remove-Item $dossier -Recurse -Force -ErrorAction SilentlyContinue } catch { }
    } elseif ($dossier -ne "" -and (-not $succes -or $garder)) {
        Write-Host ("[smoke] dossier conserve : " + $dossier)
    }
}

# --- Resolution de la liste des zips a fumer ---------------------------------

$zips = @()
if ($Zip -ne "") {
    $cheminZip = if ([System.IO.Path]::IsPathRooted($Zip)) { $Zip } else { Join-Path (Get-Location).Path $Zip }
    if (-not (Test-Path $cheminZip)) {
        Write-Host "SMOKE_KO - etape [preparation] : zip introuvable : $cheminZip"
        exit 1
    }
    $zips += $cheminZip
} else {
    $listeArchs = @()
    if ($Archs -ne "") { $listeArchs = @($Archs -split "[,;\s]+" | Where-Object { $_ -ne "" }) }
    if ($listeArchs.Count -eq 0) { $listeArchs = @("x64") }
    foreach ($archCible in $listeArchs) {
        $archCible = $archCible.ToLowerInvariant()
        $candidat = Get-ChildItem (Join-Path $outDir "Aven-native-$archCible-*.zip") -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $candidat) {
            Write-Host "SMOKE_KO - etape [preparation] : aucun zip portable $archCible dans native\.out (packager d'abord : scripts/package-native.ps1 -Archs $archCible)."
            exit 1
        }
        $zips += $candidat.FullName
    }
}
if ($Dossier -ne "" -and $zips.Count -gt 1) {
    Write-Host "SMOKE_KO - etape [preparation] : -Dossier ne fonctionne qu'avec un seul zip (retirer -Archs)."
    exit 1
}

# --- Deroule : une execution par zip -----------------------------------------

$hote = Hote-Arch
$echecs = @()
$lances = 0
$sauts = 0

foreach ($cheminZip in $zips) {
    $tag = Tag-De $cheminZip
    if (-not (Arch-Lancable $tag $hote)) {
        Write-Host "SMOKE_SKIP - [$tag] zip non executable sur hote $hote (validation a faire sur un hote $tag)"
        $sauts++
        continue
    }
    $lances++
    Write-Host ""
    Write-Host "=== Smoke [$tag] : $cheminZip ==="
    $script:Tag = $tag
    $etat = "ok"
    $script:Raison = ""
    $script:Etape = "init"
    $script:Fen = $null
    $procApp = $null
    $pidApp = 0
    $dossierScratch = ""
    $dossierFourni = ($Dossier -ne "")

    try {
        # 1. preparation : extraction dans un scratch dedie
        $script:Etape = "preparation"
        if ($dossierFourni) {
            $dossierScratch = if ([System.IO.Path]::IsPathRooted($Dossier)) { $Dossier } else { Join-Path (Get-Location).Path $Dossier }
        } else {
            $dossierScratch = Join-Path $outDir ("smoke-" + (Get-Date).ToString("yyyyMMdd-HHmmss") + "-" + $tag)
            Write-Host "[smoke] extraction : $cheminZip"
            $depart = Get-Date
            [System.IO.Compression.ZipFile]::ExtractToDirectory($cheminZip, $dossierScratch)
            $duree = [math]::Round(((Get-Date) - $depart).TotalSeconds)
            Write-Host "[smoke] extrait en $duree s : $dossierScratch"
        }
        $exePortable = Join-Path $dossierScratch "Aven.Native.exe"
        if (-not (Test-Path $exePortable)) { throw "Aven.Native.exe absent de l'archive ($dossierScratch)." }

        # 2. lancement + attente de la fenetre principale
        $script:Etape = "lancement"
        $procApp = Start-Process -FilePath $exePortable -WorkingDirectory $dossierScratch -PassThru
        $pidApp = $procApp.Id
        Write-Host "[smoke] app lancee (pid $pidApp)"
        $script:Fen = Attendre-Fenetre -pidApp $pidApp -attenteMs 90000
        if ($null -eq $script:Fen) {
            $mort = $false
            try { $mort = $procApp.HasExited } catch { $mort = $true }
            throw "fenetre principale introuvable apres 90 s (app terminee : $mort)."
        }
        Start-Sleep -Seconds 2 # laisse la cascade du hub se poser

        if ($Dump) {
            $script:Etape = "dump"
            Dump-Arbre
        } else {
            # 3. hub : 4 cartes presentes et cliquables
            $script:Etape = "hub"
            $cartes = @("Projet", ("T" + [char]0xE2 + "ches"), "Fichiers", "Notes")
            foreach ($c in $cartes) {
                if ($null -eq (Trouver-El -prefixe $c -attenteMs 15000 -Cliquable)) {
                    Echec "carte du hub introuvable/incliqable : '$c'."
                }
            }
            Write-Host "[smoke] ok hub : 4 cartes cliquables"

            # 3bis. v9.7.5 : le noyau vocal central est PRESENT au hub (sans cliquer :
            # demarrer le micro rendrait l'etape dependante du materiel de l'hote).
            # Prefixe du nom UIA : "Dicter <em dash> bascule la dictee vocale" (U+2014).
            $dicter = "Dicter " + [char]0x2014
            if ($null -eq (Trouver-El -prefixe $dicter -attenteMs 8000 -Cliquable)) {
                $attendu = "Dicter " + [char]0x2014 + "..."
                Echec "noyau vocal central du hub introuvable (nom UIA '$attendu')."
            }
            Write-Host "[smoke] ok hub : noyau vocal central present"

            $retour = [char]0x2190 + " Retour au hub"
            $accueil = [char]0x2190 + " Accueil"
            $dossierParent = [char]0x2190 + " Dossier parent"
            # ligne des DOSSIERS de la liste fichiers : emoji dossier U+1F4C1
            # (paire de surrogates [char]0xD83D [char]0xDCC1) + 2 espaces, en
            # prefixe des rangees "dir" uniquement (les crumb racine = "Espace").
            $iconeDossier = "$([char]0xD83D)$([char]0xDCC1)  "

            # 4. notes : ouverture, editeur, annulation, retour hub
            $script:Etape = "notes"
            Cliquer-El "Notes"
            if ($null -eq (Trouver-El -prefixe "+ Nouvelle" -attenteMs 10000 -Cliquable)) {
                Echec "bouton '+ Nouvelle' absent : la vue Notes ne s'est pas ouverte."
            }
            Cliquer-El "+ Nouvelle"
            if ($null -eq (Trouver-El -prefixe "Annuler" -attenteMs 10000 -Cliquable)) {
                Echec "editeur de note non visible apres '+ Nouvelle'."
            }
            Cliquer-El "Annuler"
            if (-not (Attendre-Absent "Annuler" 8000)) { Echec "'Annuler' n'a pas ferme l'editeur." }
            if ($null -eq (Trouver-El -prefixe $retour -attenteMs 8000 -Cliquable)) {
                Echec "bouton '$retour' absent en page Notes."
            }
            Cliquer-El $retour
            if ($null -eq (Trouver-El -prefixe "Projet" -attenteMs 8000 -Cliquable)) {
                Echec "retour au hub KO apres Notes : les cartes ne sont pas revenues."
            }
            Write-Host "[smoke] ok notes : editeur ouvre/ferme + retour hub"

            # 5. fichiers : liste remplie + navigation racine <-> sous-dossier
            $script:Etape = "fichiers"
            Cliquer-El "Fichiers"
            if ($null -eq (Trouver-El -prefixe "Explorateur de l'espace" -attenteMs 10000)) {
                Echec "page Fichiers non ouverte (PageHint absent)."
            }
            if ($null -eq (Trouver-El -prefixe $iconeDossier -attenteMs 10000 -Cliquable)) {
                Echec "aucune entree dossier cliquable dans la liste racine (arbre/liste vide ?)."
            }
            Cliquer-El $iconeDossier
            if ($null -eq (Trouver-El -prefixe $dossierParent -attenteMs 10000 -Cliquable)) {
                Echec "navigation KO : '$dossierParent' absent apres clic sur un dossier."
            }
            Cliquer-El $dossierParent
            if (-not (Attendre-Absent $dossierParent 8000)) {
                Echec "'$dossierParent' ne disparait pas au retour a la racine."
            }
            Cliquer-El $retour
            if ($null -eq (Trouver-El -prefixe "Projet" -attenteMs 8000 -Cliquable)) {
                Echec "retour au hub KO apres Fichiers : les cartes ne sont pas revenues."
            }
            Write-Host "[smoke] ok fichiers : liste remplie + navigation racine/sous-dossier"

            # 6. garde chat : moteur pret AU BOOT, AUCUN spawn a l'ouverture, 0 a la 2e
            $script:Etape = "chat-garde"
            # Boot au lancement (parite Electron) : le host node appartient au
            # BootService et doit deja etre pret AVANT le 1er clic Projet.
            if ($null -eq (Trouver-El -prefixe "En ligne" -attenteMs 60000)) {
                Echec "moteur non pret au hub apres 60 s : le boot doit partir au lancement (statut 'En ligne' absent)."
            }
            $baseChat = @(Nodes-App -pidApp $pidApp -Direct)
            if ($baseChat.Count -eq 0) {
                Echec "statut pret mais aucun process node moteur (enfant direct) au boot."
            }
            Cliquer-El "Projet"
            if ($null -eq (Trouver-El -prefixe "Envoyer" -attenteMs 15000 -Cliquable)) {
                Echec "composeur de chat absent : la carte Projet n'a pas ouvert la conversation."
            }
            # L'ouverture ne fait que session.create sur le host du boot : 0 spawn.
            $nouveaux = Attendre-Nouveaux -pidApp $pidApp -dejaConnus $baseChat -attenteMs 15000 -Direct
            if ($nouveaux.Count -gt 0) {
                Echec ("spawn moteur a l'ouverture du chat (pids " + ($nouveaux -join ",") + ") : le host appartient au BootService, jamais au chat.")
            }
            [void](Nodes-Stables -pidApp $pidApp -attenteMs 30000)
            $set1 = @(Nodes-App -pidApp $pidApp -Direct)
            Write-Host ("[smoke] moteur au boot (" + $set1.Count + " node direct(s)) - test du garde : 2e ouverture")
            Cliquer-El $accueil
            if (-not (Attendre-Absent "Envoyer" 8000)) { Echec "le chat reste visible apres retour au hub." }
            Cliquer-El "Projet"
            if ($null -eq (Trouver-El -prefixe "Envoyer" -attenteMs 10000 -Cliquable)) {
                Echec "2e ouverture du chat sans composeur visible."
            }
            Start-Sleep -Seconds 6 # fenetre ou un re-spawn intempestif se produirait
            $set2 = @(Nodes-App -pidApp $pidApp -Direct)
            $reSpawn = @($set2 | Where-Object { $set1 -notcontains $_ })
            if ($reSpawn.Count -gt 0) {
                Echec ("re-spawn moteur a la 2e ouverture (pids " + ($reSpawn -join ",") + ") : garde _chatOuvert cassee.")
            }
            Write-Host "[smoke] ok chat : moteur pret au hub, 0 spawn a l'ouverture, 0 re-spawn a la 2e"

            # 7. terminal : vue + spawn du PTY (descendant du process app)
            $script:Etape = "terminal"
            $baseTerm = @(Nodes-App -pidApp $pidApp)
            Cliquer-El "Terminal Freebuff"
            if ($null -eq (Trouver-El -prefixe "Relancer" -attenteMs 15000 -Cliquable)) {
                Echec "barre de session absente : la vue Terminal Freebuff ne s'est pas ouverte."
            }
            $nodesTerm = Attendre-Nouveaux -pidApp $pidApp -dejaConnus $baseTerm -attenteMs 30000
            if ($nodesTerm.Count -eq 0) {
                Echec "aucun process node PTY descendant de l'app apres ouverture du terminal."
            }
            Write-Host "[smoke] ok terminal : spawn node PTY"

            # 8. parametres : panneau version visible
            $script:Etape = "parametres"
            Cliquer-El ("Param" + [char]0xE8 + "tres")
            $marqueur = $null
            foreach ($p in @("Aven ", ("Dict" + [char]0xE9 + "es"), "Stats indisponibles")) {
                $marqueur = Trouver-El -prefixe $p -attenteMs 8000
                if ($null -ne $marqueur) { break }
            }
            if ($null -eq $marqueur) {
                # repli sur l'AutomationId (x:Name) si le TextBlock n'expose pas son texte
                $marqueur = Trouver-El -Id -valeur "SettingsVersion" -attenteMs 3000
            }
            if ($null -eq $marqueur) {
                Echec "panneau Parametres introuvable (ni texte de version, ni AutomationId SettingsVersion)."
            }
            Write-Host "[smoke] ok parametres : version affichee"
        }
    } catch {
        $msg = $_.Exception.Message
        if ($msg -ne "SMOKE_ECHEC") { $script:Raison = $msg }
        if ($script:Raison -eq "") { $script:Raison = "erreur interne : $msg" }
        $etat = "echec"
    } finally {
        Purge -pidApp $pidApp -procApp $procApp -dossier $dossierScratch `
            -garder $Conserver.IsPresent -succes ($etat -ne "echec") -dossierFourni $dossierFourni
    }

    if ($etat -eq "echec") {
        $detail = "etape [" + $tag + "/" + $script:Etape + "] : " + $script:Raison
        Write-Host "SMOKE_KO - $detail"
        $echecs += $detail
    } else {
        Write-Host ("[smoke] OK [" + $tag + "]")
    }
}

# --- Verdict global ----------------------------------------------------------

if ($echecs.Count -gt 0) {
    Write-Host ""
    if ($echecs.Count -eq 1) {
        Write-Host ("SMOKE_KO - " + $echecs[0])
    } else {
        Write-Host ("SMOKE_KO - " + $echecs.Count + " echecs :")
        foreach ($e in $echecs) { Write-Host ("  " + $e) }
    }
    exit 1
}
if ($lances -eq 0) {
    # Tous les zips etaient pour une autre architecture : SKIP explicite et NON
    # un echec (avant ce correctif, ce cas sortait SMOKE_KO [preparation] en exit 1
    # apres avoir imprime SMOKE_SKIP — contradiction qui abortait le packaging
    # arm64 sur un hote x64). La validation se fera sur un hote de l'arch cible.
    Write-Host ("SMOKE_SKIP - " + $sauts + " zip(s) saute(s), aucun executable sur hote " + $hote + " (validation a faire sur un hote cible).")
    exit 0
}
if ($Dump) {
    Write-Host "SMOKE_DUMP_OK"
    exit 0
}
if ($sauts -gt 0) {
    Write-Host ("SMOKE_OK - " + $lances + " smoke(s), " + $sauts + " saut(s) (arch non executable sur hote " + $hote + ")")
} else {
    Write-Host "SMOKE_OK"
}
exit 0
