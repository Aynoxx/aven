import { execSync, spawn } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { WebSocket } from "ws"

const PORT = 9555
const EXE = path.resolve("src-tauri", "target", "debug", "aven.exe")
const OUT = path.resolve("docs", "audits", "2026-10-20-live")

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const log = (...a) => console.log("[" + new Date().toISOString() + "]", ...a)
const warn = (...a) => console.warn("[WARN]", ...a)

const killApp = () => { try { execSync("taskkill /IM aven.exe /F /T", { stdio: "pipe" }) } catch {} }

const build = () => { try { execSync("npm run build:web", { stdio: "pipe" }) } catch (e) { log("build:", e.message); throw e } }

const startApp = async () => {
  killApp(); await sleep(600)
  const proc = spawn(EXE, [], { env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${PORT}` }, stdio: "ignore" })
  proc.unref()
  // v10.3.2 : on attend que /json/list réponde AVANT d'ouvrir le WebSocket —
  // une connexion lancée à la construction lève ECONNREFUSED (mesuré).
  const deadline = Date.now() + 45000
  let target
  while (!target) {
    if (Date.now() >= deadline) throw new Error("port DevTools indisponible après 45 s")
    try {
      const list = JSON.parse(await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).text())
      target = list.find((x) => x.type === "page" && x.webSocketDebuggerUrl)
    } catch {}
    if (!target) await sleep(250)
  }
  const sock = new WebSocket(target.webSocketDebuggerUrl)
  sock.binaryType = "arraybuffer"
  sock.on("error", (e) => warn("ws error:", e.message))
  // Trace temporaire : toute réponse CDP est journalisée pour diagnostiquer
  // les evaluate sans réponse (évite un timeout aveugle).
  sock.on("message", (d) => log("CDP <<<", String(d).slice(0, 240)))
  await new Promise((resolve, reject) => {
    const t = setTimeout(() => reject(new Error("WebSocket DevTools non connecté")), 10000)
    sock.once("open", () => { clearTimeout(t); log("devtools ws open") ; resolve() })
    sock.once("error", (e) => { clearTimeout(t); reject(e) })
  })
  return { ws: sock, proc }
}

async function bringToFront(ws) { ws.send(JSON.stringify({ id: 1, method: "Page.bringToFront" })); await sleep(200) }
async function enable(ws) { ws.send(JSON.stringify({ id: 2, method: "Page.enable" })); await sleep(150) }

// v10.3.2 : CDP exige un id ENTIER (« Message must have integer 'id' property »,
// mesuré) — compteur monotone, jamais de chaîne aléatoire.
let cdpId = 100
// v10.3.2 : toute méthode CDP dont la réponse est un simple acquittement
// (result sans result.result) — le await des evaluate passait par là aussi.
const cdpSend = (ws, method, params = {}) => {
  const id = ++cdpId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeListener("message", onMsg); reject(new Error(`timeout ${method}`)) }, 5000)
    const onMsg = (data) => {
      let msg
      try { msg = JSON.parse(String(data)) } catch { return }
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeListener("message", onMsg)
      if (msg.error) reject(new Error(`${method}: ${msg.error.message}`))
      else resolve(msg.result)
    }
    ws.on("message", onMsg)
    ws.send(JSON.stringify({ id, method, params }))
  })
}

const ev = (ws, expr) => {
  const id = ++cdpId
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { ws.removeListener("message", onMsg); reject(new Error("timeout eval")) }, 5000)
    const onMsg = (data) => {
      let msg
      try { msg = JSON.parse(String(data)) } catch { return }
      if (msg.id !== id) return
      clearTimeout(timer)
      ws.removeListener("message", onMsg)
      if (msg.error) { warn("eval error:", msg.error.message); reject(new Error(msg.error.message)) }
      else {
        // Réponse CDP : { id, result: { result: <RemoteObject> } } — la valeur est
        // dans result.result.value (msg.result.value serait toujours undefined).
        const value = msg.result?.result?.value
        log(`ev#${id} ->`, String(JSON.stringify(value)).slice(0, 80))
        resolve(value)
      }
    }
    ws.on("message", onMsg)
    ws.send(JSON.stringify({ id, method: "Runtime.evaluate", params: { expression: expr, returnByValue: true, awaitPromise: true, userGesture: true } }))
  })
}

