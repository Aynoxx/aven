// Pur : testable avec Node seul, sans dépendance desktop.
//
// v12.6.0 : niveau d'ENTRÉE du micro, mesuré par la boucle VAD (rms du signal).
// La sphère s'en sert pour amplifier son mouvement PENDANT que l'utilisateur
// parle. Aucun minuteur, aucune valeur inventée : sans voix, le niveau retombe,
// et micro coupé il vaut zéro — la sphère ne peut pas prétendre entendre.

/** Sous ce RMS, c'est du bruit de fond : rien à amplifier. */
const FLOOR = 0.004
/** Au-delà, la voix est déjà pleine : inutile de saturer le mouvement. */
const CEIL = 0.09
/** Retombée par mesure (~50 ms) : une attaque immédiate, une extinction douce. */
const DECAY = 0.82

let level = 0

/** Échelle perceptuelle du RMS : plancher = 0, plafond = 1, bornée. */
export function normalizeLevel(rms: number): number {
  const value = Number.isFinite(rms) ? Math.max(0, rms) : 0
  const t = (value - FLOOR) / (CEIL - FLOOR)
  return t <= 0 ? 0 : t >= 1 ? 1 : t
}

/**
 * Enregistre une mesure et renvoie le niveau lissé. L'attaque est immédiate (le
 * premier mot s'entend tout de suite), la retombée amortie : un niveau qui
 * saute à chaque trame ferait scintiller la sphère au lieu de la faire respirer.
 */
export function pushLevel(rms: number, decay = DECAY): number {
  const next = normalizeLevel(rms)
  const fall = Math.min(0.99, Math.max(0, Number.isFinite(decay) ? decay : DECAY))
  level = next > level ? next : level * fall
  return level
}

export function readLevel(): number {
  return level
}

/** Micro coupé, session terminée : plus aucune amplitude à montrer. */
export function resetLevel(): void {
  level = 0
}
