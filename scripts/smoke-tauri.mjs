// v10.0.0 : fumée Tauri en conditions réelles — deux étapes :
//  1) binaire autonome (target/debug/aven.exe, protocole custom) : rendu des
//     assets embarqués + CSP de production qui bloque RÉELLEMENT un fetch externe
//     (preuve : rejet + message « Content Security Policy » capturé en console) ;
//  2) npm run tauri:dev : contrôles custom absents (la barre Windows native porte
//     la fermeture), puis reprise après CRASH RÉEL du runtime Node (on tue
//     l'enfant, la requête suivante doit le relancer sous budget 3/min).
// On pilote la webview par le débogueur CDP de WebView2
// (WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port). Chenfils toujours
// en fichiers/ignore : un exe GUI qui hérite du pipe du shell ne rend jamais la main.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, openSync, rmSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"

const CDP_PORT = 9333
const EXE = "src-tauri/target/debug/aven.exe"
const DEV_LOG = "smoke-tauri-dev.log"
const BIN_LOG = "smoke-tauri-bin.log"

const results = []
function record(stage, id, ok, detail) {
  results.push({ stage, id, ok, detail })
  const tag = ok === null ? "SKIP" : ok ? "PASS" : "FAIL"
  console.log(`[${tag}] ${stage} · ${id}${detail ? " — " + detail : ""}`)
}
const failCount = () => results.filter((r) => r.ok === false).length

function sh(command) {
  const r = spawnSync(command, { shell: true, encoding: "utf8", windowsHide: true })
  return (r.stdout ?? "") + (r.stderr ?? "")
}

function avenPids() {
  const out = sh("tasklist /FI \"IMAGENAME eq aven.exe\" /NH")
  return [...out.matchAll(/aven\.exe\s+(\d+)/gi)].map((m) => Number(m[1]))
}

function killTree(pid) {
  if (pid) sh(`taskkill /PID ${pid} /T /F`)
}

function portOwner(port) {
  const out = sh(`netstat -ano | findstr :${port} | findstr LISTENING`)
  const match = out.match(new RegExp(`:${port}\\s+[^\\n]+LISTENING\\s+(\\d+)`))
  return match ? Number(match[1]) : null
}

function nodeHostPids() {
  const ps =
    "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | " +
    "Where-Object { $_.CommandLine -like '*aven-app-host*' } | " +
    "ForEach-Object { $_.ProcessId }"
  const out = sh(`powershell.exe -NoProfile -NonInteractive -Command "${ps.replaceAll('"', '\\"')}"`)
  return [...out.matchAll(/\d+/g)].map((m) => Number(m[0])).filter(Boolean)
}

// ── CDP minimal (WebSocket intégré à Node) ───────────────────────────────────
class Cdp {
  constructor(url) {
    this.url = url
    this.nextId = 1
    this.pending = new Map()
    this.logs = []
  }
  open() {
    this.ws = new WebSocket(this.url)
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === "Runtime.consoleAPICalled") {
        const text = (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" ")
        this.logs.push(`${msg.params.type}: ${text}`)
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.logs.push("exception: " + String(msg.params.exceptionDetails?.exception?.description ?? msg.params.exceptionDetails?.text))
      } else if (msg.method === "Log.entryAdded") {
        this.logs.push(`${msg.params.entry.level}: ${msg.params.entry.text}`)
      }
      const entry = this.pending.get(msg.id)
      if (entry) {
        this.pending.delete(msg.id)
        if (msg.error) entry.reject(new Error("CDP " + msg.error.message))
        else entry.resolve(msg.result)
      }
    }
    this.ws.onerror = () => {}
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = () => reject(new Error("WebSocket CDP injoignable"))
    })
  }
  send(method, params = {}) {
    const id = this.nextId++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  async enable() {
    await this.send("Runtime.enable")
    await this.send("Log.enable").catch(() => undefined)
  }
  async close() {
    try {
      this.ws.close()
    } catch {}
  }
  /** Évalue dans la page, renvoie la valeur déserialisée (throw si exception JS). */
  async eval(expression, { awaitPromise = false, timeoutMs = 30_000 } = {}) {
    const result = await Promise.race([
      this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true }),
      sleep(timeoutMs).then(() => Promise.reject(new Error("évaluation CDP expirée"))),
    ])
    if (result.exceptionDetails) {
      const text =
        result.exceptionDetails.exception?.description ??
        result.exceptionDetails.text ??
        "exception inconnue"
      throw new Error(text.slice(0, 300))
    }
    return result.result?.value
  }
}

