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
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { listNotes, getNote, saveNote, notesDir } from "./notes.js"
import { loadPinned, loadTags, setTags, togglePin } from "./notes-meta.js"
import { listWorkspaceDir, readWorkspaceFile, breadcrumbOf, safeResolve as safeResolveWorkspacePath } from "./workspace-files.js"
import { aggregateStats, readDictationStats } from "./stats.js"
import { buildDiagnostic } from "./diagnostic.js"
import { transcribeSpeech } from "./voice.js"
import { Announcer } from "./announcer.js"
import { countDictation } from "./stats.js"
import { rpcObjectParam } from "./rpc-params.js"
import { buildLaunchCommand, freebuffBusyMessage, freebuffMissingMessage, parseVersionOutput } from "./freebuff-cli.js"
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
  const script = unprotect
    ? "$raw=[Console]::In.ReadToEnd();$data=[Convert]::FromBase64String($raw.Trim());$plain=[System.Security.Cryptography.ProtectedData]::Unprotect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plain))"
    : "$raw=[Console]::In.ReadToEnd();$data=[Text.Encoding]::UTF8.GetBytes($raw);$cipher=[System.Security.Cryptography.ProtectedData]::Protect($data,$null,[System.Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($cipher))"
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
  } catch {
    return undefined
  }
}

function loadKeys() {
  let stored: { keysEnc?: Record<string, string>; openrouterKeyEnc?: string } = {}
  try {
    stored = JSON.parse(readFileSync(settingsPath(), "utf8")) as typeof stored
  } catch {}

  const out: Record<string, string> = {}
  for (const [id, envName] of [["openrouter", "OPENROUTER_API_KEY"], ["groq", "GROQ_API_KEY"]] as const) {
    const encrypted = stored.keysEnc?.[id] || (id === "openrouter" ? stored.openrouterKeyEnc : undefined)
    const value = encrypted ? protectWindows(encrypted, true) : undefined
    const envValue = process.env[envName]
    if (value) out[envName] = value
    else if (envValue?.trim()) out[envName] = envValue
  }
  return out
}

function saveKey(provider: string, key: string) {
  const envName = provider === "openrouter" ? "OPENROUTER_API_KEY" : provider === "groq" ? "GROQ_API_KEY" : undefined
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
  writeFileSync(settingsPath(), JSON.stringify(next, null, 2) + "\n", "utf8")
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

async function launchFreebuff(action: "launch" | "login" | "install", cols?: number, rows?: number) {
  if (process.platform !== "win32") {
    throw new Error("Le terminal Freebuff n'est pris en charge que sous Windows.")
  }

  if (action !== "install") {
    const status = await checkFreebuffCli()
    if (!status.installed) throw new Error(freebuffMissingMessage())
    if (!isFreebuffPtyActive() && await isFreebuffProcessRunning()) throw new Error(freebuffBusyMessage())
  } else if (!(await checkNpm())) {
    throw new Error("npm est introuvable sur cet ordinateur. Installe Node.js avec npm, puis réessaie.")
  }

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

function loadPrefs() {
  try {
    const raw = JSON.parse(readFileSync(prefsPath(), "utf8")) as { notifications?: unknown; freebuffResume?: unknown }
    return {
      notifications: raw.notifications !== false,
      freebuffResume: raw.freebuffResume === true,
    }
  } catch {
    return { notifications: true, freebuffResume: false }
  }
}

function savePrefs(next: { notifications?: boolean; freebuffResume?: boolean }) {
  const current = loadPrefs()
  const value = {
    notifications: next.notifications ?? current.notifications,
    freebuffResume: next.freebuffResume ?? current.freebuffResume,
  }
  writeFileSync(prefsPath(), JSON.stringify(value, null, 2) + "\n", "utf8")
  return value
}

async function shutdown() {
  await engine?.stop()
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
    case "prefs":
      return loadPrefs()
    case "setNotifications":
      return savePrefs({ notifications: params?.[0] === true })
    case "setFreebuffResume":
      return savePrefs({ freebuffResume: params?.[0] === true })
    case "freebuffCliStatus":
      return checkFreebuffCli()
    case "freebuffCliLaunch":
      return launchFreebuff(
        (params?.[0] ?? "launch") as "launch" | "login" | "install",
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
