// v10.0.0 : la fabrique vivait ici — extraite dans api-tauri.ts (module pur, testé
// par tests/tauri-api.test.mjs). Ce fichier garde uniquement le câblage des
// dépendances Tauri. 100 % Tauri : la sélection runtime Electron (window.opencode
// exposé par le preload) a disparu avec le shell.
import { invoke } from "@tauri-apps/api/core"
import { listen } from "@tauri-apps/api/event"
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog"
import { createTauriApi } from "./api-tauri"
import type { OpenCodeApi } from "./types"

const tauriApi = createTauriApi({ invoke, listen, openDialog, saveDialog })

export const api: OpenCodeApi = tauriApi
