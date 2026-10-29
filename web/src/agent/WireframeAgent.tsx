import { useEffect, useRef } from "react"
import {
  fibonacciSphere,
  phaseEnergy,
  pointAlpha,
  project,
  wireframe,
  type AgentPhase,
  type Projected,
  type Vec3,
} from "./sphere"

// v12.0.0 : l'agent vocal EST la marque d'Aven. Une seule instance de ce canvas
// vit dans la coquille ; elle se déplace de l'accueil vers l'en-tête. Le composant
// ne décide de rien : la géométrie est pure (./sphere), la phase est celle de la
// session vocale réelle, et le mouvement s'arrête dès qu'il n'apprend rien.
//
// v12.0.0 (passe graphique) : la référence montre une CALOTTE éclairée (une surface
// pleine, pas un simple filet) posée sur un maillage de points, entourée d'une
// charpente d'instrument (anneau, rayons pointillés, nœuds carrés). Le volume venait
// d'une lueur diffuse ; il vient maintenant d'une masse opaque, et le maillage est
// creusé dedans plutôt que posé dessus.

type Props = {
  phase: AgentPhase
  /** Diamètre CSS en pixels (le canvas est rendu au DPR). */
  size: number
  className?: string
}

// v12.0.0 : densité de la référence — une surface de points, pas un semis clairsemé.
// 1 250 points restent tenables : le rendu est plafonné à 30 images/s et les points
// trop sombres sont sautés avant le tracé.
const POINTS = 1250
const WIREFRAME: Vec3[][] = wireframe(9, 14, 80)
const SURFACE = fibonacciSphere(POINTS)
// Lumière fixe, en espace écran : haut-gauche. Elle donne la lecture « volume »
// de la référence sans dépendre d'une rotation particulière.
const LIGHT_X = -0.62
const LIGHT_Y = -0.5
const LIGHT_Z = 0.58

// Rayons de la charpente, en multiples du rayon de la sphère. L'ensemble tient
// dans la boîte (1,27 × r) : rien n'est rogné par le canvas.
const RING = 1.09
const SPOKE_IN = 1.1
const SPOKE_OUT = 1.26