// v10.3.2 : les événements sont dispatchés sur l'élément RÉEL sous le point
// (elementFromPoint) — dispatcher sur document fait de document la cible et le
// bouton, descendant, ne reçoit jamais l'événement (mesuré : clic sans effet).
const clickAt = (ws, x, y) => ev(ws, `(() => {
  const el = document.elementFromPoint(${x}, ${y})
  if (!el) return 'NO_TARGET'
  const opts = { clientX: ${x}, clientY: ${y}, bubbles: true, cancelable: true, button: 0, buttons: 1 }
  el.dispatchEvent(new MouseEvent('pointerdown', opts))
  el.dispatchEvent(new MouseEvent('mousedown', { ...opts, buttons: 1 }))
  el.dispatchEvent(new MouseEvent('pointerup', { ...opts, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('mouseup', { ...opts, buttons: 0 }))
  el.dispatchEvent(new MouseEvent('click', { ...opts, buttons: 0 }))
  return el.tagName + '.' + el.className
})()`)

const pressEscape = (ws) => { ev(ws, "void window.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Escape', code: 'Escape', bubbles: true })); void window.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Escape', code: 'Escape', bubbles: true }))") }

const check = (a, msg) => { if (!a) { log("FAIL:", msg); throw new Error("FAIL: " + msg) } }

async function main() {
  await fs.promises.mkdir(OUT, { recursive: true }).catch((e) => { if (e.code !== "EEXIST") throw e })

  log("build.."); build(); log("build done")
  // v10.3.2 : le signal système de cette machine reste `reduce` (mesuré : SPI_GET
  // = 0, la clé ClientAreaAnimation et les switches Chromium sont ignorés par
  // WebView2). Le levier fiable est l'ÉMULATION CDP — Emulation.setEmulatedMedia
  // change ce que matchMedia rapporte à la page, exactement ce que le code lit.
  // Aucune modification du réglage de la machine : rien à restaurer.
  try {
    await runMeasure()
  } finally {
    log("kill"); try { killApp() } catch {}
  }
  log("done")
}

