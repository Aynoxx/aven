# Aven v10.4.0

> ## v10.0.0 — 100 % Tauri (Electron et le natif retirés)
> Aven est une **app Tauri 2** : la webview React parle à Rust (`src-tauri/`)
> via la commande `aven_call`, qui route vers le moteur Node embarqué (`host/`,
> JSON-RPC sur stdio). Le shell Electron, le socle natif WinUI exploré en
> parallèle (`native/`, MIGRATION-WINUI.md) et leurs chaînes (electron-builder,
> MSIX) ont été **supprimés** — une seule pile, un seul packaging :
>
> ```powershell
> npm install          # dépendances + web/ + CLI OpenCode (aucun binaire Electron)
> npm run dev          # développement : Tauri + webview + rechargement
> npm run tauri:build  # installeurs Windows : NSIS + MSI
> ```

> ## Avant de modifier ce projet (IA ou humain)
> Lis **`AGENTS.md`** : il fixe les règles universelles de
> cohérence — typographie par tokens CSS, classes de boutons, bibliothèque d'icônes,
> français partout, commentaires versionnés `// vX.Y.Z : raison`, architecture
> host/renderer (Tauri), secrets côté host, écritures atomiques, modules purs testés.
> `npm run verify` commence par `scripts/verify-conventions.mjs` puis
> `scripts/verify-docs.mjs` : le premier fait échouer toute contribution violant ces
> règles, le second vérifie que cette documentation reste vraie (modules cités
> réellement importés, références existantes, audits datés). En cas de doute : imite
> le fichier voisin.

Application de bureau (Tauri) : une chatbox avec **3 agents commutables** (code, recherche, analyse) et un
sous-agent (code-reviewer), branchée sur **OpenCode 2.0.10** et un catalogue d’agents strictement gratuit (OpenRouter Free / OpenCode Zen).

