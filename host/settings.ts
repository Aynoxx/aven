// v10.0.0 : settings.ts n'est plus qu'une ré-exportation historique du seed.
// L'ancien couplage Electron (app.getPath + safeStorage pour chiffrer les clés)
// a disparu avec le shell : les chemins et le chiffrement Windows vivent dans
// aven-app-host.ts (AVEN_USER_DATA_DIR + DPAPI), sans aucune dépendance Electron.
export { trackedAgentFiles, seedWorkspace } from "./workspace-seed.js"
