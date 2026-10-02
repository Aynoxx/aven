# Aven — Protocole de migration vers WinUI 3 + C# (.NET 8)

> **Objectif** : remplacer la coquille Electron/React par une application Windows
> **vraiment native** — WinUI 3 (Windows App SDK 1.6+), C# / .NET 8, packaging MSIX —
> en conservant **toute la logique métier existante** : le moteur OpenCode reste un
> process Node en sidecar, le freebuff CLI reste tel quel, le protocole de
> communication est porté à l'identique.
>
> **Principe directeur** : migration **par parité fonctionnelle incrémentale**. Une
> phase = un livrable exécutable + critères d'acceptation mesurables. Aucune phase ne
> casse l'app existante : **Electron reste la version de production jusqu'à la
> phase 7** — à tout moment, l'utilisateur a une app qui fonctionne.

---

## 0. Architecture cible

    ┌──────────────────────────────────────────────────────────┐
    │  Aven.Native — WinUI 3, C# / .NET 8, packaged MSIX       │
    │  ├─ UI : XAML, WinUI Controls, Composition (motion)      │
    │  ├─ Services : notes, fichiers, stats, prefs, dictée     │
    │  ├─ FreebuffService : ConPTY natif (P/Invoke)            │
    │  └─ AvenBridge : client JSON-RPC (stdio) vers le moteur  │
    ├──────────────────────────────────────────────────────────┤
    │  Aven.Engine — sidecar Node, IDENTIQUE à aujourd'hui     │
    │  ├─ OpenCode 2.0.10 (moteur agents, sessions, streaming) │
    │  ├─ freebuff CLI (lancé par le host, comme aujourd'hui)  │
    │  └─ aven-engine-host.mjs (ex-gestion moteur de main.ts)  │
    └──────────────────────────────────────────────────────────┘

### Décisions structurantes

1. **Le moteur OpenCode ne change pas.** Aujourd'hui « electron/main.ts » fait deux
   métiers : (a) héberger l'UI Electron, (b) piloter OpenCode (spawn, IPC, events).
   On extrait (b) dans un **host Node autonome**, « aven-engine-host.mjs », qui parle
   **JSON-RPC 2.0 sur stdio**. Ce host est réutilisable tel quel par WinUI ET par
   Electron pendant la transition : **double client, un seul moteur** — la preuve de
   non-régression est structurelle.
2. **Un seul protocole d'échange.** Le contrat est typé des deux côtés : côté C# par
   des classes générées depuis les types TS existants (« web/src/types.ts »), côté
   host par les mêmes formes JSON qu'aujourd'hui. Les events push
   (« opencode:event ») deviennent des notifications JSON-RPC du même gabarit.
3. **Les services locaux passent en C# natif** : dictée Groq (HTTP, mêmes endpoints),
   notes (JSON disque, même format), explorateur de fichiers, statistiques,
   préférences, notifications. Aucun Node résiduel pour ces domaines.
4. **Le terminal Freebuff** : le TUI reste le transport (contrat v9.5+), via
   **ConPTY natif** (P/Invoke « CreatePseudoConsole ») rendu dans un contrôle
   terminal dédié. Le pompe actuel (replay, resize, coalescing) est porté tel quel.

### Packaging

MSIX (Windows App SDK **self-contained**) : installateur signé + build portable
(unpackaged). Cible : Windows 10 22H2+ et Windows 11, x64 + ARM64 (le sidecar Node
suit la même matrice que les binaires actuels).

---

## 1. Contrat de parité (la source de vérité)

La parité se mesure sur le contrat IPC existant : **chaque canal de
« electron/preload.cts »** (environ 60 : chats, agents, notes, fichiers, stats,
préférences, voix, freebuff, fenêtre) doit exister dans « AvenBridge » avec la même
sémantique — mêmes arguments, mêmes retours, mêmes erreurs — plus les événements
push. Inventaire par domaine :

| Domaine         | Canaux actuels (exemples)                        | Service C# cible           |
|-----------------|---------------------------------------------------|----------------------------|
| Sessions/agents | app:state, chats:*, agents, send, reply, chain    | EngineService (sidecar)    |
| Notes           | note*:open/list/save/tags/export/pin/folder       | NotesService (JSON disque) |
| Fichiers        | files:*, app:openWorkspace                        | FilesService (safeResolve) |
| Stats           | getStats, usage                                   | StatsService               |
| Préférences     | prefs, setNotifications, setFreebuffResume        | SettingsService            |
| Dictée          | voiceTranscribe (Groq)                            | DictationService (HTTP)    |
| Freebuff        | freebuff:launch, freebuff:pty:*, desktop:running  | FreebuffService (ConPTY)   |
| Fenêtre         | window:minimize/maximize/close                    | AppWindow natif            |

**Test de parité automatisé** (mis en place en phase 1, extensé en phase 4) : un
harnais C# rejoue les scénarios des scripts e2e existants via le pont, et compare
les réponses aux captures de référence faites sur l'app Electron.

---

## 2. Les 9 phases

### Phase 0 — Socle (1 semaine)

- Nouvelle solution « native/ » : Aven.Native (UI), Aven.Bridge (pont), Aven.Engine.Host (sidecar).
- VS 2022, Windows App SDK 1.6, .NET 8 ; template « Blank App, Packaged ».
- CI GitHub Actions : job « native » séparé (msbuild + tests xUnit + artefact MSIX), le job Electron continue en parallèle.
- **Acceptation** : fenêtre WinUI vide buildée en CI, MSIX téléchargeable en artefact.

### Phase 1 — Host moteur + pont JSON-RPC (2 semaines) — LA phase critique

- Extraire la gestion OpenCode de « electron/main.ts » vers « aven-engine-host.mjs »
  (initialize, chat.send, chat.reply, chats.list, agents.list, model.chain…,
  notifications d'events en push).
- « Aven.Bridge » : client C# async (System.Text.Json, pipes/stdio), reconnexion,
  heartbeat, marshaling des events vers IObservable<EngineEvent>.
- **L'Electron actuel consomme ce même host** : bascule interne transparente.
- **Acceptation** : une conversation complète (send → stream → reply) depuis un test
  C# headless ; l'app Electron inchangée fonctionne via le nouveau host (e2e verts).

### Phase 2 — Coquille WinUI : fenêtre, navigation, thème (2 semaines)

- MainWindow : Mica/Acrylic, title bar custom (AppWindow, ExtendsContentIntoTitleBar)
  avec les onglets actuels (En ligne / Paramètres / Accueil).
- Hub en NavigationView ; les 4 cartes (Projet, Tâches, Fichiers, Notes) en XAML.
- Thème : **tokens CSS → ThemeDictionaries** (accent, panel-soft, border… Light/Dark).
- View Transitions → **Connected Animations** (la carte du hub devient la page cible,
  comme en v9.7.0) ; cascades d'entrée en CompositionAnimationGroup.
- **Acceptation** : navigation animée hub↔pages ; thème light/dark proche du thème
  React (captures comparées côte à côte).

### Phase 3 — Conversation + streaming (2 semaines)

- Composeur (Entrée pour envoyer, Maj+Entrée = retour ligne), bulles de messages en
  ItemsRepeater + DataTemplate, rendu Markdown.
- Streaming : binding **incrémental** (append au dernier bloc, pas de re-render
  global), autoscroll « follow bottom » avec bouton « Dernier message » comme aujourd'hui.
- Sélecteur de modèle (MenuFlyout depuis modelChain), notices routeur, Arrêter (Échap),
  FormDialog (autorisations) en ContentDialog.
- **Acceptation** : conversation réelle à 60 fps mesurés pendant le stream ; raccourcis
  et dialogs conformes.
- **État (socle conversation + vue chat, fait)** : la couche données/opérations est
  portée et prouvée en headless — `ConversationModels.cs` (état Live immuable +
  réducteur, port ligne à ligne de `web/src/stream.ts`) et `ConversationClient.cs`
  (port de `electron/operations.ts`), avec 2 tests E2E contre un double honnête
  stateful. La vue chat WinUI est en place dans MainWindow (carte Projet) :
  composeur Entrée/Maj+Entrée, bulles reconstruites depuis `ChatViewModel`
  (diff incrémental — patch INPC de la bulle existante, insertion des nouvelles,
  aucune reconstruction de liste), autoscroll « follow bottom » (ViewChanged ±40 px,
  parité « Dernier message »), bouton Arrêter + raccourci Échap (KeyboardAccelerator),
  état busy reflété (Arrêter visible, Envoyer désactivé), host = bundle de phase 1.
  `ChatViewModel` est pur (sans WinUI, marshal optionnel) et testé en xUnit : les
  deltas patchent la MÊME bulle, autorisations/questions deviennent des lignes,
  Arrêt en plein stream gardé.
- **État (phase 3 close)** : sélecteur de modèles en MenuFlyout (« Auto » + chaîne du
  routeur, épinglage via `SetChatModelAsync` → session.switchModel, coche sur
  l'actif, badge du bouton) ; autorisations d'outils et questions de l'agent en
  ContentDialog (une seule boîte à la fois, décisions once/always/reject parité
  v9.4) ; rendu Markdown-lite (`MarkdownLite.Parse` pur et testé : titres, gras,
  italique, `code`, blocs ``` — HTML et liens restent du TEXTE littéral, aucune
  exécution, parité de la politique RichMarkdown) ; mesure fps : fenêtres d'une
  seconde pendant les tours, min–max glissants sur 30 s affichés dans le hint.
  Preuves : 33/33 xUnit, MSIX vert, 128/128 Electron, verify OK. Reste hors code :
  la lecture humaine des captures côte à côte (thème) pendant l'utilisation réelle.

### Phase 4 — Services natifs (2 semaines)

- NotesService : **même format disque** ; lecture/écriture croisées Electron↔WinUI testées.
- FilesService : explorateur intégré (TreeView + GridView), « safeResolve » porté tel quel.
- StatsService : mêmes agrégats ; export lisible par l'app Electron.
- SettingsService : notifications, apparence (sidebar, ordre des agents), freebuffResume.
- **Acceptation** : tests de parité §1 au vert ; deux apps ouvertes sur le même
  workspace sans corruption.
- **État (NotesService fait)** : `NotesService.cs` porte fidèlement `electron/notes.ts`
  ET `electron/notes-meta.ts` — MÊME FORMAT DISQUE, avec les deux conventions de
  dossiers coexistantes reproduites telles quelles (notes dans `.opencodeapp/notes`
  sans tiret, méta dans `.opencode-app/notes-meta.json` avec tiret). Sémantique
  conservée : titre dérivé du premier `# `, id dérivé du titre (accents retirés,
  `º` → tiret) avec suffixes -2/-3…, refus de traversée de chemin, quotas (20 pins,
  6 tags), JSON méta indenté **\n only** (byte-parité : `WriteIndented` d'System.Text
  .Json émet `Environment.NewLine`, à normaliser sous Windows) et UTF-8 sans BOM.
  Preuve : lecture/écriture croisées RÉELLES avec le vrai Node dans les tests xUnit
  (`NotesInteropNodeTests` — le Node relit ce que C# a écrit, le C# relit ce que
  Node écrit). Les quatre services sont maintenant portés : `FilesService.cs`
  (safeResolve ligne à ligne — absolus, lecteur, « .. » refusés, path.relative fait
  main ; listing sans racines cachées, lecture bornée 512 Kio anti-binaire, fil
  d'ariane), `StatsService.cs` (compteur de dictées `.opencode-app/stats.json` avec
  reset journalier + agrégations pures identiques à aggregateStats) et
  `SettingsService.cs` (prefs.json COMPACT atomique — parité writeJsonAtomic, à la
  différence du meta des notes en variante Pretty —, défauts stricts !==false /
  ===true).
- **État (phase 4 close)** : les vues natives Fichiers et Notes sont branchées aux
  cartes du hub — Fichiers : fil d'ariane cliquable, listing dossier parent inclus,
  aperçu texte borné avec méta ; Notes : liste filtrable/recherchable avec épinglage,
  éditeur titre+corps (création/édition), aperçu Markdown via le parseur testé,
  compteur de mots. L'épreuve « deux apps ouvertes sur le même espace sans
  corruption » est automatisée (`TwoAppsConcurrencyTests`) : C# et le vrai Node
  (process séparés, format Electron exact) écrivent SIMULTANÉMENT 20 notes et le
  même méta — toutes les notes sont ensuite lisibles par les deux moteurs, le JSON
  méta est valide (la dernière écriture gagne, jamais un état mixte), aucun
  temporaire résiduel. 67/67 xUnit, MSIX vert, 128/128 Electron, verify OK.

### Phase 5 — Terminal Freebuff natif (1 à 2 semaines)

- ConPTY P/Invoke + contrôle de rendu terminal.
- Port du protocole actuel : replay scrollback (256 Ko), resize avec **plancher 80×24**
  (port 1:1 de « pty-dims.ts »), **coalescing des chunks** (lot 30 ms / 8 Ko, leçon
  v9.6.1), backoff de boot (1 s / 2 s / 4 s), garde anti-takeover et détection de
  l'app Desktop (WMI → ManagementObjectSearcher).
- Barre de session + filtrage transcript : **port 1:1 de « freebuff-transcript.ts »**
  en C# (module pur) — **les mêmes cas de tests** que
  « tests/freebuff-transcript.test.mjs », réécrits en xUnit.
- **État (transcript + machine à états + ConPTY réel faits)** : `FreebuffTranscript.cs`
  porte le filtrage ligne à ligne (bordures, décoration, session avec priorité
  quota>streak, pubs, prompt utilisateur, fast-path Unicode v9.6.1) — mêmes cas de
  tests en xUnit, y compris la garde anti-freeze (5000 lignes < 200 ms). Piège de
  port : la classe de caractères `─-╿` est une PLAGE Unicode (U+2500-U+257F) —
  échapper le tiret en C# la casse (├/┬ sortaient du filtrage). `FreebuffTerminal.cs`
  porte la machine à états de freebuff-pty.ts (singleton, scrollback 256 Ko, grâce
  de boot ARMÉE par timer — pas une mesure d'horloge, sinon les délais de test la
  court-circuitent — backoff 1/2/4 s avec re-spawn d'un NOUVEAU process, coalescing
  30 ms/8 Ko avec vidange d'états avant le changement d'état, plancher dims 80×24,
  transport injectable pour les tests). `AtomicFile.cs` mutualise l'écriture
  atomique avec RETENTATIVES (Windows refuse le rename sous contention — même
  l'épreuve deux apps l'a prouvé) + repli copie, et sert notes/stats/prefs.
- **Décision ConPTY (consignée)** : le P/Invoke `CreatePseudoConsole` direct
  (`ConPtyTransport.cs`) s'initialisait (`?9001h` reçu, exit propre) mais le process
  enfant restait ATTACHÉ à la console du parent — sortie visible sur la console de
  test, jamais dans les pipes, avec un code pourtant fidèle à l'exemple officiel
  (prouvé par une sonde jetable : chunks horodatés, exit code 0, dispose propre).
  CAUSE RÉSOLUE (01/10/2026, bissect exhaustive post-protocole) : le parent MANAGÉ
  est le poison. Un enfant ConPTY lancé depuis un process qui charge le runtime
  .NET (net8.0-windows, .NET Framework 4.8, transcription EXACTE du sample
  Microsoft en C#) meurt en 0xC0000142 (STATUS_DLL_INIT_FAILED) à l'init de sa
  console, tandis que le MÊME code exécuté par un parent natif (python/ctypes,
  node-pty/conpty.node, Windows Terminal) réussit. Toutes les parités testées et
  éliminées : named pipes vs anonymes, STARTF_USESTDHANDLES, bloc d'environnement,
  bInheritHandles FALSE/TRUE, chemin complet de cmd.exe, SECURITY_ATTRIBUTES NULL,
  zero-init de la liste d'attributs, CRT statique /MT, thread principal vs
  secondaire — seuls comptent le RUNTIME du parent (natif OK, managé KO) et la
  STRUCTURE STARTUPINFO exacte (les structs approximatives échouent côté données).
  Conséquence : un hôte PTY natif minimaliste reste POSSIBLE (exe C pur, cl.exe
  BuildTools), mais le prototype natif a reproduit le même 0xC0000142 que les
  parents managés (cause résiduelle non élucidée : la sonde python gagnante
  diffère encore de l'exe compilé sur un point non identifié) — pivot abandonné
  faute de preuve, le micro-hôte Node RESTE la décision (il est natif côté
  conpty.node et prouvé par 192 tests verts + app). ABANDON du P/Invoke au profit de
  `NodePtyTransport.cs` : un MICRO-HOST Node (`electron/pty-host.ts`, bundle esbuild
  `dist-electron/aven-pty-host.mjs`) qui pilote le MÊME conpty.node prébuildé que
  l'Electron (`@lydell/node-pty`) via des lignes JSON sur stdio (data/exit/ready +
  start/write/resize/kill ; garde anti-orphelin : stdin fermé → exit). Zéro
divergence TUI par construction. TESTS D'INTÉGRATION réels : echo, cmd interactif
  (écriture dans le PTY → l'écho répond), resize/kill idempotents, pilote
  `FreebuffTerminal` sur le vrai transport — `AVEN_PTY_COMMAND` remplace `freebuff`
  (le CLI réel a un quota mono-session : jamais de test automatisé contre lui).
  Orphelins Node : tuer le testhost peut laisser le micro-host vivant —
  `Get-Process node | Stop-Process` avant une suite, sinon les runs suivants
  HANGENT (piège de débogage).
- **Autonomie du portable (01/10/2026)** : `NodePtyTransport.RésoudreNode` résout
  node.exe dans l'ordre paramètre > env `AVEN_PTY_NODE_EXE` > ADJACENT
  (`<app>/nodejs/node.exe`, le layout portable) > PATH (dev). `package-native.ps1`
  (param `-NodeExe`) et le workflow CI copient node.exe vers `portable/nodejs/` —
  zip 105 Mo (node 99 Mo non compressé), le terminal marche SANS Node installé.
  Preuves : 6 tests du résolveur (198 xUnit verts) ; `Echo_one_shot` réel avec node
  ABSENT du PATH + env var posée ; session PTY vivante DANS le layout portable
  (`nodejs/node.exe dist-electron/aven-pty-host.mjs` → ready + chunk VT + exit 0).
  Le MSIX, lui, n'embarque pas node (paquet store-friendly) : il reste dépendant du
  PATH — à réévaluer si un jour l'écran VT doit marcher out-of-the-box en sideload.
- **RELEASE 10.0.0 (01/10/2026)** : artefacts ×3 arch, MSIX signés 10.0.0.0 (cert
  dev CN=Aven, verdict signtool honnête) + portables autonomes (node arch-correct,
  xterm vendu, e_sqlite3 vérifiés dans chaque layout). Hashes SHA256 :
  MSIX x64 ca345dfc…991cb · x86 bd29c20d…71a6d · arm64 4ce0f360…3b8df ;
  zip x64 63249aba…1445 · x86 b80da146…e65f · arm64 1e1e6b41…8e62 (SHA256 complets
  dans le message du tag v10.0.0). PIÈGES nouveaux : RID explicite obligatoire
  (NETSDK1032 sinon : RID inféré = hôte) ; sous-dossier RID du portable est
  win-<arch> (hardcoder win-x64 désaligne nodejs/ et l'exe) ; node-pty-win32-x86
  N'EXISTE PAS (npm 404) → le portable x86 embarque le node+pty x64 (l'app 32-bit
  spawne des enfants 64-bit ; seuls les Windows 32-bit purs sont exclus) ; node
  par arch via cache/téléchargement nodejs.org (-NodeVersion, TLS 1.2 imposé).
  Preuves : smoke PTY vivants dans les layouts x64 ET x86 (ready + chunk VT +
  SMOKE-<arch>-OK) ; PE vérifiés (app i386/ARM64, node x86-64/ARM64) ; paquet
  node-pty-win32-arm64@1.1.0 embarqué. ARM64 : non exécuté (pas de machine cible)
  — épreuve matérielle = acceptation humaine, artefacts prêts.
- **Acceptation** : session visible, quota « 40/40 Freebucks » dans la barre, pubs
  filtrées, bannière de conflit d'app Desktop fonctionnelle, TUI non gelé à l'envoi.
  La vue existe (transcript filtré TextBlock + barre de session + bannière WMI +
  replay) ; la validation visuelle TUI vivant passe par `scripts/launch-native.ps1`.

### Phase 6 — Dictée + voix (1 semaine)

- DictationService : capture WinRT MediaCapture / WASAPI → POST Groq (mêmes endpoints,
  mêmes formats), éclaircissement dicté porté (voice-intent).
- **État (pipeline + capture + annonceur faits)** : `VoiceIntent.cs` porte
  `voice-intent.ts` ET le pipeline `voice.ts` (liste fermée anti-hallucination,
  prompt verrouillé, filet déterministe v9.1.3, anti-injection structurelle,
  reformage et classification en PARALLÈLE avec dégradation indépendante, filet
  prioritaire sur un « chat » mal classé) — HTTP injecté (`IVoiceHttp`), mêmes cas
  que `voice-intent.test.mjs` en xUnit. `VoiceRuntime.cs` (fenêtre) : MediaCapture
  (mp3/44.1 kHz), push-to-talk Ctrl+Maj+V via KeyboardAccelerator (le hotkey OS
  global RegisterHotKey est ACTÉ 01/10/2026 — GlobalHotKey.cs : fenêtre message-only du
  thread UI (aucun sous-classement de la fenêtre principale), WM_HOTKEY routé par
  (hwnd,id), MOD_NOREPEAT, accélérateur XAML local en repli si le raccourci est
  déjà pris ; dispatch réel via pompe + conflit OS testés en xUnit), intentions d'app exécutées (ouvrir
  notes/settings/terminal). `GroqHttp.cs` : HttpClient réel (multipart Whisper +
  chat temperature 0). `Announcer.cs` (pur, coalescence/mute parité announcer.ts,
  voix INJECTABLE) branché aux événements moteur, voix SAPI via PowerShell
  (parité speakWithSapi) — coalescence INTRINSÈQUEMENT course au test : attendre
  un ÉTAT (nb de phrases dites), jamais un délai fixe ; le mute, lui, est sûr car
  vérifié AU RÉVEIL de la vidange. Reste en phase 6 : l'acceptation « tests WAV
  fixes » (fichiers audio de référence sur les vraies machines).
- Push-to-talk Ctrl+Maj+V global (RegisterHotKey), annonceur System.Speech.
- **Acceptation** : dictée push-to-talk et annonceur conformes à l'actuel (tests WAV fixes).

### Phase 7 — Pack, signature, double publication (1 semaine + buffer)

- MSIX signé + portable ; CI de release ; **double publication** : v9.x (Electron) et
  v10.0 (native) en parallèle, retours utilisateurs.
- **Acceptation** : installation propre sur Windows 10/11 vierges ; release signée ;
  télémétrie de crash en place.
- **État (pack + signature + CI faits)** :
  - **Self-contained runtime .NET** (`SelfContained=true` dans Aven.Native.csproj) :
    `WindowsAppSDKSelfContained` ne couvre que le WASDK — sans ce fix, l'app
    refusait de démarrer sur toute machine sans le framework .NET 8 partagé exact
    (constaté en smoke test local : « You must install or update .NET »). Avec le
    fix, l'exécutable tourne partout, y compris le portable.
  - **scripts/package-native.ps1** : certificat CodeSigningCert auto-géré (racine
    CN=Aven, aligné sur le Publisher du manifeste, persisté par empreinte dans
    `native/.cert-thumbprint` — JAMAIS commité), export .cer + import
    TrustedPeople (CurrentUser) = flux sideload silencieux, MSIX signé, verdict
    signtool honnête (exit 0 = ancré ; « not trusted root » = signé self-signed,
    flux DEV ; autre = échec dur — Get-AuthenticodeSignature est INCAPABLE de lire
    un MSIX, UnknownError systématique), zip portable (layout RID `win-x64\` car
    le runtime .NET embarqué vit dans le sous-dossier, + dist-electron hosts +
    @lydell/node-pty embarqué). Pièges consignés : .ps1 en ASCII strict (ANSI
    sinon),    `2>&1` + `$ErrorActionPreference=Stop` transforme stderr natif en
    erreur terminante (relâcher localement), redirection RID `win-<arch>` à
    ré-évaluer APRÈS un build depuis dossier propre (sinon l'exe sort imbriqué
    et le zip n'a pas d'exe à la racine — bug attrapé par le smoke sur x86 et
    arm64 le 02/10/2026, corrigé).
  - **Suite de smoke UIA réutilisable** (`scripts/smoke-native.ps1`, aussi
    `npm run smoke:native`) : le parcours de release pour CHAQUE zip portable —
    extraction dans un scratch `native/.out/smoke-<stamp>-<arch>`, pilotage en
    COM UI Automation (`UIAutomationClient`, sans WinAppDriver), **7 verrous** :
    hub (4 cartes cliquables) → Notes (`+ Nouvelle` ouvre l'éditeur, `Annuler`
    le ferme) → retour hub → Fichiers (liste remplie, clic sur un dossier →
    `← Dossier parent` monte d'un niveau puis disparaît à la racine) → garde
    chat (1 seul spawn node moteur à la 1re ouverture, AUCUN re-spawn à la 2e —
    régression `_chatOuvert` historique) → terminal (spawn node PTY descendant
    du PID) → Paramètres (version). Mode **multi-arch** : `-Archs x64,x86,arm64`
    fume tout en une exécution ; une arch non exécutable sur l'hôte (zip arm64
    sous Windows x64, aucune émulation dans ce sens) est `SMOKE_SKIP` — la
    validation arm64 se fait sur un hôte ARM64 (CI ou machine cible).
    Verdict `SMOKE_OK` (exit 0) ou `SMOKE_KO - etape [<arch>/<etape>] : raison`
    (exit 1) + dump UIA complet `native/.out/smoke-uia-<arch>.txt`. Purge
    stricte : app + SEULES node descendants du PID lancé (jamais ceux des
    autres sessions), scratch supprimé sauf échec.
    `scripts/package-native.ps1 -Smoke` la lance sur chaque zip produit et
    annule le packaging en cas d'échec. Pièges UIA : match en prefixe
    (`-like "nom*"`, l'égalité stricte échoue sur les entités XAML),
    variable locale jamais homonyme d'un paramètre.
  - **Anciens smoke tests réels** : app du layout dev ET du portable vivantes
    (pid, fenêtre « Aven », kill propre).
  - **Télémétrie de crash locale** : App.xaml.cs journalise
    AppDomain.UnhandledException dans %LOCALAPPDATA%\Aven\crash.log.
  - **Version 10.0.0.0** (identité de la bascule, phase 8).
  - **.github/workflows/release-native.yml** : workflow_dispatch, matrice
    x86/x64/ARM64, signature via secrets AVEN_PFX_B64/AVEN_PFX_PASSWORD (optionnelle
    — sans secret, MSIX non signé), zip portable + MSIX en artefacts.
  - **Reste** : l'acceptation « Windows 10/11 vierges » est une épreuve matérielle
    (VM ou machine réelle) — les artefacts et la procédure TrustedPeople sont prêts ;
    la double publication v9.x/v10.0 se déclenche au moment de la bascule (phase 8).

### Phase 8 — Bascule

- La WinUI devient « Aven » ; l'Electron devient « Aven Classic » (maintenance).
- Suppression du dossier Electron après 2 versions natives stables.
- **Checklist de bascule (à cocher quand tout est vert)** :
  1. Acceptations humaines faites : TUI vivant dans la fenêtre native (session,
     quota, pubs filtrées, pas de gel à l'envoi) + tests WAV fixes de la voix.
  2. Deux releases natives consécutives sans régression bloquante connue.
  3. Le README bascule : « Aven v10 (native) » en tête, la section Electron
     devient « Aven Classic (v9.x, maintenance) » — AUCUN renommage de fichiers
     ni de scripts avant ce point (les users v9.x ne doivent rien voir bouger).
  4. Publication en parallèle : `npm run package:win` (Classic) et
     `scripts/package-native.ps1` (v10) ; les deux installateurs cohabitent
     (identités MSIX séparées de l'exe NSIS).
  5. Gel des features Classic (correctifs de sécurité/bugs majeurs uniquement).
  6. Après 2 versions natives stables : suppression du dossier Electron
     (main/renderer/preload, workflows ci.yml, bundle engine-host — le host PTY
     reste, il est consommé par le natif) et retrait du protocole.
  - **État** : phases 0-7 faites et poussées ; la bascule attend les acceptations
    humaines (1) et deux releases stables (2).

---

## 3. Mapping design (le motion v9.7.0 ne se perd pas)

| Concept actuel (web)                          | Équivalent WinUI natif                          |
|-----------------------------------------------|--------------------------------------------------|
| Tokens CSS (--accent, --panel-soft, --border) | ResourceDictionary + ThemeDictionaries           |
| View Transitions API (v9.7.0)                 | Connected Animation / NavigationThemeTransition  |
| Cascades animation-delay (--stagger-i)        | CompositionAnimationGroup + DelayBehavior        |
| backdrop-filter: blur()                       | AcrylicBrush / MicaBrush                         |
| aria-live (transcript)                        | AutomationProperties.LiveSetting (Polite)        |
| xterm.js                                      | Contrôle terminal ConPTY                         |
| freebuff-transcript.ts                        | Port C# 1:1 + mêmes tests (xUnit)                |
| pty-dims.ts                                   | Port C# 1:1 + mêmes tests                        |
| Title bar custom (window-chrome)              | AppWindow.TitleBar + ExtendsContentIntoTitleBar  |
| Notifications hub                             | AppNotification (Windows App SDK)                |

Les tokens de motion (--dur-fast/med/slow, --ease-out, --ease-spring) deviennent des
constantes partagées C# et des clés de ressource XAML : le rythme v9.7.0 est conservé
à l'identique.

---

## 4. Risques & parades

| Risque                                              | Parade                                                                                     |
|-----------------------------------------------------|---------------------------------------------------------------------------------------------|
| Perte du travail motion (v9.7.0)                    | Connected Animations couvrent l'essentiel ; le reste en Composition (60 fps, thread compositor) |
| Deux apps (Electron + native) sur le même workspace | Format disque strictement inchangé ; tests de croisement en phase 4                          |
| ConPTY edge cases (resize pendant stream)           | Constantes de pty-dims + coalescing v9.6.1 réutilisés tels quels                             |
| Régression dictée                                   | Mêmes endpoints Groq ; tests d'intégration sur fichiers WAV fixes                            |
| UX différente des habitudes web                     | Parité visuelle de la phase 2 validée par captures comparées                                 |
| Effort / abandon en cours de route                  | L'ordre des phases garde toujours une app shippable ; Electron reste plan B jusqu'à la phase 7 |

---

## 5. Décisions ouvertes (à trancher en phase 0-1)

1. **Contrôle terminal** : **WebView2 + xterm.js 5.5.0 RETENU (01/10/2026)** — même
   moteur de rendu VT que la vue terminal web (parité totale : séquences VT, couleurs,
   scrollback 4000). L'émulateur embarque dans la vue terminal existante (un ToggleButton
   « Écran VT » bascule écran complet / transcript filtré TextBlock, défaut = écran) ;
   chunks PTY BRUTS → write(), frappes xterm onData → PTY, addon-fit → cols/rows →
   `FreebuffTerminal.Resize` (ClampDims conservé). Fichiers vendus localement
   (`scripts/vendor-xterm.mjs` → `Assets/terminal/vendor/`, aucun CDN) servis via nom
   d'hôte virtuel `aven.terminal` — fonctionne packagé ET unpackaged. Si le runtime
   WebView2 manque : repli automatique sur le transcript filtré (jamais d'écran noir).
   P/Invoke CreatePseudoConsole déjà abandonné en phase 5 pour le micro-host Node ;
   le rendu maison Composition/TextBlock n'aurait pas atteint la parité VT du web.
   4 tests protocole JSON (TerminalWebMessagesTests) + 192 xUnit verts + MSIX buildé.
2. **Markdown** : **MarkdownLite (maison) RETENU et étendu (01/10/2026)** —
   CommunityToolkit refusé : divergerait du rendu web (liens ACTIFS, syntaxe
   extra, thèmes propres) alors que la règle est la parité de RichMarkdown, et
   ajoute Markdig + Highlight.js (lourdeur, risque XamlCompiler pass1) pour un
   gain nul. MarkdownLite couvre maintenant TOUT le vrai rendu web : titres,
   gras/italique/`code`, blocs ```, listes - / * (imbriquées × 2 espaces),
   listes 1. , tableaux GFM (header gras sur fond panel-soft, colonnes égales),
   et liens [label](url) AFFICHÉS inertes (Hyperlink SANS NavigateUri — parité
   du span mdlink : le label se voit, l'URL ne s'ouvre jamais). HTML toujours
   littéral. 9 tests xUnit (dont liens inerts + tableau + puces imbriquées).
3. **Stats** : **SQLite ADOPTÉ (01/10/2026)** — `Microsoft.Data.Sqlite` 8 dans Aven.Bridge, base `workspace/.opencode-app/stats.db` (WAL + busy_timeout 5 s, deux apps simultanées). Le critère « getStats sur 1 an » est IMPOSSIBLE en JSON : stats.json ne porte qu'un compteur (total/day/dayCount), aucun historique — SQLite agrège les lignes journalières en une requête (test : History(365) < 500 ms). stats.json RESTE écrit à chaque incrément (byte-parité, export de compatibilité Classic : le vrai Node le relit en test) ; le JSON préexistant est importé UNE fois au premier accès (marqueur migrated). Panneau Paramètres : compteur total / aujourd'hui / 7 jours + version.
4. **Nommage** : **« Aven 10.0 (native) » RETENU (01/10/2026)** — la version majeure
   marque le changement de moteur (Electron → WinUI 3), ce que la continuité 9.x
   n'aurait pas dit ; pendant la double publication le README bilingue affiche
   « Aven Classic (v9.x) » / « Aven natif (v10.0) », la fenêtre Paramètres montre
   « Aven 10.0.0.0 — natif WinUI 3 (WASDK 1.7) » (MainWindow.AppVersion), et un
   test xUnit garantit manifeste (Version="10.0.0.0") + README alignés.
5. **Freebuff CLI** : il reste un sidecar Node tel quel — seul son hôte change (acté).
6. **WASDK 1.7 (évalué 30/09/2026)** : montée de 1.6.250602001 → **1.7.260224002**
   (dernière stable 1.7) testée LOCALEMENT : build MSIX x64 de l'app complète
   (2 pages x:Class + Theme.xaml mergé) 0 erreur, 170/170 xUnit, `npm run
   test:native` vert — le crash pass1 de phase 2 n'existe PAS en 1.7 (il n'a
   d'ailleurs jamais existé qu'en obj périmé). 1.7 ADOPTÉ dans Aven.Native.csproj ;
   retour arrière trivial (réécrire la version + rm -rf obj bin) si un jour
   nécessaire. Rappel de la leçon phase 2 : tout crash pass1 « mystérieux » doit
   d'abord déclencher un rebuild CLEAN (rm -rf obj bin) avant toute bissection.
7. **Lancement natif** : `scripts/launch-native.ps1` (build si besoin + lance
   Aven.Native.exe + garantit le bundle PTY) — validation visuelle de la coquille
   (Mica, hub, chat, vues, terminal) hors MSIX déployé.

---

> **Règle d'or** : chaque phase se termine par « npm run verify » (Electron, inchangé)
> **ET** la suite de tests C# au vert — les deux mondes sont validés en permanence.
> La parité est la loi : tant que la phase N n'a pas ses critères d'acceptation verts,
> on ne commence pas la phase N+1.

---

## Pièges outillage (leçons de phase 2)

- **XamlCompiler net472 (WASDK 1.6) crash silencieusement (exit 1, zéro output) sur
  un attribut XAML invalide** : la cause du blocage de plusieurs jours était
  `<Border Spacing="8">` — **Border n'a pas de propriété Spacing** (ça appartient à
  StackPanel). Aucun message d'erreur : il faut bissecter le XAML élément par élément.
  Toute erreur XAML suspecte = suspecter d'abord un attribut inexistant sur son type.
- **Le glob `**\*.xaml` du SDK ramasse TOUS les .xaml du dossier projet** : ne jamais
  créer de fichiers .xaml temporaires dans `native/src/Aven.Native/` (fichiers de test
  → `native/.bisect/` hors projet, supprimés ensuite).
- **Passer les `-p:Propriété=...` APRÈS `--` dans un script npm** (`npm run test:native --
  -p:Platform=x64`), sinon npm les mange.
- **MSBuild a besoin de l'environnement VS** : hors shell « Developer PowerShell »,
  `VCToolsInstallDir`/`VCInstallDir` ne sont pas résolus (input.json : `VCInstallDir:
  null`). Les poser à la main (`VCToolsInstallDir=...VC\\Tools\\MSVC\\14.44...\\`)
  suffit — le XamlCompiler n'en tire que `vcmeta.dll`.
- **XAML 100 % ASCII par sécurité** : tout non-ASCII en **entité numérique XML**
  (`é` → `&#233;`, `←` → `&#8592;`) — rendu identique, aucun risque de lecture ANSI
  par l'outil net472. Généré par script Node (le repo est CRLF, pas d'ancres
  multi-lignes fiables).
- **Une seule page x:Class par assemblage pour l'instant** : ShellView est fusionné
  dans MainWindow (Window racine, code-behind unique). À re-tester avec WASDK 1.7
  avant d'introduire des vues séparées en phase 3.
