// v11.15.2 : test de bout en bout de la note vocale, sans micro physique.
// v11.16.0 : la réponse décrit le CONTENU à rédiger ; le test vérifie qu'Aven le
// compose au lieu de le recopier, puis que la note écrite porte bien le texte
// rédigé — pas la phrase de l'utilisateur.
//
// Pourquoi ce harnais existe : les tests purs vérifient la machine à états et le
// classement des réponses, mais pas le chemin complet micro → VAD → enregistreur
// → STT → confirmation → écriture. Un défaut de phase (v11.15.2) rendait le micro
// sourd sans qu'aucun test unitaire ne le voie. Ici, `getUserMedia` est remplacé
// par une voix française synthétique : elle commence à parler PENDANT la question
// de l'agent, traverse le vrai STT (Groq), la composition, la vraie confirmation
// et la vraie création de note.
//
// Prérequis : binaire `src-tauri/target/debug/aven.exe` (mode dev, devUrl sur
// 127.0.0.1:5173), clé Groq configurée, voix française SAPI (Hortense).
// Vite est réutilisé s'il tourne déjà, sinon démarré puis arrêté. La note créée
// est supprimée (poubelle puis purge) et la préférence micro est restaurée.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, statSync, unlinkSync, writeFileSync } from "node:fs"
import os from "node:os"
import path from "node:path"
import { setTimeout as sleep } from "node:timers/promises"
import { fileURLToPath } from "node:url"

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const EXE = path.join(ROOT, "src-tauri/target/debug/aven.exe")
const VITE_URL = "http://127.0.0.1:5173/"
const CDP_PORT = Number(process.env.AVEN_E2E_CDP_PORT ?? 9670)
const REQUEST = "Aven, crée une note"
const CONTENT_REQUEST = "La note doit contenir un résumé de comment faire une boucle en Python."
const CONFIRM = "Oui, enregistre la note."
const ANSWER_WAV_NAME = `__aven-e2e-answer-${process.pid}.wav`
const CONFIRM_WAV_NAME = `__aven-e2e-confirm-${process.pid}.wav`
const ANSWER_WAV_PUBLIC = path.join(ROOT, "web/public", ANSWER_WAV_NAME)
const CONFIRM_WAV_PUBLIC = path.join(ROOT, "web/public", CONFIRM_WAV_NAME)
const ANSWER_WAV_URL = `/${ANSWER_WAV_NAME}`
const CONFIRM_WAV_URL = `/${CONFIRM_WAV_NAME}`
const PROFILE = mkdtempSync(path.join(os.tmpdir(), "aven-voice-note-e2e-"))

const log = (message) => console.log(message)
const warn = (message) => console.warn(message)
const withTimeout = (promise, ms, label) =>
  Promise.race([
    promise,
    sleep(ms).then(() => { throw new Error(`${label} : délai dépassé (${ms} ms)`) }),
  ])

const FAKE_MIC = `(() => {
  const native = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices)
  let fake = null
  navigator.mediaDevices.getUserMedia = async (constraints) => {
    if (!constraints || (!constraints.audio && constraints.audio !== true)) return native(constraints)
    if (fake) return fake.stream
    const ctx = new AudioContext()
    const dest = ctx.createMediaStreamDestination()
    const audio = new Audio(${JSON.stringify(ANSWER_WAV_URL)})
    audio.preload = "auto"
    const src = ctx.createMediaElementSource(audio)
    src.connect(dest)
    fake = {
      ctx, dest, audio, stream: dest.stream,
      play: async (url) => {
        if (url) { audio.src = url; audio.load() }
        await ctx.resume()
        await audio.play()
        return { ctx: ctx.state, duration: audio.duration, paused: audio.paused, src: audio.src.split("/").pop() }
      },
    }
    window.__fakeMic = fake
    return dest.stream
  }
})()`

