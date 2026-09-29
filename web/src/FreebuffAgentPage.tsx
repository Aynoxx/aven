import { useEffect, useRef, useState } from "react"
import { api } from "./api"
import { ptyDims } from "./pty-dims"
// v9.6.0 : filtrage du transcript centralisé (bordures, session, pubs, utilisateur).
import { buildTranscript, isUserLine } from "./freebuff-transcript"
import { Icon } from "./icons"

// Page pleine de l'agent Freebuff (v9.5.0) : naviguée comme la page Agents (une seule
// vue à la fois, bouton « Accueil »), elle REMPLACE le dialogue v9.2.0 qui recouvrait
// l'écran courant. Le TUI freebuff reste le TRANSPORT (process PTY côté main, émulateur
// xterm.js hors écran pour parser l'ANSI) : l'écran montre une CONVERSATION D'AGENT —
// présence (« En ligne »), transcript dérivé du buffer (spinners et bordures filtrés),
// prompts rapides, composeur avec Entrée pour envoyer. Le terminal brut reste accessible
// d'un clic (« Vue terminal »). Fermer/quitter la page n'arrête pas freebuff : à la
// réouverture, l'écran est reconstruit depuis le scrollback (session persistante).

// Thème de l'émulateur caché (contraste pour le parsing, jamais montré par défaut).
const XTERM_THEME = {
  background: "#12151d",
  foreground: "#f4f5f8",
  cursor: "#8b5cf6",
  selectionBackground: "rgba(139, 92, 246, .30)",
}

type PtyEvent =
  | { type: "freebuff.pty.replay"; data: { buffer: string } }
  | { type: "freebuff.pty.data"; data: { chunk: string } }
  | { type: "freebuff.pty.status"; data: { state: "starting" | "running" | "restarting" } }
  | { type: "freebuff.pty.exit"; data: { code: number; signal?: number } }
  | { type: "freebuff.pty.error"; data: { message: string } }

function presenceOf(data: { state: "starting" | "running" | "restarting" }): { label: string; online: boolean } {
  if (data.state === "starting") return { label: "Freebuff démarre…", online: false }
  if (data.state === "restarting") return { label: "Nouvelle tentative…", online: false }
  return { label: "En ligne", online: true }
}

