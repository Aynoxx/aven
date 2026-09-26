export type Agent = { id: string; name: string; defaultName?: string; description: string }
export type Chat = { id: string; title: string; agent?: string; model?: string; updated?: number; archived?: boolean }
export type ToolInfo = { id: string; name: string; status: string; output?: string }
export type SendResult = { backend: "opencode" | "freebuff"; response?: string; model?: string }

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
// Miroir de electron/voice-intent.ts (contrat IPC identique, types dupliqués volontairement).
export type AppAction = "open-notes" | "open-settings" | "open-agents" | "open-projects" | "open-workspace"
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

// Miroir de electron/stats.ts (AgregatedStats) : chiffres affichables du panneau de stats.
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
  assignments?: Record<string, { ref: string; label: string }[]> // agent → modèles par ordre de priorité (lecture seule)
  warning?: string
  versionWarning?: string // version du serveur OpenCode ≠ version attendue par le client
  updatesConfigured: boolean
}

// API exposée par electron/preload.cts via contextBridge.
export type OpenCodeApi = {
  apiVersion?: number
  state: () => Promise<AppState>
  setKey: (provider: string, key: string) => Promise<AppState>
  openExternal: (url: string) => Promise<void>
  openWorkspace: () => Promise<string>
  checkForUpdates: () => Promise<{ ok: boolean; message: string }>
  minimizeWindow: () => Promise<boolean>
  toggleMaximize: () => Promise<boolean>
  closeWindow: () => Promise<boolean>

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
  renameAgent: (id: string, name: string) => Promise<Agent[]>
  archiveChat: (id: string, archived: boolean) => Promise<void>
  exportChat: (id: string) => Promise<string | null>
  messages: (id: string) => Promise<Msg[]>
  send: (id: string, text: string, backend?: "opencode" | "freebuff") => Promise<SendResult>
  interrupt: (id: string) => Promise<void>
  reply: (sessionID: string, requestID: string, decision: Decision) => Promise<void>
  replyForm: (sessionID: string, formID: string, answer: FormAnswer) => Promise<void>
  cancelForm: (sessionID: string, formID: string) => Promise<void>
  notesList: () => Promise<Note[]>
  noteGet: (id: string) => Promise<Note>
  noteTogglePin: (id: string) => Promise<string[]>
  notePins: () => Promise<string[]>
  noteExport: (id: string) => Promise<string | null>
  noteDir: () => Promise<string>
  noteOpenFolder: () => Promise<string>
  getStats: () => Promise<AggregatedStats>
  voiceTranscribe: (audio: Uint8Array, mimeType: string) => Promise<DictationResult>
  announcerActivity: () => Promise<void>
  announcerSetEnabled: (on: boolean) => Promise<boolean>
  announcerTest: (text: string) => Promise<void>
  prefs: () => Promise<{ notifications: boolean }>
  setNotifications: (on: boolean) => Promise<{ notifications: boolean }>
  diagnostic: () => Promise<string>
  freebuffCliStatus: () => Promise<{ installed: boolean; version?: string }>
  freebuffCliLaunch: (action?: "launch" | "login" | "install") => Promise<boolean>
  onEvent: (cb: (ev: { type: string; data: Record<string, any> }) => void) => () => void
}

declare global {
  interface Window {
    opencode: OpenCodeApi
  }
}
