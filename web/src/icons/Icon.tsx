import type { ReactNode } from "react"

/**
 * Central icon registry for the application-owned UI.
 * Keep new product icons here so every surface shares the same visual language.
 */
export type IconName =
  | "sparkle"
  | "search"
  | "chevron-down"
  | "chevron-right"
  | "chevron-left"
  | "arrow-right"
  | "arrow-left"
  | "plus"
  | "settings"
  | "agent"
  | "folder"
  | "file"
  | "grid"
  | "microphone"
  // v11.1.0 : micro coupé de l'agent vocal (l'état doit se lire sans couleur seule).
  | "microphone-off"
  | "close"
  | "minimize"
  | "maximize"
  | "pencil"
  | "export"
  | "archive"
  | "restore"
  | "trash"
  | "menu"
  | "grip"
  | "dot"
  | "archive-list"
  | "check"
  | "copy"
  | "wrench"
  | "chart"
  | "terminal"
  | "slash"
  | "eye" // v9.4.0 : « Faire relire » (délégation à l'agent code-reviewer)
  // v10.1.0 : barre d'outils de l'éditeur de notes (NoteEditor).
  | "text" | "bold" | "italic" | "list" | "list-ordered" | "quote" | "link" | "inbox"
  // v10.2.2 : épingle des notes (remplace l'emoji 📌 de l'arbre).
  | "pin"
  // v11.0.0 : inspecteur du Poste et barre de commande.
  | "panel"
  | "command"
  // v11.0.2 : la sémantique des glyphes. Une icône dit UNE chose : `sparkle` reste la
  // marque d'Aven, la génération assistée prend la baguette, la délégation une
  // ramification, une conversation une bulle, l'arrêt un carré, un transfert un trombone.
  | "wand"
  | "branch"
  | "chat"
  | "stop"
  | "paperclip"

export interface IconProps {
  name: IconName
  size?: number
  strokeWidth?: number
  className?: string
  title?: string
  "aria-hidden"?: boolean
}

const joinClassNames = (...values: Array<string | undefined>) => values.filter(Boolean).join(" ") || undefined
const ICON_SCALE = 1.25

// v11.0.1 : centrage optique. Plusieurs tracés ne sont pas centrés dans le viewBox
// 24×24 (mesuré au getBBox dans l'app) : placés dans un bouton carré, ils paraissent
// hauts (folder 1 unité, sparkle 1,3), décalés à droite (file 1) ou à gauche (restore
// 2,5). Le décalage corrige l'encre, pas la boîte — les boutons étaient déjà centrés.
// 1 unité = 0,73 px à la taille de rendu habituelle (14 × 1,25).
const OPTICAL_NUDGE: Partial<Record<IconName, [number, number]>> = {
  restore: [2.48, 0.33],
  sparkle: [0, 1.3],
  folder: [0, 1],
  file: [-1, 0],
  check: [0, 1],
  archive: [0, 0.75],
  pencil: [0.72, -0.43],
  microphone: [0, -0.5],
  "chevron-down": [0, 0.5],
  wrench: [-0.5, 0.5],
  // v11.0.2 : glyphes de rôle, mesurés avant pose.
  wand: [-1.05, 1.05],
  paperclip: [-0.24, -0.66],
  quote: [-1.5, 0],
  chat: [0, 0.25],
  copy: [-0.5, 0],
  bold: [-0.25, 0],
  list: [0, 0.75],
  text: [0, 0.5],
}

