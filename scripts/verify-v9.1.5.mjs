import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const workspaces = read("electron/workspaces.ts")
const main = read("electron/main.ts")
const cli = read("electron/freebuff-cli.ts")
const app = read("web/src/App.tsx")
const settingsDialog = read("web/src/SettingsDialog.tsx")
const css = read("web/src/App.css")

// ── Version ──
const [vMaj, vMin, vPatch] = pkg.version.split(".").map(Number)
assert.ok(vMaj * 10000 + vMin * 100 + vPatch >= 90105, `version trop ancienne : ${pkg.version}`)

// A. Plus AUCUN espace « Par défaut » imposé : registre vide = état normal de choix.
assert.ok(!workspaces.includes("Par défaut"), "le nom « Par défaut » doit avoir disparu de workspaces.ts")
assert.ok(!/defaultWorkspace/.test(workspaces), "defaultWorkspace doit avoir disparu")
assert.ok(!/ensureDefaultRegistered/.test(workspaces), "ensureDefaultRegistered doit avoir disparu")
assert.ok(!/ensureDefaultRegistered/.test(main), "main.ts ne doit plus appeler ensureDefaultRegistered")
assert.match(workspaces, /activeWorkspace\(\): WorkspaceEntry \| null/, "activeWorkspace doit pouvoir ne renvoyer aucun espace")
assert.match(main, /activeWorkspace\(\)\?\.path \?\? ""/, "boot : aucun espace → workspace vide")

// B. Boot sans espace : état needsWorkspace, aucun démarrage moteur sur un dossier vide.
assert.match(main, /needsWorkspace: true/, "l'état sans espace doit signaler needsWorkspace")
assert.match(main, /requireWorkspace/, "les IPC qui lisent workspace doivent passer par requireWorkspace")

// C. L'interface propose le choix : écran dédié dès qu'aucun espace n'existe.
assert.match(app, /appState\.needsWorkspace/, "App doit réagir à needsWorkspace")
assert.match(app, /workspace-picker/, "écran de choix d'espace attendu")
assert.match(app, /Créer un nouvel espace…/)
assert.match(app, /Ouvrir un dossier existant…/)
assert.match(css, /\.workspace-picker/, "CSS de l'écran de choix attendu")

// D. Le bouton « Utiliser » bascule VRAIMENT d'espace (bug v9.0.0 : chemin ignoré).
assert.match(settingsDialog, /api\.switchWorkspace\(dir\)/, "switchWs doit appeler switchWorkspace avec le chemin")

// E. Retrait du dernier espace autorisé → retour à l'écran de choix.
assert.ok(!/state\.workspaces\?\.length \?\? 0\) > 1/.test(settingsDialog), "le retrait ne doit plus être limité à plusieurs espaces")
assert.match(main, /if \(!list\.length\) \{/, "retrait du dernier espace : retour au choix")

// F. Anti-double-session Freebuff : détection du process + message takeover clair.
assert.match(main, /isFreebuffProcessRunning/, "détection freebuff.exe attendue avant lancement")
assert.match(main, /freebuffBusyMessage/, "le refus de 2e terminal doit avoir son message")
assert.match(cli, /export function freebuffBusyMessage/, "freebuffBusyMessage doit exister dans freebuff-cli.ts")
assert.match(cli, /taken over/, "le message doit expliquer l'erreur « taken over » vue par l'utilisateur")
assert.match(cli, /déjà ouvert/)

// G. Test de non-régression couvrant le nouveau contrat workspaces.
assert.ok(read("tests/workspaces.test.mjs").includes("registre absent"), "tests workspaces attendus")

console.log("v9.1.5 verification: OK")