> **v10.0.0 — 100 % Tauri** : le shell **Electron est supprimé** (main, preload,
electron-builder, ensure-binaries) ainsi que le socle **natif WinUI** suivi en
parallèle (`native/`, MIGRATION-WINUI.md, workflows MSIX) — une seule pile :
webview Tauri ⇄ Rust (`aven_call` : espaces de travail, notifications, ouverture
externe) ⇄ moteur Node (`host/`, dispatch camelCase). Barre de titre native
(suppression des boutons custom), CSP comme garde-fou sécurité, resources Tauri
(host moteur, OpenCode, PTY, MCP), release NSIS + MSI au tag `v*`, et les 21
sondes de `npm run verify` réalignées sur cette réalité.
> **v10.0.0 — fenêtre** : l'app démarre **maximisée** et **mémorise taille et
position entre les lancements** (redimensionne, ferme, rouvre : tout est là) ;
la barre de fenêtre vide a disparu de l'accueil (le hub commence par sa toolbar).
> **v10.4.0 — la voix agit, et chaque écran dit où il ramène** :
> ① **le micro du hub exécute la commande** — « ouvre le projet », « ouvre les
> notes », « retour à l'accueil », « nouvelle conversation » partent directement ;
> le filet déterministe prime sur le modèle, donc « ouvre le projet » ouvre la page
> Projet au lieu des Réglages ; ② **le micro du composeur écrit, toujours** — une
> dictée commencée dans une conversation y reste : plus de page qui s'ouvre pendant
> que tu dictes ; ③ **plus de conversation vide** — le hub ne crée une conversation
> qu'au moment où un texte arrive, pas à l'appui du micro ; ④ **une seule sortie par
> écran** — la conversation garde « Accueil » dans la barre de fenêtre, chaque page
> porte son « Fermer » : les deux boutons qui ramenaient au même endroit ont
> disparu ; ⑤ **la barre suit la page** — plus de « Paramètres » dans les Réglages.
> La sonde `scripts/verify-v10.4.0.mjs` fige ces conventions.
>
> **v10.3.2 — la finition : motion tokenisée, Réglages lisibles, hub allégé** :
> ① **un seul vocabulaire de durées** — les transitions qui passaient encore des
> durées et courbes en dur (survols de la sidebar, boutons, champs, onglets,
> curseurs, cartes du hub, bascule de thème) suivent maintenant les tokens
> `--dur-*`/`--ease-out` ; seules les boucles ambiantes (pouls, présence, dictée,
> scintillement) gardent leur rythme propre, documenté et figé par sonde ;
> ② **les libellés de Réglages se lisent** — les quatre rôles qui tenaient dans
> 11 px (titre, libellé, valeur, hint) passent à l'échelle du projet : la
> hiérarchie se lit au poids et au rôle, plus à 1 px près, et la valeur d'un
> curseur se cale au bord droit de sa ligne ; ③ **plus d'écran vide au démarrage
> en mouvement réduit** — `animation-delay` et `transition-delay` sont remis à
> zéro par la neutralisation globale : la cascade des cartes du hub n'attend plus
> 135 ms avant d'afficher quoi que ce soit ; ④ **les actions d'une conversation
> se devinent** — au repos à 35 % au lieu de 15 %, et surtout révélées au CLAVIER
> (`:focus-within`) comme au survol ; ⑤ **deux décors du hub retirés** (quadrillage
> et croix) : les trois orbites, les deux auras et l'anneau portaient déjà la
> constellation ; ⑥ **les cartes du hub restent sur leur orbite** — avec les
> animations système activées, leur cascade écrasait le placement orbital et les
> quatre cartes s'empilaient au centre, invisibles sous le micro : elles entrent
> maintenant par `translate`/`scale`, qui se composent avec l'orbite ; ⑦ **le morph
> se joue vraiment** — le callback de transition attendait deux frames, or le rendu
> est suspendu pendant la mise à jour : la transition ne se résolvait jamais et le
> changement d'écran était sec, sans animation. Le callback est synchrone (commit
> React par `flushSync`) et le groupe du morph suit les mêmes tokens que ses deux
> copies. La sonde `scripts/verify-v10.3.2.mjs` fige ces conventions.
>
> **v10.3.1 — les couleurs de l'accent redeviennent lisibles, et les pages se referment dans leur carte** :
> ① **l'encre d'accent est calculée, plus supposée** — sur l'accent Émeraude par
> défaut, le blanc d'un bouton primaire mesurait 2,54:1 et l'accent en texte 2,32:1
> sur le fond : l'app choisit maintenant l'encre (blanche ou sombre), assombrit
> l'accent juste ce qu'il faut et calcule une encre d'accent propre à chaque thème,
> pour les cinq presets et les accents personnalisés — le seuil 4,5:1 est vérifié
> par sonde sur les surfaces réelles (panneau, fond, teinte douce) ; ② **la dictée
> dit la vérité** : sans clé Groq, le gros bouton du hub est réellement désactivé,
> éteint, et son libellé annonce « Clé Groq requise » au lieu de rester cliquable en
> promettant une action qu'il refusait ; ③ **« Fermer » retrouve sa taille** (99 ×
> 21 px → une cible de 36 px) sans recouper le libellé ; ④ **les quatre cartes du
> hub se transforment** : Notes et Fichiers s'ouvrent en morph depuis leur carte
> comme Projet et Tâches, et toute page se referme dans la carte d'où elle vient
> (Échap, « Fermer », « Accueil ») ; ⑤ **les panneaux partent comme ils arrivent** —
> même translation, même échelle, courbe miroir — et le ressort n'est plus joué sur
> une ouverture sans geste. Les conventions sont figées par
> `scripts/verify-v10.3.1.mjs`.
>
> **v10.3.0 — Freebuff vraiment interactif, et une seule façon d'être une page** :
> ① **le CLI Freebuff s'installe tout seul au démarrage** — un seul gestionnaire
> vérifie `freebuff --version`, installe si besoin (une seule fois, même si tu ouvres
> la page Projet pendant l'installation), ne déclare « installé » qu'après une
> vérification réelle et respecte un délai avant de réessayer après un échec ;
> ② **le terminal Freebuff répond vraiment** : chaque frappe et chaque clic partent
> vers le PTY (avant, xterm affichait la sortie et jetait les entrées), Entrée,
> flèches, Tab, Ctrl+C et la souris agissent dans le TUI, et le redimensionnement
> atteint le process — la barre de saisie maison a disparu ; ③ **plus de texte flou**
> au survol des cartes du hub (`scale()` + `will-change` retirés, l'élévation reste),
> et en fenêtre étroite le cercle se plafonne à la hauteur disponible : la carte
> « Fichiers » n'est plus coupée et « Projet » ne passe plus sous la barre ;
> ④ **Notes, Fichiers et Réglages sont des pages**, plus des fenêtres posées sur
> l'interface : même barre supérieure déclarative que Tâches et Projet, actions
> propres à chaque page, **aucun défilement global** (le scroll vit dans la liste,
> l'éditeur, le terminal) ; ⑤ **l'icône Windows est enfin ton logo** — l'étoile verte
> du frontend est rastérisée en ICO multi-tailles (16 → 256) au lieu de l'ancien
> carré, donc la même icône pour la fenêtre, la barre des tâches, l'exe et les
> installateurs. Les conventions sont figées par `scripts/verify-v10.3.0.mjs`.
> **v10.2.2 — La revue live corrigée (docs/audits/2026-10-19-test-live-features.md)** :
> ① tes **liens `[[note]]`** survivent désormais à l'éditeur riche — TipTap échappait
> les crochets et une note enregistrée perdait ses liens sortants et ses backlinks ;
> ② le **menu du modèle** s'ouvre du côté qui a de la place (il sortait de la fenêtre
> en haut de la vue) et une conversation sans modèle affiche « Auto — le routeur
> choisit », plus jamais « null/ » ; ③ la **recherche du hub** filtre vraiment les
> conversations (elle promettait « chercher » sans rien filtrer), et « Ouvrir la
> conversation » ouvre bien la plus récente au lieu d'en créer une de plus ; ④ **la gestion des conversations
> se trouve** : un onglet « Conversations » dans la barre de fenêtre, et F2 renomme
> même barre latérale masquée ; ⑤ **Freebuff sans CLI** le dit (« CLI non installé »)
> avec un bouton Installer, au lieu d'un « démarre… » qui ne démarre rien ;
> ⑥ accessibilité et notes : composeur et champs de clés nommés, onglets `role=tab`,
> barre de sélection à six `aria-label` refermable par Échap, option Auto
> `aria-selected`, épingle en icône, titre non doublé dans l'aperçu, **dossiers vides
> visibles** et purge qui oublie épinglage et tags. Les conventions sont figées par
> `scripts/verify-v10.2.2.mjs`.
> **v10.2.1 — Tes clés et tes notes à l'abri d'un crash** : les trois écritures qui
> restaient « en place » (`settings.json` et tes clés chiffrées, `prefs.json`, le contenu
> des notes) passent désormais par le même mécanisme que le reste de l'app — fichier
> temporaire puis remplacement — et `settings.json` garde une copie `.bak` du dernier
> état lisible. Si un fichier de configuration redevient illisible, l'app le dit dans son
> journal au lieu de repartir silencieusement sur les valeurs par défaut (tu ne « perds »
> plus tes clés sans explication). Et enregistrer une clé ne se solde plus par « Le
> chiffrement Windows de la clé a échoué. » sur les postes où PowerShell n'importe pas
> `System.Security` de lui-même : l'assembly est chargé explicitement (vérifié en
> pilotant le host, pas seulement en relisant le code). Côté développement, `npm run dev` prépare le runtime
> Node embarqué et contrôle l'outillage Rust **avant** de compiler : un clone frais ne
> casse plus sur `node.exe` manquant ni sur un linker MSVC absent, et le message nomme
> le prérequis exact. Les conventions sont figées par `scripts/verify-v10.2.1.mjs`.
> **v10.2.0 — Revue de design Apple (docs/audits/2026-10-10-revue-design-apple.md)** : le rapport E/M/F
appliqué de bout en bout — ① **socle honnête** : pile système `system-ui` (aucune
police à charger, rendue au premier pixel), micro-labels `xs` 11px, `--muted`
verrouillé ≥ 4,5:1 dans les deux thèmes (calcul WCAG réel par la sonde) ; ② **focus
structurel** : chaque champ incrusté porte un signaleur (`:focus-within` sur
`.search-wrap`/`.composer`/`.home-command`, `:has(.ProseMirror-focused)` sur
l'éditeur TipTap) et la sonde 9b exige la PAIRE racine + signal ; ③ **dialogues en
View Transitions** (entrée `dialog-in`, sortie `dialog-out` jouable via
`view-transition-name: dialog`, ressort `--ease-spring`) — fermetures de panneaux
naviguées ; ④ **signaux d'accessibilité complets** : `prefers-reduced-transparency`,
`prefers-contrast`, scroll lissé coupé sous `reduce`, bascule de thème en fondu
(classe `.theme-easing`) ; ⑤ **gestes destructeurs en deux clics** (suppression de
conversation, purge de note — armement 4 s, Échap désarme) et **push-to-talk qui suit
le doigt** (le glisser hors bouton met la dictée en pause, le retour reprend, le
relâchement transcrit quand même) ; ⑥ **clavier partout** : arbre Notes (↑↓ pour
naviguer, Alt+↑↓ déplace la note vers le dossier affiché, racine au-dessus), listes
triables des Réglages (↑↓ + Alt+↑↓, focus qui suit), cibles 24px, `overscroll
contain`, état vide de la page Tâches, filtres de recherche à 120 ms. Les conventions
sont figées par `scripts/verify-v10.2.0.mjs`.
> **v10.1.0 — Orchestrateur à mode + Notes façon Kortex** : ① la page **Tâches**
affiche **UNE carte d'orchestrateur** avec un switch segmenté **Auto / Code /
Analyse / Recherche** (Auto = l'orchestrateur choisit le sous-agent ; un mode manuel
**impose la délégation** via une instruction de session OpenCode — `host/task-mode.ts`,
persisté par espace, rejoué à chaque envoi) ; le même switch vit dans le **bandeau
de conversation** des sessions « projet ». ② Les **notes** passent à un vrai système
de fichiers : arbre de dossiers (drag & drop), **poubelle** et archive, **liens
`[[note]]`** cliquables avec backlinks, **recherche globale** (normalisée, côté host)
et **capture rapide** `Ctrl+Shift+N` (raccourci global Rust → `Inbox`, façon Kortex).
③ L'édition des notes utilise un **éditeur riche TipTap** (Markdown bidirectionnel) ;
le rendu, lui, reste le `Markdown` maison (wikilinks cliquables). Les conventions sont
figées par `scripts/verify-v10.1.0.mjs`.
> **v9.6.0 — Projet = Freebuff, Tâches spécialisées, Groq au chat** : ① le raccourci
« Espaces » quitte le hub (la gestion vit dans Réglages → Configuration) ; ② la carte
« Projet » ouvre désormais l'**agent Freebuff** (page pleine, nom conservé) — le cerveau
central, et la page « Agents » devient **« Tâches »** (les spécialistes code, analyse,
recherche) ; ③ **fix du terminal** : l'émulateur caché garde de vraies dimensions avec
un plancher 80×24 testé — le TUI ne naît plus cassé/écran vide ; ④ la **barre de
session** du TUI (temps restant, quota) est extraite et affichée en clair au-dessus de
la conversation (les pubs restent filtrées) ; ⑤ **Groq devient un fournisseur de chat** :
la clé Groq (déjà utilisée pour la dictée) injecte aussi llama 3.3, GPT-OSS, Qwen 3…
dans les chaînes gratuites ; ⑥ **priorités refaites par domaine** : DeepSeek V4 Flash et
GPT-OSS 120B en tête du code, Nemotron 3 Ultra pour l'analyse, MiMo/Groq pour la recherche.
> **v9.6.0 — Lisibilité Freebuff + page « Tâches » à modes** : ⑦ la **Vue conversation**
devient vraiment lisible — le filtrage vit dans un module testé (bordures TUI rognées,
pubs greptile/« Refer friends »/streak retirées, barres d'état supprimées) et la barre de
session capture le **quota** (« 40/40 Freebucks remaining ») ; les lignes de prompt
utilisateur sont marquées visuellement ; ⑧ la page **« Tâches » est redessinée** : un
**agent principal** (l'orchestrateur « projet », qui délègue aux spécialistes via
subagents) et **4 modes** — Code, Analyse, Recherche, et **Tâche complexe** (qui ouvre
l'orchestrateur pour les demandes multi-domaines). L'ancien tableau « qui fait quoi »
est masqué et le renommage d'agents quitte la page (il reste via le CLI) ; Freebuff
reste accessible par la pastille du hub et la carte « Projet ».
> **v9.7.0 — Motion design natif (zéro dépendance)** : l'interface prend vie avec les
API modernes du Chromium embarqué : ① **transitions de vue** (View Transitions API)
lors des navigations hub → Tâches / Freebuff / Accueil — la carte « Projet » du hub
**devient** la page Freebuff (shared element) ; ② **tokens de motion** partagés
(`--dur-fast/med/slow`, courbes `--ease-out`/`--ease-spring` Fluent) ; ③
**chorégraphie d'entrée** en cascade des cartes du hub et des modes de la page
Tâches (décalage 45 ms par carte) ; ④ **micro-interactions** : enfoncement au press,
élévation au survol des cartes, respiration de la pastille de présence, skeleton
shimmer pendant le chargement des agents ; ⑤ tout est **coupé sous
`prefers-reduced-motion`**, n'anime que `transform`/`opacity` (composités GPU — le
conteneur xterm n'est jamais touché, leçon du gel v9.6.1), et le helper est testé.
> **v9.7.2 — Vérification en app réelle : le refus de session devient une bannière**
: boucle « ouvrir, vérifier, corriger » exécutée via CDP sur l'app lancée. Trouvé et
corrigé : quand le lancement de Freebuff est **refusé** (app Freebuff Desktop ouverte),
l'utilisateur voyait l'erreur brute « Error invoking remote method… » sans bannière
actionnable — désormais le refus est reconnu, la **bannière de conflit s'affiche**
(avec son bouton « J'ai fermé l'app — Relancer ») et le statut cesse de rester bloqué
sur « démarre… » (il passe à « Session refusée — voir la bannière »). Le reste de la
boucle est au vert : navigation hub→Tâches→Freebuff→Accueil, 4 modes, composeur et
chips, bascule Vue terminal (25 lignes xterm rendues), pastille hub, **zéro erreur
console** ; le motion est prouvé sous émulation (transitions déclenchées, source
posée pendant et retirée après) et se coupe correctement quand Windows réduit les
effets.
> **v9.7.1 — Le shared element devient réel + purge du code mort** : l'audit v9.7.0
avait révélé que le morph carte→page était annoncé mais **jamais branché** — c'est
fait : la carte « Projet » pose désormais `data-vt-source="project"` au clic (idem
« Tâches »), le CSS fait porter le même `view-transition-name` à la carte source ET
à la page cible (vrai morph), et l'attribut est retiré après la transition (avec un
timeout de 2 s — une fenêtre en arrière-plan peut geler l'animation et laisser un
nom orphelin, constaté au smoke CDP). **Purge** : canal `agents:rename` supprimé de
bout en bout (preload/types/operations/main — 0 appel UI depuis v9.6.0 ; les noms
personnalisés enregistrés restent lus), `agent-names.ts` allégé, tombstones retirés.
**Note découverte au smoke** : Windows « effets réduits » (`prefers-reduced-motion`)
désactive tout le motion par conception — c'est la garde d'accessibilité voulue,
prouvée active et respectée.
> **→ v10.0.0 — La bascule 100 % Tauri** : le shell Electron (main, preload,
electron-builder) et le protocole WinUI/C# suivi en parallèle ont été retirés —
la fenêtre est une webview Tauri, la barre de titre est native, les espaces de
travail et les ouvertures système sont gérés en Rust, le dispatch IPC camelCase
vient dans `host/aven-app-host.ts`, et les releases sortent en NSIS + MSI via
`tauri build` (workflow Release au tag `v*`).
> **v9.6.2 — Le gel avait une cause racine : le conflit de session** : le diagnostic
(processus) a montré le CLI embarqué **s'exiter silencieusement** au premier message
quand l'**app Freebuff Desktop** tient la session du compte (une seule session
autorisée). Aven ne peut pas contourner le serveur, mais ne laisse plus jamais dans
le flou : ① **détection** de l'app Desktop par chemin WMI (`isFreebuffDesktopRunning`,
canal `freebuff:desktop:running`) ; ② **bannière explicite** dans la page Freebuff
(« Ta session est déjà ouverte dans l'app Freebuff Desktop ») avec bouton « J'ai fermé
l'app — Relancer » (re-détection + relance) ; ③ **refus clair au lancement** si l'app
Desktop tourne, au lieu d'ouvrir un TUI condamné ; ④ sur exit silencieux du CLI,
le message nomme la cause au lieu du générique « s'est terminé ».
> **v9.6.1 — Plus de gel à l'envoi d'un message** : le terminal Freebuff restait
réactif à l'affichage mais se figeait dès qu'une réponse arrivait — quatre causes
cumulées, toutes corrigées : ① l'émulateur caché plein cadre en `opacity:0` était
quand même PEINT à chaque rafraîchissement du TUI → `visibility:hidden` (dimensions
conservées, peinture supprimée) ; ② les centaines de petits chunks ConPTY partaient
chacun en IPC individuel → coalescing 30 ms/8 Ko côté main (débit divisé par ~50) ;
③ le filtrage du transcript lançait ~26 regex par ligne sur 400 lignes à chaque frame
→ fast-path sans-lettres + plafond de rendu à 120 lignes ; ④ le scan du buffer
continuait en Vue terminal où il ne sert à rien → suspendu ; `aria-live="polite"`
retiré du transcript (recalcul d'arbre d'accessibilité à chaque frame). Un test de
cout borné (5 000 lignes < 200 ms) garde la régression à distance.
> **v9.5.1 — L'agent Freebuff devient une page pleine** : la vue quitte son dialogue
recouvrant — elle se navigue comme la page Agents (une seule vue à la fois, bouton
« Accueil », Échap revient à l'accueil, session maintenue en quittant). Le hub ou
la page Assistants t'envoient sur la page, plus jamais de popup devant la conversation.
> **v9.5.0 — Le pont agents : Aven, cerveau unique des deux moteurs** : ① **catalogue
d'agents partagé** : les agents Aven (projet, code, recherche, analyse, code-reviewer)
sont convertis en définitions TypeScript dans le dossier `.agents/` de l'espace — le CLI
Freebuff est lancé avec `--trust-agents` et propose donc LES MÊMES agents que
l'interface, sur des modèles gratuits (tes propres fichiers `.agents/` ne sont jamais
touchés) ; ② **notes ouvertes à Freebuff** : un serveur MCP embarqué expose liste,
lecture et recherche des notes de l'espace (`.agents/mcp.json` généré, lecture seule) ;
③ **reprise de conversation** : une préférence fait rouvrir Freebuff sur sa dernière
conversation (`--continue`) au lieu d'en créer une neuve ; ④ **la vue « terminal »
devient une conversation d'agent** : présence « En ligne », transcript lisible (les
spinners et bordures TUI sont filtrés), prompts rapides, composeur avec Entrée pour
envoyer et option « Reprendre la dernière conversation » — le terminal brut reste
accessible d'un clic pour ceux qui aiment voir la mécanique.
> **v9.4.0 — Architecture complète : un cerveau, deux moteurs** : ① **page Assistants**
unifiée (carte « Agents ») : chaque assistant — agents Aven et Freebuff — sur une seule
page, avec un tableau « qui fait quoi » en ouverture et le panneau d'état/actions
Freebuff (Installer le CLI, Ouvrir le terminal) ; ② le **hub se concentre sur ton espace**
(4 cartes : Projet, Agents, Fichiers, Notes) — Freebuff quitte le cercle, la pastille
d'état reste en raccourci ; ③ le **sélecteur de modèle** (barre de l'agent) liste la
chaîne de priorité du routeur : choisis un modèle précis ou « Auto » pour rendre la main
au routeur (épinglage via session.switchModel, chaîne recalculée quand les clés
changent) ; ④ **« Faire relire »** : sélectionne du code → le subagent code-reviewer
analyse sans modifier, via l'agent code (bascule automatique) ; ⑤ **terminal Freebuff
lisible** : l'émulateur envoie ses vraies dimensions (colonnes/lignes) au lancement et
se redimensionne en direct — plus de TUI figée 120×30 ou déformée après un agrandissement.
> **v9.3.0 — Restructuration : une carte claire des features** : ① le hub devient le
> cockpit de l'espace — 5 cartes (Projet, Agents, Freebuff = FAIRE ; Fichiers, Notes =
> CONTENU), le nom de l'espace actif dans l'en-tête, une pastille d'état Freebuff (CLI
> installé ? session active ?) et les conversations récentes montrant leur agent ;
> ② les **Statistiques** migrent dans les Réglages, onglet **Usage** ; ③ les **Notes**
> deviennent une vraie vue : rendu Markdown, édition intégrée, **tags par agent** (filtre
> dans la liste), « Joindre à la conversation » ; ④ les **Fichiers** s'explorent DANS
> Aven (lecture seule, cloisonné à l'espace par une barrière testée : safeResolve), avec
> aperçu texte et « Faire analyser par un agent » ; ⑤ « projets » s'appelle désormais
> **« Espaces »** partout (identifiants techniques inchangés) ; ⑥ le prompt de l'agent
> « projet » gagne un protocole d'orchestration (reformulation, délégation en énoncés
> autonomes, vérification, synthèse). Les commandes vocales suivent : « fichiers » ouvre
> l'explorateur intégré, « statistiques » ouvre Réglages → Usage.
> **v9.2.0 — Le terminal Freebuff intégré, plus de crash d'affichage** : ① la carte
> « Freebuff » ouvre désormais le CLI DANS Aven (xterm.js) — session persistante (fermer
> la vue ne l'arrête pas, l'écran exact est retrouvé à la réouverture), retry automatique
> au boot (ECONNRESET connu), boutons Interrompre/Redémarrer, et plus aucun port réseau
> local ni console externe pour l'usage quotidien ; ② correction du crash « Rendered
> fewer hooks than expected » qui masquait l'app d'un voile d'erreur (un hook React était
> appelé dans une fonction de rendu conditionnelle — la navigation clavier des listes du
> hub utilise désormais le focus DOM, sans état superflu) ; ③ les boutons de navigation
> clavier (flèches, Home/End) restent opérationnels sur toutes les listes du hub.
> **v9.1.5 — Plus de projet « Par défaut », l'espace se choisit, Freebuff sans
> session volée** : ① Aven ne crée plus aucun dossier « Par défaut » dans Documents —
> au premier lancement (ou après le retrait du dernier espace), un écran dédié propose
> de créer ou choisir le dossier de travail, et le moteur ne démarre qu'après ce choix
> (création/sélection = activation immédiate) ; ② le bouton « Utiliser » des espaces de
> travail, qui ne changeait en réalité JAMAIS d'espace (chemin ignoré depuis la v9.0.0),
> bascule vraiment maintenant ; ③ contre l'erreur « This Freebuff session was released
> or taken over by another instance » : Aven détecte un freebuff.exe déjà actif et refuse
> d'ouvrir un deuxième terminal avec un message qui explique le takeover (le serveur
> Freebuff n'accepte qu'une session par compte) au lieu de laisser deux CLI se voler la
> session. Note : les espaces déjà existants sont conservés — seul le dossier imposé de
> frais disparait.
> **v9.1.4 — Le bouton Freebuff enfin fiable, hub et page Agents peaufinés** : ① le
> lancement du CLI ne déclenche plus « Windows ne trouve pas 'Freebuff' » (titre de
> fenêtre `start` vide quoté), l'installation vérifie d'abord npm (message clair + repli
> `npx --yes freebuff`) et le bouton affiche « Installation en cours… » ; ② le bandeau
> d'avis du hub se place dans le coin (il masquait la carte Statistiques), s'efface
> seul après 6 s, se ferme d'un clic et propose « Installer » en direct quand le CLI
> manque ; ③ le cercle du hub tient entièrement dans la fenêtre ; ④ page Agents :
> 2 conversations par carte + compteur « +N autres », grille 3-4 colonnes, badge
> « lecture seule » sur analyse et recherche, boutons harmonisés.
> **v9.1.3 — Hub épuré, vocal qui exécute, Freebuff sans piège** : ① la carte
> « Paramètres » quitte le cercle central (6 cartes à 60°) — l'accès reste dans la barre
> de fenêtre et l'icône de l'accueil ; ② le bouton « Freebuff » de la chatbox est retiré,
> tout comme le champ clé Codebuff des Réglages et le réglage « Utiliser Freebuff comme
> moteur des agents » : le chat repart proprement sur les modèles gratuits OpenCode
> (l'agent vocal gagne « ouvre Freebuff », « statistiques » et « nouvelle conversation ») ;
> ③ les commandes vocales sont réellement exécutées — trois nouvelles actions, un filet
> de secours déterministe quand la classification Groq échoue, et une exécution fiabilisée ;
> ④ le bouton Freebuff CLI ne renvoie plus « freebuff introuvable » dans un terminal : le
> statut est vérifié avant lancement, avec un message d'installation clair si besoin, et le
> quoting Windows des chemins avec espaces est corrigé.
> **v9.1.2 — Freebuff CLI gratuit à portée de clic** : le free tier de Freebuff (sessions
> quotidiennes, financé par les pubs texte) vit dans son CLI interactif — Aven l'ouvre dans
> une vraie fenêtre de terminal directement sur ton espace de travail (carte hub « Freebuff »
> ou Réglages : statut, connexion, installation). Le chat Aven reste sur les modèles gratuits
> OpenCode, ou sur le SDK Codebuff avec clé.
> **v9.1.1 — Hub dédoublonné, Freebuff sans blocage** : l'ancienne carte « Projets »
> (espaces de travail) est retirée du hub — elle faisait doublon avec la nouvelle carte
> « Projet » (orchestrateur) ; les espaces restent dans Paramètres → Configuration. Le mode
> Freebuff ne bloque plus quand le compte Codebuff n'a plus de crédits (Payment Required) :
> le tour bascule automatiquement sur les modèles gratuits OpenCode, avec un avis dans la
> conversation.
> **v9.1.0 — Projet à part, Freebuff moteur, navigation revue** : ① l'agent **projet** est
> à part (carte dédiée du hub, badge « orchestrateur », retiré du sélecteur d'agents) et
> délègue aux agents de base code / recherche / analyse ; ② le sélecteur d'agents en haut
> à droite disparaît ; ③ bouton **Accueil** dans la barre de fenêtre (masqué sur l'accueil) ;
> ④ bouton **Agents** dans la barre de titre pour quitter une conversation et rechoisir ;
> ⑤ **Freebuff devient le moteur de tous les agents** quand la clé Codebuff existe (réglage
> dédié, override composeur conservé) ; ⑥ notifications de bureau (jamais au premier plan,
> tour terminé > 8 s, échecs, permissions, formulaires) et **diagnostic copiable** sans
> aucune clé API ; barre d'onglets historique supprimée.
> **v9.0.1 — Réparation du démarrage** : les espaces créés avant la v9.0.0 n'avaient pas
> l'agent **projet** (liste de synchro figée) → « Agents introuvables après 90s » au lancement.
> Les agents sont désormais **découverts dans le gabarit de l'app** : tout nouvel agent sera
> automatiquement copié dans les espaces existants (sans jamais toucher à tes personnalisations).
> Corrige aussi le script de tests pour la CI GitHub (les installateurs v8.11.0/v9.0.0 n'avaient
> pas pu être publiés) — les releases repartent avec la v9.0.1.
> **v9.0.0 — Projet Agent IA** : ① créer un espace = choisir/créer son dossier dans le
> sélecteur Windows ; ② les notes sont de vrais fichiers .md (chemin affiché + « Ouvrir
> le dossier ») ; ③ conversations groupées par agent (sidebar + page Agents, réglage
> Apparence pour revenir à l'ancienne vue) ; ④ nouvel agent **projet** orchestrateur qui
> délègue à code / recherche / analyse ; ⑤ Freebuff prioritaire sur l'agent code dès
> qu'une clé Codebuff existe (réglage désactivable, bouton du composeur en override).
> **v8.11.0 — Panneau de statistiques** : carte « Statistiques » du hub — conversations
> actives/archivées par agent, dictées (total et du jour), modèles les plus utilisés.
> Comptage persisté par espace de travail, agrégation pure et testée.
> **v8.10.0 — Notes premium** : recherche plein-texte (insensible aux accents et à la casse,
> sur les titres ET le contenu), épinglage persistant (les épinglées en tête de liste),
> comptage de mots/caractères et export .md via le dialogue Windows.
> **v8.9.0 — Actions sur sélection** : sélectionne du code dans une réponse → une mini-barre flottante propose
> **Copier**, **Corriger** (bascule sur l'agent code), **Expliquer** (agent recherche) et **Citer** (composeur).
> Le texte cité atterrit dans le composeur : tu complètes ta demande et tu valides avec Entrée.

```
Interface React (web/)  ──invoke("aven_call")──►  Rust Tauri (src-tauri/)  ──JSON-RPC stdio──►  host/aven-app-host.ts  ──HTTP local──►  opencode serve
   api.* (web/src/types.ts)      workspace:* / openExternal en Rust,        moteur Node embarqué (engine, notes,      mot de passe aléatoire, port libre
                                 reste dispatché en camelCase dans le host   PTY Freebuff, clés chiffrées DPAPI)
```

## Installer et lancer (Windows) — Aven v10.x (Tauri)

**Le plus simple : double-clique `demarrer.bat`** (il lance `npm install` — quelques secondes si rien n'a changé — puis l'app en mode développement). `construire.bat` fait la même chose puis produit les installeurs. Pour mettre à jour le projet, copie les nouveaux fichiers **par-dessus** l'ancien dossier sans supprimer `node_modules`.

À la main :

Prérequis : **Node.js 22+**, **Rust** ([rustup.rs](https://rustup.rs)) et, sous Windows, les **Visual Studio Build Tools 2022** avec le workload « Développement Desktop en C++ » — c'est le linker MSVC que Rust utilise par défaut. `npm run dev` contrôle les deux outillages et le dit clairement s'ils manquent (v10.2.1). Le CLI OpenCode est embarqué (paquet `@opencode/cli`, même version que le client) : pas d'install globale, aucun binaire Electron.

```powershell
npm install            # à la racine : installe aussi web/ automatiquement (CLI OpenCode uniquement)
npm run dev            # développement : Tauri + webview + rechargement
npm run tauri:build    # installeurs Windows : NSIS + MSI (src-tauri/target/release/bundle)
```

## Modèles et clés

- **Sans clé** : les modèles « Sans clé (OpenCode Zen) » (`opencode/…-free`) fonctionnent dès le premier lancement.
- **Avec clé** : bouton **Paramètres** → une clé OpenRouter Free (agents) et une clé Groq (dictée vocale). Les clés sont chiffrées par Windows et ne sont jamais renvoyées à l'interface.
- **Freebuff** (v9.5.0) : un **agent** intégré à l'espace, pas un terminal — mêmes agents que tes agents Aven (pont `.agents/`), mêmes notes (serveur MCP, lecture seule), transcript conversationnel avec composeur, reprise de conversation en option. Une seule session par compte.
- **Routage des modèles par priorité** : chaque modèle a une **priorité par agent** dans `model-priorities.json` et Aven assigne explicitement le premier modèle disponible à chaque nouvelle session.
  (1 = le meilleur ; « code », « analyse », « recherche »). Chaque agent utilise le meilleur modèle **disponible** (clé saisie) et non saturé.
  Le classement se recalcule au démarrage et à chaque enregistrement de clé ; il s'affiche dans Réglages. Changer d'onglet change donc de modèle.
- **Bascule automatique quand un modèle est trop utilisé**, de deux façons :
  - *préventive* : l'app compte les requêtes de chaque modèle et passe au suivant à 90 % du plafond déclaré dans la table (`limit`) ;
  - *réactive* : erreur 429 / quota / modèle indisponible → le modèle est mis de côté (90 s pour une limite de débit, 6 h pour un quota journalier ou un
    modèle non disponible), l'agent passe au suivant **immédiatement** et ton dernier message est renvoyé.
- **Catalogue dynamique** : au démarrage, Aven compare la table locale à `model.list()`, ne retient que les modèles explicitement gratuits et actifs,
  puis ajoute les nouveaux modèles gratuits autorisés même si la table livrée était devenue obsolète.
- **Modifier les priorités** : ouvre `<ton espace de travail>\model-priorities.json` (Réglages → « Ouvrir le dossier »), change les
  nombres, relance l'app. Ce fichier n'est jamais écrasé par une mise à jour de l'app : supprime-le pour récupérer la nouvelle version livrée.
  Le catalogue livré est strictement gratuit : les modèles payants sont exclus et ignorés, y compris s’ils sont ajoutés dans un fichier de priorités personnalisé.

## Où travaillent les agents

Tu choisis ton dossier de travail au premier lancement (écran dédié — plus aucun dossier imposé, v9.1.5). `opencode.jsonc` et
`.opencode\agents\*.md` y sont copiés (**jamais écrasés ensuite** : tes modifications restent). Bouton « Ouvrir le dossier » dans Réglages.
Les agents ne touchent donc ni au code de l'app ni au dossier d'installation.

## La carte des features (v9.4.0)

Trois étages, pour savoir « où cliquer » :

| Étage | Features | Rôle |
|---|---|---|
| **Faire** | **Projet** (orchestrateur), **Agents** (spécialistes + Freebuff sur la même page) | Deux portes, tous les assistants |
| **Contenu** | **Fichiers** (explorateur intégré), **Notes** (base de connaissance) | Ce sur quoi les agents travaillent — et ils s'y connectent |
| **Cadre** | **Espaces** (en-tête du hub, tout y vit), **Réglages** (Configuration, Apparence, **Usage**) | Le contenant et la configuration |

Interactions entre features : un fichier → « Faire analyser par un agent » (composeur) ; une note → « Joindre à la conversation » ;
une conversation → tags d'agent sur les notes ; la page **Assistants** → tableau « qui fait quoi », panneau et agent Freebuff (mêmes agents via le pont `.agents/`, mêmes notes via MCP) ; une sélection de code → « Faire relire » (code-reviewer).

## Convention de versionnement
- `vX` : grosse mise à jour / changement majeur.
- `vX.x` : petite mise à jour / évolution ou correction ciblée.

## Fichiers importants

- `host/opencode-bridge.ts` : lance/arrête `opencode serve`, attend que les agents soient chargés, relaie les événements. **Sans dépendance Electron** (testable avec Node).
- `host/operations.ts` : agents, conversations, messages, permissions.
- `host/aven-app-host.ts` : dispatch IPC `aven_call` (camelCase), clés chiffrées Windows (DPAPI), préférences, diagnostic, lancement Freebuff.
- `host/engine-host.ts` : moteur OpenCode embarqué (boot, seed d'espace, événements) — sans dépendance Electron/Tauri, testable avec Node.
- `host/providers.ts` : fournisseurs, variables d'environnement, pages pour obtenir une clé.
- `host/priorities.ts` (lecture/validation de la table, chaînes par agent) et `host/router.ts` (choix du modèle, compteurs, bascule) : sans Electron, testables avec Node.
- `model-priorities.json` : priorités par modèle et par agent (copié dans le dossier de travail au premier lancement).
- `web/src/api.ts` + `web/src/api-tauri.ts` : l'API côté renderer (`invoke("aven_call")`) — contrat typé dans `web/src/types.ts` (`OpenCodeApi`).
- `web/src/stream.ts` : réducteur pur des événements (texte en direct, outils, permissions, questions de l'agent, fin de tour).
- `web/src/SettingsDialog.tsx` : écran des clés et attribution des modèles (lecture seule).
- `web/src/FormDialog.tsx` : boîte de dialogue des questions de l'agent (outil `question`).
- `src-tauri/icons/icon.ico` : icône de l'app (remplace-la par la tienne, 512×512 minimum ; déclarée dans `tauri.conf.json`).
- `.opencode/agents/*.md` + `opencode.jsonc` : agents (format V2 : `permissions:` = liste de règles, la dernière qui correspond gagne).
- `host/freebuff-pty.ts` : PTY embarqué du CLI Freebuff (agent intégré, v9.2.0 ; `--trust-agents`/`--continue` en v9.5.0). Sans dépendance Electron, testé.
- `host/agents-bridge.ts` : pont catalogue d'agents — convertit les agents OpenCode en définitions TypeScript du CLI Freebuff (`.agents/`), génère le `mcp.json` des notes (v9.5.0).
- `aven-mcp-server.mjs` : serveur MCP embarqué (zéro dépendance) qui expose les notes de l'espace à Freebuff.
- `host/freebuff-cli.ts` : détection/lancement console externe du CLI (connexion, installation).
- `NOTES-VERIFIEES.md` : faits vérifiés sur OpenCode 2.0.10 (à lire avant de toucher au pont).

## Dépannage

| Symptôme | Cause / solution |
|---|---|
| « OpenCode n'est pas installé » au premier lancement | `npm install` exécute `scripts/ensure-binaries.mjs` (postinstall) qui télécharge le binaire OpenCode. À la main : `node scripts/ensure-binaries.mjs`. |
| « cargo introuvable » au premier `npm run dev` | La coque Tauri n'a pas d'outillage Rust. Installe Rust via [rustup.rs](https://rustup.rs) **et** les Build Tools 2022 avec le workload C++ (linker MSVC), puis **rouvre le terminal** : le PATH n'est pas rafraîchi dans une session déjà ouverte. |
| « resource path doesn't exist » (node.exe) au premier `npm run dev` | `tauri:dev` prépare désormais le runtime Node embarqué (`scripts/prepare-tauri-runtime.mjs`, SHA-256 vérifié). À la main : `node scripts/prepare-tauri-runtime.mjs`. |
| « OpenCode n'a pas démarré » + message | Le message contient les dernières lignes du CLI. Vérifie Réglages (clé) et le dossier de travail. |
| « Un terminal Freebuff est déjà ouvert » | Une seule session Freebuff par compte (takeover serveur). Ferme le terminal existant (ou l'app desktop Freebuff) puis relance. |
| Écran blanc une fois packagé | `web/vite.config.ts` doit garder `base: "./"`. |
| Agents introuvables | Ils se chargent en tâche de fond (quelques secondes) ; l'app attend jusqu'à 90 s. Vérifie que `.opencode\agents\*.md` a un frontmatter YAML valide. |
| Erreur 429 dans le chat | Limite de débit du modèle gratuit : change de modèle ou attends. Chaque message = plusieurs appels (une par étape de l'agent) : garde `steps` bas. |
| Mise à jour d'OpenCode | Mets `@opencode/client` ET `@opencode/cli` à la **même** version exacte (dans `package.json` et `EXPECTED_VERSION`). |


