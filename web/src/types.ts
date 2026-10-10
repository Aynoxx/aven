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
export type FileEntry = { name: string; path: string; kind: "dir" | "file"; size: number; modified: number }
export type TextFile = { path: string; size: number; truncated: boolean; content: string }
export type Breadcrumb = { label: string; path: string }[]
// Miroir de host/voice-intent.ts (contrat IPC identique, types dupliqués volontairement).
export type AppAction = "open-notes" | "open-settings" | "open-agents" | "open-projects" | "open-workspace" | "open-freebuff" | "open-stats" | "new-chat"
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
  updatesConfigured: boolean
}

// API exposée par host/preload.cts via contextBridge.
export type OpenCodeApi = {
  apiVersion?: number
  state: () => Promise<AppState>
  setKey: (provider: string, key: string) => Promise<AppState>
  openExternal: (url: string) => Promise<void>
  openWorkspace: () => Promise<string>
  checkForUpdates: () => Promise<{ ok: boolean; message: string }>

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
  // v9.3.0 : explorateur de fichiers intégré (lecture seule, cloisonné à l'espace).
  filesList: (relative: string) => Promise<FileEntry[]>
  filesRead: (relative: string) => Promise<TextFile>
  filesBreadcrumb: (relative: string) => Promise<Breadcrumb>
  filesOpen: (relative: string) => Promise<string>
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
  announcerActivity: () => Promise<void>
  announcerSetEnabled: (on: boolean) => Promise<boolean>
  announcerTest: (text: string) => Promise<void>
  prefs: () => Promise<{ notifications: boolean; freebuffResume?: boolean }>
  setNotifications: (on: boolean) => Promise<{ notifications: boolean }>
  setFreebuffResume: (on: boolean) => Promise<{ notifications: boolean; freebuffResume?: boolean }>
  diagnostic: () => Promise<string>
  freebuffCliStatus: () => Promise<{ installed: boolean; version?: string }>
  freebuffCliLaunch: (action?: "launch" | "login" | "install", cols?: number, rows?: number) => Promise<boolean>
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
