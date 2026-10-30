// Pur : testable avec Node seul, sans dépendance desktop.
//
// v12.0.0 : la sphère filaire est l'identité vocale du Poste. Sa géométrie vit
// ici — points de Fibonacci, grands cercles, projection orthographique — pour
// que le rendu Canvas ne décide d'aucun calcul. Le composant ne fait que peindre.

export type Vec3 = { x: number; y: number; z: number }

export type Projected = {
  x: number
  y: number
  /** Profondeur normalisée : 1 = face à la caméra, -1 = dos. */
  depth: number
  /** Face visible : sert au tri d'alpha, jamais à retirer un point. */
  front: boolean
}

/**
 * Les sept phases RÉELLES de la session vocale (web/src/voice-agent/session.ts).
 * Aucune phase inventée : si le système n'en expose pas, la sphère n'en montre
 * pas. Les intensités sont déterministes — un rendu qui tremble au hasard
 * suggérerait une activité qui n'existe pas.
 */
export type AgentPhase =
  | "muted"
  | "listening"
  | "capturing"
  | "transcribing"
  | "thinking"
  | "speaking"
  | "error"

export const AGENT_PHASES: readonly AgentPhase[] = [
  "muted",
  "listening",
  "capturing",
  "transcribing",
  "thinking",
  "speaking",
  "error",
] as const

export type PhaseEnergy = {
  /** Tours par seconde, en proportion (0 = immobile). */
  spin: number
  /** Multiplicateur de densité de points allumés (0,55–1). */
  density: number
  /** Amplitude du halo respirant (0 = aucun). */
  wave: number
  /** Intensité du noyau lumineux (0–1). */
  glow: number
}

const ENERGY: Record<AgentPhase, PhaseEnergy> = {
  // Micro coupé : la sphère tourne encore (elle est vivante), mais lentement,
  // et elle n'affirme aucune écoute.
  muted: { spin: 0.012, density: 0.55, wave: 0, glow: 0.18 },
  // Écoute : respiration lente, la plus grande surface de points visible.
  listening: { spin: 0.035, density: 0.9, wave: 0.45, glow: 0.42 },
  // v12.6.0 : la capture est le moment où l'UTILISATEUR parle — elle est la phase
  // la plus vivante (rotation et respiration accrues), et `withInput` l'amplifie
  // encore avec le niveau réel du micro. C'était le défaut signalé : la sphère
  // bougeait autant quand on se taisait que quand on parlait.
  capturing: { spin: 0.085, density: 1, wave: 1, glow: 0.72 },
  transcribing: { spin: 0.06, density: 0.95, wave: 0.45, glow: 0.5 },
  thinking: { spin: 0.09, density: 0.85, wave: 0.2, glow: 0.6 },
  speaking: { spin: 0.045, density: 1, wave: 1, glow: 0.7 },
  error: { spin: 0.015, density: 0.7, wave: 0, glow: 0.25 },
}

export function phaseEnergy(phase: AgentPhase): PhaseEnergy {
  return ENERGY[phase] ?? ENERGY.muted
}

/**
 * v12.6.0 : module l'énergie d'une phase par le niveau d'entrée du micro (0–1,
 * mesuré par le VAD). Le mouvement devient plus ample quand on parle et retombe
 * au silence — aucune animation ne simule une voix absente. Pure, donc testable.
 */
export function withInput(energy: PhaseEnergy, level: number): PhaseEnergy {
  const l = Math.min(1, Math.max(0, Number.isFinite(level) ? level : 0))
  if (l === 0) return energy
  return {
    spin: energy.spin * (1 + 0.8 * l),
    density: Math.min(1, energy.density + 0.25 * l),
    wave: energy.wave + 1.6 * l,
    glow: Math.min(1, energy.glow + 0.35 * l),
  }
}

/**
 * Points répartis selon la spirale de Fibonacci : déterministe, sans amas aux
 * pôles. Chaque vecteur est unitaire.
 */
