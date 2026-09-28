import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const stats = read("electron/stats.ts")
const main = read("electron/main.ts")
const preload = read("electron/preload.cts")
const types = read("web/src/types.ts")
const app = read("web/src/App.tsx")
const settingsDialog = read("web/src/SettingsDialog.tsx")
const icons = read("web/src/icons/Icon.tsx")
const tests = read("tests/stats.test.mjs")
const notes = read("electron/notes-meta.ts") // régression v8.10.0
const selection = read("web/src/selection-actions.ts") // régression v8.9.0
const intent = read("electron/voice-intent.ts") // régression v8.8.0

// ── Version et périmètre v8.11.0 : panneau de statistiques ──
const [vMaj, vMin] = pkg.version.split(".").map(Number)
assert.ok(vMaj > 8 || (vMaj === 8 && vMin >= 11), `version trop ancienne : ${pkg.version}`)

// Module pur : agrégation sans I/O, compteur de dictées persistant.
assert.match(stats, /aggregateStats/)
assert.match(stats, /countDictation/)
assert.match(stats, /writeJsonAtomicPretty/)
assert.match(stats, /stats\.json/)

// Comptage branché sur la dictée + IPC stats:get.
// v9.1.5 : countDictation passe par requireWorkspace() (plus d'espace imposé au boot).
assert.match(main, /countDictation\(requireWorkspace\(\)\)/)
assert.match(main, /stats:get/)
assert.match(preload, /getStats/)
assert.match(types, /AggregatedStats/)

// Renderer : carte du hub, panneau, tuiles.
// v9.3.0 : les statistiques vivent dans les Réglages (onglet Usage) — le renderer
// reste branché sur stats:get via SettingsDialog ; App.tsx garde la route vocale.
assert.match(app, /case "open-stats"/)
assert.match(settingsDialog, /getStats\(\)/)
// v9.3.0 : l'appel getStats() vit dans SettingsDialog (onglet Usage) — App.tsx garde l'IPC via la route vocale.
assert.match(app + read("web/src/SettingsDialog.tsx"), /stats:get|getStats\(\)/)
assert.match(settingsDialog, /stat-tile/)
assert.match(icons, /"chart"/)

// Tests présents.
assert.match(tests, /aggregateStats/)
assert.match(tests, /countDictation/)

// Régressions : v8.10.0, v8.9.0 et v8.8.0 intactes.
assert.match(notes, /normalizeForSearch/)
assert.match(selection, /SELECTION_MAX/)
assert.match(intent, /classifyIntent/)

console.log("v8.11.0 verification: OK")
