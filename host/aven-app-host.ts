// Runtime applicatif Aven, indépendant d'Electron.
// Phase Tauri : le host concentre les opérations qui parlent à OpenCode.
// Les fonctions Windows (fenêtre, tray, dialogs, notifications) restent dans Tauri.
// Le protocole reste JSON-RPC 2.0 ligne par ligne, comme aven-engine-host.mjs.

import { EngineClient, sdkProxy, type EngineEvent } from "./engine-client.js"
import { makeOps, type BridgeHost } from "./operations.js"
import type { Bridge } from "./opencode-bridge.js"
import { loadNames } from "./agent-names.js"
import { listArchived } from "./archive.js"
import { resolveOpenCodeBin } from "./opencode-bridge.js"
import { probeOpenRouterKey, PROVIDERS } from "./providers.js"
import { seedWorkspace } from "./workspace-seed.js"
import { buildAgentsDir, readTemplateAgents } from "./agents-bridge.js"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import { createInterface } from "node:readline"
import { execFileSync, execFile, spawn } from "node:child_process"
// v11.10.0 : un port libre est demandé au système pour le serveur vocal local.
import { createServer } from "node:net"
import { promisify } from "node:util"
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, statSync } from "node:fs"
import { randomUUID } from "node:crypto"
import path from "node:path"
import {
  archiveNote, backlinks, cleanFolder, createFolder, deleteFolder, deleteNote, getNote,
  listArchived as listArchivedNotes,
  listNotes, listTrash, moveNote, noteLinks, notesDir, notesTree, purgeNote, quickCapture,
  renameFolder, restoreNote, saveNote, searchNotes, unarchiveNote,
} from "./notes.js"
import { forgetNote, loadAllTags, loadPinned, loadTags, setTags, togglePin } from "./notes-meta.js"
import { listWorkspaceDir, readWorkspaceFile, breadcrumbOf, safeResolve as safeResolveWorkspacePath } from "./workspace-files.js"
import { aggregateStats, readDictationStats } from "./stats.js"
import { buildDiagnostic } from "./diagnostic.js"
import { transcribeSpeech } from "./voice.js"
// v11.1.0 : agent vocal — canal distinct de la dictée (nouveau pipeline).
import { interpretVoiceText } from "./voice-agent-commands.js"
import { normalizeVoicePersonality, type VoicePersonality } from "./voice-agent-personality.js"
import { answerVoiceQuestion, composeVoiceNote, listWindowsVoices, sanitizeSpeechText, speakWithWindowsVoice, splitSentences, transcribeVoiceSegment, type PowerShellRunner, type VoiceTurn } from "./voice-agent-speech.js"
// v11.2.0 : outils de lecture de l'agent vocal (état, notes).
// v11.9.0 : le catalogue d'actions (host/agent-actions.ts) — le host les exécute
// lui-même, sans traverser l'IPC du renderer (aucun risque d'interblocage), et le
// modèle ne peut que PROPOSER une destruction.
import { createVoiceToolRunner, type VoiceActionOutcome } from "./voice-agent-tools.js"
import {
  ACTION_EXECUTION_FAILED_REPLY, ACTION_EXPIRED_REPLY, ACTION_NONE_PENDING_REPLY,
  AGENT_LOG_LIMIT, CHAT_LIST_LIMIT, actionAmbiguityText, actionConfirmationOpen,
  actionDonePhrase, actionNotFoundText, actionSpec, formatAgentLog, matchActionTarget,
  resolveAgentName, type AgentAction, type AgentLogEntry,
} from "./agent-actions.js"
// v11.14.0 : une seule pile vocale — moteur local Pocket TTS, repli voix Windows.
// Les voix neuronales d'Edge (service distant) et la voix locale Piper ont été
// retirées : le host ne connaît plus que « pocket: » et « sapi: ».
import { resolveVoiceRoute } from "./voice-route.js"
// v11.4.4 : dictionnaire de prononciation des noms propres, appliqué juste avant la synthèse.
import { applyPronunciations } from "./pronunciation.js"
// v11.10.0 : moteur vocal local Pocket TTS (binaire embarqué, synthèse en flux).
import {
  POCKET_CLONE_TIMEOUT_MS, POCKET_CLONE_VOICE_ID, POCKET_PCM_MIME, POCKET_SAMPLE_RATE, POCKET_VOICE_ID,
  normalizePocketPreference, pocketCloneBlockedReason, pocketClonePaths, pocketCloneProfile,
  pocketCloneRepoDir, pocketCloneWeightsPresent, pocketExportArgs, pocketExportEnv,
  pocketHealthUrl, pocketInstalled, pocketLayout, pocketModelDir, pocketServerArgs,
  pocketServerEnv, pocketSpeechUrl, pocketUnavailableReason, pocketVoiceId, profileTensorCount,
  streamKindForVoice, waitForPocketReady, wavDataOffset, wrapPcmAsWav,
} from "./pocket-tts.js"
// v11.10.0 : niveau et silences du PCM local — mêmes seuils que la voix de référence.
import { PCM_LEVEL_GAIN_DB, createPcmShaper, shapePcm } from "./pcm-audio.js"
import { Announcer } from "./announcer.js"
import { countDictation } from "./stats.js"
import { rpcObjectParam } from "./rpc-params.js"
import { writeTextAtomic } from "./atomic-file.js"
// v11.5.2 : les clés déchiffrées sont gardées en mémoire du host (jamais côté
// renderer) pour ne plus payer un lancement PowerShell à chaque requête vocale.
import { createKeyCache } from "./key-cache.js"
import { buildInstallCommand, buildLaunchCommand, freebuffBusyMessage, freebuffMissingMessage, parseVersionOutput } from "./freebuff-cli.js"
import { createCliManager } from "./freebuff-cli-manager.js"
import { DEFAULT_PTY_COLS, DEFAULT_PTY_ROWS, freebuffPtyPid, isFreebuffPtyActive, loadPtyModule, restartFreebuffPty, resizeFreebuffPty, signalFreebuffPty, startFreebuffPty, stopFreebuffPty, writeFreebuffPty } from "./freebuff-pty.js"

type RpcMessage = { jsonrpc: "2.0"; id?: string | number; method?: string; params?: any }

type AppState = {
  status: "starting" | "ready" | "error"
  error?: string
  needsWorkspace?: boolean
  keys: Record<string, boolean>
  keyWarnings?: Record<string, string>
  providers: { id: string; label: string; url: string; note: string }[]
  version?: string
  cli?: string
  workspace?: string
  sync?: { file: string; status: "created" | "updated" | "unchanged" | "custom" }[]
  newModels?: string[]
  removedModels?: string[]
  agentsBridge?: string[]
  assignments?: Record<string, { ref: string; label: string }[]>
  warning?: string
  versionWarning?: string
}

const providers = PROVIDERS.map(({ id, label, url, note }) => ({ id, label, url, note }))
// v10.0.0 : diagnostic copiable — 30 derniers types d'événements seulement, sans contenu utilisateur.
const diagLog: string[] = []
function trace(line: string) {
  diagLog.push(`${new Date().toISOString()} ${line}`)
  if (diagLog.length > 30) diagLog.shift()
}
trace("démarrage du runtime applicatif")

let workspace = ""
let templateDir = ""
let engine: EngineClient | null = null
let engineState: Record<string, unknown> = {}
let engineChains: Record<string, { ref: string; label: string }[]> = {}
let ops: ReturnType<typeof makeOps> | null = null
let lastUserActivity = 0

async function speakWithSapi(text: string): Promise<void> {
  if (process.platform !== "win32") return
  const safe = String(text).slice(0, 240).replace(/'/g, "''")
  await execFileAsync(
    "powershell.exe",
    [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('" + safe + "')",
    ],
    { timeout: 20_000, windowsHide: true },
  )
}

const announcer = new Announcer({
  isMuted: () => Date.now() - lastUserActivity < 1_500,
  speak: speakWithSapi,
})

// v11.1.0 : agent vocal. Le contexte de session reste borné (6 tours) et vit en
// mémoire — jamais sur disque. Un seul processus de voix à la fois : « stop »
// tue la lecture en cours au lieu d'attendre la fin de la phrase.
let voiceHistory: VoiceTurn[] = []
let voiceSpeechChild: ReturnType<typeof spawn> | null = null

// v11.9.0 : journal des actions de l'agent, en mémoire seulement (jamais sur
// disque), et UNE action destructive en attente de confirmation orale. Le jeton
// vit ici : le renderer ne peut que confirmer ce que le host a proposé.
const agentLog: AgentLogEntry[] = []
let pendingVoiceAction: { token: string; name: string; args: Record<string, string>; label: string; askedAt: number } | null = null

function pushAgentLog(entry: AgentLogEntry) {
  agentLog.push(entry)
  if (agentLog.length > AGENT_LOG_LIMIT) agentLog.splice(0, agentLog.length - AGENT_LOG_LIMIT)
}

const runPowerShell: PowerShellRunner = (script, env) => new Promise((resolve, reject) => {
  const child = spawn("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true,
    env: { ...process.env, ...(env ?? {}) },
  })
  voiceSpeechChild = child
  let stdout = ""
  let stderr = ""
  child.stdout?.on("data", (data) => { stdout += String(data) })
  child.stderr?.on("data", (data) => { stderr += String(data) })
  child.on("error", (error) => {
    if (voiceSpeechChild === child) voiceSpeechChild = null
    reject(error)
  })
  child.on("close", (code) => {
    if (voiceSpeechChild === child) voiceSpeechChild = null
    if (code === 0) resolve(stdout)
    else reject(new Error(stderr.trim() || "La voix Windows n'a pas pu lire le texte."))
  })
})

function stopVoiceSpeech() {
  if (!voiceSpeechChild) return
  try { voiceSpeechChild.kill() } catch { /* déjà terminé */ }
  voiceSpeechChild = null
}

function requireGroqKey(): string {
  const key = cachedKey("groq")?.trim()
  if (!key) throw new Error("Configure une clé Groq dans Réglages → Services IA pour utiliser l'agent vocal.")
  return key
}