// v12.0.0 : les couleurs viennent des jetons, jamais d'un littéral. `withAlpha`
// évite d'inventer une couleur sombre hors thème : en clair, le disque de fond
// suit --panel au lieu d'un vert-noir opaque qui faisait une boule grise.
function withAlpha(color: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(color.trim())
  if (!match) return color
  const value = Number.parseInt(match[1], 16)
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`
}

function readColors(canvas: HTMLCanvasElement) {
  const css = getComputedStyle(canvas)
  const ink = css.getPropertyValue("--text").trim() || "#e7ebe7"
  const accent = css.getPropertyValue("--accent").trim() || "#d77a43"
  const panel = css.getPropertyValue("--panel-solid").trim() || "#111916"
  return { ink, accent, panel }
}

function strokePath(ctx: CanvasRenderingContext2D, path: Projected[], alpha: number, color: string) {
  if (path.length < 2) return
  ctx.beginPath()
  ctx.strokeStyle = color
  ctx.globalAlpha = alpha
  ctx.moveTo(path[0].x, path[0].y)
  for (let i = 1; i < path.length; i += 1) ctx.lineTo(path[i].x, path[i].y)
  ctx.closePath()
  ctx.stroke()
}

export default function WireframeAgent({ phase, size, className }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const phaseRef = useRef<AgentPhase>(phase)
  phaseRef.current = phase
  // Un repaint à la demande : en mouvement réduit, aucune boucle ne tourne — un
  // changement de phase doit quand même se voir tout de suite.
  const redrawRef = useRef<(() => void) | null>(null)
  // v12.0.0 : les jetons (--text, --accent, --panel-solid) changent avec le thème
  // et l'accent SANS que la taille du canvas bouge. Une seule lecture au montage
  // laissait la sphère peinte dans l'ancienne palette jusqu'au rechargement.
  const recolorRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    redrawRef.current?.()
  }, [phase])

  // Le thème « système » peut changer sans qu'aucune propriété du document ne
  // bouge : on écoute aussi le média, sinon la sphère gardait la palette d'avant
  // le changement d'apparence de l'OS.
  useEffect(() => {
    let frame = 0
    const refresh = () => {
      if (frame) return
      frame = window.requestAnimationFrame(() => { frame = 0; recolorRef.current?.() })
    }
    const observer = new MutationObserver(refresh)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["style", "class", "data-theme"] })
    const media = window.matchMedia("(prefers-color-scheme: dark)")
    media.addEventListener("change", refresh)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      observer.disconnect()
      media.removeEventListener("change", refresh)
    }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const ctx = canvas.getContext("2d")
    if (!ctx) return

    const dpr = Math.min(2, window.devicePixelRatio || 1)
    canvas.width = Math.round(size * dpr)
    canvas.height = Math.round(size * dpr)

    let { ink, accent, panel } = readColors(canvas)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    let raf = 0
    let last = 0
    let yaw = 0.62
    const pitch = 0.32
    let stopped = false

    const draw = (energy: ReturnType<typeof phaseEnergy>, now: number) => {
      const w = canvas.width
      const h = canvas.height
      // 0,38 : la sphère n'occupe plus toute la boîte — elle laisse la place à la
      // charpente (anneau et rayons jusqu'à 1,26 r), sans jamais être rognée.
      const radius = Math.min(w, h) * 0.38
      const cx = w / 2
      const cy = h / 2
      const t = now / 1000
      // Respiration : une seule sinusoïde, jamais un bruit aléatoire — l'onde doit
      // correspondre à une phase réelle, pas simuler une activité.
      const breathe = 1 + Math.sin(t * 2.2) * 0.012 * energy.wave
      const hair = Math.max(0.5, dpr * 0.45)

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.translate(cx, cy)
      ctx.scale(breathe, breathe)

      // Halo du noyau : une lueur très basse, pas un néon.
      const glow = ctx.createRadialGradient(-radius * 0.22, -radius * 0.26, radius * 0.05, 0, 0, radius * 1.18)
      glow.addColorStop(0, withAlpha(ink, 0.1 * energy.glow))
      glow.addColorStop(0.55, withAlpha(ink, 0.03 * energy.glow))
      glow.addColorStop(1, withAlpha(ink, 0))
      ctx.fillStyle = glow
      ctx.beginPath()
      ctx.arc(0, 0, radius * 1.18, 0, Math.PI * 2)
      ctx.fill()

      // Disque de fond : il donne un volume au dos des points. Il suit --panel-solid
      // (sombre sur fond forêt, clair sur papier) — jamais une couleur en dur.
      ctx.fillStyle = withAlpha(panel, 0.72)
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()

      // Courbes de niveau : la face non éclairée porte une cartographie fine, comme
      // la référence. Ce sont des cercles décalés, pas des données : aucune valeur
      // n'est affichée, donc rien ne peut mentir.
      ctx.save()
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.clip()
      ctx.strokeStyle = ink
      ctx.lineWidth = hair
      for (const [scale, alpha] of [[0.3, 0.15], [0.46, 0.13], [0.62, 0.11], [0.78, 0.09]] as const) {
        ctx.globalAlpha = alpha * energy.density
        ctx.beginPath()
        ctx.arc(-radius * 0.14, radius * 0.24, radius * scale, 0, Math.PI * 2)
        ctx.stroke()
      }
      ctx.globalAlpha = 1
      ctx.restore()

      // Méridiens et parallèles : la charpente filaire, volontairement ténue. La
      // référence montre surtout des POINTS sur la face sombre ; un filet trop
      // appuyé transformait la sphère en globe de bureau (vu à l'écran).
      ctx.lineWidth = hair
      for (const path of WIREFRAME) strokePath(ctx, project(path, yaw, pitch, radius), 0.075, ink)

      // v12.0.0 : LA CALOTTE. Une masse opaque côté lumière, à bord progressif :
      // c'est elle qui donne la lecture « sphère pleine » de la référence. L'alpha
      // suit la densité de la phase — au repos elle est plus sourde, jamais éteinte.
      const capAlpha = 0.55 + 0.35 * energy.density
      // `strokePath` laisse l'alpha du dernier tracé (0,15) : sans ce remise à 1, la
      // calotte se peignait à 15 % et la sphère restait une boule noire (vu à l'écran).
      ctx.globalAlpha = 1
      const cap = ctx.createRadialGradient(-radius * 0.42, -radius * 0.46, radius * 0.04, -radius * 0.34, -radius * 0.38, radius * 0.92)
      // Le terminateur est SERRÉ : une décroissance sur 25 % du rayon donnait une
      // boule de brume sans bord (mesuré sur la webview), alors que la référence
      // montre une coque au bord lisible.
      cap.addColorStop(0, withAlpha(ink, capAlpha))
      cap.addColorStop(0.56, withAlpha(ink, capAlpha * 0.98))
      cap.addColorStop(0.68, withAlpha(ink, capAlpha * 0.62))
      cap.addColorStop(0.735, withAlpha(ink, capAlpha * 0.16))
      cap.addColorStop(0.755, withAlpha(ink, 0))
      ctx.fillStyle = cap
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()

      // Le maillage est CREUSÉ dans la calotte : on le redessine dans la couleur du
      // panneau par-dessus la masse. Sur la face sombre ce trait est invisible (même
      // couleur que le disque), ce qui laisse les points seuls porter le relief.
      ctx.lineWidth = hair
      ctx.strokeStyle = withAlpha(panel, 0.62)
      for (const path of WIREFRAME) {
        ctx.beginPath()
        ctx.globalAlpha = 1
        const projected = project(path, yaw, pitch, radius)
        ctx.moveTo(projected[0].x, projected[0].y)
        for (let i = 1; i < projected.length; i += 1) ctx.lineTo(projected[i].x, projected[i].y)
        ctx.closePath()
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // ── Charpente d'instrument : anneau, rayon pointillés, nœuds carrés ──
      // Elle ne tourne PAS avec la sphère : c'est le bâti de l'instrument, pas la
      // matière. Aucune valeur affichée, aucun repère qui prétendrait mesurer.
      ctx.strokeStyle = ink
      ctx.lineWidth = hair
      ctx.globalAlpha = 0.38
      ctx.beginPath()
      ctx.arc(0, 0, radius * RING, 0, Math.PI * 2)
      ctx.stroke()

      ctx.globalAlpha = 0.26
      ctx.save()
      ctx.rotate(-0.32)
      ctx.beginPath()
      ctx.ellipse(0, 0, radius * 1.2, radius * 0.46, 0, 0, Math.PI * 2)
      ctx.stroke()
      ctx.restore()

      ctx.setLineDash([dpr * 2, dpr * 4])
      const spokes = [-2.5, -1.95, -1.4, -0.85, -0.3, 0.25, 0.8, 1.35]
      for (const [index, angle] of spokes.entries()) {
        const x1 = Math.cos(angle) * radius * SPOKE_IN
        const y1 = Math.sin(angle) * radius * SPOKE_IN
        const x2 = Math.cos(angle) * radius * SPOKE_OUT
        const y2 = Math.sin(angle) * radius * SPOKE_OUT
        ctx.globalAlpha = 0.42
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.setLineDash([])
        // Nœud carré : l'orange est réservé au signal, jamais à une décoration.
        const accentNode = index === 1 || index === 5
        ctx.fillStyle = accentNode ? accent : ink
        ctx.globalAlpha = accentNode ? 0.85 : 0.32
        const side = (accentNode ? 3 : 2) * dpr
        ctx.fillRect(x2 - side / 2, y2 - side / 2, side, side)
        ctx.setLineDash([dpr * 2, dpr * 4])
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1

      // Points : la surface. La lumière décide taille et opacité ; la profondeur
      // garde le dos lisible (une sphère filaire n'est pas une demi-sphère).
      const projected = project(SURFACE, yaw, pitch, radius)
      for (const point of projected) {
        const nx = point.x / radius
        const ny = point.y / radius
        const shade = Math.max(0, nx * LIGHT_X + ny * LIGHT_Y + point.depth * LIGHT_Z)
        // 0,34 au lieu de 0,22 : la face non éclairée doit rester une SURFACE de
        // points, pas un vide derrière un filet.
        const alpha = pointAlpha(point.depth, energy.density) * (0.34 + 0.66 * shade)
        if (alpha < 0.03) continue
        ctx.globalAlpha = Math.min(0.95, alpha)
        ctx.fillStyle = ink
        const dot = (0.55 + 1.15 * shade * shade) * dpr
        ctx.beginPath()
        ctx.arc(point.x, point.y, dot, 0, Math.PI * 2)
        ctx.fill()
      }
      ctx.globalAlpha = 1

      // Contour : le seul trait plein, il tient la silhouette lors du repli.
      ctx.strokeStyle = ink
      ctx.globalAlpha = 0.18
      ctx.lineWidth = hair
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.stroke()
      ctx.globalAlpha = 1
    }

    let lastDraw = 0
    const loop = (now: number) => {
      if (stopped) return
      const energy = phaseEnergy(phaseRef.current)
      const animate = !reduced.matches && !document.hidden && energy.spin > 0
      const delta = last ? Math.min(64, now - last) : 16
      last = now
      if (animate) {
        yaw += (delta / 1000) * energy.spin
        // 30 images/s suffit : une sphère qui tourne lentement n'a pas besoin de 60.
        if (now - lastDraw >= 32) { lastDraw = now; draw(energy, now) }
        raf = window.requestAnimationFrame(loop)
      } else {
        draw(energy, now)
      }
    }

    redrawRef.current = () => draw(phaseEnergy(phaseRef.current), performance.now())
    // v12.0.0 : relire les jetons puis repeindre — c'est la MÊME fonction draw,
    // jamais une seconde palette devinée.
    recolorRef.current = () => {
      const next = readColors(canvas)
      ink = next.ink
      accent = next.accent
      panel = next.panel
      draw(phaseEnergy(phaseRef.current), performance.now())
    }

    const start = () => {
      stopped = false
      last = 0
      lastDraw = 0
      raf = window.requestAnimationFrame(loop)
    }
    const onVisibility = () => {
      window.cancelAnimationFrame(raf)
      if (!document.hidden) start()
      else draw(phaseEnergy(phaseRef.current), performance.now())
    }
    const onMotion = () => {
      window.cancelAnimationFrame(raf)
      start()
    }

    reduced.addEventListener("change", onMotion)
    document.addEventListener("visibilitychange", onVisibility)
    // Premier dessin immédiat : pas de trou entre le montage et la première frame.
    draw(phaseEnergy(phaseRef.current), performance.now())
    start()

    return () => {
      stopped = true
      redrawRef.current = null
      recolorRef.current = null
      window.cancelAnimationFrame(raf)
      reduced.removeEventListener("change", onMotion)
      document.removeEventListener("visibilitychange", onVisibility)
    }
  }, [size])

  return <canvas ref={canvasRef} className={`aven-agent-canvas${className ? ` ${className}` : ""}`} width={size} height={size} style={{ width: size, height: size }} aria-hidden="true" />
}
