import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const meta = read("host/notes-meta.ts")
const main = read("host/aven-app-host.ts") // v10.0.0 : remplace le main Electron
const preload = read("web/src/types.ts") // v10.0.0 : remplace le preload (contrat OpenCodeApi)
const types = read("web/src/types.ts")
const dialog = read("web/src/NotesView.tsx") // v9.3.0 : la vue Notes remplace le modal
const tests = read("tests/notes-premium.test.mjs")
const selection = read("web/src/selection-actions.ts") // régression v8.9.0
const intent = read("host/voice-intent.ts") // régression v8.8.0

// ── Version et périmètre v8.10.0 : notes premium ──
const [vMaj, vMin] = pkg.version.split(".").map(Number)
assert.ok(vMaj > 8 || (vMaj === 8 && vMin >= 10), `version trop ancienne : ${pkg.version}`)

// Main : épinglage persistant + recherche normalisée + export.
assert.match(meta, /MAX_PINNED/)
assert.match(meta, /normalizeForSearch/)
assert.match(meta, /matchQuery/)
assert.match(meta, /writeJsonAtomicPretty/)
assert.match(main, /case "noteTogglePin"/)
assert.match(main, /case "notePins"/)
// v10.0.0 : l'export n'est plus un canal host — dialogue de sauvegarde côté renderer.
assert.match(read("web/src/api-tauri.ts"), /property === "noteExport"/)

// Contrat IPC complet.
assert.match(preload, /noteTogglePin/)
assert.match(preload, /notePins/)
assert.match(preload, /noteExport/)
assert.match(types, /noteTogglePin|notePins|noteExport/)

// Interface : recherche plein-texte, épinglées d'abord, comptage, export.
assert.match(dialog, /notePins\(\)/)
assert.match(dialog, /Épingler|Détacher/)
assert.match(dialog, /Exporter \.md/)
assert.match(dialog, /mots/)
assert.match(dialog, /n\.markdown/) // la recherche porte sur le contenu

// Tests présents.
assert.match(tests, /togglePin/)
assert.match(tests, /normalizeForSearch/)

// Régressions : v8.9.0 et v8.8.0 intactes.
assert.match(selection, /SELECTION_MAX/)
assert.match(intent, /classifyIntent/)

console.log("v8.10.0 verification: OK")