// Lignes qui ne sont pas du discours : spinners braille, bordures de boîtes,
// barres de progression, pubs et barres d'état — tout vit dans freebuff-transcript.ts (v9.6.0).
export default function FreebuffAgentPage(props: { onHome: () => void; onError: (e: unknown) => void }) {
  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ write: (s: string) => void; focus: () => void; dispose: () => void; buffer: { active: { length: number; getLine: (i: number) => { translateToString: (trim?: boolean) => string } | null } } } | null>(null)
  const fitRef = useRef<{ fit: () => void; dispose: () => void } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const [presence, setPresence] = useState<{ label: string; online: boolean }>({ label: "Freebuff démarre…", online: false })
  const [isError, setIsError] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  // v9.6.2 : bannière « l'app Desktop Freebuff tient la session » — avertit AVANT d'écrire
  // (le CLI ne peut pas répondre ; l'envoi gelait muet). Relançable d'un clic.
  const [desktopConflict, setDesktopConflict] = useState(false)
  const desktopCheckBusy = useRef(false)
  const [chatLines, setChatLines] = useState<string[]>([])
  const [userLines, setUserLines] = useState<boolean[]>([])
  const [sessionBar, setSessionBar] = useState("")
  const [showRaw, setShowRaw] = useState(false)
  const [resume, setResume] = useState(false)
  const [draft, setDraft] = useState("")
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  // v9.6.1 : miroir de showRaw pour le callback — en Vue terminal, le scan du buffer
  // (transcript) est inutile : l'écran montre déjà le TUI brut.
  const showRawRef = useRef(false)
  showRawRef.current = showRaw

  // Transcript « conversation » : dérivé du buffer xterm (source unique de vérité),
  // coalescé pour ne pas rescanner à chaque octet.
  const scheduleRender = () => {
    if (renderTimer.current) return
    renderTimer.current = setTimeout(() => {
      const term = termRef.current
      if (!term) return
      // v9.6.1 : Vue terminal = transcript suspendu (l'écran montre déjà le TUI brut).
      if (showRawRef.current) return
      const buf = term.buffer.active
      const raw: string[] = []
      // v9.6.1 : plafond de RENDU (et plus seulement de scan) — 400 lignes re-diffées
      // à chaque frame de streaming figeaient l'interface ; 120 suffisent largement
      // pour une conversation (le buffer xterm garde TOUT, la Vue terminal est intacte).
      const max = 120
      for (let i = Math.max(0, buf.length - max); i < buf.length; i++) {
        const line = buf.getLine(i)
        if (!line) continue
        raw.push(line.translateToString(true))
      }
      // v9.6.0 : bordures rognées, barre de session extraite (quota Freebucks),
      // pubs et barres d'état filtrées, lignes utilisateur marquées.
      const { lines: parsed, sessionBar: bar } = buildTranscript(raw)
      setChatLines(parsed.map((l) => l.text))
      setUserLines(parsed.map((l) => l.user))
      setSessionBar(bar)
      requestAnimationFrame(() => {
        const el = chatRef.current
        if (el) el.scrollTop = el.scrollHeight
      })
    }, 140)
  }

  useEffect(() => {
    let disposed = false
    let cleanupResize: (() => void) | undefined

    const boot = async () => {
      try {
        // Préférence de reprise (v9.5.0) : « Reprendre la dernière conversation ».
        api.prefs().then((p) => { if (!disposed) setResume(p.freebuffResume === true) }).catch(() => undefined)
        // Imports dynamiques : xterm ne pèse dans le bundle qu'à l'ouverture de la page.
        const [{ Terminal }, { FitAddon }] = await Promise.all([import("@xterm/xterm"), import("@xterm/addon-fit")])
        if (disposed || !termHostRef.current) return
        const term = new Terminal({
          fontFamily: "Consolas, 'Cascadia Mono', 'Courier New', monospace",
          fontSize: 13,
          theme: XTERM_THEME,
          cursorBlink: true,
          scrollback: 5000,
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(termHostRef.current)
        fit.fit()
        termRef.current = term as unknown as typeof termRef.current
        fitRef.current = fit

        const onResize = () => {
          fit.fit()
          const d = ptyDims(term)
          void api.freebuffPtyResize(d.cols, d.rows)
        }
        window.addEventListener("resize", onResize)
        cleanupResize = () => window.removeEventListener("resize", onResize)

        // Événements du PTY (via le canal opencode:event existant, comme router.notice).
        const off = api.onEvent((raw: { type: string; data: Record<string, unknown> }) => {
          const ev = raw as PtyEvent
          if (disposed) return
          switch (ev.type) {
            case "freebuff.pty.replay":
              term.write(String(ev.data.buffer ?? ""))
              scheduleRender()
              break
            case "freebuff.pty.data":
              term.write(String(ev.data.chunk ?? ""))
              scheduleRender()
              break
            case "freebuff.pty.status": {
              const p = presenceOf(ev.data as { state: "starting" | "running" | "restarting" })
              setPresence(p)
              if (ev.data.state === "running") setIsError(false)
              break
            }
            case "freebuff.pty.error":
              setErrorMsg(String(ev.data.message ?? ""))
              setIsError(true)
              break
            case "freebuff.pty.exit":
              // v9.6.2 : un exit silencieux (code 0) juste après une saisie est le symptôme
              // du conflit de session (l'app Desktop tient le compte). On vérifie et on
              // nomme la cause au lieu d'afficher un générique « relancez » qui n'explique rien.
              void api.freebuffDesktopRunning().then((running) => {
                if (running && !disposed) {
                  setDesktopConflict(true)
                  setErrorMsg("")
                  setIsError(false)
                } else if (!disposed) {
                  setErrorMsg(`Freebuff s'est terminé (code ${ev.data.code}). Utilise « Redémarrer la session ».`)
                  setIsError(true)
                }
              }).catch(() => {
                if (!disposed) { setErrorMsg(`Freebuff s'est terminé (code ${ev.data.code}). Utilise « Redémarrer la session ».`); setIsError(true) }
              })
              break
          }
        })
        if (disposed) { off(); return }

        // Démarre (ou récupère) la session : le lancement transmet les dimensions
        // réelles de l'émulateur (v9.4.0) et les options du pont agents (v9.5.0).
        const dims = ptyDims(term)
        await api.freebuffCliLaunch("launch", dims.cols, dims.rows)
        // v9.6.2 : après le lancement (ou la reprise), on vérifie l'app Desktop — la
        // bannière prévient AVANT le premier message (le gel muet n'a plus lieu d'être).
        void api.freebuffDesktopRunning().then((running) => { if (!disposed) setDesktopConflict(running) }).catch(() => undefined)
      } catch (e) {
        if (!disposed) {
          setErrorMsg(e instanceof Error ? e.message : String(e))
          setIsError(true)
        }
      }
    }
    void boot()

    return () => {
      disposed = true
      if (renderTimer.current) { clearTimeout(renderTimer.current); renderTimer.current = null }
      cleanupResize?.()
      // Session persistante : on quitte la PAGE, pas le process (contrat du protocole).
      fitRef.current?.dispose()
      fitRef.current = null
      termRef.current?.dispose()
      termRef.current = null
    }
  }, [])

  const send = () => {
    const text = draft.trim()
    if (!text) return
    // Le TUI consomme une ligne à la fois : Entrée = \r (le composeur local garde \n).
    void api.freebuffPtyInput(text.replace(/\n/g, "\r") + "\r")
    setDraft("")
    if (showRaw) termRef.current?.focus()
  }

  const restartSession = () => {
    setIsError(false)
    setErrorMsg("")
    termRef.current?.write("\x1b[2J\x1b[H") // efface l'écran local (le scrollback main repart)
    void api.freebuffPtyRestart().catch((e) => props.onError(e))
  }

  const sendInterrupt = () => {
    void api.freebuffPtySignal("SIGINT").catch((e) => props.onError(e))
  }

  const toggleResume = (on: boolean) => {
    setResume(on)
    void api.setFreebuffResume(on).catch(() => setResume(!on))
  }

  return (
    <main className="agents-main">
      <section className="agents-page freebuff-agent-page" aria-label="Agent Freebuff">
        <header className="agents-page-header">
          <div>
            <span className="eyebrow">ASSISTANT EXTERNE GRATUIT</span>
            <h1>Freebuff</h1>
            <p>
              Le même espace de travail que tes agents Aven, en sessions quotidiennes
              gratuites. Quitter cette page n'arrête pas l'agent : tu retrouves la
              conversation à la réouverture.
            </p>
          </div>
          <button className="button ghost" onClick={props.onHome} type="button">
            <Icon name="arrow-left" size={15} />Accueil
          </button>
        </header>

        <div className="row bridge-status-row">
          <span className="agent-presence" role="status">
            <span className={`agent-presence-dot ${presence.online ? "online" : ""}`} aria-hidden="true" />
            {presence.label}
          </span>
          <span className="row bridge-actions">
            <button className="button secondary" type="button" onClick={sendInterrupt} title="Interrompt le tour en cours (Ctrl+C envoyé à l'agent)">
              <Icon name="close" size={14} />Interrompre
            </button>
            <button className="button secondary" type="button" onClick={restartSession} title="Redémarre l'agent (utile s'il se bloque sans crasher)">
              <Icon name="restore" size={14} />Redémarrer la session
            </button>
            <button className="button secondary" type="button" onClick={() => {
              const next = !showRaw
              setShowRaw(next)
              // En sortant de la vue cachée, l'émulateur reprend ses vraies dimensions :
              // refit + resize du PTY pour que le TUI se redessine à la bonne taille.
              setTimeout(() => {
                fitRef.current?.fit()
                const term = termRef.current
                if (term) { const d = ptyDims(term as unknown as { cols: number; rows: number }); void api.freebuffPtyResize(d.cols, d.rows) }
                if (next) termRef.current?.focus()
              }, 80)
            }} aria-pressed={showRaw} title="Affiche le terminal brut (pour suivre ce que l'agent voit exactement)">
              <Icon name="terminal" size={14} />{showRaw ? "Vue conversation" : "Vue terminal"}
            </button>
          </span>
        </div>

        {/* v9.6.2 : bannière de conflit de session — l'app Desktop Freebuff tient le compte,
            le terminal intégré ne peut pas répondre. Message + action, jamais de gel muet. */}
        {desktopConflict && (
          <div className="freebuff-conflict" role="alert">
            <div className="freebuff-conflict-text">
              <strong>Ta session Freebuff est déjà ouverte dans l'app Freebuff Desktop.</strong>
              <span>Une seule session par compte : le terminal intégré ne peut pas répondre tant que l'app tourne. Ferme-la, puis relance ici — ou continue ta conversation là-bas.</span>
            </div>
            <button
              className="button secondary"
              type="button"
              disabled={desktopCheckBusy.current}
              onClick={() => {
                desktopCheckBusy.current = true
                void api.freebuffDesktopRunning().then((running) => {
                  setDesktopConflict(running)
                  if (!running) { setIsError(false); setErrorMsg(""); void api.freebuffCliLaunch("launch").catch(() => undefined) }
                }).catch(() => undefined).finally(() => { desktopCheckBusy.current = false })
              }}
            >
              <Icon name="restore" size={14} />J'ai fermé l'app — Relancer
            </button>
          </div>
        )}

        {sessionBar && (
          <div className="freebuff-sessionbar" role="status" aria-label="Session Freebuff">
            {sessionBar.split(/[│|]/).map((part) => part.trim()).filter(Boolean).map((part, i) => (
            <span key={i} className="freebuff-sessionbar-item">{part}</span>
            ))}
          </div>
        )}

        {isError && <p className="err" role="alert">{errorMsg}</p>}

        {/* Vue conversation : transcript dérivé du buffer, sans spinner ni bordures.
            L'émulateur reste monté (métriques fiables) mais invisible par défaut. */}
        <div className="agent-stage">
        {/* v9.6.1 : plus d'aria-live sur le transcript — chaque frame de streaming
            déclenchait un recalcul complet de l'arbre d'accessibilité (gel ressenti).
            Le composeur reste focalisable, le scroll suit le bas comme avant. */}
        {!showRaw && (
          <div className="agent-chat" ref={chatRef} aria-label="Conversation avec l'agent Freebuff">
            {chatLines.length === 0 && (
              <p className="hint agent-chat-empty">
                {presence.online ? "Dis bonjour à Freebuff, ou choisis un prompt rapide ci-dessous." : "L'agent démarre…"}
              </p>
            )}
            {chatLines.map((line, i) => (
              <p key={i} className={`agent-line${(userLines[i] ?? false) || isUserLine(line) ? " agent-line-user" : ""}`}>{line}</p>
            ))}
          </div>
        )}
        <div className={`bridge-term-host${showRaw ? "" : " agent-term-hidden"}`} ref={termHostRef} />
        </div>

        {/* Prompts rapides : remplissent le composeur (l'utilisateur garde la main). */}
        {!showRaw && (
          <div className="agent-quick" role="group" aria-label="Prompts rapides">
            {["Que peux-tu faire dans cet espace ?", "Résume l'état du projet", "Que vois-tu dans les fichiers ?"].map((q) => (
              <button key={q} className="agent-quick-chip" type="button" onClick={() => setDraft(q)}>{q}</button>
            ))}
          </div>
        )}

        <div className="agent-composer">
          <textarea
            className="agent-composer-input"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send() } }}
            placeholder={presence.online ? "Écris à Freebuff… (Entrée pour envoyer, Maj+Entrée pour un retour à la ligne)" : "Attends que l'agent soit en ligne…"}
            aria-label="Message pour l'agent Freebuff"
            rows={2}
          />
          <button className="button primary agent-composer-send" onClick={send} disabled={!draft.trim() || !presence.online} type="button" aria-label="Envoyer le message">
            <Icon name="chevron-right" size={16} />Envoyer
          </button>
        </div>
        <label className="agent-resume">
          <input type="checkbox" checked={resume} onChange={(e) => toggleResume(e.target.checked)} />
          Reprendre la dernière conversation à l'ouverture (sinon, nouvelle conversation)
        </label>
      </section>
    </main>
  )
}
