import { app, BrowserWindow, dialog, globalShortcut, ipcMain, Menu, Notification, session, shell, Tray } from "electron"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { makeOps } from "./operations.js"
import { addDiscoveredFreeModels, loadTable } from "./priorities.js"
import { EXPECTED_VERSION } from "./opencode-bridge.js"
import { FREEBUFF_MODEL_LABEL } from "./freebuff.js"
import { buildLaunchCommand, freebuffMissingMessage, parseVersionOutput, unsupportedPlatform } from "./freebuff-cli.js"
import { Router } from "./router.js"
import { relayEvents, startOpenCode, TABS, type Bridge } from "./opencode-bridge.js"
import { aggregateStats, countDictation, readDictationStats } from "./stats.js"
import { probeOpenRouterKey, PROVIDERS } from "./providers.js"
import { loadKeys, saveKey, seedWorkspace } from "./settings.js"
import { getNote, listNotes, notesDir } from "./notes.js"
import { loadPinned, togglePin } from "./notes-meta.js"
import { transcribeSpeech } from "./voice.js"
import { Announcer } from "./announcer.js"
import { notifyContent, shouldNotify } from "./notify-policy.js"
import { loadPrefs, saveNotifications } from "./prefs.js"
import { buildDiagnostic } from "./diagnostic.js"
import { activeWorkspace, ensureDefaultRegistered, listWorkspaces, registerWorkspace, removeWorkspace, setActiveWorkspace, validateWorkspacePath } from "./workspaces.js"
import type { FileSyncResult } from "./workspace-sync.js"

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const isDev = !app.isPackaged

// Piège Windows : sans AppUserModelId identique au appId, pas de toast et le nom
// « Electron » s'affiche à la place d'« Aven » dans les notifications.
if (process.platform === "win32") app.setAppUserModelId("com.local.aven")

// Verrou mono-instance : évite de lancer deux processus OpenCode sur le même espace de travail.
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", () => showWindow())
}

type AppState = {
  status: "starting" | "ready" | "error"
  error?: string
  keys: Record<string, boolean> // quels fournisseurs ont une clé (les clés elles-mêmes ne quittent JAMAIS ce process)
  keyWarnings?: Record<string, string> // clé enregistrée mais aucun modèle actif détecté (best effort)
  providers: { id: string; label: string; url: string; note: string }[]
  version?: string
  cli?: string
  workspace?: string
  workspaces?: { path: string; name: string }[]
  sync?: FileSyncResult[] // état des fichiers de config au dernier démarrage (créé / mis à jour / personnalisé)
  newModels?: string[]
  removedModels?: string[]
  assignments?: Record<string, { ref: string; label: string }[]> // agent → modèles par ordre de priorité (lecture seule)
  warning?: string
  versionWarning?: string // version du serveur OpenCode ≠ version attendue par le client
  updatesConfigured: boolean
}
const providersLite = PROVIDERS.map(({ id, label, url, note }) => ({ id, label, url, note }))

function readUpdatesConfigured(): boolean {
  try {
    const pkgPath = path.join(isDev ? path.resolve(__dirname, "..") : process.resourcesPath, "package.json")
    const pkg = JSON.parse(readFileSync(pkgPath, "utf8")) as { build?: { publish?: { owner?: string; repo?: string } } }
    const publish = pkg.build?.publish
    return !!publish?.owner && !!publish?.repo && !publish.owner.startsWith("TODO") && !publish.repo.startsWith("TODO")
  } catch {
    return false
  }
}

const updatesConfigured = readUpdatesConfigured()

/**
 * Répare les sessions héritées : créées par une version antérieure, elles peuvent porter
 * un modèle hors catalogue (ex. le faux secours « openrouter/openrouter/free », retiré).
 * Au premier message, beforeSend() les rebasculera de toute façon vers le meilleur modèle
 * de leur agent ; ici on ne fait qu'aligner le champ affiché pour ne pas montrer un modèle
 * qui ne peut plus fonctionner. Best effort, jamais bloquant, limité aux dernières sessions.
 */
