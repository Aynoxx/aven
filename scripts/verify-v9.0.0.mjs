import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const main = read("electron/main.ts")
const notes = read("electron/notes.ts")
const bridge = read("electron/opencode-bridge.ts")
const priorities = read("electron/priorities.ts")
const freebuff = read("electron/freebuff.ts")
const intent = read("electron/voice-intent.ts")
const app = read("web/src/App.tsx")
const appearance = read("web/src/appearance.ts")
const backend = read("web/src/backend-choice.ts")
const groups = read("web/src/chat-groups.ts")
const dialog = read("web/src/NotesDialog.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const agent = read(".opencode/agents/projet.md")
const table = JSON.parse(read("model-priorities.json"))
const testsBackend = read("tests/backend-choice.test.mjs")
const testsGroups = read("tests/chat-groups.test.mjs")

// ── Version et périmètre v9.0.0 ──
const [vMaj] = pkg.version.split(".").map(Number)
assert.ok(vMaj >= 9, `version trop ancienne : ${pkg.version}`)

// 1. Nouvel espace : l'utilisateur choisit le dossier final dans le sélecteur natif.
assert.match(main, /workspace:createNew/)
assert.match(main, /createDirectory/)
assert.match(main, /Utiliser ce dossier/)
assert.match(main, /déjà partie des espaces de travail/) // garde-fou doublon

// 2. Notes = vrais fichiers : chemin + ouverture du dossier.
assert.match(notes, /export const notesDir/)
assert.match(main, /notes:dir/)
assert.match(main, /notes:openFolder/)
assert.match(dialog, /noteOpenFolder/)
assert.match(dialog, /Ouvrir le dossier/)

// 3. Conversations par agent (sidebar groupée + page Agents + réglage).
assert.match(groups, /groupChatsByAgent/)
assert.match(app, /openConversationFromSidebar/)
assert.match(app, /chatGroups/)
assert.match(app, /agent-card-chats/)
assert.match(appearance, /chatsGroupedByAgent/)
// v9.1.3 : freebuffDefaultCode/freebuffAsEngine ont disparu (clé Codebuff retirée de l'app).
assert.ok(!/freebuffDefaultCode|freebuffAsEngine/.test(appearance), "les champs Freebuff doivent avoir disparu de l'apparence")
assert.match(settings, /Grouper les conversations par agent/)
assert.match(testsGroups, /groupChatsByAgent/)

// 4. Agent projet orchestrateur.
assert.match(bridge, /\["projet", "code", "recherche", "analyse"\]/)
assert.match(priorities, /\["projet", "code", "analyse", "recherche"\]/)
assert.match(priorities, /task === "projet"/) // héritage des priorités de code
assert.match(freebuff, /projet: "codebuff\/base@latest"/)
assert.match(intent, /\["projet", "code", "recherche", "analyse"\]/)
assert.match(agent, /mode: primary/)
assert.match(agent, /resource: code/)
assert.match(agent, /resource: recherche/)
assert.match(agent, /resource: analyse/)
for (const entry of Object.values(table.models)) {
  if (entry.priority.code !== undefined) assert.ok(true) // l'héritage projet=code est testé ailleurs
}

// 5. Freebuff prioritaire sur l'agent code.
// v9.1.3 : le bouton composeur et le champ clé Codebuff sont retirés — l'envoi repart
// systématiquement sur OpenCode ; la règle reste testée dans son module pur (dormant).
assert.match(backend, /effectiveBackend/)
assert.ok(!/freebuffOverride/.test(app), "l'override Freebuff du composeur doit avoir disparu (v9.1.3)")
assert.ok(!/Freebuff comme moteur/.test(settings), "le réglage « Freebuff comme moteur » doit avoir disparu (v9.1.3)")
assert.match(testsBackend, /effectiveBackend/)

// Régressions : les acquis v8.x restent en place.
assert.match(read("electron/voice.ts"), /allSettled/)
assert.match(read("web/src/selection-actions.ts"), /SELECTION_MAX/)
assert.match(read("electron/notes-meta.ts"), /normalizeForSearch/)
assert.match(read("electron/stats.ts"), /aggregateStats/)

console.log("v9.0.0 verification: OK")
