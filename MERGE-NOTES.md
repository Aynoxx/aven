# Fusion Aven v6.1 + v6.3

Base retenue : v6.3 (`Aven-v6_3-refonte2-final.zip`), complétée avec les nouveautés encore présentes dans v6.1.

Intégrations principales :
- v6.3 : refonte visuelle, personnalisation, renommage des conversations/agents, création automatique des chats, fenêtre sans cadre et contrôles IPC.
- v6.1 : Markdown riche (`react-markdown`, GFM, coloration du code), composants d'historique mémorisés, streaming regroupé par `requestAnimationFrame`, suivi du défilement + retour au dernier message, annulation d'un formulaire via Échap, verrou mono-instance, détection de configuration du publisher, journalisation du titre auto, publication Windows désactivée par défaut.
- Fonctionnalité de disposition complétée : ordre des blocs principaux réorganisable depuis Apparence et accès direct à Apparence depuis l'accueil/la session.

Validation effectuée :
- Parsing TypeScript/TSX : 0 diagnostic sur 26 fichiers.
- `tsc -p web/tsconfig.json --noEmit` : OK.
- Présence des handlers IPC/preload pour fenêtre, renommage conversation et agent : OK.
- Dépendances Markdown enrichi présentes dans `web/package.json`.
- Build Electron complet non exécuté : les deux archives sources ne contiennent pas `node_modules`.

## v6.4 — Assistant vocal

Ajout de l’assistant vocal décrit dans `Texte collé.txt` : registre central des App Tools, classification SAFE/CONFIRM/BLOCKED, contrôleur d’intentions, STT/TTS remplaçables, panneau flottant avec états visuels, notes Markdown, sélection d’agents/projets/conversations, confirmations, interruption et historique. OpenCode 2.0.10 reste le moteur existant.
