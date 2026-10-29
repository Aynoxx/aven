import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.15.0 : deux défauts d'attention, une même exigence — le Poste ne réagit
// qu'à ce qui lui est destiné. Ce que la sonde fige :
//   A. une lecture n'est coupée que par une parole ADRESSÉE (ou « attends » /
//      « chut ») ; le bruit de la pièce laisse la réponse aller au bout ;
//   B. créer une note est une action du catalogue, mais une écriture PROPOSÉE :
//      le contenu est relu et l'écriture n'a lieu qu'après le « oui » ;
//   C. les formulations naturelles (« crée-moi », « fais », « peux-tu ») sont
//      reconnues par le parser de note au lieu de partir au LLM ;
//   D. la note créée s'affiche, et la doc dit les règles.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")

// ── Version cohérente dans tous les manifestes ─────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.15.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.15.0"], "node scripts/verify-v11.15.0.mjs", "la sonde a son entrée npm")

// ── A. La lecture n'est coupée que par une parole adressée ─────────────────
const barge = read("web/src/voice-agent/barge-in.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const bargeTests = read("tests/voice-agent-barge-in.test.mjs")
assert.match(barge, /export function shouldInterruptSpeech/, "la décision reste une fonction pure exportée")
assert.match(barge, /if \(input\.echo\) return false/, "un écho ne coupe jamais rien")
assert.match(barge, /if \(input\.reading !== true\) return false/, "hors lecture, rien n'est coupé")
assert.match(barge, /if \(input\.addressed\) return true/, "une parole adressée coupe la lecture")
assert.match(barge, /isBargeInPhrase/, "les reprises directes ont leur liste fermée")
assert.match(bargeTests, /un bruit non adressé ne coupe pas la lecture/, "le test fige le bruit qui ne coupe plus")
assert.match(bargeTests, /attends/, "« attends » reste une reprise")
assert.match(
  hook,
  /if \(shouldInterruptSpeech\(\{ echo: false, reading, addressed: false, heard: text \}\)\)/,
  "le bruit non adressé est consulté",
)
assert.match(
  hook,
  /if \(shouldInterruptSpeech\(\{ echo: false, reading, addressed: true, heard: text \}\)\) stopPlayback\(\)/,
  "une parole adressée branche l'arrêt de lecture",
)
const addressedAt = hook.indexOf("if (!interpreted.addressed)")
const cutAt = hook.indexOf("addressed: true, heard: text")
const wakeAt = hook.indexOf('commit({ type: "wake" })')
assert.ok(addressedAt > 0 && cutAt > addressedAt && cutAt < wakeAt,
  "la coupe intervient après le verdict d'adresse et avant la prolongation de la veille")

// ── B. Créer une note : proposée, contenu relu, jamais écrite par le modèle ─
const actions = read("host/agent-actions.ts")
const speech = read("host/voice-agent-speech.ts")
const host = read("host/aven-app-host.ts")
const actionTests = read("tests/agent-actions.test.mjs")
assert.match(actions, /name: "create_note"/, "la création de note est au catalogue")
assert.match(actions, /confirm: true/, "la création de note est marquée comme proposée")
assert.match(actions, /kind: "body"/, "le corps de note a son type")
assert.match(actions, /NOTE_BODY_MAX_CHARS/, "le corps de note a sa borne")
assert.match(actions, /export function actionConfirmationText/, "la question relit le contenu")
assert.match(actions, /Je note : «/, "la question est celle de la note dictée")
assert.match(actions, /Je l’enregistre \?/, "la question attend un accord explicite")
assert.match(speech, /actionConfirmationText\(action, outcome\.pending\.label, outcome\.pending\.args\)/,
  "la boucle dit la question du catalogue, jamais une paraphrase")
assert.match(host, /case "create_note":/, "le host traite la création proposée")
assert.match(host, /return \{ status: "confirm", label: args\.title, args: \{ title: args\.title, content: args\.content \} \}/,
  "le host ne crée pas la note : il la propose")
assert.match(host, /quickCapture\(requireWorkspace\(\), args\.title, args\.content\)/,
  "l'écriture n'a lieu qu'après confirmation")
assert.match(actionTests, /créer une note est une écriture proposée/, "le test fige la proposition")
const writeCalls = host.match(/quickCapture\(requireWorkspace\(\), args\.title, args\.content\)/g) ?? []
assert.equal(writeCalls.length, 1, "un seul chemin d'écriture de la note proposée")

// ── C. Le parser reconnaît les formulations naturelles ─────────────────────
const note = read("web/src/voice-agent/note.ts")
const noteTests = read("tests/voice-agent-note.test.mjs")
assert.match(note, /REQUEST_LEAD_RE/, "le préambule poli est retiré")
assert.match(note, /normalizeRequestLead/, "la normalisation est une fonction dédiée")
assert.match(note, /fais\|faire/, "les verbes de rédaction sont reconnus")
assert.match(noteTests, /crée-moi une note/, "« crée-moi une note » est testé")
assert.match(noteTests, /peux-tu créer une note/, "« peux-tu créer une note » est testé")

// ── D. La note créée s'affiche, et la doc dit les règles ───────────────────
const types = read("web/src/types.ts")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
assert.match(types, /noteId\?: string/, "le contrat de confirmation porte l'identifiant de la note")
assert.match(hook, /onNoteCreated\?: \(noteId: string\) => void/, "le hook peut afficher la note créée")
assert.match(hook, /if \(done\?\.noteId\) optionsRef\.current\.onNoteCreated\?\.\(done\.noteId\)/,
  "la note confirmée est ouverte")
assert.match(shell, /onNoteCreated: \(noteId\) => openNotesView\(noteId\)/,
  "le Poste branche l'ouverture de la note")
const agents = read("AGENTS.md")
assert.match(agents, /créer une note \(proposée, contenu relu\)/, "AGENTS.md décrit la création proposée")
assert.match(agents, /seule une parole \*\*adressée\*\* coupe la lecture/, "AGENTS.md décrit la coupe adressée")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.15.0 verification: OK (bruit qui ne coupe plus, note proposée et relue avant écriture)")
