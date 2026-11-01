import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react"
import { api } from "./api"
import { Icon, type IconName } from "./icons"
import InstrumentFrame from "./InstrumentFrame"
import NoteDocument, { type NoteDraft, type SaveStatus } from "./notes/NoteDocument"
import TemplatePicker from "./notes/TemplatePicker"
import type { NoteTemplate } from "./notes-templates"
import {
  SEARCH_KIND_LABELS,
  flattenTreeNotes,
  localSearchHits,
  mergeLibraryHits,
  noteFolder,
  type HitKind,
  type LibraryHit,
  type SearchKind,
  type TreeNote,
} from "./notes-search"
import { stripLeadingTitle } from "./note-display"
import { pruneNote } from "./notes-tree"
import { displayPath } from "./display-path"
import type { Note, NoteHighlight, NoteLink, NoteSearchHit, NoteTreeEntry } from "./types"

// v12.8.0 : la vue Notes est une bibliothèque et un document, pas un formulaire.
// L'arbre garde les vrais dossiers Markdown ; le document s'ouvre directement et
// s'auto-sauvegarde. Les étiquettes libres, les repères et la recherche locale
// complètent les tags d'agents sans mélanger les deux notions.
type Props = {
  initialId?: string
  autoCapture?: boolean
  onCaptureHandled?: () => void
  agents: { id: string; name: string }[]
  currentAgent?: string
  onCompose: (text: string) => void
  onClose: () => void
  onError: (e: unknown) => void
  workspaceReady?: boolean
}

const AUTOSAVE_MS = 650
const SEARCH_FILTERS: { id: SearchKind; label: string }[] = [
  { id: "all", label: "Tout" },
  { id: "note", label: "Notes" },
  { id: "highlight", label: "Repères" },
  { id: "label", label: "Étiquettes" },
  { id: "agent", label: "Agents" },
]
const HIT_ICONS: Record<HitKind, IconName> = {
  note: "file",
  highlight: "highlight",
  label: "tag",
  agent: "agent",
}

const isReadOnlyId = (id: string) => id.startsWith(".trash/") || id.startsWith(".archive/")

function renameTreeNode(nodes: NoteTreeEntry[], id: string, title: string): NoteTreeEntry[] {
  return nodes.map((node) => {
    if (node.type === "note") return node.id === id ? { ...node, title } : node
    return { ...node, children: renameTreeNode(node.children, id, title) }
  })
}

