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
  send: (id: string, text: string, backend?: "opencode" | "freebuff") => call("chats:send", id, text, backend),
  interrupt: (id: string) => call("chats:interrupt", id),
  reply: (sessionID: string, requestID: string, decision: string) => call("permissions:reply", sessionID, requestID, decision),
  replyForm: (sessionID: string, formID: string, answer: Record<string, unknown>) => call("forms:reply", sessionID, formID, answer),
  cancelForm: (sessionID: string, formID: string) => call("forms:cancel", sessionID, formID),
  notesList: () => call("notes:list"),
  noteGet: (id: string) => call("notes:get", id),
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
  onEvent: (cb: (ev: { type: string; data: Record<string, unknown> }) => void) => {
    const listener = (_e: unknown, ev: { type: string; data: Record<string, unknown> }) => cb(ev)
    ipcRenderer.on("opencode:event", listener)
    return () => ipcRenderer.removeListener("opencode:event", listener)
  },
})
