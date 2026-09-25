import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const intent = read("electron/voice-intent.ts")
const voice = read("electron/voice.ts")
const main = read("electron/main.ts")
const preload = read("electron/preload.cts")
const app = read("web/src/App.tsx")
const types = read("web/src/types.ts")
const tests = read("tests/voice-intent.test.mjs")

// ── Version et périmètre v8.8.0 : routage d'intention de la dictée ──
// Le périmètre reste valable pour toute version ultérieure : on exige « au moins 8.8.0 »
// (comparaison numérique, pas lexicale — 8.10 > 8.9).
const [vMaj, vMin] = pkg.version.split(".").map(Number)
assert.ok(vMaj > 8 || (vMaj === 8 && vMin >= 8), `version trop ancienne : ${pkg.version}`)

// Module de classification : liste fermée, neutralité, anti-injection.
assert.match(intent, /APP_ACTIONS/)
assert.match(intent, /AGENT_IDS = \["code", "recherche", "analyse"\]/)
assert.match(intent, /ne réponds jamais à la demande/)
assert.match(intent, /Action d'intention inconnue/) // garde anti-hallucination
assert.match(intent, /temperature: 0/)
assert.match(intent, /max_tokens: 60/)
assert.match(intent, /AbortSignal\.timeout\(6_000\)/)

// Pipeline : classification en parallèle du reformage, dégradation gracieuse.
assert.match(voice, /Promise\.allSettled/)
assert.match(voice, /classifyIntent/)
assert.match(voice, /intent\?: DictationIntent/) // absent si la passe a échoué

// Branchement IPC : le canal dictée transporte l'intention (log main).
assert.match(main, /intention: \$\{intent\}/)
assert.match(preload, /voiceTranscribe/) // contrat inchangé côté transport

// Renderer : commandes app exécutées directement (mêmes handlers que le hub),
// changement d'agent, et le texte ne part JAMAIS automatiquement chez l'agent.
assert.match(app, /routeAppAction/)
assert.match(app, /open-notes[\s\S]{0,200}setShowNotes\(true\)/)
assert.match(app, /open-settings[\s\S]{0,120}openConfiguration\(\)/)
assert.match(app, /open-workspace[\s\S]{0,120}api\.openWorkspace\(\)/)
assert.match(app, /intent\?\.intent === "agent"[\s\S]{0,200}selectAgent\(target\)/)
assert.match(app, /setInput\(text\)/) // validation Entrée conservée

// Contrat renderer : type miroir de l'intention.
assert.match(types, /DictationIntent/)
assert.match(types, /"open-notes" \| "open-settings" \| "open-agents" \| "open-projects" \| "open-workspace"/)

// Tests présents : classification, anti-injection, dégradation.
assert.match(tests, /anti-injection/)
assert.match(tests, /delete-everything/) // action hallucinée rejetée
assert.match(tests, /échec du classifieur/)

// Le duplex retiré (v8.7.7) ne revient pas.
assert.doesNotMatch(main, /voice:(realtime-token|command|confirm)/)

console.log("v8.8.0 verification: OK")