class Cdp {
  constructor(url) { this.url = url; this.id = 1; this.pending = new Map() }
  open() {
    this.ws = new WebSocket(this.url)
    this.ws.onmessage = (event) => {
      const message = JSON.parse(event.data)
      const pending = this.pending.get(message.id)
      if (!pending) return
      this.pending.delete(message.id)
      if (message.error) pending.reject(new Error(message.error.message))
      else pending.resolve(message.result)
    }
    return new Promise((resolve, reject) => {
      this.ws.onopen = resolve
      this.ws.onerror = () => reject(new Error("connexion CDP impossible"))
    })
  }
  send(method, params = {}) {
    const id = this.id++
    this.ws.send(JSON.stringify({ id, method, params }))
    return new Promise((resolve, reject) => this.pending.set(id, { resolve, reject }))
  }
  async eval(expression, awaitPromise = false) {
    const result = await this.send("Runtime.evaluate", {
      expression,
      returnByValue: true,
      awaitPromise,
      userGesture: true,
    })
    if (result.exceptionDetails) {
      const detail = result.exceptionDetails.exception?.description ?? result.exceptionDetails.text
      throw new Error(String(detail).slice(0, 500))
    }
    return result.result?.value
  }
  close() {
    try { this.ws?.close() } catch {}
  }
}

async function reachable(url) {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(1500) })
    return response.ok
  } catch {
    return false
  }
}

