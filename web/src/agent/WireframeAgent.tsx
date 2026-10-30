import { useEffect, useRef } from "react"
import {
  AGENT_LIGHT,
  circle,
  fibonacciSphere,
  geodesicMesh,
  lightCurve,
  phaseEnergy,
  wireframe,
  withInput,
  type AgentPhase,
  type Mesh,
  type PhaseEnergy,
  type Vec3,
} from "./sphere"
// v12.6.0 : le niveau d'entrée du micro (mesuré par le VAD) anime la sphère
// PENDANT que l'utilisateur parle. Il n'est pas un état React : le relire dans
// la boucle évite de re-rendre le Poste vingt fois par seconde.
import { readLevel } from "../voice-agent/level"

// v12.0.0 : l'agent vocal EST la marque d'Aven. Une seule instance de ce canvas
// vit dans la coquille ; elle se déplace de l'accueil vers l'en-tête. Le composant
// ne décide de rien : la géométrie est pure (./sphere), la phase est celle de la
// session vocale réelle, et le mouvement s'arrête dès qu'il n'apprend rien.
//
// v12.4.0 : la calotte opaque de la v12.0.0 est RETIRÉE. Elle faisait une bille
// éclairée avec un filet posé dessus (« illumined orb with a mesh overlay », le
// défaut nommé par la référence). La sphère devient une STRUCTURE : maillage
// géodésique triangulaire irrégulier, une particule par sommet (plus une poussière
// de surface), et une lumière fixe en haut-droite qui allume les particules elles-
// mêmes — pas un dégradé radial blanc derrière elles. Le centre et la gauche
// restent charbon, le maillage y demeure lisible.

type Props = {
  phase: AgentPhase
  /** Diamètre CSS en pixels (le canvas est rendu au DPR). */
  size: number
  className?: string
}

// Lumière fixe à l'écran, haut-droite (voir AGENT_LIGHT). Elle ne tourne pas avec
// la sphère : c'est l'éclairage du lieu, pas une propriété de la matière.
const LX = AGENT_LIGHT.x
const LY = AGENT_LIGHT.y
const LZ = AGENT_LIGHT.z

// Perspective douce : la face avant grossit d'environ 8 %.
const FOCAL = 3.6

// Rayons de la charpente, en multiples du rayon de la sphère. L'ensemble tient
// dans la boîte (1,27 × r) : rien n'est rogné par le canvas.
const RING = 1.09
const SPOKE_IN = 1.1
const SPOKE_OUT = 1.26

// Deux couches de courbes internes : les latitudes/longitudes (fines, partout) et
// quelques orbites inclinées qui enroulent la surface, comme dans la référence.
const GRID = wireframe(6, 8, 64)
function tilted(points: Vec3[], ax: number, az: number): Vec3[] {
  const cx = Math.cos(ax), sx = Math.sin(ax), cz = Math.cos(az), sz = Math.sin(az)
  return points.map((p) => {
    const y1 = p.y * cx - p.z * sx
    const z1 = p.y * sx + p.z * cx
    return { x: p.x * cz - y1 * sz, y: p.x * sz + y1 * cz, z: z1 }
  })
}
// v12.4.0 : des PETITS cercles, jamais des méridiens. Un grand cercle vu de biais
// se projette en corde rectiligne : cela faisait des rayures en travers de la
// sphère au lieu de courbes qui l'enroulent.
const ORBITS: Vec3[][] = [
  tilted(circle("parallel", 0.16), Math.PI - 0.5, 0.9),
  tilted(circle("parallel", 0.3), Math.PI - 0.2, 0.4),
  tilted(circle("parallel", 0.72), 0.4, -0.5),
  tilted(circle("parallel", 0.86), 0.18, 1.15),
]
// v12.4.0 : la référence groupe quelques boucles de niveau en bas à gauche. Elles
// enroulent la SURFACE (petits cercles de la sphère), elles ne flottent pas autour.
const CONTOURS: Vec3[][] = [0.16, 0.24, 0.33].map((t, i) =>
  tilted(circle("parallel", t), Math.PI + 0.22 * i, 0.58 - 0.05 * i),
)

type Scene = { mesh: Mesh; dust: Vec3[] }
const SCENES = new Map<number, Scene>()

/** Un niveau de détail par taille rendue : le compact ne paie pas 2 500 sommets. */
function detailFor(size: number): number {
  return size >= 300 ? 5 : size >= 240 ? 4 : size >= 110 ? 3 : 2
}

