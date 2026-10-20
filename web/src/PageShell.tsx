// v10.3.0 : structure de page unique (AGENTS.md §6) — Tâches, Projet, Notes,
// Fichiers et Réglages partagent la MÊME charpente : une page pleine qui occupe
// toute la surface de contenu, une barre supérieure contextuelle (chaque page
// déclare ses actions) et un corps sans défilement global. Avant, Notes/Fichiers/
// Réglages étaient des dialogues superposés (`.overlay` + `.dialog`) qui simulaient
// une page et masquaient la conversation.
import type { ReactNode } from "react"
import { Icon, type IconName } from "./icons"

export type PageAction = {
  key: string
  label: string
  icon?: IconName
  onClick: () => void
  title?: string
  variant?: "primary" | "secondary" | "ghost"
  pressed?: boolean
  disabled?: boolean
  // Classe additionnelle (ex. « dialog-close » gardée pour les scripts de fumée).
  className?: string
}

type Props = {
  eyebrow: string
  title: string
  description?: ReactNode
  // Surnoms conservés pour les scripts de fumée et le routage (ex. « agents-main »).
  className?: string
  // Les actions sont DÉCLARÉES par la page : la barre ne montre jamais les boutons
  // d'une autre section.
  actions?: PageAction[]
  toolbarLabel?: string
  bodyClassName?: string
  children: ReactNode
}

export default function PageShell({ eyebrow, title, description, className, actions = [], toolbarLabel, bodyClassName, children }: Props) {
  return (
    <main className={`page-main${className ? ` ${className}` : ""}`}>
      <header className="page-topbar">
        <div className="page-heading">
          <span className="eyebrow">{eyebrow}</span>
          <h1>{title}</h1>
          {description ? <div className="page-description">{description}</div> : null}
        </div>
        {actions.length > 0 && (
          <div className="page-actions" role="toolbar" aria-label={toolbarLabel ?? `Actions de la page ${title}`}>
            {actions.map((action) => (
              <button
                key={action.key}
                type="button"
                className={`button ${action.variant ?? "secondary"} page-action${action.className ? ` ${action.className}` : ""}`}
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
      <section className={`page-body${bodyClassName ? ` ${bodyClassName}` : ""}`}>{children}</section>
    </main>
  )
}