async function ensureVite() {
  if (await reachable(VITE_URL)) return null
  const child = spawn(process.execPath, [path.join(ROOT, "scripts/dev-web.mjs")], {
    cwd: ROOT,
    stdio: "ignore",
    windowsHide: true,
  })
  for (let i = 0; i < 60; i++) {
    if (await reachable(VITE_URL)) return child.exitCode === null ? child : null
    if (child.exitCode !== null) break
    await sleep(500)
  }
  throw new Error("Vite n'a pas démarré sur 127.0.0.1:5173 (lance `npm run dev:web` et réessaie).")
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function synthesizeWav(file, text) {
  mkdirSync(path.dirname(file), { recursive: true })
  const script = [
    "$ErrorActionPreference='Stop'",
    "Add-Type -AssemblyName System.Speech",
    "$s = New-Object System.Speech.Synthesis.SpeechSynthesizer",
    "$v = $s.GetInstalledVoices() | Where-Object { $_.VoiceInfo.Culture.Name -eq 'fr-FR' } | Select-Object -First 1",
    "if (-not $v) { throw 'Aucune voix française SAPI installée (Hortense attendue).' }",
    "$s.SelectVoice($v.VoiceInfo.Name)",
    "$s.Rate = 0",
    `$s.SetOutputToWaveFile(${psQuote(file)})`,
    `$s.Speak(${psQuote(text)})`,
    "$s.Dispose()",
  ].join("; ")
  const result = spawnSync("powershell", ["-NoProfile", "-Command", script], {
    encoding: "utf8",
    windowsHide: true,
  })
  if (result.status !== 0) {
    throw new Error(`Synthèse SAPI impossible : ${(result.stderr || result.stdout || "").trim().slice(0, 300)}`)
  }
  if (!existsSync(file) || statSync(file).size < 10_000) {
    throw new Error(`Le WAV n'a pas été produit : ${path.basename(file)}`)
  }
}

async function waitForPage() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${CDP_PORT}/json/list`)).json()
      const page = list.find((target) => target.type === "page" && target.webSocketDebuggerUrl)
      if (page) return page
    } catch {}
    await sleep(500)
  }
  throw new Error("Aucune page CDP : l'app de debug n'a pas démarré.")
}

async function main() {
  if (!existsSync(EXE)) {
    throw new Error("Binaire de debug absent : lance `npm run tauri:check` (ou `cargo build --manifest-path src-tauri/Cargo.toml`) puis réessaie.")
  }
  synthesizeWav(ANSWER_WAV_PUBLIC, CONTENT_REQUEST)
  synthesizeWav(CONFIRM_WAV_PUBLIC, CONFIRM)
  viteChild = await ensureVite()
  log(`Vite : ${viteChild ? "démarré pour le test" : "réutilisé"}`)

  app = spawn(EXE, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: PROFILE,
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-port=${CDP_PORT}`,
    },
    stdio: "ignore",
    windowsHide: false,
  })

  const page = await waitForPage()
  cdp = new Cdp(page.webSocketDebuggerUrl)
  await cdp.open()
  invoke = (method, args = []) =>
    cdp.eval(`window.__TAURI_INTERNALS__.invoke("aven_call", ${JSON.stringify({ method, args })})`, true)
  state = () => cdp.eval("window.__avenVoice.state()", false)
  simulate = (text) =>
    withTimeout(cdp.eval(`window.__avenVoice.simulate(${JSON.stringify(text)})`, true), 25_000, `simulation « ${text} »`)

  // Le Poste peut mettre plusieurs secondes à démarrer le moteur.
  let ready = null
  for (let i = 0; i < 80; i++) {
    ready = await invoke("state").catch(() => null)
    if (ready?.status === "ready") break
    await sleep(500)
  }
  if (ready?.status !== "ready") throw new Error("Le Poste n'est pas prêt (moteur non démarré).")
  const prefs = await invoke("voiceAgentPrefs").catch(() => null)
  initialMuted = typeof prefs?.micMuted === "boolean" ? prefs.micMuted : null
  log(`micro initial : ${initialMuted === null ? "inconnu" : initialMuted ? "coupé" : "ouvert"}`)
  if (initialMuted !== false) await invoke("setVoiceAgentPrefs", [{ micMuted: false }])

  await cdp.send("Page.enable")
  await cdp.send("Page.addScriptToEvaluateOnNewDocument", { source: FAKE_MIC })
  await cdp.send("Page.reload")
  await sleep(1_500)

  // Attendre la nouvelle page, la préférence lue et la passerelle de test.
  for (let i = 0; i < 80; i++) {
    const r = await invoke("state").catch(() => null)
    if (r?.status === "ready") break
    await sleep(500)
  }
  for (let i = 0; i < 60; i++) {
    if (await cdp.eval(`typeof window.__avenVoice?.simulate === "function"`, false)) break
    await sleep(250)
  }
  if (!(await cdp.eval(`typeof window.__avenVoice?.simulate === "function"`, false))) {
    throw new Error("Passerelle `__avenVoice` absente : l'app doit être lancée en mode dev (Vite), pas sur le build de production.")
  }

  // Geste réel : les AudioContext créés sans interaction peuvent rester suspendus.
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
  })
  await cdp.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Shift", code: "ShiftLeft", windowsVirtualKeyCode: 16, nativeVirtualKeyCode: 16,
  })
  await sleep(500)

  if ((await state()).micMuted) {
    const clicked = await cdp.eval(
      `(() => { const b = document.querySelector('button[aria-label*="micro"]'); if (!b) return "absent"; b.click(); return b.getAttribute("aria-label"); })()`,
      false,
    )
    log(`ouverture du micro : ${clicked}`)
    await sleep(1_500)
  }
  for (let i = 0; i < 40; i++) {
    if (await cdp.eval(`typeof window.__fakeMic?.play === "function"`, false)) break
    await sleep(250)
  }
  if (!(await cdp.eval(`typeof window.__fakeMic?.play === "function"`, false))) {
    throw new Error("Micro simulé non branché : getUserMedia n'a pas été appelé (micro encore coupé ?).")
  }
  log(`voix prête : ${JSON.stringify(await state())}`)

  const before = await invoke("notesList")
  beforeIds = before.map((note) => note.id)
  const phases = []
  let played = false
  const poll = setInterval(async () => {
    try {
      const current = await state()
      const last = phases[phases.length - 1]
      if (!last || last.phase !== current.phase || last.heard !== current.heard || last.reply !== current.reply) {
        phases.push({ phase: current.phase, heard: current.heard, reply: current.reply })
        log(`  [${phases.length}] ${current.phase}${current.heard ? ` — entendu : « ${current.heard.slice(0, 90)} »` : ""}${current.reply ? ` — dit : « ${current.reply.slice(0, 90)} »` : ""}`)
      }
      if (!played && current.phase === "speaking" && String(current.reply ?? "").includes("Quel texte")) {
        played = true
        const result = await cdp.eval(`window.__fakeMic.play()`, true)
        log(`  → réponse simulée lancée pendant la question : ${JSON.stringify(result)}`)
      }
    } catch {}
  }, 60)

  log(`→ simulation de la demande : « ${REQUEST} »`)
  await simulate(REQUEST)

  let confirmation = ""
  let answerHeard = ""
  for (let i = 0; i < 250; i++) {
    const current = await state()
    if (String(current.reply ?? "").includes("Je note")) {
      confirmation = current.reply
      answerHeard = String(current.heard ?? "")
      break
    }
    await sleep(100)
  }
  clearInterval(poll)
  if (!confirmation) throw new Error("Aucune confirmation de note : la réponse n'a pas été transcrite ou traitée.")

  // La réponse doit être celle du micro, jamais la demande ni la question.
  assert.ok(answerHeard, "une transcription de la réponse est attendue")
  assert.match(answerHeard, /boucle/i, "la transcription doit contenir le mot « boucle »")
  assert.match(answerHeard, /note doit contenir/i, "la demande doit être transcrite avant d'être composée")
  assert.match(confirmation, /Je note/i, "la question de confirmation relit le contenu")
  assert.match(confirmation, /boucle/i, "la confirmation doit relire le contenu rédigé")
  assert.doesNotMatch(confirmation, /la note doit contenir/i, "la confirmation ne doit pas recopier la demande")
  assert.doesNotMatch(confirmation, /crée une note/i, "la demande ne doit pas devenir le contenu")
  assert.doesNotMatch(confirmation, /Quel texte dois-je noter/i, "la question ne doit pas devenir le contenu")
  const order = phases.map((entry) => entry.phase).filter((phase, index, all) => phase !== all[index - 1])
  const speakingAt = order.indexOf("speaking")
  const heardAt = order.indexOf("capturing")
  const transcribedAt = order.indexOf("transcribing")
  assert.ok(heardAt >= 0, "le micro simulé doit déclencher une capture")
  assert.ok(speakingAt >= 0 && heardAt > speakingAt, "la réponse doit commencer pendant la question")
  assert.ok(transcribedAt > heardAt, "la capture doit aller jusqu'à la transcription après la lecture")
  assert.ok(
    !order.slice(heardAt, transcribedAt).includes("listening"),
    "la fin de lecture ne doit pas refermer la capture (v11.15.2)",
  )

  log(`→ confirmation : « ${confirmation} »`)
  log(`→ réponse vocale au « oui » : « ${CONFIRM} »`)
  const confirmPlayed = await cdp.eval(`window.__fakeMic.play(${JSON.stringify(CONFIRM_WAV_URL)})`, true)
  log(`  → lecture du « oui » : ${JSON.stringify(confirmPlayed)}`)
  let after = null
  for (let i = 0; i < 120; i++) {
    after = await state()
    if (String(after.reply ?? "").includes("Note créée")) break
    await sleep(100)
  }
  assert.match(String(after?.reply ?? ""), /Note créée/i, "l'écriture doit être annoncée")
  const notes = await invoke("notesList")
  const created = notes.find((note) => !beforeIds.includes(note.id))
  if (!created) throw new Error("La note n'a pas été créée dans l'espace actif.")
  createdNote = { id: created.id, title: created.title, updated: created.updated, markdown: created.markdown }
  log(`note créée : ${created.title}`)
  log(`contenu : ${JSON.stringify(created.markdown)}`)

  // Le contrôle demandé : le texte écrit est la réponse, pas la demande.
  assert.match(created.markdown, /boucle/i, "le contenu de la note doit porter le résumé")
  assert.match(created.markdown, /python/i, "le contenu de la note doit porter le résumé")
  assert.ok(created.markdown.length > 200, "la note doit être un vrai résumé, pas une phrase recopiée")
  assert.doesNotMatch(created.markdown, /la note doit contenir/i, "la note ne doit pas recopier la demande")
  assert.doesNotMatch(created.markdown, /crée une note/i, "la note ne doit pas être un copié-collé de la demande")
  assert.doesNotMatch(created.markdown, /Quel texte dois-je noter/i, "la note ne doit pas être la question de l'agent")
  assert.notEqual(created.markdown.trim(), CONTENT_REQUEST, "la note ne doit pas être la demande seule")

  log("✓ note vocale de bout en bout : demande transcrite, contenu rédigé, confirmation relue, note correcte")
}

