import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog } from "@tauri-apps/plugin-dialog"
import type { OpenCodeApi } from "./types"

// Electron expose toujours window.opencode via le preload.
// Tauri n'expose pas cet objet : on bascule alors vers un RPC unique.
// Garder cette sélection ici évite de modifier tous les composants React.
const electronApi = typeof window !== "undefined" ? window.opencode : undefined

function serialize(value: unknown): unknown {
  if (value instanceof Uint8Array) return Array.from(value)
  if (Array.isArray(value)) return value.map(serialize)
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, serialize(entry)]))
  }
  return value
}

const tauriApi = new Proxy({} as OpenCodeApi, {
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

    return (...args: unknown[]) =>
      invoke<unknown>("aven_call", {
        method: property,
        args: args.map(serialize),
      })
  },
})

export const api: OpenCodeApi = electronApi ?? tauriApi