// v11.14.0 : la voix se choisit dans les préférences, avec deux préfixes stables :
// « pocket: » (moteur local Pocket TTS) et « sapi: » (voix Windows locale). Le host
// tranche UNE fois, au même endroit (host/voice-route.ts), et ne laisse jamais
// l'interface choisir un moteur. Sans moteur local, la voix Windows parle — hors
// ligne, et sans jamais rendre l'agent muet.
type VoiceSpeech = { audio?: string; mime?: string; spoken?: boolean; warning?: string }

const activeStreams = new Map<string, () => void>()

/**
 * v11.10.0 : dossier du moteur Pocket TTS fourni par l'installeur, ou `null`.
 * Une installation incomplète ne doit pas faire croire à une voix disponible :
 * sans binaire, la préférence retombe sur le repli annoncé (voix Windows).
 */
function pocketDir(): string | null {
  const dir = process.env.AVEN_POCKET_DIR
  if (!dir) return null
  return pocketInstalled(dir, existsSync) ? dir : null
}

/** Racine des données de l'app — même règle que les préférences et les clés. */
function pocketDataDir(): string {
  return process.env.AVEN_USER_DATA_DIR || path.join(process.env.APPDATA || process.cwd(), "Aven")
}

/**
 * v11.10.0 : profil de voix clonée installé, ou `null`. Il vit dans les données
 * de l'app — jamais dans l'installeur : c'est un dérivé d'un enregistrement de
 * référence, que l'utilisateur pose lui-même (`npm run voice:pocket`).
 */
function pocketProfile(): string | null {
  return pocketCloneProfile(pocketDataDir(), existsSync)
}

/**
 * v11.10.0 : gain appliqué au PCM du moteur local. Mesuré sur la voix clonée :
 * −24,4 dBFS RMS, contre −21,1 pour la voix intégrée du même moteur. On compense
 * donc UNIQUEMENT quand un profil est posé — remonter la voix intégrée fausserait
 * la mesure de la voix clonée.
 */
function pocketGainDb(): number {
  return pocketProfile() ? PCM_LEVEL_GAIN_DB : 0
}

/**
 * v11.11.0 : les poids du modèle de clonage sont-ils déjà dans le cache DE
 * L'APPLICATION ? On lit la liste des révisions du dépôt dans les données de
 * l'app — jamais le cache Hugging Face de la machine, qui appartient à une autre
 * installation : l'app installe elle-même ce qu'elle utilise.
 */
function pocketCloneWeightsReady(): boolean {
  const modelDir = pocketModelDir(pocketDataDir())
  let snapshots: string[] = []
  try {
    snapshots = readdirSync(path.join(pocketCloneRepoDir(modelDir), "snapshots"))
  } catch {
    // Dépôt jamais téléchargé : c'est le cas normal du premier clonage.
    return false
  }
  return pocketCloneWeightsPresent(modelDir, snapshots, existsSync)
}

/**
 * v11.11.0 : crée le profil de voix clonée À PARTIR de l'application. Le moteur
 * fait tout le travail : il télécharge lui-même le modèle de clonage (209 Mo, le
 * seul maillon dont l'accès est soumis à conditions) dans les données de l'app
 * quand il manque, puis encode l'enregistrement de référence — mesuré à 1,5 s
 * (WAV court) et 5,3 s (MP3), téléchargement exclu. Le profil n'est posé qu'une
 * fois son en-tête vérifié (renommage), et le moteur est redémarré :
 * `--default-voice` ne se lit qu'au démarrage.
 */
async function cloneVoiceProfile(source: string): Promise<{ downloaded: boolean }> {
  const dir = pocketDir()
  if (!dir) throw new Error("Le moteur Pocket TTS n'est pas installé : le clonage passe par lui.")
  const audio = path.resolve(String(source ?? "").trim())
  if (!audio || !existsSync(audio)) throw new Error("Enregistrement de référence introuvable.")
  const dataDir = pocketDataDir()
  const modelDir = pocketModelDir(dataDir)
  const paths = pocketClonePaths(dataDir)
  const downloaded = !pocketCloneWeightsReady()
  const token = voiceCloneToken()
  if (downloaded && !token) throw new Error(pocketCloneBlockedReason(""))
  mkdirSync(paths.dir, { recursive: true })
  rmSync(paths.staged, { force: true })
  try {
    await execFileAsync(pocketLayout(dir).binary, pocketExportArgs(audio, paths.staged), {
      env: { ...process.env, ...pocketExportEnv(modelDir, token) },
      timeout: POCKET_CLONE_TIMEOUT_MS,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    })
  } catch (error) {
    rmSync(paths.staged, { force: true })
    const detail = String((error as { stderr?: string }).stderr ?? "").trim().split("\n").pop() ?? ""
    // Le refus du dépôt sous conditions est le cas le plus probable du premier
    // essai : il se dit avec le geste qui le lève, pas avec un code HTTP.
    if (/voice cloning|401|403|gated/i.test(detail)) throw new Error(pocketCloneBlockedReason(detail))
    throw new Error(
      ["Le moteur n'a pas pu convertir cet enregistrement.", detail].filter(Boolean).join(" "),
    )
  }
  try {
    profileTensorCount(new Uint8Array(readFileSync(paths.staged)))
  } catch (error) {
    rmSync(paths.staged, { force: true })
    throw new Error(`Le profil produit est inutilisable (${(error as Error).message}) : rien n'a été installé.`)
  }
  // Écriture par renommage : jamais un profil à moitié écrit à la place du bon.
  renameSync(paths.staged, paths.file)
  stopPocketServer()
  savePrefs({ voiceName: POCKET_CLONE_VOICE_ID })
  trace(`voix clonée posée${downloaded ? " (modèle de clonage téléchargé)" : " (modèle déjà en cache)"}`)
  return { downloaded }
}

/** v11.11.0 : retire le profil cloné ; la voix intégrée du moteur reprend la main. */
function removeVoiceProfile(): void {
  const paths = pocketClonePaths(pocketDataDir())
  for (const file of [paths.file, paths.staged]) {
    try {
      rmSync(file, { force: true })
    } catch {
      // Déjà absent : rien à retirer.
    }
  }
  stopPocketServer()
  // `loadPrefs` recale déjà une préférence Pocket sur la voix restante ; on
  // l'écrit pour que le fichier cesse de parler d'un profil qui n'existe plus.
  if (loadPrefs().voiceName.startsWith("pocket:")) savePrefs({ voiceName: POCKET_VOICE_ID })
  trace("voix clonée retirée")
}

// v11.10.0 : le serveur Pocket TTS reste vivant pour la session. Le chargement du
// modèle coûte 12,7 s (mesuré) : le payer à chaque phrase serait une panne
// déguisée. Un premier usage peut en plus télécharger 209 Mo, d'où l'attente
// longue — et le message qui nomme le remède au lieu d'un échec anonyme.
let pocketServer: { port: number; child: ReturnType<typeof spawn> } | null = null
let pocketStarting: Promise<{ port: number; child: ReturnType<typeof spawn> } | null> | null = null

/** Port libre demandé au système : deux instances d'Aven ne se marchent pas dessus. */
async function freeLocalPort(): Promise<number> {
  return await new Promise<number>((resolve, reject) => {
    const probe = createServer()
    probe.once("error", reject)
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address()
      const port = typeof address === "object" && address ? address.port : 0
      probe.close(() => (port ? resolve(port) : reject(new Error("Aucun port local libre."))))
    })
  })
}

/** Arrête le moteur local. Idempotent : fin de session, arrêt du host. */
function stopPocketServer(): void {
  if (pocketServer) {
    try { pocketServer.child.kill() } catch { /* déjà arrêté */ }
  }
  pocketServer = null
}
process.on("exit", stopPocketServer)

/** Démarre le moteur une seule fois, ou rend `null` en le disant à l'appelant. */
async function ensurePocketServer(): Promise<{ port: number } | null> {
  if (pocketServer) return pocketServer
  if (pocketStarting) return pocketStarting
  pocketStarting = (async () => {
    const dir = pocketDir()
    if (!dir) return null
    const port = await freeLocalPort()
    const child = spawn(pocketLayout(dir).binary, pocketServerArgs(port, pocketProfile()), {
      env: { ...process.env, ...pocketServerEnv(pocketModelDir(pocketDataDir())) },
      windowsHide: true,
      stdio: ["ignore", "ignore", "pipe"],
    })
    let detail = ""
    // Le moteur écrit sa progression sur stderr : la garder donne une raison
    // lisible au repli au lieu d'un « n'a pas démarré » anonyme.
    child.stderr?.on("data", (chunk: Buffer) => {
      detail = (detail + chunk.toString("utf8")).slice(-300)
    })
    child.on("error", (error) => { detail = error.message })
    const ready = await waitForPocketReady({
      check: async () => {
        const response = await fetch(pocketHealthUrl(port), { signal: AbortSignal.timeout(2_000) })
        return response.ok
      },
    })
    if (!ready) {
      try { child.kill() } catch { /* déjà mort */ }
      trace(`pocket indisponible : ${detail.trim().split("\n").pop() || "sans détail"}`)
      return null
    }
    pocketServer = { port, child }
    trace(`pocket prêt sur le port ${port}`)
    return pocketServer
  })().catch(() => null)
  try { return await pocketStarting } finally { pocketStarting = null }
}

/**
 * Synthèse Pocket TTS d'un bloc : WAV complet pour la webview (aperçu des
 * Réglages, chemins non diffusés). Le serveur diffuse un RIFF dont la taille
 * annoncée n'est pas fiable en flux : on réenveloppe les échantillons reçus
 * plutôt que de relayer un en-tête menteur.
 */
