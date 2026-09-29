// En version web (HTTP), ce fichier faisait des `fetch("/api/...")`.
// En version Electron, `window.opencode` (exposé par electron/preload.ts)
// fait exactement le même travail via IPC : même contrat, transport différent.
export const api = window.opencode
