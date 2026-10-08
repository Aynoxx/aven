// v10.0.0 : la fabrique vivait ici — extraite dans api-tauri.ts (module pur, testé
// par tests/tauri-api.test.mjs). Ce fichier garde uniquement le câblage des
// dépendances Tauri et la sélection runtime.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { createTauriApi } from "./api-tauri"
import type { OpenCodeApi } from "./types"

// Electron expose toujours window.opencode via le preload.
// Tauri n'expose pas cet objet : on bascule alors vers un RPC unique.
// Garder cette sélection ici évite de modifier tous les composants React.
const electronApi = typeof window !== "undefined" ? window.opencode : undefined

const tauriApi = createTauriApi({ invoke, listen, openDialog, saveDialog })

export const api: OpenCodeApi = electronApi ?? tauriApi
