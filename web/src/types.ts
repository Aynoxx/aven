export type Agent = { id: string; name: string; defaultName?: string; description: string }
export type Chat = { id: string; title: string; agent?: string; model?: string; updated?: number; archived?: boolean }
export type ToolInfo = { id: string; name: string; status: string; output?: string }
// v9.1.6 : plus de backend "freebuff" — l'envoi passe uniquement par OpenCode.
export type SendResult = { backend: "opencode" }

export type Msg = {
  id: string
  role: "user" | "assistant"
  text: string
  agent?: string
  model?: string
  child?: boolean // fait partie du transcript d'un sous-agent
  tools?: ToolInfo[]
  error?: string
}
export type Ask = { id: string; sessionID: string; action: string; resources: string[]; message?: string }
export type FormOption = { value: string; label: string; description?: string }
export type FormField = {
  key: string
  type: "string" | "number" | "integer" | "boolean" | "multiselect" | "external"
  title?: string
  description?: string
  required?: boolean
  options?: FormOption[]
  default?: string | number | boolean | string[]
  custom?: boolean
  url?: string
}
export type Form = { id: string; sessionID: string; title: string; fields: FormField[] }
export type FormAnswer = Record<string, string | number | boolean | string[]>
export type Decision = "once" | "always" | "reject"

// Enveloppe utilisée par le reducer (stream.ts). "child" est calculé côté
// renderer (voir App.tsx) en comparant le sessionID à la conversation ouverte.
export type StreamEvent = { type: string; child: boolean; data: Record<string, any> }

// v10.3.0 : état du CLI Freebuff, produit par le gestionnaire unique du host
// (miroir de host/freebuff-cli-manager.ts). `state` dit où en est l'installation.
export type FreebuffCliState = "unknown" | "checking" | "installing" | "ready" | "failed"
export type FreebuffCliStatus = {
  installed: boolean
  version?: string
  state?: FreebuffCliState
  error?: string
  cliError?: string
}

export type ProviderLite = { id: string; label: string; url: string; note: string }
export type WorkspaceEntry = { path: string; name: string }
export type FileSyncResult = { file: string; status: "created" | "updated" | "unchanged" | "custom" }
export type Note = { id: string; title: string; markdown: string; updated: number }
// v10.1.0 : mode de tâche de l'orchestrateur (miroir de host/task-mode.ts).
export type TaskMode = "auto" | "code" | "analyse" | "recherche"
// v10.1.0 : arbre de notes façon Kortex (miroir de host/notes.ts).
export type NoteTreeEntry =
  | { type: "folder"; id: string; name: string; children: NoteTreeEntry[] }
  | { type: "note"; id: string; name: string; title: string; updated: number }
export type NoteLink = { target: string; resolved: string | null }
export type NoteSearchHit = { id: string; title: string; snippet: string }
// v9.3.0 : explorateur de fichiers de l'espace (miroir de host/workspace-files.ts).
export type RecentFile = { path: string; name: string; opened: number }
export type FileEntry = { name: string; path: string; kind: "dir" | "file"; size: number; modified: number }
export type TextFile = { path: string; size: number; truncated: boolean; content: string }
export type Breadcrumb = { label: string; path: string }[]
// Miroir de host/voice-intent.ts (contrat IPC identique, types dupliqués volontairement).
// v10.4.0 : « open-project » (page Projet) et « go-home » (accueil) — la page Projet
// n'avait aucune commande vocale, et « ouvre le projet » tombait sur les Réglages.
export type AppAction = "open-project" | "open-notes" | "open-settings" | "open-agents" | "open-projects" | "open-workspace" | "open-freebuff" | "open-stats" | "new-chat" | "go-home"
export type DictationIntent =
  | { intent: "app"; action: AppAction } // commande d'application à exécuter
  | { intent: "agent"; target?: string } // tâche pour un autre agent (absent = courant)
  | { intent: "chat" } // dictée ordinaire pour l'agent courant

export type DictationResult = {
  raw: string // transcription Whisper telle quelle
  cleaned?: string // après passe de reformage (absent si la passe a échoué)
  cleanedBy?: string // nom du modèle de reformage
  warning?: string // raison pour laquelle le reformage n'a pas eu lieu
  intent?: DictationIntent // routage décidé par la passe d'intention (absent si elle a échoué)
}