function sceneFor(detail: number): Scene {
  const cached = SCENES.get(detail)
  if (cached) return cached
  const scene: Scene = {
    mesh: geodesicMesh(detail),
    // Poussière de surface : comble les mailles sans ajouter d'arêtes. Volontairement
    // plus rare que les sommets — au-delà, le semis noie la structure au lieu de la
    // révéler (mesuré : 1 100 points faisaient une surface floue).
    dust: fibonacciSphere(detail >= 5 ? 1200 : detail >= 4 ? 1000 : detail >= 3 ? 400 : 0),
  }
  SCENES.set(detail, scene)
  return scene
}

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
  // v12.4.0 : la même encre ne pèse pas pareil sur fond clair et sur fond sombre.
  // On mesure la luminance du disque et on compense les PARTICULES — jamais une
  // seconde palette. Les traits, eux, gardent leur opacité.
  const hex = /^#([0-9a-f]{6})$/i.exec(panel)
  const value = hex ? Number.parseInt(hex[1], 16) : 0x111916
  const luma = (((value >> 16) & 255) * 0.299 + ((value >> 8) & 255) * 0.587 + (value & 255) * 0.114) / 255
  // Un point clair disparaît sur un disque blanc : en thème clair, les particules
  // passent à --muted et sont atténuées — à l'encre maximale, le croissant
  // ressemblait à de la suie. Les traits, eux, gardent leur opacité.
  const light = luma > 0.55
  const muted = css.getPropertyValue("--muted").trim() || ink
  return { ink, dot: light ? muted : ink, accent, panel, dotBoost: light ? 0.55 : 1 }
}

