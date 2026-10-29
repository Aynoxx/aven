import assert from "node:assert/strict"
import { readFileSync, existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { readStyles } from "./lib/sources.mjs"

// v11.1.0 : agent vocal Aven. La sonde fige les contraintes du plan, pas les
// détails d'implémentation : mot d'activation « Aven », aucun modèle local,
// aucun service payant, aucun audio conservé, micro visible et voix choisie
// dans les Réglages.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const cargo = read("src-tauri/Cargo.toml")

const wake = read("host/voice-agent-wake.ts")
const commands = read("host/voice-agent-commands.ts")
const speech = read("host/voice-agent-speech.ts")
const personality = read("host/voice-agent-personality.ts")
const host = read("host/aven-app-host.ts")
const types = read("web/src/types.ts")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const settings = read("web/src/SettingsDialog.tsx")
const app = read("web/src/app/use-aven-app.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const session = read("web/src/voice-agent/session.ts")
const css = readStyles()
const readme = read("README.md")

// ── A. Manifestes alignés (la sonde ne fige pas SON numéro) ─────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.1.0.mjs"), "npm run verify inclut la sonde courante")

// ── B. Mot d'activation : « Aven », jamais un autre nom ─────────────────────
assert.match(wake, /export const WAKE_WORD = "aven"/, "le mot d'activation est « aven »")
for (const [file, source] of [["wake", wake], ["commands", commands], ["speech", speech], ["personality", personality], ["hook", hook], ["session", session]]) {
  // Les commentaires peuvent citer « Jarvis » pour l'interdire : on cherche un
  // LITTÉRAL de chaîne, jamais une simple évocation dans la documentation.
  assert.doesNotMatch(source, /["']jarvis["']/i, `${file} n'utilise jamais « Jarvis »`)
  assert.doesNotMatch(source, /discord/i, `${file} ne dépend pas de Discord`)
}

// ── C. Aucun modèle ni serveur local ────────────────────────────────────────
for (const [file, source] of [["speech", speech], ["wake", wake], ["commands", commands], ["hook", hook]]) {
  for (const dependency of ["onnxruntime", "whisper.cpp", "transformers", "vosk", "porcupine", "@xenova"]) {
    assert.doesNotMatch(source, new RegExp(dependency.replaceAll(".", "\\."), "i"), `${file} n'embarque pas ${dependency}`)
  }
}

// ── D. Uniquement le palier gratuit Groq, aucun repli payant ────────────────
assert.match(speech, /api\.groq\.com/, "le fournisseur distant est Groq")
assert.doesNotMatch(speech, /openrouter/i, "aucun repli OpenRouter (payant possible) dans la voix")
assert.match(speech, /Quota gratuit Groq atteint/, "le quota gratuit est dit explicitement")
assert.match(speech, /aucun service payant/i, "aucun repli payant n'est promis")
assert.doesNotMatch(speech, /paid|billing|stripe/i, "aucune API facturée n'est câblée")

// ── E. Aucun audio conservé ─────────────────────────────────────────────────
for (const forbidden of ["writeFile", "appendFile", "createWriteStream"]) {
  assert.ok(!speech.includes(forbidden), `le module vocal n'écrit pas d'audio (${forbidden})`)
}
assert.ok(!hook.includes("localStorage"), "le hook vocal ne conserve rien dans le stockage du navigateur")
assert.match(hook, /jamais écrit sur disque/, "le commentaire du hook rappelle la règle de non-conservation")

// ── F. Contrat IPC typé des deux côtés + prefs persistées ───────────────────
for (const method of ["voiceAgentTranscribe", "voiceAgentInterpret", "voiceAgentAsk", "voiceAgentSpeak", "voiceAgentStop", "voiceAgentPrefs", "setVoiceAgentPrefs", "voiceAgentVoices"]) {
  assert.match(host, new RegExp(`case "${method}"`), `le host traite ${method}`)
  assert.match(types, new RegExp(`${method}:`), `le renderer type ${method}`)
}
assert.match(host, /voiceName: p\.voiceName, personality: p\.voicePersonality, micMuted: p\.micMuted/, "les préférences vocales sont exposées")
assert.match(host, /voiceHistory = \[\.\.\.voiceHistory/, "le contexte de session est borné")

// ── G. Micro visible, état en texte, interruption possible ──────────────────
assert.match(shell, /useVoiceAgent\(/, "le Poste branche la session vocale")
assert.match(shell, /className="wb-voice"/, "le bandeau porte le contrôle vocal")
assert.match(shell, /role="status" aria-live="polite"/, "l'état vocal est annoncé")
assert.match(shell, /microphone-off/, "le micro coupé a son icône propre")
assert.match(shell, /Interrompre l’agent vocal/, "la lecture peut être interrompue")
// v11.11.1 : la garde temporelle (TTS_ECHO_BARRIER_MS) a disparu — elle ne
// protégeait que les 900 premières millisecondes, alors que le micro entend
// l'agent pendant TOUTE la réponse. L'exigence tient, autrement : l'écho est
// reconnu par le texte et ne touche plus à la session (echo.ts, barge-in.ts).
assert.match(hook, /const echo = isSelfEcho\(\{/, "l'écho de la voix ne coupe pas la lecture elle-même")
assert.doesNotMatch(hook, /TTS_ECHO_BARRIER_MS/, "plus de garde temporelle : la décision tient au texte")
// v11.12.0 : la fenêtre de suivi de dix secondes est remplacée par la VEILLE (mode
// éveillé, sonde scripts/verify-v11.12.0.mjs). Son défaut est daté : `speech-start`
// la remettait à zéro avant la transcription, donc le mot d'activation restait exigé
// à chaque phrase. Ce qui reste de la règle d'origine est vérifié ici : une parole
// sans mot d'activation n'est adressée à l'agent que par la veille.
assert.match(hook, /isAwake\(sessionRef\.current\)/, "l'adresse à l'agent se décide sur la veille")
assert.match(session, /AWAKE_IDLE_MS/, "la veille a remplacé la fenêtre de suivi")

// ── H. Réglages : voix Windows, aperçu, personnalité, section dédiée ────────
assert.match(app, /"voice"/, "la section Réglages « voice » existe")
assert.match(settings, /Agent vocal/, "la section Réglages nomme l'agent vocal")
assert.match(settings, /voiceAgentVoices\(\)/, "les voix Windows sont listées")
assert.match(settings, /Tester la voix/, "la voix peut être entendue avant de choisir")
assert.match(settings, /Personnalité/, "les personnalités sont réglables")
assert.match(settings, /les segments audio sont envoyés au STT distant/, "l'envoi audio au STT est annoncé")
// v11.6.0 : le groupe local contient aussi Piper ; le message dit « locale ».
assert.match(settings, /Aucune voix locale détectée/, "l'absence de voix est dite, pas silencieuse")

// ── I. Styles : tokens uniquement, pas de taille en dur ────────────────────
assert.match(css, /\.wb-voice \{/, "le contrôle vocal a sa règle")
assert.match(css, /\.wb-voice-label \{[^}]*var\(--font-mono\)[^}]*var\(--font-size-xs\)/, "le libellé vocal suit la typographie télémétrie")
assert.doesNotMatch(css, /\.wb-voice[^{}]*\{[^}]*font-size:\s*\d+px/, "aucune taille de police en dur dans le contrôle vocal")

// ── J. Notes et tests présents ──────────────────────────────────────────────
assert.match(readme, /^# Aven v\d+\.\d+\.\d+$/m, "README annonce la version courante")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")}`), "README porte la note de la version courante")
for (const file of [
  "tests/voice-agent-wake.test.mjs",
  "tests/voice-agent-commands.test.mjs",
  "tests/voice-agent-session.test.mjs",
  "tests/voice-agent-vad.test.mjs",
  "tests/voice-agent-speech.test.mjs",
]) {
  assert.ok(existsSync(path.join(root, file)), `${file} existe`)
}

console.log("v11.1.0 verification: OK (agent vocal — Aven, gratuit, micro visible, audio non conservé)")