async function speakWithPocket(text: string): Promise<string | null> {
  const server = await ensurePocketServer()
  if (!server) return null
  const form = new FormData()
  form.set("text", text)
  const response = await fetch(pocketSpeechUrl(server.port), { method: "POST", body: form })
  if (!response.ok) throw new Error(`Le moteur Pocket TTS a refusé la synthèse (HTTP ${response.status}).`)
  const bytes = new Uint8Array(await response.arrayBuffer())
  const offset = wavDataOffset(bytes)
  if (offset < 0) throw new Error("Le moteur Pocket TTS n'a renvoyé aucun audio lisible.")
  const pcm = bytes.subarray(offset)
  if (!pcm.length) throw new Error("Le moteur Pocket TTS n'a renvoyé aucun audio.")
  // v11.10.0 : le même traitement que le flux, sinon l'aperçu des Réglages ne
  // dirait pas la vérité sur ce que l'agent va lire.
  const shaped = shapePcm(pcm, { sampleRate: POCKET_SAMPLE_RATE, gainDb: pocketGainDb() })
  if (!shaped.length) throw new Error("Le moteur Pocket TTS n'a renvoyé aucun audio.")
  return Buffer.from(wrapPcmAsWav(shaped)).toString("base64")
}

/**
 * v11.10.0 : synthèse Pocket en flux. Le serveur livre le PCM par paquets de
 * ~0,55 s (9 à 11 pour la phrase de référence) : l'en-tête WAV est retiré UNE
 * fois, chaque paquet passe par la mise en forme (`host/pcm-audio.ts` : niveau,
 * silence de tête, pauses internes bornées) puis part vers la webview, qui les
 * empile dans un AudioContext. Premier son mesuré à 270 ms. Aucun regroupement n'est
 * nécessaire : les paquets du moteur sont gros (~0,55 s).
 * Rend le nombre d'octets de PCM livrés.
 */
async function streamPocketSpeech(text: string, streamId: string, signal: AbortSignal): Promise<number> {
  const server = await ensurePocketServer()
  // v11.15.1 : le détail nu ; l'appelant l'habille UNE fois avec le remède.
  // L'habiller ici produisait « … (prépare le modèle (prépare le modèle…)) ».
  if (!server) throw new Error("le moteur n'a pas démarré")
  const form = new FormData()
  form.set("text", text)
  const response = await fetch(pocketSpeechUrl(server.port), { method: "POST", body: form, signal })
  if (!response.ok || !response.body) {
    throw new Error(`Le moteur Pocket TTS a refusé la synthèse (HTTP ${response.status}).`)
  }
  let header = Buffer.alloc(0)
  let dataOffset = -1
  let sent = 0
  // Une instance par flux : la mise en forme retient le silence en cours (voir
  // host/pcm-audio.ts). Rien n'est livré avant la première parole, sauf sa marge
  // d'attaque — d'où un premier paquet qui peut arriver plus tard qu'avant.
  const shaper = createPcmShaper({ sampleRate: POCKET_SAMPLE_RATE, gainDb: pocketGainDb() })
  const send = (pcm: Uint8Array): void => {
    const shaped = shaper.push(pcm)
    if (!shaped.length) return
    sent += shaped.length
    push({ type: "voice.stream.chunk", data: { streamId, audio: Buffer.from(shaped).toString("base64") } })
  }
  for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
    const bytes = Buffer.from(chunk)
    if (!bytes.length) continue
    let pcm = bytes
    if (dataOffset < 0) {
      header = Buffer.concat([header, bytes])
      dataOffset = wavDataOffset(new Uint8Array(header))
      if (dataOffset < 0) continue
      // L'en-tête peut arriver seul, ou collé aux premiers échantillons.
      pcm = header.subarray(dataOffset)
      header = Buffer.alloc(0)
      if (!pcm.length) continue
    }
    send(pcm)
  }
  // Le silence de queue ne se reconnaît qu'à la fin : c'est ici qu'il est jeté.
  send(shaper.end())
  return sent
}

/**
 * v11.10.0 : repli quand une voix LOCALE choisie (Pocket) ne peut pas parler.
 * v11.14.0 : le repli est la voix Windows — hors ligne, sans quota — et il est
 * toujours dit : l'utilisateur croirait avoir changé de voix pour rien sinon.
 */
async function speakWithLocalVoiceFallback(clean: string, reason: string): Promise<VoiceSpeech> {
  stopVoiceSpeech()
  await speakWithWindowsVoice(clean, undefined, runPowerShell)
  return { spoken: true, warning: `Voix Pocket TTS indisponible (${reason}) : voix Windows utilisée.` }
}

async function sayWithVoice(text: string, voiceName: string): Promise<VoiceSpeech> {
  const clean = String(text ?? "").trim()
  if (!clean) return { spoken: false }
  const route = resolveVoiceRoute({ voiceName })
  // v11.10.0 : voix Pocket TTS — locale. Diffusée quand le renderer a préparé
  // son lecteur ; jouée d'un bloc sinon (aperçu des Réglages).
  if (route.kind === "pocket") {
    stopVoiceSpeech()
    const spoken = applyPronunciations(sanitizeSpeechText(clean), "pocket")
    if (!spoken) return { spoken: false }
    try {
      const audio = await speakWithPocket(spoken)
      if (audio) return { audio, mime: "audio/wav" }
      return await speakWithLocalVoiceFallback(clean, pocketUnavailableReason(""))
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      return await speakWithLocalVoiceFallback(clean, pocketUnavailableReason(detail))
    }
  }
  stopVoiceSpeech()
  await speakWithWindowsVoice(clean, route.voice || undefined, runPowerShell)
  return { spoken: true }
}

type VoiceStreamResult = {
  mime?: string
  streamed?: boolean
  cached?: boolean
  fallback?: VoiceSpeech
  warning?: string
}

/**
 * v11.10.0 : la voix locale diffuse son PCM AU FUR ET À MESURE — le renderer joue
 * dès le premier paquet (~270 ms mesuré) au lieu d'attendre la synthèse complète.
 * Aucun découpage par phrase : les paquets du moteur font ~0,55 s.
 *
 * Si rien n'a été joué quand le moteur échoue, le repli (voix Windows, toujours
 * dit) est rendu à l'appelant : le renderer le joue comme avant. Si l'audio avait
 * commencé, on ne relance pas une seconde voix — cela produirait un doublon.
 */
async function streamWithVoice(text: string, voiceName: string, streamId: string): Promise<VoiceStreamResult> {
  const clean = String(text ?? "").trim()
  if (!clean) return {}
  const route = resolveVoiceRoute({ voiceName })
  // v11.10.0 : Pocket TTS diffuse des échantillons nus, que la webview empile
  // dans un AudioContext. Le lecteur est préparé côté renderer AVANT l'appel
  // (voiceAgentStreamKind), donc l'abonné existe quand la première trame part.
  if (route.kind === "pocket") {
    const controller = new AbortController()
    activeStreams.set(streamId, () => controller.abort())
    let sent = 0
    try {
      const spoken = applyPronunciations(sanitizeSpeechText(clean), "pocket")
      if (!spoken) return {}
      sent = await streamPocketSpeech(spoken, streamId, controller.signal)
      if (!sent) throw new Error("Le moteur Pocket TTS n'a renvoyé aucun audio.")
      push({ type: "voice.stream.end", data: { streamId, mime: POCKET_PCM_MIME } })
      return { mime: POCKET_PCM_MIME, streamed: true }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      // Une interruption volontaire ne déclenche aucune voix de repli.
      if (controller.signal.aborted) return {}
      if (sent > 0) {
        // Ce qui a été reçu est déjà en lecture : on livre la fin avant de dire
        // l'erreur, sinon la phrase resterait coupée en silence.
        push({ type: "voice.stream.error", data: { streamId, message } })
        return { mime: POCKET_PCM_MIME, streamed: true, warning: message }
      }
      const speech = await speakWithLocalVoiceFallback(clean, pocketUnavailableReason(message))
      return { fallback: speech, warning: speech.warning ?? message }
    } finally {
      activeStreams.delete(streamId)
    }
  }
  // v11.14.0 : tout ce qui n'est pas Pocket est joué d'un bloc (voix Windows) :
  // le flux audio n'existe plus que pour le PCM du moteur local.
  const speech = await sayWithVoice(clean, voiceName)
  return { fallback: speech, warning: speech.warning }
}

let appState: AppState = {
  status: "starting",
  keys: Object.fromEntries(PROVIDERS.map((p) => [p.id, false])),
  providers,
  needsWorkspace: true,
}

const send = (message: Record<string, unknown>) => process.stdout.write(JSON.stringify(message) + "\n")
const push = (event: EngineEvent) => {
  send({ jsonrpc: "2.0", method: "app.event", params: event })
  const candidate = event as unknown as { type?: string; data?: Record<string, unknown> }
  if (candidate.type) trace(candidate.type)
  if (candidate.type && candidate.data) announcer.handle({ type: candidate.type, data: candidate.data })
}

function requireReady() {
  if (!ops) throw new Error("Le runtime Aven n'est pas prêt.")
  return ops
}

function requireWorkspace() {
  if (!workspace) throw new Error("Choisis d'abord un espace de travail.")
  return workspace
}

// ── v11.9.0 : actions de l'agent vocal ──────────────────────────────────────
// La cible se résout PAR NOM (« renomme la conversation Pricing ») : le host ne
// connaît pas « l'objet sélectionné ». Une correspondance multiple rend une
// question, jamais un choix arbitraire — une devinette silencieuse écrirait dans
// la mauvaise note.

type ResolvedTarget =
  | { ok: true; row: { id: string; title: string } }
  | { ok: false; text: string }

async function resolveChatTarget(action: AgentAction, query: string): Promise<ResolvedTarget> {
  const rows = (await (requireReady() as any).chats(undefined, true)) as { id: string; title: string }[]
  const match = matchActionTarget(rows, query)
  if (!match) return { ok: false, text: actionNotFoundText(action, query) }
  if ("ambiguous" in match) return { ok: false, text: actionAmbiguityText(action, query, match.ambiguous) }
  return { ok: true, row: match.hit }
}

function resolveNoteTarget(action: AgentAction, query: string): ResolvedTarget {
  const rows = listNotes(requireWorkspace()).map((row) => ({ id: row.id, title: row.title }))
  const match = matchActionTarget(rows, query)
  if (!match) return { ok: false, text: actionNotFoundText(action, query) }
  if ("ambiguous" in match) return { ok: false, text: actionAmbiguityText(action, query, match.ambiguous) }
  return { ok: true, row: match.hit }
}

