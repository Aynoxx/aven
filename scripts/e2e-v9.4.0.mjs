// Sonde E2E v9.4.0 : pilote l'app Aven RÉELLE en dev via Chrome DevTools Protocol
// (Runtime.evaluate), comme scripts/e2e-freebuff-pty.mjs. Vérifie l'architecture
// « un cerveau, deux moteurs » : hub 4 cartes à 0/90/180/270° (carte Freebuff sortie
// du cercle, pastille conservée), page Assistants (tableau « qui fait quoi » + panneau
// Freebuff), sélecteur de modèle (menu listbox avec « Auto »), et les nouvelles API du
// preload (setChatModel, modelChain, freebuffCliLaunch à 3 arguments).
//
// Usage : lancer l'app avec --remote-debugging-port=9222 puis
//         node scripts/e2e-v9.4.0.mjs [port CDP, défaut 9222]
// N'est PAS dans la chaîne verify (il pilote un process GUI vivant).

// fetch et WebSocket sont des globaux Node ≥22 — aucun import nécessaire.

const CDP_PORT = Number(process.argv[2] ?? 9222)
const log = (step, ok, detail = "") => console.log(`${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`)

async function wsConnect(url) {
  const ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`WS error: ${url}`)) })
  return ws
}

class Cdp {
  constructor(ws) { this.ws = ws; this.id = 0; this.pending = new Map() }
  static async attach(targetId) {
    const ws = await wsConnect(`ws://127.0.0.1:${CDP_PORT}/devtools/page/${targetId}`)
    return new Cdp(ws)
  }
  send(method, params = {}) {
    const id = ++this.id
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.ws.send(JSON.stringify({ id, method, params }))
    })
  }
  start() {
    this.ws.onmessage = (ev) => {
      const msg = JSON.parse(String(ev.data))
      if (msg.id && this.pending.has(msg.id)) {
        const { resolve, reject } = this.pending.get(msg.id)
        this.pending.delete(msg.id)
        msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result)
      }
    }
  }
  async eval(expression) {
    const r = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true })
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? "eval error")
    return r.result.value
  }
  close() { this.ws.close() }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

let failures = 0
const check = (step, ok, detail) => { log(step, ok, detail); if (!ok) failures++ }

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = targets.find((t) => t.type === "page" && /Aven/i.test(t.title))
if (!page) { console.error("❌ Fenêtre Aven introuvable via CDP"); process.exit(1) }
const cdp = await Cdp.attach(page.id)
cdp.start()

// ── 0. App joignable + nouvelles API du preload ─────────────────────────────────
await sleep(1500)
const api = await cdp.eval(`(() => ({
  hasApi: !!window.opencode,
  setChatModel: typeof window.opencode.setChatModel,
  modelChain: typeof window.opencode.modelChain,
  launchArity: window.opencode.freebuffCliLaunch ? window.opencode.freebuffCliLaunch.length : -1,
}))()`)
check("preload : API v9.4.0 exposées", api.hasApi && api.setChatModel === "function" && api.modelChain === "function",
  `setChatModel=${api.setChatModel}, modelChain=${api.modelChain} (l'arité du bridge n'est pas observable à travers contextBridge)`,
)

// ── 1. Hub 4 cartes : angles 0/90/180/270, plus de carte Freebuff, pastille là ──
const hub = await cdp.eval(`(() => {
  const angleOf = (sel) => {
    const el = document.querySelector(sel)
    return el ? (getComputedStyle(el).getPropertyValue("--hub-angle") || "").trim() : null
  }
  return {
    homeVisible: !!document.querySelector(".home-hub"),
    angles: [".hub-card-project", ".hub-card-agents", ".hub-card-files", ".hub-card-notes"].map(angleOf),
    freebuffGone: !document.querySelector(".hub-card-freebuff"),
    pill: !!document.querySelector(".freebuff-pill"),
  }
})()`)
check("hub : 4 cartes à 0/90/180/270°", hub.homeVisible && JSON.stringify(hub.angles) === JSON.stringify(["0deg", "90deg", "180deg", "270deg"]), JSON.stringify(hub.angles))
check("hub : carte Freebuff sortie du cercle, pastille conservée", hub.freebuffGone && hub.pill, `freebuffGone=${hub.freebuffGone}, pill=${hub.pill}`)

// ── 2. Page Assistants : carte « Agents » → tableau + panneau Freebuff ──────────
const agentsCard = await cdp.eval(`(() => {
  const card = document.querySelector(".hub-card-agents")
  if (!card) return false
  card.click()
  return true
})()`)
await sleep(600)
// v9.6.0 : la page est devenue « Tâches » — agent principal + modes (le tableau v9.4.0
// est masqué, le panneau Freebuff a quitté la page).
const assistants = await cdp.eval(`(() => ({
  heading: [...document.querySelectorAll("h1")].map((h) => h.textContent).find((t) => /mode|agent|principal/i.test(t)) ?? "",
  modes: document.querySelectorAll(".tasks-mode-card").length,
  principal: !!document.querySelector(".tasks-principal-card"),
  off: !!document.querySelector(".assistants-freebuff"),
}))()`)
check("page Tâches : en-tête + agent principal", agentsCard && assistants.principal, `h1="${assistants.heading}"`)
check("page Tâches : 4 modes (code, analyse, recherche, tâche complexe)", assistants.modes === 4 && !assistants.off, `modes=${assistants.modes}`)

// Retour à l'accueil pour la suite.
await cdp.eval(`(() => {
  const back = [...document.querySelectorAll("button")].find((b) => (b.getAttribute("aria-label") ?? "").startsWith("Retour"))
  if (back) back.click()
  return true
})()`)
await sleep(500)

// ── 3. Sélecteur de modèle : ouvrir une conversation récente puis le menu ───────
const openedChat = await cdp.eval(`(() => {
  // v9.4.0 : cliquer une VRAIE conversation récente (pas le bouton « Nouvelle
  // conversation » qui partage le conteneur .home-recent).
  const btn = document.querySelector(".home-recent-item")
  if (!btn) return false
  btn.click()
  return true
})()`)
if (openedChat) {
  await sleep(800)
  const menuClosed = await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Choisir le modèle"))
    if (!btn) return { found: false }
    btn.click()
    return { found: true }
  })()`)
  await sleep(300)
  const menu = await cdp.eval(`(() => {
    const listbox = document.querySelector('[aria-label="Modèles gratuits disponibles"]')
    const options = listbox ? [...listbox.querySelectorAll('[role="option"]')] : []
    return { open: !!listbox, count: options.length, autoFirst: options.length > 0 && options[0].textContent.includes("Auto") }
  })()`)
  check("sélecteur de modèle : menu listbox avec « Auto » en tête", menuClosed.found && menu.open && menu.count >= 1 && menu.autoFirst, `options=${menu.count}`)
  // On referme sans choisir (ne pas épingler un modèle pendant le smoke).
  await cdp.eval(`(() => {
    const btn = [...document.querySelectorAll("button")].find((b) => (b.textContent || "").includes("Choisir le modèle"))
    if (btn) btn.click()
    return true
  })()`)
} else {
  log("sélecteur de modèle : pas de conversation récente, étape sautée (couvert par la sonde statique)", true)
}

cdp.close()
if (failures > 0) { console.log(`\n💥 E2E v9.4.0 : ${failures} échec(s)`); process.exit(1) }
console.log("\n🎉 E2E v9.4.0 : OK")
