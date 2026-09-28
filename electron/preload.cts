// .cts => compilé en CommonJS (preload.cjs). Indispensable : un preload "sandboxé" ne peut pas être un module ES.
import { contextBridge, ipcRenderer } from "electron"

const call = (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args)

contextBridge.exposeInMainWorld("opencode", {
  apiVersion: 2,
  state: () => call("app:state"),
  setKey: (provider: string, key: string) => call("settings:setKey", provider, key),
  openExternal: (url: string) => call("app:openExternal", url),
  openWorkspace: () => call("app:openWorkspace"),
  checkForUpdates: () => call("app:checkForUpdates"),
  minimizeWindow: () => call("window:minimize"),
  toggleMaximize: () => call("window:toggleMaximize"),
  closeWindow: () => call("window:close"),

  workspaces: () => call("workspace:list"),
  switchWorkspace: (dir: string) => call("workspace:switch", dir),
  addExistingWorkspace: () => call("workspace:addExisting"),
  createWorkspace: (name: string) => call("workspace:createNew", name),
  removeWorkspace: (dir: string) => call("workspace:remove", dir),

  agents: () => call("agents:list"),
  chats: (agent: string, includeArchived?: boolean) => call("chats:list", agent, includeArchived),
  createChat: (agent: string) => call("chats:create", agent),
  renameChat: (id: string, title: string) => call("chats:rename", id, title),
  renameAgent: (id: string, name: string) => call("agents:rename", id, name),
  deleteChat: (id: string) => call("chats:delete", id),
  archiveChat: (id: string, archived: boolean) => call("chats:archive", id, archived),
  exportChat: (id: string) => call("chats:export", id),
  messages: (id: string) => call("chats:messages", id),
  // v9.1.6 : plus de paramètre backend — l'envoi passe uniquement par OpenCode.
  send: (id: string, text: string) => call("chats:send", id, text),
  interrupt: (id: string) => call("chats:interrupt", id),
  reply: (sessionID: string, requestID: string, decision: string) => call("permissions:reply", sessionID, requestID, decision),
  replyForm: (sessionID: string, formID: string, answer: Record<string, unknown>) => call("forms:reply", sessionID, formID, answer),
  cancelForm: (sessionID: string, formID: string) => call("forms:cancel", sessionID, formID),
  notesList: () => call("notes:list"),
  noteGet: (id: string) => call("notes:get", id),
  // v9.3.0 : édition intégrée + tags par agent.
  noteSave: (id: string, title: string, markdown: string) => call("notes:save", id, title, markdown),
  noteSetTags: (id: string, tags: string[]) => call("notes:setTags", id, tags),
  noteTags: (id: string) => call("notes:tags", id),
  // v9.3.0 : explorateur de fichiers intégré (lecture seule, cloisonné à l'espace).
  filesList: (relative: string) => call("files:list", relative),
  filesRead: (relative: string) => call("files:read", relative),
  filesBreadcrumb: (relative: string) => call("files:breadcrumb", relative),
  filesOpen: (relative: string) => call("files:open", relative),
  noteTogglePin: (id: string) => call("notes:togglePin", id),
  notePins: () => call("notes:pins"),
  noteExport: (id: string) => call("notes:export", id),
  noteDir: () => call("notes:dir"),
  noteOpenFolder: () => call("notes:openFolder"),
  getStats: () => call("stats:get"),
  voiceTranscribe: (audio: Uint8Array, mimeType: string) => call("voice:transcribe", audio, mimeType),
  announcerActivity: () => call("announcer:activity"),
  announcerSetEnabled: (on: boolean) => call("announcer:setEnabled", on),
  announcerTest: (text: string) => call("announcer:test", text),
  prefs: () => call("prefs:get"),
  setNotifications: (on: boolean) => call("prefs:setNotifications", on),
  diagnostic: () => call("app:diagnostic"),
  freebuffCliStatus: () => call("freebuff:status"),
  // v9.4.0 : « launch » transmet les dimensions xterm réelles (TUI lisible dès l'ouverture).
  freebuffCliLaunch: (action: "launch" | "login" | "install", cols?: number, rows?: number) => call("freebuff:launch", action, cols, rows),
  // v9.4.0 : sélecteur de modèle — changer le modèle d'une conversation / lire la chaîne d'un agent.
  setChatModel: (id: string, ref?: string) => call("chats:setModel", id, ref),
  modelChain: (agent: string) => call("chats:chain", agent),
  // v9.2.0 : canaux du PTY embarqué (protocole freebuff-pty) — pas de WebSocket : le
  // flux passe par IPC, et les événements freebuff.pty.* arrivent via onEvent ci-dessous.
  freebuffPtyInput: (data: string) => call("freebuff:pty:input", data),
  freebuffPtyResize: (cols: number, rows: number) => call("freebuff:pty:resize", cols, rows),
  freebuffPtySignal: (signal: "SIGINT") => call("freebuff:pty:signal", signal),
  freebuffPtyRestart: () => call("freebuff:pty:restart"),
  freebuffPtyActive: () => call("freebuff:pty:active"),
  onEvent: (cb: (ev: { type: string; data: Record<string, unknown> }) => void) => {
    const listener = (_e: unknown, ev: { type: string; data: Record<string, unknown> }) => cb(ev)
    ipcRenderer.on("opencode:event", listener)
    return () => ipcRenderer.removeListener("opencode:event", listener)
  },
})
