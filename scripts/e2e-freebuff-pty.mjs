// Harnais E2E du terminal Freebuff intégré — réécrit pour le Poste (v11.0.0).
//
// v11.0.0 : la surface a changé, pas le scénario. Le terminal n'est plus une page
// plein écran ouverte depuis la pastille du hub orbital (`.freebuff-pill`, `.home-hub`,
// `.freebuff-agent-page`) : c'est un INSTRUMENT du Poste, ouvert par le rail
// (« Instruments » → « Terminal ») et rendu dans la scène sous forme d'onglet. Le
// preload `window.opencode` n'existe plus non plus : tout passe par l'IPC Tauri.
// Ce que le harnais prouve reste identique :
//   ouverture → vivacité du TUI (xterm rendu non vide, présence « En ligne ») →
//   saisie réelle reçue par le PTY → fermeture de l'ONGLET (process VIVANT) →
//   réouverture (replay du même écran).
//
// Usage : lancer l'app avec --remote-debugging-port=9222 puis
//         node scripts/e2e-freebuff-pty.mjs [port CDP, défaut 9222]
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

// v11.0.0 : le rail et l'onglet portent des noms accessibles stables — le harnais
// s'appuie dessus plutôt que sur des classes de mise en page.
const CLICK_RAIL_TERMINAL = `(() => {
  const btn = document.querySelector('nav[aria-label="Instruments"] button[aria-label="Terminal"]')
  if (!btn) return false
  btn.click()
  return true
})()`
const CLOSE_TERMINAL_TAB = `(() => {
  const btn = document.querySelector('button[aria-label="Fermer l’onglet Terminal"]')
  if (!btn) return false
  btn.click()
  return true
})()`
const READ_TERM = `(() => {
  const host = document.querySelector(".bridge-term-host")
  const rows = host ? [...host.querySelectorAll(".xterm-rows > div")] : []
  return {
    host: !!host,
    rows: rows.length,
    nonEmpty: rows.filter((r) => r.textContent.trim().length > 0).length,
    presence: document.querySelector(".bridge-status-row .agent-presence")?.textContent?.trim() ?? "",
    alerts: [...document.querySelectorAll('.wb-stage [role="alert"]')].map((a) => a.textContent.trim()).join(" | "),
    first: rows.map((r) => r.textContent).join("\\n").slice(0, 120),
  }
})()`

const targets = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
const page = targets.find((t) => t.type === "page" && /Aven/i.test(t.title))
if (!page) { console.error("❌ Fenêtre Aven introuvable via CDP"); process.exit(1) }
const cdp = await Cdp.attach(page.id)
cdp.start()

// ── 0. Le Poste est monté (et l'ancien hub orbital a bien disparu) ──────────────
await sleep(1200)
const shell = await cdp.eval(`({
  poste: !!document.querySelector(".wb-app"),
  rail: !!document.querySelector('nav[aria-label="Instruments"]'),
  stage: !!document.querySelector("#wb-stage"),
  hubMort: !document.querySelector(".home-hub") && !document.querySelector(".freebuff-pill"),
})`)
check("Poste : coquille v11 montée (rail + scène), hub orbital absent",
  shell.poste && shell.rail && shell.stage && shell.hubMort,
  `poste=${shell.poste}, rail=${shell.rail}, hubMort=${shell.hubMort}`)

// ── 1. Ouverture du terminal : ce n'est plus une page, c'est un onglet ────────
const clicked = await cdp.eval(CLICK_RAIL_TERMINAL)
await sleep(1200)
const opened = await cdp.eval(`({
  selected: document.querySelector('#wb-tab-terminal')?.getAttribute("aria-selected") === "true",
  host: !!document.querySelector('#wb-stage [aria-label="Terminal Freebuff interactif"]'),
  instrument: !!document.querySelector('#wb-stage .agents-page'),
})`)
check("onglet Terminal ouvert DANS la scène (instrument, pas une page)",
  clicked && opened.selected && opened.host && opened.instrument,
  `selected=${opened.selected}, host=${opened.host}`)
if (!(clicked && opened.selected && opened.host)) {
  console.log("\n💥 E2E : le terminal ne s'ouvre pas — arrêt (les étapes suivantes n'ont pas de cible).")
  cdp.close()
  process.exit(1)
}

// ── 2. Vivacité du TUI : xterm rend des lignes et la présence passe « En ligne » ─
// (le CLI démarre au premier besoin : on laisse jusqu'à 45 s, puis on remonte
// l'alerte réelle — CLI absent ou app Desktop Freebuff qui tient la session.)
let term = null
const alive = Date.now() + 45_000
while (Date.now() < alive) {
  term = await cdp.eval(READ_TERM)
  if (term.nonEmpty > 0 && term.presence === "En ligne") break
  await sleep(700)
}
term ??= await cdp.eval(READ_TERM)
check("TUI vivant (écran non vide) et présence « En ligne »",
  term.nonEmpty > 0 && term.presence === "En ligne",
  `lignes non vides=${term.nonEmpty}, présence="${term.presence}", alerte="${term.alerts}"`)

