// Stub minimal du module "electron" pour les tests : les modules testés (settings.ts,
// workspaces.ts…) importent app/safeStorage mais les fonctions testées ne les appellent
// jamais réellement. Ce fichier est servi à la place du paquet npm "electron" par le
// résolveur tests/hooks.mjs.
export const app = { getPath: () => "/tmp/aven-test-userdata" }
export const safeStorage = {
  isEncryptionAvailable: () => false,
  encryptString: () => Buffer.from(""),
  decryptString: () => Buffer.from(""),
}
export const contextBridge = {}
export const ipcRenderer = {}
export default { app, safeStorage, contextBridge, ipcRenderer }
