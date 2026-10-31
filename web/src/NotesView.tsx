import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { api } from "./api"
import Markdown from "./Markdown"
import NoteEditor from "./NoteEditor"
import { Icon } from "./icons"
import InstrumentFrame, { type InstrumentAction } from "./InstrumentFrame"
import type { Note, NoteHighlight, NoteLink, NoteSearchHit, NoteTreeEntry } from "./types"
import { stripLeadingTitle } from "./note-display"
// v12.6.0 : le retrait immédiat d'une note est une récursion pure, testée sans
// React (tests/notes-tree.test.mjs).
import { pruneNote } from "./notes-tree"
import { displayPath } from "./display-path"
import { buildNoteTemplate, NOTE_TEMPLATES } from "./note-templates"

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
  // v12.8.0 : étiquettes de contenu, indépendantes des agents affectés.
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [labels, setLabels] = useState<Record<string, string[]>>({})
  const [labelDraft, setLabelDraft] = useState("")
  const [editingLabels, setEditingLabels] = useState<string[] | null>(null)
  const [focusMode, setFocusMode] = useState(false)
  const [highlights, setHighlights] = useState<NoteHighlight[]>([])
  const [highlightsOpen, setHighlightsOpen] = useState(false)
  const [selectedQuote, setSelectedQuote] = useState("")
  const [highlightNotice, setHighlightNotice] = useState("")
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

  // v12.8.0 : les highlights sont une bibliothèque de citations avec provenance.
  useEffect(() => {
    let active = true
    api.noteHighlights().then((items) => { if (active) setHighlights(items) }).catch((e) => props.onError(e))
    return () => { active = false }
  }, [props.onError])

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

  // v10.5.0 : toutes les étiquettes sont chargées en un seul appel IPC, pas un appel
  // par note. On filtre sur l'arbre courant pour ignorer d'éventuelles métadonnées orphelines.
  useEffect(() => {
    let stop = false
    const ids = new Set<string>()
    const walk = (nodes: NoteTreeEntry[]) => { for (const node of nodes) { if (node.type === "note") ids.add(node.id); else walk(node.children) } }
    walk(tree)
    api.noteTagsAll()
      .then((all) => { if (!stop) setTags(Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)))) })
      .catch(() => { if (!stop) setTags({}) })
    api.noteLabelsAll()
      .then((all) => { if (!stop) setLabels(Object.fromEntries(Object.entries(all).filter(([id]) => ids.has(id)))) })
      .catch(() => { if (!stop) setLabels({}) })
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

  const open = (id: string) => {
    setSelectedId(id)
    setEditing(null)
    setEditingTags(null)
    setEditingLabels(null)
    setLabelDraft("")
    setSelectedQuote("")
    setHighlightNotice("")
  }

  const togglePin = async (id: string) => {
    try { setPinned(await api.noteTogglePin(id)) } catch (e) { props.onError(e) }
  }

  const commitTags = async (id: string, next: string[]) => {
    try { const saved = await api.noteSetTags(id, next); setTags((t) => ({ ...t, [id]: saved })) } catch (e) { props.onError(e) }
  }

  // v12.8.0 : les étiquettes décrivent le sujet ; les tags existants désignent les agents liés.
  const commitLabels = async (id: string, next: string[]) => {
    try {
      const saved = await api.noteSetLabels(id, next)
      setLabels((current) => ({ ...current, [id]: saved }))
      hitsCache.current.clear()
      const currentQuery = query.trim()
      if (currentQuery) {
        const hits = await api.noteSearch(currentQuery)
        hitsCache.current.set(currentQuery, hits)
        setHits(hits)
      }
    } catch (e) { props.onError(e) }
  }

  const captureSelection = () => {
    const quote = window.getSelection()?.toString().replace(/\\s+/g, " ").trim() ?? ""
    setSelectedQuote(quote.slice(0, 2000))
  }

  const saveHighlight = async () => {
    if (!selected || !selectedQuote.trim()) return
    try {
      const saved = await api.noteHighlightAdd(selected.id, selected.title, selectedQuote)
      setHighlights((items) => [saved, ...items.filter((item) => item.id !== saved.id)])
      setSelectedQuote("")
      window.getSelection()?.removeAllRanges()
      setHighlightNotice("Extrait ajouté à la bibliothèque.")
    } catch (e) { props.onError(e) }
  }

  const removeHighlight = async (id: string) => {
    try {
      await api.noteHighlightDelete(id)
      setHighlights((items) => items.filter((item) => item.id !== id))
    } catch (e) { props.onError(e) }
  }

  const addLabel = (id: string, raw: string) => {
    const value = raw.trim()
    if (!value) return
    void commitLabels(id, [...(labels[id] ?? []), value])
    setLabelDraft("")
  }

  const labelInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>, id: string) => {
    if (event.key !== "Enter" && event.key !== ",") return
    event.preventDefault()
    addLabel(id, labelDraft)
  }

  const startEdit = (note?: Note) => {
    if (note) {
      setEditing({ id: note.id, title: note.title, markdown: note.markdown })
      setEditingLabels(null)
    } else {
      setEditing({ id: "", title: "", markdown: "" })
      setEditingTags(props.currentAgent ? [props.currentAgent] : [])
      setEditingLabels([])
    }
  }

  // v12.8.0 : les modèles sont des points de départ, entièrement modifiables.
  const startFromTemplate = (id: string) => {
    const generated = buildNoteTemplate(id)
    if (!generated) return
    setEditing({ id: "", title: generated.title, markdown: generated.markdown })
    setEditingTags(props.currentAgent ? [props.currentAgent] : [])
    setEditingLabels([])
    setSelectedId(undefined)
  }

  const renameFolder = async (folder: string) => {
    const currentName = folder.split("/").pop() ?? folder
    const nextName = window.prompt("Nouveau nom du dossier :", currentName)?.trim()
    if (!nextName || nextName === currentName || nextName.includes("/")) return
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : ""
    const target = parent ? parent + "/" + nextName : nextName
    try {
      await api.noteRenameFolder(folder, target)
      if (selectedId && (selectedId === folder || selectedId.startsWith(folder + "/"))) {
        setSelectedId(target + selectedId.slice(folder.length))
      }
      reload()
    } catch (e) { props.onError(e) }
  }

  const removeFolder = async (folder: string) => {
    const name = folder.split("/").pop() ?? folder
    if (!window.confirm("Déplacer le dossier « " + name + " » et son contenu vers la poubelle ?")) return
    try {
      await api.noteDeleteFolder(folder)
      if (selectedId?.startsWith(folder + "/")) {
        setSelectedId(undefined)
        setSelected(null)
        setLinks([])
        setBacks([])
      }
      reload()
    } catch (e) { props.onError(e) }
  }

  const commitEdit = async () => {
    if (!editing) return
    try {
      const saved = await api.noteSave(editing.id, editing.title, editing.markdown)
      reload()
      setSelectedId(saved.id)
      if (editingTags && editing.id === "") await commitTags(saved.id, editingTags)
      if (editingLabels && editing.id === "") await commitLabels(saved.id, editingLabels)
      setEditing(null); setEditingTags(null); setEditingLabels(null)
    } catch (e) { props.onError(e) }
  }

  // v12.6.0 : supprimer, archiver ou purger retire la note de la VUE tout de
  // suite. Avant, l'arbre ne se rechargeait qu'après l'aller-retour IPC et la
  // note restait affichée à droite (`selected` gardait sa copie) : il fallait
  // changer de page pour la voir disparaître. La donnée fait foi — l'état local
  // est retiré immédiatement, puis confirmé par le rechargement du disque.
  const dropFromView = (id: string) => {
    setTree((nodes) => pruneNote(nodes, id))
    setTrash((list) => list.filter((n) => n.id !== id))
    setArchived((list) => list.filter((n) => n.id !== id))
    setHits((list) => list.filter((h) => h.id !== id))
    setSelectedId((current) => {
      if (current !== id) return current
      setSelected(null)
      setLinks([])
      setBacks([])
      return undefined
    })
  }

  const withNote = async (fn: () => Promise<unknown>, removedId?: string) => {
    try {
      await fn()
      if (removedId) dropFromView(removedId)
      reload()
    } catch (e) { props.onError(e) }
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
    if (purgeArmed === id) { setPurgeArmed(null); void withNote(() => api.notePurge(id), id); return }
    setPurgeArmed(id)
    purgeTimer.current = window.setTimeout(() => setPurgeArmed(null), 4000)
  }

  const attach = (note: Note, analyse: boolean) => {
    props.onCompose(analyse
      ? `Analyse ma note « ${note.title} » et propose une synthèse structurée :\n\n${note.markdown}`
      : `Voici ma note « ${note.title} » :\n\n${note.markdown}`)
  }

  const tagName = (tag: string) => props.agents.find((a) => a.id === tag)?.name ?? tag
  const activeAgentName = props.currentAgent === "projet" ? "l’agent principal Aven" : props.agents.find((a) => a.id === props.currentAgent)?.name ?? "agent actif"
  const allTags = useMemo(() => [...new Set(Object.values(tags).flat())].sort((a, b) => a.localeCompare(b, "fr")), [tags])
  const allLabels = useMemo(() => [...new Set(Object.values(labels).flat())].sort((a, b) => a.localeCompare(b, "fr")), [labels])
  const visibleNote = (node: NoteTreeEntry): boolean => {
    if (node.type === "note") {
      return (!tagFilter || (tags[node.id] ?? []).includes(tagFilter))
        && (!labelFilter || (labels[node.id] ?? []).includes(labelFilter))
    }
    // Quand un filtre est actif, on masque aussi les dossiers sans résultat.
    return !tagFilter && !labelFilter ? true : node.children.some(visibleNote)
  }
  const hasVisibleEntries = tree.some(visibleNote)

  const renderNoteRow = (entry: NoteTreeEntry & { type: "note" }) => (
    <div key={entry.id} className={`notes-tree-row ${selectedId === entry.id ? "selected" : ""}`} data-note-id={entry.id} draggable
      onDragStart={() => setDragId(entry.id)} onDragEnd={() => setDragId(null)}>
      <button className="notes-tree-item" onClick={() => open(entry.id)} type="button" title={entry.id}>
        <Icon name="file" size={14} />
        {/* v10.2.2 : l'emoji 📌 violait la règle « icônes = <Icon> » et brouillait la lecture. */}
        {pinned.includes(entry.id) && <Icon name="pin" size={12} className="notes-pin" />}
        <span>{entry.title}</span>
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
          <div className="notes-tree-folder-head">
            <button className="notes-tree-item folder" onClick={() => setCollapsed((c) => ({ ...c, [n.id]: !c[n.id] }))} type="button" aria-expanded={!isCollapsed}>
              <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={12} />
              <Icon name="folder" size={14} />
              <span>{n.name}</span>
            </button>
            <div className="notes-folder-actions">
              <button className="button ghost note-folder-action" type="button" onClick={(event) => { event.stopPropagation(); void renameFolder(n.id) }} aria-label={`Renommer le dossier ${n.name}`} title="Renommer le dossier"><Icon name="pencil" size={12} /></button>
              <button className="button ghost note-folder-action" type="button" onClick={(event) => { event.stopPropagation(); void removeFolder(n.id) }} aria-label={`Mettre le dossier ${n.name} à la poubelle`} title="Mettre le dossier à la poubelle"><Icon name="trash" size={12} /></button>
            </div>
          </div>
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
    const containerBtn = noteRow.closest<HTMLElement>(".notes-tree-folder")?.querySelector<HTMLElement>(":scope > .notes-tree-folder-head > .notes-tree-item")
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

  // v11.0.0 : l'instrument déclare SES actions ; la sortie est l'onglet voisin.
  const pageActions: InstrumentAction[] = [
    { key: "focus", label: focusMode ? "Quitter le mode concentration" : "Mode concentration", icon: focusMode ? "minimize" : "maximize", onClick: () => setFocusMode((value) => !value) },
    { key: "dir", label: "Ouvrir le dossier", icon: "folder", onClick: () => { api.noteOpenFolder().catch((e) => props.onError(e)) }, title: dir },
  ]

  return (
    <InstrumentFrame
      compact
      eyebrow="NOTES"
      title="Notes de l'espace"
      description={<>
        <p>De vrais fichiers Markdown sur ton PC — dossiers, liens [[note]], poubelle. Glisse une note sur un dossier, ou Alt+↑↓ au clavier.</p>
        <p><code className="hint">{displayPath(dir) || "…"}</code></p>
      </>}
      actions={pageActions}
      toolbarLabel="Actions des notes"
      bodyClassName="notes-body notes-dialog"
    >
      <div className={`notes-layout${focusMode ? " focus-mode" : ""}`}>
        <aside className="notes-list-panel">
          <div className="row notes-actions-row">
            <input className="settings-input" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Rechercher… (global)" aria-label="Rechercher dans les notes" />
            {/* v11.0.1 : boutons icône seuls — le title ne remplace pas un nom accessible (§12.1). */}
            <button className="button secondary" type="button" onClick={() => void quickCapture()} title="Capture rapide (dans Inbox)" aria-label="Capture rapide dans Inbox"><Icon name="inbox" size={14} /></button>
            <button className="button secondary" type="button" onClick={() => void createFolder()} title="Nouveau dossier" aria-label="Nouveau dossier"><Icon name="folder" size={14} /></button>
            <select className="settings-input notes-template-select" aria-label="Créer depuis un modèle" defaultValue="" onChange={(event) => { if (event.currentTarget.value) startFromTemplate(event.currentTarget.value); event.currentTarget.value = "" }}>
              <option value="">Modèles…</option>
              {NOTE_TEMPLATES.map((template) => <option key={template.id} value={template.id}>{template.label}</option>)}
            </select>
            <button className="button primary" type="button" onClick={() => startEdit()} title="Nouvelle note"><Icon name="plus" size={14} />Nouvelle</button>
          </div>
          {!!allLabels.length && (
            <div className="notes-tags-filter" role="group" aria-label="Filtrer par étiquette">
              <span className="eyebrow">ÉTIQUETTES</span>
              <button className={`notes-tag ${labelFilter === null ? "selected" : ""}`} onClick={() => setLabelFilter(null)} type="button">Toutes</button>
              {allLabels.map((label) => <button key={label} className={`notes-tag ${labelFilter === label ? "selected" : ""}`} onClick={() => setLabelFilter(labelFilter === label ? null : label)} type="button">{label}</button>)}
            </div>
          )}
          {!!allTags.length && (
            <div className="notes-tags-filter" role="group" aria-label="Filtrer par agent">
              <span className="eyebrow">AGENTS</span>
              <button className={`notes-tag ${tagFilter === null ? "selected" : ""}`} onClick={() => setTagFilter(null)} type="button">Tous</button>
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
            {!hasVisibleEntries && <p className="hint">{tagFilter || labelFilter ? "Aucune note ne correspond à ces filtres." : "Aucune note — crée la première."}</p>}
          </div>
          <div className="notes-tree-sections">
            <button className="notes-tree-item folder" onClick={() => { setTrashOpen((v) => !v); if (!trashOpen) api.noteTrash().then(setTrash).catch(() => undefined) }} type="button">
              <Icon name="trash" size={14} /><span>Poubelle ({trashOpen ? trash.length : "?"})</span>
            </button>
            {trashOpen && trash.map((n) => (
              <div key={n.id} className="notes-tree-row">
                <button className="notes-tree-item" onClick={() => open(n.id)} type="button" title={n.id}><Icon name="file" size={14} /><span>{n.title}</span></button>
                <button className="button ghost note-row-action" onClick={() => void withNote(() => api.noteRestore(n.id))} type="button" title="Restaurer"><Icon name="restore" size={14} /></button>
                <button className={`button ghost note-row-action${purgeArmed === n.id ? " armed" : ""}`} onClick={() => purgeNote(n.id)} type="button" title={purgeArmed === n.id ? "Confirmer : supprimer définitivement" : "Supprimer définitivement"} aria-label={purgeArmed === n.id ? "Confirmer : supprimer définitivement" : "Supprimer définitivement"}><Icon name="trash" size={14} /></button>
              </div>
            ))}
            <button className="notes-tree-item folder" onClick={() => { setArchiveOpen((v) => !v); if (!archiveOpen) api.noteArchived().then(setArchived).catch(() => undefined) }} type="button">
              <Icon name="archive" size={14} /><span>Archive ({archiveOpen ? archived.length : "?"})</span>
            </button>
            {archiveOpen && archived.map((n) => (
              <div key={n.id} className="notes-tree-row">
                <button className="notes-tree-item" onClick={() => open(n.id)} type="button" title={n.id}><Icon name="file" size={14} /><span>{n.title}</span></button>
                <button className="button ghost note-row-action" onClick={() => void withNote(() => api.noteUnarchive(n.id))} type="button" title="Restaurer"><Icon name="restore" size={14} /></button>
              </div>
            ))}
            <button className="notes-tree-item folder" type="button" aria-expanded={highlightsOpen} onClick={() => setHighlightsOpen((value) => !value)}>
              <Icon name={highlightsOpen ? "chevron-down" : "chevron-right"} size={12} /><Icon name="quote" size={14} /><span>Highlights ({highlights.length})</span>
            </button>
            {highlightsOpen && highlights.map((item) => (
              <div key={item.id} className="notes-highlight-row">
                <button className="notes-highlight-open" type="button" onClick={() => open(item.noteId)} title={`Ouvrir : ${item.noteTitle}`}>
                  <span>{item.quote}</span>
                  <small>{item.noteTitle || item.noteId}</small>
                </button>
                <button className="button ghost note-row-action" type="button" onClick={() => void removeHighlight(item.id)} aria-label="Supprimer ce highlight" title="Supprimer ce highlight"><Icon name="close" size={12} /></button>
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
                <button className="button ghost" type="button" onClick={() => { setEditing(null); setEditingTags(null); setEditingLabels(null); setLabelDraft("") }}>Annuler</button>
                {editing.id === "" && editingTags && (
                  <span className="notes-tag-picker" role="group" aria-label="Agents liés à la nouvelle note">
                    {props.agents.map((a) => (
                      <button key={a.id} type="button" className={`notes-tag ${editingTags.includes(a.id) ? "selected" : ""}`} onClick={() => setEditingTags(editingTags.includes(a.id) ? editingTags.filter((t) => t !== a.id) : [...editingTags, a.id])}>{a.name}</button>
                    ))}
                  </span>
                )}
                {editing.id === "" && editingLabels && (
                  <label className="notes-new-labels">
                    <span className="eyebrow">ÉTIQUETTES</span>
                    <input className="settings-input" placeholder="Ajouter une étiquette puis Entrée" value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} onKeyDown={(event) => {
                      if ((event.key === "Enter" || event.key === ",") && labelDraft.trim()) {
                        event.preventDefault()
                        setEditingLabels([...new Set([...editingLabels, labelDraft.trim()])])
                        setLabelDraft("")
                      }
                    }} />
                    <span className="notes-label-chips">
                      {editingLabels.map((label) => <button key={label} className="notes-tag selected" type="button" onClick={() => setEditingLabels(editingLabels.filter((item) => item !== label))}>{label} ×</button>)}
                    </span>
                  </label>
                )}
              </div>
            </div>
          ) : selected ? (
            <>
              <span className="eyebrow">APERÇU</span>
              <h4>{selected.title}</h4>
              <div className="notes-toolbar">
                <button className="button ghost" onClick={() => void togglePin(selected.id)} type="button">{pinned.includes(selected.id) ? "Détacher" : "Épingler"}</button>
                <button className="button ghost" onClick={() => startEdit(selected)} type="button"><Icon name="pencil" size={14} />Modifier</button>
                <button className="button ghost" onClick={() => attach(selected, false)} type="button" title={`Prépare un message pour ${activeAgentName}, sans l'envoyer`}><Icon name="paperclip" size={14} />Joindre à {activeAgentName}</button>
                <button className="button ghost" onClick={() => attach(selected, true)} type="button" title={`Prépare une demande de synthèse pour ${activeAgentName}, sans l'envoyer`}><Icon name="wand" size={14} />Demander une synthèse à {activeAgentName}</button>
                <details className="notes-secondary-actions">
                  <summary>Autres actions</summary>
                  <div className="notes-secondary-actions-list">
                    <button className="button ghost" onClick={() => void withNote(() => api.noteArchive(selected.id), selected.id)} type="button"><Icon name="archive" size={14} />Archiver</button>
                    <button className="button ghost" onClick={() => void withNote(() => api.noteDelete(selected.id), selected.id)} type="button"><Icon name="trash" size={14} />Poubelle</button>
                    <button className="button ghost" onClick={() => api.noteExport(selected.id).catch((e) => props.onError(e))} type="button">Exporter .md</button>
                  </div>
                </details>
                <button className="button ghost" type="button" disabled={!selectedQuote} onMouseDown={(event) => event.preventDefault()} onClick={() => void saveHighlight()} title={selectedQuote ? "Enregistrer l'extrait sélectionné" : "Sélectionnez d'abord un passage dans la note"}>
                  <Icon name="quote" size={14} />Capturer l'extrait
                </button>
                <span className="hint">{selected.markdown.split(/\s+/).filter(Boolean).length} mots</span>
              </div>
              {highlightNotice && <p className="notes-highlight-notice" role="status">{highlightNotice}</p>}
              <div className="notes-tags-editor" role="group" aria-label="Agents liés à la note">
                <span className="eyebrow">AGENTS LIÉS</span>
                {props.agents.map((a) => {
                  const active = (tags[selected.id] ?? []).includes(a.id)
                  return <button key={a.id} type="button" className={`notes-tag ${active ? "selected" : ""}`} onClick={() => void commitTags(selected.id, active ? (tags[selected.id] ?? []).filter((t) => t !== a.id) : [...(tags[selected.id] ?? []), a.id])}>{a.name}</button>
                })}
              </div>
              <div className="notes-tags-editor notes-labels-editor" role="group" aria-label="Étiquettes de contenu">
                <span className="eyebrow">ÉTIQUETTES</span>
                {(labels[selected.id] ?? []).map((label) => (
                  <button key={label} type="button" className="notes-tag selected" onClick={() => void commitLabels(selected.id, (labels[selected.id] ?? []).filter((item) => item !== label))} aria-label={`Retirer l'étiquette ${label}`}>{label} ×</button>
                ))}
                <input className="settings-input notes-label-input" value={labelDraft} placeholder="Ajouter une étiquette…" onChange={(event) => setLabelDraft(event.target.value)} onKeyDown={(event) => labelInputKeyDown(event, selected.id)} />
                <button className="button secondary notes-label-add" type="button" disabled={!labelDraft.trim()} onClick={() => addLabel(selected.id, labelDraft)}>Ajouter</button>
              </div>
              {/* v10.2.2 : le H1 de tête répétait le titre déjà affiché en h4. */}
              <div className="notes-render" onMouseUp={captureSelection} onKeyUp={captureSelection}><Markdown text={stripLeadingTitle(selected.markdown, selected.title)} onWikilink={(target) => { const hit = links.find((l) => l.target === target)?.resolved; if (hit) open(hit) }} /></div>
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
    </InstrumentFrame>
  )
}
