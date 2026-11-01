import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import Link from "@tiptap/extension-link"
import TaskList from "@tiptap/extension-task-list"
import TaskItem from "@tiptap/extension-task-item"
import Table from "@tiptap/extension-table"
import TableRow from "@tiptap/extension-table-row"
import TableHeader from "@tiptap/extension-table-header"
import TableCell from "@tiptap/extension-table-cell"
import { Extension } from "@tiptap/core"
import { Plugin, PluginKey } from "@tiptap/pm/state"
import { Decoration, DecorationSet } from "@tiptap/pm/view"
import { Markdown } from "tiptap-markdown"
import Placeholder from "@tiptap/extension-placeholder"
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Icon, type IconName } from "./icons"
import { filterSlashCommands, mentionQueryBefore, nextMenuIndex, slashQueryBefore, type SlashCommand } from "./notes-menu"
import { normalizeLibraryText } from "./notes-search"

// v12.8.0 : l'éditeur est le document, pas un formulaire. TipTap reste le socle :
// Markdown bidirectionnel, tableaux, listes de tâches, liens et wikilinks réels.
// Les menus `/` et `@` sont des décisions pures (notes-menu.ts) ; ici on ne fait
// que les poser au curseur et exécuter la commande choisie.
type Props = {
  value: string
  onChange: (markdown: string) => void
  onWikilink?: (target: string) => void
  onHighlight?: (quote: string) => void
  notes: { id: string; title: string; folder: string }[]
  folders: string[]
  agents: { id: string; name: string }[]
  onOpenFolder?: (folder: string) => void
  onMentionAgent?: (id: string) => void
  readOnly?: boolean
}

type MenuState = {
  kind: "slash" | "mention"
  start: number
  end: number
  query: string
  index: number
}

type MentionOption = {
  key: string
  label: string
  detail: string
  icon: IconName
  kind: "note" | "folder" | "agent"
  id: string
}

const WIKILINK = /\[\[([^\[\]\n]{1,120})\]\]/g

const WikilinkDecorations = Extension.create({
  name: "wikilinkDecorations",
  addProseMirrorPlugins() {
    return [new Plugin({
      key: new PluginKey("wikilinkDecorations"),
      props: {
        decorations(state) {
          const decorations: Decoration[] = []
          state.doc.descendants((node, pos) => {
            if (!node.isText || !node.text) return
            for (const match of node.text.matchAll(WIKILINK)) {
              const from = pos + (match.index ?? 0)
              decorations.push(Decoration.inline(from, from + match[0].length, {
                class: "note-wikilink",
                title: match[1],
              }))
            }
          })
          return DecorationSet.create(state.doc, decorations)
        },
      },
    })]
  },
})

const slashIcon = (id: string): IconName => {
  if (id === "h1" || id === "h2" || id === "h3" || id === "paragraph") return "text"
  if (id === "bullet") return "list"
  if (id === "ordered") return "list-ordered"
  if (id === "task") return "check"
  if (id === "quote" || id === "callout") return "quote"
  if (id === "code") return "terminal"
  if (id === "divider") return "minimize"
  if (id === "table") return "table"
  if (id === "link") return "link"
  if (id === "bold") return "bold"
  if (id === "italic") return "italic"
  return "slash"
}

function wikilinkAt(state: Editor["state"], pos: number): string | null {
  const $pos = state.doc.resolve(pos)
  const parent = $pos.parent
  if (!parent.isTextblock) return null
  const text = parent.textContent
  const offset = $pos.parentOffset
  WIKILINK.lastIndex = 0
  let match: RegExpExecArray | null
  while ((match = WIKILINK.exec(text))) {
    if (offset >= match.index && offset <= match.index + match[0].length) return match[1].trim() || null
  }
  return null
}

