import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.4.2 : la voix de l'agent lui coupait sa propre question de confirmation.
// Ce que la sonde fige :
//   A. la décision de couper est une fonction PURE, pas une condition enfouie ;
//   B. pendant une question de note, la lecture n'est pas interrompue ;
//   C. une vraie reprise coupe toujours — mais seulement quand le texte l'a prouvé ;
//   D. la question reste entière ET la décision reste ouverte (rien n'est perdu) ;
//   E. l'écho déjà écarté n'arrête plus rien.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const barge = read("web/src/voice-agent/barge-in.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const note = read("web/src/voice-agent/note.ts")
const echo = read("web/src/voice-agent/echo.ts")
const tests = read("tests/voice-agent-barge-in.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.4.2.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.4.2"], "node scripts/verify-v11.4.2.mjs", "la sonde a son entrée npm")

// ── A. Une décision pure, pas une condition enfouie ────────────────────────
assert.ok(existsSync(path.join(root, "web/src/voice-agent/barge-in.ts")), "la décision vit dans son module")
assert.match(barge, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.match(barge, /export function shouldInterruptSpeech/, "la décision est une fonction exportée")
assert.match(barge, /input\.phase === "speaking"/, "la lecture en cours est reconnue")
assert.match(hook, /import \{ shouldInterruptSpeech \} from "\.\/barge-in"/, "le hook importe la décision")
assert.ok(existsSync(path.join(root, "tests/voice-agent-barge-in.test.mjs")), "les tests de la décision existent")

// ── B. Pendant une question de note, on ne coupe pas ───────────────────────
assert.match(
  hook,
  /shouldInterruptSpeech\(\{ phase: previous, awaitingNote: pendingNoteRef\.current !== null \}\)/,
  "l'attente de note est transmise à la décision",
)
// La coupe inconditionnelle de v11.1.0 a disparu : c'est elle qui tronquait la question.
assert.doesNotMatch(hook, /if \(previous === "speaking" \|\| previous === "thinking"\) \{/, "la coupe inconditionnelle a disparu")
assert.match(hook, /if \(cutNow\) \{\s*\/\/ v11\.3\.0 : couper la lecture coupe aussi l'audio neuronal déjà décodé\.\s*stopPlayback\(\)/, "la coupe est conditionnée par la décision")
assert.match(barge, /return !input\.awaitingNote/, "l'attente de note désarme la coupe")
assert.match(tests, /pendant une question de note, la lecture n'est pas coupée/, "le test verrouille la non-coupe")

// ── C. Une vraie reprise coupe toujours ────────────────────────────────────
assert.match(tests, /une reprise de parole coupe la lecture en cours/, "le test verrouille la coupe réelle")
assert.match(barge, /if \(!playing\) return false/, "hors lecture, rien n'est coupé")
assert.match(
  hook,
  /if \(pendingNoteRef\.current\) stopPlayback\(\)/,
  "la lecture s'arrête dès que le texte prouve que c'est l'utilisateur",
)

// ── D. L'ordre porte la sûreté : écho d'abord, arrêt ensuite, décision enfin ─
const echoGuardAt = hook.indexOf("isSelfEcho({")
const stopAt = hook.indexOf("if (pendingNoteRef.current) stopPlayback()")
const answerAt = hook.indexOf("await answerPendingNote(text)")
assert.ok(echoGuardAt > 0 && stopAt > 0 && answerAt > 0, "les trois étapes existent")
assert.ok(echoGuardAt < stopAt, "l'écho est écarté AVANT d'arrêter la lecture")
assert.ok(stopAt < answerAt, "la lecture s'arrête avant de traiter la réponse")
assert.match(echo, /export function isSelfEcho/, "le garde d'écho reste en place")
assert.match(note, /export function classifyNoteReply/, "la décision de note reste inchangée")
assert.equal((hook.match(/optionsRef\.current\.onCreateNote\(/g) ?? []).length, 1, "l'unique chemin d'écriture n'a pas bougé")

// ── E. Rien n'est perdu : la question reste entière et la décision ouverte ──
assert.match(agents, /question de note/, "AGENTS.md fige la règle de la question non tronquée")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.4.2 verification: OK (la question de note n'est plus tronquée, une vraie reprise coupe toujours)")
