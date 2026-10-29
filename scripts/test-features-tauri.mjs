// v12.0.0 : parcours fonctionnel de TOUTES les fonctionnalités de l'app sur le
// binaire de production (webview WebView2 réelle, pas de dev server).
// Modèle testé : le Poste « agent d'abord » — accueil minimal, constellation
// TEMPORAIRE à cinq cercles, agent unique replié dans l'en-tête, historique de
// conversations visible par défaut, barre de commande à la demande sur l'accueil.
// Les contrôles fonctionnels sont bloquants (exit 1) ; les constats d'ergonomie
// sont des WARN imprimées et comptabilisées (exit 0).
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, openSync, writeFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const CDP_PORT = 9555
const EXE = "src-tauri/target/debug/aven.exe"
const OUT = "artifacts"
const LOG = "test-features.log"

const lines = []
let exeProc = null
let echecs = 0
let warns = 0
const say = (m) => { console.log(m); lines.push(m) }
const pass = (m) => say(`PASS · ${m}`)
const warn = (m) => { warns++; say(`WARN · ${m}`) }
const fail = (m) => { echecs++; say(`FAIL · ${m}`) }
function finish(code) {
  say(`\nBilan : ${echecs} échec(s) fonctionnel(s), ${warns} avertissement(s) d'ergonomie`)
  if (exeProc?.pid) { try { spawnSync(`taskkill /PID ${exeProc.pid} /T /F`, { shell: true, windowsHide: true }) } catch {} }
  writeFileSync(LOG, lines.join("\n") + "\n")
  process.exit(code)
}

function sh(command) {
  const r = spawnSync(command, { shell: true, encoding: "utf8", windowsHide: true })
  return (r.stdout ?? "") + (r.stderr ?? "")
}

if (!existsSync(EXE)) { say(`FAIL · ${EXE} absent — lancer npm run tauri:check`); finish(1) }
mkdirSync(OUT, { recursive: true })

// ── CDP minimal (WebSocket natif Node) — même moulin que visual-prod ────────
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
    await sleep(250)
  }
  throw new Error(`condition jamais satisfaite sous ${timeoutMs} ms (dernier : ${last})`)
}

async function waitGone(cdp, selector, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (!(await cdp.eval(`!!document.querySelector(${JSON.stringify(selector)})`))) return true
    await sleep(100)
  }
  return false
}

// Attends qu'une cible correspondant au sélecteur soit visible et cliquable.
const VISIBLE = (sel) => `!!document.querySelector(${JSON.stringify(sel)}) && !!document.querySelector(${JSON.stringify(sel)}).offsetParent`

// Saisie compatible React (setter natif + évènement input).
const TYPE = (sel, val) => `(() => {
  const el = document.querySelector(${JSON.stringify(sel)})
  if (!el) return "absent"
  const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype
  Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(val)})
  el.dispatchEvent(new Event("input", { bubbles: true }))
  return el.value
})()`

const ESC = `document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`

// Touches RÉELLES : la coquille écoute Échap en capture sur window, et les
// raccourcis du contrôleur passent par le vrai événement clavier.
const CODES = { Enter: 13, Escape: 27, ArrowRight: 39, ArrowLeft: 37, Home: 36, End: 35, Tab: 9, k: 75, w: 87 }
async function press(cdp, key, modifiers = 0) {
  const code = key.length === 1 ? "Key" + key.toUpperCase() : key
  const windowsVirtualKeyCode = CODES[key] ?? 0
  // Entrée a besoin de `text` pour produire l'activation native d'un bouton :
  // un keyDown nu ne déclenche pas le click (mesuré sur la WebView).
  const text = key === "Enter" ? "\r" : undefined
  await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key, code, windowsVirtualKeyCode, modifiers, ...(text ? { text, unmodifiedText: text } : {}) })
  await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key, code, windowsVirtualKeyCode, modifiers })
}

// L'ordre de la table de destinations (WorkbenchShell) est un contrat : le
// smoke test le vérifie À L'ÉCRAN, pas seulement dans le source.
const attendues = ["Conversations", "Notes", "Fichiers", "Terminal", "Orchestration"]
const SURFACES = {
  Conversations: ".workspace-layout",
  Notes: ".notes-layout",
  Fichiers: ".files-layout",
  Terminal: ".freebuff-agent-page",
  Orchestration: ".tasks-principal-card",
}
const DESTINATIONS = attendues.map((label) => ({ label, surface: SURFACES[label] }))

