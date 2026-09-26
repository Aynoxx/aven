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
  }
}

export function Icon({ name, size = 18, strokeWidth = 1.7, className, title, "aria-hidden": ariaHidden }: IconProps) {
  return (
    <svg
      className={joinClassNames("app-icon", className)}
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
      {paths(name)}
    </svg>
  )
}
