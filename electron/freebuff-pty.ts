// PTY EMBARQUÉ du CLI Freebuff gratuit (v9.2.0, protocole freebuff-pty) : l'action
// « launch » affiche le TUI DANS Aven (xterm.js) au lieu d'une console externe.
// Ce module ne dépend PAS d'Electron : testable avec Node seul, comme opencode-bridge.ts.
//
// TRANSPORT — ConPTY réel via @lydell/node-pty (v9.2.1 de la revue, retour d'expérience) :
// la première livraison émulait le PTY avec `spawn(..., { shell: true, windowsHide: true })`
// — EXPÉRIENCE PROBANTE : le TUI recevait `{ stdin: false, stdout: false }` (pipes purs,
// jamais de console) et un TUI interactif ne peut PAS fonctionner ainsi. `node-pty`
// officiel exige un compilateur MSVC (node-gyp : « Could not find any Visual Studio
// installation ») ; @lydell/node-pty embarque des binaires PRÉBUILDÉS N-API pour
// win32-x64 (conpty.node) — chargés et vérifiés sous l'Electron 35 de ce projet
// (`{ stdin: true, stdout: true }`). Rien ne se compile : des binaires seulement.
//
// IMPORTANT — contrainte serveur (voir freebuffBusyMessage dans freebuff-cli.ts) :
// le compte Freebuff n'autorise qu'UNE session à la fois, tous CLI confondus. Ce module
// ne protège que contre un DEUXIÈME PTY lancé par Aven lui-même (singleton `current`).
// La protection contre un freebuff.exe externe (terminal manuel, autre instance) reste
// la responsabilité de l'appelant : il DOIT appeler isFreebuffProcessRunning() avant
// startFreebuffPty (voir main.ts).

// Pur pour tout ce qui est décisionnel ; l'unique I/O est le spawn du process enfant.
import type { ChildProcess } from "node:child_process"
import path from "node:path"
import { pathToFileURL } from "node:url"

export type PtyState = "starting" | "running" | "restarting"

export type FreebuffPtyEvents = {
  onData: (chunk: string) => void
  onStatus: (state: PtyState) => void
  onExit: (code: number, signal?: number) => void
  onError: (message: string) => void
}

/** Scrollback rejouable à la reconnexion d'une fenêtre (octets). */
export const MAX_PTY_SCROLLBACK = 256 * 1024
/** Fenêtre pendant laquelle la mort du process est un échec de démarrage (ECONNRESET connu). */
export const PTY_BOOT_GRACE_MS = 5_000
/** Tentatives de démarrage maximum (backoff 1 s, 2 s, 4 s — hérité du protocole). */
export const MAX_PTY_BOOT_ATTEMPTS = 3
/** Débit d'injection borné vers l'émulateur (par sécurité, jamais observé en pratique). */
const MAX_CHUNK_CHARS = 64 * 1024
/** Processeurs par défaut de la vue terminal (l'émulateur les ajustera via resizeFreebuffPty). */
export const DEFAULT_PTY_COLS = 120
export const DEFAULT_PTY_ROWS = 30

/** Backoff entre deux tentatives de démarrage (ms) : 1 s, 2 s, 4 s. */
export function ptyBackoffMs(attempt: number): number {
  return 1_000 * Math.pow(2, Math.max(0, attempt - 1))
}

/** Erreur native de boot observée avec freebuff (ECONNRESET au lancement, etc.). */
export function isPtyBootCrash(err: unknown): boolean {
  const text = err instanceof Error ? err.message : String(err ?? "")
  return /ECONNRESET|EPIPE|ENOENT|exit(?:ed)? with code/i.test(text)
}

/** Type minimal du handle PTY (@lydell/node-pty, API node-pty officielle). */
type PtyProcess = {
  write: (data: string) => void
  resize: (cols: number, rows: number) => void
  kill: () => void
  pid: number
  onData: (cb: (chunk: string) => void) => void
  onExit: (cb: (ev: { exitCode: number; signal?: number }) => void) => void
}
type PtySpawn = (file: string, args: string[], opts: { cwd: string; cols: number; rows: number; env: Record<string, string> }) => PtyProcess
type PtyModule = { spawn: PtySpawn }

/** Chemin du paquet PTY prébuildé — seul fiable en dev comme packagé (resourcesPath). */
export function ptyModulePath(__dirname: string, isPackaged: boolean): string {
  // En dev : <projet>/node_modules (via le parent de dist-electron). Packagé : les binaires
  // natifs vivent HORS de l'asar → resourcesPath/app.asar.unpacked/node_modules.
  const base = isPackaged ? path.join(process.resourcesPath ?? "", "app.asar.unpacked") : path.resolve(__dirname, "..")
  // index.js explicite : un import ESM de répertoire est refusé (« Directory import … is
  // not supported »), il faut viser le fichier d'entrée du paquet CommonJS.
  return path.join(base, "node_modules", "@lydell", "node-pty", "index.js")
}

