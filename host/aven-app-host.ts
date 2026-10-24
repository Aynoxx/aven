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
import { promisify } from "node:util"
import { copyFileSync, existsSync, mkdirSync, readFileSync } from "node:fs"
import path from "node:path"
import {
  archiveNote, backlinks, createFolder, deleteFolder, deleteNote, getNote,
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
import { answerVoiceQuestion, listWindowsVoices, sanitizeSpeechText, speakWithWindowsVoice, splitSentences, synthesizeEdgeSpeech, transcribeVoiceSegment, type PowerShellRunner, type VoiceTurn } from "./voice-agent-speech.js"
// v11.2.0 : outils de lecture de l'agent vocal (état, notes).
import { createVoiceToolRunner } from "./voice-agent-tools.js"
// v11.3.0 : voix neuronales (service de lecture d'Edge, gratuit et sans compte) —
// la voix Windows reste le repli local, hors ligne.
import { EDGE_COOLDOWN_MS, EDGE_QUOTA_MESSAGE, EDGE_VOICE_IDS, edgeCooldownActive, isEdgeRateLimit, resolveVoiceRoute } from "./voice-agent-edge.js"
// v11.4.3 : une phrase déjà synthétisée ne repart pas au service (moins de 429).
import { createVoiceCache } from "./voice-cache.js"
// v11.5.0 : voix locale Piper (repli hors ligne) et dictionnaire de prononciation.
import { PIPER_VOICE_ID, piperLayout, synthesizePiperSpeech } from "./piper-tts.js"
import { applyPronunciations } from "./pronunciation.js"
import { Announcer } from "./announcer.js"
import { countDictation } from "./stats.js"
import { rpcObjectParam } from "./rpc-params.js"
import { writeTextAtomic } from "./atomic-file.js"
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
  const key = loadKeys()["GROQ_API_KEY"]?.trim()
  if (!key) throw new Error("Configure une clé Groq dans Réglages → Services IA pour utiliser l'agent vocal.")
  return key
}

// v11.3.0 : la voix se choisit dans les préférences, avec deux préfixes stables :
// « edge: » (voix neuronale) et « sapi: » (voix Windows locale). Le host tranche
// UNE fois, au même endroit, et ne laisse jamais l'interface choisir un moteur.
//   - neuronale : l'audio MP3 revient au renderer, qui le joue dans la webview ;
//   - Windows : lecture locale par PowerShell, hors ligne.
// Le service neuronal est gratuit mais NON contractuel : un échec ne rend jamais
// l'agent muet. On parle avec la voix Windows et on le DIT (`warning`), sinon
// l'utilisateur croirait avoir changé de voix sans raison.
type VoiceSpeech = { audio?: string; mime?: string; spoken?: boolean; warning?: string }

// v11.4.3 : cache des phrases déjà synthétisées (borné, en mémoire seulement).
const VOICE_CACHE = createVoiceCache({ maxEntries: 16, ttlMs: 30 * 60_000 })
// v11.4.3 : après un 429, on ne sollicite plus le service pendant une minute.
let edgeBlockedUntil = 0

/**
 * v11.5.0 : dossier Piper fourni par l'installeur, ou `null` s'il n'est pas là.
 * Le host ne suppose jamais que le binaire existe : une installation incomplète
 * doit se rabattre sur Hortense en le disant, pas échouer en silence.
 */
function piperDir(): string | null {
  const dir = process.env.AVEN_PIPER_DIR
  if (!dir) return null
  const layout = piperLayout(dir)
  return existsSync(layout.binary) && existsSync(layout.model) ? dir : null
}

/** Synthèse Piper en base64 pour la webview, ou `null` si Piper est absent. */
async function speakWithPiper(text: string): Promise<string | null> {
  const dir = piperDir()
  if (!dir) return null
  // v11.5.0 : la voix locale reçoit le dictionnaire de prononciation (« Aveun »,
  // « Fribeuf ») ; la voix neuronale, non.
  const spoken = applyPronunciations(sanitizeSpeechText(text), "piper")
  if (!spoken) return null
  const audio = await synthesizePiperSpeech(spoken, { dir })
  return Buffer.from(audio).toString("base64")
}