export default function NoteEditor(props: Props) {
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [menuTop, setMenuTop] = useState(0)
  const [menuLeft, setMenuLeft] = useState(0)
  const [selectionText, setSelectionText] = useState("")
  const wrapRef = useRef<HTMLDivElement>(null)
  const propsRef = useRef(props)
  propsRef.current = props
  const detectRef = useRef<(editor: Editor) => void>(() => undefined)

  const slashOptions = useMemo(() => (menu?.kind === "slash" ? filterSlashCommands(menu.query) : []), [menu])
  const mentionOptions = useMemo(() => {
    if (menu?.kind !== "mention") return []
    const query = normalizeLibraryText(menu.query)
    const terms = query.split(" ").filter(Boolean)
    const match = (text: string) => {
      const haystack = normalizeLibraryText(text)
      return terms.every((term) => haystack.includes(term))
    }
    const notes = props.notes
      .filter((note) => !terms.length || match(`${note.title} ${note.id}`))
      .slice(0, 7)
      .map<MentionOption>((note) => ({ key: `note:${note.id}`, label: note.title, detail: "Note", icon: "file", kind: "note", id: note.id }))
    const folders = props.folders
      .filter((folder) => folder && (!terms.length || match(folder)))
      .slice(0, 4)
      .map<MentionOption>((folder) => ({ key: `folder:${folder}`, label: folder, detail: "Dossier", icon: "folder", kind: "folder", id: folder }))
    const agents = props.agents
      .filter((agent) => !terms.length || match(`${agent.name} ${agent.id}`))
      .slice(0, 4)
      .map<MentionOption>((agent) => ({ key: `agent:${agent.id}`, label: agent.name, detail: "Agent", icon: "agent", kind: "agent", id: agent.id }))
    return [...notes, ...folders, ...agents]
  }, [menu?.kind, menu?.query, props.notes, props.folders, props.agents])

  const positionMenu = (editor: Editor, at: number) => {
    const wrapper = wrapRef.current
    if (!wrapper) return
    const coords = editor.view.coordsAtPos(at)
    const rect = wrapper.getBoundingClientRect()
    setMenuTop(Math.max(6, Math.min(coords.bottom - rect.top + 6, rect.height - 250)))
    setMenuLeft(Math.max(6, Math.min(coords.left - rect.left, rect.width - 292)))
  }

  const detect = (editor: Editor) => {
    const { selection } = editor.state
    if (!selection.empty) { setMenu(null); return }
    const start = selection.$from.start()
    const before = editor.state.doc.textBetween(start, selection.from, "\n", "\n")
    const slash = slashQueryBefore(before)
    if (slash) {
      setMenu((current) => ({ kind: "slash", start: start + slash.start, end: selection.from, query: slash.query, index: current?.kind === "slash" && current.query === slash.query ? current.index : 0 }))
      positionMenu(editor, selection.from)
      return
    }
    const mention = mentionQueryBefore(before)
    if (mention) {
      setMenu((current) => ({ kind: "mention", start: start + mention.start, end: selection.from, query: mention.query, index: current?.kind === "mention" && current.query === mention.query ? current.index : 0 }))
      positionMenu(editor, selection.from)
      return
    }
    setMenu(null)
  }
  detectRef.current = detect

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true, HTMLAttributes: { rel: "noopener noreferrer" } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableHeader,
      TableCell,
      Markdown.configure({ html: false, transformCopiedText: true, breaks: false }),
      Placeholder.configure({
        placeholder: "Tapez / pour les commandes ou @ pour mentionner…",
        emptyEditorClass: "is-editor-empty",
      }),
      WikilinkDecorations,
    ],
    content: props.value,
    editable: !props.readOnly,
    editorProps: {
      attributes: {
        class: "note-prose",
        spellcheck: "true",
        "data-placeholder": "Tapez / pour les commandes ou @ pour mentionner…",
      },
      handleClick(view, pos, event) {
        const onWikilink = propsRef.current.onWikilink
        if (!onWikilink) return false
        const target = wikilinkAt(view.state, pos)
        if (!target) return false
        event.preventDefault()
        onWikilink(target)
        return true
      },
    },
    onUpdate: ({ editor: current }) => {
      propsRef.current.onChange(current.storage.markdown.getMarkdown())
      detectRef.current(current)
    },
    onSelectionUpdate: ({ editor: current }) => {
      const { from, to, empty } = current.state.selection
      setSelectionText(empty ? "" : current.state.doc.textBetween(from, to, " "))
      detectRef.current(current)
    },
  })

  useEffect(() => {
    if (!menu) return
    const close = (event: PointerEvent) => {
      const target = event.target as Node | null
      if (target && wrapRef.current?.contains(target)) return
      setMenu(null)
    }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [menu])

  if (!editor) return <div className="note-editor-shell" aria-busy="true" />

  const closeMenu = () => setMenu(null)

  const applySlash = (command: SlashCommand) => {
    if (!menu) return
    const range = { from: menu.start, to: menu.end }
    closeMenu()
    const chain = editor.chain().focus().deleteRange(range)
    switch (command.id) {
      case "h1": chain.setHeading({ level: 1 }).run(); break
      case "h2": chain.setHeading({ level: 2 }).run(); break
      case "h3": chain.setHeading({ level: 3 }).run(); break
      case "paragraph": chain.setParagraph().run(); break
      case "bullet": chain.toggleBulletList().run(); break
      case "ordered": chain.toggleOrderedList().run(); break
      case "task": chain.toggleTaskList().run(); break
      case "quote": chain.toggleBlockquote().run(); break
      case "code": chain.toggleCodeBlock().run(); break
      case "divider": chain.setHorizontalRule().run(); break
      case "table": chain.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run(); break
      case "callout":
        chain.insertContent({ type: "blockquote", content: [{ type: "paragraph", content: [{ type: "text", text: "À retenir — " }] }] }).run()
        break
      case "link": {
        const href = window.prompt("Adresse du lien :", "https://")
        if (href && href.trim()) {
          const url = href.trim()
          editor.chain().focus().insertContent({ type: "text", text: url, marks: [{ type: "link", attrs: { href: url } }] }).run()
        }
        break
      }
      case "bold": chain.toggleBold().run(); break
      case "italic": chain.toggleItalic().run(); break
      default: break
    }
  }

  const applyMention = (option: MentionOption) => {
    if (!menu) return
    const range = { from: menu.start, to: menu.end }
    closeMenu()
    if (option.kind === "note") {
      const title = option.label.replace(/[\[\]\n]/g, " ").trim() || "Sans titre"
      editor.chain().focus().deleteRange(range).insertContent(`[[${title}]] `).run()
      return
    }
    if (option.kind === "folder") {
      editor.chain().focus().deleteRange(range).insertContent(`\`${option.label}/\` `).run()
      props.onOpenFolder?.(option.id)
      return
    }
    editor.chain().focus().deleteRange(range).insertContent(`@${option.label} `).run()
    props.onMentionAgent?.(option.id)
  }

  const choose = (index: number) => {
    if (!menu) return
    if (menu.kind === "slash") {
      const command = slashOptions[index]
      if (command) applySlash(command)
    } else {
      const option = mentionOptions[index]
      if (option) applyMention(option)
    }
  }

  const optionCount = menu?.kind === "slash" ? slashOptions.length : mentionOptions.length
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (!menu || optionCount <= 0) return
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault()
      event.stopPropagation()
      setMenu((current) => current ? { ...current, index: nextMenuIndex(current.index, optionCount, event.key === "ArrowDown" ? 1 : -1) } : current)
      return
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault()
      event.stopPropagation()
      choose(menu.index)
      return
    }
    if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      closeMenu()
    }
  }

  const rows = menu?.kind === "slash"
    ? slashOptions.map((command, index) => ({ key: command.id, label: command.label, detail: command.group, icon: slashIcon(command.id), index, run: () => choose(index) }))
    : mentionOptions.map((option, index) => ({ key: option.key, label: option.label, detail: option.detail, icon: option.icon, index, run: () => choose(index) }))

  return (
    <div className="note-editor-shell" ref={wrapRef} onKeyDownCapture={onKeyDown}>
      <EditorContent editor={editor} className="note-editor-content" />
      {selectionText.trim() && props.onHighlight && !props.readOnly && (
        <div className="note-selection-action" role="toolbar" aria-label="Action sur la sélection">
          <button className="button secondary small" type="button" onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              props.onHighlight?.(selectionText.trim())
              editor.chain().focus().setTextSelection(editor.state.selection.to).run()
            }}>
            <Icon name="highlight" size={14} />Enregistrer le repère
          </button>
        </div>
      )}
      {menu && (
        <div className="note-menu" style={{ top: menuTop, left: menuLeft }} role="listbox" aria-label={menu.kind === "slash" ? "Commandes de la note" : "Mentions"}>
          <div className="note-menu-title">{menu.kind === "slash" ? "COMMANDES" : "MENTIONNER"}</div>
          {rows.length ? rows.map((row) => (
            <button key={row.key} type="button" role="option" aria-selected={menu.index === row.index}
              className={`note-menu-item${menu.index === row.index ? " selected" : ""}`}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setMenu((current) => current ? { ...current, index: row.index } : current)}
              onClick={row.run}>
              <Icon name={row.icon} size={14} />
              <span>{row.label}</span>
              <small>{row.detail}</small>
            </button>
          )) : <p className="note-menu-empty">Aucune correspondance.</p>}
        </div>
      )}
    </div>
  )
}
