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
#   4. chat      : 1 seul spawn node moteur a la 1re ouverture, AUCUN re-spawn
#                  a la 2e (garde _chatOuvert - regressions de release classiques)
#   5. terminal  : ouverture de la vue + spawn node PTY (descendant du process app)
#   6. parametres: panneau version affiche
# Verdict : "SMOKE_OK" + code 0, ou "SMOKE_KO - etape [...] : ..." + code 1
# (avec dump UIA complet dans native\.out\smoke-uia.txt pour diagnostic).
#
# ATTENTION : ce fichier doit rester 100% ASCII - PowerShell lit les .ps1 sans
# BOM en code page ANSI et tout accent casse le parsing (piege recurrent du
# projet). Les caracteres UI (accents, fleches) sont construits via [char]0x....
#
# Usage :
#   powershell -NoProfile -File scripts/smoke-native.ps1              # zip x64 le plus recent
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Zip <zip>   # zip portable precis
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Dump        # dump UIA de l'app puis sortie
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Conserver   # garde le dossier scratch
#   powershell -NoProfile -File scripts/smoke-native.ps1 -Dossier <dossier>  # layout deja extrait
#
# PIEGES project evites ici : variable locale JAMAIS homonyme d'un parametre
# (les variables sont insensibles a la casse), match de noms UIA en PREFIXE
# (-like "nom*") car l'egalite stricte echoue (entites XAML/accents), et
# purge des node orphelins LIMITEE aux descendants du PID de l'app lancee
# (jamais les nodes des autres sessions du poste).
param(
    [string]$Zip = "",
    [string]$Dossier = "",
    [switch]$Conserver,
    [switch]$Dump
)

$ErrorActionPreference = "Stop"
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName System.IO.Compression.FileSystem

$racine = Split-Path -Parent $PSScriptRoot
$outDir = Join-Path $racine "native\.out"
$fichierDump = Join-Path $outDir "smoke-uia.txt"

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
    $lignes | Set-Content -Path $fichierDump -Encoding UTF8
    Write-Host ("[smoke] dump UIA (" + $lignes.Count + " noeuds) : " + $fichierDump)
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

# Attend l'apparition d'au moins un node NON connu ; $null/[] = delai depasse.
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
        Write-Host ("[smoke] purge : app pid " + $pidApp + " + " + $attribues.Count + " node orphelin(s)")
    }
    if ($dossier -ne "" -and -not $dossierFourni -and -not $garder -and $succes) {
        try { Remove-Item $dossier -Recurse -Force -ErrorAction SilentlyContinue } catch { }
    } elseif ($dossier -ne "" -and (-not $succes -or $garder)) {
        Write-Host ("[smoke] dossier conserve : " + $dossier)
    }
}

# --- Deroule -----------------------------------------------------------------

$etat = "ok"
$procApp = $null
$pidApp = 0
$cheminZip = ""
$dossierScratch = ""
$dossierFourni = $false

try {
    # 1. preparation : zip + extraction dans un scratch dedie
    $script:Etape = "preparation"
    if ($Zip -ne "") {
        $cheminZip = if ([System.IO.Path]::IsPathRooted($Zip)) { $Zip } else { Join-Path (Get-Location).Path $Zip }
    } else {
        $candidat = Get-ChildItem (Join-Path $outDir "Aven-native-x64-*.zip") -ErrorAction SilentlyContinue |
            Sort-Object LastWriteTime -Descending | Select-Object -First 1
        if (-not $candidat) {
            throw "Aucun zip portable x64 dans native\.out - packager d'abord (scripts/package-native.ps1)."
        }
        $cheminZip = $candidat.FullName
    }
    if (-not (Test-Path $cheminZip)) { throw "Zip introuvable : $cheminZip" }

    if ($Dossier -ne "") {
        $dossierScratch = if ([System.IO.Path]::IsPathRooted($Dossier)) { $Dossier } else { Join-Path (Get-Location).Path $Dossier }
        $dossierFourni = $true # dossier fourni : jamais supprime par la purge
    } else {
        $dossierScratch = Join-Path $outDir ("smoke-" + (Get-Date).ToString("yyyyMMdd-HHmmss"))
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
        $retour = [char]0x2190 + " Retour au hub"
        if ($null -eq (Trouver-El -prefixe $retour -attenteMs 8000 -Cliquable)) {
            Echec "bouton '$retour' absent en page Notes."
        }
        Cliquer-El $retour
        if ($null -eq (Trouver-El -prefixe "Projet" -attenteMs 8000 -Cliquable)) {
            Echec "retour au hub KO : les cartes ne sont pas revenues."
        }
        Write-Host "[smoke] ok notes : editeur ouvre/ferme + retour hub"

        # 5. garde chat : 1 spawn moteur a la 1re ouverture, 0 a la 2e
        $script:Etape = "chat-garde"
        $baseChat = @(Nodes-App -pidApp $pidApp -Direct)
        Cliquer-El "Projet"
        if ($null -eq (Trouver-El -prefixe "Envoyer" -attenteMs 15000 -Cliquable)) {
            Echec "composeur de chat absent : la carte Projet n'a pas ouvert la conversation."
        }
        $nouveaux = Attendre-Nouveaux -pidApp $pidApp -dejaConnus $baseChat -attenteMs 30000 -Direct
        if ($nouveaux.Count -eq 0) {
            Echec "aucun process node moteur (enfant direct) apres ouverture du chat."
        }
        [void](Nodes-Stables -pidApp $pidApp -attenteMs 30000)
        $set1 = @(Nodes-App -pidApp $pidApp -Direct)
        Write-Host ("[smoke] moteur spawn (" + $set1.Count + " node direct(s)) - test du garde : 2e ouverture")
        $accueil = [char]0x2190 + " Accueil"
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
        Write-Host "[smoke] ok chat : 1 spawn, aucun re-spawn a la 2e ouverture"

        # 6. terminal : vue + spawn du PTY (descendant du process app)
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

        # 7. parametres : panneau version visible
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
    if ($script:Etape -eq "dump" -and $script:Raison -eq "") { $etat = "dump" }
    else { $etat = "echec" }
} finally {
    Purge -pidApp $pidApp -procApp $procApp -dossier $dossierScratch `
        -garder $Conserver.IsPresent -succes ($etat -ne "echec") -dossierFourni $dossierFourni
}

if ($etat -eq "echec") {
    Write-Host ""
    Write-Host ("SMOKE_KO - etape [" + $script:Etape + "] : " + $script:Raison)
    exit 1
}
if ($Dump) {
    Write-Host "SMOKE_DUMP_OK"
    exit 0
}
Write-Host "SMOKE_OK"
exit 0