export function fibonacciSphere(count: number): Vec3[] {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  const points: Vec3[] = []
  const golden = Math.PI * (3 - Math.sqrt(5))
  for (let i = 0; i < n; i += 1) {
    // y de 1 à -1 (pôle nord au premier point), rayon de l'anneau en conséquence.
    const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    const theta = golden * i
    points.push({ x: Math.cos(theta) * radius, y, z: Math.sin(theta) * radius })
  }
  return points
}

/**
 * Projection avec rotation yaw (autour de Y) puis pitch (autour de X). `scale`
 * est le rayon en pixels. `focal` active la PERSPECTIVE (distance caméra en
 * rayons) : la face avant grossit légèrement, ce qui donne le volume de la
 * référence. Sans `focal`, la projection reste orthographique — comportement
 * d'origine, conservé pour les tests et les tracés de construction.
 */
export function project(points: Vec3[], yaw: number, pitch: number, scale: number, focal = Infinity): Projected[] {
  const cy = Math.cos(yaw)
  const sy = Math.sin(yaw)
  const cp = Math.cos(pitch)
  const sp = Math.sin(pitch)
  return points.map((point) => {
    // Yaw positif = la face droite vient vers la caméra (convention du test).
    const x1 = point.x * cy - point.z * sy
    const z1 = point.x * sy + point.z * cy
    const y2 = point.y * cp - z1 * sp
    const z2 = point.y * sp + z1 * cp
    const k = Number.isFinite(focal) ? focal / Math.max(0.001, focal - z2) : 1
    return { x: x1 * k * scale, y: -y2 * k * scale, depth: z2, front: z2 >= 0 }
  })
}

/**
 * Un grand cercle de la sphère. `t` est une position normalisée dans la
 * famille : 0,5 = équateur pour un parallèle ; 0–1 = rotation du plan pour un
 * méridien. Tous les points sont unitaires.
 */
export function circle(axis: "parallel" | "meridian", t: number, segments = 64): Vec3[] {
  const steps = Math.max(8, Math.floor(segments))
  const points: Vec3[] = []
  if (axis === "parallel") {
    const clamped = Math.min(1, Math.max(0, t))
    const y = 1 - clamped * 2
    const radius = Math.sqrt(Math.max(0, 1 - y * y))
    for (let i = 0; i < steps; i += 1) {
      const angle = (i / steps) * Math.PI * 2
      points.push({ x: Math.cos(angle) * radius, y, z: Math.sin(angle) * radius })
    }
    return points
  }
  // Méridien : grand cercle vertical, plan tourné autour de Y.
  const phi = t * Math.PI
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  for (let i = 0; i < steps; i += 1) {
    const angle = (i / steps) * Math.PI * 2
    const x = Math.cos(angle)
    const y = Math.sin(angle)
    points.push({ x: x * cos, y, z: x * sin })
  }
  return points
}

/**
 * Grille filaire complète : parallèles et méridiens, chacun étant une polyligne
 * de vecteurs unitaires. Le rendu décide de l'alpha, pas la géométrie.
 */
export function wireframe(parallels = 9, meridians = 14, segments = 72): Vec3[][] {
  const paths: Vec3[][] = []
  const rows = Math.max(2, Math.floor(parallels))
  for (let i = 1; i < rows; i += 1) paths.push(circle("parallel", i / rows, segments))
  const cols = Math.max(2, Math.floor(meridians))
  for (let i = 0; i < cols; i += 1) paths.push(circle("meridian", i / cols, segments))
  return paths
}

/** Une opacité de point lisible : la face avant pèse plus que le dos. */
export function pointAlpha(depth: number, density: number): number {
  const depthFactor = 0.18 + 0.82 * ((depth + 1) / 2)
  return Math.min(1, Math.max(0, depthFactor * density))
}