/**
 * Exécute une action du catalogue. Les lectures et écritures s'exécutent ici ;
 * une destruction ne s'exécute JAMAIS : elle rend sa cible résolue, que le host
 * garde en attente jusqu'à un « oui » oral.
 */
async function performVoiceAgentAction(action: AgentAction, args: Record<string, string>): Promise<VoiceActionOutcome> {
  // v11.9.0 : le moteur n'est lu que par les actions qui en ont besoin — le
  // journal et les notes restent disponibles même s'il redémarre.
  switch (action.name) {
    case "list_chats": {
      const rows = (await (requireReady() as any).chats(undefined, true)) as { id: string; title: string; agent?: string; archived?: boolean }[]
      const shown = rows.slice(0, CHAT_LIST_LIMIT)
      if (!shown.length) return { status: "done", spoken: "Aucune conversation dans cet espace." }
      const lines = shown.map((row, index) => `${index + 1}. ${row.title}${row.archived ? " (archivée)" : ""}`)
      return { status: "done", spoken: `Conversations (${shown.length}) :\n${lines.join("\n")}` }
    }
    case "recent_actions":
      return { status: "done", spoken: formatAgentLog(agentLog) }
    case "rename_chat": {
      const found = await resolveChatTarget(action, args.chat)
      if (!found.ok) return { status: "refused", text: found.text }
      await (requireReady() as any).renameChat(found.row.id, args.title)
      return { status: "done", spoken: actionDonePhrase(action, found.row.title, `son nouveau titre est « ${args.title} »`) }
    }
    case "create_chat": {
      // v11.9.0 : un agent inconnu n'est pas remplacé par « projet » en silence —
      // créer la conversation du mauvais agent serait une erreur invisible.
      const choice = resolveAgentName(args.agent)
      if (!choice.ok) return { status: "refused", text: choice.text }
      const chat = await (requireReady() as any).createChat(choice.agent)
      return { status: "done", spoken: actionDonePhrase(action, String(chat.title ?? "Nouvelle conversation"), `agent « ${choice.agent} »`) }
    }
    case "archive_chat": {
      const found = await resolveChatTarget(action, args.chat)
      if (!found.ok) return { status: "refused", text: found.text }
      await (requireReady() as any).archiveChat(found.row.id, true)
      return { status: "done", spoken: actionDonePhrase(action, found.row.title) }
    }
    case "pin_note": {
      const found = resolveNoteTarget(action, args.note)
      if (!found.ok) return { status: "refused", text: found.text }
      const pinned = togglePin(requireWorkspace(), found.row.id)
      const state = pinned.includes(found.row.id) ? "épinglée" : "détachée"
      return { status: "done", spoken: `C'est fait : la note « ${found.row.title} » est ${state}.` }
    }
    case "move_note": {
      const found = resolveNoteTarget(action, args.note)
      if (!found.ok) return { status: "refused", text: found.text }
      const folder = cleanFolder(args.folder)
      moveNote(requireWorkspace(), found.row.id, folder)
      return { status: "done", spoken: actionDonePhrase(action, found.row.title, folder ? `rangée dans « ${folder} »` : "revenue à la racine") }
    }
    case "archive_note": {
      const found = resolveNoteTarget(action, args.note)
      if (!found.ok) return { status: "refused", text: found.text }
      archiveNote(requireWorkspace(), found.row.id)
      return { status: "done", spoken: actionDonePhrase(action, found.row.title) }
    }
    case "create_folder": {
      const folder = cleanFolder(args.folder)
      if (!folder) return { status: "refused", text: "Nom de dossier invalide : donne un chemin relatif, sans « .. »." }
      createFolder(requireWorkspace(), folder)
      return { status: "done", spoken: actionDonePhrase(action, folder) }
    }
    case "create_note":
      // v11.15.0 : le modèle PROPOSE une note au lieu de répondre qu'il ne peut
      // pas. Le contenu est relu par actionConfirmationText, et l'écriture n'a
      // lieu qu'après le « oui » classé par le renderer.
      return { status: "confirm", label: args.title, args: { title: args.title, content: args.content } }
    case "delete_chat": {
      const found = await resolveChatTarget(action, args.chat)
      if (!found.ok) return { status: "refused", text: found.text }
      return { status: "confirm", label: found.row.title, args: { chat: found.row.id } }
    }
    case "trash_note": {
      const found = resolveNoteTarget(action, args.note)
      if (!found.ok) return { status: "refused", text: found.text }
      return { status: "confirm", label: found.row.title, args: { note: found.row.id } }
    }
  }
  return { status: "refused", text: `Action non exécutée : « ${action.name} » n'a pas d'exécutant.` }
}

/**
 * Exécute une action puis la journalise. Le journal ne retient que ce qui a été
 * FAIT (une écriture exécutée, une destruction confirmée) — jamais une
 * proposition en attente, sinon « qu'est-ce que tu viens de faire ? » mentirait.
 */
async function runVoiceAgentAction(action: AgentAction, args: Record<string, string>): Promise<VoiceActionOutcome> {
  const outcome = await performVoiceAgentAction(action, args)
  if (outcome.status === "done" && action.risk !== "read") {
    pushAgentLog({ at: Date.now(), name: action.name, label: action.label, ok: true, spoken: outcome.spoken })
  }
  return outcome
}

/** Le SEUL point d'exécution d'une action proposée — appelé après un « oui » oral. */
async function commitVoiceAction(action: AgentAction, label: string, args: Record<string, string>): Promise<{ text: string; noteId?: string }> {
  switch (action.name) {
    case "create_note": {
      // v11.15.0 : la note proposée est écrite ici, et seulement ici. L'identifiant
      // remonte au renderer pour l'afficher — un écrit qui n'est pas visible est
      // une parole en l'air.
      const note = quickCapture(requireWorkspace(), args.title, args.content)
      return { text: actionDonePhrase(action, note.title), noteId: note.id }
    }
    case "delete_chat":
      await (requireReady() as any).deleteChat(args.chat)
      return { text: actionDonePhrase(action, label) }
    case "trash_note":
      deleteNote(requireWorkspace(), args.note)
      return { text: actionDonePhrase(action, label) }
  }
  throw new Error(`Action « ${action.name} » sans exécution confirmée.`)
}

function settingsPath() {
  const root = process.env.AVEN_USER_DATA_DIR || path.join(process.env.APPDATA || process.cwd(), "Aven")
  mkdirSync(root, { recursive: true })
  return path.join(root, "settings.json")
}

function protectWindows(value: string, unprotect: boolean): string | undefined {
  if (process.platform !== "win32") return undefined
  // v10.2.1 : `System.Security.Cryptography.ProtectedData` vit dans System.Security.dll,
  // que Windows PowerShell n'importe PAS automatiquement sur certains postes. Sans ce
  // Add-Type, l'enregistrement d'une clé échouait sur « Le chiffrement Windows de la
  // clé a échoué. » (constaté en pilotant le host : type introuvable). Le format DPAPI
  // et les clés déjà stockées ne changent pas — seul le chargement de l'assembly est
  // désormais explicite.
  const load = "Add-Type -AssemblyName System.Security;"
  const script = unprotect
    ? load + "$raw=[Console]::In.ReadToEnd();$data=[Convert]::FromBase64String($raw.Trim());$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))"
    : load + "$raw=[Console]::In.ReadToEnd();$data=[Text.Encoding]::UTF8.GetBytes($raw);$cipher=[System.Security.Cryptography.ProtectedData]::Protect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($cipher))"
  try {
    return String(execFileSync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      script,
    ], {
      input: value,
      encoding: "utf8",
      timeout: 5000,
      windowsHide: true,
    })).trim()
  } catch (error) {
    // v10.2.1 : renvoyait undefined en silence — l'appelant n'avait qu'un message
    // générique. On garde le repli, on laisse la cause réelle sur stderr.
    console.error(`[aven] DPAPI ${unprotect ? "déchiffrement" : "chiffrement"} impossible :`, (error as Error).message.split("\n")[0])
    return undefined
  }
}

// v10.2.1 : settings.json porte les clés chiffrées DPAPI. Il était écrit par un
// writeFileSync direct (troncature en place) : un crash pendant l'écriture laissait
// un JSON partiel, que loadKeys avalait en silence — les clés « disparaissaient ».
// Écriture atomique (temp + rename) et copie .bak du dernier état lisible.
function writeSettings(value: unknown) {
  const file = settingsPath()
  if (existsSync(file)) {
    // Ne jamais écraser un .bak par un fichier déjà illisible : la copie de secours
    // ne doit contenir qu'un état qu'on peut réellement restaurer (sinon elle donne
    // une fausse assurance au moment où on en a besoin).
    let restorable = false
    try {
      JSON.parse(readFileSync(file, "utf8"))
      restorable = true
    } catch {}
    if (restorable) {
      try {
        copyFileSync(file, `${file}.bak`)
      } catch (error) {
        // Une sauvegarde ratée ne doit pas empêcher l'enregistrement de la nouvelle clé.
        console.error("[aven] copie .bak de settings.json impossible :", (error as Error).message)
      }
    }
  }
  writeTextAtomic(file, JSON.stringify(value, null, 2) + "\n")
}

// v11.5.2 : le déchiffrement DPAPI (PowerShell, ~580 ms par clé) était refait à
// chaque requête vocale — deux clés × deux appels (STT puis LLM) ≈ 2,3 s par
// tour, mesuré. Le clair vit désormais en mémoire du host, jamais renvoyé au
// renderer, et il est invalidé dès que settings.json change.
function decryptProviderKey(providerId: string): string | undefined {
  const provider = PROVIDERS.find((entry) => entry.id === providerId)
  if (!provider) return undefined
  let stored: { keysEnc?: Record<string, string>; openrouterKeyEnc?: string } = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8")) as typeof stored
  } catch (error) {
    // v10.2.1 : le silence rendait la perte invisible. ENOENT = premier lancement,
    // donc légitime ; tout le reste (JSON tronqué, droits) laisse une trace.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[aven] settings.json illisible, clés non rechargées :", (error as Error).message)
    }
  }
  // v11.3.0 : la liste des fournisseurs était recopiée ici ET dans saveKey —
  // un fournisseur de plus demandait trois modifications pour une seule clé.
  // PROVIDERS (host/providers.ts) est désormais la source unique du stockage.
  const encrypted = stored.keysEnc?.[providerId] || (providerId === "openrouter" ? stored.openrouterKeyEnc : undefined)
  const value = encrypted ? protectWindows(encrypted, true) : undefined
  if (value) return value
  return process.env[provider.env]?.trim() || undefined
}