async function sayWithVoice(text: string, voiceName: string): Promise<VoiceSpeech> {
  const clean = String(text ?? "").trim()
  if (!clean) return { spoken: false }
  const route = resolveVoiceRoute({ voiceName })
  // v11.5.0 : voix Piper choisie explicitement dans les Réglages.
  if (route.kind === "piper") {
    stopVoiceSpeech()
    const audio = await speakWithPiper(clean)
    if (audio) return { audio, mime: "audio/wav" }
    await speakWithWindowsVoice(clean, undefined, runPowerShell)
    return { spoken: true, warning: "Voix locale Piper introuvable : voix Windows utilisée." }
  }
  if (route.kind === "edge") {
    const key = `${route.voice}\u0000${clean}`
    const cached = VOICE_CACHE.get(key)
    if (cached) return { audio: cached, mime: "audio/mpeg" }
    let reason: string | null = null
    if (edgeCooldownActive(edgeBlockedUntil)) {
      // Le blocage dure encore : parler tout de suite, plutôt que d'attendre le
      // service pour rien. Aucune requête n'est envoyée pendant ce temps.
      reason = EDGE_QUOTA_MESSAGE
    } else {
      try {
        const audio = await synthesizeEdgeSpeech(clean, route.voice)
        const base64 = Buffer.from(audio).toString("base64")
        VOICE_CACHE.set(key, base64)
        return { audio: base64, mime: "audio/mpeg" }
      } catch (error) {
        if (isEdgeRateLimit(error)) edgeBlockedUntil = Date.now() + EDGE_COOLDOWN_MS
        reason = error instanceof Error ? error.message : String(error)
      }
    }
    // v11.5.0 : le repli ordinaire est Piper — hors ligne, sans quota. Hortense
    // ne sert plus que si Piper n'est pas installé.
    try {
      const audio = await speakWithPiper(clean)
      if (audio) return { audio, mime: "audio/wav", warning: `Voix neuronale indisponible (${reason}) : voix locale Piper utilisée.` }
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error)
      reason = `${reason} — ${detail}`
    }
    stopVoiceSpeech()
    await speakWithWindowsVoice(clean, undefined, runPowerShell)
    return { spoken: true, warning: `Voix neuronale indisponible (${reason}) : voix Windows utilisée.` }
  }
  stopVoiceSpeech()
  await speakWithWindowsVoice(clean, route.voice || undefined, runPowerShell)
  return { spoken: true }
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

function loadKeys() {
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

  const out: Record<string, string> = {}
  // v11.3.0 : la liste des fournisseurs était recopiée ici ET dans saveKey —
  // un fournisseur de plus demandait trois modifications pour une seule clé.
  // PROVIDERS (host/providers.ts) est désormais la source unique du stockage.
  for (const provider of PROVIDERS) {
    const id = provider.id
    const envName = provider.env
    const encrypted = stored.keysEnc?.[id] || (id === "openrouter" ? stored.openrouterKeyEnc : undefined)
    const value = encrypted ? protectWindows(encrypted, true) : undefined
    const envValue = process.env[envName]
    if (value) out[envName] = value
    else if (envValue?.trim()) out[envName] = envValue
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

  let stored: { keysEnc?: Record<string, string>; openrouterKeyEnc?: string } = {}
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
  writeSettings(next)
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

function loadPrefs(): AppPrefs {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as {
      notifications?: unknown; freebuffResume?: unknown; voiceName?: unknown; voicePersonality?: unknown; micMuted?: unknown
    }
    return {
      notifications: raw.notifications !== false,
      freebuffResume: raw.freebuffResume === true,
      voiceName: typeof raw.voiceName === "string" ? raw.voiceName.slice(0, 120) : "",
      voicePersonality: normalizeVoicePersonality(raw.voicePersonality),
      micMuted: raw.micMuted === true,
    }
  } catch (error) {
    // v10.2.1 : même piège que settings.json — un prefs.json tronqué remettait
    // notifications à ON sans le dire. Le repli reste, la trace aussi.
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
      console.error("[aven] prefs.json illisible, préférences par défaut :", (error as Error).message)
    }
    return { notifications: true, freebuffResume: false, voiceName: "", voicePersonality: "neutre", micMuted: false }
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
      const ids = [...EDGE_VOICE_IDS]
      // v11.5.0 : la voix Piper n'apparaît que si l'installeur l'a fournie —
      // proposer une voix absente serait un faux bouton.
      if (piperDir()) ids.push(PIPER_VOICE_ID)
      for (const name of windows) ids.push(`sapi:${name}`)
      return ids
    }
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
      return interpretVoiceText(String(params?.[0] ?? ""))
    case "voiceAgentAsk": {
      const question = String(params?.[0] ?? "").trim()
      if (!question) throw new Error("Aucune demande vocale reçue.")
      const answer = await answerVoiceQuestion(question, {
        apiKey: requireGroqKey(),
        personality: loadPrefs().voicePersonality,
        history: voiceHistory,
        // v11.2.0 : outils en LECTURE SEULE. Le host possède déjà les notes et
        // l'état : aucun aller-retour vers le renderer n'est nécessaire, donc le
        // contrat IPC existant suffit. L'espace est nommé par son basename — le
        // chemin complet de la machine ne part pas chez le fournisseur distant.
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
        }),
      })
      // Contexte de session borné : six tours suffisent à suivre une conversation
      // orale, et rien n'est écrit sur disque.
      voiceHistory = [...voiceHistory, { role: "user" as const, content: question }, { role: "assistant" as const, content: answer }].slice(-6)
      return { text: answer, sentences: splitSentences(answer) }
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
    case "voiceAgentPreview":
      return sayWithVoice(
        String(params?.[0] ?? "Bonjour, je suis l'agent vocal d'Aven. Voici ma voix."),
        String(params?.[1] ?? "") || loadPrefs().voiceName,
      )
    case "voiceAgentStop":
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
        loadKeys()["GROQ_API_KEY"],
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