async function listTargets() {
  try {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 4_000)
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: controller.signal })
    clearTimeout(timer)
    if (!res.ok) return []
    return await res.json()
  } catch {
    return []
  }
}

async function waitForPage(matchUrl, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const targets = await listTargets()
    const page = targets.find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (page && matchUrl.test(page.url)) return page
    await sleep(1_000)
  }
  const targets = await listTargets()
  const seen = targets.map((t) => t.url).join(", ") || "aucune cible"
  throw new Error(`pas de page ${matchUrl} sous ${timeoutMs} ms (vu : ${seen})`)
}

async function waitForExpression(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try {
      last = await cdp.eval(expression, { timeoutMs: 5_000 })
      if (last) return last
    } catch (error) {
      last = String(error)
    }
    await sleep(1_000)
  }
  throw new Error(`condition jamais satisfaite sous ${timeoutMs} ms (dernier : ${last})`)
}

// ── Scénarios injectés dans la page ──────────────────────────────────────────
const EXPR_PATH = `({ href: location.href, opencode: typeof window.opencode, tauri: typeof (window.__TAURI_INTERNALS__ && window.__TAURI_INTERNALS__.invoke) })`

// La barre de fermeture custom (héritée d'Electron frameless) a été supprimée :
// la fumée vérifie qu'aucun contrôle custom ne subsiste et que la chrome reste
// montée — c'est la barre Windows native qui minimise/agrandit/ferme.
const EXPR_BARRE = `({
  chrome: document.querySelectorAll(".window-chrome").length,
  controles: document.querySelectorAll(".window-controls").length
})`

const EXPR_CSP = `fetch("https://example.com/", { mode: "cors" })
  .then((r) => "ALLOWED:" + r.status, (e) => "BLOCKED:" + e.name + ":" + String(e.message).slice(0, 120))
  .then((ext) => fetch("index.html").then(
    (r) => ({ ext, self: "SELF:" + r.status, header: r.headers.get("content-security-policy") }),
    (e) => ({ ext, self: "SELF_ERR:" + String(e).slice(0, 120), header: null })
  ))`

const EXPR_STATE = `window.__TAURI_INTERNALS__
  ? window.__TAURI_INTERNALS__.invoke("aven_call", { method: "state", args: [] })
      .then((s) => ({ ok: 1, status: s && s.status, needsWorkspace: !!(s && s.needsWorkspace), error: s && s.error }), (e) => ({ ok: 0, error: String(e).slice(0, 240) }))
  : Promise.resolve({ ok: 0, error: "pas de __TAURI_INTERNALS__" })`

async function checkPath(stage, cdp) {
  await waitForExpression(cdp, `document.readyState === "complete" && document.querySelectorAll(".window-chrome").length >= 1`, 30_000)
  const path = await cdp.eval(EXPR_PATH)
  const sousTauri = path.opencode === "undefined" && path.tauri === "function"
  record(stage, "renderer-tauri", sousTauri, `window.opencode=${path.opencode}, __TAURI_INTERNALS__.invoke=${path.tauri}`)
}

// CSPA binaire : preuve par le message de violation en console (le rejet seul
// « Failed to fetch » ne distingue pas CSP et panne réseau).
async function checkCspBinary(cdp) {
  const mark = cdp.logs.length
  const csp = await cdp.eval(EXPR_CSP, { awaitPromise: true, timeoutMs: 20_000 })
  await sleep(600)
  const consoleCsp = cdp.logs.slice(mark).find((l) => /Content Security Policy/i.test(l))
  const rejete = csp.ext.startsWith("BLOCKED:")
  record("binaire", "csp-blocage-externe", rejete && Boolean(consoleCsp), `ext=${csp.ext.slice(0, 90)} | console=${consoleCsp ? consoleCsp.slice(0, 150) : "aucun message CSP"}`)
  record("binaire", "csp-meme-origine", csp.self.startsWith("SELF:200"), `self=${csp.self}`)
  record("binaire", "csp-info", null, `header=${csp.header ? csp.header.slice(0, 100) : "non exposé par le protocole (le blocage console fait foi)"}`)
}

// Barre native : plus de contrôles custom dans le DOM — la fermeture appartient
// à la barre Windows de Tauri (décorations par défaut).
async function checkBarreNative(stage, cdp) {
  const barre = await cdp.eval(EXPR_BARRE)
  record(
    stage,
    "barre-native",
    barre.chrome >= 1 && barre.controles === 0,
    `chrome=${barre.chrome}, contrôles custom=${barre.controles}`
  )
}

