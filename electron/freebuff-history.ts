import { app } from "electron"
import { readFileSync } from "node:fs"
import path from "node:path"
import { writeJsonAtomicPretty } from "./atomic-file.js"

export type FreebuffStoredMessage = {
  id: string
  role: "user" | "assistant"
  text: string
  agent?: string
  model?: string
  timestamp: number
  error?: string
}

type StoredSession = {
  messages?: FreebuffStoredMessage[]
  previousRun?: unknown
}

type Store = { sessions?: Record<string, StoredSession> }

function storeFile() {
  return path.join(app.getPath("userData"), "freebuff-history.json")
}

function readStore(): Store {
  try {
    const raw = JSON.parse(readFileSync(storeFile(), "utf8")) as Store
    if (raw && typeof raw === "object") return raw
  } catch {
    /* première utilisation ou fichier illisible */
  }
  return { sessions: {} }
}

function writeStore(store: Store) {
  writeJsonAtomicPretty(storeFile(), store)
}

export function getFreebuffMessages(chatId: string): FreebuffStoredMessage[] {
  return [...(readStore().sessions?.[chatId]?.messages ?? [])]
}

export function appendFreebuffMessages(chatId: string, messages: FreebuffStoredMessage[]) {
  if (!messages.length) return
  const store = readStore()
  const sessions = { ...(store.sessions ?? {}) }
  const current = sessions[chatId] ?? {}
  const merged = [...(current.messages ?? []), ...messages]
  // Garde-fou : l'historique Freebuff reste local et borné, même après une longue utilisation.
  current.messages = merged.slice(-600)
  sessions[chatId] = current
  writeStore({ sessions })
}

export function getFreebuffPreviousRun(chatId: string): unknown | undefined {
  return readStore().sessions?.[chatId]?.previousRun
}

export function setFreebuffPreviousRun(chatId: string, previousRun: unknown) {
  const store = readStore()
  const sessions = { ...(store.sessions ?? {}) }
  sessions[chatId] = { ...(sessions[chatId] ?? {}), previousRun }
  writeStore({ sessions })
}

export function clearFreebuffHistory(chatId: string) {
  const store = readStore()
  if (!store.sessions?.[chatId]) return
  const sessions = { ...store.sessions }
  delete sessions[chatId]
  writeStore({ sessions })
}
