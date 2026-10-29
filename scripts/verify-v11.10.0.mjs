import assert from "node:assert/strict"
import { existsSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.10.0 : une troisième voix locale rejoint Piper, et elle ne parle pas dans le
// même conteneur. Ce que la sonde fige :
//   A. le langage français est TOUJOURS demandé au moteur (le défaut est l'anglais) ;
//   B. le host retire l'en-tête WAV UNE fois et pousse le PCM par paquets ;
//   C. le renderer prépare le bon lecteur AVANT l'appel — MediaSource ne lit pas
//      d'échantillons nus, et un abonné tardif perd toutes les trames (v11.5.3) ;
//   D. le repli reste possible et TOUJOURS dit (voix Windows) ;
//   E. le binaire est épinglé et VÉRIFIÉ par empreinte, jamais téléchargé à
//      l'aveugle, et son modèle ouvert ne demande aucun jeton.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const pocket = read("host/pocket-tts.ts")
const host = read("host/aven-app-host.ts")
const route = read("host/voice-route.ts")
const pron = read("host/pronunciation.ts")
const rust = read("src-tauri/src/runtime.rs")
const fetchScript = read("scripts/fetch-pocket-tts.mjs")
const player = read("web/src/voice-agent/pcm-stream.ts")
const schedule = read("web/src/voice-agent/pcm-schedule.ts")
const stream = read("web/src/voice-agent/stream.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const voices = read("web/src/voice-agent/voices.ts")
const settings = read("web/src/SettingsDialog.tsx")
const types = read("web/src/types.ts")
const tests = read("tests/pocket-tts.test.mjs")
const scheduleTests = read("tests/pcm-schedule.test.mjs")
const voiceScript = read("scripts/fetch-pocket-voice.mjs")
const audio = read("host/pcm-audio.ts")
const audioTests = read("tests/pcm-audio.test.mjs")
const trim = read("web/src/voice-agent/trim.ts")
const pause = read("web/src/voice-agent/pause.ts")
const audit = read("docs/audits/2026-10-27-voix-pocket-tts.md")

// ── Version cohérente dans tous les manifestes ──────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.10.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.10.0"], "node scripts/verify-v11.10.0.mjs", "la sonde a son entrée npm")
assert.equal(pkg.scripts["fetch:pocket-tts"], "node scripts/fetch-pocket-tts.mjs", "le provisionnement a son entrée npm")

// ── A. Le moteur est celui du français, quantifié, sur la boucle locale ─────
assert.match(pocket, /export const POCKET_VOICE_ID = "pocket:fr"/, "l'identifiant de voix est préfixé")
assert.match(pocket, /export const POCKET_LANGUAGE = "french"/, "le langage du modèle est nommé")
assert.match(pocket, /"--language",\s*POCKET_LANGUAGE/, "les arguments transmettent le langage")
assert.match(pocket, /"--quantize"/, "l'int8 est demandé : même voix, deux fois plus rapide")
assert.match(pocket, /"--host",\s*"127.0.0.1"/, "le serveur reste sur la boucle locale")
assert.match(pocket, /export function pocketServerEnv\(/, "l'environnement du moteur est construit par une fonction")
assert.match(host, /process\.env\.AVEN_POCKET_DIR/, "le dossier du moteur vient du host")

// ── B. Un en-tête WAV retiré une fois, puis des paquets de PCM ─────────────
assert.match(pocket, /export function wavDataOffset\(/, "l'offset des données est une fonction pure")
assert.match(pocket, /export function wrapPcmAsWav\(/, "le PCM se réenveloppe en WAV pour l'aperçu")
assert.match(host, /async function streamPocketSpeech\(/, "le flux Pocket est une fonction dédiée")
assert.equal((host.match(/wavDataOffset\(/g) ?? []).length, 2, "l'en-tête est cherché à deux endroits : flux et bloc")
assert.match(host, /dataOffset = wavDataOffset\(new Uint8Array\(header\)\)/, "l'en-tête est reconnu morceau par morceau")
// v11.10.0 : le paquet part de la mise en forme — la garantie est la même, la
// ligne a changé (le PCM est désormais mis en forme avant de partir).
assert.match(host, /push\(\{ type: "voice\.stream\.chunk", data: \{ streamId, audio: Buffer\.from\(shaped\)\.toString\("base64"\) \} \}\)/, "chaque paquet part vers la webview")
assert.match(host, /push\(\{ type: "voice\.stream\.end", data: \{ streamId, mime: POCKET_PCM_MIME \} \}\)/, "la fin du flux est annoncée")
assert.match(host, /const response = await fetch\(pocketSpeechUrl\(server\.port\), \{ method: "POST", body: form, signal \}\)/, "la synthèse est annulable")
assert.match(host, /activeStreams\.set\(streamId, \(\) => controller\.abort\(\)\)/, "l'arrêt coupe la synthèse en cours")
assert.match(host, /if \(controller\.signal\.aborted\) return \{\}/, "une interruption ne déclenche pas de repli")

// ── C. Le bon lecteur, préparé AVANT la demande ────────────────────────────
assert.match(pocket, /export function streamKindForVoice\(/, "le type de flux est décidé dans un module pur")
assert.match(pocket, /return "pcm"/, "Pocket demande le lecteur PCM")
assert.match(route, /\| \{ kind: "pocket"; voice: string \}/, "le routage connaît un troisième moteur local")
assert.match(route, /startsWith\("pocket:"\)/, "le préfixe est routé explicitement")
assert.match(host, /return streamKindForVoice\(loadPrefs\(\)\.voiceName\)/, "le host répond sur la voix enregistrée")
assert.match(types, /voiceAgentStreamKind: \(\) => Promise<"pcm" \| "none">/, "le contrat IPC est typé côté renderer")
assert.match(hook, /const kind = await api\.voiceAgentStreamKind\(\)/, "le hook demande le type de flux")
assert.ok(
  hook.indexOf("await api.voiceAgentStreamKind()") < hook.indexOf("createPcmStream(streamId)"),
  "le type est demandé AVANT de créer le lecteur",
)
assert.match(hook, /kind === "pcm" \? createPcmStream\(streamId\) : null/, "seul le PCM a un lecteur de flux")
assert.match(player, /new AudioContext\(\{ sampleRate: PCM_SAMPLE_RATE \}\)/, "le PCM est joué à la fréquence du moteur")
assert.match(player, /node\.onended = \(\) => \{/, "la fin d'un paquet est suivie")
assert.match(player, /registerVoicePlaybackStopper/, "une interruption coupe aussi ce flux")
assert.match(player, /registerStreamSink\(streamId/, "le lecteur s'enregistre dans la carte partagée")
// Un seul abonnement aux événements de flux, comme en v11.5.3 : deux écouteurs
// concurrents se disputeraient les trames.
assert.equal((stream.match(/api\.onEvent\(/g) ?? []).length, 1, "un seul abonnement aux événements de flux")
assert.match(stream, /export function registerStreamSink\(/, "la carte des lecteurs est partagée par une fonction")
assert.match(schedule, /export function pcmChunkPlan\(/, "le placement des paquets est pur")
assert.match(schedule, /export function pcmSamples\(/, "la lecture des échantillons est pure")
assert.match(schedule, /carry/, "l'octet orphelin d'un paquet impair est reporté")
assert.match(player, /shouldStartPlayback\(bufferedMs, ended\)/, "le démarrage suit la règle de volume testée")

// ── D. Le repli existe, il est local, et il est TOUJOURS dit ───────────────
const pocketBranch = host.match(/if \(route\.kind === "pocket"\) \{[\s\S]*?\n  \}/)?.[0] ?? ""
assert.ok(pocketBranch, "la branche Pocket de sayWithVoice est identifiable")
assert.match(pocketBranch, /speakWithLocalVoiceFallback/, "l'échec passe par le repli local")
assert.match(host, /Voix Pocket TTS indisponible \(\$\{reason\}\) : voix Windows utilisée\./, "le repli voix Windows est annoncé")
assert.match(host, /function stopPocketServer\(\): void/, "le moteur local peut être arrêté")
assert.match(host, /process\.on\("exit", stopPocketServer\)/, "le moteur local ne survit pas au host")
assert.match(host, /  stopPocketServer\(\)/, "la fermeture de session arrête le moteur")
assert.match(pocket, /export async function waitForPocketReady\(/, "l'attente de démarrage est bornée et testable")
assert.match(pocket, /export function pocketUnavailableReason\(/, "la raison du repli nomme le remède")
assert.match(host, /if \(pocketDir\(\)\) ids\.push\(pocketVoiceId\(pocketProfile\(\)\)\)/, "la voix n'apparaît que si le binaire est là")

// ── E. Binaire épinglé, vérifié, sans jeton ────────────────────────────────
assert.match(pocket, /export const POCKET_ZIP_SHA256 = "[0-9a-f]{64}"/, "l'empreinte attendue est déclarée")
assert.match(pocket, /export const POCKET_RELEASE = "v\d+\.\d+\.\d+"/, "la version du binaire est épinglée")
assert.match(fetchScript, /kyutai-labs\/pocket-tts\/releases\/download\/\$\{RELEASE\}/, "le binaire vient de la publication officielle")
assert.match(fetchScript, /98753041f2e65744b989776f87bccb93f1f574a08afe1890c5427ec94cd6309c/, "l'empreinte du zip est celle du SHA256SUMS publié")
assert.match(fetchScript, /if \(digest !== ZIP_SHA256\)/, "une empreinte différente interrompt l'installation")
assert.match(fetchScript, /Expand-Archive/, "l'archive est ouverte par Windows, sans outil externe")
assert.match(fetchScript, /HF_HOME: modelDir/, "le modèle est mis en cache dans les données de l'app")
assert.match(fetchScript, /kyutai\/pocket-tts-without-voice-cloning|languages.*french/, "le modèle récupéré est le français ouvert")
assert.match(tauri.bundle.resources["resources/pocket-tts/"], /runtime\/pocket-tts/, "l'installeur embarque le moteur")
assert.match(rust, /fn bundled_pocket/, "Rust résout le dossier Pocket")
assert.match(rust, /command\.env\("AVEN_POCKET_DIR", pocket\)/, "Rust transmet le dossier au host")

// ── F. Dictionnaire, tests et documentation ────────────────────────────────
assert.match(pron, /"sapi" \| "pocket"/, "les deux moteurs restants sont nommés")
assert.match(pron, /pocket: \{\s*Freebuff: "Fribeuf",\s*Aven: "Aveun",\s*\}/, "Pocket reçoit les deux graphies locales")
assert.match(host, /applyPronunciations\(sanitizeSpeechText\(clean\), "pocket"\)/, "Pocket passe par le dictionnaire")
assert.match(voices, /id: "pocket:fr"/, "le menu connaît la voix")
assert.match(settings, /Pocket TTS est un moteur local/, "les Réglages annoncent le téléchargement du modèle")
assert.ok(existsSync(path.join(root, "tests/pocket-tts.test.mjs")), "les tests du moteur existent")
assert.match(tests, /le serveur est lancé en français, quantifié, sur la boucle locale/, "le langage est protégé par un test")
assert.match(tests, /l'en-tête WAV est retrouvé, même avec un bloc avant les données/, "l'en-tête est protégé par un test")
assert.ok(existsSync(path.join(root, "tests/pcm-schedule.test.mjs")), "les tests du lecteur existent")
assert.match(scheduleTests, /un octet orphelin est reporté sur le paquet suivant/, "l'octet orphelin est protégé par un test")
assert.match(agents, /host\/pocket-tts\.ts/, "AGENTS.md cite le module")
assert.match(agents, /npm run fetch:pocket-tts/, "AGENTS.md cite le provisionnement")
assert.match(agents, /pcm-schedule\.ts/, "AGENTS.md cite la planification pure")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

// ── G. La voix clonée : un profil local, jamais distribué ──────────────────
assert.match(pocket, /export const POCKET_CLONE_VOICE_ID = "pocket:clone"/, "l'identifiant de la voix clonée est stable")
assert.match(pocket, /export function pocketVoicesDir\(/, "le dossier des profils est une fonction pure")
assert.match(pocket, /export function pocketCloneProfile\(/, "la présence du profil se teste sans disque")
assert.match(pocket, /export function pocketVoiceId\(/, "l'identifiant proposé dépend du profil installé")
assert.match(pocket, /export function normalizePocketPreference\(/, "une préférence Pocket est recalée sur ce qui existe")
assert.match(pocket, /if \(cloneProfile\) args\.push\("--default-voice", cloneProfile\)/, "le profil est transmis au démarrage du moteur")
assert.match(host, /pocketServerArgs\(port, pocketProfile\(\)\)/, "le host transmet le profil installé")
assert.match(host, /function pocketProfile\(\): string \| null/, "le host résout le profil une seule fois")
assert.match(host, /normalizePocketPreference\(pocketProfile\(\), stored\)/, "la préférence enregistrée est recalée au chargement")
assert.match(host, /if \(pocketDir\(\)\) return pocketVoiceId\(pocketProfile\(\)\)/, "la voix par défaut est Pocket quand le moteur est là")
assert.match(voices, /id: "pocket:clone", label: "Pocket TTS — locale, voix clonée"/, "le menu nomme la voix clonée sans nommer une personne")
// v11.11.0 : la pose d'un profil a quitté la ligne de commande pour les Réglages
// (« Créer une voix à partir d'un fichier… »). L'exigence tient — les Réglages
// disent ce qu'est la voix clonée et comment elle se retire — la ligne a changé.
assert.match(settings, /Retirer la voix clonée/, "les Réglages disent comment retirer un profil")
assert.match(voiceScript, /aven\.safetensors/, "le script de pose écrit le fichier que le host attend")
assert.match(voiceScript, /\"pocket-tts\", \"voices\"/, "le script vise le même dossier que le host")
assert.match(voiceScript, /export-voice/, "un enregistrement de référence est converti par le binaire")
assert.match(voiceScript, /kyutai\/pocket-tts/, "l'accès soumis à conditions est cité quand la conversion échoue")
assert.equal(pkg.scripts["voice:pocket"], "node scripts/fetch-pocket-voice.mjs", "la pose a son entrée npm")
// Le profil est un dérivé d'un enregistrement de référence : il ne se distribue pas.
assert.deepEqual(
  existsSync(path.join(root, "src-tauri", "resources"))
    ? readdirSync(path.join(root, "src-tauri", "resources"), { recursive: true }).map(String).filter((name) => name.endsWith(".safetensors"))
    : [],
  [],
  "aucun profil de voix n'est livré dans le dépôt",
)
assert.match(audit, /[Vv]oix clonée/, "l'audit documente l'essai de la voix clonée")
assert.match(agents, /voice:pocket/, "AGENTS.md cite la commande de pose")
assert.match(readme, /voix clonée/, "README annonce la voix clonée")

// ── I. Niveau et silences du PCM local ─────────────────────────────────────
assert.match(audio, /export const PCM_LEVEL_GAIN_DB = 2\.5/, "le gain vient de la mesure, pas d'un réglage à l'œil")
assert.match(audio, /export function applyPcmGain\(/, "le gain est une fonction pure, saturante")
assert.match(audio, /export function createPcmShaper\(/, "la mise en forme du flux est un état pur")
assert.match(audio, /export function shapePcm\(/, "le chemin d'un bloc partage la même règle")
assert.match(audio, /PCM_TRIM_MARGIN_MS = 40/, "la marge d'attaque est celle d'Edge")
assert.match(audio, /PCM_PAUSE_MAX_MS = 650/, "le seuil de pause est celui d'Edge")
assert.match(audio, /PCM_PAUSE_TARGET_MS = 420/, "la pause ramenée est celle d'Edge")
// Les deux voix doivent s'entendre pareil : les valeurs d'Edge ne bougent pas.
assert.match(trim, /TRIM_MARGIN_MS = 40/, "trim.ts garde la même marge")
assert.match(pause, /PAUSE_MAX_MS = 650/, "pause.ts garde le même seuil")
assert.match(pause, /PAUSE_TARGET_MS = 420/, "pause.ts garde la même cible")
assert.match(host, /import \{ PCM_LEVEL_GAIN_DB, createPcmShaper, shapePcm \} from "\.\/pcm-audio\.js"/, "le host branche la mise en forme")
assert.equal((host.match(/gainDb: pocketGainDb\(\)/g) ?? []).length, 2, "les deux chemins sont traités : flux et bloc")
assert.match(host, /return pocketProfile\(\) \? PCM_LEVEL_GAIN_DB : 0/, "le gain ne s'applique qu'à la voix clonée")
assert.match(host, /send\(shaper\.end\(\)\)/, "le silence de queue est jeté à la fin du flux")
assert.ok(existsSync(path.join(root, "tests/pcm-audio.test.mjs")), "les tests de mise en forme existent")
assert.match(audioTests, /un paquet coupé au milieu d'un échantillon ne décale rien/, "l'octet orphelin est protégé par un test")
assert.match(audioTests, /le silence de queue est jeté/, "la coupe de queue est protégée par un test")
assert.match(audit, /2,4 dB/, "l'audit porte l'écart mesuré avec Piper")
assert.match(agents, /pcm-audio\.ts/, "AGENTS.md cite le module")
assert.match(readme, /silences de tête et de queue/, "README annonce la correction")

console.log(`v${pkg.version} verification: OK (voix locale Pocket TTS, voix clonée posée hors dépôt, niveau et silences mesurés, binaire vérifié)`)
