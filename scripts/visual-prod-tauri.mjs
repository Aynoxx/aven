// Vérification visuelle du build de PRODUCTION (binaire target/debug embarquant
// web/dist) : on pilote la vraie webview WebView2 par CDP — pas de dev server.
// Contrôles : origine tauri.localhost, hub rendu, CSP qui bloque réellement
// l'extérieur, thèmes clair/sombre (data-theme + capture PNG), restauration du
// réglage de thème d'origine. Captures écrites dans artifacts/.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const CDP_PORT = 9444
const EXE = "src-tauri/target/debug/aven.exe"
const OUT = "artifacts"
const LOG = "visual-prod-tauri.log"

const lines = []
let exeProc = null // arbre à tuer à la sortie : process.exit saute les finally
const say = (m) => { console.log(m); lines.push(m) }
const fail = (m) => { say("FAIL · " + m); finish(1) }
function finish(code) {
  if (exeProc?.pid) { try { sh(`taskkill /PID ${exeProc.pid} /T /F`) } catch {} }
  writeFileSync(LOG, lines.join("\n") + "\n")
  process.exit(code)
}

function sh(command) {
  const r = spawnSync(command, { shell: true, encoding: "utf8", windowsHide: true })
  return (r.stdout ?? "") + (r.stderr ?? "")
}

if (!existsSync(EXE)) fail(`${EXE} absent — lancer npm run tauri:check`)
mkdirSync(OUT, { recursive: true })

// ── CDP minimal (WebSocket natif Node) ───────────────────────────────────────
class Cdp {
  constructor(url) { this.url = url; this.nextId = 1; this.pending = new Map(); this.logs = [] }
  open() {
    this.ws = new WebSocket(this.url)
    this.ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.method === "Runtime.consoleAPICalled") {
        this.logs.push(msg.params.type + ": " + (msg.params.args ?? []).map((a) => a.value ?? a.description ?? "").join(" "))
      } else if (msg.method === "Runtime.exceptionThrown") {
        this.logs.push("exception: " + String(msg.params.exceptionDetails?.exception?.description ?? ""))
      } else if (msg.method === "Log.entryAdded") {
        this.logs.push(msg.params.entry.level + ": " + msg.params.entry.text)
      }
      const entry = this.pending.get(msg.id)
      if (entry) { this.pending.delete(msg.id); msg.error ? entry.reject(new Error("CDP " + msg.error.message)) : entry.resolve(msg.result) }
    }
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
  async eval(expression, { awaitPromise = false } = {}) {
    const result = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise, userGesture: true })
    if (result.exceptionDetails) throw new Error(String(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text).slice(0, 300))
    return result.result?.value
  }
  async shot(file) {
    const { data } = await this.send("Page.captureScreenshot", { format: "png" })
    writeFileSync(file, Buffer.from(data, "base64"))
  }
  close() { try { this.ws.close() } catch {} }
}