// Reprise après crash : on tue l'enfant Node, la requête suivante doit le
// relancer (budget 3/min) au lieu de plaquer « Le runtime Aven s'est arrêté ».
async function stageCrash(stage, cdp) {
  const avant = await cdp.eval(EXPR_STATE, { awaitPromise: true, timeoutMs: 60_000 })
  if (!avant.ok || avant.needsWorkspace || avant.status !== "ready") {
    record(stage, "reprise-crash", null, `runtime non prêt : ${JSON.stringify(avant)}`)
    return
  }
  const pidAvant = nodeHostPids()[0]
  if (!pidAvant) {
    record(stage, "reprise-crash", null, "aucun enfant node aven-app-host à tuer")
    return
  }

  sh(`powershell.exe -NoProfile -NonInteractive -Command "Stop-Process -Id ${pidAvant} -Force"`)
  await sleep(1_500)

  const apres = await cdp.eval(EXPR_STATE, { awaitPromise: true, timeoutMs: 40_000 })
  if (!apres.ok) {
    record(stage, "reprise-crash", false, `état KO après kill (pid ${pidAvant}) : ${JSON.stringify(apres)}`)
    return
  }

  let pidApres = null
  const deadline = Date.now() + 15_000
  while (Date.now() < deadline && !pidApres) {
    pidApres = nodeHostPids().find((pid) => pid !== pidAvant) ?? null
    if (!pidApres) await sleep(1_000)
  }
  const arreté = /s.est arrêté/i.test(JSON.stringify(apres))
  const ok = apres.status === "ready" && !arreté && Boolean(pidApres)
  record(stage, "reprise-crash", ok, `pid ${pidAvant} → ${pidApres ?? "inconnu"}, état=${apres.status}, erreur=${arreté ? "OUI" : "non"}`)
}