const keyCache = createKeyCache(decryptProviderKey)
let settingsStamp: number | null = null

function currentSettingsStamp(): number {
  try { return statSync(settingsPath()).mtimeMs } catch { return 0 }
}

/**
 * Une clé en clair, relue seulement si settings.json a changé. Le statut du
 * fichier est vérifié à chaque accès : une clé modifiée hors de l'app (édition
 * manuelle) ne reste pas servie depuis le cache.
 */
function cachedKey(providerId: string): string | undefined {
  const stamp = currentSettingsStamp()
  if (stamp !== settingsStamp) {
    keyCache.clear()
    settingsStamp = stamp
  }
  return keyCache.get(providerId)
}

function loadKeys() {
  const out: Record<string, string> = {}
  for (const provider of PROVIDERS) {
    const value = cachedKey(provider.id)
    if (value) out[provider.env] = value
  }
  return out
}

function saveKey(provider: string, key: string) {
  // v11.3.0 : même source unique que loadKeys — plus de correspondance recopiée.
  const envName = PROVIDERS.find((p) => p.id === provider)?.env
  if (!envName) throw new Error("Fournisseur inconnu.")
  const clean = String(key ?? "").trim()
  if (clean && process.platform !== "win32") {
    throw new Error("Le stockage sécurisé des clés n'est disponible que sur Windows.")
  }

  let stored: { keysEnc?: Record<string, string>; openrouterKeyEnc?: string; voiceCloneTokenEnc?: string } = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8")) as typeof stored
  } catch {}

  const keysEnc = { ...(stored.keysEnc ?? {}) }
  if (clean) {
    const encrypted = protectWindows(clean, false)
    if (!encrypted) throw new Error("Le chiffrement Windows de la clé a échoué.")
    keysEnc[provider] = encrypted
  } else {
    delete keysEnc[provider]
  }

  const next: typeof stored = { keysEnc }
  if (provider !== "openrouter" && stored.openrouterKeyEnc && !keysEnc.openrouter) {
    next.openrouterKeyEnc = stored.openrouterKeyEnc
  }
  // v11.11.0 : le jeton du clonage de voix vit dans le même fichier — enregistrer
  // une clé d'API ne doit pas l'effacer (le contraire est vrai aussi).
  if (stored.voiceCloneTokenEnc) next.voiceCloneTokenEnc = stored.voiceCloneTokenEnc
  writeSettings(next)
  // v11.5.2 : la clé vient de changer — le cache ne doit jamais resservir l'ancienne.
  keyCache.clear()
  settingsStamp = currentSettingsStamp()
}

/**
 * v11.11.0 : jeton Hugging Face du clonage de voix — un secret, donc chiffré
 * DPAPI comme les clés d'API et JAMAIS renvoyé au renderer (seul son booléen
 * remonte). Il ne sert qu'une fois : au premier téléchargement du modèle de
 * clonage, dont l'accès est soumis à conditions. L'app télécharge elle-même dans
 * ses propres données, mais elle ne peut pas accepter ces conditions à ta place.
 */
function voiceCloneToken(): string | undefined {
  let stored: { voiceCloneTokenEnc?: string } = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8")) as typeof stored
  } catch {
    // Premier lancement : aucun jeton, et ce n'est pas une erreur.
  }
  const encrypted = stored.voiceCloneTokenEnc
  return encrypted ? protectWindows(encrypted, true) : undefined
}

function saveVoiceCloneToken(token: string): boolean {
  const clean = String(token ?? "").trim()
  if (clean && process.platform !== "win32") {
    throw new Error("Le stockage sécurisé des clés n'est disponible que sur Windows.")
  }
  let stored: { keysEnc?: Record<string, string>; openrouterKeyEnc?: string; voiceCloneTokenEnc?: string } = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8")) as typeof stored
  } catch {
    // Premier lancement : le fichier se crée ici.
  }
  const next = { ...stored }
  if (clean) {
    const encrypted = protectWindows(clean, false)
    if (!encrypted) throw new Error("Le chiffrement Windows du jeton a échoué.")
    next.voiceCloneTokenEnc = encrypted
  } else {
    delete next.voiceCloneTokenEnc
  }
  writeSettings(next)
  trace(clean ? "jeton de clonage enregistré" : "jeton de clonage effacé")
  return Boolean(clean)
}

const execFileAsync = promisify(execFile)

let ptyBatch = ""
let ptyBatchTimer: ReturnType<typeof setTimeout> | null = null

function flushPtyBatch() {
  if (ptyBatchTimer) {
    clearTimeout(ptyBatchTimer)
    ptyBatchTimer = null
  }
  if (!ptyBatch) return
  const chunk = ptyBatch
  ptyBatch = ""
  push({ type: "freebuff.pty.data", data: { chunk } })
}

function queuePtyData(chunk: string) {
  ptyBatch += chunk
  if (ptyBatch.length >= 8 * 1024) flushPtyBatch()
  else if (!ptyBatchTimer) ptyBatchTimer = setTimeout(flushPtyBatch, 30)
}

async function checkFreebuffCli() {
  if (process.platform !== "win32") return { installed: false }
  try {
    const result = await execFileAsync("cmd.exe", ["/d", "/s", "/c", "freebuff --version"], {
      timeout: 8_000,
      windowsHide: true,
      maxBuffer: 256 * 1024,
    })
    return parseVersionOutput(String(result.stdout ?? ""), String(result.stderr ?? ""))
  } catch (error: any) {
    return parseVersionOutput(String(error?.stdout ?? ""), String(error?.stderr ?? ""))
  }
}

// v10.3.0 : UNE installation, au démarrage, vérifiée par « freebuff --version ».
// Le gestionnaire est unique pour tout le host : App (démarrage), Réglages et la
// page Freebuff passent tous par lui, donc plus d'installations concurrentes.
async function installFreebuffCli(): Promise<void> {
  if (process.platform !== "win32") throw new Error("Le CLI Freebuff n'est installable automatiquement que sous Windows.")
  if (!(await checkNpm())) throw new Error("npm est introuvable sur cet ordinateur. Installe Node.js avec npm, puis réessaie.")
  const cmd = buildInstallCommand()
  try {
    // 180 s : npm global + téléchargement du paquet ; au-delà, on considère l'échec.
    await execFileAsync(cmd.command, cmd.args, { timeout: 180_000, windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
  } catch (error) {
    const detail = String((error as { stderr?: string }).stderr ?? "").trim().split("\n").slice(-2).join(" ").slice(0, 300)
    throw new Error(detail || (error as Error).message)
  }
}

const cliManager = createCliManager({
  check: checkFreebuffCli,
  install: installFreebuffCli,
  // L'état d'installation remonte au renderer : la pastille du hub et la page
  // Freebuff n'ont plus à sonder chacun de leur côté.
  onChange: (snapshot) => push({ type: "freebuff.cli.state", data: { ...snapshot } }),
})

async function checkNpm() {
  if (process.platform !== "win32") return false
  try {
    await execFileAsync("cmd.exe", ["/d", "/s", "/c", "npm --version"], {
      timeout: 8_000,
      windowsHide: true,
    })
    return true
  } catch {
    return false
  }
}

async function isFreebuffProcessRunning() {
  if (process.platform !== "win32") return false
  try {
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name='freebuff.exe'\" | Where-Object { $_.ExecutablePath -like '*\\.config\\manicode*' } | Select-Object -First 1 ProcessId | ForEach-Object { $_.ProcessId }",
    ], { timeout: 10_000, windowsHide: true })
    const pids = String(result.stdout ?? "").split(/\r?\n/).map((line) => line.trim()).filter((line) => /^\d+$/.test(line))
    return pids.some((pid) => Number(pid) !== freebuffPtyPid())
  } catch {
    return false
  }
}

async function isFreebuffDesktopRunning() {
  if (process.platform !== "win32") return false
  try {
    const result = await execFileAsync("powershell.exe", [
      "-NoProfile",
      "-NonInteractive",
      "-Command",
      "Get-CimInstance Win32_Process -Filter \"name='freebuff.exe'\" | Where-Object { $_.ExecutablePath -like '*codebufffreebuff-desktop*' } | Select-Object -First 1 -ExpandProperty ProcessId",
    ], { timeout: 10_000, windowsHide: true })
    return /\d+/.test(String(result.stdout ?? ""))
  } catch {
    return false
  }
}

async function launchFreebuff(action: "launch" | "login", cols?: number, rows?: number) {
  if (process.platform !== "win32") {
    throw new Error("Le terminal Freebuff n'est pris en charge que sous Windows.")
  }

  // v10.3.0 : l'installation n'est plus une action de lancement — elle vit dans le
  // gestionnaire unique (freebuffCliEnsure), vérifiée et sans fenêtre détachée.
  const status = await checkFreebuffCli()
  if (!status.installed) throw new Error(freebuffMissingMessage())
  if (!isFreebuffPtyActive() && await isFreebuffProcessRunning()) throw new Error(freebuffBusyMessage())

  if (action === "launch") {
    if (await isFreebuffDesktopRunning()) {
      throw new Error("L'application Freebuff Desktop est ouverte : elle tient la session du compte. Ferme-la avant de lancer le terminal intégré.")
    }

    const runtimeDir = dirname(fileURLToPath(import.meta.url))
    await loadPtyModule(false, runtimeDir)

    const result = startFreebuffPty({
      cwd: requireWorkspace(),
      cols: cols ?? DEFAULT_PTY_COLS,
      rows: rows ?? DEFAULT_PTY_ROWS,
      trustAgents: existsSync(path.join(requireWorkspace(), ".agents", "aven-code.ts")),
      resume: loadPrefs().freebuffResume === true,
      handlers: {
        onData: queuePtyData,
        onStatus: (state) => {
          flushPtyBatch()
          push({ type: "freebuff.pty.status", data: { state } })
        },
        onExit: (code, signal) => {
          flushPtyBatch()
          push({ type: "freebuff.pty.exit", data: { code, signal } })
        },
        onError: (message) => {
          flushPtyBatch()
          push({ type: "freebuff.pty.error", data: { message } })
        },
      },
    })

    if (result.replay) push({ type: "freebuff.pty.replay", data: { buffer: result.replay } })
    return true
  }

  const cmd = buildLaunchCommand(requireWorkspace(), action)
  const child = spawn(cmd.command, cmd.args, { detached: true, stdio: "ignore", windowsHide: false })
  child.unref()
  return true
}

