import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.4.1 : l'agent s'entend lui-même (haut-parleurs + micro + STT) et sa propre
// phrase revenait transcrite, passait pour une réponse, et annulait la note en
// attente. Ce que la sonde fige :
//   A. le garde est TEXTUEL et pur, pas un réglage acoustique opaque ;
//   B. un fragment contigu de 3 mots prononcés, moins de 2,5 s avant, est un écho ;
//   C. un mot seul n'est jamais un écho — c'est la réponse attendue ;
//   D. le garde s'exécute AVANT la décision de note (il ne peut pas la contourner) ;
//   E. l'échec est sûr : au pire une question reposée, jamais une écriture.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const echo = read("web/src/voice-agent/echo.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const note = read("web/src/voice-agent/note.ts")
const tests = read("tests/voice-agent-echo.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.4.1.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.4.1"], "node scripts/verify-v11.4.1.mjs", "la sonde a son entrée npm")

// ── A. Garde pur, textuel, sans réglage caché ───────────────────────────────
assert.ok(existsSync(path.join(root, "web/src/voice-agent/echo.ts")), "le garde vit dans son module")
assert.match(echo, /Pur : testable avec Node seul/, "le module se déclare pur")
assert.match(echo, /export function isSelfEcho/, "le garde est une fonction exportée")
assert.match(echo, /export function normalizeSpeech/, "la normalisation est testable séparément")
assert.match(echo, /ECHO_WINDOW_MS = 2_500/, "la fenêtre d'écho est figée")
assert.match(echo, /ECHO_MIN_WORDS = 3/, "la longueur minimale d'un écho est figée")
assert.doesNotMatch(echo, /setTimeout|setInterval/, "aucune minuterie : le garde ne décide que sur l'instant reçu")
assert.ok(existsSync(path.join(root, "tests/voice-agent-echo.test.mjs")), "les tests du garde existent")

// ── B. Contigu, borné dans le temps ────────────────────────────────────────
assert.match(echo, /start \+ heardWords\.length <= spokenWords\.length/, "le fragment doit être contigu dans la phrase prononcée")
assert.match(echo, /now - input\.endedAt <= ECHO_WINDOW_MS/, "l'écho est borné par la fin de la lecture")
assert.match(echo, /input\.speaking === true/, "pendant la lecture, le garde s'applique sans attendre la fin")
assert.match(tests, /après la fenêtre, la même phrase n'est plus un écho/, "l'expiration du garde est testée")
assert.match(tests, /Mots présents mais NON contigus/, "la contiguïté est testée")

// ── C. Un mot seul reste une réponse ───────────────────────────────────────
assert.match(echo, /heardWords\.length < ECHO_MIN_WORDS\) return false/, "un mot seul n'est jamais un écho")
assert.match(tests, /un mot seul n'est jamais un écho/, "le test verrouille les réponses d'un mot")
for (const word of ["oui", "non", "stop"]) assert.ok(tests.includes(`"${word}"`), `« ${word} » est testé comme réponse`)

// ── D. Le garde passe avant la décision de note ────────────────────────────
const echoAt = hook.indexOf("isSelfEcho({")
const answerAt = hook.indexOf("await answerPendingNote(text)")
assert.ok(echoAt > 0 && answerAt > 0, "les deux étapes existent")
assert.ok(echoAt < answerAt, "l'écho est écarté avant toute décision de note")
assert.match(hook, /import \{ isSelfEcho \} from "\.\/echo"/, "le hook importe le garde")
assert.match(hook, /spokenTextRef\.current = text/, "la phrase dite est mémorisée avant d'être jouée")
assert.match(hook, /spokenEndedAtRef\.current = Date\.now\(\)/, "la fin de lecture est horodatée")
assert.equal((hook.match(/spokenEndedAtRef\.current = Date\.now\(\)/g) ?? []).length, 2, "la fenêtre court depuis la fin réelle de la lecture")
assert.match(hook, /speaking: sessionRef\.current\.phase === "speaking"/, "la lecture en cours est transmise au garde")

// ── E. L'échec est sûr : rien n'est écrit par le garde ─────────────────────
const guardBlock = hook.slice(echoAt, answerAt)
assert.doesNotMatch(guardBlock, /onCreateNote|noteQuickCapture|writeConfirmedNote/, "le garde ne peut pas écrire")
// v11.11.1 : le garde ne ramène plus SYSTÉMATIQUEMENT à l'écoute — il ne touche
// pas à une réponse en cours de lecture (l'écho la changeait de requête, et la fin
// de la phrase disparaissait). L'exigence tient : le garde ne fait rien d'autre que
// replacer l'état, jamais exécuter ni écrire.
assert.match(
  guardBlock,
  /commit\(reading \? \{ type: "ignored", reading: true \} : \{ type: "interrupt" \}\)/,
  "le garde replace l'état — lecture préservée, sinon retour à l'écoute",
)
assert.equal((hook.match(/optionsRef\.current\.onCreateNote\(/g) ?? []).length, 1, "l'unique chemin d'écriture n'a pas bougé")
assert.match(note, /export function classifyNoteReply/, "la décision de note reste dans son module")
// La prose est repliée à 80 colonnes : le libellé peut être coupé sur deux lignes.
assert.match(agents, /reconnaît sa propre\s+voix/, "AGENTS.md fige la règle de l'auto-écoute")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.4.1 verification: OK (auto-écoute — la voix de l'agent n'est jamais une réponse, un mot seul le reste)")
