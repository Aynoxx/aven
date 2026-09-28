import { useEffect, useRef, useState } from "react"
import { api } from "./api"
import { Icon } from "./icons"

// Terminal Freebuff intégré (v9.2.0, protocole freebuff-pty) : le TUI freebuff
// s'affiche dans un vrai émulateur (xterm.js). Le process tourne côté MAIN dans un
// PTY (conhost caché — node-pty exige un compilateur MSVC absent de ce poste) :
// fermer ce dialogue ne le tue pas, à la réouverture le scrollback est rejoué
// (session persistante). Pas de WebSocket : le flux transite par IPC et les
// événements freebuff.pty.* arrivent via onEvent (comme router.notice).

// Thème du terminal dérivé des tokens de l'app (RULES.md §3) : lisibilité dans les
// thèmes clair ET sombre, sans nouvelle couleur en dur hors palette de l'émulateur.
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

function statusText(ev: Extract<PtyEvent, { type: "freebuff.pty.status" }>["data"]): string {
  if (ev.state === "starting") return "Démarrage de freebuff…"
  if (ev.state === "restarting") return "Échec au démarrage, nouvelle tentative…"
  return "Connecté au CLI Freebuff."
}

export default function FreebuffTerminalDialog(props: { onClose: () => void; onError: (e: unknown) => void }) {
  const termHostRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<{ write: (s: string) => void; focus: () => void; dispose: () => void } | null>(null)
  const fitRef = useRef<{ fit: () => void; dispose: () => void } | null>(null)
  const [status, setStatus] = useState("Démarrage…")
  const [isError, setIsError] = useState(false)

  useEffect(() => {
    let disposed = false
    let cleanupResize: (() => void) | undefined

    const boot = async () => {
      try {
        // Imports dynamiques : xterm ne pèse dans le bundle qu'à l'ouverture du terminal.
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
        termRef.current = term
        fitRef.current = fit
        term.focus()

        // Saisie → PTY (freebuff:pty:input). Le resize reste protocolaire (ConPTY
        // Windows ignore le resize distant ; le TUI recalcule à son rythme).
        term.onData((data) => { void api.freebuffPtyInput(data) })

        const onResize = () => {
          fit.fit()
          void api.freebuffPtyResize(term.cols, term.rows)
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
              break
            case "freebuff.pty.data":
              term.write(String(ev.data.chunk ?? ""))
              break
            case "freebuff.pty.status":
              setIsError(false)
              setStatus(statusText(ev.data as never))
              break
            case "freebuff.pty.error":
              setStatus(String(ev.data.message ?? ""))
              setIsError(true)
              break
            case "freebuff.pty.exit":
              setStatus(`freebuff s'est terminé (code ${ev.data.code}). Utilise « Redémarrer la session ».`)
              setIsError(true)
              break
          }
        })
        if (disposed) { off(); return }

        // Démarre (ou récupère) la session : freebuff:launch action "launch" appelle
        // startFreebuffPty côté main ; le replay éventuel arrive via l'événement ci-dessus.
        await api.freebuffCliLaunch("launch", term.cols, term.rows)
      } catch (e) {
        if (!disposed) {
          setStatus(e instanceof Error ? e.message : String(e))
          setIsError(true)
        }
      }
    }
    void boot()

    return () => {
      disposed = true
      cleanupResize?.()
      // Session persistante : on ferme la VUE, pas le process (contrat du protocole).
      fitRef.current?.dispose()
      fitRef.current = null
      termRef.current?.dispose()
      termRef.current = null
    }
  }, [])

  const restartSession = () => {
    setIsError(false)
    setStatus("Redémarrage de la session…")
    termRef.current?.write("\x1b[2J\x1b[H") // efface l'écran local (le scrollback main repart)
    void api.freebuffPtyRestart().catch((e) => props.onError(e))
  }

  const sendInterrupt = () => {
    void api.freebuffPtySignal("SIGINT").catch((e) => props.onError(e))
  }

  return (
    <div className="overlay" role="dialog" aria-modal="true" aria-label="Terminal Freebuff" onClick={(e) => { if (e.target === e.currentTarget) props.onClose() }}>
      <div className="dialog wide bridge-dialog">
        <header className="unified-settings-header">
          <div>
            <span className="eyebrow">FREEBUFF</span>
            <h3>Terminal Freebuff intégré</h3>
            <p className="hint">
              Session persistante : fermer cette fenêtre n'arrête pas freebuff, tu retrouves
              l'écran exact à la réouverture. Le process tourne dans Aven (aucune console
              externe, aucun port réseau).
            </p>
          </div>
          <button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
        </header>
        <div className="row bridge-status-row">
          <span className="hint" role="status">{status}</span>
          <span className="row bridge-actions">
            <button className="button secondary" type="button" onClick={sendInterrupt} title="Interrompt le tour en cours (Ctrl+C envoyé au terminal)">
              <Icon name="close" size={14} />Interrompre
            </button>
            <button className="button secondary" type="button" onClick={restartSession} title="Tue la session et relance une neuve (utile si freebuff se bloque sans crasher)">
              <Icon name="restore" size={14} />Redémarrer la session
            </button>
          </span>
        </div>
        {isError && <p className="err" role="alert">{status}</p>}
        <div className="bridge-term-host" ref={termHostRef} />
      </div>
    </div>
  )
}
