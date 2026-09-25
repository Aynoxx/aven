import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const priorities = JSON.parse(read("model-priorities.json"))
const main = read("electron/main.ts")
const providers = read("electron/providers.ts")
const preload = read("electron/preload.cts")
const notes = read("electron/notes.ts")
const app = read("web/src/App.tsx")
const types = read("web/src/types.ts")

// ── Version et périmètre v8.7.7 : retrait de Gemini (vocal Live + clé Google) ──
assert.equal(pkg.version, "8.7.7")

// Plus aucune trace de Gemini/Google dans le code exécuté.
for (const [name, content] of [["main.ts", main], ["providers.ts", providers], ["preload.cts", preload], ["App.tsx", app], ["types.ts", types], ["notes.ts", notes]]) {
  assert.doesNotMatch(content, /gemini|GOOGLE_GENERATIVE|auth_tokens/i, `${name} référence encore Gemini`)
}

// Le fournisseur Google a disparu ; OpenRouter et Codebuff restent.
assert.equal(providers.match(/id:\s*"google"/), null)
assert.match(providers, /id:\s*"openrouter"/)
assert.match(providers, /id:\s*"codebuff"/)

// Les canaux IPC vocaux ont disparu du preload et des types.
assert.doesNotMatch(preload, /voice(RealtimeToken|Command|Confirm)/)
assert.doesNotMatch(types, /voice(RealtimeToken|Command|Confirm)|VoiceRealtimeToken|VoiceCommandResult/)

// Les handlers vocaux ne sont plus enregistrés côté main.
assert.doesNotMatch(main, /voice:(realtime-token|command|confirm)/)
assert.doesNotMatch(main, /AssistantController|createAppToolRegistry/)

// Les notes restent une fonctionnalité autonome (module dédié + IPC intact).
assert.match(notes, /export function listNotes/)
assert.match(notes, /export function getNote/)
assert.match(main, /notes:list/)
assert.match(main, /notes:get/)
assert.match(preload, /notesList/)
assert.match(app, /NotesDialog/)

// L'assistant vocal a disparu de l'interface, le reste du hub est intact.
assert.doesNotMatch(app, /AssistantOverlay|assistantOpen|voice-core/)
assert.match(app, /showAgentPicker/)
assert.match(app, /renderComposer/)

// Les questions d'agent (FormDialog) et Freebuff sont conservés.
assert.ok(read("web/src/FormDialog.tsx").includes("FormDialog"))
assert.match(main, /chats:send.*freebuff/)
assert.equal(pkg.dependencies["@codebuff/sdk"], "0.10.7")
assert.equal(pkg.dependencies["@opencode/client"], "2.0.10")

// La table de priorités ne contient que des modèles gratuits (aucun retour du faux secours).
for (const ref of Object.keys(priorities.models)) {
  const free = ref.startsWith("openrouter/") ? ref.endsWith(":free") : ref.startsWith("opencode/")
  assert.equal(free, true, `Modèle non gratuit présent : ${ref}`)
}

console.log("v8.7.7 verification: OK")
