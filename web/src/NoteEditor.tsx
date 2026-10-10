import { EditorContent, useEditor, type Editor } from "@tiptap/react"
import StarterKit from "@tiptap/starter-kit"
import { Markdown } from "tiptap-markdown"
import { Icon, type IconName } from "./icons"

// v10.1.0 : éditeur riche façon Kortex — TipTap (ProseMirror, même socle que Kortex)
// avec export Markdown bidirectionnel (tiptap-markdown). Le composant est « piloté »
// par la note : NotesView impose key={noteId} pour qu'un changement de note
// remonte un éditeur neuf (aucune boucle value↔setContent).
type Props = {
  value: string
  onChange: (markdown: string) => void
}

const setup = () => [
  StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
  Markdown.configure({ html: false, transformCopiedText: true, breaks: false }),
]

function ToolButton({ editor, run, name, icon, label }: { editor: Editor; run: () => void; name: string; icon: IconName; label: string }) {
  return (
    <button className={`button ghost note-tool ${editor.isActive(name) ? "active" : ""}`} type="button" onClick={run} title={label} aria-label={label}>
      <Icon name={icon} size={14} />
    </button>
  )
}

export default function NoteEditor(props: Props) {
  const editor = useEditor({
    extensions: setup(),
    content: props.value,
    onUpdate: ({ editor: e }) => props.onChange(e.storage.markdown.getMarkdown()),
  })
  if (!editor) return <div className="note-editor" aria-busy="true" />
  return (
    <div className="note-editor">
      <div className="notes-toolbar note-editor-toolbar" role="toolbar" aria-label="Mise en forme">
        <ToolButton editor={editor} name="heading" icon="text" label="Titre 1" run={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} />
        <ToolButton editor={editor} name="heading" icon="text" label="Titre 2" run={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} />
        <ToolButton editor={editor} name="bold" icon="bold" label="Gras" run={() => editor.chain().focus().toggleBold().run()} />
        <ToolButton editor={editor} name="italic" icon="italic" label="Italique" run={() => editor.chain().focus().toggleItalic().run()} />
        <ToolButton editor={editor} name="bulletList" icon="list" label="Liste à puces" run={() => editor.chain().focus().toggleBulletList().run()} />
        <ToolButton editor={editor} name="orderedList" icon="list-ordered" label="Liste numérotée" run={() => editor.chain().focus().toggleOrderedList().run()} />
        <ToolButton editor={editor} name="blockquote" icon="quote" label="Citation" run={() => editor.chain().focus().toggleBlockquote().run()} />
        <ToolButton editor={editor} name="codeBlock" icon="terminal" label="Bloc de code" run={() => editor.chain().focus().toggleCodeBlock().run()} />
        <button className="button ghost note-tool" type="button" title="Lier une note ([[titre]])" aria-label="Lier une note"
          onClick={() => editor.chain().focus().insertContent("[[]]").run()}>
          <Icon name="link" size={14} />
        </button>
      </div>
      <EditorContent editor={editor} className="note-editor-content" />
    </div>
  )
}
