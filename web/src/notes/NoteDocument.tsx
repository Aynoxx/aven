import { useEffect, useRef, useState, type MouseEvent } from "react"
import { Icon } from "../icons"
import NoteEditor from "../NoteEditor"
import type { NoteLink } from "../types"
import { noteFolder } from "../notes-search"

// v12.8.0 : le document est le centre de l'écran. Il n'y a plus de mode
// « aperçu » puis « modifier » : on ouvre, on écrit, le host sauvegarde. Le titre
// est un vrai champ, et les métadonnées restent discrètes sous le filet.
export type NoteDraft = { id: string; title: string; body: string; folder: string }
export type SaveStatus = "idle" | "dirty" | "saving" | "saved" | "error"

type Props = {
  draft: NoteDraft
  saveStatus: SaveStatus
  titleFocusToken: number
  onTitleFocused: () => void
  labels: string[]
  agents: { id: string; name: string }[]
  activeAgents: string[]
  links: NoteLink[]
  backs: string[]
  notes: { id: string; title: string; folder: string }[]
  folders: string[]
  pinned: boolean
  focusMode: boolean
  libraryOpen: boolean
  archived: boolean
  trashed: boolean
  onTitleChange: (title: string) => void
  onBodyChange: (body: string) => void
  onFlush: () => void
  onOpenNote: (id: string) => void
  onOpenFolder: (folder: string) => void
  onMentionAgent: (id: string) => void
  onHighlight: (quote: string) => void
  onAddLabel: (label: string) => void
  onRemoveLabel: (label: string) => void
  onToggleAgent: (id: string) => void
  onTogglePin: () => void
  onToggleFocus: () => void
  onToggleLibrary: () => void
  onExport: () => void
  onDuplicate: () => void
  onArchive: () => void
  onDelete: () => void
  onRestore: () => void
  onUnarchive: () => void
  onPrev: () => void
  onNext: () => void
  canPrev: boolean
  canNext: boolean
  onAttach: () => void
  onSynthesize: () => void
  attachTargetName: string
}

const STATUS_LABEL: Record<SaveStatus, string> = {
  idle: "",
  dirty: "Modifié",
  saving: "Enregistrement…",
  saved: "Enregistré",
  error: "Erreur d'enregistrement",
}

function closeDetails(event: MouseEvent<HTMLButtonElement>) {
  const details = event.currentTarget.closest("details")
  if (details) details.open = false
}

