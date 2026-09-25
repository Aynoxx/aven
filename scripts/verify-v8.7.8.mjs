import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const pkg = JSON.parse(read("package.json"))
const main = read("electron/main.ts")
const providers = read("electron/providers.ts")
const voice = read("electron/voice.ts")
const preload = read("electron/preload.cts")
const app = read("web/src/App.tsx")
const types = read("web/src/types.ts")
const hook = read("web/src/voice-dictation.ts")

// ── Version et périmètre v8.7.8 : dictée Groq (STT + reformage) vers le composeur ──
assert.equal(pkg.version, "8.7.8")

// Fournisseur Groq : présent, hors environnement OpenCode (la clé ne fuit pas dans le moteur).
assert.match(providers, /id:\s*"groq"/)
assert.match(providers, /GROQ_API_KEY/)
assert.match(providers, /id:\s*"groq"[^\n]*openCodeEnv:\s*false/)
assert.match(providers, /id:\s*"openrouter"/) // toujours là
assert.match(providers, /id:\s*"codebuff"/) // toujours là

// voice.ts : les deux étages du pipeline + le non-blocage du reformage.
assert.match(voice, /whisper-large-v3-turbo/)
assert.match(voice, /audio\/transcriptions/)
assert.match(voice, /chat\/completions/)
assert.match(voice, /correcteur de dictée vocale/)
assert.match(voice, /ne réponds jamais à la demande/) // garde-fou du prompt
assert.match(voice, /temperature:\s*0/)
assert.match(voice, /warning:\s*err/) // échec de reformage → texte brut + warning

// IPC et exposition renderer.
assert.match(main, /voice:transcribe/)
assert.match(main, /transcribeSpeech/)
assert.match(preload, /voiceTranscribe/)
assert.match(types, /DictationResult/)
assert.match(types, /voiceTranscribe/)

// Renderer : push-to-talk → composeur, jamais d'envoi automatique à l'agent.
assert.match(app, /useDictation/)
assert.match(app, /setInput\(cleaned \? result\.cleaned! : result\.raw\)/) // atterrit dans le composeur
assert.doesNotMatch(app, /api\.send\(.*raw/) // jamais envoyé automatiquement
assert.match(app, /dictation-recording/)
assert.match(app, /éclairci/) // badge de transparence brut/éclairci
assert.match(hook, /MediaRecorder/)
assert.match(hook, /getUserMedia/)

// Le duplex vocal retiré en v8.7.7 ne revient pas.
assert.doesNotMatch(app, /AssistantOverlay/)
assert.doesNotMatch(main, /voice:(realtime-token|command|confirm)/)
assert.doesNotMatch(types, /VoiceRealtimeToken/)

// La permission micro est bien réinstallée (dicter en a besoin).
assert.match(main, /setPermissionCheckHandler/)
assert.match(main, /setPermissionRequestHandler/)

console.log("v8.7.8 verification: OK")
