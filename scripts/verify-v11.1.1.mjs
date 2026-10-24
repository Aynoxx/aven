import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.1.1 : correctifs du réveil vocal après le constat « Aven, ouvre une note
// ne fait rien ». La sonde fige les causes mesurées — pas des préférences :
//   A. l'attaque du mot était coupée (capture ouverte 220 ms trop tard) ;
//   B. Whisper écrit « Avant » pour « Aven » ;
//   C. un micro discret restait sous le seuil fixe de 0,012 ;
//   D. une webview pouvait garder l'AudioContext suspendu ;
//   E. l'erreur réelle était cachée dans une infobulle.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")
const wake = read("host/voice-agent-wake.ts")
const commands = read("host/voice-agent-commands.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const css = read("web/src/styles/workbench.css")
const wakeTests = read("tests/voice-agent-wake.test.mjs")
const commandTests = read("tests/voice-agent-commands.test.mjs")

// ── Version cohérente dans les manifestes ────────────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")

// ── A. Pré-roll : la capture ouvre avant la confirmation du VAD ──────────────
assert.match(hook, /const PRE_ROLL_MS = \d+/, "le pré-roll a une durée nommée")
assert.match(hook, /startRecorderRef\.current\(true\)/, "la capture démarre dès la première trame au-dessus du seuil")
assert.match(hook, /discardNextRef\.current = true/, "un pré-roll sans parole est jeté au lieu d'être transcrit")
assert.match(hook, /startRecorderRef\.current\(false\)/, "la confirmation du VAD ne rouvre pas un second enregistrement")

// ── B. Homophones du mot d'activation, bornés ────────────────────────────────
assert.match(wake, /WAKE_HOMOPHONE_PAUSE_RE/, "« Avant, … » et « Avent, … » sont reconnus")
assert.match(wake, /export function startsWithWakeHomophone/, "le routage peut tester l'homophone en tête")
assert.match(commands, /ACTION_START/, "un homophone sans virgule n'est accepté que devant une commande")
assert.ok(
  wakeTests.includes('hasWakeWord("Avant de partir")') || wakeTests.includes('"avant de partir"'),
  "le test du faux positif « avant de partir » existe",
)
assert.ok(commandTests.includes("Avant ouvre une note"), "le cas Whisper sans virgule est testé")

// ── C. Seuil adaptatif borné ─────────────────────────────────────────────────
assert.match(hook, /noiseFloorRef/, "le seuil suit le bruit ambiant")
assert.match(hook, /Math\.min\(0\.02, Math\.max\(0\.006,/, "le seuil reste borné entre 0,006 et 0,02")
assert.match(hook, /Math\.max\(threshold, DEFAULT_VAD_CONFIG\.threshold\) \* 2\.5/, "la lecture de l'agent garde son seuil surélevé")

// ── D. AudioContext relancé au premier geste ────────────────────────────────
assert.match(hook, /gestureArmedRef/, "la relance de l'AudioContext est prévue")
assert.match(hook, /addEventListener\("pointerdown", resume, true\)/, "un clic relance l'audio suspendu")
assert.match(hook, /removeEventListener\("pointerdown", gestureHandlerRef\.current, true\)/, "le listener est retiré au démontage")

// ── E. L'erreur réelle est visible et la transcription entendue consultable ──
assert.match(shell, /voice\.error \?\? voice\.label/, "le bandeau affiche le message d'erreur réel")
assert.match(shell, /Entendu : « \$\{voice\.heard\} »/, "l'infobulle montre la dernière transcription")
assert.match(css, /\.wb-voice-error \{/, "le message d'erreur a un style lisible (casse normale, borné)")

console.log("v11.1.1 verification: OK (réveil vocal — pré-roll, homophones, seuil adaptatif, erreur visible)")