/**
 * Commande qui lance le CLI dans le PTY. (Le CLI est un shim .cmd npm : on passe par
 * `cmd /c` — ConPTY fournit la console, le shell n'est là que pour résoudre le shim.)
 */
export function buildPtyCommand(workspace: string): { file: string; args: string[] } {
  const clean = String(workspace || "").trim()
  if (!clean) throw new Error("Aucun espace de travail actif pour le terminal Freebuff.")
  return { file: "cmd.exe", args: ["/c", "freebuff", "--cwd", clean] }
}

type PtySession = {
  pty: PtyProcess
  taskkill: ChildProcess | null
  scrollback: string
  cols: number
  rows: number
}

let current: PtySession | null = null
let events: FreebuffPtyEvents | null = null
let stopped = false
let bootAttempts = 0
let bootTimer: NodeJS.Timeout | null = null
let backoffTimer: NodeJS.Timeout | null = null
let restartTimer: NodeJS.Timeout | null = null
let cwdPending = ""
let sizePending = { cols: DEFAULT_PTY_COLS, rows: DEFAULT_PTY_ROWS }

/** PID du process CLI de NOTRE session PTY (exclu des gardes anti-takeover de main.ts :
 *  fermer la vue puis rouvrir doit REPRENDRE la session, pas la bloquer). */
let ptyPid = 0

export function freebuffPtyPid(): number {
  return ptyPid
}

/** Injecté par main.ts : charge @lydell/node-pty depuis le bon chemin selon le runtime. */
let spawnImpl: PtySpawn | null = null

/** Charge le module PTY une fois (injection testable : passer un spawn factice). */
export async function loadPtyModule(isPackaged: boolean, __dirname: string): Promise<void> {
  if (spawnImpl) return
  // import() dynamique : sous Windows, un chemin absolu doit devenir une URL file://
  // (le loader ESM rejette « C:\… » — piège documenté du projet).
  const mod = (await import(pathToFileURL(ptyModulePath(__dirname, isPackaged)).href)) as unknown as PtyModule
  if (typeof mod?.spawn !== "function") throw new Error("Le module PTY prébuildé n'expose pas spawn().")
  spawnImpl = mod.spawn
}

export function isFreebuffPtyActive(): boolean {
  return current !== null
}

const pushScrollback = (session: PtySession, chunk: string) => {
  session.scrollback += chunk
  if (session.scrollback.length > MAX_PTY_SCROLLBACK) {
    session.scrollback = session.scrollback.slice(session.scrollback.length - MAX_PTY_SCROLLBACK)
  }
}

const killSession = (session: PtySession) => {
  try { session.pty.kill() } catch { /* déjà mort */ }
  // Filet : taskkill sur l'arbre si kill() laissait des enfants derrière lui (best effort,
  // sans bloquer la fermeture de l'app — le process est détaché, jamais attendu).
  if (session.taskkill) return
  import("node:child_process")
    .then(({ spawn }) => {
      session.taskkill = spawn("taskkill", ["/pid", String(session.pty.pid), "/T", "/F"], { windowsHide: true })
    })
    .catch(() => { /* best effort */ }
  )
}

const clearTimers = () => {
  if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
  if (backoffTimer) { clearTimeout(backoffTimer); backoffTimer = null }
  if (restartTimer) { clearTimeout(restartTimer); restartTimer = null }
}

const scheduleRetry = (err: unknown) => {
  current = null
  if (stopped) return
  if (bootAttempts >= MAX_PTY_BOOT_ATTEMPTS) {
    // Épuisement des tentatives : UNE erreur claire à la vue, jamais de silence.
    events?.onError(`Impossible de démarrer freebuff après ${bootAttempts} tentatives : ${err instanceof Error ? err.message : String(err)}`)
    return
  }
  events?.onStatus("restarting")
  backoffTimer = setTimeout(() => spawnSession(cwdPending, sizePending.cols, sizePending.rows), ptyBackoffMs(bootAttempts))
}

