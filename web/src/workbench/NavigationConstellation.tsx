import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from "react"
import { Icon, type IconName } from "../icons"
import { arcLayout } from "./constellation"

// v12.0.0 : la constellation est la navigation PRIMAIRE du Poste, et elle est
// TEMPORAIRE. Cinq cercles frères, posés sur un arc, sans ovale, sans dock, sans
// filet de liaison : rien ne subsiste à l'écran quand elle se referme.

export type NavDestination = {
  kind: "conversation" | "notes" | "files" | "terminal" | "orchestration"
  label: string
  icon: IconName
}

type Props = {
  destinations: NavDestination[]
  open: boolean
  /** Destination en cours de sortie : les autres cercles s'écartent. */
  leaving: NavDestination["kind"] | null
  activeKind: string
  onOpen: () => void
  onClose: () => void
  onSelect: (kind: NavDestination["kind"]) => void
}

const CLOSE_GRACE_MS = 170

export default function NavigationConstellation({
  destinations,
  open,
  leaving,
  activeKind,
  onOpen,
  onClose,
  onSelect,
}: Props) {
  const [width, setWidth] = useState(() => (typeof window === "undefined" ? 1200 : window.innerWidth))
  const closeTimer = useRef<number | null>(null)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const nodeRefs = useRef<Array<HTMLButtonElement | null>>([])
  // Le survol ouvre, mais ne déplace pas le focus clavier : voler le focus sous
  // la souris ferait perdre la frappe en cours ailleurs dans le Poste.
  const focusOnOpen = useRef(false)

  useEffect(() => {
    const onResize = () => setWidth(window.innerWidth)
    window.addEventListener("resize", onResize)
    return () => window.removeEventListener("resize", onResize)
  }, [])

  const cancelClose = () => {
    if (closeTimer.current !== null) {
      window.clearTimeout(closeTimer.current)
      closeTimer.current = null
    }
  }

  const scheduleClose = () => {
    cancelClose()
    closeTimer.current = window.setTimeout(() => { closeTimer.current = null; onClose() }, CLOSE_GRACE_MS)
  }

  useEffect(() => cancelClose, [])

  // Le focus suit une ouverture EXPLICITE : la destination courante d'abord,
  // sinon la première. Sans cela, ouvrir au clavier laisserait le focus sur la
  // poignée, derrière le panneau.
  useEffect(() => {
    if (!open || leaving || !focusOnOpen.current) return
    focusOnOpen.current = false
    const index = Math.max(0, destinations.findIndex((d) => d.kind === activeKind))
    nodeRefs.current[index]?.focus()
  }, [open, leaving, activeKind, destinations])

  const onNodeKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const count = destinations.length
    const current = nodeRefs.current.findIndex((node) => node === document.activeElement)
    let next: number | null = null
    if (event.key === "ArrowRight") next = (Math.max(0, current) + 1) % count
    else if (event.key === "ArrowLeft") next = (Math.max(0, current) - 1 + count) % count
    else if (event.key === "Home") next = 0
    else if (event.key === "End") next = count - 1
    else if (event.key === "Escape") {
      event.preventDefault()
      event.stopPropagation()
      onClose()
      triggerRef.current?.focus()
      return
    }
    if (next === null) return
    event.preventDefault()
    nodeRefs.current[next]?.focus()
  }

  const nodes = arcLayout(destinations.length, width)

  return (
    <div className="wb-nav">
      <div className="wb-nav-zone" data-open={open} onPointerLeave={open ? scheduleClose : undefined}>
        {/* La poignée PASSE AVANT l'arc dans le DOM : Tab part de la poignée et
            entre dans les cercles, au lieu de sauter par-dessus le panneau. */}
        <button
          ref={triggerRef}
          type="button"
          className="wb-nav-trigger"
          aria-expanded={open}
          aria-controls={open ? "wb-nav-arc" : undefined}
          aria-label={open ? "Fermer la navigation" : "Ouvrir la navigation"}
          title={open ? "Fermer la navigation (Échap)" : "Navigation — ouvre les cinq destinations"}
          onPointerEnter={() => { focusOnOpen.current = false; cancelClose(); onOpen() }}
          onClick={() => {
            if (open) { onClose() } else { focusOnOpen.current = true; onOpen() }
          }}
        >
          <span className="wb-nav-dots" aria-hidden="true"><i /><i /><i /></span>
          {/* Le mot n'apparaît qu'au survol/focus : au repos, le repère reste un
              symbole, comme le demande le brief. */}
          <span className="wb-nav-word" aria-hidden="true">Navigation</span>
        </button>

        {open && (
          <div
            className="wb-nav-arc"
            id="wb-nav-arc"
            data-open="true"
            data-leaving={leaving ? "true" : "false"}
            onKeyDown={onNodeKeyDown}
          >
            {/* Pas de <nav> : ces cinq boutons SONT la navigation, mais un <nav>
                autour d'eux suggérait une barre. Un groupe nommé suffit. */}
            <div role="group" aria-label="Destinations du Poste">
              {destinations.map((destination, index) => {
                const node = nodes[index] ?? { x: 0, y: 0, delay: 0, exitX: 0 }
                const current = destination.kind === activeKind
                const chosen = destination.kind === leaving
                return (
                  <div
                    key={destination.kind}
                    className="wb-nav-node"
                    data-current={current ? "true" : undefined}
                    data-chosen={leaving ? (chosen ? "true" : "false") : undefined}
                    data-index={index}
                    style={{
                      left: `calc(50% + ${node.x}px)`,
                      bottom: `${node.y}px`,
                      ["--stagger-i" as string]: node.delay,
                      ["--exit-x" as string]: `${node.exitX}px`,
                    }}
                    onPointerEnter={cancelClose}
                    onPointerLeave={scheduleClose}
                  >
                    <button
                      ref={(element) => { nodeRefs.current[index] = element }}
                      type="button"
                      className="wb-nav-circle"
                      aria-current={current ? "page" : undefined}
                      aria-label={destination.label}
                      onClick={() => onSelect(destination.kind)}
                    >
                      <Icon name={destination.icon} size={24} />
                    </button>
                    <span className="wb-nav-label" aria-hidden="true">{destination.label.toUpperCase()}</span>
                  </div>
                )
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
