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

  // ── 1) Démarrage : hub monté, runtime prêt ────────────────────────────────
  await waitFor(cdp, `document.readyState === "complete" && !!document.querySelector(".home-hub")`, 30_000)
  const href = await cdp.eval("location.href")
  if (!/tauri\.localhost/.test(href)) fail(`origine inattendue : ${href}`)
  const state = await waitFor(cdp, `window.__TAURI_INTERNALS__.invoke("aven_call", { method: "state", args: [] }).then((s) => s && s.status === "ready" ? JSON.stringify({ ws: s.needsWorkspace, keys: Object.entries(s.keys || {}).filter(([, v]) => v).map(([k]) => k), agents: (s.agents || []).length }) : null, () => null)`, 90_000)
  const st = JSON.parse(state)
  pass(`démarrage : runtime ready, espace actif=${!st.ws}, clés=[${st.keys.join(", ") || "aucune"}], agents=${st.agents}`)
  if (st.ws) warn("needsWorkspace=true : l'app attend un choix d'espace au lancement")

  // ── 2) Hub : les 4 cartes + dictée ────────────────────────────────────────
  const cartes = await cdp.eval(`[...document.querySelectorAll(".hub-card")].map((b) => b.getAttribute("aria-label"))`)
  const attendues = ["Projet", "Tâches", "Fichiers", "Notes"]
  const absentes = attendues.filter((a) => !cartes.some((c) => c && c.startsWith(a)))
  if (absentes.length) fail(`cartes du hub absentes : ${absentes.join(", ")} (vu : ${cartes.join(" | ")})`)
  else pass(`hub : 4 cartes présentes (${cartes.length} au total)`)
  const voix = await cdp.eval(`document.querySelector(".voice-core")?.getAttribute("aria-label") || null`)
  if (!voix) fail("bouton de dictée introuvable")
  else pass(`dictée exposée : « ${voix.slice(0, 60)}… »`)

  // ── 3) Recherche du hub : saisie sans casse ───────────────────────────────
  const tapé = await cdp.eval(TYPE(".home-command input", "syntaxe"))
  const vu = await cdp.eval(`document.querySelector(".home-command input")?.value`)
  if (tapé === "absent" || vu !== "syntaxe") fail(`recherche du hub : saisie KO (vu=${vu})`)
  else pass("recherche du hub : la saisie alimente l'input React")
  await cdp.eval(TYPE(".home-command input", ""))
  await cdp.eval(ESC)

  // ── 4) Sélecteur « Toutes les conversations » ─────────────────────────────
  const boutons = await cdp.eval(`[...document.querySelectorAll("button")].filter((b) => /Tout voir/i.test(b.textContent)).length`)
  if (boutons) {
    await cdp.eval(`[...document.querySelectorAll("button")].find((b) => /Tout voir/i.test(b.textContent)).click()`)
    await waitFor(cdp, `!!document.querySelector('[aria-label="Toutes les conversations"]')`, 5_000)
    pass("sélecteur de conversations : s'ouvre (rôle dialog)")
    await cdp.eval(ESC)
    const fermé = await waitFor(cdp, `!document.querySelector('[aria-label="Toutes les conversations"]')`, 5_000).then(() => true).catch(() => false)
    if (fermé) pass("sélecteur de conversations : Échap ferme le dialogue")
    else { await cdp.eval(`document.querySelector('[aria-label="Toutes les conversations"] .dialog-close')?.click()`); warn("sélecteur de conversations : Échap ne l'a pas fermé (fermeture par le bouton)") }
  } else warn("bouton « Tout voir » introuvable dans les récents")

  // ── 5) Page Tâches : spécialistes chargés ─────────────────────────────────
  const clicAgents = await REAL_CLICK(cdp, ".hub-card-agents")
  if (clicAgents !== "ok") fail(`clic réel carte Tâches : ${clicAgents}`)
  // v10.1.0 : UNE carte orchestrateur + switch segmenté (Auto/Code/Analyse/Recherche).
  await waitFor(cdp, `!!document.querySelector(".tasks-principal-card") && !!document.querySelector(".tasks-mode-switch")`, 10_000)
  const modes = await cdp.eval(`document.querySelectorAll(".tasks-mode-option").length`)
  const auto = await cdp.eval(`!!document.querySelector('.tasks-mode-option[aria-pressed="true"]')`)
  const ouvrir = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".tasks-principal-actions button")][0]; return b ? !b.disabled : false })()`)
  if (modes !== 4) fail(`page Tâches : switch à ${modes} modes (4 attendus)`)
  else if (!auto) fail("page Tâches : aucun mode actif (Auto doit être pressé par défaut)")
  else pass(`page Tâches : switch ${modes} modes (Auto actif), bouton principal ${ouvrir ? "actif" : "DÉSACTIVÉ (agents non chargés)"}`)
  if (!ouvrir) warn("agents non chargés : la conversation principale ne s'ouvre pas")
  await cdp.shot(`${OUT}/feat-tasks.png`)

  // ── 6) Vue conversation : état vide, composeur désactivé, retour ──────────
  if (ouvrir) {
    await cdp.eval(`document.querySelector(".tasks-principal-actions button").click()`)
    await waitFor(cdp, `!!document.querySelector(".workspace-layout") && !!document.querySelector(".chat-titlebar")`, 8_000)
    const vide = await cdp.eval(`!!document.querySelector(".empty-state")`)
    const composeur = await cdp.eval(`(() => { const t = document.querySelector(".composer textarea"); return t ? t.disabled : null })()`)
    if (!vide) warn("vue conversation : l'état vide « Prêt à commencer » n'apparaît pas")
    if (composeur !== true) fail(`composeur censé être désactivé sans conversation (disabled=${composeur})`)
    else pass("vue conversation : état vide + composeur désactivé, sidebar présente")
    await cdp.eval(`[...document.querySelectorAll(".window-tab")].find((b) => /Accueil/.test(b.textContent))?.click()`)
    await waitFor(cdp, `!!document.querySelector(".home-hub")`, 6_000)
    pass("retour à l'accueil depuis la conversation")
  } else {
    // v10.0.1 : agents non chargés → pas de conversation à ouvrir, MAIS la suite
    // du tour (cartes du hub) suppose l'accueil : on y retourne quand même.
    const back6 = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".window-tab")].find((x) => /Accueil/.test(x.textContent)); if (!b) return "absent"; b.click(); return "ok" })()`)
    const revenu6 = await waitFor(cdp, `!!document.querySelector(".home-hub")`, 6_000).then(() => true).catch(() => false)
    if (back6 === "ok" && revenu6) pass("retour à l'accueil (agents non chargés : conversation sautée)")
    else fail("retour à l'accueil impossible depuis la page Tâches (agents non chargés)")
  }

  // ── 7) Notes : dialogue, recherche, fermeture ─────────────────────────────
  const clicNotes = await REAL_CLICK(cdp, ".hub-card-notes")
  if (clicNotes !== "ok") fail(`clic réel carte Notes : ${clicNotes}`)
  await waitFor(cdp, `!!document.querySelector(".notes-dialog")`, 8_000)
  const notesSaisie = await cdp.eval(TYPE(".notes-dialog input", "test"))
  if (notesSaisie === "absent") fail("Notes : champ de recherche introuvable")
  else pass("Notes : dialogue ouvert, recherche alimentée")
  await cdp.eval(TYPE(".notes-dialog input", ""))
  await cdp.eval(`document.querySelector(".notes-dialog .dialog-close")?.click()`)
  const notesFermé = await waitFor(cdp, `!document.querySelector(".notes-dialog")`, 5_000).then(() => true).catch(() => false)
  if (notesFermé) pass("Notes : fermeture par le bouton")
  else fail("Notes : le dialogue ne se ferme pas")

  // ── 8) Fichiers : dialogue, fil d'ariane, fermeture ───────────────────────
  const clicFichiers = await REAL_CLICK(cdp, ".hub-card-files")
  if (clicFichiers !== "ok") fail(`clic réel carte Fichiers : ${clicFichiers}`)
  await waitFor(cdp, `!!document.querySelector(".files-dialog")`, 8_000)
  const crumbs = await cdp.eval(`document.querySelectorAll(".files-crumbs a, .files-crumbs button, .files-crumbs li, .files-crumbs span").length`)
  if (crumbs < 1) warn("Fichiers : fil d'ariane vide")
  else pass(`Fichiers : dialogue ouvert, fil d'ariane (${crumbs} nœuds)`)
  await cdp.eval(`document.querySelector(".files-dialog .dialog-close")?.click()`)
  const fichiersFermé = await waitFor(cdp, `!document.querySelector(".files-dialog")`, 5_000).then(() => true).catch(() => false)
  if (fichiersFermé) pass("Fichiers : fermeture par le bouton")
  else fail("Fichiers : le dialogue ne se ferme pas")

  // ── 9) Réglages : 3 sections rendues, Échap ferme ─────────────────────────
  await cdp.eval(`document.querySelector('[aria-label="Ouvrir les paramètres"]').click()`)
  await waitFor(cdp, `!!document.querySelector(".unified-settings")`, 8_000)
  const onglets = await cdp.eval(`[...document.querySelectorAll(".settings-tabs button")].map((b) => b.textContent)`)
  if (onglets.length !== 3) fail(`Réglages : ${onglets.length} onglets (3 attendus) : ${onglets.join(", ")}`)
  else pass(`Réglages : onglets ${onglets.join(" / ")}`)
  // Chaque section doit rendre du contenu
  let sectionsOk = true
  for (const t of ["Configuration", "Apparence", "Usage"]) {
    const n = await cdp.eval(`(() => { const b = [...document.querySelectorAll(".settings-tabs button")].find((x) => x.textContent === ${JSON.stringify(t)}); if (!b) return -1; b.click(); return document.querySelectorAll(".unified-settings-scroll .settings-section, .unified-settings-scroll .settings-pane, .unified-settings-scroll .field, .unified-settings-scroll .appearance-group").length })()`)
    if (n < 1) { sectionsOk = false; fail(`Réglages : la section « ${t} » rend vide`) }
  }
  if (sectionsOk) pass("Réglages : les 3 sections rendent du contenu")
  await cdp.eval(`(() => { const b = [...document.querySelectorAll(".settings-tabs button")].find((x) => x.textContent === "Apparence"); b?.click(); return 1 })()`)
  await cdp.shot(`${OUT}/feat-settings.png`)
  await cdp.eval(ESC)
  const reglagesFermé = await waitFor(cdp, `!document.querySelector(".unified-settings")`, 5_000).then(() => true).catch(() => false)
  if (reglagesFermé) pass("Réglages : Échap ferme le dialogue")
  else { await cdp.eval(`document.querySelector(".unified-settings .dialog-close")?.click()`); warn("Réglages : Échap ne ferme pas (bouton utilisé)") }

  // ── 10) Page Freebuff : présence honnête, pas de crash ────────────────────
  const clicProjet = await REAL_CLICK(cdp, ".hub-card-project")
  if (clicProjet !== "ok") fail(`clic réel carte Projet : ${clicProjet}`)
  await waitFor(cdp, `!!document.querySelector(".freebuff-agent-page")`, 10_000)
  const presence = await waitFor(cdp, `(() => { const el = document.querySelector(".freebuff-agent-page [role='status'], .freebuff-agent-page .agent-presence"); if (!el) return null; const t = el.textContent.trim(); return t && t.length < 80 ? t : null })()`, 15_000)
  const envoiDesactive = await cdp.eval(`(() => { const b = document.querySelector(".agent-composer-send"); return b ? b.disabled : null })()`)
  if (envoiDesactive !== true) warn(`Freebuff : bouton Envoyer actif alors que la présence est « ${presence} »`)
  pass(`page Freebuff : présence affichée « ${presence.slice(0, 50)} », envoi ${envoiDesactive ? "correctement désactivé" : "AUTORISÉ"}`)
  await cdp.shot(`${OUT}/feat-freebuff.png`)
  const retours = await cdp.eval(`(() => {
    const cibles = [...document.querySelectorAll(".window-tab, .freebuff-agent-page header button")].filter((b) => /Accueil/.test(b.textContent))
    if (!cibles.length) return "aucun retour visible"
    cibles[cibles.length - 1].click()
    return "ok"
  })()`)
  if (retours !== "ok") fail(`retour Freebuff : ${retours}`)
  const accueil = await waitFor(cdp, `!!document.querySelector(".home-hub")`, 6_000).then(() => true).catch(() => false)
  if (accueil) pass("retour à l'accueil depuis Freebuff")
  else fail("retour à l'accueil depuis Freebuff impossible")

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