function prefsPath() {
  const root = process.env.AVEN_USER_DATA_DIR || path.join(process.env.APPDATA || process.cwd(), "Aven")
  mkdirSync(root, { recursive: true })
  return path.join(root, "prefs.json")
}

// v11.1.0 : prefs.json porte aussi le choix de voix et le micro de l'agent
// vocal. Les champs inconnus d'une ancienne version retombent sur leurs défauts ;
// aucune valeur n'est devinée à partir de l'état du système.
type AppPrefs = {
  notifications: boolean
  freebuffResume: boolean
  voiceName: string
  voicePersonality: VoicePersonality
  micMuted: boolean
}

type PrefsPatch = {
  notifications?: boolean
  freebuffResume?: boolean
  voiceName?: string
  voicePersonality?: unknown
  micMuted?: boolean
}

// v11.8.0 : deux voix locales sont livrées ; la première installée devient le
// défaut pour que le menu et la parole restent d'accord.
// v11.14.0 : une seule pile — Pocket TTS s'il est là, sinon chaîne vide, ce qui
// fait parler la voix Windows. Le repli ne doit jamais rendre muet.
function defaultVoiceName(): string {
  if (pocketDir()) return pocketVoiceId(pocketProfile())
  return ""
}

function loadPrefs(): AppPrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as {
      notifications?: unknown; freebuffResume?: unknown; voiceName?: unknown; voicePersonality?: unknown; micMuted?: unknown
    }
    const stored = typeof raw.voiceName === "string" ? raw.voiceName.trim().slice(0, 120) : ""
    return {
      notifications: raw.notifications !== false,
      freebuffResume: raw.freebuffResume === true,
      // v11.10.0 : une préférence Pocket est recalée sur la voix réellement
      // installée — clonée si son profil est là, intégrée sinon.
      voiceName: normalizePocketPreference(pocketProfile(), stored) || defaultVoiceName(),
      voicePersonality: normalizeVoicePersonality(raw.voicePersonality),
      micMuted: raw.micMuted === true,
    }
  } catch (error) {
    // v10.2.1 : même piège que settings.json — un prefs.json tronqué remettait
    // notifications à ON sans le dire. Le repli reste, la trace aussi.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[aven] prefs.json illisible, préférences par défaut :", (error as Error).message)
    }
    return { notifications: true, freebuffResume: false, voiceName: defaultVoiceName(), voicePersonality: "neutre", micMuted: false }
  }
}

function savePrefs(next: PrefsPatch): AppPrefs {
  const current = loadPrefs()
  const value: AppPrefs = {
    notifications: next.notifications ?? current.notifications,
    freebuffResume: next.freebuffResume ?? current.freebuffResume,
    voiceName: typeof next.voiceName === "string" ? next.voiceName.trim().slice(0, 120) : current.voiceName,
    voicePersonality: next.voicePersonality === undefined ? current.voicePersonality : normalizeVoicePersonality(next.voicePersonality),
    micMuted: next.micMuted ?? current.micMuted,
  }
  // v10.2.1 : écriture atomique, comme les autres métadonnées de l'app.
  writeTextAtomic(prefsPath(), JSON.stringify(value, null, 2) + "\n")
  return value
}

async function shutdown() {
  await engine?.stop()
  stopVoiceSpeech()
  stopPocketServer()
  voiceHistory = []
  engine = null
  ops = null
  engineState = {}
  engineChains = {}
}

async function initialize(params: {
  workspace: string
  templateDir: string
  env?: Record<string, string>
  openRouterUsable?: boolean
  keyWarnings?: Record<string, string>
  binPath?: string
  binShell?: boolean
}) {
  const nextWorkspace = join(String(params?.workspace || ""))
  if (!nextWorkspace) throw new Error("workspace requis")
  workspace = nextWorkspace
  templateDir = join(String(params?.templateDir || process.cwd()))

  await shutdown()

  // v10.0.0 : conserver les retours de synchronisation que l'ancien boot Electron transmettait aux réglages.
  const seed = seedWorkspace(workspace, templateDir)
  let agentsBridgeWritten: string[] = []
  try {
    agentsBridgeWritten = buildAgentsDir(
      workspace,
      readTemplateAgents(templateDir),
      join(templateDir, "aven-mcp-server.mjs"),
    )
  } catch {
    // Le pont agents est best effort (toujours, depuis l'origine).
  }

  const storedEnv = loadKeys()
  const effectiveEnv = { ...storedEnv, ...(params.env ?? {}) }
  for (const [id, envName] of [["openrouter", "OPENROUTER_API_KEY"], ["groq", "GROQ_API_KEY"]] as const) {
    if (storedEnv[envName]) effectiveEnv[envName] = storedEnv[envName]
  }

  // v10.0.0 : préserver le contrôle de clé OpenRouter de la version Electron.
  const keyWarnings: Record<string, string> = { ...(params.keyWarnings ?? {}) }
  let openRouterUsable = params.openRouterUsable !== false
  if (storedEnv.OPENROUTER_API_KEY) {
    const probe = await probeOpenRouterKey(storedEnv.OPENROUTER_API_KEY)
    if (probe.status === "invalid") {
      openRouterUsable = false
      keyWarnings.openrouter = `Clé OpenRouter refusée : ${probe.message} Remplace-la dans Paramètres.`
    } else if (probe.status === "unknown") {
      keyWarnings.openrouter = probe.message
    }
  }

  const bin = params.binPath
    ? { command: String(params.binPath), shell: Boolean(params.binShell), source: "Tauri resource" }
    : resolveOpenCodeBin()
  const runtimeDir = dirname(fileURLToPath(import.meta.url))
  engine = new EngineClient({
    hostPath: join(runtimeDir, "aven-engine-host.mjs"),
    runAsNode: false,
    nodeExecPath: process.execPath,
    cwd: workspace,
    onEvent: push,
    onHostError: (err) => push({ type: "engine.host.error", data: { message: err.message } }),
    onHostExit: (code) => push({ type: "engine.host.exit", data: { code } }),
  })

  engineState = await engine.call("initialize", {
    workspace,
    env: effectiveEnv,
    prioritiesPath: join(workspace, "model-priorities.json"),
    templatePrioritiesPath: join(templateDir, "model-priorities.json"),
    excludeProvider: openRouterUsable ? undefined : "openrouter",
    binPath: bin.command,
    binShell: bin.shell,
  })

  engineChains = (engineState.assignments ?? {}) as typeof engineChains

  // v10.0.0 : avertir aussi quand une clé existe mais qu'aucun modèle du fournisseur n'est actif.
  const activeProviders = new Set(
    Array.isArray(engineState.activeProviders) ? engineState.activeProviders.map(String) : [],
  )
  for (const provider of PROVIDERS) {
    if (provider.openCodeEnv === false) continue
    if (effectiveEnv[provider.env] && !keyWarnings[provider.id] && !activeProviders.has(provider.id)) {
      keyWarnings[provider.id] = "Clé enregistrée, mais aucun modèle actif détecté pour ce fournisseur — vérifie qu'elle est valide."
    }
  }

  const sdk = sdkProxy(() => engine!) as unknown as Bridge["client"]
  const engineBridge = {
    client: sdk,
    get workspace() {
      return workspace
    },
    loadNames: (ws: string) => loadNames(ws),
    archived: (ws: string) => listArchived(ws),
    get chains() {
      return engineChains
    },
    get router() {
      return {
        pick: (agent: string) => engineChains[agent]?.[0]?.ref,
        beforeSend: async (sessionID: string, text: string) => {
          await engine!.call("router.beforeSend", { sessionID, text })
        },
        forget: (sessionID: string) => {
          void engine!.call("router.forget", { sessionID }).catch(() => undefined)
        },
      }
    },
  } as unknown as BridgeHost

  ops = makeOps(() => engineBridge)
  appState = {
    status: "ready",
    keys: Object.fromEntries(
      PROVIDERS.map((p) => [p.id, !!effectiveEnv[p.env]]),
    ),
    providers,
    workspace,
    sync: seed.sync,
    newModels: seed.newModels,
    removedModels: seed.removedModels,
    agentsBridge: agentsBridgeWritten,
    assignments: engineState.assignments as AppState["assignments"],
    version: String(engineState.version ?? ""),
    cli: String(engineState.binSource ?? ""),
    warning: engineState.warning as string | undefined,
    versionWarning: engineState.versionWarning as string | undefined,
    keyWarnings,
  }

  return appState
}

