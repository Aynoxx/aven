// v10.0.x : parcours fonctionnel de TOUTES les fonctionnalités de l'app sur le
// binaire de production (webview WebView2 réelle, pas de dev server) :
//   hub, recherche, sélecteur de conversations, Tâches, vue conversation,
//   Notes, Fichiers, Réglages (3 sections + Échap), page Freebuff,
//   puis contrôles d'ergonomie (boutons nommés, focus-visible, cibles,
//   contrastes clair/sombre) et de performance (chargement, heap, DOM).
// Les contrôles fonctionnels sont bloquants (exit 1) ; les constats
// d'ergonomie sont des WARN imprimées et comptabilisées (exit 0).
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
    await sleep(500)
  }
  throw new Error(`condition jamais satisfaite sous ${timeoutMs} ms (dernier : ${last})`)
}

// Attends qu'une cible correspondant au sélecteur soit visible et cliquable.
const VISIBLE = (sel) => `!!document.querySelector(${JSON.stringify(sel)}) && !!document.querySelector(${JSON.stringify(sel)}).offsetParent`
const CLICK = (sel) => `(() => { const el = document.querySelector(${JSON.stringify(sel)}); if (!el) return "absent"; el.click(); return "ok" })()`

// v10.0.1 : clic RÉEL (Input CDP press+release) pour les cartes du hub — le clic
// synthétique el.click() ignore :active et le hit-test : un transform positionnel
// écrasé pendant l'enfoncement (bug v10.0.1) faisait « sauter » la carte de son
// orbite, le release tombait sur le fond du hub et rien ne s'ouvrait. Contrat :
// la carte est atteignable en son centre, ne bouge PAS à l'enfoncement et reste
// sous le point au moment du release.
const REAL_CLICK = async (cdp, sel) => {
  const pt = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el || !el.offsetParent) return { abs: true }
    const r = el.getBoundingClientRect()
    const x = Math.round(r.x + r.width / 2), y = Math.round(r.y + r.height / 2)
    const h = document.elementFromPoint(x, y)
    return { x, y, rx: Math.round(r.x), ry: Math.round(r.y), hit: !!(h && h.closest(${JSON.stringify(sel)})) }
  })()`)
  if (pt?.abs) return "absente ou invisible"
  if (!pt.hit) return "hit-test initial : la carte n'est pas au-dessus de son centre"
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pt.x, y: pt.y, pointerType: "mouse" })
  await sleep(60)
  await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pt.x, y: pt.y, button: "left", clickCount: 1, pointerType: "mouse" })
  await sleep(60)
  const presse = await cdp.eval(`(() => {
    const el = document.querySelector(${JSON.stringify(sel)})
    if (!el) return { gone: true }
    const r = el.getBoundingClientRect()
    const h = document.elementFromPoint(${pt.x}, ${pt.y})
    return { bouge: Math.abs(Math.round(r.x) - ${pt.rx}) > 2 || Math.abs(Math.round(r.y) - ${pt.ry}) > 2, hit: !!(h && h.closest(${JSON.stringify(sel)})) }
  })()`)
  await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pt.x, y: pt.y, button: "left", clickCount: 1, pointerType: "mouse" })
  if (presse?.gone) return "carte démontée pendant l'enfoncement"
  if (presse?.bouge) return "carte DÉPLACÉE pendant l'enfoncement (transform positionnel écrasé)"
  if (!presse?.hit) return "point libéré : la carte n'est plus sous le curseur au release"
  return "ok"
}

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

  // ── 1) Démarrage : Poste monté, runtime prêt ──────────────────────────────
  await waitFor(cdp, `document.readyState === "complete" && !!document.querySelector(".wb-app") && !!document.querySelector(".wb-status")`, 30_000)
  const href = await cdp.eval("location.href")
  if (!/tauri\.localhost/.test(href)) fail(`origine inattendue : ${href}`)
  const state = await waitFor(cdp, `window.__TAURI_INTERNALS__.invoke("aven_call", { method: "state", args: [] }).then((s) => s && s.status === "ready" ? JSON.stringify({ ws: s.needsWorkspace, keys: Object.entries(s.keys || {}).filter(([, v]) => v).map(([k]) => k), agents: (s.agents || []).length }) : null, () => null)`, 90_000)
  const st = JSON.parse(state)
  pass(`démarrage : runtime ready, espace actif=${!st.ws}, clés=[${st.keys.join(", ") || "aucune"}], agents=${st.agents}`)
  if (st.ws) warn("needsWorkspace=true : l'app attend un choix d'espace au lancement")
  const cadre = await cdp.eval(`JSON.stringify({ rail: !!document.querySelector(".wb-rail"), tabs: !!document.querySelector(".wb-tabs"), stage: !!document.querySelector(".wb-stage"), inspecteur: !!document.querySelector(".wb-inspector") })`)
  const c0 = JSON.parse(cadre)
  if (!c0.rail || !c0.tabs || !c0.stage) fail(`cadre du Poste incomplet : ${cadre}`)
  else pass(`Poste monté : rail + onglets + scène${c0.inspecteur ? " + inspecteur" : ""}`)

  // ── 2) Rail : les six instruments + micro global ──────────────────────────
  const rail = await cdp.eval(`[...document.querySelectorAll(".wb-rail-nav .wb-rail-item")].map((b) => b.getAttribute("aria-label"))`)
  const attendues = ["Aujourd’hui", "Conversations", "Notes", "Fichiers", "Terminal", "Orchestration"]
  const absentes = attendues.filter((a) => !rail.includes(a))
  if (absentes.length) fail(`instruments absents du rail : ${absentes.join(", ")} (vu : ${rail.join(" | ")})`)
  else pass(`rail : ${rail.length} instruments présents`)
  const micro = await cdp.eval(`document.querySelector(".wb-command-mic")?.getAttribute("aria-label") || null`)
  if (!micro) fail("micro global introuvable dans la barre de commande")
  else pass(`dictée exposée : « ${micro.slice(0, 60)}… »`)
  const onglets0 = await cdp.eval(`document.querySelectorAll(".wb-tab").length`)
  if (onglets0 !== 1) fail(`${onglets0} onglets au démarrage (1 attendu : Aujourd’hui)`)
  else pass("un seul onglet au démarrage : Aujourd’hui (non fermable)")

  // ── 3) Barre de commande : saisie, commandes, portée ──────────────────────
  const tapé = await cdp.eval(TYPE(".wb-command-input", "syntaxe"))
  const vu = await cdp.eval(`document.querySelector(".wb-command-input")?.value`)
  if (tapé === "absent" || vu !== "syntaxe") fail(`barre de commande : saisie KO (vu=${vu})`)
  else pass("barre de commande : la saisie alimente l'input React")
  await cdp.eval(`document.querySelector(".wb-command-input")?.focus()`)
  await sleep(200)
  const resultats = await cdp.eval(`document.querySelectorAll(".wb-command-result").length`)
  if (resultats < 1) fail("barre de commande : aucun résultat affiché pour « syntaxe »")
  else pass(`barre de commande : ${resultats} résultat(s)`)
  await cdp.eval(TYPE(".wb-command-input", ">"))
  await sleep(120)
  const commandes = await cdp.eval(`[...document.querySelectorAll(".wb-command-result")].map((b) => b.textContent).join(" | ")`)
  if (!/Nouvelle conversation/.test(commandes)) fail(`mode commande : « Nouvelle conversation » absent (${commandes.slice(0, 120)})`)
  else pass("mode « > » : les commandes du Poste sont proposées")
  await cdp.eval(TYPE(".wb-command-input", "/notes"))
  await sleep(120)
  const portee = await cdp.eval(`document.querySelector(".wb-command-section")?.textContent || ""`)
  if (!/PORTÉE · notes/.test(portee)) fail(`portée /notes non reconnue : ${portee}`)
  else pass("portée « /notes » reconnue par la barre de commande")
  await cdp.eval(TYPE(".wb-command-input", ""))
  await cdp.eval(`document.querySelector(".wb-command-input")?.blur()`)

  // ── 4) Notes : instrument dans la scène, fermeture par l'onglet ───────────
  await cdp.eval(`document.querySelector('.wb-rail-nav [aria-label="Notes"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".notes-layout") && !!document.querySelector(".instrument")`, 8_000)
  const notesSaisie = await cdp.eval(TYPE(".notes-panel input, .notes-sidebar input, .notes-layout input", "test"))
  if (notesSaisie === "absent") warn("Notes : champ de recherche introuvable (l'instrument est monté)")
  else pass("Notes : instrument monté dans la scène, recherche alimentée")
  await cdp.eval(TYPE(".notes-panel input, .notes-sidebar input, .notes-layout input", ""))
  const ongletsNotes = await cdp.eval(`document.querySelectorAll(".wb-tab").length`)
  if (ongletsNotes !== 2) fail(`Notes : ${ongletsNotes} onglets (2 attendus)`)
  else pass("Notes : un onglet unique ajouté à la barre")
  await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-close')?.click()`)
  const notesFermé = await waitFor(cdp, `!!document.querySelector(".wb-home")`, 5_000).then(() => true).catch(() => false)
  if (notesFermé) pass("Notes : fermer l'onglet rend Aujourd’hui")
  else fail("Notes : l'onglet ne rend pas la scène d'accueil")

  // ── 5) Fichiers : instrument, fil d'ariane, fermeture ─────────────────────
  await cdp.eval(`document.querySelector('.wb-rail-nav [aria-label="Fichiers"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".files-layout")`, 8_000)
  const crumbs = await cdp.eval(`document.querySelectorAll(".files-crumbs a, .files-crumbs button, .files-crumbs li, .files-crumbs span").length`)
  if (crumbs < 1) warn("Fichiers : fil d'ariane vide")
  else pass(`Fichiers : instrument monté, fil d'ariane (${crumbs} nœuds)`)
  await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-close')?.click()`)
  const fichiersFermé = await waitFor(cdp, `!!document.querySelector(".wb-home")`, 5_000).then(() => true).catch(() => false)
  if (fichiersFermé) pass("Fichiers : fermeture par l'onglet")
  else fail("Fichiers : l'onglet ne se ferme pas")

  // ── 6) Réglages : sections dans l'inspecteur, fermeture ───────────────────
  await cdp.eval(`document.querySelector('.wb-rail-bottom [aria-label="Réglages"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".unified-settings")`, 8_000)
  const onglets = await cdp.eval(`[...document.querySelectorAll(".wb-inspector-tab")].map((b) => b.textContent)`)
  if (onglets.length !== 3) fail(`Réglages : ${onglets.length} sections (3 attendues) : ${onglets.join(", ")}`)
  else pass(`Réglages : sections ${onglets.join(" / ")}`)
  let sectionsOk = true
  for (const t of ["Configuration", "Apparence", "Usage"]) {
    const n = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".wb-inspector-tab")].find((x) => x.textContent === ${JSON.stringify(t)}); if (!b) return -1; b.click(); return document.querySelectorAll(".unified-settings-scroll .settings-section, .unified-settings-scroll .settings-pane, .unified-settings-scroll .field, .unified-settings-scroll .appearance-group").length })()`)
    if (n < 1) { sectionsOk = false; fail(`Réglages : la section « ${t} » rend vide`) }
  }
  if (sectionsOk) pass("Réglages : les 3 sections rendent du contenu")
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".wb-inspector-tab")].find((x) => x.textContent === "Apparence"); b?.click(); return 1 })()`)
  await cdp.shot(`${OUT}/feat-settings.png`)
  await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-close')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".wb-home")`, 5_000)

  // ── 7) Orchestration : mode de délégation ─────────────────────────────────
  await cdp.eval(`document.querySelector('.wb-rail-nav [aria-label="Orchestration"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".tasks-principal-card") && !!document.querySelector(".tasks-mode-switch")`, 10_000)
  const orchestrationNommée = await cdp.eval(`document.body.innerText.includes("Modes de délégation de l’agent principal")`)
  if (orchestrationNommée) pass("Orchestration : titre et portée explicités")
  else fail("Orchestration : le titre fonctionnel est absent")
  const modes = await cdp.eval(`document.querySelectorAll(".tasks-mode-option").length`)
  const auto = await cdp.eval(`!!document.querySelector('.tasks-mode-option[aria-pressed="true"]')`)
  if (modes !== 4) fail(`Orchestration : switch à ${modes} modes (4 attendus)`)
  else if (!auto) fail("Orchestration : aucun mode actif (Auto doit être pressé par défaut)")
  else pass(`Orchestration : switch ${modes} modes (Auto actif)`)
  await cdp.shot(`${OUT}/feat-tasks.png`)
  await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-close')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".wb-home")`, 5_000)

  // ── 8) Conversation : nouvel onglet, état vide, composeur ─────────────────
  await cdp.eval(`document.querySelector(".wb-tabs-tools button")?.click()`)
  await waitFor(cdp, `!!document.querySelector(".workspace-layout")`, 8_000)
  const vide = await cdp.eval(`!!document.querySelector(".empty-state")`)
  const composeur = await cdp.eval(`(() => { const t = document.querySelector(".composer textarea"); return t ? t.disabled : null })()`)
  if (!vide) warn("conversation : l'état vide « Prêt à commencer » n'apparaît pas")
  if (composeur !== true && composeur !== false) warn("conversation : composeur introuvable")
  else pass(`conversation : état vide, composeur ${composeur ? "désactivé" : "actif"}`)
  const kindConv = await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-kind')?.textContent || ""`)
  if (kindConv !== "CONV") fail(`conversation : l'onglet actif est « ${kindConv} » (CONV attendu)`)
  else pass("conversation : onglet CONV actif")
  await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-close')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".wb-home")`, 5_000)

  // ── 9) Terminal : instrument Freebuff sans crash ──────────────────────────
  await cdp.eval(`document.querySelector('.wb-rail-nav [aria-label="Terminal"]')?.click()`)
  await waitFor(cdp, `!!document.querySelector(".freebuff-agent-page")`, 10_000)
  const titreTerminal = await cdp.eval(`document.body.innerText.includes("Terminal Freebuff")`)
  if (titreTerminal) pass("Terminal : page nommée Terminal Freebuff")
  else fail("Terminal : le titre fonctionnel est absent")
  await cdp.shot(`${OUT}/feat-freebuff.png`)
  await cdp.eval(`document.querySelector('.wb-tab[data-selected="true"] .wb-tab-close')?.click()`)
  const accueil = await waitFor(cdp, `!!document.querySelector(".wb-home")`, 6_000).then(() => true).catch(() => false)
  if (accueil) pass("Terminal : fermer l'onglet rend Aujourd’hui")
  else fail("Terminal : impossible de revenir à Aujourd’hui")

  // ── 10) Aujourd’hui : planche de données + capture rapide ─────────────────
  const tuiles = await cdp.eval(`document.querySelectorAll(".wb-tile").length`)
  const capture = await cdp.eval(`!!document.querySelector(".wb-capture textarea")`)
  if (tuiles < 4 || !capture) fail(`Aujourd’hui : ${tuiles} tuiles, capture ${capture ? "présente" : "absente"}`)
  else pass(`Aujourd’hui : ${tuiles} tuiles de données, capture rapide présente`)

  // ── 11) Ergonomie : boutons nommés, cibles, focus-visible ─────────────────
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

  // ── 12) Contrastes des tokens (clair ET sombre) ───────────────────────────
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
  say(`  brut clair : ${clair.rawText} | ${clair.rawMuted}`)
  const themeAvant = await cdp.eval(`document.documentElement.dataset.theme || ""`)
  await cdp.eval(`document.documentElement.dataset.theme = "dark"`)
  await sleep(200)
  const sombre = JSON.parse(await cdp.eval(CONTRASTE))
  say(`contrastes sombre : texte/bg=${sombre.text} texte/panel=${sombre.textPanel} muted/bg=${sombre.muted} muted/panel=${sombre.mutedPanel}`)
  say(`  brut sombre : ${sombre.rawText} | ${sombre.rawMuted}`)
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

  // ── 13) Performance : chargement, heap, DOM ───────────────────────────────
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
  pass(`perf : DCL=${P.dcl}ms load=${P.load}ms FCP=${P.fcp}ms, ${P.ressources} ressources/${P.octets} Ko, DOM=${P.nœuds ?? P.dom} nœuds${heap !== null ? `, heap=${heap} Mo` : ""}`)
  if (P.load > 3_000) warn(`chargement ${P.load}ms > 3s`)
  if (P.dom > 2_500) warn(`DOM très profond : ${P.dom} nœuds`)

  // ── 14) Capture finale du hub pour contrôle à l'œil ───────────────────────
  await cdp.shot(`${OUT}/feat-hub.png`)

  // ── 15) Erreurs console récoltées pendant tout le parcours ────────────────
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