async function repairLegacySessions(r: Router, client: Bridge["client"], workspaceDir: string) {
  try {
    const page = await client.session.list({ directory: workspaceDir, order: "desc", limit: 50 })
    for (const s of page.data) {
      const ref = s.model ? `${s.model.providerID}/${s.model.id}` : undefined
      if (!ref || r.assignments()[String(s.agent)]?.some((m) => m.ref === ref)) continue
      const want = r.pick(String(s.agent) as Parameters<Router["pick"]>[0])
      if (want && want !== ref) {
        await client.session.switchModel({ sessionID: s.id, model: { providerID: want.split("/")[0], id: want.slice(want.indexOf("/") + 1) } }).catch(() => undefined)
      }
    }
  } catch (err) {
    console.warn("[sessions] réparation des sessions héritées impossible :", err instanceof Error ? err.message : String(err))
  }
}

let win: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let bridge: Bridge | null = null
let relay: AbortController | null = null
let workspace = ""
let templateDir = ""
let router: Router | null = null
let state: AppState = { status: "starting", keys: {}, providers: providersLite, updatesConfigured }
let bootQueue: Promise<void> = Promise.resolve()
let bootGeneration = 0
let shutdownPromise: Promise<void> | null = null

const ops = makeOps(
  () => {
    if (!bridge) throw new Error("OpenCode n'est pas prêt.")
    return bridge
  },
  () => router,
  (sessionID, text) => win?.webContents.send("opencode:event", { type: "router.notice", data: { sessionID, model: FREEBUFF_MODEL_LABEL, text } }),
)

// Annonceur vocal (v8.7.9) : événements OpenCode → courtes phrases parlées (SAPI Windows).
// isMuted signale si l'utilisateur a tapé/clické récemment côté renderer (voir announcer:activity).
let lastUserActivity = 0
const announcer = new Announcer({
  isMuted: () => Date.now() - lastUserActivity < 1500,
  speak: (text) => speakWithSapi(text),
})

// ── Notifications de bureau (v9.1.0) ──────────────────────────────────────────────
// Jamais au premier plan ; permissions/formulaires toujours ; tour terminé seulement s'il
// a duré (politique pure testée dans notify-policy.ts). Clic sur le toast : fenêtre au premier plan.
function notifyDesktop(kind: Parameters<typeof shouldNotify>[0]["kind"], turnDurationMs?: number) {
  if (!win) return
  const windowFocused = win.isFocused() && win.isVisible() // cachée dans le tray → isVisible() est false, c'est voulu
  const enabled = loadPrefs().notifications
  if (!shouldNotify({ windowFocused, kind, turnDurationMs, enabled })) return
  const { title, body } = notifyContent(kind, turnDurationMs)
  const n = new Notification({ title, body })
  n.on("click", () => showWindow())
  n.show()
}

// ── Tampon de diagnostic (v9.1.0) : 30 derniers événements internes, sans contenu de clé. ──
const diagLog: string[] = []
function trace(line: string) {
  diagLog.push(`${new Date().toISOString()} ${line}`)
  if (diagLog.length > 30) diagLog.shift()
}
trace("démarrage du process principal")

