import { useEffect, useState } from "react"
import { api } from "../api"
import { Icon } from "../icons"
import type { AvenApp } from "../app/use-aven-app"
import type { NoteTreeEntry } from "../types"

// v11.0.0 : « Aujourd'hui » remplace le hub orbital. Quatre tuiles de données, pas
// de cartes décoratives : ce qui est récent, ce qui tourne, ce qui est écrit, ce
// qu'on capture. Chaque ligne est une action réelle.

type NoteRow = { id: string; title: string; updated: number }

function flattenNotes(nodes: NoteTreeEntry[], out: NoteRow[] = []): NoteRow[] {
  for (const node of nodes) {
    if (node.type === "note") out.push({ id: node.id, title: node.title, updated: node.updated })
    else flattenNotes(node.children, out)
  }
  return out
}

export default function HomeBoard({ app }: { app: AvenApp }) {
  const {
    agentName,
    appState,
    chats,
    dictation,
    dictationPointerRef,
    freebuffCliErrorRef,
    freebuffPillState,
    homeNotice,
    live,
    newChat,
    notices,
    openAgentsPage,
    openConfiguration,
    openFilesView,
    openFreebuffAgent,
    openHomeConversation,
    openNotesView,
    releaseDictation,
    setCaptureRequested,
    setHomeNotice,
    tab,
    taskMode,
    workspaceName,
  } = app

  const [notes, setNotes] = useState<NoteRow[]>([])
  const [capture, setCapture] = useState("")
  const [capturing, setCapturing] = useState(false)

  useEffect(() => {
    let stop = false
    api.notesTree()
      .then((tree) => { if (!stop) setNotes(flattenNotes(tree).sort((a, b) => b.updated - a.updated).slice(0, 5)) })
      .catch(() => { if (!stop) setNotes([]) })
    return () => { stop = true }
  }, [])

  const createCapture = async () => {
    const markdown = capture.trim()
    if (!markdown || capturing) return
    setCapturing(true)
    try {
      const note = await api.noteQuickCapture("", markdown)
      setCapture("")
      setCaptureRequested(false)
      openNotesView(note.id)
    } catch (e) {
      setHomeNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setCapturing(false)
    }
  }

  const recent = chats.slice(0, 5)
  const modeLabel = taskMode === "auto" ? "Auto" : taskMode === "code" ? "Code" : taskMode === "analyse" ? "Analyse" : "Recherche"

  return (
    <div className="wb-home">
      <header className="wb-home-head">
        <div>
          <span className="instrument-eyebrow">POSTE · AUJOURD’HUI</span>
          <h1>{workspaceName || "Espace de travail"}</h1>
          <p>Reprendre, surveiller, écrire. Le micro de la barre exécute les commandes d’application ; une dictée ordinaire rejoint le composeur.</p>
        </div>
        <div className="wb-home-meta">
          <span>{appState.status === "ready" ? "MOTEUR EN LIGNE" : appState.status === "starting" ? "DÉMARRAGE" : "MOTEUR HORS LIGNE"}</span>
          <span className="wb-status-sep" aria-hidden="true" />
          <span>{agentName(tab) || "agent principal"}</span>
          <span className="wb-status-sep" aria-hidden="true" />
          <span>MODE {modeLabel}</span>
        </div>
      </header>

      {homeNotice && (
        <div className="wb-notice wb-home-notice" role="status">
          <span>{homeNotice}</span>
          {/* v11.0.0 : l'avis reste ACTIONNABLE (règle v9.1.4) — il mène à l'endroit
              qu'il nomme, au lieu de demander à l'utilisateur de le retrouver. */}
          <button className="button ghost wb-home-notice-action" type="button" onClick={() => { setHomeNotice(null); openConfiguration(undefined, "general") }}>Ouvrir les Réglages</button>
          <button className="button ghost wb-home-notice-close" type="button" onClick={() => setHomeNotice(null)} aria-label="Fermer l’avis">Fermer</button>
        </div>
      )}

      <div className="wb-home-scroll">
        <div className="wb-home-grid">
          <section className="wb-tile" data-span="8" aria-label="Reprendre une conversation">
            <div className="wb-tile-head">
              {/* v11.0.2 : la tuile liste des conversations, pas des agents. */}
              <Icon name="chat" size={14} />
              <strong>Reprendre</strong>
              <span className="wb-num">{recent.length.toString().padStart(2, "0")}</span>
            </div>
            <div className="wb-tile-body">
              {recent.map((chat) => (
                <button key={chat.id} className="wb-row" type="button" onClick={() => openHomeConversation(chat)}>
                  {/* v11.0.1 : `file` désignait ici une conversation et, plus bas, une note —
                      dans la même planche. Une conversation porte l'icône agent. */}
                  <span className="wb-row-icon"><Icon name="chat" size={15} /></span>
                  <span className="wb-row-copy">
                    <strong>{chat.title || "Conversation"}</strong>
                    <small>{agentName(chat.agent || tab)}{chat.model ? ` · ${chat.model}` : ""}</small>
                  </span>
                  <span className="wb-row-meta">{chat.updated ? new Date(chat.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" }) : ""}</span>
                </button>
              ))}
              {!recent.length && <p className="wb-tile-empty">Aucune conversation. Crée la première pour commencer.</p>}
            </div>
            <div className="wb-tile-action">
              <button className="button primary full" type="button" onClick={() => void newChat()} disabled={!tab}>
                <Icon name="plus" size={14} />Nouvelle conversation
              </button>
            </div>
          </section>

          <section className="wb-tile" data-span="4" aria-label="En cours">
            <div className="wb-tile-head">
              <Icon name="terminal" size={14} />
              <strong>En cours</strong>
              <span className="wb-num">{live.busy ? "01" : "00"}</span>
            </div>
            <div className="wb-tile-body">
              <div className="wb-inspector-kv"><span>Agent</span><span>{agentName(tab) || "—"}</span></div>
              <div className="wb-inspector-kv"><span>Délégation</span><span>{modeLabel}</span></div>
              <div className="wb-inspector-kv"><span>Tour</span><span>{live.busy ? "en cours" : "au repos"}</span></div>
              <div className="wb-inspector-kv"><span>Terminal</span><span>{freebuffPillState === "active" ? "session active" : freebuffPillState === "ready" ? "CLI prêt" : freebuffPillState === "installing" ? "installation" : "absent"}</span></div>
              {live.tools && Object.keys(live.tools).length > 0 && (
                <div className="wb-inspector-kv"><span>Outils</span><span>{Object.keys(live.tools).length}</span></div>
              )}
            </div>
            <div className="wb-tile-action wb-inspector-actions">
              <button className="button secondary" type="button" onClick={() => openAgentsPage()}><Icon name="branch" size={14} />Orchestration</button>
              <button className="button secondary" type="button" onClick={() => openFreebuffAgent()} title={freebuffCliErrorRef.current || undefined}><Icon name="terminal" size={14} />Terminal</button>
            </div>
          </section>

          <section className="wb-tile" data-span="8" aria-label="Notes récentes">
            <div className="wb-tile-head">
              <Icon name="file" size={14} />
              <strong>Notes récentes</strong>
              <span className="wb-num">{notes.length.toString().padStart(2, "0")}</span>
            </div>
            <div className="wb-tile-body">
              {notes.map((note) => (
                <button key={note.id} className="wb-row" type="button" onClick={() => openNotesView(note.id)}>
                  <span className="wb-row-icon"><Icon name="file" size={15} /></span>
                  <span className="wb-row-copy"><strong>{note.title || note.id}</strong><small>{note.id}</small></span>
                  <span className="wb-row-meta">{new Date(note.updated).toLocaleDateString("fr-FR", { day: "2-digit", month: "short" })}</span>
                </button>
              ))}
              {!notes.length && <p className="wb-tile-empty">Aucune note dans cet espace. Capture une idée à droite.</p>}
            </div>
            <div className="wb-tile-action wb-inspector-actions">
              <button className="button secondary" type="button" onClick={() => { setCaptureRequested(true); openNotesView() }}><Icon name="plus" size={14} />Nouvelle note</button>
              <button className="button ghost" type="button" onClick={() => openFilesView()}><Icon name="folder" size={14} />Fichiers</button>
            </div>
          </section>

          <section className="wb-tile" data-span="4" aria-label="Capture rapide">
            <div className="wb-tile-head">
              <Icon name="inbox" size={14} />
              <strong>Capturer</strong>
              <span className="wb-num">CTRL MAJ N</span>
            </div>
            <div className="wb-capture">
              <textarea
                value={capture}
                onChange={(e) => setCapture(e.target.value)}
                placeholder="Une idée, une tâche, une note… (Markdown accepté)"
                aria-label="Texte de la capture rapide"
              />
              <div className="wb-capture-actions">
                <button className="button secondary" type="button" onClick={() => void createCapture()} disabled={!capture.trim() || capturing}>
                  <Icon name="check" size={14} />{capturing ? "Capture…" : "Créer la note"}
                </button>
              </div>
            </div>
            <div className="wb-tile-action">
              <button
                className="wb-command-mic"
                type="button"
                data-recording={dictation.state === "recording"}
                disabled={!appState.keys.groq}
                title={appState.keys.groq ? "Maintiens pour parler : une commande pilote le Poste, le reste va au composeur." : "Configure une clé Groq dans Réglages"}
                onPointerDown={(e) => { e.preventDefault(); dictationPointerRef.current = true; if (dictation.state === "error") dictation.resetError(); else if (dictation.state === "idle") void dictation.start("workbench") }}
                onPointerUp={(e) => { e.preventDefault(); releaseDictation() }}
                onPointerLeave={() => { if (dictationPointerRef.current && dictation.state === "recording") dictation.pause() }}
                onPointerEnter={() => { if (dictationPointerRef.current && dictation.paused) dictation.resume() }}
                aria-label="Parler à Aven"
              >
                <Icon name="microphone" size={14} />
                <span className="wb-command-level" aria-hidden="true"><i /><i /><i /><i /><i /></span>
                {dictation.state === "recording" ? (dictation.paused ? "PAUSE" : "ÉCOUTE") : dictation.state === "transcribing" ? "TRANSCRIPTION" : "PARLER"}
              </button>
            </div>
          </section>

          {notices.length > 0 && (
            <section className="wb-tile" data-span="12" aria-label="Événements récents">
              <div className="wb-tile-head">
                <Icon name="list" size={14} />
                <strong>Journal</strong>
                <span className="wb-num">{notices.length.toString().padStart(2, "0")}</span>
              </div>
              <div className="wb-tile-body wb-notice-list">
                {notices.slice(-5).reverse().map((notice) => (
                  <p key={notice.id} className="wb-notice">{notice.text}</p>
                ))}
              </div>
            </section>
          )}

          <section className="wb-tile" data-span="12" aria-label="Réglages rapides">
            <div className="wb-tile-head">
              <Icon name="settings" size={14} />
              <strong>Réglages</strong>
              <span className="wb-num">INSPECTEUR</span>
            </div>
            <div className="wb-tile-action wb-inspector-actions">
              <button className="button secondary" type="button" onClick={() => openConfiguration(undefined, "general")}>Configuration</button>
              <button className="button secondary" type="button" onClick={() => openConfiguration(undefined, "appearance")}>Apparence</button>
              <button className="button secondary" type="button" onClick={() => openConfiguration(undefined, "usage")}>Usage</button>
            </div>
          </section>
        </div>
      </div>
    </div>
  )
}