// v11.1.0 : agent vocal — miroirs de host/voice-agent-*.ts (duplication volontaire
// et commentée des contrats IPC, comme les autres types du fichier).
export type VoicePersonality = "neutre" | "direct" | "chaleureux"
export type VoiceAgentPrefs = { voiceName: string; personality: VoicePersonality; micMuted: boolean }
// v11.12.0 : `sleep` dit que la phrase est un ordre de repos (« Aven, dors ») —
// le mode éveillé se termine par un ordre nommé, jamais par un mot deviné.
// v11.14.1 : `addressed` dit que la parole s'adresse vraiment à Aven — en veille,
// le bruit de la pièce est écarté sans réponse (host/voice-agent-addressed.ts).
export type VoiceInterpretation = { woken: boolean; command: string | null; demand: string; sleep: boolean; addressed: boolean }
// v11.9.0 : une action destructive n'est jamais exécutée par le modèle — il la
// propose, et `pending` porte le jeton que le renderer rappellera après un
// « oui » oral. `prompt` est la question canonique, déjà dite par le host.
export type VoiceAnswer = { text: string; sentences: string[]; pending?: { token: string; prompt: string } }
// v11.15.0 : `noteId` permet d'afficher la note que l'agent vient de créer —
// une note confirmée mais invisible serait une parole en l'air.
export type VoiceActionResult = { text: string; sentences: string[]; noteId?: string }
// v11.14.0 : la voix est soit locale en flux (PCM rendu à la webview, qui
// l'empile), soit Windows locale (le host a déjà parlé : `spoken`). `warning`
// signale un repli : l'utilisateur doit savoir pourquoi le timbre a changé.
export type VoiceSpeech = { audio?: string; mime?: string; spoken?: boolean; warning?: string }
// v11.5.3 : flux audio — le host pousse des trames, le renderer joue dès la
// première. `fallback` signifie qu'aucun son n'a été joué et que le host a
// parlé par un autre chemin (voix Windows).
export type VoiceStreamResult = {
  mime?: string
  streamed?: boolean
  cached?: boolean
  fallback?: VoiceSpeech
  warning?: string
}
// v11.11.0 : état du clonage de voix côté host. Aucun secret ici : le jeton
// Hugging Face ne remonte que sous forme de booléen. `weights` dit si le modèle de
// clonage est déjà dans les données de l'app ; `engine` si le moteur est installé.
export type VoiceCloneStatus = { engine: boolean; weights: boolean; profile: boolean; token: boolean }
// v11.11.0 : résultat d'un clonage — `downloaded` signale que le modèle a été
// téléchargé pour l'occasion (209 Mo, une seule fois).
export type VoiceCloneResult = { profile: boolean; voiceName: string; downloaded?: boolean }

// Miroir de host/stats.ts (AgregatedStats) : chiffres affichables du panneau de stats.
export type AggregatedStats = {
  totalChats: number
  archivedChats: number
  perAgent: { agent: string; count: number }[]
  dictationsTotal: number
  dictationsToday: number
  topModels: { model: string; count: number }[]
}

export type AppState = {
  status: "starting" | "ready" | "error"
  error?: string
  // v9.1.5 : vrai tant qu'aucun espace de travail n'existe — l'app montre l'écran de choix.
  needsWorkspace?: boolean
  keys: Record<string, boolean> // la clé elle-même n'est JAMAIS envoyée à l'interface
  keyWarnings?: Record<string, string>
  providers: ProviderLite[]
  version?: string
  cli?: string // "embarqué", "PATH" ou "OPENCODE_BIN"
  workspace?: string
  workspaces?: WorkspaceEntry[]
  sync?: FileSyncResult[]
  newModels?: string[]
  removedModels?: string[]
  // v9.5.0 : fichiers du pont agents écrits/mis à jour à la dernière synchro (.agents/…).
  agentsBridge?: string[]
  assignments?: Record<string, { ref: string; label: string }[]> // agent → modèles par ordre de priorité (lecture seule)
  warning?: string
  versionWarning?: string // version du serveur OpenCode ≠ version attendue par le client
}