async function dispatch(method: string, params: any): Promise<unknown> {
  switch (method) {
    case "ping":
      return { alive: true, initialized: !!ops }
    case "state":
      return appState
    case "setKey": {
      saveKey(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
      return initialize({
        workspace,
        templateDir,
        env: loadKeys(),
        openRouterUsable: true,
      })
    }
    case "initialize":
      return initialize(rpcObjectParam<Parameters<typeof initialize>[0]>(params))
    case "shutdown":
      await shutdown()
      stopFreebuffPty()
      appState = {
        status: "starting",
        keys: Object.fromEntries(PROVIDERS.map((p) => [p.id, false])),
        providers,
        needsWorkspace: true,
      }
      return { stopped: true }
    case "workspace:seed": {
      const p = rpcObjectParam<{ workspace?: string; templateDir?: string }>(params)
      if (!p?.workspace || !p?.templateDir) throw new Error("workspace et templateDir requis")
      return seedWorkspace(join(p.workspace), join(p.templateDir))
    }
    case "agents:bridge": {
      const p = rpcObjectParam<{ workspace?: string; templateDir?: string }>(params)
      if (!p?.workspace || !p?.templateDir) throw new Error("workspace et templateDir requis")
      return {
        written: buildAgentsDir(
          join(p.workspace),
          readTemplateAgents(join(p.templateDir)),
          join(join(p.templateDir), "aven-mcp-server.mjs"),
        ),
      }
    }
    // v11.1.0 : agent vocal — canal distinct de la dictée. Le mot d'activation
    // est interprété côté host (une seule implémentation, testée) ; le renderer
    // exécute l'action et orchestre la lecture phrase par phrase.
    case "voiceAgentPrefs": {
      const p = loadPrefs()
      return { voiceName: p.voiceName, personality: p.voicePersonality, micMuted: p.micMuted }
    }
    case "setVoiceAgentPrefs": {
      const patch = rpcObjectParam<{ voiceName?: string; personality?: unknown; micMuted?: boolean }>(params)
      const saved = savePrefs({
        voiceName: patch?.voiceName,
        voicePersonality: patch?.personality,
        micMuted: patch?.micMuted,
      })
      return { voiceName: saved.voiceName, personality: saved.voicePersonality, micMuted: saved.micMuted }
    }
    case "voiceAgentVoices": {
      const windows = process.platform === "win32"
        ? await listWindowsVoices(runPowerShell).catch(() => [])
        : []
      // v11.3.0 : identifiants préfixés — le renderer n'a pas à deviner d'où vient
      // chaque voix, et une préférence enregistrée en v11.1.0 (nom Windows brut)
      // reste lisible : resolveVoiceRoute la traite comme une voix SAPI.
      const ids: string[] = []
      // v11.10.0 : une seule voix Pocket est proposée — la clonée quand son
      // profil est posé, la voix intégrée sinon — et seulement si le binaire est
      // là : jamais un faux bouton.
      if (pocketDir()) ids.push(pocketVoiceId(pocketProfile()))
      for (const name of windows) ids.push(`sapi:${name}`)
      return ids
    }
    // v11.11.0 : clonage de voix DANS l'app. L'app télécharge elle-même le modèle
    // de clonage (209 Mo) dans ses données ; le jeton Hugging Face reste un secret
    // du host et ne remonte au renderer que sous forme de booléen.
    case "voiceCloneStatus":
      return {
        engine: !!pocketDir(),
        weights: pocketCloneWeightsReady(),
        profile: !!pocketProfile(),
        token: !!voiceCloneToken(),
      }
    case "setVoiceCloneToken":
      return { token: saveVoiceCloneToken(String(params?.[0] ?? "")) }
    case "voiceCloneFromAudio": {
      const { downloaded } = await cloneVoiceProfile(String(params?.[0] ?? ""))
      return { profile: true, voiceName: POCKET_CLONE_VOICE_ID, downloaded }
    }
    case "voiceCloneRemove":
      removeVoiceProfile()
      return { profile: false, voiceName: POCKET_VOICE_ID }
    case "voiceAgentTranscribe": {
      const bytes = Array.isArray(params?.[0])
        ? new Uint8Array(params[0].map((value: unknown) => Number(value) & 255))
        : new Uint8Array()
      // Un segment trop court ou vide n'est même pas envoyé : il ne consomme
      // aucun quota et ne produit aucun enregistrement.
      if (!bytes.length) return { text: "" }
      const mimeType = String(params?.[1] || "audio/webm")
      // v11.1.5 : le type MIME vient du Blob ; l'argument est la CLÉ (l'ordre était
      // inversé, donc la requête partait sans Authorization et Groq répondait 401).
      // v11.1.5 : la fonction rend déjà `{ text }` — la ré-emballer donnait
      // `{ text: { text } }`, donc le renderer recevait un objet, le convertissait en
      // « [object Object] » et ignorait la phrase SANS aucune erreur visible.
      return transcribeVoiceSegment(new Blob([bytes], { type: mimeType }), requireGroqKey(), fetch)
    }
    case "voiceAgentInterpret":
      // v11.14.1 : le renderer dit si Aven vient de poser une question — un
      // « oui » ou un « non » y répond alors, au lieu d'être pris pour du bruit.
      return interpretVoiceText(String(params?.[0] ?? ""), { expectsAnswer: params?.[1] === true })
    case "voiceAgentComposeNote": {
      // v11.16.0 : le contenu d'une note demandée est RÉDIGÉ, puis relu par le
      // renderer. Cet appel ne peut pas écrire : la seule écriture reste la
      // confirmation orale de la note dictée (onCreateNote).
      const demand = String(params?.[0] ?? "").trim()
      if (!demand) throw new Error("Aucune demande de note reçue.")
      return composeVoiceNote(demand, { apiKey: requireGroqKey() })
    }
    case "voiceAgentAsk": {
      const question = String(params?.[0] ?? "").trim()
      if (!question) throw new Error("Aucune demande vocale reçue.")
      // v11.9.0 : une nouvelle demande remplace la proposition précédente — une
      // confirmation oubliée ne doit pas survivre à un autre sujet.
      pendingVoiceAction = null
      const answer = await answerVoiceQuestion(question, {
        apiKey: requireGroqKey(),
        personality: loadPrefs().voicePersonality,
        history: voiceHistory,
        // v11.2.0 : outils de lecture. Le host possède déjà les notes et
        // l'état : aucun aller-retour vers le renderer n'est nécessaire, donc le
        // contrat IPC existant suffit. L'espace est nommé par son basename — le
        // chemin complet de la machine ne part pas chez le fournisseur distant.
        // v11.9.0 : `runAction` exécute les actions du catalogue côté host, avec
        // les mêmes garanties — la cible est résolue ici, jamais crue du modèle.
        run: createVoiceToolRunner({
          appState: () => ({
            workspace: workspace ? path.basename(workspace) : "",
            notes: workspace ? listNotes(workspace).length : 0,
            version: appState.version ?? "",
          }),
          searchNotes: (query) => searchNotes(requireWorkspace(), query),
          readNote: (id) => {
            const row = getNote(requireWorkspace(), id)
            return { id: row.id, title: row.title, markdown: row.markdown }
          },
          runAction: (action, args) => runVoiceAgentAction(action, args),
        }),
      })
      // v11.9.0 : une destruction proposée ouvre une confirmation orale. Le jeton
      // reste dans le host : le renderer ne peut que confirmer ce qui a été dit.
      const pending = answer.pending
      if (pending) {
        const token = randomUUID()
        pendingVoiceAction = { token, name: pending.name, args: pending.args, label: pending.label, askedAt: Date.now() }
      }
      // Contexte de session borné : six tours suffisent à suivre une conversation
      // orale, et rien n'est écrit sur disque.
      voiceHistory = [...voiceHistory, { role: "user" as const, content: question }, { role: "assistant" as const, content: answer.text }].slice(-6)
      return {
        text: answer.text,
        sentences: splitSentences(answer.text),
        ...(pending ? { pending: { token: pendingVoiceAction!.token, prompt: answer.text } } : {}),
      }
    }
    case "voiceAgentConfirmAction": {
      // v11.9.0 : exécution APRÈS un « oui » oral. Trois refus possibles et tous
      // parlés : jeton inconnu, décision périmée (45 s), action sans exécutant.
      const token = String(params?.[0] ?? "")
      const proposed = pendingVoiceAction
      pendingVoiceAction = null
      if (!proposed || !token || proposed.token !== token) {
        return { text: ACTION_NONE_PENDING_REPLY, sentences: splitSentences(ACTION_NONE_PENDING_REPLY) }
      }
      if (!actionConfirmationOpen(proposed.askedAt)) {
        return { text: ACTION_EXPIRED_REPLY, sentences: splitSentences(ACTION_EXPIRED_REPLY) }
      }
      const action = actionSpec(proposed.name)
      if (!action) {
        return { text: ACTION_EXECUTION_FAILED_REPLY, sentences: splitSentences(ACTION_EXECUTION_FAILED_REPLY) }
      }
      try {
        const done = await commitVoiceAction(action, proposed.label, proposed.args)
        const spoken = done.text
        pushAgentLog({ at: Date.now(), name: action.name, label: proposed.label, ok: true, spoken })
        voiceHistory = [...voiceHistory, { role: "assistant" as const, content: spoken }].slice(-6)
        return { text: spoken, sentences: splitSentences(spoken), ...(done.noteId ? { noteId: done.noteId } : {}) }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        const spoken = `${ACTION_EXECUTION_FAILED_REPLY} (${message})`
        pushAgentLog({ at: Date.now(), name: action.name, label: proposed.label, ok: false, spoken })
        return { text: spoken, sentences: splitSentences(spoken) }
      }
    }
    case "voiceAgentCancelAction": {
      // Un refus, un silence ou un « stop » ferme la proposition : plus rien ne
      // peut être confirmé après coup.
      const token = String(params?.[0] ?? "")
      if (pendingVoiceAction && (!token || pendingVoiceAction.token === token)) pendingVoiceAction = null
      return null
    }
    case "voiceAgentSpeak": {
      if (process.platform !== "win32") throw new Error("La voix Windows n'est disponible que sous Windows.")
      const text = String(params?.[0] ?? "")
      const voice = String(params?.[1] || loadPrefs().voiceName || "")
      // Une nouvelle phrase interrompt la précédente : jamais deux voix superposées.
      stopVoiceSpeech()
      await speakWithWindowsVoice(text, voice || undefined, runPowerShell)
      return null
    }
    case "voiceAgentSay":
      // v11.3.0 : une seule voie pour parler — la lecture réelle et l'aperçu des
      // Réglages passent par la même décision, sinon l'aperçu aurait toujours lu
      // avec la voix Windows même après avoir choisi une voix neuronale.
      return sayWithVoice(String(params?.[0] ?? ""), loadPrefs().voiceName)
    case "voiceAgentStreamKind":
      // v11.10.0 : le renderer prépare le bon lecteur (PCM pour Pocket) AVANT de
      // lancer la demande : un abonné créé après l'appel perdrait des trames
      // (mesuré en v11.5.3).
      return streamKindForVoice(loadPrefs().voiceName)
    case "voiceAgentSayStream":
      // v11.5.3 : le renderer fournit l'identifiant pour corréler les trames qu'il
      // reçoit par événements — l'appel, lui, ne rend la main qu'à la fin.
      return streamWithVoice(
        String(params?.[0] ?? ""),
        loadPrefs().voiceName,
        String(params?.[1] ?? ""),
      )
    case "voiceAgentPreview":
      return sayWithVoice(
        String(params?.[0] ?? "Bonjour, je suis l'agent vocal d'Aven. Voici ma voix."),
        String(params?.[1] ?? "") || loadPrefs().voiceName,
      )
    case "voiceAgentStop":
      // v11.5.3 : couper la lecture coupe aussi les synthèses en cours.
      for (const abort of activeStreams.values()) abort()
      activeStreams.clear()
      stopVoiceSpeech()
      return null
  }

  const api = requireReady() as any
  switch (method) {
    case "agents":
      return api.agents()
    case "chats":
      return api.chats(params?.[0] as string | undefined, Boolean(params?.[1]))
    case "createChat":
      return api.createChat(String(params?.[0] ?? ""))
    case "renameChat":
      return api.renameChat(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "deleteChat":
      return api.deleteChat(String(params?.[0] ?? ""))
    case "archiveChat":
      return api.archiveChat(String(params?.[0] ?? ""), Boolean(params?.[1]))
    case "setChatModel":
      return api.setChatModel(String(params?.[0] ?? ""), params?.[1] === undefined ? undefined : String(params[1]))
    case "modelChain":
      return api.chainFor(String(params?.[0] ?? ""))
    case "messages":
      return api.messages(String(params?.[0] ?? ""))
    case "send":
      return api.send(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "interrupt":
      return api.interrupt(String(params?.[0] ?? ""))
    case "reply":
      return api.reply(String(params?.[0] ?? ""), String(params?.[1] ?? ""), params?.[2])
    case "replyForm":
      return api.formReply(String(params?.[0] ?? ""), String(params?.[1] ?? ""), params?.[2] ?? {})
    case "cancelForm":
      return api.formCancel(String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "exportChat":
      return api.exportMarkdown(String(params?.[0] ?? ""))
    case "notesList":
      return listNotes(requireWorkspace())
    case "noteGet":
      return getNote(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteSave":
      return saveNote(requireWorkspace(), String(params?.[0] ?? ""), String(params?.[1] ?? ""), String(params?.[2] ?? ""))
    case "noteTogglePin":
      return togglePin(requireWorkspace(), String(params?.[0] ?? ""))
    case "notePins":
      return loadPinned(requireWorkspace())
    case "noteSetTags":
      return setTags(requireWorkspace(), String(params?.[0] ?? ""), Array.isArray(params?.[1]) ? params[1].map(String) : [])
    case "noteTags":
      return loadTags(requireWorkspace(), String(params?.[0] ?? ""))
    // v10.5.0 : l'arbre Notes lit toutes les étiquettes en un seul appel IPC.
    case "noteTagsAll":
      return loadAllTags(requireWorkspace())
    case "noteDir":
      return notesDir(requireWorkspace())
    case "filesList":
      return listWorkspaceDir(requireWorkspace(), String(params?.[0] ?? ""))
    case "filesRead":
      return readWorkspaceFile(requireWorkspace(), String(params?.[0] ?? ""))
    case "filesBreadcrumb":
      return breadcrumbOf(String(params?.[0] ?? ""))
    case "filesOpen":
      return safeResolveWorkspacePath(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteOpenFolder":
      return notesDir(requireWorkspace())
    // v10.1.0 : mode de tâche de l'orchestrateur.
    case "taskMode":
      return api.taskMode()
    case "setTaskMode":
      return api.setTaskMode(params?.[0])
    // v10.1.0 : notes façon Kortex — arbre, dossiers, poubelle, archive, liens, capture.
    case "notesTree":
      return notesTree(requireWorkspace())
    case "noteCreateFolder":
      return createFolder(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteRenameFolder":
      return renameFolder(requireWorkspace(), String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "noteDeleteFolder":
      return deleteFolder(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteMove":
      return moveNote(requireWorkspace(), String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "noteDelete":
      return deleteNote(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteRestore":
      return restoreNote(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteArchive":
      return archiveNote(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteUnarchive":
      return unarchiveNote(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteTrash":
      return listTrash(requireWorkspace())
    case "noteArchived":
      return listArchivedNotes(requireWorkspace())
    case "notePurge": {
      // v10.2.2 : la purge oublie aussi l'épinglage et les tags de la note — sinon
      // notes-meta.json gardait des ids fantômes après la suppression du fichier.
      const rel = purgeNote(requireWorkspace(), String(params?.[0] ?? ""))
      forgetNote(requireWorkspace(), rel)
      return rel
    }
    case "noteLinks":
      return noteLinks(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteBacklinks":
      return backlinks(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteSearch":
      return searchNotes(requireWorkspace(), String(params?.[0] ?? ""))
    case "noteQuickCapture":
      return quickCapture(requireWorkspace(), String(params?.[0] ?? ""), String(params?.[1] ?? ""))
    case "prefs":
      return loadPrefs()
    case "setNotifications":
      return savePrefs({ notifications: params?.[0] === true })
    case "setFreebuffResume":
      return savePrefs({ freebuffResume: params?.[0] === true })
    case "freebuffCliStatus": {
      // v10.3.0 : l'état du gestionnaire (installation en cours) complète la vérification.
      const status = await checkFreebuffCli()
      return { ...status, state: cliManager.status().state, cliError: cliManager.status().error }
    }
    // v10.3.0 : vérifie/installe le CLI une seule fois pour toute l'app (idempotent).
    case "freebuffCliEnsure":
      return cliManager.ensure(params?.[0] === true)
    case "freebuffCliLaunch":
      return launchFreebuff(
        (params?.[0] ?? "launch") as "launch" | "login",
        params?.[1] === undefined ? undefined : Number(params[1]),
        params?.[2] === undefined ? undefined : Number(params[2]),
      )
    case "freebuffPtyInput":
      writeFreebuffPty(String(params?.[0] ?? ""))
      return null
    case "freebuffPtyResize":
      resizeFreebuffPty(Number(params?.[0] ?? DEFAULT_PTY_COLS), Number(params?.[1] ?? DEFAULT_PTY_ROWS))
      return null
    case "freebuffPtySignal":
      signalFreebuffPty("SIGINT")
      return null
    case "freebuffPtyRestart":
      restartFreebuffPty()
      return null
    case "freebuffPtyActive":
      return isFreebuffPtyActive()
    case "freebuffDesktopRunning":
      return isFreebuffDesktopRunning()
    case "announcerActivity":
      lastUserActivity = Date.now()
      return null
    case "announcerSetEnabled":
      announcer.setEnabled(Boolean(params?.[0]))
      return announcer.isEnabled()
    case "announcerTest":
      await speakWithSapi(String(params?.[0] ?? "Annonce vocale activée.").slice(0, 200))
      return null
    case "voiceTranscribe": {
      const bytes = Array.isArray(params?.[0])
        ? new Uint8Array(params[0].map((value: unknown) => Number(value) & 255))
        : new Uint8Array()
      if (!bytes.length) throw new Error("Aucun audio reçu.")
      const mimeType = String(params?.[1] || "audio/webm")
      const result = await transcribeSpeech(
        new Blob([bytes], { type: mimeType }),
        fetch,
        // v11.5.2 : même cache que l'agent vocal — la dictée ne doit pas non plus
        // relancer quatre déchiffrements par requête.
        cachedKey("groq"),
      )
      try { countDictation(requireWorkspace()) } catch {}
      return result
    }
    case "diagnostic": {
      const s = appState
      return buildDiagnostic({
        versions: { node: process.versions.node },
        platform: process.platform + " " + process.arch,
        status: s.status,
        opencodeVersion: s.version,
        cli: s.cli,
        keyIds: Object.entries(s.keys).filter(([, present]) => present).map(([id]) => id),
        assignments: s.assignments,
        warning: s.warning,
        keyWarnings: s.keyWarnings,
        workspace: s.workspace,
        workspaces: Array.isArray(params?.[0]) ? params[0] : [],
        log: diagLog,
      })
    }
    case "getStats": {
      const chats = await api.chats(undefined, true).catch(() => [])
      const modelCounters: Record<string, number> = {}
      for (const chat of chats) {
        if (chat.model) modelCounters[String(chat.model)] = (modelCounters[String(chat.model)] ?? 0) + 1
      }
      return aggregateStats({
        chats,
        dictations: readDictationStats(requireWorkspace()),
        modelCounters,
      }, ["projet", "code", "recherche", "analyse"])
    }
    default:
      throw new Error(`Méthode runtime inconnue : ${method}`)
  }
}

export async function serve() {
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity })
  rl.on("close", () => void shutdown())

  for await (const line of rl) {
    if (!line.trim()) continue

    let request: RpcMessage
    try {
      request = JSON.parse(line)
    } catch {
      send({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "JSON invalide" } })
      continue
    }

    if (typeof request.method !== "string") continue

    try {
      const result = await dispatch(request.method, request.params)
      if (request.id !== undefined) send({ jsonrpc: "2.0", id: request.id, result: result ?? null })
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      if (request.id !== undefined) {
        send({ jsonrpc: "2.0", id: request.id, error: { code: -32000, message } })
      }
    }
  }
}

if (process.argv[1] && /aven-app-host\.(mjs|js)$/.test(process.argv[1].replace(/\\/g, "/"))) {
  serve().catch((err) => {
    process.stderr.write(`[aven-app-host] fatal: ${err instanceof Error ? err.message : String(err)}\n`)
    process.exit(1)
  })
}