/** Voix Windows via PowerShell SAPI : gratuite, hors ligne, déjà installée. */
async function speakWithSapi(text: string): Promise<void> {
  const safe = text.replace(/'/g, "''")
  await new Promise<void>((resolve, reject) => {
    const { execFile } = require("node:child_process") as typeof import("node:child_process")
    execFile("powershell", ["-NoProfile", "-Command", `Add-Type -AssemblyName System.Speech; (New-Object System.Speech.Synthesis.SpeechSynthesizer).Speak('${safe}')`], { timeout: 20_000 }, (err) => {
      if (err) reject(err)
      else resolve()
    })
  })
}

/** (Re)démarre OpenCode. Les demandes concurrentes sont sérialisées et obsolètes. */
async function bootImpl(requestedWorkspace: string, generation: number) {
  const keys = loadKeys()
  const flags = Object.fromEntries(PROVIDERS.map((p) => [p.id, !!keys[p.id]]))
  const keyWarnings: Record<string, string> = {}
  let openRouterUsable = true
  if (keys.openrouter) {
    const probe = await probeOpenRouterKey(keys.openrouter)
    if (probe.status === "invalid") {
      openRouterUsable = false
      keyWarnings.openrouter = `Clé OpenRouter refusée : ${probe.message} Remplace-la dans Paramètres.`
      console.warn(`[provider] OpenRouter désactivé pour ce démarrage : ${probe.message}`)
    } else if (probe.status === "unknown") {
      keyWarnings.openrouter = probe.message
      console.warn(`[provider] Test OpenRouter inconnu : ${probe.message}`)
    }
  }
  const env = Object.fromEntries(PROVIDERS.filter((p) => p.openCodeEnv !== false && keys[p.id] && (p.id !== "openrouter" || openRouterUsable)).map((p) => [p.env, keys[p.id]]))
  try {
    const sync = seedWorkspace(requestedWorkspace, templateDir)
    state = {
      status: "starting",
      keys: flags,
      providers: providersLite,
      workspace: requestedWorkspace,
      workspaces: listWorkspaces(),
      sync: sync.sync,
      newModels: sync.newModels,
      removedModels: sync.removedModels,
      updatesConfigured,
    }
    await shutdown()
    if (generation !== bootGeneration) return
    workspace = requestedWorkspace
    bridge = await startOpenCode({ workspace: requestedWorkspace, env })
    if (generation !== bootGeneration) {
      await shutdown()
      return
    }

    const { data } = await bridge.client.model.list({ location: { directory: requestedWorkspace } })
    const available = new Set(
      data
        .filter((m) => {
          const model = m as typeof m & { enabled?: boolean; disabled?: boolean; status?: string }
          if (model.providerID === "openrouter" && !openRouterUsable) return false
          return model.enabled !== false && model.disabled !== true && model.status !== "deprecated"
        })
        .map((m) => `${m.providerID}/${m.modelID}`),
    )
    const loaded = loadTable(path.join(requestedWorkspace, "model-priorities.json"), path.join(templateDir, "model-priorities.json"))
    const discovered = data.map((m) => {
      const model = m as typeof m & { name?: string; enabled?: boolean; disabled?: boolean; status?: string }
      return { ref: `${model.providerID}/${model.modelID}`, label: model.name }
    }).filter((m) => available.has(m.ref))
    const catalog = addDiscoveredFreeModels(loaded.table, discovered)
    const notify = (sessionID: string, model: string, text: string) =>
      win?.webContents.send("opencode:event", { type: "router.notice", data: { sessionID, model, text } })
    const r = new Router({ client: bridge.client, table: catalog.table, notify }, available)
    router = r
    if (catalog.added.length) console.info(`[models] modèles gratuits découverts dynamiquement : ${catalog.added.join(", ")}`)
    const missingFree = Object.values(r.chains).every((chain) => chain.length === 0)
    if (missingFree) console.warn("[models] Aucun modèle gratuit utilisable n'a été découvert par OpenCode.")
    for (const p of PROVIDERS) {
      if (p.openCodeEnv === false) continue
      if (flags[p.id] && !keyWarnings[p.id] && !data.some((m) => { const model = m as typeof m & { enabled?: boolean; disabled?: boolean; status?: string }; return model.providerID === p.id && model.enabled !== false && model.disabled !== true && model.status !== "deprecated" })) {
        keyWarnings[p.id] = "Clé enregistrée, mais aucun modèle actif détecté pour ce fournisseur — vérifie qu'elle est valide."
      }
    }

    relay = new AbortController()
    void repairLegacySessions(r, bridge.client, requestedWorkspace)
    void relayEvents(
      bridge.client,
      (ev) => {
        r.onEvent(ev)
        win?.webContents.send("opencode:event", ev)
        announcer.handle(ev)
        notifyFromEvent(ev)
      },
      relay.signal,
    )
    if (generation !== bootGeneration) {
      await shutdown()
      return
    }
    state = {
      ...state,
      status: "ready",
      version: bridge.version,
      cli: bridge.binSource,
      assignments: r.assignments(),
      warning: loaded.warning,
      keyWarnings,
      // Un écart de version n'est plus un simple console.warn : client et CLI doivent être
      // à la même version exacte (voir README), sinon le protocole peut diverger en silence.
      versionWarning: bridge.version !== EXPECTED_VERSION
        ? `OpenCode ${bridge.version} ≠ version attendue ${EXPECTED_VERSION} : mets à jour les paquets @opencode/client ET @opencode/cli à la même version.`
        : undefined,
    }
    console.log(`[app] OpenCode ${bridge.version} prêt (CLI ${bridge.binSource}) — clés : ${Object.keys(env).length} — dossier : ${requestedWorkspace}`)
  } catch (err) {
    if (generation !== bootGeneration) return
    console.error(err)
    state = { ...state, status: "error", error: err instanceof Error ? err.message : String(err) }
  }
}

// Notifications pilotées par les événements du moteur (v9.1.0) : durée des tours mesurée
// au session.execution.started de CHAQUE session (les sous-agents n'en génèrent pas ici :
// seuls les événements avec sessionID sont relayés).
const turnStarts = new Map<string, number>()
function notifyFromEvent(ev: { type: string; data: Record<string, unknown> }) {
  trace(ev.type)
  const sessionID = typeof ev.data?.sessionID === "string" ? ev.data.sessionID : ""
  if (ev.type === "session.execution.started" && sessionID) {
    turnStarts.set(sessionID, Date.now())
    return
  }
  if (ev.type === "session.execution.succeeded" && sessionID) {
    const started = turnStarts.get(sessionID)
    turnStarts.delete(sessionID)
    notifyDesktop("turn-done", started ? Date.now() - started : undefined)
    return
  }
  if (ev.type === "session.execution.failed" && sessionID) {
    turnStarts.delete(sessionID)
    notifyDesktop("turn-error")
    return
  }
  if (ev.type === "permission.asked") notifyDesktop("permission")
  else if (ev.type === "form.created") notifyDesktop("form")
}

function boot() {
  const requestedWorkspace = path.resolve(workspace)
  const generation = ++bootGeneration
  const run = bootQueue.then(() => bootImpl(requestedWorkspace, generation))
  bootQueue = run.catch(() => undefined)
  return run
}

async function shutdown() {
  if (shutdownPromise) return shutdownPromise
  shutdownPromise = (async () => {
    relay?.abort()
    relay = null
    router = null
    const b = bridge
    bridge = null
    await b?.stop()
  })().finally(() => {
    shutdownPromise = null
  })
  return shutdownPromise
}

function createWindow() {
  win = new BrowserWindow({
    icon: path.join(__dirname, "../build/icon.png"),
    width: 1200,
    height: 800,
    frame: false,
    maximizable: true,
    titleBarStyle: "hidden",
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  // L’application démarre maximisée pour occuper immédiatement toute la surface disponible.
  win.maximize()
  win.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  win.webContents.on("will-navigate", (e) => e.preventDefault())

  // Réduit dans la zone de notification au lieu de fermer, pour permettre le raccourci global.
  win.on("close", (e) => {
    if (isQuitting) return
    e.preventDefault()
    win?.hide()
  })

  if (isDev) void win.loadURL("http://127.0.0.1:5173")
  else void win.loadFile(path.join(__dirname, "../web/dist/index.html"))
}

function showWindow() {
  if (!win) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createTray() {
  try {
    tray = new Tray(path.join(__dirname, "../build/icon.png"))
    tray.setToolTip("Aven")
    tray.setContextMenu(
      Menu.buildFromTemplate([
        { label: "Afficher", click: () => showWindow() },
        { type: "separator" },
        {
          label: "Quitter",
          click: () => app.quit(),
        },
      ]),
    )
    tray.on("click", () => showWindow())
  } catch (err) {
    console.error("[tray] indisponible :", err) // pas bloquant : l'app fonctionne sans icône système
  }
}

function registerIpc() {
  ipcMain.handle("window:minimize", () => { win?.minimize(); return true })
  ipcMain.handle("window:toggleMaximize", () => { if (win?.isMaximized()) win.unmaximize(); else win?.maximize(); return true })
  ipcMain.handle("window:close", () => { win?.close(); return true })
  ipcMain.handle("app:state", () => state)
  ipcMain.handle("app:openWorkspace", () => shell.openPath(workspace))
  ipcMain.handle("settings:setKey", async (_e, provider: string, key: string) => {
    saveKey(String(provider), String(key ?? ""))
    await boot() // OpenCode est relancé avec les nouvelles clés
    return state
  })
  ipcMain.handle("app:openExternal", (_e, url: string) => {
    if (PROVIDERS.some((p) => p.url === url)) return shell.openExternal(url) // liste blanche : uniquement les pages de clés
  })

  // Espaces de travail
  ipcMain.handle("workspace:list", () => listWorkspaces())
  ipcMain.handle("workspace:switch", async (_e, dir: string) => {
    const safeDir = validateWorkspacePath(dir)
    setActiveWorkspace(safeDir)
    workspace = safeDir
    await boot()
    return state
  })
  ipcMain.handle("workspace:addExisting", async () => {
    if (!win) return null
    const res = await dialog.showOpenDialog(win, { properties: ["openDirectory"], title: "Choisir un dossier de travail" })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = path.resolve(res.filePaths[0])
    const entry = registerWorkspace(dir, path.basename(dir))
    setActiveWorkspace(dir)
    workspace = dir
    await boot()
    return { entry, state }
  })
  ipcMain.handle("workspace:createNew", async (_e, name: string) => {
    if (!win) return null
    // v9.0.0 : c'est l'utilisateur qui choisit (ou crée) le DOSSIER FINAL de l'espace dans
    // le sélecteur Windows natif — plus de sous-dossier imposé. Annulation = aucun changement.
    const res = await dialog.showOpenDialog(win, {
      properties: ["openDirectory", "createDirectory"],
      title: "Nouvel espace de travail — choisis ou crée son dossier",
      buttonLabel: "Utiliser ce dossier",
    })
    if (res.canceled || !res.filePaths[0]) return null
    const dir = path.resolve(res.filePaths[0])
    if (listWorkspaces().some((w) => path.resolve(w.path) === dir)) {
      throw new Error("Ce dossier fait déjà partie des espaces de travail connus.")
    }
    const clean = String(name || "").trim() || path.basename(dir)
    if (!/^[^<>:"/\\|?*]+$/.test(clean) || clean === "." || clean === ".." || /(^|\s)(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(clean)) {
      throw new Error("Nom d’espace de travail invalide.")
    }
    const entry = registerWorkspace(dir, clean)
    setActiveWorkspace(dir)
    workspace = dir
    await boot()
    return { entry, state }
  })
  ipcMain.handle("workspace:remove", (_e, dir: string) => {
    removeWorkspace(dir)
    return listWorkspaces()
  })

  ipcMain.handle("agents:list", () => ops.agents())
  ipcMain.handle("chats:list", (_e, agent?: string, includeArchived?: boolean) => ops.chats(agent, includeArchived))
  ipcMain.handle("notes:list", () => listNotes(workspace))
  ipcMain.handle("notes:get", (_e, id: string) => getNote(workspace, String(id)))
  ipcMain.handle("notes:togglePin", (_e, id: string) => togglePin(workspace, String(id)))
  ipcMain.handle("notes:pins", () => loadPinned(workspace))
  // v9.0.0 : les notes sont de vrais fichiers — chemin affiché et ouverture du dossier.
  ipcMain.handle("notes:dir", () => notesDir(workspace))

  // CLI Freebuff gratuit (v9.1.2) : statut + ouverture d'une console sur l'espace actif.
  // v9.1.3 : la détection (execFile + parse) est partagée entre status et launch —
  // launch REFUSE de démarrer si le CLI est absent : ouvrir un terminal pour y lire
  // « 'freebuff' n'est pas reconnu » n'a jamais aidé personne.
  async function checkFreebuffCli(): Promise<{ installed: boolean; version?: string }> {
    try {
      const { execFile } = await import("node:child_process")
      const out = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
        // shell requis : le launcher freebuff est un .cmd sous Windows (Node le refuse sans shell).
        execFile("freebuff", ["--version"], { timeout: 8_000, shell: true }, (err, stdout, stderr) => {
          if (err && !stdout && !stderr) reject(err)
          else resolve({ stdout: String(stdout ?? ""), stderr: String(stderr ?? "") })
        })
      })
      return parseVersionOutput(out.stdout, out.stderr)
    } catch {
      return { installed: false as const }
    }
  }
  ipcMain.handle("freebuff:status", () => checkFreebuffCli())
  ipcMain.handle("freebuff:launch", async (_e, action: "launch" | "login" | "install" = "launch") => {
    if (process.platform !== "win32") throw new Error(unsupportedPlatform(process.platform))
    // L'installation npm ne présuppose pas la présence du CLI : c'est justement son but.
    if (action !== "install") {
      const status = await checkFreebuffCli()
      if (!status.installed) throw new Error(freebuffMissingMessage())
    }
    const { spawn } = await import("node:child_process")
    const cmd = buildLaunchCommand(workspace, action)
    // detached + fenêtre console : start() ouvre la fenêtre et retourne immédiatement.
    // (v9.1.3) arguments verbatim retirés : Node cite chaque argument lui-même,
    // sinon « /D C:\chemin avec espaces » était découpé et le dossier de départ était perdu.
    const child = spawn(cmd.command, cmd.args, { detached: true, stdio: "ignore" })
    child.unref()
    return true
  })
  ipcMain.handle("notes:openFolder", () => {
    mkdirSync(notesDir(workspace), { recursive: true })
    return shell.openPath(notesDir(workspace))
  })
  // Dictée vocale (v8.7.8) : blob audio du renderer → Groq (transcription + reformage).
  // Renvoie { raw, cleaned?, cleanedBy?, warning? } ; lève seulement si la transcription
  // elle-même échoue (le reformage, lui, est best effort côté voice.ts).
  // Logs de diagnostic : « plus rien ne se passe » doit toujours pouvoir s'expliquer ici.
  ipcMain.handle("voice:transcribe", async (_e, audio: Uint8Array, mimeType: string) => {
    console.log(`[dictée] reçu ${(audio?.length ?? 0)} octets (${mimeType || "audio/webm"})`)
    try {
      const result = await transcribeSpeech(new Blob([new Uint8Array(audio)], { type: String(mimeType || "audio/webm") }))
      const intent = result.intent
        ? result.intent.intent === "app" ? `app:${result.intent.action}`
        : result.intent.intent === "agent" ? `agent:${result.intent.target ?? "courant"}`
        : "chat"
        : "absente"
      console.log(`[dictée] OK — brut: ${result.raw.length} car.` + (result.cleaned ? `, éclairci: ${result.cleaned.length} car.` : "") + (result.warning ? `, warning: ${result.warning}` : "") + `, intention: ${intent}`)
      try { countDictation(workspace) } catch { /* les stats ne doivent jamais casser la dictée */ }
      return result
    } catch (err) {
      console.error("[dictée] échec de transcription :", err instanceof Error ? err.message : String(err))
      throw err
    }
  })

  // Annonceur vocal : activité utilisateur (mute), activation, test voix.
  ipcMain.handle("announcer:activity", () => { lastUserActivity = Date.now() })
  ipcMain.handle("announcer:setEnabled", (_e, on: boolean) => {
    announcer.setEnabled(!!on)
    return announcer.isEnabled()
  })
  ipcMain.handle("announcer:test", (_e, text: string) => speakWithSapi(String(text ?? "Annonce vocale activée.").slice(0, 200)))

  ipcMain.handle("chats:create", (_e, agent: string) => ops.createChat(agent))
  ipcMain.handle("chats:rename", (_e, id: string, title: string) => ops.renameChat(id, title))
  ipcMain.handle("agents:rename", (_e, id: string, name: string) => ops.renameAgent(id, name))
  ipcMain.handle("chats:delete", (_e, id: string) => ops.deleteChat(id))
  ipcMain.handle("chats:archive", (_e, id: string, archived: boolean) => ops.archiveChat(id, archived))
  ipcMain.handle("chats:messages", (_e, id: string) => ops.messages(id))
  ipcMain.handle("chats:send", (_e, id: string, text: string, backend?: "opencode" | "freebuff") => ops.send(id, text, backend))
  ipcMain.handle("chats:interrupt", (_e, id: string) => ops.interrupt(id))
  ipcMain.handle("notes:export", async (_e, id: string) => {
    if (!win) return null
    const note = getNote(workspace, String(id))
    const safeName = note.title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "note"
    const res = await dialog.showSaveDialog(win, {
      title: "Exporter la note",
      defaultPath: `${safeName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, note.markdown, "utf8")
    return res.filePath
  })
  ipcMain.handle("stats:get", async () => {
    const chats = await ops.chats(undefined, true).catch(() => [])
    const modelCounters: Record<string, number> = {}
    for (const c of chats) if (c.model) modelCounters[c.model] = (modelCounters[c.model] ?? 0) + 1
    return aggregateStats({ chats, dictations: readDictationStats(workspace), modelCounters }, [...TABS])
  })
  ipcMain.handle("chats:export", async (_e, id: string) => {
    if (!win) return null
    const { title, markdown } = await ops.exportMarkdown(id)
    const safeName = title.replace(/[\\/:*?"<>|]/g, "_").slice(0, 80) || "conversation"
    const res = await dialog.showSaveDialog(win, {
      title: "Exporter la conversation",
      defaultPath: `${safeName}.md`,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    })
    if (res.canceled || !res.filePath) return null
    writeFileSync(res.filePath, markdown, "utf8")
    return res.filePath
  })
  ipcMain.handle("forms:reply", (_e, sid: string, fid: string, answer: Record<string, string | number | boolean | string[]>) =>
    ops.formReply(sid, fid, answer),
  )
  ipcMain.handle("forms:cancel", (_e, sid: string, fid: string) => ops.formCancel(sid, fid))
  ipcMain.handle("permissions:reply", (_e, sid: string, rid: string, d: "once" | "always" | "reject") => ops.reply(sid, rid, d))

  // Notifications de bureau (v9.1.0) : interrupteur persistant dans userData.
  ipcMain.handle("prefs:get", () => loadPrefs())
  ipcMain.handle("prefs:setNotifications", (_e, on: boolean) => saveNotifications(on === true))
  // Diagnostic copiable (v9.1.0) : les valeurs de clés ne quittent JAMAIS ce process —
  // seuls leurs identifiants de provider sont listés (test anti-fuite sur buildDiagnostic).
  ipcMain.handle("app:diagnostic", () =>
    buildDiagnostic({
      versions: { electron: process.versions.electron, node: process.versions.node, chrome: process.versions.chrome },
      platform: `${process.platform} ${process.arch}`,
      status: state.status,
      opencodeVersion: state.version,
      cli: state.cli,
      keyIds: Object.keys(loadKeys()),
      assignments: state.assignments,
      warning: state.warning,
      keyWarnings: state.keyWarnings,
      workspace: state.workspace,
      workspaces: state.workspaces,
      log: diagLog,
    }),
  )

  // Mise à jour automatique : nécessite une config "publish" valide dans package.json (voir README).
  // Sans elle (placeholder non rempli), ceci échoue proprement avec un message clair, sans jamais planter l'app.
  ipcMain.handle("app:checkForUpdates", async () => {
    if (isDev) return { ok: false, message: "Désactivé en développement." }
    try {
      const { autoUpdater } = await import("electron-updater")
      autoUpdater.autoDownload = false
      const res = await autoUpdater.checkForUpdates()
      return { ok: true, message: res?.updateInfo ? `Version disponible : ${res.updateInfo.version}` : "Aucune mise à jour disponible." }
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
  })
}

app.whenReady().then(() => {
  // Modèle de config : à la racine du projet en dev, dans resources/ une fois packagé.
  templateDir = isDev ? path.resolve(__dirname, "..") : process.resourcesPath
  ensureDefaultRegistered()
  workspace = activeWorkspace().path
  // Microphone : autorisation explicite, réservée à LA fenêtre d'Aven (dictée push-to-talk).
  // Défini UNE seule fois ici.
  session.defaultSession.setPermissionCheckHandler((webContents, permission, _requestingOrigin) => {
    return permission === "media" && webContents === win?.webContents
  })
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permission === "media" && webContents === win?.webContents)
  })
  registerIpc()
  createWindow() // la fenêtre s'ouvre tout de suite ; l'interface affiche « Démarrage… » puis l'erreur éventuelle
  createTray()
  globalShortcut.register("CommandOrControl+Shift+O", () => showWindow())
  void boot()
})

app.on("window-all-closed", () => {
  // Ne ferme pas l'app : elle continue en arrière-plan (icône système). Voir createTray()/isQuitting.
})
app.on("before-quit", (event) => {
  event.preventDefault()
  if (isQuitting) {
    void (shutdownPromise ?? shutdown()).finally(() => app.quit())
    return
  }
  isQuitting = true
  globalShortcut.unregisterAll()
  void shutdown().finally(() => app.quit())
})
