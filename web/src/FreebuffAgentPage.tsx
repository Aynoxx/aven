import { useEffect, useRef, useState } from "react"
import { api } from "./api"
import { ptyDims } from "./pty-dims"
// v9.6.0 : filtrage du transcript centralisé (bordures, session, pubs, utilisateur).
import { buildTranscript, isUserLine } from "./freebuff-transcript"
import { Icon } from "./icons"
import InstrumentFrame, { type InstrumentAction } from "./InstrumentFrame"

// Page pleine de l'agent Freebuff (v9.5.0), RÉELLEMENT interactive depuis la v10.3.0.
//
// Cause racine du « terminal miroir » : l'instance xterm.js n'avait AUCUN pont
// clavier → PTY. Seul le composeur du bas écrivait dans le process (`text + \r`,
// une ligne à la fois) : impossible d'exprimer les flèches, Tab, Échap ou Ctrl+C,
// et la souris n'atteignait jamais le TUI. Le composeur, les prompts rapides et
// l'installation locale du CLI sont donc supprimés : l'émulateur reçoit chaque
// frappe via `term.onData`, relaie chaque redimensionnement via `term.onResize`,
// et capture la souris pour les modes de rapport du TUI (xterm encode les
// séquences attendues). Le transcript reste disponible en LECTURE seule.

// Thème de l'émulateur (contraste pour le TUI comme pour le parsing du transcript).
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

// Type minimal de l'émulateur : seules les méthodes utilisées ici (le module xterm
// est chargé dynamiquement, il ne pèse donc pas au démarrage de l'app).
type XtermLike = {
  write: (data: string) => void
  focus: () => void
  dispose: () => void
  onData: (cb: (data: string) => void) => { dispose: () => void }
  onResize: (cb: (size: { cols: number; rows: number }) => void) => { dispose: () => void }
  cols: number
  rows: number
  buffer: { active: { length: number; getLine: (i: number) => { translateToString: (trim?: boolean) => string } | null } }
}

function presenceOf(state: "starting" | "running" | "restarting"): { label: string; online: boolean } {
  if (state === "starting") return { label: "Freebuff démarre…", online: false }
  if (state === "restarting") return { label: "Nouvelle tentative…", online: false }
  return { label: "En ligne", online: true }
}