// Six paliers d'alpha : un tracé par palier au lieu de 7 680 stroke. C'est ce qui
// permet à la maille d'être dense sans coûter une frame.
const LEVELS = 6
const LEVEL_STEP = 0.085

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

    const detail = detailFor(size)
    const { mesh, dust } = sceneFor(detail)
    const verts = mesh.vertices
    const edges = mesh.edges
    const vertCount = verts.length
    const total = vertCount + dust.length
    // Tampons réutilisés à chaque frame : aucun objet alloué dans la boucle.
    const sx = new Float32Array(total)
    const sy = new Float32Array(total)
    const sz = new Float32Array(total)
    const light = new Float32Array(total)

    let { ink, dot, accent, panel, dotBoost } = readColors(canvas)
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)")
    let raf = 0
    let last = 0
    let yaw = 0.62
    const pitch = 0.32
    let stopped = false

    // v12.6.0 : seule la voix de l'UTILISATEUR amplifie le mouvement. Pendant la
    // lecture de l'agent, les haut-parleurs reviennent par le micro : amplifier
    // sur cette mesure ferait réagir la sphère à sa propre voix.
    const currentEnergy = (): PhaseEnergy => {
      const phase = phaseRef.current
      const speaking = phase === "capturing" || phase === "listening"
      return withInput(phaseEnergy(phase), speaking ? readLevel() : 0)
    }

    const draw = (energy: ReturnType<typeof phaseEnergy>, now: number) => {
      const w = canvas.width
      const h = canvas.height
      // 0,38 : la sphère laisse la place à la charpente (anneau et rayons jusqu'à
      // 1,26 r), sans jamais être rognée.
      const radius = Math.min(w, h) * 0.38
      const cx = w / 2
      const cy = h / 2
      const t = now / 1000
      // Respiration : une seule sinusoïde, jamais un bruit aléatoire — l'onde doit
      // correspondre à une phase réelle, pas simuler une activité.
      // v12.6.0 : la respiration porte l'énergie de la phase (et le niveau du micro
      // pendant la parole) — 1,2 % au repos, jusqu'à ~4 % quand on parle.
      const breathe = 1 + Math.sin(t * 2.2) * 0.014 * energy.wave
      // v12.6.0 : les particules GROSSISSENT avec l'énergie : le réseau s'allume
      // visiblement quand l'utilisateur parle, sans changer la silhouette.
      // `dotBoost` (0,55 en thème clair) borne la croissance : des points plus gros
      // sur un disque clair blanchissent la sphère au lieu de l'allumer.
      const swell = 1 + Math.min(0.6, 0.18 * energy.wave) * dotBoost
      const hair = Math.max(0.5, dpr * 0.42)
      // Le compact (≈ 40 px CSS) ne peut pas porter des points de 2 px : ils
      // recouvrent la surface et la sphère devient une bille blanche.
      const dotScale = Math.max(0.5, Math.min(1, radius / 170))
      const sizeFade = Math.max(0.78, Math.min(1, radius / 90))
      // v12.4.0 : le disque doit être opaque — sinon la grande diagonale du fond
      // traverse la sphère et redevient l'élément dominant de la composition.
      const core = withAlpha(panel, 0.96)
      // Ambiance : sur fond clair, la même encre à 5 % disparaît. On compense par
      // luminance mesurée, sans seconde palette.
      const ambient = 0.02 * dotBoost

      ctx.setTransform(1, 0, 0, 1, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.translate(cx, cy)
      ctx.scale(breathe, breathe)

      // ── Rotation + projection, une fois par frame ──────────────────────────
      const cyw = Math.cos(yaw)
      const syw = Math.sin(yaw)
      const cp = Math.cos(pitch)
      const sp = Math.sin(pitch)
      const rotatePoint = (v: Vec3, index: number) => {
        const x1 = v.x * cyw - v.z * syw
        const z1 = v.x * syw + v.z * cyw
        const y2 = v.y * cp - z1 * sp
        const z2 = v.y * sp + z1 * cp
        const k = FOCAL / Math.max(0.001, FOCAL - z2)
        sx[index] = x1 * k * radius
        sy[index] = -y2 * k * radius
        sz[index] = z2
        // Lumière fixe à l'écran : la normale tournée donne l'éclairement du lieu.
        const dot = x1 * LX + y2 * LY + z2 * LZ
        light[index] = dot > 0 ? (dot > 1 ? 1 : dot) : 0
      }
      for (let i = 0; i < vertCount; i += 1) rotatePoint(verts[i], i)
      for (let i = 0; i < dust.length; i += 1) rotatePoint(dust[i], vertCount + i)

      // ── Volume : un disque sombre, pas une lueur ───────────────────────────
      // La référence n'a aucun halo : le fond technique de l'accueil suffit. Le
      // disque empêche seulement de voir la grille du fond à travers la matière.
      ctx.fillStyle = core
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.fill()

      // ── Courbes internes : latitudes/longitudes ténues, puis orbites inclinées
      ctx.strokeStyle = ink
      ctx.lineCap = "round"
      ctx.lineWidth = hair
      for (const path of GRID) {
        ctx.beginPath()
        projectTo(path, ctx, yaw, pitch, radius, FOCAL)
        ctx.globalAlpha = Math.min(1, (0.028 + 0.025 * energy.density))
        ctx.stroke()
      }
      for (const path of ORBITS) {
        ctx.beginPath()
        projectTo(path, ctx, yaw, pitch, radius, FOCAL)
        ctx.globalAlpha = Math.min(1, (0.08 + 0.05 * energy.density))
        ctx.stroke()
      }
      for (const path of CONTOURS) {
        ctx.beginPath()
        projectTo(path, ctx, yaw, pitch, radius, FOCAL)
        ctx.globalAlpha = Math.min(1, 0.24)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // ── Maillage : les arêtes, triées par paliers de lumière × profondeur ──
      const edgeBuckets: number[][] = Array.from({ length: LEVELS }, () => [])
      for (let e = 0; e < edges.length; e += 1) {
        const a = edges[e][0]
        const b = edges[e][1]
        const mid = (sz[a] + sz[b]) / 2
        // Occlusion VRAIE : le disque est opaque, une arête du dos est derrière la
        // matière. La dessiner, même à 15 %, superposait deux réseaux — la maille
        // devenait un griffonnage au lieu de triangles lisibles (constaté).
        if (mid <= 0) continue
        const depthK = 0.5 + 0.5 * mid
        const lit = lightCurve((light[a] + light[b]) / 2)
        const alpha = Math.min(1, Math.max(0.012, (0.026 + 0.46 * lit) * depthK))
        const level = Math.min(LEVELS - 1, Math.floor(alpha / LEVEL_STEP))
        const bucket = edgeBuckets[level]
        bucket.push(sx[a], sy[a], sx[b], sy[b])
      }
      for (let level = 0; level < LEVELS; level += 1) {
        const bucket = edgeBuckets[level]
        if (!bucket.length) continue
        ctx.beginPath()
        for (let i = 0; i < bucket.length; i += 4) {
          ctx.moveTo(bucket[i], bucket[i + 1])
          ctx.lineTo(bucket[i + 2], bucket[i + 3])
        }
        ctx.globalAlpha = (level + 0.6) * LEVEL_STEP
        ctx.lineWidth = hair
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // ── Particules : une par sommet, plus la poussière de surface ──────────
      // Leur éclat fait la lumière : les points du haut-droite sont blancs et
      // larges, ceux de l'ombre restent de petits points gris.
      const dustPaths: Path2D[] = Array.from({ length: LEVELS }, () => new Path2D())
      for (let i = 0; i < total; i += 1) {
        // Même occlusion que les arêtes : le dos de la sphère n'est pas visible.
        if (sz[i] <= 0.02) continue
        const lit = lightCurve(light[i])
        const depthK = 0.22 + 0.78 * sz[i]
        const alpha = Math.min(1, (ambient + 0.95 * lit) * depthK * (0.78 + 0.22 * energy.density) * sizeFade)
        if (alpha < 0.025) continue
        const level = Math.min(LEVELS - 1, Math.floor(alpha / (1 / LEVELS)))
        const r = (0.45 + 1.5 * Math.pow(lit, 0.8)) * dpr * dotScale * swell * (i < vertCount ? 1 : 0.78)
        dustPaths[level].moveTo(sx[i] + r, sy[i])
        dustPaths[level].arc(sx[i], sy[i], r, 0, Math.PI * 2)
      }
      ctx.fillStyle = dot
      for (let level = 0; level < LEVELS; level += 1) {
        ctx.globalAlpha = Math.min(0.94, (level + 0.75) / LEVELS)
        ctx.fill(dustPaths[level])
      }
      ctx.globalAlpha = 1

      // ── Contour et croissant lumineux ──────────────────────────────────────
      // Le limbe éclairé est un ARC, pas un dégradé : c'est lui qui détache la
      // sphère de son fond du côté de la lumière.
      ctx.strokeStyle = ink
      ctx.lineWidth = hair
      ctx.globalAlpha = 0.14
      ctx.beginPath()
      ctx.arc(0, 0, radius, 0, Math.PI * 2)
      ctx.stroke()
      const limb = Math.atan2(-LY, LX)
      for (const [span, alpha] of [[1.15, 0.1], [0.8, 0.18], [0.44, 0.3]] as const) {
        ctx.globalAlpha = Math.min(1, alpha * (0.8 + 0.15 * energy.density + 0.2 * energy.glow))
        ctx.beginPath()
        ctx.arc(0, 0, radius * 0.995, limb - span, limb + span)
        ctx.stroke()
      }
      ctx.globalAlpha = 1

      // ── Charpente d'instrument : anneau, ellipse, rayons et nœuds ──────────
      // Elle ne tourne PAS avec la sphère : c'est le bâti de l'instrument, pas la
      // matière. Aucune valeur affichée, aucun repère qui prétendrait mesurer.
      ctx.globalAlpha = 0.3
      ctx.beginPath()
      ctx.arc(0, 0, radius * RING, 0, Math.PI * 2)
      ctx.stroke()

      ctx.globalAlpha = 0.22
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
        ctx.globalAlpha = 0.3
        ctx.beginPath()
        ctx.moveTo(x1, y1)
        ctx.lineTo(x2, y2)
        ctx.stroke()
        ctx.setLineDash([])
        // Nœud carré : l'orange est réservé au signal, jamais à une décoration.
        const accentNode = index === 1 || index === 5
        ctx.fillStyle = accentNode ? accent : ink
        ctx.globalAlpha = accentNode ? 0.85 : 0.28
        const side = (accentNode ? 3 : 2) * dpr
        ctx.fillRect(x2 - side / 2, y2 - side / 2, side, side)
        ctx.setLineDash([dpr * 2, dpr * 4])
      }
      ctx.setLineDash([])
      ctx.globalAlpha = 1
    }

    /** Trace une polyligne déjà en coordonnées monde, sans fermer le chemin. */
    function projectTo(path: Vec3[], target: CanvasRenderingContext2D, y: number, p: number, scale: number, focal: number) {
      const cyy = Math.cos(y)
      const syy = Math.sin(y)
      const cpp = Math.cos(p)
      const spp = Math.sin(p)
      for (let i = 0; i < path.length; i += 1) {
        const v = path[i]
        const x1 = v.x * cyy - v.z * syy
        const z1 = v.x * syy + v.z * cyy
        const y2 = v.y * cpp - z1 * spp
        const z2 = v.y * spp + z1 * cpp
        const k = focal / Math.max(0.001, focal - z2)
        const px = x1 * k * scale
        const py = -y2 * k * scale
        if (i === 0) target.moveTo(px, py)
        else target.lineTo(px, py)
      }
      target.closePath()
    }

    let lastDraw = 0
    const loop = (now: number) => {
      if (stopped) return
      const energy = currentEnergy()
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

    redrawRef.current = () => draw(currentEnergy(), performance.now())
    // v12.0.0 : relire les jetons puis repeindre — c'est la MÊME fonction draw,
    // jamais une seconde palette devinée.
    recolorRef.current = () => {
      const next = readColors(canvas)
      ink = next.ink
      accent = next.accent
      panel = next.panel
      dotBoost = next.dotBoost
      dot = next.dot
      draw(currentEnergy(), performance.now())
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
      else draw(currentEnergy(), performance.now())
    }
    const onMotion = () => {
      window.cancelAnimationFrame(raf)
      start()
    }

    reduced.addEventListener("change", onMotion)
    document.addEventListener("visibilitychange", onVisibility)
    // Premier dessin immédiat : pas de trou entre le montage et la première frame.
    draw(currentEnergy(), performance.now())
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
