import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const helper = read("web/src/selection-actions.ts")
const app = read("web/src/App.tsx")
const icons = read("web/src/icons/Icon.tsx")
const css = read("web/src/App.css")
const tests = read("tests/selection-actions.test.mjs")
const intent = read("electron/voice-intent.ts") // régression : le routage vocal doit rester en place

// ── Version et périmètre v8.9.0 : actions sur sélection ──
// Valable pour toute version ultérieure : « au moins 8.9.0 » (comparaison numérique).
const [vMaj, vMin] = pkg.version.split(".").map(Number)
assert.ok(vMaj > 8 || (vMaj === 8 && vMin >= 9), `version trop ancienne : ${pkg.version}`)

// Helper pur : garde-fou de taille, prompts enveloppés, citation.
assert.match(helper, /SELECTION_MAX/)
assert.match(helper, /Corrige ce code/)
assert.match(helper, /Explique ce code/)
assert.match(helper,/> \$\{line\}/) // citation en bloc

// Renderer : barre flottante, actions avec routage d'agent, copie, jamais d'envoi automatique.
assert.match(app, /onMouseUp=\{onMessagesMouseUp\}/)
assert.match(app, /applySelection\("fix"\)/)
assert.match(app, /applySelection\("explain"\)/)
assert.match(app, /selectAgent\("code"\)/)
assert.match(app, /selectAgent\("recherche"\)/)
assert.match(app, /navigator\.clipboard\.writeText/)
assert.match(css, /\.selbar/)

// Icônes centralisées (convention v8.2).
assert.match(icons, /"copy"/)
assert.match(icons, /"wrench"/)

// Tests présents.
assert.match(tests, /buildPrompt/)

// Régression v8.8.0 : le routage d'intention de la dictée est intact.
assert.match(intent, /classifyIntent/)

console.log("v8.9.0 verification: OK")
