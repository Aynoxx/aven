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
- **État (transcript + machine à états faits)** : `FreebuffTranscript.cs` porte le
  filtrage ligne à ligne (bordures, décoration, session avec priorité quota>streak,
  pubs, prompt utilisateur, fast-path Unicode v9.6.1) — mêmes cas de tests en xUnit,
  y compris la garde anti-freeze (5000 lignes < 200 ms). Piège de port : la classe
  de caractères `─-╿` est une PLAGE Unicode (U+2500-U+257F) — échapper le tiret en
  C# la casse (├/┬ sortaient du filtrage). `FreebuffTerminal.cs` porte la machine à
  états de freebuff-pty.ts (singleton, scrollback 256 Ko, grâce de boot ARMÉE par
  timer — pas une mesure d'horloge, sinon les délais de test la court-circuitent —
  backoff 1/2/4 s avec re-spawn d'un NOUVEAU process, coalescing 30 ms/8 Ko avec
  vidange d'états avant le changement d'état, plancher dims 80×24, transport
  ConPTY injectable pour les tests). `AtomicFile.cs` mutualise l'écriture atomique
  avec RETENTATIVES (Windows refuse le rename sous contention — même l'épreuve
  deux apps l'a prouvé) + repli copie, et sert notes/stats/prefs. 124/124 xUnit.
- **Acceptation** : session visible, quota « 40/40 Freebucks » dans la barre, pubs
  filtrées, bannière de conflit d'app Desktop fonctionnelle, TUI non gelé à l'envoi.

### Phase 6 — Dictée + voix (1 semaine)

- DictationService : capture WinRT MediaCapture / WASAPI → POST Groq (mêmes endpoints,
  mêmes formats), éclaircissement dicté porté (voice-intent).
- **État (pipeline voix porté)** : `VoiceIntent.cs` porte `voice-intent.ts` ET le
  pipeline `voice.ts` (liste fermée anti-hallucination, prompt verrouillé, filet
  déterministe v9.1.3 — commandes courantes sans réseau, JAMAIS une demande de
  contenu —, anti-injection structurelle, reformage et classification en PARALLÈLE
  avec dégradation indépendante, filet prioritaire sur un « chat » mal classé).
  HTTP injecté (`IVoiceHttp`, JSON + multipart Whisper) : les mêmes cas que
  `voice-intent.test.mjs` passent en xUnit sans réseau. 159/159. Reste en phase 6 :
  capture audio WinRT (MediaCapture/WASAPI), push-to-talk Ctrl+Maj+V
  (RegisterHotKey), annonceur System.Speech, et l'acceptation « tests WAV fixes ».
- Push-to-talk Ctrl+Maj+V global (RegisterHotKey), annonceur System.Speech.
- **Acceptation** : dictée push-to-talk et annonceur conformes à l'actuel (tests WAV fixes).

### Phase 7 — Pack, signature, double publication (1 semaine + buffer)

- MSIX signé + portable ; CI de release ; **double publication** : v9.x (Electron) et
  v10.0 (native) en parallèle, retours utilisateurs.
- **Acceptation** : installation propre sur Windows 10/11 vierges ; release signée ;
  télémétrie de crash en place.

### Phase 8 — Bascule

- La WinUI devient « Aven » ; l'Electron devient « Aven Classic » (maintenance).
- Suppression du dossier Electron après 2 versions natives stables.

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

1. **Contrôle terminal** : maison (Composition) vs lib existante — critère : rendu VT
   complet + performances au scrollback.
2. **Markdown** : CommunityToolkit Labs vs moteur maison — critère : parité du rendu
   actuel (blocs de code, listes, tableaux).
3. **Stats** : SQLite (recommandé) vs JSON — critère : performances getStats sur 1 an
   d'historique.
4. **Nommage** : « Aven 10.0 (native) » vs continuité 9.x — critère : clarté pour les
   utilisateurs pendant la double publication.
5. **Freebuff CLI** : il reste un sidecar Node tel quel — seul son hôte change (acté).

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