// ── v12.4.0 : la structure de la référence ─────────────────────────────────
// La v12.0.0 posait une calotte opaque sur un semis de points : une bille éclairée
// avec un filet. La référence est l'inverse — une STRUCTURE : maillage triangulaire
// irrégulier, particules sur chaque sommet, lumière qui vient du haut-droite et
// laisse le centre et la gauche dans l'ombre. La géométrie est calculée ici, une
// fois par niveau de détail, et testée sans canvas.

export type Triangle = [number, number, number]
export type Mesh = {
  /** Sommets unitaires, décalés d'un jitter déterministe (jamais du hasard). */
  vertices: Vec3[]
  triangles: Triangle[]
  /** Arêtes uniques, ordonnées sommet bas → sommet haut. */
  edges: [number, number][]
}

function unit(v: Vec3): Vec3 {
  const n = Math.hypot(v.x, v.y, v.z) || 1
  return { x: v.x / n, y: v.y / n, z: v.z / n }
}

/**
 * Bruit déterministe dans [0,1) : deux rendus successifs doivent être identiques
 * au pixel près. Un `Math.random` ferait scintiller la sphère à chaque frame.
 */
function noise(index: number): number {
  const raw = Math.sin(index * 91.73 + 17.19) * 43758.5453
  return raw - Math.floor(raw)
}