async function runMeasure() {
  log("killing existing app.."); killApp(); await sleep(600)
  log("start app")
  const { ws } = await startApp()
  await bringToFront(ws); await enable(ws); await sleep(800)

  // Forcer no-preference AVANT le premier rendu utile : le garde reduce de
  // view-transitions.ts lit matchMedia à chaque transition.
  await cdpSend(ws, "Emulation.setEmulatedMedia", {
    features: [{ name: "prefers-reduced-motion", value: "no-preference" }],
  })
  const reduceNow = await ev(ws, "matchMedia('(prefers-reduced-motion: reduce)').matches")
  check(reduceNow === false, "émulation posée : reduce=false (reçu: " + String(reduceNow) + ")")
  log("émulation CDP : reduce=false, no-preference actif")

  log("hub: attente du rendu")
  const hubDeadline = Date.now() + 20000
  let hub = false
  while (!hub && Date.now() < hubDeadline) {
    hub = Boolean(await ev(ws, "!!document.querySelector('.home-hub')"))
    if (!hub) await sleep(300)
  }
  if (!hub) {
    const etat = await ev(ws, "({ title: document.title, body: (document.body?.innerText || '').slice(0, 300) })")
    log("DOM au moment de l'échec:", etat)
  }
  check(hub, "hub visible")
  const cards = await ev(ws, "Array.from(document.querySelectorAll('.hub-card')).map((c) => { const r = c.getBoundingClientRect(); return { ns: c.className.replace('hub-card ',''), x: Math.round(r.left), y: Math.round(r.top) } })")
  log("cards:", cards)
  let rects = new Set(cards.map((c) => [c.x, c.y]))
  check(rects.size === 4, "4 cartes distinctes attendues, eu " + rects.size)
  let trans = await ev(ws, "typeof document.startViewTransition")
  check(trans === "function", "document.startViewTransition est une fonction (reçu: " + String(trans) + ")")

  const cardRects = await ev(ws, `Object.fromEntries(Array.from(document.querySelectorAll('.hub-card')).map((c) => { const r = c.getBoundingClientRect(); return [c.className.replace('hub-card ', ''), { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) }] }))`)
  const notesRect = cardRects["hub-card-notes"]
  const filesRect = cardRects["hub-card-files"]
  const tasksRect = cardRects["hub-card-agents"]
  const projectRect = cardRects["hub-card-project"]
  check(notesRect && notesRect.w > 0, "notes visible")
  check(filesRect && filesRect.w > 0, "files visible")
  check(tasksRect && tasksRect.w > 0, "tâches visible")
  check(projectRect && projectRect.w > 0, "projet visible")

  const VT_COUNT = `Array.from(document.getAnimations()).filter((a) => (a.effect && a.effect.pseudoElement || '').startsWith('::view-transition')).length`
  const VT_SOURCE = `document.documentElement.dataset.vtSource || null`
  const DURING = `({ s: ${VT_SOURCE}, a: ${VT_COUNT}, p: !!document.querySelector('.page-main') })`
  const FINAL = `({ h: !!document.querySelector('.home-hub'), p: !!document.querySelector('.page-main'), t: document.querySelector('.page-heading h1') ? document.querySelector('.page-heading h1').textContent : null, s: ${VT_SOURCE}, a: ${VT_COUNT} })`

  // v10.3.2 : deux échantillons par carte — PENDANT la transition (~80 ms, la
  // source et les animations existent encore) puis l'état FINAL (~400 ms, morph
  // terminé, source libérée). Un seul échantillon tardif mesurait toujours
  // « source nulle, 0 animation » et prouvait donc rien (mesuré).
  const clickAndSample = async (rect, label) => {
    log(`click ${label}`)
    const target = await clickAt(ws, rect.x + rect.w / 2, rect.y + rect.h / 2)
    log(`${label} cible:`, target)
    await sleep(80)
    const during = await ev(ws, DURING)
    log(`${label} pendant:`, during)
    await sleep(450); await bringToFront(ws)
    const fin = await ev(ws, FINAL)
    log(`${label} final:`, fin)
    return { during, final: fin }
  }

  const escToHome = async (label) => {
    await pressEscape(ws); await sleep(450); await bringToFront(ws)
    const etat = await ev(ws, FINAL)
    log(`${label} après Échap:`, etat)
    check(etat.h, `${label} : retour au hub visible`)
    check(etat.s === null, `${label} : source libérée après Échap`)
    return etat
  }

  const notesM = await clickAndSample(notesRect, "notes")
  check(notesM.final.p, "notes : page visible")
  check(notesM.final.s === null, "notes : source libérée en fin de morph")
  check(notesM.during.s === "notes", "notes : source = notes PENDANT la transition (reçu: " + String(notesM.during.s) + ")")
  check(notesM.during.a > 0, "notes : animations view transition PENDANT (reçu: " + String(notesM.during.a) + ")")
  const afterEsc = await escToHome("notes")

  const filesM = await clickAndSample(filesRect, "files")
  check(filesM.final.p, "files : page visible")
  check(filesM.during.s === "files", "files : source = files pendant (reçu: " + String(filesM.during.s) + ")")
  check(filesM.during.a > 0, "files : animations view transition pendant (reçu: " + String(filesM.during.a) + ")")
  await escToHome("files")

  const tasksM = await clickAndSample(tasksRect, "tasks")
  check(tasksM.final.p, "tasks : page visible")
  check(tasksM.during.s === "tasks", "tasks : source = tasks pendant (reçu: " + String(tasksM.during.s) + ")")
  check(tasksM.during.a > 0, "tasks : animations view transition pendant (reçu: " + String(tasksM.during.a) + ")")
  await escToHome("tasks")

  const projectM = await clickAndSample(projectRect, "project")
  check(projectM.final.p, "project : page visible")
  check(projectM.during.s === "project", "project : source = project pendant (reçu: " + String(projectM.during.s) + ")")
  check(projectM.during.a > 0, "project : animations view transition pendant (reçu: " + String(projectM.during.a) + ")")
  const afterEscProject = await escToHome("project")

  log("save")
  const result = {
    emulation: "Emulation.setEmulatedMedia prefers-reduced-motion=no-preference (le signal OS de cette machine reste reduce — mesuré)",
    cards,
    notes: notesM, afterEscNotes: afterEsc,
    files: filesM,
    tasks: tasksM,
    project: projectM, afterEscProject,
  }
  await fs.promises.mkdir(OUT, { recursive: true }).catch((e) => { if (e.code !== "EEXIST") throw e })
  await fs.promises.writeFile(path.join(OUT, "mesures-animee.json"), JSON.stringify(result, null, 2))
  log("saved")
}
main().catch((e) => { console.error(e); process.exitCode = 1; throw e })
