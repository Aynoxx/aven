// v10.0.0 : fabrique testable de l'API Tauri — aucun import @tauri-apps ici :
// invoke/listen/dialogs sont injectés par web/src/api.ts, ce qui rend ce module
// importable par tests/tauri-api.test.mjs avec Node seul (règle 8, modules purs).
// Le comportement du Proxy reste STRICTEMENT identique à l'api.ts d'origine.
import type { OpenCodeApi } from "./types"

export type TauriDeps = {
  invoke: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>
  listen: <T>(event: string, handler: (event: { payload: T }) => void) => Promise<() => void>
  openDialog: (options: { directory: boolean; multiple: boolean; title?: string }) => Promise<string | null>
  saveDialog: (options: {
    title?: string
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => Promise<string | null>
}

// Sérialisation des args IPC : Uint8Array (non clonables tels quels dans Tauri v2
// sans convertFileSrc) → number[], récursivement pour les objets imbriqués.
export function serialize(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]))
  }
  return value
}

export function createTauriApi(deps: TauriDeps): OpenCodeApi {
  const { invoke, listen, openDialog, saveDialog } = deps

  return new Proxy({} as OpenCodeApi, {
    get(_target, property) {
      if (property === "onEvent") {
        return (callback: Parameters<OpenCodeApi["onEvent"]>[0]) => {
          let stopped = false
          let unlisten: (() => void) | undefined

          void listen<{ type: string; data: Record<string, any> }>("aven:event", (event) => {
            if (!stopped) callback(event.payload)
          }).then((stop) => {
            unlisten = stop
            if (stopped) stop()
          })

          return () => {
            stopped = true
            unlisten?.()
          }
        }
      }

      if (typeof property !== "string") return undefined

      if (property === "addExistingWorkspace") {
        return async () => {
          const selected = await openDialog({ directory: true, multiple: false })
          if (typeof selected !== "string" || !selected) return null
          return invoke<unknown>("aven_call", {
            method: "workspace:add",
            args: [selected, ""],
          })
        }
      }

      if (property === "createWorkspace") {
        return async (name: string) => {
          const selected = await openDialog({ directory: true, multiple: false })
          if (typeof selected !== "string" || !selected) return null
          return invoke<unknown>("aven_call", {
            method: "workspace:add",
            args: [selected, String(name ?? "")],
          })
        }
      }

      if (property === "exportChat") {
        return async (id: string) => {
          const data = await invoke<{ title: string; markdown: string }>("aven_call", {
            method: "exportChat",
            args: [String(id)],
          })
          if (!data) return null
          const safeName = String(data.title || "conversation")
            .replace(/[\\/:*?"<>|]/g, "_")
            .slice(0, 80) || "conversation"
          const selected = await saveDialog({
            title: "Exporter la conversation",
            defaultPath: safeName + ".md",
            filters: [{ name: "Markdown", extensions: ["md"] }],
          })
          if (typeof selected !== "string" || !selected) return null
          return invoke<string>("aven_call", {
            method: "writeTextFile",
            args: [selected, data.markdown],
          })
        }
      }

      if (property === "noteExport") {
        return async (id: string) => {
          const note = await invoke<{ title: string; markdown: string }>("aven_call", {
            method: "noteGet",
            args: [String(id)],
          })
          const safeName = String(note.title || "note")
            .replace(/[\\/:*?"<>|]/g, "_")
            .slice(0, 80) || "note"
          const selected = await saveDialog({
            title: "Exporter la note",
            defaultPath: safeName + ".md",
            filters: [{ name: "Markdown", extensions: ["md"] }],
          })
          if (typeof selected !== "string" || !selected) return null
          return invoke<string>("aven_call", {
            method: "writeTextFile",
            args: [selected, note.markdown],
          })
        }
      }

      if (property === "filesOpen") {
        return async (relative: string) => {
          const selected = await invoke<string>("aven_call", {
            method: "filesOpen",
            args: [String(relative ?? "")],
          })
          return invoke<string>("aven_call", { method: "openPath", args: [selected] })
        }
      }

      if (property === "noteOpenFolder") {
        return async () => {
          const selected = await invoke<string>("aven_call", { method: "noteOpenFolder", args: [] })
          return invoke<string>("aven_call", { method: "openPath", args: [selected] })
        }
      }

      return (...args: unknown[]) =>
        invoke<unknown>("aven_call", {
          method: property,
          args: args.map(serialize),
        })
    },
  })
}
