// En version web (HTTP), ce fichier faisait des `fetch("/api/...")`.
// En version Electron, `window.opencode` (exposé par electron/preload.ts)
// fait exactement le même travail via IPC : même contrat, transport différent.
export const api = window.opencode


// Compatibilité de diagnostic : les anciennes versions du preload n'exposaient pas toujours
// renameAgent. Le build Electron doit être régénéré pour utiliser l'IPC actuel.
if (typeof api.renameAgent !== "function") {
  console.warn("Aven : renameAgent absent du preload. Relance le build Electron.")
}