export default function NotesView(props: Props) {
  const [tree, setTree] = useState<NoteTreeEntry[]>([])
  const [treeLoaded, setTreeLoaded] = useState(false)
  const [dir, setDir] = useState("")
  const [labels, setLabels] = useState<Record<string, string[]>>({})
  const [tags, setTags] = useState<Record<string, string[]>>({})
  const [pinned, setPinned] = useState<string[]>([])
  const [highlights, setHighlights] = useState<NoteHighlight[]>([])
  const [links, setLinks] = useState<NoteLink[]>([])
  const [backs, setBacks] = useState<string[]>([])
  const [draft, setDraft] = useState<NoteDraft | null>(null)
  const [saveStatus, setSaveStatus] = useState<SaveStatus>("idle")
  const [titleFocusToken, setTitleFocusToken] = useState(0)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<NoteSearchHit[]>([])
  const [searchKind, setSearchKind] = useState<SearchKind>("all")
  const [searching, setSearching] = useState(false)
  const [labelFilter, setLabelFilter] = useState<string | null>(null)
  const [tagFilter, setTagFilter] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({})
  const [trashOpen, setTrashOpen] = useState(false)
  const [trash, setTrash] = useState<Note[]>([])
  const [archiveOpen, setArchiveOpen] = useState(false)
  const [archived, setArchived] = useState<Note[]>([])
  const [dragId, setDragId] = useState<string | null>(null)
  const [dropFolder, setDropFolder] = useState<string | null>(null)
  const [purgeArmed, setPurgeArmed] = useState<string | null>(null)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [focusMode, setFocusMode] = useState(false)
  const [libraryOpen, setLibraryOpen] = useState(true)

  const draftRef = useRef<NoteDraft | null>(null)
  const dirtyRef = useRef(false)
  const saveTimer = useRef<number | undefined>(undefined)
  const flushRef = useRef<() => Promise<boolean>>(async () => true)
  const openSeq = useRef(0)
  const purgeTimer = useRef<number | undefined>(undefined)
  const hitsCache = useRef(new Map<string, NoteSearchHit[]>())
  const captureOnce = useRef(false)
  const initialOpened = useRef<string | undefined>(undefined)

  const reload = useCallback(async () => {
    const [nextTree, nextPinned, nextDir, nextLabels, nextTags, nextHighlights, nextTrash, nextArchived] = await Promise.all([
      api.notesTree(),
      api.notePins().catch(() => [] as string[]),
      api.noteDir().catch(() => ""),
      api.noteLabelsAll().catch(() => ({} as Record<string, string[]>)),
      api.noteTagsAll().catch(() => ({} as Record<string, string[]>)),
      api.noteHighlights().catch(() => [] as NoteHighlight[]),
      api.noteTrash().catch(() => [] as Note[]),
      api.noteArchived().catch(() => [] as Note[]),
    ])
    setTree(nextTree)
    setPinned(nextPinned)
    setDir(nextDir)
    setLabels(nextLabels)
    setTags(nextTags)
    setHighlights(nextHighlights)
    setTrash(nextTrash)
    setArchived(nextArchived)
    setTreeLoaded(true)
  }, [])

  const flushDraft = useCallback(async (): Promise<boolean> => {
    if (saveTimer.current !== undefined) {
      window.clearTimeout(saveTimer.current)
      saveTimer.current = undefined
    }
    const current = draftRef.current
    if (!current || !dirtyRef.current) return true
    if (isReadOnlyId(current.id)) {
      dirtyRef.current = false
      return true
    }
    const snapshot = { ...current }
    dirtyRef.current = false
    setSaveStatus("saving")
    try {
      const saved = await api.noteSave(snapshot.id, snapshot.title, snapshot.body)
      setTree((nodes) => renameTreeNode(nodes, snapshot.id, saved.title))
      if (draftRef.current?.id === snapshot.id && !dirtyRef.current) setSaveStatus("saved")
      return true
    } catch (e) {
      dirtyRef.current = true
      setSaveStatus("error")
      props.onError(e)
      return false
    }
  }, [props.onError])
  flushRef.current = flushDraft

  const patchDraft = (patch: Partial<NoteDraft>) => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id)) return
    const next = { ...current, ...patch }
    draftRef.current = next
    setDraft(next)
    dirtyRef.current = true
    setSaveStatus("dirty")
    if (saveTimer.current !== undefined) window.clearTimeout(saveTimer.current)
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = undefined
      void flushRef.current()
    }, AUTOSAVE_MS)
  }

  const openNote = useCallback(async (id: string) => {
    if (!id || props.workspaceReady === false) return
    if (!(await flushDraft())) return
    const seq = ++openSeq.current
    try {
      const note = await api.noteGet(id)
      if (openSeq.current !== seq) return
      const next: NoteDraft = {
        id: note.id,
        title: note.title === "Sans titre" ? "" : note.title,
        body: stripLeadingTitle(note.markdown, note.title),
        folder: noteFolder(note.id),
      }
      draftRef.current = next
      setDraft(next)
      dirtyRef.current = false
      setSaveStatus("saved")
      setLinks([])
      setBacks([])
      if (typeof window !== "undefined" && window.matchMedia("(max-width: 860px)").matches) setLibraryOpen(false)
      const [nextLinks, nextBacks] = await Promise.all([
        api.noteLinks(note.id).catch(() => [] as NoteLink[]),
        api.noteBacklinks(note.id).catch(() => [] as string[]),
      ])
      if (openSeq.current === seq) {
        setLinks(nextLinks)
        setBacks(nextBacks)
      }
    } catch (e) {
      if (openSeq.current === seq) props.onError(e)
    }
  }, [flushDraft, props.onError, props.workspaceReady])

  const createNote = useCallback(async () => {
    if (props.workspaceReady === false) return
    if (!(await flushDraft())) return
    try {
      const note = await api.noteSave("", "", "")
      setQuery("")
      await reload()
      await openNote(note.id)
      setTitleFocusToken((value) => value + 1)
    } catch (e) { props.onError(e) }
  }, [flushDraft, openNote, props.onError, props.workspaceReady, reload])

  const quickCapture = useCallback(async () => {
    if (props.workspaceReady === false) return
    if (!(await flushDraft())) return
    try {
      const note = await api.noteQuickCapture("", "")
      setQuery("")
      await reload()
      await openNote(note.id)
      setTitleFocusToken((value) => value + 1)
    } catch (e) { props.onError(e) }
  }, [flushDraft, openNote, props.onError, props.workspaceReady, reload])

  const createFromTemplate = async (template: NoteTemplate) => {
    setTemplateOpen(false)
    if (props.workspaceReady === false) return
    if (!(await flushDraft())) return
    try {
      const note = await api.noteSave("", template.title, template.markdown)
      setQuery("")
      await reload()
      await openNote(note.id)
    } catch (e) { props.onError(e) }
  }

  const togglePin = async () => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id)) return
    try { setPinned(await api.noteTogglePin(current.id)) } catch (e) { props.onError(e) }
  }

  const addLabel = async (label: string) => {
    const current = draftRef.current
    const value = label.trim()
    if (!current || !value || isReadOnlyId(current.id)) return
    const next = [...new Set([...(labels[current.id] ?? []), value])]
    try {
      const saved = await api.noteSetLabels(current.id, next)
      setLabels((all) => ({ ...all, [current.id]: saved }))
    } catch (e) { props.onError(e) }
  }

  const removeLabel = async (label: string) => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id)) return
    try {
      const saved = await api.noteSetLabels(current.id, (labels[current.id] ?? []).filter((item) => item !== label))
      setLabels((all) => ({ ...all, [current.id]: saved }))
    } catch (e) { props.onError(e) }
  }

  const saveAgents = async (id: string, next: string[]) => {
    try {
      const saved = await api.noteSetTags(id, next)
      setTags((all) => ({ ...all, [id]: saved }))
    } catch (e) { props.onError(e) }
  }

  const toggleAgent = (id: string) => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id)) return
    const active = (tags[current.id] ?? []).includes(id)
    void saveAgents(current.id, active ? (tags[current.id] ?? []).filter((tag) => tag !== id) : [...(tags[current.id] ?? []), id])
  }

  const addAgent = (id: string) => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id) || (tags[current.id] ?? []).includes(id)) return
    void saveAgents(current.id, [...(tags[current.id] ?? []), id])
  }

  const addHighlight = async (quote: string) => {
    const current = draftRef.current
    const text = quote.trim()
    if (!current || !text || isReadOnlyId(current.id)) return
    try {
      const highlight = await api.noteHighlightAdd(current.id, text)
      setHighlights((list) => [highlight, ...list])
    } catch (e) { props.onError(e) }
  }

  const deleteHighlight = async (id: string) => {
    try {
      await api.noteHighlightDelete(id)
      setHighlights((list) => list.filter((highlight) => highlight.id !== id))
    } catch (e) { props.onError(e) }
  }

  const duplicateCurrent = async () => {
    const current = draftRef.current
    if (!current) return
    if (!(await flushDraft())) return
    try {
      const saved = await api.noteSave("", `${current.title || "Sans titre"} (copie)`, current.body)
      const moved = current.folder ? await api.noteMove(saved.id, current.folder) : saved.id
      await reload()
      await openNote(moved)
    } catch (e) { props.onError(e) }
  }

  const exportCurrent = async () => {
    const current = draftRef.current
    if (!current) return
    if (!(await flushDraft())) return
    try { await api.noteExport(current.id) } catch (e) { props.onError(e) }
  }

  const attachCurrent = (synthesis: boolean) => {
    const current = draftRef.current
    if (!current) return
    const markdown = `# ${current.title || "Sans titre"}\n\n${current.body}`.trim()
    props.onCompose(synthesis
      ? `Analyse ma note « ${current.title || "Sans titre"} » et propose une synthèse structurée :\n\n${markdown}`
      : `Voici ma note « ${current.title || "Sans titre"} » :\n\n${markdown}`)
  }

  const moveNote = async (id: string, folder: string) => {
    if (!id || isReadOnlyId(id)) return
    if (draftRef.current?.id === id && !(await flushDraft())) return
    try {
      const moved = await api.noteMove(id, folder)
      await reload()
      if (draftRef.current?.id === id) await openNote(moved)
    } catch (e) { props.onError(e) }
  }

  const handleDrop = async (folder: string) => {
    setDropFolder(null)
    const id = dragId
    setDragId(null)
    if (!id) return
    await moveNote(id, folder)
  }

  const createFolder = async () => {
    const name = window.prompt("Nom du nouveau dossier :")
    if (!name || !name.trim()) return
    try {
      const folder = await api.noteCreateFolder(name.trim())
      await reload()
      setCollapsed((current) => {
        const next = { ...current }
        const parts = folder.split("/")
        for (let index = 1; index <= parts.length; index += 1) next[parts.slice(0, index).join("/")] = false
        return next
      })
    } catch (e) { props.onError(e) }
  }

  const renameFolder = async (folder: string) => {
    const current = draftRef.current
    if (!(await flushDraft())) return
    const name = window.prompt("Renommer le dossier", folder.split("/").pop() ?? folder)
    if (!name || !name.trim()) return
    const parent = folder.includes("/") ? folder.slice(0, folder.lastIndexOf("/")) : ""
    const target = parent ? `${parent}/${name.trim()}` : name.trim()
    if (target === folder) return
    try {
      const renamed = await api.noteRenameFolder(folder, target)
      await reload()
      if (current && current.id.startsWith(`${folder}/`)) {
        await openNote(`${renamed}/${current.id.slice(folder.length + 1)}`)
      }
    } catch (e) { props.onError(e) }
  }

  const deleteFolder = async (folder: string) => {
    if (!window.confirm(`Déplacer « ${folder} » et ses notes dans la corbeille ?`)) return
    const current = draftRef.current
    if (!(await flushDraft())) return
    try {
      await api.noteDeleteFolder(folder)
      if (current && current.id.startsWith(`${folder}/`)) {
        draftRef.current = null
        setDraft(null)
        setLinks([])
        setBacks([])
      }
      await reload()
    } catch (e) { props.onError(e) }
  }

  const dropFromView = (id: string) => {
    setTree((nodes) => pruneNote(nodes, id))
    setTrash((list) => list.filter((note) => note.id !== id))
    setArchived((list) => list.filter((note) => note.id !== id))
    setHits((list) => list.filter((hit) => hit.id !== id))
    if (draftRef.current?.id === id) {
      draftRef.current = null
      setDraft(null)
      setLinks([])
      setBacks([])
      dirtyRef.current = false
      setSaveStatus("idle")
    }
  }

  const archiveCurrent = async () => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id)) return
    if (!(await flushDraft())) return
    try {
      await api.noteArchive(current.id)
      dropFromView(current.id)
      await reload()
    } catch (e) { props.onError(e) }
  }

  const deleteCurrent = async () => {
    const current = draftRef.current
    if (!current || isReadOnlyId(current.id)) return
    if (!(await flushDraft())) return
    try {
      await api.noteDelete(current.id)
      dropFromView(current.id)
      await reload()
    } catch (e) { props.onError(e) }
  }

  const restoreNote = async (id: string) => {
    try {
      const restored = await api.noteRestore(id)
      await reload()
      await openNote(restored)
    } catch (e) { props.onError(e) }
  }

  const unarchiveNote = async (id: string) => {
    try {
      const restored = await api.noteUnarchive(id)
      await reload()
      await openNote(restored)
    } catch (e) { props.onError(e) }
  }

  const purgeNote = async (id: string) => {
    try {
      await api.notePurge(id)
      setHighlights((list) => list.filter((highlight) => highlight.noteId !== id))
      dropFromView(id)
      await reload()
    } catch (e) { props.onError(e) }
  }

  const armPurge = (id: string) => {
    window.clearTimeout(purgeTimer.current)
    if (purgeArmed === id) {
      setPurgeArmed(null)
      void purgeNote(id)
      return
    }
    setPurgeArmed(id)
    purgeTimer.current = window.setTimeout(() => setPurgeArmed(null), 4000)
  }

  const revealFolder = (folder: string) => {
    setLibraryOpen(true)
    setQuery("")
    setSearchKind("all")
    setLabelFilter(null)
    setTagFilter(null)
    setCollapsed((current) => {
      const next = { ...current }
      const parts = folder.split("/")
      for (let index = 1; index <= parts.length; index += 1) next[parts.slice(0, index).join("/")] = false
      return next
    })
  }

  const openDir = () => {
    api.noteOpenFolder().then(setDir).catch((e) => props.onError(e))
  }

  useEffect(() => {
    if (props.workspaceReady === false) { setTreeLoaded(true); return }
    let stop = false
    void reload().catch((e) => {
      if (!stop) {
        setTreeLoaded(true)
        props.onError(e)
      }
    })
    return () => { stop = true }
  }, [reload, props.workspaceReady, props.onError])

  useEffect(() => {
    if (!props.initialId || !treeLoaded || props.workspaceReady === false) return
    if (initialOpened.current === props.initialId) return
    initialOpened.current = props.initialId
    void openNote(props.initialId)
  }, [props.initialId, treeLoaded, props.workspaceReady, openNote])

  useEffect(() => {
    if (!props.autoCapture || captureOnce.current) return
    captureOnce.current = true
    void quickCapture()
    props.onCaptureHandled?.()
  }, [props.autoCapture, quickCapture, props.onCaptureHandled])

  useEffect(() => {
    const q = query.trim()
    if (props.workspaceReady === false || !q) {
      setHits([])
      setSearching(false)
      return
    }
    const cached = hitsCache.current.get(q)
    if (cached) {
      setHits(cached)
      setSearching(false)
      return
    }
    let stop = false
    setSearching(true)
    setHits([])
    const timer = window.setTimeout(() => {
      api.noteSearch(q)
        .then((result) => {
          if (stop) return
          hitsCache.current.set(q, result)
          setHits(result)
          setSearching(false)
        })
        .catch(() => { if (!stop) { setHits([]); setSearching(false) } })
    }, q.length <= 1 ? 0 : 120)
    return () => { stop = true; window.clearTimeout(timer) }
  }, [query, props.workspaceReady])

  useEffect(() => {
    const flush = () => { if (dirtyRef.current) void flushRef.current() }
    const onVisibility = () => { if (document.visibilityState === "hidden") flush() }
    window.addEventListener("blur", flush)
    document.addEventListener("visibilitychange", onVisibility)
    return () => {
      window.removeEventListener("blur", flush)
      document.removeEventListener("visibilitychange", onVisibility)
      if (saveTimer.current !== undefined) {
        window.clearTimeout(saveTimer.current)
        saveTimer.current = undefined
      }
      void flushRef.current()
    }
  }, [])

  useEffect(() => () => window.clearTimeout(purgeTimer.current), [])
  useEffect(() => { if (!draft) setFocusMode(false) }, [draft])

  const agentNames = useMemo(() => Object.fromEntries(props.agents.map((agent) => [agent.id, agent.name])), [props.agents])
  const allNotes = useMemo(() => flattenTreeNotes(tree), [tree])
  const visibleNote = (note: { id: string }) =>
    (!labelFilter || (labels[note.id] ?? []).includes(labelFilter)) &&
    (!tagFilter || (tags[note.id] ?? []).includes(tagFilter))
  const visibleNotes = useMemo(
    () => allNotes.filter((note) => visibleNote(note)),
    [allNotes, labels, tags, labelFilter, tagFilter],
  )
  const recentNotes = useMemo(() => [...visibleNotes].sort((a, b) => b.updated - a.updated).slice(0, 5), [visibleNotes])
  const pinnedNotes = useMemo(
    () => pinned
      .map((id) => allNotes.find((note) => note.id === id))
      .filter((note): note is TreeNote => Boolean(note))
      .filter((note) => visibleNote(note)),
    [pinned, allNotes, labels, tags, labelFilter, tagFilter],
  )
  const allFolders = useMemo(() => {
    const folders: string[] = []
    const walk = (nodes: NoteTreeEntry[]) => {
      for (const node of nodes) {
        if (node.type === "folder") {
          folders.push(node.id)
          walk(node.children)
        }
      }
    }
    walk(tree)
    return folders.sort((a, b) => a.localeCompare(b, "fr"))
  }, [tree])
  const allLabels = useMemo(() => [...new Set(Object.values(labels).flat())].sort((a, b) => a.localeCompare(b, "fr")), [labels])
  const allAgentTags = useMemo(() => [...new Set(Object.values(tags).flat())].sort((a, b) => a.localeCompare(b, "fr")), [tags])
  const localHits = useMemo(() => localSearchHits({
    query,
    notes: allNotes,
    labels,
    agentTags: tags,
    agentNames,
    highlights,
  }), [query, allNotes, labels, tags, agentNames, highlights])
  const mergedHits = useMemo(() => mergeLibraryHits(hits, localHits, searchKind), [hits, localHits, searchKind])
  const searchVisible = query.trim().length > 0
  const currentIndex = draft ? visibleNotes.findIndex((note) => note.id === draft.id) : -1
  const currentArchived = Boolean(draft?.id.startsWith(".archive/"))
  const currentTrashed = Boolean(draft?.id.startsWith(".trash/"))
  const mentionNotes = allNotes.filter((note) => note.id !== draft?.id).map(({ id, title, folder }) => ({ id, title, folder }))
  const tagName = (tag: string) => agentNames[tag] ?? tag
  const activeFilterLabel = labelFilter ?? (tagFilter ? tagName(tagFilter) : "")
  const activeAgentName = props.currentAgent === "projet"
    ? "l'agent principal Aven"
    : props.agents.find((agent) => agent.id === props.currentAgent)?.name ?? "l'agent actif"

  const renderNoteRow = (entry: Extract<NoteTreeEntry, { type: "note" }>) => (
    <div
      key={entry.id}
      className={`notes-tree-row${draft?.id === entry.id ? " selected" : ""}`}
      data-note-id={entry.id}
      draggable
      onDragStart={(event) => {
        setDragId(entry.id)
        event.dataTransfer.setData("text/plain", entry.id)
        event.dataTransfer.effectAllowed = "move"
      }}
      onDragEnd={() => setDragId(null)}
    >
      <button className="notes-tree-item" onClick={() => void openNote(entry.id)} type="button" title={entry.id} aria-current={draft?.id === entry.id ? "page" : undefined}>
        <Icon name="file" size={14} />
        {pinned.includes(entry.id) && <Icon name="pin" size={12} className="notes-pin" />}
        <span>{entry.title || "Sans titre"}</span>
      </button>
    </div>
  )

  const hasVisibleNote = (node: NoteTreeEntry): boolean => {
    if (node.type === "note") return visibleNote(node)
    if (!labelFilter && !tagFilter) return true
    return node.children.some(hasVisibleNote)
  }

  const renderTree = (nodes: NoteTreeEntry[], depth = 0): ReactNode => nodes.filter(hasVisibleNote).map((node) => {
    if (node.type === "note") return renderNoteRow(node)
    const isCollapsed = Boolean(collapsed[node.id])
    return (
      <div
        key={`folder-${node.id}`}
        className={`notes-tree-folder${dropFolder === node.id ? " drop-target" : ""}`}
        data-folder-id={node.id}
        style={{ paddingLeft: depth * 12 }}
        onDragOver={(event) => { event.preventDefault(); event.dataTransfer.dropEffect = "move"; setDropFolder(node.id) }}
        onDragLeave={() => setDropFolder((folder) => (folder === node.id ? null : folder))}
        onDrop={(event) => { event.preventDefault(); void handleDrop(node.id) }}
      >
        <div className="notes-folder-line">
          <button className="notes-tree-item folder" onClick={() => setCollapsed((current) => ({ ...current, [node.id]: !current[node.id] }))} type="button" aria-expanded={!isCollapsed}>
            <Icon name={isCollapsed ? "chevron-right" : "chevron-down"} size={12} />
            <Icon name="folder" size={14} />
            <span>{node.name}</span>
          </button>
          <span className="notes-folder-actions">
            <button className="button ghost note-folder-action" type="button" onClick={() => void renameFolder(node.id)} title="Renommer le dossier" aria-label={`Renommer le dossier ${node.id}`}><Icon name="pencil" size={12} /></button>
            <button className="button ghost note-folder-action" type="button" onClick={() => void deleteFolder(node.id)} title="Mettre le dossier à la corbeille" aria-label={`Mettre le dossier ${node.id} à la corbeille`}><Icon name="trash" size={12} /></button>
          </span>
        </div>
        {!isCollapsed && renderTree(node.children, depth + 1)}
      </div>
    )
  })

  const treeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return
    const rows = Array.from(event.currentTarget.querySelectorAll<HTMLElement>(".notes-tree-item"))
    if (!rows.length) return
    event.preventDefault()
    const active = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const current = active ? rows.indexOf(active) : -1
    if (!event.altKey) {
      const next = current < 0 ? rows[0] : rows[Math.min(rows.length - 1, Math.max(0, current + (event.key === "ArrowDown" ? 1 : -1)))]
      next.focus()
      return
    }
    const noteRow = current >= 0 ? rows[current].closest<HTMLElement>(".notes-tree-row") : null
    const noteId = noteRow?.dataset.noteId
    if (!noteRow || !noteId) return
    const folderIdOf = (button: HTMLElement) => button.closest<HTMLElement>(".notes-tree-folder")?.dataset.folderId ?? ""
    const containerBtn = noteRow.closest<HTMLElement>(".notes-tree-folder")?.querySelector<HTMLElement>(":scope > .notes-folder-line > .notes-tree-item") ?? null
    const folders = rows.filter((row) => row.classList.contains("folder"))
    const before = folders.filter((folder) => (folder.compareDocumentPosition(noteRow) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0 && folder !== containerBtn)
    const after = folders.filter((folder) => (folder.compareDocumentPosition(noteRow) & Node.DOCUMENT_POSITION_PRECEDING) !== 0)
    const target = event.key === "ArrowUp"
      ? (before.length ? folderIdOf(before[before.length - 1]) : "")
      : (after.length ? folderIdOf(after[0]) : undefined)
    if (target === undefined) return
    void moveNote(noteId, target)
  }

  const openHit = (hit: LibraryHit) => {
    void openNote(hit.kind === "highlight" ? (hit.noteId ?? hit.id) : hit.id)
  }

  return (
    <InstrumentFrame
      compact
      eyebrow="NOTES"
      title="Notes de l'espace"
      className={`notes-instrument${focusMode ? " notes-focus-instrument" : ""}`}
      bodyClassName="notes-body notes-dialog"
    >
      <div className={`notes-app${focusMode ? " notes-focus" : ""}`}>
        {props.workspaceReady === false ? (
          <div className="notes-empty notes-empty-workspace">
            <div className="notes-empty-symbol"><Icon name="folder" size={24} /></div>
            <span className="eyebrow">BIBLIOTHÈQUE</span>
            <h2>Aucun espace de travail</h2>
            <p>Choisis un espace pour retrouver ses notes Markdown et écrire.</p>
          </div>
        ) : !treeLoaded ? (
          <div className="notes-loading" role="status">Chargement de la bibliothèque…</div>
        ) : (
          <div className={`notes-layout${libraryOpen ? " library-open" : ""}`}>
            <aside className="notes-library" aria-label="Bibliothèque de notes">
              <div className="notes-library-head">
                <div className="notes-search">
                  <Icon name="search" size={14} />
                  <input
                    className="notes-search-input"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Rechercher dans la bibliothèque…"
                    aria-label="Rechercher dans les notes"
                    type="search"
                  />
                  {query && <button className="button ghost note-search-clear" type="button" onClick={() => setQuery("")} aria-label="Effacer la recherche" title="Effacer la recherche"><Icon name="close" size={12} /></button>}
                </div>
                <button className="button ghost note-icon notes-library-toggle" type="button" onClick={() => setLibraryOpen(false)} aria-label="Masquer la bibliothèque" title="Masquer la bibliothèque"><Icon name="panel" size={15} /></button>
              </div>

              <div className="notes-primary-actions">
                <button className="button primary notes-new-button" type="button" onClick={() => void createNote()}><Icon name="plus" size={14} />Nouvelle note</button>
                <button className="button secondary" type="button" onClick={() => void quickCapture()}><Icon name="inbox" size={14} />Capture</button>
                <button className="button ghost" type="button" onClick={() => setTemplateOpen(true)}><Icon name="template" size={14} />Modèle</button>
              </div>

              {(labelFilter || tagFilter) && (
                <div className="notes-filter-active">
                  <span>Filtre : <strong>{activeFilterLabel}</strong></span>
                  <button className="button ghost" type="button" onClick={() => { setLabelFilter(null); setTagFilter(null) }}>Effacer</button>
                </div>
              )}

              <div className="notes-library-scroll">
                {searchVisible ? (
                  <section className="notes-search-results" aria-label="Résultats de recherche">
                    <div className="notes-search-heading">
                      <span className="eyebrow">RÉSULTATS</span>
                      {searching && <span className="notes-searching">Recherche…</span>}
                    </div>
                    <div className="notes-search-kinds" role="group" aria-label="Filtrer les résultats">
                      {SEARCH_FILTERS.map((filter) => (
                        <button key={filter.id} className={`notes-tag${searchKind === filter.id ? " selected" : ""}`} type="button" aria-pressed={searchKind === filter.id} onClick={() => setSearchKind(filter.id)}>{filter.label}</button>
                      ))}
                    </div>
                    {mergedHits.length > 0 ? mergedHits.map((hit) => (
                      <button key={hit.key} className="notes-result" type="button" onClick={() => openHit(hit)} title={`${hit.title} — ${hit.typeLabel}`}>
                        <Icon name={HIT_ICONS[hit.kind]} size={14} />
                        <span className="notes-result-copy">
                          <strong>{hit.title}</strong>
                          <small>{hit.snippet || hit.folder || SEARCH_KIND_LABELS[hit.kind]}</small>
                        </span>
                        <span className="notes-result-kind">{hit.typeLabel}</span>
                      </button>
                    )) : !searching && <p className="notes-side-empty">Aucun résultat dans cette bibliothèque.</p>}
                  </section>
                ) : (
                  <>
                    {recentNotes.length > 0 && (
                      <section className="notes-side-section">
                        <div className="notes-side-heading"><span className="eyebrow">RÉCENTES</span><span className="notes-count">{recentNotes.length}</span></div>
                        {recentNotes.map((note) => (
                          <button key={note.id} className="notes-recent-row" type="button" aria-current={draft?.id === note.id ? "page" : undefined} onClick={() => void openNote(note.id)} title={note.id}>
                            <Icon name="file" size={14} />
                            <span className="notes-recent-copy"><strong>{note.title || "Sans titre"}</strong><small>{note.folder || "Bibliothèque"}</small></span>
                          </button>
                        ))}
                      </section>
                    )}

                    {pinnedNotes.length > 0 && (
                      <section className="notes-side-section">
                        <div className="notes-side-heading"><span className="eyebrow">ÉPINGLÉES</span><span className="notes-count">{pinnedNotes.length}</span></div>
                        {pinnedNotes.map((note) => (
                          <button key={note.id} className="notes-recent-row" type="button" aria-current={draft?.id === note.id ? "page" : undefined} onClick={() => void openNote(note.id)} title={note.id}>
                            <Icon name="pin" size={14} />
                            <span className="notes-recent-copy"><strong>{note.title || "Sans titre"}</strong><small>{note.folder || "Bibliothèque"}</small></span>
                          </button>
                        ))}
                      </section>
                    )}

                    <section className="notes-side-section notes-folders-section">
                      <div className="notes-side-heading">
                        <span className="eyebrow">DOSSIERS</span>
                        <span className="notes-count">{allNotes.length}</span>
                        <button className="button ghost note-side-icon" type="button" onClick={() => void createFolder()} aria-label="Nouveau dossier" title="Nouveau dossier"><Icon name="plus" size={14} /></button>
                      </div>
                      {tree.length ? (
                        <div className="notes-tree" role="tree" aria-label="Dossiers et notes" title="Glisse une note sur un dossier, ou Alt+↑↓ au clavier" onKeyDown={treeKeyDown} aria-keyshortcuts="Alt+ArrowUp Alt+ArrowDown">
                          {renderTree(tree)}
                        </div>
                      ) : (
                        <p className="notes-side-empty">Aucune note — crée la première.</p>
                      )}
                    </section>

                    {allLabels.length > 0 && (
                      <section className="notes-side-section">
                        <div className="notes-side-heading"><span className="eyebrow">ÉTIQUETTES</span></div>
                        <div className="notes-filter-chips">
                          {allLabels.map((label) => (
                            <button key={label} className={`notes-tag${labelFilter === label ? " selected" : ""}`} type="button" aria-pressed={labelFilter === label} onClick={() => setLabelFilter(labelFilter === label ? null : label)}>{label}</button>
                          ))}
                        </div>
                      </section>
                    )}

                    {allAgentTags.length > 0 && (
                      <section className="notes-side-section">
                        <div className="notes-side-heading"><span className="eyebrow">AGENTS</span></div>
                        <div className="notes-filter-chips">
                          {allAgentTags.map((tag) => (
                            <button key={tag} className={`notes-tag${tagFilter === tag ? " selected" : ""}`} type="button" aria-pressed={tagFilter === tag} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>{tagName(tag)}</button>
                          ))}
                        </div>
                      </section>
                    )}

                    <section className="notes-side-section">
                      <div className="notes-side-heading"><span className="eyebrow">REPÈRES</span><span className="notes-count">{highlights.length}</span></div>
                      {highlights.length > 0 ? highlights.slice(0, 5).map((highlight) => (
                        <div key={highlight.id} className="notes-highlight-row">
                          <button className="notes-highlight-open" type="button" onClick={() => void openNote(highlight.noteId)} title={highlight.noteTitle}>
                            <span className="notes-highlight-quote">{highlight.quote}</span>
                            <small>{highlight.noteTitle}</small>
                          </button>
                          <button className="button ghost note-row-action" type="button" onClick={() => void deleteHighlight(highlight.id)} aria-label="Supprimer le repère" title="Supprimer le repère"><Icon name="close" size={12} /></button>
                        </div>
                      )) : <p className="notes-side-empty">Sélectionne un passage dans une note pour garder un repère.</p>}
                    </section>

                    <section className="notes-storage-section">
                      <button className="button ghost notes-storage-toggle" type="button" onClick={() => setTrashOpen((open) => !open)} aria-expanded={trashOpen}>
                        <Icon name="trash" size={14} /><span>Corbeille</span><span className="notes-count">{trash.length}</span>
                      </button>
                      {trashOpen && (trash.length > 0 ? trash.map((note) => (
                        <div key={note.id} className="notes-storage-row">
                          <button className="notes-storage-open" type="button" onClick={() => void openNote(note.id)} title={note.id}><Icon name="file" size={14} /><span>{note.title || "Sans titre"}</span></button>
                          <button className="button ghost note-row-action" type="button" onClick={() => void restoreNote(note.id)} aria-label="Restaurer la note" title="Restaurer la note"><Icon name="restore" size={14} /></button>
                          <button className={`button ghost note-row-action${purgeArmed === note.id ? " armed" : ""}`} type="button" onClick={() => armPurge(note.id)} aria-label={purgeArmed === note.id ? "Confirmer : supprimer définitivement" : "Supprimer définitivement"} title={purgeArmed === note.id ? "Confirmer : supprimer définitivement" : "Supprimer définitivement"}><Icon name="trash" size={14} /></button>
                        </div>
                      )) : <p className="notes-side-empty">La corbeille est vide.</p>)}


                      <button className="button ghost notes-storage-toggle" type="button" onClick={() => setArchiveOpen((open) => !open)} aria-expanded={archiveOpen}>
                        <Icon name="archive" size={14} /><span>Archive</span><span className="notes-count">{archived.length}</span>
                      </button>
                      {archiveOpen && (archived.length > 0 ? archived.map((note) => (
                        <div key={note.id} className="notes-storage-row">
                          <button className="notes-storage-open" type="button" onClick={() => void openNote(note.id)} title={note.id}><Icon name="file" size={14} /><span>{note.title || "Sans titre"}</span></button>
                          <button className="button ghost note-row-action" type="button" onClick={() => void unarchiveNote(note.id)} aria-label="Désarchiver la note" title="Désarchiver la note"><Icon name="restore" size={14} /></button>
                        </div>
                      )) : <p className="notes-side-empty">Aucune note archivée.</p>)}
                    </section>

                    <button className="button ghost notes-dir" type="button" onClick={openDir} title={dir} aria-label="Ouvrir le dossier de notes dans l'explorateur">
                      <Icon name="folder" size={14} /><span>{displayPath(dir) || "Ouvrir le dossier de notes"}</span>
                    </button>
                  </>
                )}
              </div>
            </aside>

            <div className="notes-main">
              {!libraryOpen && !draft && (
                <button className="button ghost note-icon notes-show-library" type="button" onClick={() => setLibraryOpen(true)} aria-label="Afficher la bibliothèque" title="Afficher la bibliothèque"><Icon name="panel" size={15} /></button>
              )}
              {draft ? (
                <NoteDocument
                  key={draft.id}
                  draft={draft}
                  saveStatus={saveStatus}
                  titleFocusToken={titleFocusToken}
                  onTitleFocused={() => setTitleFocusToken(0)}
                  labels={labels[draft.id] ?? []}
                  agents={props.agents}
                  activeAgents={tags[draft.id] ?? []}
                  links={links}
                  backs={backs}
                  notes={mentionNotes}
                  folders={allFolders}
                  pinned={pinned.includes(draft.id)}
                  focusMode={focusMode}
                  libraryOpen={libraryOpen}
                  archived={currentArchived}
                  trashed={currentTrashed}
                  onTitleChange={(title) => patchDraft({ title })}
                  onBodyChange={(body) => patchDraft({ body })}
                  onFlush={() => { void flushDraft() }}
                  onOpenNote={(id) => void openNote(id)}
                  onOpenFolder={revealFolder}
                  onMentionAgent={addAgent}
                  onHighlight={(quote) => void addHighlight(quote)}
                  onAddLabel={(label) => void addLabel(label)}
                  onRemoveLabel={(label) => void removeLabel(label)}
                  onToggleAgent={toggleAgent}
                  onTogglePin={() => void togglePin()}
                  onToggleFocus={() => setFocusMode((value) => !value)}
                  onToggleLibrary={() => setLibraryOpen((value) => !value)}
                  onExport={() => void exportCurrent()}
                  onDuplicate={() => void duplicateCurrent()}
                  onArchive={() => void archiveCurrent()}
                  onDelete={() => void deleteCurrent()}
                  onRestore={() => void restoreNote(draft.id)}
                  onUnarchive={() => void unarchiveNote(draft.id)}
                  onPrev={() => { const note = currentIndex > 0 ? visibleNotes[currentIndex - 1] : undefined; if (note) void openNote(note.id) }}
                  onNext={() => { const note = currentIndex >= 0 ? visibleNotes[currentIndex + 1] : undefined; if (note) void openNote(note.id) }}
                  canPrev={currentIndex > 0}
                  canNext={currentIndex >= 0 && currentIndex < visibleNotes.length - 1}
                  onAttach={() => attachCurrent(false)}
                  onSynthesize={() => attachCurrent(true)}
                  attachTargetName={activeAgentName}
                />
              ) : (
                <div className="notes-empty notes-start">
                  <div className="notes-empty-symbol"><Icon name="pencil" size={24} /></div>
                  <span className="eyebrow">BIBLIOTHÈQUE</span>
                  <h2>{allNotes.length ? "Choisis une note" : "Commencer à écrire"}</h2>
                  <p>{allNotes.length ? "L’arbre à gauche liste tes dossiers et notes. Le document s’ouvre directement, sans mode aperçu." : "Une note est un vrai fichier Markdown, posé dans ton espace de travail."}</p>
                  <div className="notes-empty-actions">
                    {/* v12.8.0 : la barre latérale porte déjà l'action primaire de la vue ;
                        répéter un bouton primaire ici en afficherait deux à l'écran. */}
                    <button className="button secondary" type="button" onClick={() => void createNote()}><Icon name="plus" size={14} />Nouvelle note</button>
                    <button className="button secondary" type="button" onClick={() => setTemplateOpen(true)}><Icon name="template" size={14} />Partir d’un modèle</button>
                    <button className="button ghost" type="button" onClick={() => void quickCapture()}><Icon name="inbox" size={14} />Capture rapide</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
      <TemplatePicker open={templateOpen} onClose={() => setTemplateOpen(false)} onSelect={(template) => void createFromTemplate(template)} />
    </InstrumentFrame>
  )
}