// ── Étape 1 : binaire autonome (CSP de production) ───────────────────────────
async function stageBinary() {
  const stage = "binaire"
  if (!existsSync(EXE)) {
    record(stage, "disponible", null, `${EXE} absent — lancer npm run tauri:check`)
    return
  }
  writeFileSync(BIN_LOG, `=== fumée binaire ${new Date().toISOString()} ===\n`)
  const fd = openSync(BIN_LOG, "a")
  const exe = spawn(EXE, [], {
    detached: true,
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
  })
  let cdp
  try {
    // Ignorer about:blank (WebView2 en cours d'init) : on attend une VRAIE URL.
    const page = await waitForPage(/^(?!about:)/, 20_000)
    if (!/tauri\.localhost/.test(page.url)) {
      record(stage, "rendu-assets", null, `exe en forme dev (${page.url}) — relancer npm run tauri:check avant l'étape binaire`)
      return
    }
    record(stage, "rendu-assets", true, page.url)
    cdp = new Cdp(page.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.enable()
    await checkPath(stage, cdp)
    await checkCspBinary(cdp)
    await checkBarreNative(stage, cdp)
  } catch (error) {
    record(stage, "demarrage", false, String(error.message ?? error))
  } finally {
    await cdp?.close()
    killTree(exe.pid)
  }
}

// ── Étape 2 : npm run tauri:dev (barre native + reprise après crash) ────────
async function stageDev() {
  const stage = "dev"
  writeFileSync(DEV_LOG, `=== fumée dev ${new Date().toISOString()} ===\n`)
  const fd = openSync(DEV_LOG, "a")
  // cmd.exe direct, SANS detached : sous Windows, detached casse l'héritage des
  // handles de stdio pour les descendants (cmd écrit → ok ; npm/node → journal
  // vide), et shell:true + detached casse pareil. Testé : cmd + windowsHide
  // sans detached capture bien la chaîne npm.
  const dev = spawn("cmd.exe", ["/c", "npm run tauri:dev"], {
    stdio: ["ignore", fd, fd],
    windowsHide: true,
    env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
  })
  let cdp
  try {
    const page = await waitForPage(/127\.0\.0\.1:5173/, 180_000)
    record(stage, "demarrage", true, page.url)
    cdp = new Cdp(page.webSocketDebuggerUrl)
    await cdp.open()
    await cdp.enable()
    await checkPath(stage, cdp)
    // devCsp est inerte avec un devUrl externe : Tauri n'injecte la CSP que par
    // son pipeline de protocole custom (tauri-2.12.1 manager/mod.rs → get_asset),
    // jamais dans le HTML servi par Vite. On le constate sans le faire échouer.
    record(stage, "csp-dev", null, "devUrl externe : injection CSP impossible (limitation Tauri, le blocage est prouvé sur le binaire)")
    await stageCrash(stage, cdp)
    await checkBarreNative(stage, cdp)
  } catch (error) {
    record(stage, "demarrage", false, String(error.message ?? error))
  } finally {
    await cdp?.close()
    killTree(dev.pid)
    // Vite peut survivre au kill de l'arbre npm : le port était libre au départ,
    // le propriétaire actuel est donc le nôtre.
    const owner = portOwner(5173)
    if (owner) {
      killTree(owner)
      record(stage, "nettoyage-vite", null, `pid vite résiduel ${owner} éliminé`)
    }
  }
}

// ── Store d'espaces (cas CI) ────────────────────────────────────────────────
// Sans store actif, boot_runtime renvoie needsWorkspace : la reprise après crash
// ne serait jamais exercée (SKIP). Sur un runner vierge (aucun workspaces.json),
// on provisionne UN store temporaire — un store existant n'est jamais touché —
// puis on le supprime au nettoyage. Format : celui de write_workspace_store
// ({ list: [{ path, name }], active }) avec la MEME chaîne des deux côtés
// (active_workspace exige l'égalité stricte + dossier existant).
function provisionnerStore() {
  if (!process.env.APPDATA) return null
  const dossier = path.join(process.env.APPDATA, "Aven")
  const store = path.join(dossier, "workspaces.json")
  if (existsSync(store)) return null
  const dossierCree = !existsSync(dossier)
  const espace = mkdtempSync(path.join(os.tmpdir(), "aven-smoke-"))
  mkdirSync(dossier, { recursive: true })
  writeFileSync(
    store,
    JSON.stringify({ list: [{ path: espace, name: "Smoke" }], active: espace }, null, 2)
  )
  console.log(`Store d'espaces absent → provisionné pour la fumée : ${espace}`)
  return { dossier, store, espace, dossierCree }
}

function nettoyerStore(provisionne) {
  if (!provisionne) return
  try { rmSync(provisionne.espace, { recursive: true, force: true }) } catch {}
  try { rmSync(provisionne.store, { force: true }) } catch {}
  if (provisionne.dossierCree) {
    try { rmSync(provisionne.dossier, { recursive: true, force: true }) } catch {}
  }
  console.log("Store d'espaces temporaire de la fumée nettoyé.")
}

// ── Principal ────────────────────────────────────────────────────────────────
console.log("Fumée Tauri v10.0.0 — CDP port " + CDP_PORT)

if (avenPids().length > 0) {
  console.error("ABANDON : aven.exe tourne déjà (instance unique) — fermer Aven puis relancer.")
  process.exit(2)
}
const port5173Pris = portOwner(5173) !== null
if (port5173Pris) {
  console.warn("⚠ port 5173 déjà occupé — l'étape dev sera ignorée (serveur existant non touché).")
}
const provisionne = provisionnerStore()

await stageBinary()

if (avenPids().length > 0) {
  record("dev", "demarrage", false, "l'instance autonome survit encore — étape dev sautée")
} else if (port5173Pris) {
  record("dev", "demarrage", null, "port 5173 occupé par un serveur existant")
} else if ((await listTargets()).some((t) => t.url?.includes("tauri.localhost"))) {
  record("dev", "demarrage", false, "instance autonome résiduelle — étape dev sautée")
} else {
  await stageDev()
}

// Filet de sécurité : aucun aven.exe ni serveur vite ne doit survivre.
await sleep(2_000)
const restants = avenPids()
for (const pid of restants) killTree(pid)
if (restants.length > 0) record("nettoyage", "arbre-nettoye", null, `pid restants éliminés : ${restants.join(", ")}`)
if (!port5173Pris) {
  const owner = portOwner(5173)
  if (owner) {
    killTree(owner)
    record("nettoyage", "port-5173", null, `pid résiduel ${owner} éliminé`)
  }
}
nettoyerStore(provisionne)

console.log("\n── Récapitulatif ──")
const skips = results.filter((r) => r.ok === null).length
console.log(`${results.length} vérifications : ${results.length - skips - failCount()} PASS, ${failCount()} FAIL, ${skips} SKIP`)
if (existsSync(DEV_LOG)) console.log(`Journaux : ${DEV_LOG}, ${BIN_LOG}`)
process.exit(failCount() > 0 ? 1 : 0)
