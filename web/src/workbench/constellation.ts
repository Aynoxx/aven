// Pur : testable avec Node seul, sans dépendance desktop.
//
// v12.0.0 : les cinq destinations ne sont pas une barre — ce sont des nœuds posés
// sur un arc. La géométrie vit ici pour que le composant ne calcule rien et que
// l'arc reste symétrique à toutes les largeurs.

export type ArcNode = {
  index: number
  /** Décalage horizontal depuis le centre, en pixels. */
  x: number
  /** Hauteur au-dessus du bas de l'arc (0 = au ras du déclencheur). */
  y: number
  /** Retard de cascade, en unités de --stagger-i. */
  delay: number
  /** Écart horizontal à la sortie, vers le bord le plus proche. */
  exitX: number
}

const MAX_SPAN = 620
const MIN_SPAN = 300
const RISE = 38
const RISE_SMALL = 26
const NODE_GAP = 84

/**
 * Arc peu profond : le nœud central est le plus haut, les extrémités reposent
 * près du déclencheur. `width` est la largeur utile de la fenêtre.
 */
export function arcLayout(count: number, width: number): ArcNode[] {
  const n = Math.max(0, Math.floor(count))
  if (n === 0) return []
  if (n === 1) return [{ index: 0, x: 0, y: RISE, delay: 0, exitX: 0 }]

  const available = Math.max(0, width)
  const needed = n * NODE_GAP
  const span = Math.max(MIN_SPAN, Math.min(MAX_SPAN, Math.min(available * 0.82, needed)))
  const rise = available < 760 ? RISE_SMALL : RISE
  const middle = (n - 1) / 2

  return Array.from({ length: n }, (_, index) => {
    const t = index / (n - 1)
    const x = -span / 2 + t * span
    const normalized = (index - middle) / middle
    const y = rise * (1 - normalized * normalized)
    // Sortie : vers le bord le plus proche. Un nœud parfaitement central (nombre
    // impair) part du côté où il y a le plus de place — jamais zéro, sinon il
    // resterait au milieu pendant que les autres s'écartent.
    const side = x !== 0 ? Math.sign(x) : index < middle ? -1 : 1
    const exitX = side * (220 + Math.abs(x) * 0.35)
    return { index, x, y, delay: Math.round(Math.abs(index - middle)), exitX }
  })
}

/** Index du nœud à gauche/droite de l'arc, avec bouclage (même contrat que les listes). */
export function arcNeighbor(index: number, count: number, direction: 1 | -1): number {
  if (count <= 0) return -1
  const current = index < 0 ? 0 : index
  return (current + direction + count) % count
}
