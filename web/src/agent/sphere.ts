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
  listening: { spin: 0.035, density: 0.9, wave: 0.35, glow: 0.42 },
  capturing: { spin: 0.05, density: 1, wave: 0.8, glow: 0.55 },
  transcribing: { spin: 0.06, density: 0.95, wave: 0.45, glow: 0.5 },
  thinking: { spin: 0.09, density: 0.85, wave: 0.2, glow: 0.6 },
  speaking: { spin: 0.045, density: 1, wave: 1, glow: 0.7 },
  error: { spin: 0.015, density: 0.7, wave: 0, glow: 0.25 },
}

export function phaseEnergy(phase: AgentPhase): PhaseEnergy {
  return ENERGY[phase] ?? ENERGY.muted
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
 * Projection orthographique avec rotation yaw (autour de Y) puis pitch
 * (autour de X). `scale` est le rayon en pixels.
 */
export function project(points: Vec3[], yaw: number, pitch: number, scale: number): Projected[] {
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
    return { x: x1 * scale, y: -y2 * scale, depth: z2, front: z2 >= 0 }
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