async function listTargets() {
  try {
    const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`, { signal: AbortSignal.timeout(4_000) })
    return res.ok ? await res.json() : []
  } catch { return [] }
}

async function waitForPage(timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    const page = (await listTargets()).find((t) => t.type === "page" && t.webSocketDebuggerUrl)
    if (page && !/about:blank/.test(page.url)) return page
    await sleep(1_000)
  }
  throw new Error("pas de page CDP sous " + timeoutMs + " ms")
}

async function waitFor(cdp, expression, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  let last = null
  while (Date.now() < deadline) {
    try { last = await cdp.eval(expression, { awaitPromise: true }); if (last) return last } catch (error) { last = String(error) }
    await sleep(1_000)
  }
  throw new Error(`condition jamais satisfaite sous ${timeoutMs} ms (dernier : ${last})`)
}

// ── Lancement du binaire de production avec débogueur WebView2 ───────────────
const fd = openSync(LOG + ".raw", "a")
const exe = spawn(EXE, [], {
  detached: true,
  stdio: ["ignore", fd, fd],
  windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
})
exeProc = exe
say(`binaire pid ${exe.pid}`)

let cdp
try {
  const page = await waitForPage(45_000)
  say(`page : ${page.url}`)
  cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send("Runtime.enable").catch(() => undefined)
  await cdp.send("Log.enable").catch(() => undefined)
  await cdp.send("Page.enable").catch(() => undefined)

  // 1) Origine production + assets embarqués rendus.
  await waitFor(cdp, `document.readyState === "complete" && document.querySelectorAll(".window-chrome").length >= 1`, 30_000)
  const href = await cdp.eval("location.href")
  if (!/tauri\.localhost/.test(href)) fail(`origine inattendue : ${href}`)
  say(`PASS · origine production (${href})`)

  // 2) Espace vide supprimé : sur l'accueil la barre reste au DOM (attendue par
  //    les sondes) mais n'occupe plus aucune place sous la barre native.
  const barre = await cdp.eval(`(() => { const el = document.querySelector(".window-chrome"); if (!el) return { absent: true }; const r = el.getBoundingClientRect(); return { display: getComputedStyle(el).display, h: r.height } })()`)
  if (barre.absent || barre.display !== "none" || barre.h !== 0) fail(`barre vide encore présente sur l'accueil : ${JSON.stringify(barre)}`)
  say(`PASS · barre vide absente de l'accueil (display=${barre.display}, hauteur=${barre.h}px)`)

  // 3) Fenêtre maximisée au lancement (1366 d'écran vs 1200 fenêtré).
  const geo = await cdp.eval(`({ iw: innerWidth, aw: screen.availWidth })`)
  if (geo.aw <= 1216) fail(`écran trop étroit pour conclure : availWidth=${geo.aw}`)
  if (geo.iw < geo.aw - 16) fail(`fenêtre non maximisée : innerWidth=${geo.iw}, écran=${geo.aw}`)
  say(`PASS · fenêtre maximisée au lancement (innerWidth=${geo.iw} ≈ écran ${geo.aw})`)

  // 4) CSP de production : l'extérieur est réellement bloqué (message console).
  const mark = cdp.logs.length
  const csp = await cdp.eval(`fetch("https://example.com/", { mode: "cors" })
    .then((r) => "ALLOWED:" + r.status, (e) => "BLOCKED:" + e.name + ":" + String(e.message).slice(0, 120))
    .then((ext) => fetch("index.html").then((r) => ({ ext, self: "SELF:" + r.status }), (e) => ({ ext, self: "SELF_ERR" })))`, { awaitPromise: true })
  await sleep(600)
  const consoleCsp = cdp.logs.slice(mark).find((l) => /Content Security Policy/i.test(l))
  if (!csp.ext.startsWith("BLOCKED:") || !consoleCsp) fail(`CSP non prouvée : ${JSON.stringify(csp)} | console=${consoleCsp ?? "aucune"}`)
  say(`PASS · CSP bloque l'extérieur (${csp.ext.slice(0, 70)} ; self=${csp.self})`)

  // 5) Le runtime Node réel répond derrière la façade Tauri.
  const state = await waitFor(cdp, `window.__TAURI_INTERNALS__.invoke("aven_call", { method: "state", args: [] }).then((s) => s && s.status === "ready" ? "ready" : null, () => null)`, 90_000)
  say(`PASS · runtime ${state} via aven_call`)

  // 6) Thème d'origine relevé, puis rendus clair + sombre avec captures.
  const theme0 = await cdp.eval(`JSON.parse(localStorage.getItem("aven.appearance.v3") || "{}").theme || "light"`)
  say(`theme d'origine : ${theme0}`)
  const setTheme = (t) => cdp.eval(`(() => { const v = JSON.parse(localStorage.getItem("aven.appearance.v3") || "{}"); v.theme = ${JSON.stringify(t)}; localStorage.setItem("aven.appearance.v3", JSON.stringify(v)); location.reload(); return 1 })()`)

  for (const theme of ["light", "dark"]) {
    await setTheme(theme)
    await waitFor(cdp, `document.readyState === "complete" && document.querySelectorAll(".home-hub, .window-chrome").length >= 1 && document.documentElement.dataset.theme === "${theme === "dark" ? "dark" : "light"}"`, 30_000)
    await sleep(700)
    const file = `${OUT}/prod-hub-${theme}.png`
    await cdp.shot(file)
    say(`PASS · capture ${file} (data-theme=${await cdp.eval("document.documentElement.dataset.theme")})`)
    if (theme === "dark") {
      // Page Tâches en sombre : clic réel sur la carte du hub.
      await cdp.eval(`[...document.querySelectorAll("button")].find((b) => /Spécialistes par tâche/.test(b.getAttribute("aria-label") || b.textContent))?.click()`)
      await waitFor(cdp, `document.querySelectorAll(".tasks-principal-card").length >= 1`, 10_000)
      await sleep(500)
      await cdp.shot(`${OUT}/prod-tasks-dark.png`)
      say(`PASS · capture ${OUT}/prod-tasks-dark.png`)
    }
  }

  // 7) Restauration du réglage de thème d'origine.
  await setTheme(theme0)
  await waitFor(cdp, `document.documentElement.dataset.theme === "${theme0 === "dark" ? "dark" : "light"}"`, 15_000)
  say(`PASS · thème restauré (${theme0})`)
  say("VISUEL PROD : OK")
  finish(0)
} catch (error) {
  fail(String(error?.message ?? error))
} finally {
  cdp?.close()
  // le kill du binaire est fait par finish() : process.exit sauterait un finally
}
