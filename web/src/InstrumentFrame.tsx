// v11.0.0 : cadre d'un instrument du Poste. Il remplace PageShell : pas de « page »
// plein écran avec retour, un en-tête compact (eyebrow mono, titre de scène,
// description) et un corps qui gère son propre défilement. Les actions déclarées ici
// sont celles de l'instrument, jamais celles d'un autre.
import type { ReactNode } from "react"
import { Icon, type IconName } from "./icons"

export type InstrumentAction = {
  key: string
  label: string
  icon?: IconName
  onClick: () => void
  title?: string
  variant?: "primary" | "secondary" | "ghost"
  pressed?: boolean
  disabled?: boolean
  className?: string
}

type Props = {
  eyebrow: string
  title: string
  description?: ReactNode
  className?: string
  actions?: InstrumentAction[]
  toolbarLabel?: string
  bodyClassName?: string
  children: ReactNode
}

export default function InstrumentFrame({
  eyebrow,
  title,
  description,
  className,
  actions = [],
  toolbarLabel,
  bodyClassName,
  children,
}: Props) {
  return (
    <section className={`instrument${className ? ` ${className}` : ""}`} aria-label={title}>
      <header className="instrument-head">
        <div className="instrument-heading">
          <span className="instrument-eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {description ? <div className="instrument-description">{description}</div> : null}
        </div>
        {actions.length > 0 && (
          <div className="instrument-actions" role="toolbar" aria-label={toolbarLabel ?? `Actions de ${title}`}>
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={`button ${action.variant ?? "secondary"}${action.className ? ` ${action.className}` : ""}`}
                onClick={action.onClick}
                title={action.title}
                aria-pressed={action.pressed}
                disabled={action.disabled}
              >
                {action.icon ? <Icon name={action.icon} size={14} /> : null}
                {action.label}
              </button>
            ))}
          </div>
        )}
      </header>
      <div className={`instrument-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</div>
    </section>
  )
}