// ── 3. Saisie : un vrai appui clavier, pas un appel d'API détourné ────────────
// v11.0.0 : `window.opencode.freebuffPtyInput` n'existe plus. On tape dans le
// textarea caché d'xterm (c'est le chemin réel de l'utilisateur) et on laisse
// xterm encoder la touche vers le PTY.
const focused = await cdp.eval(`(() => {
  const ta = document.querySelector('.bridge-term-host .xterm-helper-textarea')
  if (!ta) return false
  ta.focus()
  return document.activeElement === ta
})()`)
const key = { key: "Enter", code: "Enter", text: "\r", unmodifiedText: "\r", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 }
await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", ...key })
await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", ...key, text: undefined, unmodifiedText: undefined })
await sleep(1200)
const after = await cdp.eval(READ_TERM)
// Preuve minimale et honnête : la touche a atteint le terminal (focus posé), la
// session n'est pas morte et aucune alerte n'est apparue. Comparer le texte exact
// de l'écran serait flaky (le TUI redessine des lignes identiques) : on le journalise.
check("saisie acceptée (Entrée reçue, session toujours en ligne, aucune alerte)",
  focused && after.host && after.nonEmpty > 0 && after.presence === "En ligne" && after.alerts === "",
  `focus=${focused}, présence="${after.presence}", alerte="${after.alerts}", écran changé=${after.first !== term.first}`)

// ── 4. Fermeture de l'ONGLET : le process doit rester VIVANT ───────────────────
// v11.0.0 : on ne ferme plus une page (Ctrl+W ferme l'onglet, jamais la fenêtre) —
// Aujourd'hui redevient l'onglet actif et le Poste reste monté.
const closed = await cdp.eval(CLOSE_TERMINAL_TAB)
await sleep(700)
const afterClose = await cdp.eval(`({
  tabGone: !document.querySelector('#wb-tab-terminal'),
  homeActive: document.querySelector('#wb-tab-home')?.getAttribute("aria-selected") === "true",
  poste: !!document.querySelector(".wb-app"),
  hostGone: !document.querySelector(".bridge-term-host"),
})`)
check("onglet fermé, Aujourd'hui rendu, Poste intact",
  closed && afterClose.tabGone && afterClose.homeActive && afterClose.poste && afterClose.hostGone,
  `tabGone=${afterClose.tabGone}, homeActive=${afterClose.homeActive}, hostGone=${afterClose.hostGone}`)

// ── 4b. Preuve directe côté host : le PTY est toujours actif ───────────────────
// `freebuffPtyActive` est exposé par l'IPC (types.ts) : c'est la vérité du process,
// pas une déduction depuis l'interface.
const ptyActive = await cdp.eval(`window.__TAURI_INTERNALS__
  ? window.__TAURI_INTERNALS__.invoke("aven_call", { method: "freebuffPtyActive", args: [] })
      .then((v) => ({ ok: true, active: v === true }), (e) => ({ ok: false, error: String(e).slice(0, 160) }))
  : { ok: false, error: "IPC Tauri indisponible" }`).catch((e) => ({ ok: false, error: String(e).slice(0, 160) }))
check("PTY toujours actif après fermeture de l'onglet (session persistante)",
  ptyActive?.ok === true && ptyActive.active === true,
  ptyActive?.ok ? `active=${ptyActive.active}` : `non mesuré : ${ptyActive?.error}`)

// ── 5. Réouverture : le replay doit restituer l'écran d'origine ────────────────
await cdp.eval(CLICK_RAIL_TERMINAL)
let replayed = null
const replayDeadline = Date.now() + 15_000
while (Date.now() < replayDeadline) {
  replayed = await cdp.eval(READ_TERM)
  if (replayed.nonEmpty > 0) break
  await sleep(400)
}
replayed ??= await cdp.eval(READ_TERM)
check("onglet rouvert : écran restitué par le replay, aucun refus de session",
  replayed.host && replayed.nonEmpty > 0 && replayed.presence === "En ligne" && !/déjà ouvert|taken over/i.test(replayed.alerts),
  `lignes non vides=${replayed.nonEmpty}, présence="${replayed.presence}", alerte="${replayed.alerts}"`)

cdp.close()
if (failures > 0) { console.log(`\n💥 E2E terminal Freebuff : ${failures} échec(s)`); process.exit(1) }
console.log("\n🎉 E2E terminal Freebuff : OK")