// v10.4.0 : la page déclare son propre retour (« Fermer ») — la barre de fenêtre ne
// duplique plus la sortie avec un second bouton qui ramenait au même endroit.
export default function FreebuffAgentPage(props: { onError: (e: unknown) => void; onClose: () => void }) {
  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XtermLike | null>(null)
  const fitRef = useRef<{ fit: () => void; dispose: () => void } | null>(null)
  const chatRef = useRef<HTMLDivElement>(null)
  const [presence, setPresence] = useState<{ label: string; online: boolean }>({ label: "Freebuff démarre…", online: false })
  const [isError, setIsError] = useState(false)
  const [errorMsg, setErrorMsg] = useState("")
  // v9.6.2 : bannière « l'app Desktop Freebuff tient la session » — avertit AVANT d'écrire.
  const [desktopConflict, setDesktopConflict] = useState(false)
  const desktopCheckBusy = useRef(false)
  // v10.3.0 : état du CLI fourni par le gestionnaire unique (plus d'installation ici).
  const [cliReady, setCliReady] = useState<boolean | null>(null)
  const [cliBusy, setCliBusy] = useState(false)
  const [cliError, setCliError] = useState("")
  const [chatLines, setChatLines] = useState<string[]>([])
  const [userLines, setUserLines] = useState<boolean[]>([])
  const [sessionBar, setSessionBar] = useState("")
  // v10.3.0 : le terminal est la vue PAR DÉFAUT. Le transcript devient une lecture
  // optionnelle — il ne prend plus la place de la surface interactive.
  const [showTranscript, setShowTranscript] = useState(false)
  const [resume, setResume] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const renderTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showTranscriptRef = useRef(false)
  showTranscriptRef.current = showTranscript

  // Transcript « conversation » : dérivé du buffer xterm (source unique de vérité),
  // coalescé pour ne pas rescanner à chaque octet.
  const scheduleRender = () => {
    if (renderTimer.current) return
    renderTimer.current = setTimeout(() => {
      const term = termRef.current
      if (!term) return
      // Transcript suspendu quand il n'est pas affiché (le terminal montre déjà tout).
      if (!showTranscriptRef.current) return
      const buf = term.buffer.active
      const raw: string[] = []
      // Plafond de RENDU : 120 lignes suffisent pour une conversation (le buffer
      // xterm garde tout, la vue terminal est intacte).
      const max = 120
      for (let i = Math.max(0, buf.length - max); i < buf.length; i++) {
        const line = buf.getLine(i)
        if (!line) continue
        raw.push(line.translateToString(true))
      }
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
    let cleanupObservers: (() => void) | undefined

    const boot = async () => {
      try {
        // v10.3.0 : le CLI est vérifié/installé au démarrage de l'app ; ici on ne fait
        // que lire l'état partagé (aucune installation concurrente depuis cette page).
        const cli = await api.freebuffCliEnsure().catch(() => null)
        if (disposed) return
        if (cli && !cli.installed) {
          setCliReady(false)
          setCliError(cli.error ?? "")
          setPresence({ label: "CLI Freebuff non installé", online: false })
          return
        }
        setCliReady(true)
        setCliError("")

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
          // Le TUI Freebuff est une application plein écran : on lui laisse la main
          // sur les fins de ligne et les rapports de souris (défaut xterm).
          allowTransparency: false,
        })
        const fit = new FitAddon()
        term.loadAddon(fit)
        term.open(termHostRef.current)
        fit.fit()
        termRef.current = term as unknown as XtermLike
        fitRef.current = fit

        // v10.3.0 — LE PONT QUI MANQUAIT : chaque frappe/clic (le TUI active le
        // rapport de souris) part vers le PTY. Sans cette ligne, xterm affichait la
        // sortie mais jetait silencieusement toutes les entrées.
        const dataSub = term.onData((data) => {
          void api.freebuffPtyInput(data)
        })
        // Un redimensionnement de l'émulateur (fenêtre, page, bascule de vue) doit
        // atteindre le process : ConPTY redessine le TUI à la bonne taille.
        const resizeSub = term.onResize(({ cols, rows }) => {
          void api.freebuffPtyResize(cols, rows)
        })

        const refit = () => {
          // Le terminal est monté même en vue conversation (dimensions fiables) :
          // fit() fonctionne dans les deux cas, il ne redimensionne rien à zéro.
          try { fit.fit() } catch { /* conteneur masqué : dimension conservée */ }
        }
        // Le conteneur peut changer de taille SANS redimensionnement de fenêtre
        // (fermeture de la barre latérale, retour d'une autre page) : ResizeObserver.
        const observer = new ResizeObserver(refit)
        observer.observe(termHostRef.current)
        window.addEventListener("resize", refit)
        cleanupResize = () => window.removeEventListener("resize", refit)
        cleanupObservers = () => { observer.disconnect(); dataSub.dispose(); resizeSub.dispose() }

        // Événements du PTY (même canal que le reste de l'app).
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
              const p = presenceOf((ev.data as { state: "starting" | "running" | "restarting" }).state)
              setPresence(p)
              if (ev.data.state === "running") setIsError(false)
              break
            }
            case "freebuff.pty.error":
              setErrorMsg(String(ev.data.message ?? ""))
              setIsError(true)
              break
            case "freebuff.pty.exit":
              // Un exit silencieux juste après une saisie = conflit de session (l'app
              // Desktop tient le compte) : on vérifie et on nomme la cause.
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

        // Démarre (ou récupère) la session avec les dimensions réelles de l'émulateur.
        const dims = ptyDims(term)
        await api.freebuffCliLaunch("launch", dims.cols, dims.rows)
        if (disposed) return
        // Focus immédiat : sans lui, le premier clic devait « réveiller » le terminal
        // et l'utilisateur croyait le TUI mort.
        requestAnimationFrame(() => { if (!disposed) term.focus() })
        void api.freebuffDesktopRunning().then((running) => { if (!disposed) setDesktopConflict(running) }).catch(() => undefined)
      } catch (e) {
        if (disposed) return
        // Un refus au lancement (app Desktop ouverte, CLI absent) est un conflit de
        // session, pas un crash — bannière actionnable au lieu de l'erreur brute.
        const raw = e instanceof Error ? e.message : String(e)
        const msg = raw.replace(/^Error invoking remote method '[^']+':\s*(?:Error:\s*)?/, "")
        if (/app Freebuff Desktop est ouverte/i.test(msg)) {
          setDesktopConflict(true)
          setIsError(false)
          setErrorMsg("")
          setPresence({ label: "Session refusée — voir la bannière", online: false })
        } else {
          setErrorMsg(msg)
          setIsError(true)
        }
      }
    }
    void boot()

    return () => {
      disposed = true
      if (renderTimer.current) { clearTimeout(renderTimer.current); renderTimer.current = null }
      cleanupResize?.()
      cleanupObservers?.()
      // Session persistante : on quitte la PAGE, pas le process (contrat du protocole).
      fitRef.current?.dispose()
      fitRef.current = null
      termRef.current?.dispose()
      termRef.current = null
    }
  }, [attempt])

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

  // v10.3.0 : installation via le gestionnaire UNIQUE (idempotent, vérifié). Le
  // bouton force une nouvelle tentative après l'échec ; sinon le cooldown s'applique.
  const ensureCli = async () => {
    setCliBusy(true)
    setCliError("")
    try {
      const status = await api.freebuffCliEnsure(true)
      setCliReady(status.installed)
      if (!status.installed) setCliError(status.error ?? "Le CLI Freebuff reste indisponible.")
      else setAttempt((n) => n + 1) // relance le boot (terminal + session)
    } catch (e) {
      props.onError(e)
    } finally {
      setCliBusy(false)
    }
  }

  const toggleView = () => {
    const next = !showTranscript
    setShowTranscript(next)
    // Retour au terminal : refit + focus, sinon le TUI garde des dimensions périmées.
    if (!next) setTimeout(() => {
      fitRef.current?.fit()
      const term = termRef.current
      if (term) { const d = ptyDims(term); void api.freebuffPtyResize(d.cols, d.rows); term.focus() }
    }, 80)
  }

  const actions: InstrumentAction[] = [
    {
      key: "restart",
      label: "Redémarrer la session",
      icon: "restore",
      onClick: restartSession,
      title: "Redémarre l'agent (utile s'il se bloque sans crasher)",
    },
    {
      key: "view",
      label: showTranscript ? "Vue terminal" : "Vue conversation",
      icon: "terminal",
      onClick: toggleView,
      title: showTranscript ? "Revenir au terminal interactif" : "Lire la conversation (lecture seule)",
      pressed: showTranscript,
    },
  ]

  return (
    <InstrumentFrame
      eyebrow="TERMINAL IA"
      title="Terminal Freebuff"
      description="Session CLI Freebuff indépendante de la conversation Aven. Le terminal est interactif : Entrée, flèches, Tab, Ctrl+C et la souris agissent directement dans Freebuff. Quitter cette page n’arrête pas la session."
      actions={actions}
      className="agents-main"
      bodyClassName="agents-page freebuff-agent-page freebuff-stage"
    >
      <div className="row bridge-status-row">
        <span className="agent-presence" role="status">
          <span className={`agent-presence-dot ${presence.online ? "online" : ""}`} aria-hidden="true" />
          {presence.label}
        </span>
        {/* L'interruption vit à côté de la présence : c'est un geste lié à la session
            en cours (Ctrl+C envoyé au PTY), pas une action de page permanente. */}
        <button className="button secondary" type="button" onClick={sendInterrupt} title="Interrompt le tour en cours (Ctrl+C envoyé à l'agent)" disabled={!presence.online}>
          {/* v11.0.2 : un carré d'arrêt pour interrompre ; le X reste réservé à la fermeture. */}
          <Icon name="stop" size={14} />Interrompre
        </button>
      </div>

      {cliReady === false && (
        <div className="freebuff-conflict" role="alert">
          <div className="freebuff-conflict-text">
            <strong>Le CLI Freebuff n'est pas installé sur cet ordinateur.</strong>
            <span>Le terminal intégré en a besoin. Aven tente l'installation au démarrage ; si elle a échoué (réseau, droits npm), relance-la ici : la session démarre dès que le binaire répond.</span>
            {cliError && <span className="hint">{cliError}</span>}
          </div>
          <button className="button primary" type="button" disabled={cliBusy} onClick={() => void ensureCli()}>
            <Icon name="inbox" size={14} />{cliBusy ? "Installation en cours…" : "Installer le CLI (npm)"}
          </button>
        </div>
      )}

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

      {/* Le terminal occupe le corps de page ; la vue conversation est une lecture
          optionnelle qui ne remplace jamais la surface interactive (elle la masque). */}
      <div className="agent-stage freebuff-stage-inner">
        <div
          className={`bridge-term-host freebuff-term${showTranscript ? " agent-term-hidden" : ""}`}
          ref={termHostRef}
          role="group"
          aria-label="Terminal Freebuff interactif"
          onClick={() => termRef.current?.focus()}
        />
        {showTranscript && (
          <div className="agent-chat" ref={chatRef} aria-label="Conversation avec l'agent Freebuff (lecture seule)">
            {chatLines.length === 0 && <p className="hint agent-chat-empty">Le terminal est vide pour l'instant.</p>}
            {chatLines.map((line, i) => (
              <p key={i} className={`agent-line${(userLines[i] ?? false) || isUserLine(line) ? " agent-line-user" : ""}`}>{line}</p>
            ))}
          </div>
        )}
      </div>

      {showTranscript ? (
        <p className="hint freebuff-hint">Lecture seule — « Vue terminal » pour écrire, naviguer dans les menus et utiliser les raccourcis.</p>
      ) : (
        <label className="agent-resume">
          <input type="checkbox" checked={resume} onChange={(e) => toggleResume(e.target.checked)} />
          Reprendre la dernière conversation à l'ouverture (sinon, nouvelle conversation)
        </label>
      )}
    </InstrumentFrame>
  )
}
