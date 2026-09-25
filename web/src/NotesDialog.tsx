import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import type { Note } from "./types"
import { Icon } from "./icons"

// Notes premium (v8.10.0) : recherche plein-texte (normalisée : accents/casse/ponctuation
// neutralisés — même logique que le module testé electron/notes-meta.ts), épinglage
// persistant, comptage de mots, export .md via dialogue natif.
export default function NotesDialog(props: { initialId?: string; onClose: () => void; onError: (e: unknown) => void }) {
  const [notes, setNotes] = useState<Note[]>([])
  const [pinned, setPinned] = useState<string[]>([])
  const [query, setQuery] = useState("")
  const [selected, setSelected] = useState<Note | null>(null)

  const reload = useCallback(() => api.notesList().then(setNotes).catch((e) => props.onError(e)), [props.onError])

  useEffect(() => {
    void reload()
    api.notePins().then(setPinned).catch((e) => props.onError(e))
  }, [reload])

  useEffect(() => {
    if (!props.initialId) return
    void reload()
    api.noteGet(props.initialId).then(setSelected).catch((e) => props.onError(e))
  }, [props.initialId, reload])

  // Recherche plein-texte : tous les termes (normalisés) doivent être présents
  // dans le titre OU le contenu de la note.
  const filtered = useMemo(() => {
    const q = query.trim()
    if (!q) return notes
    const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim()
    const terms = norm(q).split(/\s+/).filter(Boolean)
    return notes.filter((n) => {
      const hay = norm(`${n.title} ${n.markdown}`)
      return terms.every((t) => hay.includes(t))
    })
  }, [notes, query])

  // Les épinglées d'abord, puis par date de mise à jour décroissante.
  const ordered = useMemo(() => {
    const p = new Set(pinned)
    return [...filtered].sort((a, b) => (p.has(b.id) ? 1 : 0) - (p.has(a.id) ? 1 : 0) || b.updated - a.updated)
  }, [filtered, pinned])

  const countWords = (markdown: string) => (markdown.trim() ? markdown.trim().split(/\s+/).length : 0)

  const togglePin = (id: string) => {
    api.noteTogglePin(id).then(setPinned).catch((e) => props.onError(e))
  }

  const open = (id: string) => api.noteGet(id).then(setSelected).catch((e) => props.onError(e))

  const exportNote = (id: string) => {
    api.noteExport(id).catch((e) => props.onError(e)) // le dialogue natif est son propre retour
  }

  return (
    <div className="overlay"><div className="dialog wide notes-dialog"><header className="unified-settings-header"><div><span className="eyebrow">NOTES</span><h3>Notes du projet</h3><p className="hint">Stockées en Markdown dans l’espace de travail actif.</p></div><button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button></header><div className="notes-layout"><aside className="notes-list-panel"><input className="settings-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher dans les titres et le contenu…" />{ordered.map((n) => <button key={n.id} className={`notes-item ${selected?.id === n.id ? "selected" : ""}`} onClick={() => open(n.id)}><strong>{pinned.includes(n.id) ? "📌 " : ""}{n.title}</strong><span>{n.id}</span></button>)}{!ordered.length && <p className="hint">Aucune note ne correspond.</p>}</aside><article className="notes-preview">{selected ? <><span className="eyebrow">APERÇU</span><h4>{selected.title}</h4><div className="notes-toolbar"><button className="button ghost" onClick={() => togglePin(selected.id)} type="button">{pinned.includes(selected.id) ? "Détacher" : "Épingler"}</button><button className="button ghost" onClick={() => exportNote(selected.id)} type="button">Exporter .md</button><span className="hint">{countWords(selected.markdown)} mots · {selected.markdown.length} caractères</span></div><pre>{selected.markdown}</pre></> : <div className="empty-state"><div className="empty-symbol"><Icon name="pencil" size={24} /></div><h2>Sélectionne une note</h2><p>Les notes de l’espace de travail apparaîtront ici.</p></div>}</article></div></div></div>
  )
}
