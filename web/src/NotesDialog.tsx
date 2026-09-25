import { useEffect, useMemo, useRef, useState } from "react"
import { api } from "./api"
import type { Note } from "./types"
import { Icon } from "./icons"

export default function NotesDialog(props: { initialId?: string; onClose: () => void; onError: (e: unknown) => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Note | null>(null)
  const onErrorRef = useRef(props.onError)
  onErrorRef.current = props.onError

  useEffect(() => {
    api.notesList().then((value) => setNotes(value)).catch((e) => onErrorRef.current(e))
  }, [])

  useEffect(() => {
    if (!props.initialId) return
    api.notesList().then((value) => setNotes(value)).catch((e) => onErrorRef.current(e))
    api.noteGet(props.initialId).then(setSelected).catch((e) => onErrorRef.current(e))
  }, [props.initialId])

  const filtered = useMemo(() => notes.filter((n) => !query.trim() || n.title.toLowerCase().includes(query.toLowerCase())), [notes, query])
  return <div className="overlay"><div className="dialog wide notes-dialog"><header className="unified-settings-header"><div><span className="eyebrow">NOTES</span><h3>Notes du projet</h3><p className="hint">Stockées en Markdown dans l’espace de travail actif.</p></div><button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button></header><div className="notes-layout"><aside className="notes-list-panel"><input className="settings-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher une note…" />{filtered.map((n) => <button key={n.id} className={`notes-item ${selected?.id === n.id ? "selected" : ""}`} onClick={() => api.noteGet(n.id).then(setSelected).catch((e) => onErrorRef.current(e))}><strong>{n.title}</strong><span>{n.id}</span></button>)}{!filtered.length && <p className="hint">Aucune note.</p>}</aside><article className="notes-preview">{selected ? <><span className="eyebrow">APERÇU</span><h4>{selected.title}</h4><pre>{selected.markdown}</pre></> : <div className="empty-state"><div className="empty-symbol"><Icon name="pencil" size={24} /></div><h2>Sélectionne une note</h2><p>Les notes de l’assistant vocal apparaîtront ici.</p></div>}</article></div></div></div>
}
