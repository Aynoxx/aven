import { useCallback, useEffect, useMemo, useState } from "react"
import { api } from "./api"
import Markdown from "./Markdown"
import { Icon } from "./icons"
import type { Note } from "./types"

// Vue Notes (v9.3.0) — remplace le modal NotesDialog : liste latérale + panneau principal
// à deux modes (lecture avec rendu Markdown réel / édition). Les tags par agent (stockés
// dans notes-meta.json) filtrent la liste et pré-étiquettent une note créée depuis la vue.
// Aucun hook dans un rendu conditionnel : tous les hooks sont au niveau du composant.

type Props = {
  initialId?: string
  // Agents connus (identifiants + noms affichés) pour l'étiquetage par agent.
  agents: { id: string; name: string }[]
  // Agent courant (pré-coché à la création d'une note).
  currentAgent?: string
  // Injection dans le composeur de l'onglet actif (« Joindre à la conversation »).
  onCompose: (text: string) => void
  onClose: () => void
  onError: (e: unknown) => void
}

export default function NotesView(props: Props) {
  const [notes, setNotes] = useState<Note[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(props.initialId)
  const [query, setQuery] = useState("")
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [tags, setTags] = useState<Record<string, string[]>>({})
  const [pinned, setPinned] = useState<string[]>([])
  const [dir, setDir] = useState("")
  // Édition : note en cours (id vide = création), brouillon titre/contenu.
  const [editing, setEditing] = useState<{ id: string; title: string; markdown: string } | null>(null)
  // Étiquettes en cours d'édition pour la note sélectionnée.
  const [editingTags, setEditingTags] = useState<string[] | null>(null)

  const reload = useCallback(() => {
    api.notesList().then((list) => setNotes(list)).catch((e) => props.onError(e))
    api.notePins().then((p) => setPinned(p)).catch(() => undefined)
    api.noteDir().then(setDir).catch(() => undefined)
  }, [props.onError])

  useEffect(() => { reload() }, [reload])

  // Charge les tags de toutes les notes (best effort : un échec ne bloque pas la vue).
  useEffect(() => {
    let stop = false
    void (async () => {
      try {
        const list = await api.notesList()
        const entries = await Promise.all(list.map(async (n) => [n.id, await api.noteTags(n.id).catch(() => [])] as const))
        if (!stop) setTags(Object.fromEntries(entries))
      } catch { /* tags indisponibles : la vue reste utilisable */ }
    })()
    return () => { stop = true }
  }, [notes.length])

  const selected = useMemo(() => notes.find((n) => n.id === selectedId), [notes, selectedId])

  const allTags = useMemo(() => [...new Set(Object.values(tags).flat())].sort((a, b) => a.localeCompare(b, "fr")), [tags])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return notes
      .filter((n) => (tagFilter ? (tags[n.id] ?? []).includes(tagFilter) : true))
      .filter((n) => !q || n.title.toLowerCase().includes(q) || n.markdown.toLowerCase().includes(q))
      .sort((a, b) => (pinned.includes(b.id) ? 1 : 0) - (pinned.includes(a.id) ? 1 : 0) || b.updated - a.updated)
  }, [notes, query, tagFilter, tags, pinned])

  const open = (id: string) => {
    setSelectedId(id)
    setEditing(null)
    setEditingTags(null)
  }

  const togglePin = async (id: string) => {
    try { setPinned(await api.noteTogglePin(id)) } catch (e) { props.onError(e) }
  }

  const commitTags = async (id: string, next: string[]) => {
    try {
      const saved = await api.noteSetTags(id, next)
      setTags((t) => ({ ...t, [id]: saved }))
    } catch (e) { props.onError(e) }
  }

  const startEdit = async (note?: Note) => {
    if (note) {
      setEditing({ id: note.id, title: note.title, markdown: note.markdown })
    } else {
      // Création : l'agent courant pré-étiquette la note (liée à la conversation d'origine).
      setEditing({ id: "", title: "", markdown: "" })
      setEditingTags(props.currentAgent ? [props.currentAgent] : [])
    }
  }

  const commitEdit = async () => {
    if (!editing) return
    try {
      const saved = await api.noteSave(editing.id, editing.title, editing.markdown)
      setNotes((ns) => [saved, ...ns.filter((n) => n.id !== saved.id)])
      setSelectedId(saved.id)
      if (editingTags && editing.id === "") await commitTags(saved.id, editingTags)
      setEditing(null)
      setEditingTags(null)
    } catch (e) { props.onError(e) }
  }

  const attachToConversation = (note: Note) => {
    props.onCompose(`Voici ma note « ${note.title} » :\n\n${note.markdown}`)
  }

  const tagName = (tag: string) => props.agents.find((a) => a.id === tag)?.name ?? tag

  return (
    <div className="overlay"><div className="dialog wide notes-dialog">
      <header className="unified-settings-header">
        <div><span className="eyebrow">NOTES</span><h3>Notes de l'espace</h3><p className="hint">De vrais fichiers Markdown sur ton PC, étiquetables par agent.</p>
          <div className="row notes-dir-row"><code className="hint">{dir || "…"}</code><button className="button secondary" type="button" onClick={() => api.noteOpenFolder().catch((e) => props.onError(e))}><Icon name="folder" size={14} />Ouvrir le dossier</button></div>
        </div>
        <button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
      </header>
      <div className="notes-layout">
        <aside className="notes-list-panel">
          <div className="row notes-actions-row">
            <input className="settings-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher…" aria-label="Rechercher dans les notes" />
            <button className="button primary" type="button" onClick={() => void startEdit()} title="Nouvelle note"><Icon name="plus" size={14} />Nouvelle</button>
          </div>
          {!!allTags.length && (
            <div className="notes-tags-filter" role="group" aria-label="Filtrer par agent">
              <button className={`notes-tag ${tagFilter === null ? "selected" : ""}`} onClick={() => setTagFilter(null)} type="button">Toutes</button>
              {allTags.map((t) => <button key={t} className={`notes-tag ${tagFilter === t ? "selected" : ""}`} onClick={() => setTagFilter(tagFilter === t ? null : t)} type="button">{tagName(t)}</button>)}
            </div>
          )}
          {visible.map((n) => (
            <button key={n.id} className={`notes-item ${selected?.id === n.id ? "selected" : ""}`} onClick={() => open(n.id)} type="button">
              <strong>{pinned.includes(n.id) ? "📌 " : ""}{n.title}</strong>
              <span>
                {n.id}
                {!!(tags[n.id] ?? []).length && <em className="notes-item-tags">{(tags[n.id] ?? []).map(tagName).join(", ")}</em>}
              </span>
            </button>
          ))}
          {!visible.length && <p className="hint">Aucune note ne correspond.</p>}
        </aside>
        <article className="notes-preview">
          {editing ? (
            <div className="notes-editor">
              <span className="eyebrow">{editing.id ? "ÉDITION" : "NOUVELLE NOTE"}</span>
              <input className="settings-input notes-title-input" value={editing.title} placeholder="Titre de la note…" onChange={(e) => setEditing({ ...editing, title: e.target.value })} aria-label="Titre de la note" />
              <textarea className="notes-editor-textarea" value={editing.markdown} onChange={(e) => setEditing({ ...editing, markdown: e.target.value })} placeholder="# Titre&#10;&#10;Écris ta note en Markdown…" aria-label="Contenu de la note" />
              <div className="row notes-editor-actions">
                <button className="button primary" type="button" disabled={!editing.title.trim()} onClick={() => void commitEdit()}><Icon name="check" size={14} />Enregistrer</button>
                <button className="button ghost" type="button" onClick={() => { setEditing(null); setEditingTags(null) }}>Annuler</button>
                {editing.id === "" && editingTags && (
                  <span className="notes-tag-picker" role="group" aria-label="Étiquettes de la nouvelle note">
                    {props.agents.map((a) => (
                      <button key={a.id} type="button" className={`notes-tag ${editingTags.includes(a.id) ? "selected" : ""}`} onClick={() => setEditingTags(editingTags.includes(a.id) ? editingTags.filter((t) => t !== a.id) : [...editingTags, a.id])}>{a.name}</button>
                    ))}
                  </span>
                )}
              </div>
            </div>
          ) : selected ? (
            <>
              <span className="eyebrow">APERÇU</span>
              <h4>{selected.title}</h4>
              <div className="notes-toolbar">
                <button className="button ghost" onClick={() => void togglePin(selected.id)} type="button">{pinned.includes(selected.id) ? "Détacher" : "Épingler"}</button>
                <button className="button ghost" onClick={() => void startEdit(selected)} type="button"><Icon name="pencil" size={13} />Modifier</button>
                <button className="button ghost" onClick={() => attachToConversation(selected)} type="button" title="Copie la note dans le composeur de l'onglet actif"><Icon name="chevron-right" size={13} />Joindre à la conversation</button>
                <button className="button ghost" onClick={() => api.noteExport(selected.id).catch((e) => props.onError(e))} type="button">Exporter .md</button>
                <span className="hint">{selected.markdown.split(/\s+/).filter(Boolean).length} mots</span>
              </div>
              <div className="notes-tags-editor" role="group" aria-label="Étiquettes par agent">
                {props.agents.map((a) => {
                  const active = (tags[selected.id] ?? []).includes(a.id)
                  return <button key={a.id} type="button" className={`notes-tag ${active ? "selected" : ""}`} onClick={() => void commitTags(selected.id, active ? (tags[selected.id] ?? []).filter((t) => t !== a.id) : [...(tags[selected.id] ?? []), a.id])}>{a.name}</button>
                })}
              </div>
              <div className="notes-render"><Markdown text={selected.markdown} /></div>
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-symbol"><Icon name="pencil" size={24} /></div>
              <h2>Sélectionne une note</h2>
              <p>Les notes de l'espace apparaîtront ici, avec leur rendu Markdown.</p>
            </div>
          )}
        </article>
      </div>
    </div></div>
  )
}