let app = null
let cdp = null
let viteChild = null
let invoke = null
let state = null
let simulate = null
let initialMuted = null
let beforeIds = null
let createdNote = null
let cleaned = false

async function purgeCreatedNote() {
  if (!cdp || !beforeIds) return
  const notes = await withTimeout(invoke("notesList"), 5_000, "notesList")
  const created = notes.find((note) => !beforeIds.includes(note.id))
  if (!created) return
  await withTimeout(invoke("noteDelete", [created.id]), 5_000, "noteDelete")
  const trash = await withTimeout(invoke("noteTrash"), 5_000, "noteTrash")
  const entry = trash.find((note) => note.title === created.title && note.updated >= created.updated - 2_000)
  if (!entry) {
    warn(`⚠ note de test restée dans la corbeille : ${created.id}`)
    return
  }
  await withTimeout(invoke("notePurge", [entry.id]), 5_000, "notePurge")
  log(`note de test purgée : ${created.id}`)
}

function restorePrefsFile() {
  if (typeof initialMuted !== "boolean") return
  const file = path.join(process.env.APPDATA ?? "", "Aven", "prefs.json")
  try {
    const prefs = JSON.parse(readFileSync(file, "utf8"))
    if (prefs.micMuted === initialMuted) return
    prefs.micMuted = initialMuted
    const temp = `${file}.tmp`
    writeFileSync(temp, `${JSON.stringify(prefs, null, 2)}\n`, "utf8")
    renameSync(temp, file)
  } catch {}
}