function paths(name: IconName): ReactNode {
  switch (name) {
    case "sparkle":
      return <path fill="currentColor" stroke="none" d="M12 2.7 14.15 8.55 20 10.7l-5.85 2.15L12 18.7l-2.15-5.85L4 10.7l5.85-2.15z" />
    case "search":
      return <><circle cx="10.75" cy="10.75" r="6.75" /><path d="m16 16 4.5 4.5" /></>
    case "chevron-down":
      return <path d="m7 9 5 5 5-5" />
    case "chevron-right":
      return <path d="m9 6 6 6-6 6" />
    case "chevron-left":
      return <path d="m15 6-6 6 6 6" />
    case "arrow-right":
      return <><path d="M4 12h15" /><path d="m13 6 6 6-6 6" /></>
    case "arrow-left":
      return <><path d="M20 12H5" /><path d="m11 6-6 6 6 6" /></>
    case "plus":
      return <><path d="M12 5v14" /><path d="M5 12h14" /></>
    case "settings":
      return <><path d="M12 3.75 13.6 5.3l2.2-.25.85 2.04 2 .95-.4 2.2L19.75 12l-1.5 1.76.4 2.2-2 .95-.85 2.04-2.2-.25L12 20.25l-1.6-1.55-2.2.25-.85-2.04-2-.95.4-2.2L4.25 12l1.5-1.76-.4-2.2 2-.95.85-2.04 2.2.25z" /><circle cx="12" cy="12" r="2.4" /></>
    case "agent":
      return <><circle cx="12" cy="8" r="3.5" /><path d="M5.5 19c.65-3.25 3.05-5 6.5-5s5.85 1.75 6.5 5" /></>
    case "folder":
      return <path d="M4 6.5A2.5 2.5 0 0 1 6.5 4H10l2 2h5.5A2.5 2.5 0 0 1 20 8.5v7A2.5 2.5 0 0 1 17.5 18h-11A2.5 2.5 0 0 1 4 15.5zM4.5 9h15" />
    case "file":
      return <><path d="M6 4h9l4 4v12H6z" /><path d="M15 4v5h5M9 13h6M9 16h6" /></>
    case "grid":
      return <><rect x="4" y="4" width="6" height="6" rx="1.5" /><rect x="14" y="4" width="6" height="6" rx="1.5" /><rect x="4" y="14" width="6" height="6" rx="1.5" /><rect x="14" y="14" width="6" height="6" rx="1.5" /></>
    case "microphone":
      return <><rect x="8.25" y="4" width="7.5" height="11" rx="3.75" /><path d="M5.5 11.5a6.5 6.5 0 0 0 13 0M12 18v3M9.5 21h5" /></>
    case "microphone-off":
      return <><path d="M9 9v3a3 3 0 0 0 5.1 2.1M15 10.5V6a3 3 0 0 0-5.8-.9" /><path d="M5.5 11.5a6.5 6.5 0 0 0 9.8 5.7M18.5 11.5a6.5 6.5 0 0 1-.4 2.3" /><path d="M12 18v3M9.5 21h5" /><path d="m4 4 16 16" /></>
    case "close":
      return <><path d="m5 5 14 14" /><path d="m19 5-14 14" /></>
    case "minimize":
      return <path d="M4 12h16" />
    case "maximize":
      return <rect x="5" y="5" width="14" height="14" rx="1.25" />
    case "pencil":
      return <><path d="m4.5 16.75-.85 3.6 3.6-.85L18.3 8.45a2.35 2.35 0 0 0-3.32-3.32z" /><path d="m13.75 6.25 4 4" /></>
    case "export":
      return <><path d="M14 4h6v6" /><path d="m20 4-9 9" /><path d="M19 13v5a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2h5" /></>
    case "archive":
      return <><path d="M4 7.5h16v11H4z" /><path d="M3.5 7.5 5 4h14l1.5 3.5" /><path d="M9 12h6" /></>
    case "restore":
      return <><path d="M5 8V4l-3 3 3 3" /><path d="M5 7.5a7 7 0 1 1-1.2 8" /></>
    case "trash":
      return <><path d="M5 7h14" /><path d="M9 7V4h6v3M7 7l.8 13h8.4L17 7" /><path d="M10 11v5M14 11v5" /></>
    case "text":
      return <path d="M5 6.5V4.5h14v2M12 4.5V19M9 19h6" />
    case "bold":
      return <path d="M7 4.5h6a3.75 3.75 0 0 1 0 7.5H7zM7 12h7a4 4 0 0 1 0 8H7z" />
    case "italic":
      return <><path d="M10 4.5h8M6 19.5h8M14.5 4.5l-5 15" /></>
    case "list":
      return <><path d="M9 6h11M9 12h11M9 18h11" /><circle cx="4.5" cy="6" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="4.5" cy="18" r="1" fill="currentColor" stroke="none" /></>
    case "list-ordered":
      return <><path d="M10 6h10M10 12h10M10 18h10M4 5h1.5v4M4 9h3M4 15.5c0-.8.7-1.3 1.4-1.3s1.3.5 1.3 1.2c0 1.3-2.7 1.6-2.7 3.1h3" /></>
    // v11.0.2 : deux guillemets ouverts. L'ancien tracé (cadre + ligne) se lisait comme
    // une page pliée dans la barre de sélection, où il signifie « citer ».
    case "quote":
      return <><path d="M9.5 16.5H7a1 1 0 0 1-1-1v-3a5 5 0 0 1 5-5" /><path d="M19.5 16.5H17a1 1 0 0 1-1-1v-3a5 5 0 0 1 5-5" /></>
    case "link":
      return <><path d="M10 14a4 4 0 0 0 5.66 0l3-3a4 4 0 1 0-5.66-5.66l-1.5 1.5" /><path d="M14 10a4 4 0 0 0-5.66 0l-3 3a4 4 0 1 0 5.66 5.66l1.5-1.5" /></>
    case "pin":
      return <><path d="M9.5 3.5h5" /><path d="M10.5 3.5v5.2L8 11.2V13h8v-1.8l-2.5-2.5V3.5" /><path d="M12 13v7.5" /></>
    case "inbox":
      return <><path d="M4 13.5 6.5 5h11L20 13.5V19H4z" /><path d="M4 13.5h4.5l1 2.5h5l1-2.5H20" /></>
    case "menu":
      return <><path d="M6 6h12M6 12h12M6 18h12" /></>
    case "grip":
      return <><circle cx="8" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="7" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="12" r="1" fill="currentColor" stroke="none" /><circle cx="8" cy="17" r="1" fill="currentColor" stroke="none" /><circle cx="16" cy="17" r="1" fill="currentColor" stroke="none" /></>
    case "dot":
      return <circle cx="12" cy="12" r="3.2" fill="currentColor" stroke="none" />
    case "archive-list":
      return <><path d="M5 5h14v14H5z" /><path d="M8 9h8M8 12h6M8 15h5" /></>
    case "check":
      return <path d="m5 12 4 4 10-10" />
    case "eye":
      return <><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" /><circle cx="12" cy="12" r="3.2" /></>
    case "copy":
      return <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V6a2 2 0 0 1 2-2h9" /></>
    case "wrench":
      return <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    case "chart":
      return <><path d="M4 20h16" /><path d="M7 20v-7" /><path d="M12 20V6" /><path d="M17 20v-10" /></>
    case "terminal":
      return <><rect x="3" y="4.5" width="18" height="15" rx="2" /><path d="m7 9.5 3.5 3L7 15.5" /><path d="M12.5 15.5H17" /></>
    case "slash":
      return <path d="m6 6 12 12" />
    case "panel":
      return <><rect x="3" y="4.5" width="18" height="15" rx="1.5" /><path d="M15 4.5v15" /><path d="M6.5 9h5M6.5 12.5h5" /></>
    case "command":
      return <><path d="M8.5 8.5h7v7h-7z" /><path d="M8.5 8.5H6a2.5 2.5 0 1 1 2.5-2.5zM15.5 8.5H18A2.5 2.5 0 1 0 15.5 6zM8.5 15.5H6A2.5 2.5 0 1 0 8.5 18zM15.5 15.5H18A2.5 2.5 0 1 1 15.5 18z" /></>
    // v11.0.2 : glyphes de rôle — chaque tracé est centré sur (12,12) pour rester
    // droit dans un bouton carré (cf. OPTICAL_NUDGE).
    // v11.0.2 : la baguette se termine par une étoile pleine (la même famille que la
    // marque). Étoile agrandie après essai dans la barre des Notes : à 5 px elle se
    // réduisait à une tache et le glyphe ressemblait à un crayon.
    case "wand":
      return <><path d="M4.5 19.5 13.4 10.6" /><path d="M17.4 2.4 18.6 5.4 21.6 6.6 18.6 7.8 17.4 10.8 16.2 7.8 13.2 6.6 16.2 5.4z" fill="currentColor" stroke="none" /></>
    case "branch":
      return <><circle cx="6.5" cy="5.8" r="2.2" /><circle cx="6.5" cy="18.2" r="2.2" /><circle cx="17.5" cy="9.6" r="2.2" /><path d="M6.5 8v8" /><path d="M8.7 6.4h2.9a3.8 3.8 0 0 1 3.8 3.8v0.6" /></>
    case "chat":
      // v12.0.0 : deux bulles qui se chevauchent — le glyphe de conversation du
      // brief. Une seule bulle se lisait comme un panneau, pas comme un échange.
      return <><path d="M14.5 14.5a2 2 0 0 1-2 2H7.6L4 20V6a2 2 0 0 1 2-2h6.5a2 2 0 0 1 2 2z" /><path d="M17 8.5h1a2 2 0 0 1 2 2V20l-3.2-2.4h-2.8a2 2 0 0 1-2-2V15" /></>
    // v11.0.2 : 10 unités se lisaient comme un point de ponctuation avant « Interrompre ».
    case "stop":
      return <rect x="6.5" y="6.5" width="11" height="11" rx="1.8" fill="currentColor" stroke="none" />
    case "paperclip":
      return <path d="M20.5 11.6 12 20.1a4.9 4.9 0 0 1-6.9-6.9l8.5-8.5a3.3 3.3 0 0 1 4.6 4.6l-8.4 8.4a1.6 1.6 0 0 1-2.3-2.3l7.7-7.7" />
  }
}

export function Icon({ name, size = 18, strokeWidth = 1.7, className, title, "aria-hidden": ariaHidden }: IconProps) {
  return (
    <svg
      className={joinClassNames("app-icon", className)}
      // v11.0.1 : le nom rendu est lisible dans le DOM — un audit peut mesurer
      // l'encre de chaque glyphe (getBBox) sans deviner l'icône par son contexte.
      data-icon={name}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={ariaHidden ?? !title}
      role={title ? "img" : undefined}
      style={{ transform: `scale(${ICON_SCALE})` }}
    >
      {title ? <title>{title}</title> : null}
      {(() => {
        const [dx, dy] = OPTICAL_NUDGE[name] ?? [0, 0]
        if (!dx && !dy) return paths(name)
        return <g transform={`translate(${dx} ${dy})`}>{paths(name)}</g>
      })()}
    </svg>
  )
}
