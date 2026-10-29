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
// v11.11.1 : la décision ne regarde plus la phase ni le niveau du micro, mais ce
// qui a été TRANSCRIT — l'écho et la lecture en cours sont les deux entrées.
assert.match(barge, /if \(input\.reading !== true\) return false/, "la lecture en cours est reconnue")
assert.match(hook, /import \{ shouldInterruptSpeech \} from "\.\/barge-in"/, "le hook importe la décision")
assert.ok(existsSync(path.join(root, "tests/voice-agent-barge-in.test.mjs")), "les tests de la décision existent")

// ── B. Pendant une question de note, on ne coupe pas ───────────────────────
// v11.11.1 : la règle de v11.4.2 est devenue générale — AUCUNE lecture n'est
// coupée par le niveau du micro (la voix de l'agent revient par les haut-parleurs),
// et l'écho non plus ne coupe rien. L'exigence tient, la ligne a changé.
assert.match(
  hook,
  /if \(shouldInterruptSpeech\(\{ echo: false, reading, addressed: true, heard: text \}\)\) stopPlayback\(\)/,
  "la reprise de parole se décide sur le texte ADRESSÉ, pas sur le niveau du micro",
)
// La coupe inconditionnelle de v11.1.0 a disparu : c'est elle qui tronquait la question.
assert.doesNotMatch(hook, /if \(previous === "speaking" \|\| previous === "thinking"\) \{/, "la coupe inconditionnelle a disparu")
assert.match(barge, /if \(input\.echo\) return false/, "un écho ne coupe rien")
assert.match(tests, /l'écho de la voix de l'agent ne coupe jamais rien/, "le test verrouille la non-coupe")

// ── C. Une vraie reprise coupe toujours ────────────────────────────────────
assert.match(tests, /une parole adressée coupe la lecture en cours/, "le test verrouille la coupe réelle")
assert.match(barge, /if \(input\.addressed\) return true/, "hors lecture, rien n'est coupé ; une parole adressée prend la main")
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
