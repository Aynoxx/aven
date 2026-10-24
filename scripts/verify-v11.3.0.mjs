import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.3.0 : la voix de l'agent quitte System.Speech pour des voix neuronales
// françaises, gratuites et sans compte. Ce que la sonde fige, par ordre de risque :
//   A. gratuit et sans compte : aucune clé, aucune carte, aucun palier payant ;
//   B. service non contractuel : un échec ne rend pas l'agent muet, il est DIT ;
//   C. la décision de voix reste un module pur, préfixé edge: / sapi: ;
//   D. la lecture se fait dans la webview, l'aperçu emprunte le même chemin ;
//   E. mesure du 23/10/2026 : `msedge-tts` 2.1.0 (la dernière) se faisait refuser
//      sa poignée de main (HTTP 200 au lieu de 101) 3 fois sur 3, quand le
//      protocole décrit dans voice-agent-tts.ts répondait 9 fois sur 9 dans la
//      même minute. Le transport est donc à nous, mais le jeton reste dans UN
//      module pur, calculé et testé — jamais recopié à plusieurs endroits.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const edge = read("host/voice-agent-edge.ts")
const tts = read("host/voice-agent-tts.ts")
const speech = read("host/voice-agent-speech.ts")
const host = read("host/aven-app-host.ts")
const providers = read("host/providers.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const playback = read("web/src/voice-agent/playback.ts")
const voices = read("web/src/voice-agent/voices.ts")
const settings = read("web/src/SettingsDialog.tsx")
// v11.3.0 : la barre d'onglets doit rester fermable à la souris.
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const workbenchCss = read("web/src/styles/workbench.css")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.3.0.mjs"), "npm run verify inclut la sonde courante")

// ── A. Gratuit, sans compte, sans clé ───────────────────────────────────────
assert.match(edge, /aucune clé, aucun compte, aucune facturation/, "le module dit la gratuité et l'absence de compte")
assert.doesNotMatch(edge, /paid|billing|stripe|invoice|subscription/i, "aucun service facturé n'est câblé")
assert.doesNotMatch(edge, /apiKey|api_key|AZURE|SPEECH_KEY/, "aucune clé n'est demandée pour la voix")
assert.doesNotMatch(providers, /azure|AZURE_SPEECH/i, "aucun fournisseur à clé n'a été ajouté pour la voix")
assert.doesNotMatch(host, /AZURE_SPEECH|portal\.azure/, "le host ne lit aucune clé vocale")
assert.equal(pkg.dependencies["msedge-tts"], undefined, "la bibliothèque dont la poignée de main est refusée a été retirée")
assert.equal(pkg.dependencies.ws !== undefined, true, "le transport WebSocket est une dépendance déclarée")
assert.match(tts, /from "ws"/, "le transport parle WebSocket directement")
assert.match(tts, /Ocp-Apim-Subscription-Key/, "le service est joint sans compte ni clé personnelle")
assert.doesNotMatch(tts, /apiKey|api_key|invoice|stripe/i, "aucune facturation dans le transport")

// ── B. Service non contractuel : repli DIT, jamais de silence ───────────────
assert.match(edge, /NON contractuel/, "le module dit que le service n'est pas contractuel")
assert.match(speech, /isEdgeRateLimit/, "une limite de débit est identifiée")
assert.match(speech, /EDGE_RETRY_DELAY_MS/, "un 429 est retenté une fois")
assert.match(
  host,
  /warning: `Voix neuronale indisponible \(\$\{reason\}\) : voix Windows utilisée\.`/,
  "le repli sur la voix Windows est signalé par un avertissement",
)
assert.match(host, /await speakWithWindowsVoice\(clean, undefined, runPowerShell\)/, "le repli parle réellement, hors ligne")
assert.match(hook, /if \(speech\.warning\) commit\(\{ type: "error", message: speech\.warning \}\)/, "le renderer affiche l'avertissement")
assert.match(agents, /pas contractuel/, "AGENTS.md fige la règle du repli dit")

// ── C. Décision de voix : module pur, préfixes stables ─────────────────────
assert.match(edge, /Pur : testable avec Node seul/, "la décision de voix se déclare pure")
assert.match(edge, /export function resolveVoiceRoute/, "la décision est une fonction exportée")
assert.match(edge, /startsWith\("sapi:"\)/, "une voix Windows explicite reste locale")
assert.match(host, /const ids = \[\.\.\.EDGE_VOICE_IDS\]/, "les voix neuronales sont proposées en tête")
assert.match(host, /ids\.push\(`sapi:\$\{name\}`\)/, "les voix Windows sont préfixées, donc distinguables")
assert.ok(existsSync(path.join(root, "tests/voice-agent-edge.test.mjs")), "les tests du module existent")
assert.ok(existsSync(path.join(root, "tests/voice-agent-voices.test.mjs")), "les tests du catalogue existent")

// ── D. Lecture dans la webview, aperçu identique ────────────────────────────
assert.match(playback, /decodeAudioData/, "le MP3 est décodé par la webview")
assert.match(playback, /audio ne touche jamais le disque/, "l'audio reste en mémoire")
// Le chemin est vérifié en F : une demande par réponse (plus de boucle par phrase).
assert.match(hook, /await playVoiceSpeech\(speech\)/, "le hook joue l'audio rendu par le host")
assert.match(settings, /await playVoiceSpeech\(speech\)/, "l'aperçu joue le MP3 neuronal")
assert.match(settings, /optgroup label="Neuronales \(Edge, en ligne\)"/, "les voix neuronales sont groupées et dites en ligne")
assert.match(settings, /Aucune voix Windows détectée/, "l'absence de voix locale reste dite")
assert.match(voices, /Miroir de EDGE_VOICES/, "le catalogue du renderer se déclare miroir du host")
assert.doesNotMatch(voices, /AZURE|SPEECH_KEY/, "le renderer ne connaît aucun secret de voix")

// ── E. Un seul module calcule le jeton, et il est testé ────────────────────
assert.match(edge, /export function edgeSpeechToken/, "le jeton est calculé par un module pur")
assert.match(edge, /createHash\("sha256"\)/, "le jeton est un hachage horodaté, pas une valeur figée")
assert.equal((host + speech + tts).includes("6A5AA1D4EAFF4E9FB37E23D68491D6F4"), false, "la constante ne vit que dans le module pur")
assert.match(tts, /edgeSpeechToken\(at\)/, "le transport demande son jeton au module pur")
assert.match(tts, /Path:turn\.end/, "le protocole écoute la fin de tour du service")
assert.match(speech, /from "\.\/voice-agent-tts\.js"/, "la synthèse délègue le transport")
assert.match(speech, /synthesizeEdgeSpeech/, "la synthèse est une fonction exportée du module de voix")

// ── F. Une réponse = une synthèse, et le silence est coupé ─────────────────
assert.match(hook, /const speakReply = useCallback/, "la lecture porte sur la réponse entière")
assert.match(hook, /await api\.voiceAgentSay\(text\)/, "une seule demande par réponse")
assert.doesNotMatch(hook, /speakSentences/, "la boucle phrase par phrase a disparu")
assert.match(playback, /trimRange/, "le silence de tête et de queue est coupé par le module pur")
assert.ok(existsSync(path.join(root, "web/src/voice-agent/trim.ts")), "le module de coupe existe")
assert.ok(existsSync(path.join(root, "tests/voice-agent-trim.test.mjs")), "le module de coupe est testé")
// v11.3.0 : ~1 s entre deux phrases, c'est long ; le débit (rate) reste à 0 %.
assert.match(playback, /compressPauses/, "les pauses internes sont raccourcies à la lecture")
assert.match(read("web/src/voice-agent/pause.ts"), /PAUSE_TARGET_MS = 420/, "la cible de pause est figée par le module pur")
assert.match(tts, /rate='\+0%'/, "le débit reste le débit naturel du service")
assert.ok(existsSync(path.join(root, "tests/voice-agent-pause.test.mjs")), "le module des pauses est testé")

// ── G. Chaque onglet fermable porte sa croix ───────────────────────────────
// v11.3.0 : v11.1.0 avait retiré les croix « pour alléger » ; une souris ne pouvait
// plus fermer d'onglet, seulement Ctrl+W. Un raccourci n'est pas une action visible.
assert.match(shell, /\{t\.kind !== "home" && \(/, "Aujourd'hui reste sans croix (plancher du Poste)")
assert.match(shell, /className="wb-tab-close"/, "chaque onglet fermable rend un bouton de fermeture")
assert.match(shell, /onClick=\{\(\) => closeWorkbenchTab\(t\.id\)\}/, "la croix suit le modèle pur closeTab")
assert.match(shell, /aria-label=\{`Fermer \$\{label\}`\}/, "la croix est nommée en français")
assert.match(workbenchCss, /\.wb-tab-close \{/, "la croix a ses styles (tokens, pas de littéral)")
assert.match(workbenchCss, /\.wb-tab-close:focus-visible/, "la croix garde un focus visible")
assert.match(agents, /Chaque onglet fermable porte/, "AGENTS.md fige la règle de la croix")

console.log("v11.3.0 verification: OK (voix neuronale Edge — gratuite, sans compte, repli dit, lecture webview)")