// ── Lancement ───────────────────────────────────────────────────────────────
const fd = openSync(LOG + ".raw", "a")
exeProc = spawn(EXE, [], {
  detached: true, stdio: ["ignore", fd, fd], windowsHide: true,
  env: { ...process.env, WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}` },
})
say(`binaire pid ${exeProc.pid}`)

let cdp
try {
  const page = await waitForPage(45_000)
  // Garde-fou : laissé par `tauri dev` (fumée), target/debug/aven.exe peut être
  // un binaire dev (cfg(dev) → devUrl 5173) mort sans Vite — échec rapide explicite.
  if (/127\.0\.0\.1:5173/.test(page.url))
    throw new Error("binaire en mode dev (tauri:dev a écrasé target/debug) — relancer npm run tauri:check")
  cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  await cdp.send("Runtime.enable").catch(() => undefined)
  await cdp.send("Log.enable").catch(() => undefined)
  await cdp.send("Page.enable").catch(() => undefined)
  await cdp.send("Performance.enable").catch(() => undefined)

  // ── 1) Démarrage : Poste monté, runtime prêt, accueil minimal ─────────────
  await waitFor(cdp, `document.readyState === "complete" && !!document.querySelector(".wb-app") && !!document.querySelector(".wb-status") && !!document.querySelector(".wb-home")`, 30_000)
  const href = await cdp.eval("location.href")
  if (!/tauri\.localhost/.test(href)) fail(`origine inattendue : ${href}`)
  const state = await waitFor(cdp, `window.__TAURI_INTERNALS__.invoke("aven_call", { method: "state", args: [] }).then((s) => s && s.status === "ready" ? JSON.stringify({ ws: s.needsWorkspace, keys: Object.entries(s.keys || {}).filter(([, v]) => v).map(([k]) => k), agents: (s.agents || []).length }) : null, () => null)`, 90_000)
  const st = JSON.parse(state)
  pass(`démarrage : runtime ready, espace actif=${!st.ws}, clés=[${st.keys.join(", ") || "aucune"}], agents=${st.agents}`)
  if (st.ws) warn("needsWorkspace=true : l'app attend un choix d'espace au lancement")

  const cadre = await cdp.eval(`JSON.stringify({
    rail: document.querySelectorAll(".wb-rail").length,
    dock: document.querySelectorAll(".wb-dock").length,
    app: document.querySelectorAll(".wb-app").length,
    accueil: document.querySelectorAll(".wb-home").length,
    stage: document.querySelectorAll(".wb-stage").length,
    poignee: document.querySelectorAll(".wb-nav-trigger").length,
    agent: document.querySelectorAll("canvas.aven-agent-canvas").length,
    commande: document.querySelectorAll(".wb-command").length,
    tuiles: document.querySelectorAll(".wb-tile").length,
  })`)
  const c0 = JSON.parse(cadre)
  if (c0.app !== 1 || c0.accueil !== 1 || c0.stage !== 1 || c0.poignee !== 1 || c0.agent !== 1) fail(`cadre du Poste incomplet : ${cadre}`)
  else if (c0.rail || c0.dock) fail(`navigation permanente réapparue : ${cadre}`)
  else pass("Poste monté : en-tête, accueil de l'agent, scène, poignée, un seul canvas ; aucun rail ni dock")
  if (c0.commande !== 0) fail(`accueil : ${c0.commande} barre(s) de commande permanente(s) — elle doit se demander (Ctrl+K)`)
  else pass("accueil : barre de commande retirée de l'état permanent")
  if (c0.tuiles !== 0) fail(`accueil : ${c0.tuiles} tuile(s) de tableau de bord réapparue(s)`)
  else pass("accueil : aucun tableau de bord")

  // Un seul micro à l'accueil : celui de la sphère. Le bandeau ne le duplique pas.
  const micros = await cdp.eval(`JSON.stringify({
    accueil: document.querySelectorAll(".wb-home-mic").length,
    bandeau: document.querySelectorAll(".wb-voice-button").length,
    nommes: [...document.querySelectorAll("button[aria-label]")].filter((b) => /micro/i.test(b.getAttribute("aria-label")) && b.offsetParent).map((b) => b.getAttribute("aria-label")),
  })`)
  const M = JSON.parse(micros)
  if (M.accueil !== 1 || M.bandeau !== 0) fail(`accueil : micro de la sphère=${M.accueil}, micro d'en-tête=${M.bandeau} (un seul contrôle attendu)`)
  else pass("accueil : un seul contrôle micro, l'en-tête ne le duplique pas")

  // ── 2) Configuration NEUVE : l'historique est visible par défaut ──────────
  // On met de côté l'apparence réelle de la machine, on la remet en fin de
  // parcours : la préférence de l'utilisateur n'est pas écrasée durablement.
  const appearance0 = await cdp.eval(`localStorage.getItem("aven.appearance.v3")`)
  await cdp.eval(`localStorage.removeItem("aven.appearance.v3")`)
  await cdp.eval(`location.reload()`)
  await waitFor(cdp, `document.readyState === "complete" && !!document.querySelector(".wb-home")`, 30_000)
  // Le rechargement remonte l'UI avant le moteur : sans cette attente, le parcours
  // photographiait et testait l'écran « Démarrage d'Aven… » (constaté sur capture).
  await waitFor(cdp, `window.__TAURI_INTERNALS__.invoke("aven_call", { method: "state", args: [] }).then((s) => s && s.status === "ready", () => false)`, 60_000)
  await waitGone(cdp, ".status-banner", 15_000)
  say("apparence : profil neuf (réglages mis de côté, restaurés en fin de parcours)")

  // ── 3) Constellation : cinq cercles, ordre stable, Échap rend le focus ────
  await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
  await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
  await sleep(450) // la cascade d'ouverture est finie quand la capture part
  await cdp.shot(`${OUT}/feat-constellation.png`)
  const nav = await cdp.eval(`JSON.stringify({
    labels: [...document.querySelectorAll(".wb-nav-circle")].map((b) => b.getAttribute("aria-label")),
    expanded: document.querySelector(".wb-nav-trigger").getAttribute("aria-expanded"),
    currents: [...document.querySelectorAll('.wb-nav-circle[aria-current="page"]')].map((b) => b.getAttribute("aria-label")),
    rail: document.querySelectorAll(".wb-rail").length,
    dock: document.querySelectorAll(".wb-dock").length,
    arcBg: getComputedStyle(document.querySelector(".wb-nav-arc")).backgroundColor,
    arcBorder: getComputedStyle(document.querySelector(".wb-nav-arc")).borderTopWidth,
    nodePositions: [...document.querySelectorAll(".wb-nav-node")].map((n) => getComputedStyle(n).position),
  })`)
  const N = JSON.parse(nav)
  const ordreAttendu = DESTINATIONS.map((d) => d.label)
  if (JSON.stringify(N.labels) !== JSON.stringify(ordreAttendu)) fail(`constellation : ordre ${JSON.stringify(N.labels)} (attendu ${JSON.stringify(ordreAttendu)})`)
  else pass(`constellation : cinq destinations dans l'ordre ${ordreAttendu.join(" → ")}`)
  if (N.expanded !== "true") fail(`poignée : aria-expanded=${N.expanded} (true attendu)`)
  else pass("poignée : aria-expanded reflète le panneau ouvert")
  if (N.currents.length !== 0) fail(`accueil : ${N.currents.join(", ")} marqué(s) aria-current alors qu'aucune destination n'est ouverte`)
  else pass("accueil : aucun cercle ne s'annonce comme page courante")
  if (N.rail || N.dock) fail(`navigation permanente détectée (rail=${N.rail}, dock=${N.dock})`)
  if (N.arcBg !== "rgba(0, 0, 0, 0)" || N.arcBorder !== "0px") fail(`l'arc peint un conteneur (fond=${N.arcBg}, bordure=${N.arcBorder})`)
  else pass("l'arc ne peint rien : les cercles flottent indépendamment")
  if (N.nodePositions.some((p) => p !== "absolute")) fail(`nœuds non indépendants : ${N.nodePositions.join(",")}`)
  else pass("chaque cercle est positionné indépendamment")

  await cdp.eval(ESC)
  await waitGone(cdp, ".wb-nav-arc", 3_000)
  // Le retour de focus est planifié (rAF) : l'attendre, sinon on lit `body`
  // juste après le démontage de l'arc et l'on conclut à tort.
  const escFocus = await waitFor(cdp, `document.activeElement?.classList.contains("wb-nav-trigger")`, 2_000).then(() => "wb-nav-trigger").catch(async () => cdp.eval(`document.activeElement?.className || ""`))
  if (/wb-nav-trigger/.test(escFocus)) pass("Échap ferme la constellation et rend le focus à la poignée")
  else fail(`Échap : focus rendu à « ${escFocus} » au lieu de la poignée`)

  // ── 4) Ouverture au clavier : Entrée, flèches, Échap ──────────────────────
  await cdp.eval(`document.querySelector(".wb-nav-trigger").focus()`)
  await press(cdp, "Enter")
  await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
  // L'effet de focus est passif : il court après le rendu. On l'attend au lieu
  // de lire activeElement dans la même frame que le montage de l'arc.
  await waitFor(cdp, `document.activeElement?.classList.contains("wb-nav-circle")`, 3_000)
  const premier = await cdp.eval(`document.activeElement?.getAttribute("aria-label") || ""`)
  if (premier !== "Conversations") fail(`ouverture clavier : focus sur « ${premier} » (Conversations attendu)`)
  else pass("ouverture clavier : le focus entre dans le premier cercle")
  await press(cdp, "ArrowRight")
  const suivant = await cdp.eval(`document.activeElement?.getAttribute("aria-label") || ""`)
  if (suivant !== "Notes") fail(`flèche droite : focus sur « ${suivant} » (Notes attendu)`)
  else pass("flèche droite : le focus parcourt les cercles")
  await press(cdp, "End")
  const fin = await cdp.eval(`document.activeElement?.getAttribute("aria-label") || ""`)
  if (fin !== "Orchestration") fail(`End : focus sur « ${fin} » (Orchestration attendu)`)
  else pass("End : le dernier cercle prend le focus")
  await press(cdp, "Escape")
  await waitGone(cdp, ".wb-nav-arc", 3_000)
  // Le retour de focus est planifié dans une frame : on l'attend, sinon on lit
  // `body` après le démontage de l'arc et l'on conclut à tort.
  const focusRendu = await waitFor(cdp, `document.activeElement?.classList.contains("wb-nav-trigger")`, 2_000).then(() => true).catch(() => false)
  const focusFin = await cdp.eval(`document.activeElement?.className || ""`)
  if (!focusRendu) fail(`Échap clavier : focus sur « ${focusFin} »`)
  else pass("Échap clavier : focus rendu à la poignée")

  // ── 5) Les cinq destinations : sélection, repli de l'agent, retour ────────
  async function goHome() {
    await cdp.eval(`document.querySelector(".wb-brand").click()`)
    await waitFor(cdp, `!!document.querySelector(".wb-home")`, 8_000)
    await waitGone(cdp, ".wb-nav-arc", 3_000)
    await sleep(320)
  }

  async function agentAlignment(anchorId) {
    return cdp.eval(`(() => {
      const anchor = document.getElementById(${JSON.stringify(anchorId)})
      const layer = document.querySelector(".aven-agent-layer")
      if (!anchor || !layer) return { ok: false }
      const a = anchor.getBoundingClientRect(), l = layer.getBoundingClientRect()
      return {
        ok: l.width > 0 && l.height > 0,
        dx: Math.round(Math.abs((a.left + a.width / 2) - (l.left + l.width / 2))),
        dy: Math.round(Math.abs((a.top + a.height / 2) - (l.top + l.height / 2))),
        w: Math.round(l.width),
      }
    })()`)
  }

  for (const destination of DESTINATIONS) {
    await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
    await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
    const avant = await cdp.eval(`getComputedStyle(document.querySelector(".aven-agent-layer")).transform`)
    await cdp.eval(`document.querySelector(${JSON.stringify('.wb-nav-circle[aria-label="' + destination.label + '"]')}).click()`)
    await sleep(80)
    // Pendant la transition : le cercle choisi reste le point focal, les autres
    // s'écartent — c'est une phase observable, pas une intention de code.
    const transition = await cdp.eval(`(() => {
      const arc = document.querySelector(".wb-nav-arc")
      const chosen = document.querySelector('.wb-nav-node[data-chosen="true"] .wb-nav-circle')
      return JSON.stringify({
        leaving: arc?.getAttribute("data-leaving") || null,
        chosen: !!chosen,
        scale: chosen ? getComputedStyle(chosen).transform : null,
      })
    })()`)
    const T = JSON.parse(transition)
    if (T.leaving !== "true" || !T.chosen) fail(`${destination.label} : la phase de sortie n'expose pas le cercle choisi (${transition})`)
    await waitFor(cdp, `!!document.querySelector(${JSON.stringify(destination.surface)})`, 12_000)
    if (!(await waitGone(cdp, ".wb-nav-arc", 3_000))) fail(`${destination.label} : l'arc survit à la sélection`)
    else pass(`${destination.label} : scène ouverte, constellation entièrement refermée`)
    const titre = await cdp.eval(`document.querySelector(".wb-section-title")?.textContent || ""`)
    if (titre !== destination.label) fail(`${destination.label} : titre d'en-tête « ${titre} »`)
    else pass(`${destination.label} : l'en-tête porte la même destination`)
    const current = await cdp.eval(`document.querySelector('.wb-nav-trigger') ? "present" : "absent"`)
    if (current !== "present") fail(`${destination.label} : la poignée a disparu dans l'espace de travail`)
    await sleep(360)
    const fold = await agentAlignment("agent-toolbar-anchor")
    if (!fold.ok || fold.dx > 24 || fold.dy > 24) fail(`${destination.label} : la sphère ne s'est pas repliée sur l'ancre d'en-tête (${JSON.stringify(fold)})`)
    else pass(`${destination.label} : la sphère se replie dans l'en-tête (écart ${fold.dx}×${fold.dy} px)`)

    // Conversations : l'historique est le contenu de la destination.
    if (destination.label === "Conversations") {
      const layout = JSON.parse(await cdp.eval(`(() => {
        const wrap = document.querySelector(".workspace-layout")
        const side = document.querySelector(".sidebar")
        const main = document.querySelector(".main")
        if (!wrap || !side || !main) return JSON.stringify({ side: !!side, main: !!main })
        const w = wrap.getBoundingClientRect().width
        return JSON.stringify({
          side: true, main: true,
          ratio: Math.round((side.getBoundingClientRect().width / w) * 100) / 100,
          mainW: Math.round(main.getBoundingClientRect().width),
          composer: !!document.querySelector(".composer textarea"),
          sidebarCss: getComputedStyle(wrap).gridTemplateColumns,
        })
      })()`))
      if (!layout.side || !layout.main) fail(`Conversations : historique absent par défaut (${JSON.stringify(layout)})`)
      else if (layout.ratio < 0.18 || layout.ratio > 0.34) fail(`Conversations : l'historique occupe ${layout.ratio} de la largeur (≈0,25 attendu)`)
      else pass(`Conversations : historique visible (${layout.ratio} de la largeur), fil ${layout.mainW} px, composeur ${layout.composer ? "présent" : "absent"}`)
      if (!layout.composer) fail("Conversations : le composeur n'est pas rendu")
    }

    // Orchestration : le mode de délégation reste la fonction de la page.
    if (destination.label === "Orchestration") {
      const modes = await cdp.eval(`document.querySelectorAll(".tasks-mode-option").length`)
      const auto = await cdp.eval(`!!document.querySelector('.tasks-mode-option[aria-pressed="true"]')`)
      if (modes !== 4) fail(`Orchestration : ${modes} modes (4 attendus)`)
      else if (!auto) fail("Orchestration : aucun mode actif (Auto doit être pressé par défaut)")
      else pass("Orchestration : switch à 4 modes, un mode actif")
      // En compact, le titre long de l'instrument n'est PAS répété : l'en-tête du
      // Poste porte « Orchestration », et la description dit la portée réelle.
      const nomme = await cdp.eval(`document.body.innerText.includes("prochaines demandes dans cet espace de travail")`)
      if (!nomme) fail("Orchestration : la portée fonctionnelle n'est pas dite dans la page")
    }

    await cdp.shot(`${OUT}/feat-${destination.label.toLowerCase()}.png`)
    await goHome()
    const home = await agentAlignment("agent-home-anchor")
    if (!home.ok || home.dx > 24 || home.dy > 24) fail(`retour accueil : la sphère n'a pas repris son ancre (${JSON.stringify(home)})`)
    else pass("retour accueil : la sphère reprend l'ancre de la scène")
    const fantome = await cdp.eval(`JSON.stringify({
      arc: document.querySelectorAll(".wb-nav-arc").length,
      overlay: document.querySelectorAll(".overlay").length,
      rail: document.querySelectorAll(".wb-rail").length,
      dock: document.querySelectorAll(".wb-dock").length,
    })`)
    const F = JSON.parse(fantome)
    if (F.arc || F.rail || F.dock || (F.overlay && !st.ws)) fail(`panneau fantôme après retour : ${fantome}`)
    else pass("retour accueil : aucun panneau, rail ou dock fantôme")
  }

  // ── 6) Rouvrir depuis un espace de travail, sans agrandir la sphère ───────
  await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
  await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
  await cdp.eval(`document.querySelector(${JSON.stringify('.wb-nav-circle[aria-label="Notes"]')}).click()`)
  await waitFor(cdp, `!!document.querySelector(".notes-layout")`, 10_000)
  await sleep(400)
  const tailleNotes = await cdp.eval(`Math.round(document.querySelector(".aven-agent-layer").getBoundingClientRect().width)`)
  await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
  await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
  const tailleOuverte = await cdp.eval(`Math.round(document.querySelector(".aven-agent-layer").getBoundingClientRect().width)`)
  if (Math.abs(tailleNotes - tailleOuverte) > 2) fail(`ouvrir la constellation change la taille de la sphère (${tailleNotes} → ${tailleOuverte} px)`)
  else pass(`la constellation se rouvre depuis Notes sans agrandir la sphère (${tailleNotes} px)`)
  await cdp.eval(ESC)
  await waitGone(cdp, ".wb-nav-arc", 3_000)
  if (await cdp.eval(`!!document.querySelector(".notes-layout")`)) pass("Échap depuis Notes ferme la constellation, pas l'instrument")
  else fail("Échap depuis Notes a fermé l'instrument")

  // ── 7) Barre de commande : à la demande sur l'accueil, permanente ailleurs ─
  // Ctrl+W : la WebView2 intercepte l'accélérateur natif, on éprouve donc le
  // gestionnaire du Poste avec un évènement clavier réel dans la page (même
  // contrat : preventDefault + closePage).
  // Dispatch sur WINDOW : le contrôleur écoute en phase de bulle sur window ; un
  // évènement émis sur document ne remonte pas de façon fiable dans la WebView.
  const raccourci = await cdp.eval(`(() => {
    let vu = false
    const marque = () => { vu = true }
    window.addEventListener("keydown", marque)
    const e = new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true, cancelable: true })
    window.dispatchEvent(e)
    window.removeEventListener("keydown", marque)
    return JSON.stringify({ vu, prevented: e.defaultPrevented })
  })()`)
  say(`Ctrl+W : ${raccourci}`)
  const fermeNotes = await waitGone(cdp, ".notes-layout", 4_000)
  const voisin = await cdp.eval(`document.querySelector(".wb-section-title")?.textContent || "Aujourd’hui"`)
  if (!fermeNotes) fail("Ctrl+W n'a pas fermé l'instrument actif")
  else pass(`Ctrl+W ferme l'instrument actif et rend son voisin (${voisin})`)
  // Les instruments visités restent des onglets : le retour stable à l'accueil
  // est la marque Aven, jamais une fermeture en cascade.
  await cdp.eval(`document.querySelector(".wb-brand").click()`)
  await waitFor(cdp, `!!document.querySelector(".wb-home")`, 6_000)
  if (await cdp.eval(`!!document.querySelector(".wb-command")`)) fail("accueil : la barre de commande est toujours permanente après retour")
  else pass("accueil : la barre de commande reste absente")

  await press(cdp, "k", 2) // Ctrl+K : la demande
  const barre = await waitFor(cdp, `!!document.querySelector(".wb-command-input")`, 4_000).then(() => true).catch(() => false)
  if (!barre) fail("Ctrl+K n'ouvre pas la barre de commande sur l'accueil")
  else {
    const focusBarre = await cdp.eval(`document.activeElement?.className || ""`)
    if (!/wb-command-input/.test(focusBarre)) fail(`Ctrl+K : focus sur « ${focusBarre} »`)
    else pass("Ctrl+K ouvre la barre de commande et y place le focus")
  }
  const saisi = await cdp.eval(TYPE(".wb-command-input", "syntaxe"))
  await sleep(300)
  if (saisi !== "syntaxe") fail(`barre de commande : la saisie n'alimente pas l'input (${saisi})`)
  else pass("barre de commande : la saisie alimente l'input React")
  // Un profil sans conversation ni note n'a légitimement aucun résultat : on ne
  // fait pas dépendre le parcours du contenu de la machine.
  const resultats = await cdp.eval(`document.querySelectorAll(".wb-command-result").length`)
  say(`barre de commande : ${resultats} résultat(s) pour « syntaxe » (contenu de la machine)`)
  await cdp.eval(TYPE(".wb-command-input", ">"))
  await waitFor(cdp, `document.querySelectorAll(".wb-command-result").length > 0`, 3_000).catch(() => undefined)
  const commandes = await cdp.eval(`[...document.querySelectorAll(".wb-command-result")].map((b) => b.textContent).join(" | ")`)
  if (!/Nouvelle conversation/.test(commandes)) fail(`mode commande : « Nouvelle conversation » absent (${commandes.slice(0, 120)})`)
  else pass("mode « > » : les commandes du Poste sont proposées")
  await cdp.eval(TYPE(".wb-command-input", "/conversations"))
  await sleep(250)
  const portee = await cdp.eval(`document.querySelector(".wb-command-section")?.textContent || ""`)
  if (!/PORTÉE · conversations/.test(portee)) fail(`portée /conversations non reconnue : ${portee}`)
  else pass("portée « /conversations » reconnue")
  await cdp.eval(TYPE(".wb-command-input", ""))
  // Échap doit partir de l'INPUT : la barre écoute en React (onKeyDown sur le
  // champ), un évènement émis sur document ne traverse pas le champ.
  await cdp.eval(`document.querySelector(".wb-command-input")?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }))`)
  const refermee = await waitGone(cdp, ".wb-command", 3_000)
  if (refermee) pass("Échap referme la barre demandée sur l'accueil")
  else fail("Échap ne referme pas la barre de commande demandée")

  // Dans un espace de travail, la barre reste le point d'entrée du Poste.
  await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
  await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
  await cdp.eval(`document.querySelector(${JSON.stringify('.wb-nav-circle[aria-label="Notes"]')}).click()`)
  await waitFor(cdp, `!!document.querySelector(".notes-layout")`, 10_000)
  if (await cdp.eval(VISIBLE(".wb-command-input"))) pass("Notes : la barre de commande reste disponible dans l'espace de travail")
  else fail("Notes : la barre de commande a disparu de l'espace de travail")

  // ── 8) Réglages : quatre sections dans l'inspecteur, fermeture ────────────
  await cdp.eval(`document.querySelector('.wb-status-toggle[aria-label="Réglages"]').click()`)
  await waitFor(cdp, `!!document.querySelector(".unified-settings")`, 10_000)
  await cdp.eval(`document.querySelector('.wb-status-toggle[aria-label="Afficher l’inspecteur"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".wb-inspector-tabs")`, 4_000)
  const onglets = await cdp.eval(`[...document.querySelectorAll(".wb-inspector-tab")].map((b) => b.textContent)`)
  if (onglets.length !== 4) fail(`Réglages : ${onglets.length} sections (4 attendues) : ${onglets.join(", ")}`)
  else pass(`Réglages : sections ${onglets.join(" / ")}`)
  let sectionsOk = true
  for (const t of ["Configuration", "Apparence", "Agent vocal", "Usage"]) {
    const n = await cdp.eval(`(() => {
      const b = [...document.querySelectorAll(".wb-inspector-tab")].find((x) => x.textContent === ${JSON.stringify(t)})
      if (!b) return -1
      b.click()
      return document.querySelectorAll(".unified-settings-scroll .settings-section, .unified-settings-scroll .appearance-group").length
    })()`)
    if (n < 1) { sectionsOk = false; fail(`Réglages : la section « ${t} » rend vide`) }
  }
  if (sectionsOk) pass("Réglages : les 4 sections rendent du contenu")
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".wb-inspector-tab")].find((x) => x.textContent === "Apparence"); b?.click(); return 1 })()`)
  await cdp.shot(`${OUT}/feat-settings.png`)
  // L'inspecteur est un tiroir : le refermer le sort du flux visuel.
  await cdp.eval(`document.querySelector('.wb-status-toggle[aria-label="Masquer l’inspecteur"]')?.click()`)
  await sleep(200)
  const tiroir = await cdp.eval(`JSON.stringify({ open: document.querySelector(".wb-body").dataset.inspector, visible: !!document.querySelector(".wb-inspector")?.offsetParent })`)
  const D = JSON.parse(tiroir)
  if (D.open !== "closed" || D.visible) fail(`inspecteur : état ${tiroir} après fermeture`)
  else pass("inspecteur : tiroir refermé, hors du flux")
  // « Terminé » ferme l'onglet des Réglages : la loi des onglets rend le voisin
  // (Notes), pas un accueil inventé. On vérifie la fermeture, puis on rentre.
  await cdp.eval(`document.querySelector('.unified-settings .button.primary')?.click()`)
  const ferme = await waitGone(cdp, ".unified-settings", 6_000)
  const titreApres = await cdp.eval(`document.querySelector(".wb-section-title")?.textContent || ""`)
  if (!ferme) fail("Réglages : « Terminé » ne ferme pas l'instrument")
  else pass(`Réglages : « Terminé » ferme l'instrument et rend ${titreApres || "Aujourd’hui"}`)
  await cdp.eval(`document.querySelector(".wb-brand").click()`)
  await waitFor(cdp, `!!document.querySelector(".wb-home")`, 6_000)

  // ── 9) Thème et accent SANS rechargement (le canvas relit ses jetons) ──────
  // Le mouvement est coupé pour comparer deux rendus de la MÊME pose : sans
  // cela, la rotation change le dessin et la mesure ne prouve rien.
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }).catch(() => undefined)
  await waitFor(cdp, `window.matchMedia("(prefers-reduced-motion: reduce)").matches`, 4_000).catch(() => undefined)
  await sleep(300)
  const SIGNATURE = `(() => {
    const c = document.querySelector("canvas.aven-agent-canvas")
    if (!c) return "absent"
    const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data
    let h = 2166136261
    for (let i = 0; i < d.length; i += 4) {
      h ^= d[i]; h = Math.imul(h, 16777619)
      h ^= d[i + 1]; h = Math.imul(h, 16777619)
      h ^= d[i + 2]; h = Math.imul(h, 16777619)
    }
    return String(h >>> 0)
  })()`
  const avantTheme = await cdp.eval(SIGNATURE)
  const theme0 = await cdp.eval(`document.documentElement.dataset.theme || ""`)
  await cdp.eval(`document.documentElement.dataset.theme = "dark"`)
  await sleep(400)
  const apresTheme = await cdp.eval(SIGNATURE)
  await cdp.eval(`document.documentElement.dataset.theme = ${JSON.stringify(theme0)}`)
  await sleep(300)
  if (avantTheme === "absent") fail("thème : canvas introuvable")
  else if (avantTheme === apresTheme) fail("thème : le canvas n'a pas relu ses couleurs (rendu identique en clair et sombre)")
  else pass(`thème : la sphère se repeint sans rechargement (${avantTheme} → ${apresTheme})`)

  const accent0 = await cdp.eval(`document.documentElement.style.getPropertyValue("--accent")`)
  await cdp.eval(`document.documentElement.style.setProperty("--accent", "#10b981")`)
  await sleep(400)
  const apresAccent = await cdp.eval(SIGNATURE)
  await cdp.eval(`document.documentElement.style.setProperty("--accent", ${JSON.stringify(accent0)} || "")`)
  await sleep(200)
  if (apresTheme === apresAccent) fail("accent : le canvas n'a pas relu le jeton --accent")
  else pass("accent : la sphère se repeint sans rechargement")
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => undefined)
  await sleep(200)

  // ── 10) Mouvement réduit : la cascade et la dispersion sont coupées ───────
  await cdp.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: "reduce" }] }).catch(() => undefined)
  await waitFor(cdp, `window.matchMedia("(prefers-reduced-motion: reduce)").matches`, 4_000).catch(() => undefined)
  await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
  await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
  const motion = JSON.parse(await cdp.eval(`(() => {
    const node = document.querySelector(".wb-nav-node")
    const circle = document.querySelector(".wb-nav-circle")
    const cs = getComputedStyle(node), cc = getComputedStyle(circle)
    return JSON.stringify({ duration: cs.animationDuration, delay: cs.animationDelay, transition: cc.transitionDuration, layer: getComputedStyle(document.querySelector(".aven-agent-layer")).transitionDuration })
  })()`))
  // La sonde CSS du projet écrit `.01ms`, que getComputedStyle rend en `1e-05s` :
  // comparer la chaîne ferait échouer une règle pourtant appliquée.
  const coupé = (v) => v.split(",").every((x) => {
    const s = x.trim(); const n = parseFloat(s)
    if (Number.isNaN(n)) return false
    return s.endsWith("ms") ? n <= 0.02 : n <= 0.00002
  })
  if (!coupé(motion.duration) || !coupé(motion.delay) || !coupé(motion.transition) || !coupé(motion.layer))
    fail(`mouvement réduit : animation=${motion.duration} délai=${motion.delay} transition=${motion.transition} calque=${motion.layer}`)
  else pass("mouvement réduit : cascade, dispersion et repli sont instantanés")
  await cdp.eval(ESC)
  await waitGone(cdp, ".wb-nav-arc", 3_000)
  await cdp.send("Emulation.setEmulatedMedia", { features: [] }).catch(() => undefined)

  // ── 11) Géométries de fenêtre : rien de rogné, cercles dans le cadre ──────
  for (const [w, h] of [[1280, 820], [1024, 700], [900, 680]]) {
    await cdp.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: false }).catch(() => undefined)
    await sleep(450)
    const geo = JSON.parse(await cdp.eval(`(() => {
      const title = document.querySelector(".wb-home-title")
      return JSON.stringify({
        iw: innerWidth, ih: innerHeight,
        overflowX: document.documentElement.scrollWidth - innerWidth,
        titleClipped: title ? title.scrollWidth - title.clientWidth : 0,
        status: Math.round(document.querySelector(".wb-status").getBoundingClientRect().height),
        stage: Math.round(document.querySelector(".wb-stage").getBoundingClientRect().height),
      })
    })()`))
    if (geo.iw !== w) { warn(`géométrie ${w}×${h} : la webview rapporte ${geo.iw}px — mesure non concluante`) }
    else if (geo.overflowX > 1) fail(`géométrie ${w}×${h} : débordement horizontal de ${geo.overflowX} px`)
    else if (geo.titleClipped > 2) fail(`géométrie ${w}×${h} : titre d'accueil rogné de ${geo.titleClipped} px`)
    else if (geo.status > 72) fail(`géométrie ${w}×${h} : en-tête ${geo.status} px (au-delà de sa rangée)`)
    else if (geo.stage <= 0) fail(`géométrie ${w}×${h} : scène vide`)
    else pass(`géométrie ${w}×${h} : aucun débordement, titre entier, en-tête ${geo.status} px, scène ${geo.stage} px`)
    await cdp.eval(`document.querySelector(".wb-nav-trigger").click()`)
    await waitFor(cdp, `document.querySelectorAll(".wb-nav-circle").length === 5`, 4_000)
    const cercle = await cdp.eval(`(() => {
      const rects = [...document.querySelectorAll(".wb-nav-circle")].map((c) => c.getBoundingClientRect())
      return JSON.stringify({ hors: rects.filter((r) => r.left < 0 || r.right > innerWidth || r.top < 0 || r.bottom > innerHeight).length, nb: rects.length })
    })()`)
    const C = JSON.parse(cercle)
    if (C.nb !== 5 || C.hors > 0) fail(`géométrie ${w}×${h} : ${C.hors}/${C.nb} cercle(s) hors du cadre`)
    else pass(`géométrie ${w}×${h} : les cinq cercles restent dans le cadre`)
    await cdp.eval(ESC)
    await waitGone(cdp, ".wb-nav-arc", 3_000)
    await cdp.shot(`${OUT}/feat-home-${w}.png`)
  }
  await cdp.send("Emulation.clearDeviceMetricsOverride").catch(() => undefined)
  await sleep(300)

  // ── 12) Ergonomie : boutons nommés, cibles, focus-visible ────────────────
  const a11y = await cdp.eval(`(() => {
    const sansNom = []
    const petites = []
    for (const b of document.querySelectorAll("button, a[href], input, textarea, select")) {
      const r = b.getBoundingClientRect()
      if (!r.width || !r.height) continue
      const nom = (b.getAttribute("aria-label") || b.textContent || b.getAttribute("title") || b.getAttribute("placeholder") || "").trim()
      if (!nom) sansNom.push(b.className || b.tagName)
      if (b.matches("button, a[href]") && (r.width < 24 || r.height < 24)) petites.push((b.className || "btn") + " " + Math.round(r.width) + "x" + Math.round(r.height))
    }
    let focusVisible = false
    for (const sheet of document.styleSheets) {
      try {
        for (const rule of sheet.cssRules) if (rule.selectorText && rule.selectorText.includes(":focus-visible")) focusVisible = true
      } catch {}
    }
    return JSON.stringify({ sansNom, petites: petites.slice(0, 6), nbPetites: petites.length, focusVisible, dom: document.querySelectorAll("*").length })
  })()`)
  const A = JSON.parse(a11y)
  if (A.sansNom.length) fail(`boutons/champs sans nom accessible : ${A.sansNom.slice(0, 5).join(", ")}`)
  else pass("ergonomie : tous les contrôles visibles ont un nom accessible")
  if (A.nbPetites) warn(`cibles < 24px : ${A.nbPetites} (${A.petites.join(" ; ")})`)
  else pass("ergonomie : aucune cible interactive sous 24px")
  if (!A.focusVisible) warn("règle :focus-visible introuvable dans les feuilles de style")
  else pass("ergonomie : indicateur :focus-visible présent")

  // ── 13) Contrastes des tokens (clair ET sombre) ───────────────────────────
  // Les custom properties se lisent en brut (hex, color-mix) : un regex dessus
  // mesure n'importe quoi. On les fait résoudre par un élément-probe dont
  // getComputedStyle renvoie du rgb réellement calculé.
  const CONTRASTE = `(() => {
    const root = document.documentElement
    const lire = (fg, bg) => {
      const el = document.createElement("div")
      el.style.cssText = "position:absolute;visibility:hidden;pointer-events:none"
      el.style.color = "var(" + fg + ")"
      el.style.backgroundColor = "var(" + bg + ")"
      root.appendChild(el)
      const cs = getComputedStyle(el)
      // color-mix() calcule en color(srgb a b c) avec des flottants 0-1 : on
      // renormalise en 0-255 avant la luminance (sinon « noir » et ratio faux).
      const parse = (s) => {
        const m = s.match(/[\\d.]+/g)
        let v = m && m.length >= 3 ? m.slice(0, 3).map(Number) : [0, 0, 0]
        if (Math.max(...v) <= 1) v = v.map((x) => x * 255)
        return v
      }
      const lum = (c) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4) }); return 0.2126 * r + 0.7152 * g + 0.0722 * b }
      const [l1, l2] = [lum(parse(cs.color)), lum(parse(cs.backgroundColor))].sort((a, b) => b - a)
      const brut = cs.color + " sur " + cs.backgroundColor
      el.remove()
      return { v: Math.round(((l1 + 0.05) / (l2 + 0.05)) * 100) / 100, brut }
    }
    const a = lire("--text", "--bg"), b = lire("--text", "--panel"), c = lire("--muted", "--bg"), d = lire("--muted", "--panel")
    return JSON.stringify({ theme: root.dataset.theme || "light", text: a.v, textPanel: b.v, muted: c.v, mutedPanel: d.v, rawText: a.brut, rawMuted: c.brut })
  })()`
  const clair = JSON.parse(await cdp.eval(CONTRASTE))
  say(`contrastes clair  : texte/bg=${clair.text} texte/panel=${clair.textPanel} muted/bg=${clair.muted} muted/panel=${clair.mutedPanel}`)
  const themeAvant = await cdp.eval(`document.documentElement.dataset.theme || ""`)
  await cdp.eval(`document.documentElement.dataset.theme = "dark"`)
  await sleep(200)
  const sombre = JSON.parse(await cdp.eval(CONTRASTE))
  say(`contrastes sombre : texte/bg=${sombre.text} texte/panel=${sombre.textPanel} muted/bg=${sombre.muted} muted/panel=${sombre.mutedPanel}`)
  await cdp.eval(themeAvant ? `document.documentElement.dataset.theme = ${JSON.stringify(themeAvant)}` : `delete document.documentElement.dataset.theme`)
  let contrasteOk = true
  for (const m of [{ nom: "clair", ...clair }, { nom: "sombre", ...sombre }]) {
    for (const [nom, v] of Object.entries(m)) {
      if (nom === "theme" || nom === "nom" || nom.startsWith("raw")) continue
      if (typeof v !== "number" || Number.isNaN(v)) { contrasteOk = false; warn(`contraste ${m.nom}/${nom} illisible (${v})`) }
      else if (v < 4.5) warn(`contraste ${m.nom}/${nom} = ${v} : sous 4.5:1 (WCAG AA texte normal)`)
    }
  }
  if (contrasteOk && [clair, sombre].every((m) => m.text >= 4.5 && m.textPanel >= 4.5)) pass("ergonomie : texte principal ≥ 4.5:1 dans les deux thèmes")
  else if (contrasteOk) warn("ergonomie : texte principal sous 4.5:1 dans au moins un thème")

  // ── 14) Performance : chargement, heap, DOM ───────────────────────────────
  const perf = await cdp.eval(`(() => {
    const nav = performance.getEntriesByType("navigation")[0] || {}
    const ressources = performance.getEntriesByType("resource")
    const met = {}
    try { performance.getEntriesByType("paint").forEach((p) => { met[p.name] = Math.round(p.startTime) }) } catch {}
    return JSON.stringify({
      dcl: Math.round(nav.domContentLoadedEventEnd || 0),
      load: Math.round(nav.loadEventEnd || 0),
      ressources: ressources.length,
      octets: Math.round(ressources.reduce((s, r) => s + (r.encodedBodySize || 0), 0) / 1024),
      fp: met["first-paint"] ?? null, fcp: met["first-contentful-paint"] ?? null,
      dom: document.querySelectorAll("*").length,
    })
  })()`)
  const P = JSON.parse(perf)
  let heap = null
  try {
    const m = await cdp.send("Performance.getMetrics")
    heap = Math.round((m.metrics.find((x) => x.name === "JSHeapUsedSize")?.value ?? 0) / 1024 / 1024)
  } catch {}
  pass(`perf : DCL=${P.dcl}ms load=${P.load}ms FCP=${P.fcp}ms, ${P.ressources} ressources/${P.octets} Ko, DOM=${P.dom} nœuds${heap !== null ? `, heap=${heap} Mo` : ""}`)
  if (P.load > 3_000) warn(`chargement ${P.load}ms > 3s`)
  if (P.dom > 2_500) warn(`DOM très profond : ${P.dom} nœuds`)

  // ── 15) Capture finale du Poste ───────────────────────────────────────────
  await cdp.shot(`${OUT}/feat-hub.png`)

  // ── 16) Restauration de l'apparence réelle de la machine ──────────────────
  if (appearance0 === null) await cdp.eval(`localStorage.removeItem("aven.appearance.v3")`)
  else await cdp.eval(`localStorage.setItem("aven.appearance.v3", ${JSON.stringify(appearance0)})`)
  say("apparence : réglages d'origine restaurés")

  // ── 17) Erreurs console récoltées pendant tout le parcours ────────────────
  await sleep(500)
  const erreurs = cdp.logs.filter((l) => /^(error|exception)/i.test(l))
  if (erreurs.length) fail(`erreurs console pendant le parcours : ${erreurs.slice(0, 3).map((e) => e.slice(0, 140)).join(" || ")}`)
  else pass("zéro erreur console sur tout le parcours")

  say(echecs === 0 ? "\nPARCOURS FONCTIONNEL : OK" : "\nPARCOURS FONCTIONNEL : ÉCHECS")
  finish(echecs === 0 ? 0 : 1)
} catch (error) {
  fail(String(error?.message ?? error))
  finish(1)
} finally {
  cdp?.close()
}