async function cleanup() {
  if (cleaned) return
  cleaned = true
  try { await purgeCreatedNote() } catch (error) { warn(`⚠ nettoyage de la note : ${error?.message ?? error}`) }
  if (cdp) {
    try {
      if (typeof initialMuted === "boolean") {
        await withTimeout(invoke("setVoiceAgentPrefs", [{ micMuted: initialMuted }]), 4_000, "restauration de la préférence micro")
      }
    } catch {}
  }
  cdp?.close()
  if (app && app.exitCode === null && app.pid) {
    spawnSync(`taskkill /PID ${app.pid} /T /F`, { shell: true, windowsHide: true })
  }
  await sleep(500)
  restorePrefsFile()
  if (viteChild && viteChild.exitCode === null && viteChild.pid) {
    spawnSync(`taskkill /PID ${viteChild.pid} /T /F`, { shell: true, windowsHide: true })
  }
  try { unlinkSync(ANSWER_WAV_PUBLIC) } catch {}
  try { unlinkSync(CONFIRM_WAV_PUBLIC) } catch {}
  try { rmSync(PROFILE, { recursive: true, force: true }) } catch {}
}

try {
  await main()
} catch (error) {
  console.error(`✗ ${error?.message ?? error}`)
  process.exitCode = 1
} finally {
  await cleanup()
}
