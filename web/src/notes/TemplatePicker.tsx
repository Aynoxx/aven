import { useEffect } from "react"
import { Icon } from "../icons"
import { NOTE_TEMPLATES, type NoteTemplate } from "../notes-templates"

// v12.8.0 : le modèle est un choix explicite, pas une note déjà créée. Le
// dialogue se ferme à Échap ou au clic sur le fond ; chaque option écrit un vrai
// document Markdown.
export default function TemplatePicker({ open, onClose, onSelect }: {
  open: boolean
  onClose: () => void
  onSelect: (template: NoteTemplate) => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose() }
    window.addEventListener("keydown", onKey)
    return () => window.removeEventListener("keydown", onKey)
  }, [open, onClose])

  if (!open) return null
  return (
    <div className="note-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <section className="note-dialog" role="dialog" aria-modal="true" aria-label="Créer depuis un modèle">
        <header className="note-dialog-head">
          <div>
            <span className="eyebrow">NOUVELLE NOTE</span>
            <h2>Créer depuis un modèle</h2>
            <p>Choisis une structure de départ. La note restera un fichier Markdown ordinaire.</p>
          </div>
          <button className="button ghost button-icon" type="button" onClick={onClose} aria-label="Fermer le choix de modèle" title="Fermer"><Icon name="close" size={16} /></button>
        </header>
        <div className="note-template-list">
          {NOTE_TEMPLATES.map((template) => (
            <button key={template.id} className="button secondary note-template-option" type="button" onClick={() => onSelect(template)}>
              <span className="note-template-icon"><Icon name="template" size={16} /></span>
              <span className="note-template-copy"><strong>{template.name}</strong><small>{template.description}</small></span>
              <Icon name="chevron-right" size={14} />
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}
