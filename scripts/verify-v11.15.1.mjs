import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.15.1 : le micro coupé ne s'ouvre pas avant d'avoir lu la préférence. La
// sonde fige la règle de sûreté et le message de repli de Pocket TTS :
//   A. la session démarre coupée et ne lit la préférence qu'une fois le Poste prêt ;
//   B. un geste explicite prime sur la préférence qui arrive en retard ;
//   C. le repli Pocket nomme son remède UNE fois (le détail nu, habillé par l'appelant).

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const host = read("host/aven-app-host.ts")

// ── Version cohérente dans tous les manifestes ─────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.15.1.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.15.1"], "node scripts/verify-v11.15.1.mjs", "la sonde a son entrée npm")

// ── A. La session démarre coupée et lit la préférence quand le Poste est prêt ──
assert.match(hook, /useState<VoiceSessionState>\(\(\) => initialVoiceSession\(true\)\)/,
  "l'état initial est « micro coupé »")
assert.match(hook, /if \(!options\.enabled\) return\s+let cancelled = false\s+void api\.voiceAgentPrefs\(\)/,
  "la préférence se lit seulement quand le Poste est prêt")
assert.match(hook, /setMuted\(prefs\.micMuted, false\)/,
  "la préférence restaurée ne se réécrit pas")

// ── B. Un geste explicite prime sur la réponse IPC tardive ─────────────────
assert.match(hook, /const micTouchedRef = useRef\(false\)/, "le geste utilisateur est mémorisé")
assert.match(hook, /if \(cancelled \|\| micTouchedRef\.current\) return/, "un clic n'est pas annulé par la préférence")
assert.match(hook, /const setMuted = useCallback\(\(muted: boolean, persist = true\)/, "la restauration peut ne pas persister")
assert.match(hook, /if \(persist\) void api\.setVoiceAgentPrefs\(\{ micMuted: muted \}\)/, "seul un geste écrit la préférence")
assert.match(agents, /Un micro coupé n'écoute pas au démarrage \(v11\.15\.1\)/, "AGENTS.md dit la règle de sûreté")

// ── C. Le repli Pocket ne répète pas son remède ────────────────────────────
const streamStart = host.indexOf("async function streamPocketSpeech")
const streamEnd = host.indexOf("async function speakWithLocalVoiceFallback")
assert.ok(streamStart > 0 && streamEnd > streamStart, "la synthèse en flux existe")
const stream = host.slice(streamStart, streamEnd)
assert.match(stream, /if \(!server\) throw new Error\("le moteur n'a pas démarré"\)/,
  "le détail du flux est nu")
assert.doesNotMatch(stream, /pocketUnavailableReason/, "le flux n'habille pas le détail lui-même")
assert.match(host, /speakWithLocalVoiceFallback\(clean, pocketUnavailableReason\(message\)\)/,
  "l'appelant ajoute le remède une seule fois")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.15.1 verification: OK (micro coupé au démarrage, repli Pocket dit une seule fois)")