export default function NoteDocument(props: Props) {
  const { draft } = props
  const titleRef = useRef<HTMLInputElement>(null)
  const [labelDraft, setLabelDraft] = useState("")
  const readOnly = props.archived || props.trashed
  const folderParts = draft.folder ? draft.folder.split("/") : []
  const words = draft.body.trim() ? draft.body.trim().split(/\s+/).length : 0

  useEffect(() => {
    if (!props.titleFocusToken) return
    const input = titleRef.current
    if (!input) return
    input.focus()
    input.select()
    props.onTitleFocused()
  }, [props.titleFocusToken, draft.id])

  const noteTitle = (id: string) => props.notes.find((note) => note.id === id)?.title ?? id.replace(/^\.(?:trash|archive)\//, "").replace(/\.md$/, "")
  const stateLabel = props.trashed ? "Dans la corbeille" : props.archived ? "Archivée" : ""
  return (
    <article className="note-document" aria-label={`Note ${draft.title || "sans titre"}`}>
      <header className="note-doc-head">
        <div className="note-doc-nav">
          <button className="button ghost note-icon" type="button" onClick={props.onPrev} disabled={!props.canPrev} title="Note précédente" aria-label="Note précédente"><Icon name="arrow-left" size={15} /></button>
          <button className="button ghost note-icon" type="button" onClick={props.onNext} disabled={!props.canNext} title="Note suivante" aria-label="Note suivante"><Icon name="arrow-right" size={15} /></button>
          <nav className="note-breadcrumb" aria-label="Fil d'Ariane">
            <span>Bibliothèque</span>
            {folderParts.map((part, index) => (
              <span key={`${part}-${index}`} className="note-crumb-part">/ {part}</span>
            ))}
            <span className="note-crumb-current">/ {draft.title || "Sans titre"}</span>
          </nav>
        </div>

        <div className="note-doc-status" role="status" aria-live="polite">
          {stateLabel && <span className={`note-state${props.trashed ? " danger" : ""}`}>{stateLabel}</span>}
          {STATUS_LABEL[props.saveStatus] && <span className={`note-save-status ${props.saveStatus}`}>{STATUS_LABEL[props.saveStatus]}</span>}
        </div>

        <div className="note-doc-actions">
          <button className="button ghost note-icon" type="button" onClick={props.onTogglePin} aria-pressed={props.pinned} title={props.pinned ? "Détacher la note" : "Épingler la note"} aria-label={props.pinned ? "Détacher la note" : "Épingler la note"}>
            <Icon name="pin" size={15} />
          </button>
          <button className="button ghost note-icon" type="button" onClick={props.onToggleFocus} aria-pressed={props.focusMode} title={props.focusMode ? "Quitter le mode concentration" : "Mode concentration"} aria-label={props.focusMode ? "Quitter le mode concentration" : "Mode concentration"}>
            <Icon name={props.focusMode ? "minimize" : "maximize"} size={15} />
          </button>
          <button className="button ghost note-icon notes-library-toggle" type="button" onClick={props.onToggleLibrary} aria-expanded={props.libraryOpen} title="Afficher ou masquer la bibliothèque" aria-label="Afficher ou masquer la bibliothèque">
            <Icon name="panel" size={15} />
          </button>
          <details className="note-more">
            <summary className="button ghost note-icon" aria-label="Plus d'actions" title="Plus d'actions"><Icon name="more" size={16} /></summary>
            <div className="note-more-menu" role="menu">
              <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onDuplicate() }}><Icon name="copy" size={14} />Dupliquer</button>
              <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onExport() }}><Icon name="export" size={14} />Exporter .md</button>
              {props.trashed ? (
                <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onRestore() }}><Icon name="restore" size={14} />Restaurer</button>
              ) : props.archived ? (
                <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onUnarchive() }}><Icon name="restore" size={14} />Désarchiver</button>
              ) : (
                <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onArchive() }}><Icon name="archive" size={14} />Archiver</button>
              )}
              {!props.trashed && <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onDelete() }}><Icon name="trash" size={14} />Mettre à la corbeille</button>}
              {!readOnly && (
                <>
                  <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onAttach() }}><Icon name="paperclip" size={14} />Joindre à {props.attachTargetName}</button>
                  <button className="button ghost" type="button" onClick={(event) => { closeDetails(event); props.onSynthesize() }}><Icon name="wand" size={14} />Demander une synthèse à {props.attachTargetName}</button>
                  <p className="note-more-hint">Prépare un message pour {props.attachTargetName} — sans l'envoyer.</p>
                </>
              )}
            </div>
          </details>
        </div>
      </header>

      {stateLabel && (
        <div className={`note-state-banner${props.trashed ? " danger" : ""}`} role="status">
          <Icon name={props.trashed ? "trash" : "archive"} size={14} />
          <span>{props.trashed ? "Cette note est dans la corbeille. Restaure-la pour la modifier." : "Cette note est archivée. Désarchive-la pour la modifier."}</span>
        </div>
      )}

      <div className="note-doc-scroll">
        <article className="note-doc-body">
          <input
            ref={titleRef}
            className="notes-title"
            value={draft.title}
            onChange={(event) => props.onTitleChange(event.target.value)}
            onBlur={props.onFlush}
            onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() } }}
            placeholder="Titre de la note"
            aria-label="Titre de la note"
            disabled={readOnly}
            spellCheck
          />
          <div className="note-title-rule" aria-hidden="true" />

          <section className="note-meta" aria-label="Métadonnées de la note">
            <div className="note-meta-row">
              <span className="eyebrow">ÉTIQUETTES</span>
              <div className="note-chip-row">
                {props.labels.map((label) => (
                  <span key={label} className="notes-tag selected note-label">
                    {label}
                    {!readOnly && <button className="note-chip-remove" type="button" onClick={() => props.onRemoveLabel(label)} aria-label={`Retirer l'étiquette ${label}`}><Icon name="close" size={12} /></button>}
                  </span>
                ))}
                {!readOnly && (
                  <form className="note-label-form" onSubmit={(event) => {
                    event.preventDefault()
                    const label = labelDraft.trim()
                    if (!label) return
                    props.onAddLabel(label)
                    setLabelDraft("")
                  }}>
                    <input className="note-label-input" value={labelDraft} onChange={(event) => setLabelDraft(event.target.value)} placeholder="Ajouter une étiquette…" aria-label="Ajouter une étiquette" maxLength={40} />
                    <button className="button ghost note-label-add" type="submit" disabled={!labelDraft.trim()} aria-label="Ajouter l'étiquette"><Icon name="plus" size={12} /></button>
                  </form>
                )}
              </div>
            </div>
            <div className="note-meta-row">
              <span className="eyebrow">AGENTS</span>
              <div className="note-chip-row">
                {props.agents.map((agent) => {
                  const active = props.activeAgents.includes(agent.id)
                  return <button key={agent.id} className={`notes-tag ${active ? "selected" : ""}`} type="button" aria-pressed={active} disabled={readOnly} onClick={() => props.onToggleAgent(agent.id)}>{agent.name}</button>
                })}
              </div>
            </div>
          </section>

          <NoteEditor
            value={draft.body}
            onChange={props.onBodyChange}
            onWikilink={(target) => {
              const hit = props.links.find((link) => link.target === target)?.resolved
              if (hit) props.onOpenNote(hit)
              else {
                const byTitle = props.notes.find((note) => note.title.localeCompare(target, "fr", { sensitivity: "base" }) === 0)
                if (byTitle) props.onOpenNote(byTitle.id)
              }
            }}
            onHighlight={readOnly ? undefined : props.onHighlight}
            notes={props.notes}
            folders={props.folders}
            agents={props.agents}
            onOpenFolder={props.onOpenFolder}
            onMentionAgent={props.onMentionAgent}
            readOnly={readOnly}
          />

          <footer className="note-doc-footer">
            <span>{words} mots · {draft.body.length} caractères</span>
            {folderParts.length > 0 && <span className="note-footer-folder">{noteFolder(draft.id) || "Bibliothèque"}</span>}
          </footer>

          {(props.links.length > 0 || props.backs.length > 0) && (
            <details className="note-relations">
              <summary><span className="eyebrow">LIENS ET RÉFÉRENCES</span><span>{props.links.length + props.backs.length}</span></summary>
              {props.links.length > 0 && (
                <div className="note-relation-group">
                  <span className="eyebrow">SORTANTS</span>
                  <div className="note-chip-row">
                    {props.links.map((link) => (
                      <button key={link.target} className={`notes-tag ${link.resolved ? "" : "broken"}`} type="button" disabled={!link.resolved} onClick={() => link.resolved && props.onOpenNote(link.resolved)}>{link.target}</button>
                    ))}
                  </div>
                </div>
              )}
              {props.backs.length > 0 && (
                <div className="note-relation-group">
                  <span className="eyebrow">CITÉE PAR</span>
                  <div className="note-chip-row">
                    {props.backs.map((id) => <button key={id} className="notes-tag" type="button" onClick={() => props.onOpenNote(id)}>{noteTitle(id)}</button>)}
                  </div>
                </div>
              )}
            </details>
          )}
        </article>
      </div>
    </article>
  )
}
