import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { api } from "./api"
import Markdown from "./Markdown"
import NoteEditor from "./NoteEditor"
import { Icon } from "./icons"
import type { Note, NoteLink, NoteSearchHit, NoteTreeEntry } from "./types"

// v10.1.0 « façon Kortex » : arbre de dossiers (drag&drop natif), éditeur riche
// TipTap, wikilinks [[note]] + backlinks, poubelle/archive sur disque, recherche
// globale, capture rapide en Inbox. Les tags par agent et l'épinglage restent.
// Tous les hooks sont au niveau du composant (règle : pas de hook en rendu conditionnel).

type Props = {
  initialId?: string
  // v10.1.0 : capture rapide demandée par le raccourci global (Ctrl+Shift+N).
  autoCapture?: boolean
  onCaptureHandled?: () => void
  agents: { id: string; name: string }[]
  currentAgent?: string
  onCompose: (text: string) => void
  onClose: () => void
  onError: (e: unknown) => void
}

export default function NotesView(props: Props) {
  const [tree, setTree] = useState<NoteTreeEntry[]>([])
  const [selectedId, setSelectedId] = useState<string | undefined>(props.initialId)
  const [selected, setSelected] = useState<Note | null>(null)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<{ id: string; title: string; snippet: string }[]>([])
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [tags, setTags] = useState<Record<string, string[]>>({})
  const [pinned, setPinned] = useState<string[]>([])
  const [dir, setDir] = useState("")
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [editing, setEditing] = useState<{ id: string; title: string; markdown: string } | null>(null)
  const [editingTags, setEditingTags] = useState<string[] | null>(null)
  const [links, setLinks] = useState<NoteLink[]>([])
  const [backs, setBacks] = useState<string[]>([])
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<Note[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archived, setArchived] = useState<Note[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  // v10.2.0 (E2) : purge à deux clics — le premier arme (4 s), le second détruit
  // définitivement le fichier sur disque (le bouton passe en rouge le temps de l'arme).
  const [purgeArmed, setPurgeArmed] = useState<string | null>(null)
  const purgeTimer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(purgeTimer.current), [])

  const reload = useCallback(() => {
    api.notesTree().then(setTree).catch((e) => props.onError(e))
    api.notePins().then(setPinned).catch(() => undefined)
    api.noteDir().then(setDir).catch(() => undefined)
  }, [props.onError])

  useEffect(() => { reload() }, [reload])

  // Capture rapide demandée au montage (raccourci global) : note datée en Inbox/.
  // quickCapture est stable en pratique (props.onError constant) ; l'effet ne
  // s'exécute qu'une fois au montage pour éviter une boucle de captures.
  const captureOnce = useRef(false)
  useEffect(() => {
    if (!props.autoCapture || captureOnce.current) return
    captureOnce.current = true
    void quickCapture()
    props.onCaptureHandled?.()
  })

  // Tags des notes (best effort).
  useEffect(() => {
    let stop = false
    void (async () => {
      try {
        const ids: string[] = []
        const walk = (nodes: NoteTreeEntry[]) => { for (const n of nodes) { if (n.type === "note") ids.push(n.id); else walk(n.children) } }
        walk(tree)
        const entries = await Promise.all(ids.map(async (id) => [id, await api.noteTags(id).catch(() => [])] as const))
        if (!stop) setTags(Object.fromEntries(entries))
      } catch { /* indisponible : la vue reste utilisable */ }
    })()
    return () => { stop = true }
  }, [tree])

  // Note sélectionnée : chargement + liens + backlinks.
  useEffect(() => {
    if (!selectedId) { setSelected(null); setLinks([]); setBacks([]); return }
    let stop = false
    void (async () => {
      try {
        const note = await api.noteGet(selectedId)
        if (stop) return
        setSelected(note)
        setLinks(await api.noteLinks(selectedId).catch(() => []))
        setBacks(await api.noteBacklinks(selectedId).catch(() => []))
      } catch (e) { if (!stop) props.onError(e) }
    })()
    return () => { stop = true }
  }, [selectedId, props.onError])

  // Recherche globale (debounce court).
  const hitsCache = useRef(new Map<string, NoteSearchHit[]>())
  useEffect(() => {
    const q = query.trim()
    if (!q) { setHits([]); return }
    // v10.2.0 (F7) : debounce 200 → 120 ms — la frappe reste réactive sans spammer l'IPC ;
    // un résultat DÉJÀ obtenu pour cette requête s'affiche immédiatement (retour en
    // arrière), et le premier caractère ne patiente pas (une seule recherche par frappe).
    const cached = hitsCache.current.get(q)
    if (cached) { setHits(cached); return }
    const t = setTimeout(() => {
      api.noteSearch(q).then((r) => { hitsCache.current.set(q, r); setHits(r) }).catch(() => setHits([]))
    }, q.length <= 1 ? 0 : 120)
    return () => clearTimeout(t)
  }, [query])

  const open = (id: string) => { setSelectedId(id); setEditing(null); setEditingTags(null) }

  const togglePin = async (id: string) => {
    try { setPinned(await api.noteTogglePin(id)) } catch (e) { props.onError(e) }
  }

  const commitTags = async (id: string, next: string[]) => {
    try { const saved = await api.noteSetTags(id, next); setTags((t) => ({ ...t, [id]: saved })) } catch (e) { props.onError(e) }
  }

  const startEdit = (note?: Note) => {
    if (note) setEditing({ id: note.id, title: note.title, markdown: note.markdown })
    else {
      setEditing({ id: "", title: "", markdown: "" })
      setEditingTags(props.currentAgent ? [props.currentAgent] : [])
    }
  }

  const commitEdit = async () => {
    if (!editing) return
    try {
      const saved = await api.noteSave(editing.id, editing.title, editing.markdown)
      reload()
      setSelectedId(saved.id)
      if (editingTags && editing.id === "") await commitTags(saved.id, editingTags)
      setEditing(null); setEditingTags(null)
    } catch (e) { props.onError(e) }
  }

  const withNote = async (fn: () => Promise<unknown>) => {
    try { await fn(); reload() } catch (e) { props.onError(e) }
  }

  const quickCapture = async () => {
    try {
      const note = await api.noteQuickCapture("", "")
      reload()
      open(note.id)
      startEdit(note)
    } catch (e) { props.onError(e) }
  }

  const createFolder = async () => {
    const name = window.prompt("Nom du nouveau dossier :")
    if (!name) return
    try { await api.noteCreateFolder(name); reload() } catch (e) { props.onError(e) }
  }

  // v10.2.0 (M8) : déplacement partagé par le glisser-déposer ET le clavier (Alt+↑↓).
  const moveNote = async (id: string, folder: string) => {
    if (id.startsWith(".trash/") || id.startsWith(".archive/")) return
    try { const moved = await api.noteMove(id, folder); reload(); open(moved) } catch (e) { props.onError(e) }
  }

  const onDrop = async (folder: string) => {
    setDropFolder(null)
    if (!dragId) return
    const id = dragId
    setDragId(null)
    await moveNote(id, folder)
  }

  // v10.2.0 (E2) : purge à deux clics — armer puis confirmer dans les 4 s.
  const purgeNote = (id: string) => {
    window.clearTimeout(purgeTimer.current)
    if (purgeArmed === id) { setPurgeArmed(null); void withNote(() => api.notePurge(id)); return }
    setPurgeArmed(id)
    purgeTimer.current = window.setTimeout(() => setPurgeArmed(null), 4000)
  }

  const attach = (note: Note, analyse: boolean) => {
    props.onCompose(analyse
      ? `Analyse ma note « ${note.title} » et propose une synthèse structurée :\n\n${note.markdown}`
      : `Voici ma note « ${note.title} » :\n\n${note.markdown}`)
  }

  const tagName = (tag: string) => props.agents.find((a) => a.id === tag)?.name ?? tag
  const allTags = useMemo(() => [...new Set(Object.values(tags).flat())].sort((a, b) => a.localeCompare(b, "fr")), [tags])
  const visibleNote = (n: { id: string }) => !tagFilter || (tags[n.id] ?? []).includes(tagFilter)

  const renderNoteRow = (entry: NoteTreeEntry & { type: "note" }) => (
    <div key={entry.id} className={`notes-tree-row ${selectedId === entry.id ? "selected" : ""}`} data-note-id={entry.id} draggable
      onDragStart={() => setDragId(entry.id)} onDragEnd={() => setDragId(null)}>
      <button className="notes-tree-item" onClick={() => open(entry.id)} type="button" title={entry.id}>
        <Icon name="file" size={13} />
        <span>{pinned.includes(entry.id) ? "📌 " : ""}{entry.title}</span>
      </button>
    </div>
  )

  const renderTree = (nodes: NoteTreeEntry[], depth = 0) => nodes
    .filter(visibleNote)
    .map((n) => {
      if (n.type === "note") return renderNoteRow(n)
      const isCollapsed = collapsed[n.id]
      return (
        <div key={`f-${n.id}`} className={`notes-tree-folder ${dropFolder === n.id ? "drop-target" : ""}`} data-folder-id={n.id} style={{ paddingLeft: depth * 12 }}
          onDragOver={(e) => { e.preventDefault(); setDropFolder(n.id) }} onDragLeave={() => setDropFolder((f) => (f === n.id ? null : f))} onDrop={(e) => { e.preventDefault(); void onDrop(n.id) }}>
          <button className="notes-tree-item folder" onClick={() => setCollapsed((c) => ({ ...c, [n.id]: !c[n.id] }))} type="button">
            <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={12} />
            <Icon name="folder" size={13} />
            <span>{n.name}</span>
          </button>
          {!isCollapsed && renderTree(n.children, depth + 1)}
        </div>
      )
    })

  // v10.2.0 (M8) : l'arbre se pilote au clavier (skill « mode pour chaque geste ») —
  // ↑↓ déplacent le focus d'une rangée visible à l'autre ; Alt+↑↓ déplacent la note
  // vers le dossier affiché juste au-dessus/au-dessous (racine s'il n'y en a pas au-dessus).
  const treeKeyDown = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return
    const rows = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(".notes-tree-item"))
    if (!rows.length) return
    e.preventDefault()
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const current = active ? rows.indexOf(active) : -1
    if (!e.altKey) {
      const next = current < 0 ? rows[0] : rows[Math.min(rows.length - 1, Math.max(0, current + (e.key === "ArrowDown" ? 1 : -1)))]
      next.focus()
      return
    }
    // Alt+ : uniquement depuis une rangée note (les dossiers ne se déplacent pas).
    const noteRow = current >= 0 ? rows[current].closest<HTMLElement>(".notes-tree-row") : null
    const noteId = noteRow?.dataset.noteId
    if (!noteRow || !noteId) return
    const folderIdOf = (btn: HTMLElement) => btn.closest<HTMLElement>(".notes-tree-folder")?.dataset.folderId ?? ""
    const containerBtn = noteRow.closest<HTMLElement>(".notes-tree-folder")?.querySelector<HTMLElement>(":scope > .notes-tree-item")
    const folders = rows.filter((el) => el.classList.contains("folder"))
    // f AVANT la note = la note est positionnée après f dans le document.
    const before = folders.filter((f) => (f.compareDocumentPosition(noteRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && f !== containerBtn)
    const after = folders.filter((f) => (f.compareDocumentPosition(noteRow) & Node.DOCUMENT_POSITION_PRECEDING) !== 0)
    const target = e.key === "ArrowUp"
      ? (before.length ? folderIdOf(before[before.length - 1]) : "") // racine
      : (after.length ? folderIdOf(after[0]) : undefined) // rien en dessous = no-op
    if (target === undefined) return
    void moveNote(noteId, target)
  }

  return (
    <div className="overlay"><div className="dialog wide notes-dialog">
      <header className="unified-settings-header">
        <div>
          <span className="eyebrow">NOTES</span>
          <h3>Notes de l'espace</h3>
          <p className="hint">De vrais fichiers Markdown sur ton PC — dossiers, liens [[note]], poubelle. Glisse une note sur un dossier, ou Alt+↑↓ au clavier.</p>
          <div className="row notes-dir-row"><code className="hint">{dir || "…"}</code>
            <button className="button secondary" type="button" onClick={() => api.noteOpenFolder().catch((e) => props.onError(e))}><Icon name="folder" size={14} />Ouvrir le dossier</button>
          </div>
        </div>
        <button className="button button-icon dialog-close" onClick={props.onClose} aria-label="Fermer" type="button"><Icon name="close" size={17} /></button>
      </header>
      <div className="notes-layout">
        <aside className="notes-list-panel">
          <div className="row notes-actions-row">
            <input className="settings-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher… (global)" aria-label="Rechercher dans les notes" />
            <button className="button secondary" type="button" onClick={() => void quickCapture()} title="Capture rapide (dans Inbox)"><Icon name="inbox" size={14} /></button>
            <button className="button secondary" type="button" onClick={() => void createFolder()} title="Nouveau dossier"><Icon name="folder" size={14} /></button>
            <button className="button primary" type="button" onClick={() => startEdit()} title="Nouvelle note"><Icon name="plus" size={14} />Nouvelle</button>
          </div>
          {!!allTags.length && (
            <div className="notes-tags-filter" role="group" aria-label="Filtrer par agent">
              <button className={`notes-tag ${tagFilter === null ? "selected" : ""}`} onClick={() => setTagFilter(null)} type="button">Toutes</button>
              {allTags.map((t) => <button key={t} className={`notes-tag ${tagFilter === t ? "selected" : ""}`} onClick={() => setTagFilter(tagFilter === t ? null : t)} type="button">{tagName(t)}</button>)}
            </div>
          )}
          {hits.length > 0 && (
            <div className="notes-search-hits">
              <span className="eyebrow">RÉSULTATS</span>
              {hits.map((h) => (
                <button key={h.id} className="notes-item" onClick={() => open(h.id)} type="button">
                  <strong>{h.title}</strong><span>{h.snippet}</span>
                </button>
              ))}
            </div>
          )}
          <div className="notes-tree" role="tree" aria-label="Dossiers et notes" onKeyDown={treeKeyDown} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
            {renderTree(tree)}
            {!tree.length && <p className="hint">Aucune note — crée la première.</p>}
          </div>
          <div className="notes-tree-sections">
            <button className="notes-tree-item folder" onClick={() => { setTrashOpen((v) => !v); if (!trashOpen) api.noteTrash().then(setTrash).catch(() => undefined) }} type="button">
              <Icon name="trash" size={13} /><span>Poubelle ({trashOpen ? trash.length : "?"})</span>
            </button>
            {trashOpen && trash.map((n) => (
              <div key={n.id} className="notes-tree-row">
                <button className="notes-tree-item" onClick={() => open(n.id)} type="button" title={n.id}><Icon name="file" size={13} /><span>{n.title}</span></button>
                <button className="button ghost note-row-action" onClick={() => void withNote(() => api.noteRestore(n.id))} type="button" title="Restaurer"><Icon name="restore" size={13} /></button>
                <button className={`button ghost note-row-action${purgeArmed === n.id ? " armed" : ""}`} onClick={() => purgeNote(n.id)} type="button" title={purgeArmed === n.id ? "Confirmer : supprimer définitivement" : "Supprimer définitivement"} aria-label={purgeArmed === n.id ? "Confirmer : supprimer définitivement" : "Supprimer définitivement"}><Icon name="trash" size={13} /></button>
              </div>
            ))}
            <button className="notes-tree-item folder" onClick={() => { setArchiveOpen((v) => !v); if (!archiveOpen) api.noteArchived().then(setArchived).catch(() => undefined) }} type="button">
              <Icon name="archive" size={13} /><span>Archive ({archiveOpen ? archived.length : "?"})</span>
            </button>
            {archiveOpen && archived.map((n) => (
              <div key={n.id} className="notes-tree-row">
                <button className="notes-tree-item" onClick={() => open(n.id)} type="button" title={n.id}><Icon name="file" size={13} /><span>{n.title}</span></button>
                <button className="button ghost note-row-action" onClick={() => void withNote(() => api.noteUnarchive(n.id))} type="button" title="Restaurer"><Icon name="restore" size={13} /></button>
              </div>
            ))}
          </div>
        </aside>
        <article className="notes-preview">
          {editing ? (
            <div className="notes-editor">
              <span className="eyebrow">{editing.id ? "ÉDITION" : "NOUVELLE NOTE"}</span>
              {!editing.id && (
                <input className="settings-input notes-title-input" value={editing.title} placeholder="Titre de la note…" onChange={(e) => setEditing({ ...editing, title: e.target.value })} aria-label="Titre de la note" />
              )}
              <NoteEditor key={editing.id || "new"} value={editing.markdown} onChange={(markdown) => setEditing((cur) => (cur ? { ...cur, markdown } : cur))} />
              <div className="row notes-editor-actions">
                <button className="button primary" type="button" onClick={() => void commitEdit()} disabled={!editing.id && !editing.title.trim()}><Icon name="check" size={14} />Enregistrer</button>
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
                <button className="button ghost" onClick={() => startEdit(selected)} type="button"><Icon name="pencil" size={13} />Modifier</button>
                <button className="button ghost" onClick={() => attach(selected, false)} type="button" title="Copie la note dans le composeur de l'onglet actif"><Icon name="chevron-right" size={13} />Joindre à la conversation</button>
                <button className="button ghost" onClick={() => attach(selected, true)} type="button" title="Demande une synthèse structurée à l'agent de l'onglet actif"><Icon name="sparkle" size={13} />Demander à l'agent</button>
                <button className="button ghost" onClick={() => void withNote(() => api.noteArchive(selected.id))} type="button"><Icon name="archive" size={13} />Archiver</button>
                <button className="button ghost" onClick={() => void withNote(() => api.noteDelete(selected.id))} type="button"><Icon name="trash" size={13} />Poubelle</button>
                <button className="button ghost" onClick={() => api.noteExport(selected.id).catch((e) => props.onError(e))} type="button">Exporter .md</button>
                <span className="hint">{selected.markdown.split(/\s+/).filter(Boolean).length} mots</span>
              </div>
              <div className="notes-tags-editor" role="group" aria-label="Étiquettes par agent">
                {props.agents.map((a) => {
                  const active = (tags[selected.id] ?? []).includes(a.id)
                  return <button key={a.id} type="button" className={`notes-tag ${active ? "selected" : ""}`} onClick={() => void commitTags(selected.id, active ? (tags[selected.id] ?? []).filter((t) => t !== a.id) : [...(tags[selected.id] ?? []), a.id])}>{a.name}</button>
                })}
              </div>
              <div className="notes-render"><Markdown text={selected.markdown} onWikilink={(target) => { const hit = links.find((l) => l.target === target)?.resolved; if (hit) open(hit) }} /></div>
              {!!links.length && (
                <div className="notes-links">
                  <span className="eyebrow">LIENS SORTANTS</span>
                  {links.map((l) => (
                    <button key={l.target} className={`notes-tag ${l.resolved ? "" : "broken"}`} type="button" disabled={!l.resolved} onClick={() => l.resolved && open(l.resolved)}>{l.target}</button>
                  ))}
                </div>
              )}
              {!!backs.length && (
                <div className="notes-links">
                  <span className="eyebrow">RÉFÉRENCÉE PAR</span>
                  {backs.map((id) => (
                    <button key={id} className="notes-tag" type="button" onClick={() => open(id)}>{id}</button>
                  ))}
                </div>
              )}
            </>
          ) : (
            <div className="empty-state">
              <div className="empty-symbol"><Icon name="pencil" size={24} /></div>
              <h2>Sélectionne une note</h2>
              <p>L'arbre à gauche liste tes dossiers et notes — glisse une note sur un dossier pour la déplacer.</p>
            </div>
          )}
        </article>
      </div>
    </div></div>
  )
}