const spawnSession = (cwd: string, cols: number, rows: number) => {
  if (stopped) return
  bootAttempts += 1
  events?.onStatus("starting")

  let pty: PtyProcess
  try {
    const cmd = buildPtyCommand(cwd)
    if (!spawnImpl) throw new Error("Module PTY non chargé (loadPtyModule attendu au boot).")
    pty = spawnImpl(cmd.file, cmd.args, { cwd, cols, rows, env: process.env as Record<string, string> })
  } catch (err) {
    scheduleRetry(err)
    return
  }

  const session: PtySession = { pty, taskkill: null, scrollback: "", cols, rows }
  current = session
  ptyPid = pty.pid

  pty.onData((chunk) => {
    // Garde : un chunk démesuré (TUI qui déborde) ne doit pas saturer l'émulateur.
    pushScrollback(session, chunk.length > MAX_CHUNK_CHARS ? chunk.slice(0, MAX_CHUNK_CHARS) : chunk)
    events?.onData(chunk)
  })

  // Grâce de boot : si le process survit à la fenêtre, plus de retry automatique.
  bootTimer = setTimeout(() => {
    bootTimer = null
    events?.onStatus("running")
  }, PTY_BOOT_GRACE_MS)

  pty.onExit(({ exitCode, signal }) => {
    if (stopped || current !== session) return
    const withinBootGrace = bootTimer !== null
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
    current = null
    if (withinBootGrace && bootAttempts < MAX_PTY_BOOT_ATTEMPTS) {
      scheduleRetry(new Error(`freebuff s'est arrêté au démarrage (code ${exitCode}) — ECONNRESET connu du CLI au boot.`))
      return
    }
    if (withinBootGrace) {
      events?.onError(`freebuff a échoué à démarrer après ${bootAttempts} tentatives (code ${exitCode}).`)
      return
    }
    events?.onExit(exitCode, typeof signal === "number" ? signal : undefined)
  })
}

/**
 * Démarre le PTY freebuff dans le dossier `cwd`, ou renvoie le scrollback de la session
 * déjà active (reconnexion d'une fenêtre sans relancer le process — la session freebuff
 * survit à la fermeture de la vue tant qu'Aven tourne).
 */
export function startFreebuffPty(opts: { cwd: string; cols?: number; rows?: number; handlers: FreebuffPtyEvents }): { replay: string } {
  cwdPending = opts.cwd
  sizePending = { cols: opts.cols ?? DEFAULT_PTY_COLS, rows: opts.rows ?? DEFAULT_PTY_ROWS }
  const firstAttach = !events
  events = opts.handlers
  stopped = false
  if (current) {
    // (revue v9.2.1) Si le boot est en cours, ré-armer le timer de grâce pour CET attach :
    // le timer du spawn d'origine n'est plus lié à la nouvelle vue et son expiration
    // émettrait un faux « running » (ou couvrirait la mauvaise fenêtre de temps).
    if (bootTimer) { clearTimeout(bootTimer); bootTimer = null }
    if (bootAttempts === 0) bootTimer = setTimeout(() => { bootTimer = null; events?.onStatus("running") }, PTY_BOOT_GRACE_MS)
    return { replay: current.scrollback }
  }
  // Nouveau démarrage : le compteur de boot repart de zéro (un stop l'a peut-être épuisé).
  if (firstAttach || bootAttempts >= MAX_PTY_BOOT_ATTEMPTS) bootAttempts = 0
  clearTimers()
  spawnSession(cwdPending, sizePending.cols, sizePending.rows)
  return { replay: "" }
}

export function writeFreebuffPty(data: string) {
  current?.pty.write(data)
}

export function resizeFreebuffPty(cols: number, rows: number) {
  sizePending = { cols, rows }
  if (!current) return
  // ConPTY redimensionne la console réelle : le TUI recalculera à son rythme.
  try { current.pty.resize(cols, rows); current.cols = cols; current.rows = rows } catch { /* resize pendant la mort */ }
}

/** Interrompre le tour en cours (équivalent Ctrl+C envoyé au TTY). */
export function signalFreebuffPty(_signal: "SIGINT") {
  writeFreebuffPty("\x03")
}

/** Redémarrage manuel : tue la session et relance une neuve (scrollback effacé). */
export function restartFreebuffPty() {
  if (!events) return
  stopped = false
  clearTimers()
  bootAttempts = 0
  const session = current
  current = null
  if (session) killSession(session)
  restartTimer = setTimeout(() => { if (!stopped) spawnSession(cwdPending, sizePending.cols, sizePending.rows) }, 300)
}

/** Tue le process et réinitialise l'état — uniquement à la FERMETURE de l'app. */
export function stopFreebuffPty() {
  stopped = true
  clearTimers()
  const session = current
  current = null
  if (session) killSession(session)
  events = null
}