// API exposée par host/preload.cts via contextBridge.
export type OpenCodeApi = {
  apiVersion?: number
  state: () => Promise<AppState>
  setKey: (provider: string, key: string) => Promise<AppState>
  openExternal: (url: string) => Promise<void>
  openWorkspace: () => Promise<string>

  workspaces: () => Promise<WorkspaceEntry[]>
  switchWorkspace: (dir: string) => Promise<AppState>
  addExistingWorkspace: () => Promise<{ entry: WorkspaceEntry; state: AppState } | null>
  createWorkspace: (name: string) => Promise<{ entry: WorkspaceEntry; state: AppState } | null>
  removeWorkspace: (dir: string) => Promise<WorkspaceEntry[]>

  agents: () => Promise<Agent[]>
  chats: (agent: string, includeArchived?: boolean) => Promise<Chat[]>
  createChat: (agent: string) => Promise<Chat>
  deleteChat: (id: string) => Promise<void>
  renameChat: (id: string, title: string) => Promise<{ id: string; title: string }>
  archiveChat: (id: string, archived: boolean) => Promise<void>
  // v9.4.0 : sélecteur de modèle interactif (ref absent = retour au « Auto » du routeur).
  setChatModel: (id: string, ref?: string) => Promise<Chat>
  modelChain: (agent: string) => Promise<{ ref: string; label: string }[]>
  exportChat: (id: string) => Promise<string | null>
  messages: (id: string) => Promise<Msg[]>
  // v9.1.6 : plus de paramètre backend — l'envoi passe uniquement par OpenCode.
  send: (id: string, text: string) => Promise<SendResult>
  interrupt: (id: string) => Promise<void>
  reply: (sessionID: string, requestID: string, decision: Decision) => Promise<void>
  replyForm: (sessionID: string, formID: string, answer: FormAnswer) => Promise<void>
  cancelForm: (sessionID: string, formID: string) => Promise<void>
  notesList: () => Promise<Note[]>
  noteGet: (id: string) => Promise<Note>
  // v9.3.0 : édition intégrée + tags par agent.
  noteSave: (id: string, title: string, markdown: string) => Promise<Note>
  noteSetTags: (id: string, tags: string[]) => Promise<string[]>
  noteTags: (id: string) => Promise<string[]>
  // v10.5.0 : évite un appel IPC par note dans l'arbre Notes.
  noteTagsAll: () => Promise<Record<string, string[]>>
  // v9.3.0 : explorateur de fichiers intégré (lecture seule, cloisonné à l'espace).
  filesList: (relative: string) => Promise<FileEntry[]>
  filesRead: (relative: string) => Promise<TextFile>
  filesBreadcrumb: (relative: string) => Promise<Breadcrumb>
  filesOpen: (relative: string) => Promise<string>
  // v12.3.0 : historique des fichiers ouverts dans l'espace (accueil « Reprendre »).
  filesRecent: () => Promise<RecentFile[]>
  filesTouch: (relative: string) => Promise<RecentFile[]>
  noteTogglePin: (id: string) => Promise<string[]>
  notePins: () => Promise<string[]>
  noteExport: (id: string) => Promise<string | null>
  noteDir: () => Promise<string>
  noteOpenFolder: () => Promise<string>
  // v10.1.0 : mode de tâche de l'orchestrateur.
  taskMode: () => Promise<TaskMode>
  setTaskMode: (mode: TaskMode) => Promise<TaskMode>
  // v10.1.0 : notes façon Kortex — arbre, dossiers, poubelle, archive, liens, recherche, capture.
  notesTree: () => Promise<NoteTreeEntry[]>
  noteCreateFolder: (folder: string) => Promise<string>
  noteRenameFolder: (from: string, to: string) => Promise<string>
  noteDeleteFolder: (folder: string) => Promise<string>
  noteMove: (id: string, folder: string) => Promise<string>
  noteDelete: (id: string) => Promise<string>
  noteRestore: (id: string) => Promise<string>
  noteArchive: (id: string) => Promise<string>
  noteUnarchive: (id: string) => Promise<string>
  noteTrash: () => Promise<Note[]>
  noteArchived: () => Promise<Note[]>
  notePurge: (id: string) => Promise<string>
  noteLinks: (id: string) => Promise<NoteLink[]>
  noteBacklinks: (id: string) => Promise<string[]>
  noteSearch: (query: string) => Promise<NoteSearchHit[]>
  noteQuickCapture: (title: string, markdown: string) => Promise<Note>
  getStats: () => Promise<AggregatedStats>
  voiceTranscribe: (audio: Uint8Array, mimeType: string) => Promise<DictationResult>
  // v11.1.0 : agent vocal (mot d'activation « Aven ») — STT et LLM distants,
  // voix Windows choisie dans les Réglages, aucun repli payant.
  voiceAgentPrefs: () => Promise<VoiceAgentPrefs>
  setVoiceAgentPrefs: (patch: { voiceName?: string; personality?: VoicePersonality; micMuted?: boolean }) => Promise<VoiceAgentPrefs>
  voiceAgentVoices: () => Promise<string[]>
  voiceAgentTranscribe: (audio: Uint8Array, mimeType: string) => Promise<{ text: string }>
  // v11.14.1 : `expectsAnswer` dit qu'Aven vient de poser une question — une
  // réponse courte (« oui », « non ») lui est alors adressée.
  voiceAgentInterpret: (text: string, expectsAnswer?: boolean) => Promise<VoiceInterpretation>
  voiceAgentAsk: (question: string) => Promise<VoiceAnswer>
  // v11.16.0 : rédige le contenu d'une note demandée (jamais écrit par le modèle).
  voiceAgentComposeNote: (demand: string) => Promise<{ content: string }>
  // v11.9.0 : confirmation orale d'une action proposée (suppression, corbeille).
  voiceAgentConfirmAction: (token: string) => Promise<VoiceActionResult>
  voiceAgentCancelAction: (token: string) => Promise<void>
  voiceAgentSpeak: (text: string, voice?: string) => Promise<void>
  // v11.3.0 : chemin unique de lecture — le host choisit la voix neuronale ou Windows.
  voiceAgentSay: (text: string) => Promise<VoiceSpeech>
  // v11.5.3 : un flux PCM, des trames jouées au fur et à mesure.
  voiceAgentSayStream: (text: string, streamId: string) => Promise<VoiceStreamResult>
  // v11.10.0 : le host dit quel lecteur préparer avant la demande — « pcm » pour la
  // voix locale Pocket (échantillons nus), « none » quand l'audio sera rendu d'un
  // bloc (voix Windows).
  voiceAgentStreamKind: () => Promise<"pcm" | "none">
  // v11.11.0 : la voix clonée se crée dans l'app. `voiceCloneFromAudio` ouvre le
  // choix d'un enregistrement (annulation → null) ; le jeton est un secret du host.
  voiceCloneStatus: () => Promise<VoiceCloneStatus>
  voiceCloneFromAudio: () => Promise<VoiceCloneResult | null>
  voiceCloneRemove: () => Promise<VoiceCloneResult>
  setVoiceCloneToken: (token: string) => Promise<{ token: boolean }>
  voiceAgentPreview: (text: string, voice?: string) => Promise<VoiceSpeech>
  voiceAgentStop: () => Promise<void>
  announcerActivity: () => Promise<void>
  announcerSetEnabled: (on: boolean) => Promise<boolean>
  announcerTest: (text: string) => Promise<void>
  prefs: () => Promise<{ notifications: boolean; freebuffResume?: boolean }>
  setNotifications: (on: boolean) => Promise<{ notifications: boolean }>
  setFreebuffResume: (on: boolean) => Promise<{ notifications: boolean; freebuffResume?: boolean }>
  diagnostic: () => Promise<string>
  freebuffCliStatus: () => Promise<FreebuffCliStatus>
  // v10.3.0 : vérifie/installe le CLI une seule fois pour toute l'app (idempotent).
  // `force` = nouvelle tentative après un échec (bouton utilisateur).
  freebuffCliEnsure: (force?: boolean) => Promise<FreebuffCliStatus>
  freebuffCliLaunch: (action?: "launch" | "login", cols?: number, rows?: number) => Promise<boolean>
  // v9.2.0 : pont PTY freebuff — le port WS est local (127.0.0.1), reused = pont déjà actif.
  // v9.2.0 : PTY embarqué (protocole freebuff-pty) — pas de WebSocket, flux par IPC ;
  // les événements freebuff.pty.* transitent par onEvent.
  freebuffPtyInput: (data: string) => Promise<void>
  freebuffPtyResize: (cols: number, rows: number) => Promise<void>
  freebuffPtySignal: (signal: "SIGINT") => Promise<void>
  freebuffPtyRestart: () => Promise<void>
  freebuffPtyActive: () => Promise<boolean>
  // v9.6.2 : l'app Desktop Freebuff tourne-t-elle ? (elle tient la session du compte —
  // le terminal intégré ne peut alors pas répondre : bannière + message explicite.)
  freebuffDesktopRunning: () => Promise<boolean>
  onEvent: (cb: (ev: { type: string; data: Record<string, any> }) => void) => () => void
}