/** Icosphere de base : 12 sommets, 20 faces — le plus régulier des polyèdres. */
function baseIcosahedron(): { vertices: Vec3[]; triangles: Triangle[] } {
  const t = (1 + Math.sqrt(5)) / 2
  const vertices = [
    { x: -1, y: t, z: 0 }, { x: 1, y: t, z: 0 }, { x: -1, y: -t, z: 0 }, { x: 1, y: -t, z: 0 },
    { x: 0, y: -1, z: t }, { x: 0, y: 1, z: t }, { x: 0, y: -1, z: -t }, { x: 0, y: 1, z: -t },
    { x: t, y: 0, z: -1 }, { x: t, y: 0, z: 1 }, { x: -t, y: 0, z: -1 }, { x: -t, y: 0, z: 1 },
  ].map(unit)
  const triangles: Triangle[] = [
    [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
    [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
    [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
    [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
  ]
  return { vertices, triangles }
}

/**
 * Maillage géodésique : chaque niveau quadruple les faces (20 · 4^n). Les milieux
 * sont projetés sur la sphère puis décalés d'une fraction de rayon — la référence
 * montre des triangles de tailles inégales, pas une grille parfaite. Le jitter
 * reste faible (< 2 %) pour que la silhouette demeure sphérique.
 */
export function geodesicMesh(detail = 3, jitter = 0.016, skew = 0.03): Mesh {
  const levels = Math.max(0, Math.min(5, Math.floor(detail)))
  const amount = Math.max(0, Math.min(0.06, jitter))
  const slid = Math.max(0, Math.min(0.12, skew))
  const base = baseIcosahedron()
  const vertices = [...base.vertices]
  let triangles = base.triangles

  for (let level = 0; level < levels; level += 1) {
    const cache = new Map<number, number>()
    const next: Triangle[] = []
    const midpoint = (a: number, b: number): number => {
      const key = a < b ? a * 1_000_003 + b : b * 1_000_003 + a
      const found = cache.get(key)
      if (found !== undefined) return found
      const va = vertices[a]
      const vb = vertices[b]
      const mid = unit({ x: (va.x + vb.x) / 2, y: (va.y + vb.y) / 2, z: (va.z + vb.z) / 2 })
      const delta = (noise(vertices.length * 3 + cache.size) - 0.5) * 2 * amount
      vertices.push(unit({ x: mid.x * (1 + delta), y: mid.y * (1 + delta), z: mid.z * (1 + delta) }))
      const index = vertices.length - 1
      cache.set(key, index)
      return index
    }
    for (const [a, b, c] of triangles) {
      const ab = midpoint(a, b)
      const bc = midpoint(b, c)
      const ca = midpoint(c, a)
      next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca])
    }
    triangles = next
  }

  // v12.4.0 : le jitter radial ne suffit pas — une icosphere reste une grille
  // parfaite, et la référence montre des triangles INÉGAUX. On décale donc chaque
  // sommet dans son plan tangent (déterministe, jamais au hasard) : la maille perd
  // sa régularité sans que la silhouette cesse d'être une sphère.
  if (slid > 0) {
    for (let i = 0; i < vertices.length; i += 1) {
      const v = vertices[i]
      const helper = Math.abs(v.y) < 0.9 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 }
      const t1 = unit({
        x: v.y * helper.z - v.z * helper.y,
        y: v.z * helper.x - v.x * helper.z,
        z: v.x * helper.y - v.y * helper.x,
      })
      const t2 = {
        x: v.y * t1.z - v.z * t1.y,
        y: v.z * t1.x - v.x * t1.z,
        z: v.x * t1.y - v.y * t1.x,
      }
      const a = (noise(i * 2 + 11) - 0.5) * 2 * slid
      const b = (noise(i * 2 + 12) - 0.5) * 2 * slid
      vertices[i] = unit({
        x: v.x + t1.x * a + t2.x * b,
        y: v.y + t1.y * a + t2.y * b,
        z: v.z + t1.z * a + t2.z * b,
      })
    }
  }

  const seen = new Set<number>()
  const edges: [number, number][] = []
  for (const [a, b, c] of triangles) {
    for (const [i, j] of [[a, b], [b, c], [c, a]] as const) {
      const key = i < j ? i * 1_000_003 + j : j * 1_000_003 + i
      if (seen.has(key)) continue
      seen.add(key)
      edges.push([Math.min(i, j), Math.max(i, j)])
    }
  }
  return { vertices, triangles, edges }
}

/**
 * Lumière FIXE À L'ÉCRAN, haut-droite (la référence : le croissant lumineux est
 * en haut à droite, le centre et la gauche restent charbon). Un vecteur unitaire
 * côté scène : x vers la droite, y vers le haut, z vers la caméra.
 *
 * v12.4.0 : z est volontairement FAIBLE (0,30) — une lumière franchement frontale
 * allumait le centre de la sphère et donnait une bille grise. Rasante, elle allume
 * le bord haut-droite et laisse l'intérieur sombre, comme sur la référence.
 */
export const AGENT_LIGHT: Vec3 = unit({ x: 0.7, y: 0.6, z: 0.55 })

/** Produit scalaire normale · lumière, borné à [0,1] : 0 = face opposée. */
export function lightAt(normal: Vec3, light: Vec3 = AGENT_LIGHT): number {
  const dot = normal.x * light.x + normal.y * light.y + normal.z * light.z
  return dot <= 0 ? 0 : dot >= 1 ? 1 : dot
}

/**
 * Courbe de lumière : concentre l'éclat sur l'hémisphère haut-droite tout en
 * gardant un plancher dans l'ombre (le maillage doit rester lisible partout).
 */
export function shadeAlpha(light: number, ambient = 0.1): number {
  const lit = Math.min(1, Math.max(0, Number.isFinite(light) ? light : 0))
  return ambient + (1 - ambient) * Math.pow(lit, 2)
}

/**
 * v12.4.0 : la lumière n'est pas un projecteur ponctuel mais une source LARGE.
 * Un simple `dot^2` ne laissait qu'un liseré le long du limbe ; un smoothstep
 * élargit le plateau éclairé (comme une boîte à lumière) sans déplacer le pic ni
 * toucher au centre, qui reste sombre. Pure, donc testable.
 */
export function lightCurve(dot: number): number {
  const t = Math.min(1, Math.max(0, (Number.isFinite(dot) ? dot : 0) - 0.18) / 0.82)
  return t * t * (3 - 2 * t)
}
