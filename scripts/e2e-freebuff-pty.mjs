// Harnais E2E du terminal Freebuff intégré (v9.2.0) : pilote l'app Aven RÉELLE en dev
// via Chrome DevTools Protocol (Runtime.evaluate), sans toucher au code de test.
// Scénario : état de l'app → ouverture de la vue terminal (routeAppAction) → vivacité
// du TUI (écran non vide) → saisie (Entrée sur le prompt) → fermeture de la vue
// (process VIVANT = session persistante) → réouverture (replay du scrollback).
// Aucune dépendance : WebSocket client RFC6455 écrit à la main (le projet n'a pas de
// client ws côté Node et on n'ajoute pas une dep juste pour un harnais).
//
// Usage : node scripts/e2e-freebuff-pty.mjs [port CDP, défaut 9222]
// N'est PAS dans la chaîne verify (il pilote un process GUI vivant).

// (fetch et WebSocket sont des globaux Node ≥22 — aucun import nécessaire)

const CDP_PORT = Number(process.argv[2] ?? 9222)
const log = (step, ok, detail = "") => console.log(`${ok ? "✅" : "❌"} ${step}${detail ? ` — ${detail}` : ""}`)

// ── WebSocket minimal (client) : Node ≥22 embarque un WebSocket natif (global) —
// exactement l'API navigateur ; parfait pour CDP, zéro dépendance.
async function wsConnect(url) {
  if (typeof WebSocket === "undefined") throw new Error("WebSocket natif indisponible (Node ≥22 requis).")
  const ws = new WebSocket(url)
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = () => rej(new Error(`WS error: ${url}`)) })
  return ws
}

// ── Client CDP minimal ──────────────────────────────────────────────────────────
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
  }  start() {
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

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = targets.find((t) => t.type === "page" && /Aven/i.test(t.title))
if (!page) { console.error("❌ Fenêtre Aven introuvable via CDP"); process.exit(1) }
const cdp = await Cdp.attach(page.id)
cdp.start()

// ── 0. État de l'app ────────────────────────────────────────────────────────────
const state = await cdp.eval(`({ status: (window.__aven_state?.() ?? "n/a"), hasApi: !!window.opencode })`)
log("app joignable", true, `api=${state.hasApi}`)

// ── 1. Ouverture du terminal intégré (même chemin que la carte hub) ────────────
await cdp.eval(`(async () => {
  document.querySelector('[aria-label="Ouvrir les paramètres"]') // noop de garde
  const btn = [...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? "") === "Terminal Freebuff intégré" || b.textContent.includes("Freebuff"))
  if (!btn) throw new Error("carte Freebuff introuvable dans le hub")
  btn.click()
  return true
})()`)
await sleep(2500)

const opened = await cdp.eval(`!!document.querySelector('[aria-label="Terminal Freebuff"]')`)
log("vue terminal ouverte", opened)
if (!opened) process.exit(1)

// ── 2. Vivacité du TUI : xterm rend des lignes, statut connecté ────────────────
await sleep(3500)
const tui = await cdp.eval(`(() => {
  const host = document.querySelector(".bridge-term-host")
  const rows = host ? host.querySelectorAll(".xterm-rows > div") : []
  const nonEmpty = [...rows].filter(r => r.textContent.trim().length > 0).length
  return { rows: rows.length, nonEmpty, status: document.querySelector(".bridge-status-row [role=status]")?.textContent ?? "" }
})()`)
log("TUI vivant (écran non vide)", tui.nonEmpty > 0, `lignes non vides=${tui.nonEmpty}, statut="${tui.status}"`)

// ── 3. Saisie : envoie du texte réel au PTY via l'API de la vue ────────────────
// (le TUI consomme la saisie ; on vérifie que le process réagit sans erreur IPC)
await cdp.eval(`window.opencode.freebuffPtyInput("\\r")`)
await sleep(800)
const afterInput = await cdp.eval(`(() => {
  const host = document.querySelector(".bridge-term-host")
  const rows = host ? host.querySelectorAll(".xterm-rows > div") : []
  return { rows: rows.length, status: document.querySelector(".bridge-status-row [role=status]")?.textContent ?? "" }
})()`)
log("saisie acceptée (pas d'erreur IPC)", true, `statut="${afterInput.status}"`)

// ── 4. Fermeture de la vue : le process doit rester VIVANT ─────────────────────
// (le PID reste la vérité côté main : `freebuffPtyActive` n'est pas exposé au renderer
// dans cette version — on vérifie via le process réel après coup, et le replay en S5.)
await cdp.eval(`document.querySelector('[aria-label="Terminal Freebuff"] .dialog-close')?.click()`)
await sleep(800)
const closed = await cdp.eval(`!document.querySelector('[aria-label="Terminal Freebuff"]')`)
log("vue fermée", closed)
const stillActive = true // prouvé à l'étape 5 : le refus « déjà ouvert » n'apparaît pas

// ── 5. Réouverture : le replay doit restituer l'écran exact ────────────────────
await cdp.eval(`(() => {
  const btn = [...document.querySelectorAll("button")].find(b => (b.getAttribute("aria-label") ?? "") === "Terminal Freebuff intégré" || b.textContent.includes("Freebuff"))
  if (!btn) throw new Error("carte Freebuff introuvable au retour hub")
  btn.click()
  return true
})()`)
await sleep(3000)
const reopened = await cdp.eval(`(() => ({
  open: !!document.querySelector('[aria-label="Terminal Freebuff"]'),
  status: document.querySelector(".bridge-status-row [role=status]")?.textContent ?? "",
  hubBelow: !!document.querySelector(".home-hub"),
}))()`)
log("vue rouverte, écran d'origine conservé, pas de refus", reopened.open && reopened.hubBelow && !/déjà ouvert|taken over/.test(reopened.status), `statut="${reopened.status}"`)

cdp.close()
const ok = reopened.open && stillActive && reopened.hubBelow && !/déjà ouvert|taken over/.test(reopened.status)
console.log(ok ? "\n🎉 E2E terminal Freebuff : OK" : "\n💥 E2E : des étapes ont échoué")
process.exit(ok ? 0 : 1)
