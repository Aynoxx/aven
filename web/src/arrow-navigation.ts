// Navigation clavier des listes du hub (v9.1.6) : flèches Haut/Bas pour se déplacer
// parmi les items, Entrée/Espace laissent le comportement natif du <button> agir.
// Logique décisionnelle PURE (règle RULES.md §8) : le DOM reste dans App.tsx, ici on
// ne fait que calculer l'index suivant — testable avec Node seul, sans React.

export type ArrowKey = "ArrowDown" | "ArrowUp" | "Home" | "End"

/**
 * Calcule l'index de l'item à activer après une touche de navigation.
 *  - ArrowDown / ArrowUp : déplacement d'un item, avec bouclage (haut → dernier) ;
 *  - Home / End : premier / dernier item ;
 *  - toute autre touche : l'index courant est conservé (retour null = « pas de
 *    changement », l'appelant ne re-render ni ne re-focus).
 * L'index -1 (rien de sélectionné) + ArrowDown démarre sur le premier item.
 */
export function nextArrowIndex(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  switch (key) {
    case "ArrowDown":
      return current < 0 || current >= count - 1 ? 0 : current + 1
    case "ArrowUp":
      return current < 0 || current <= 0 ? count - 1 : current - 1
    case "Home":
      return 0
    case "End":
      return count - 1
    default:
      return null
  }
}

/**
 * Index par défaut quand une liste s'ouvre : le premier item (0) est présélectionné
 * pour qu'Entrée agisse immédiatement — sauf si `preferActive` désigne un item
 * (ex. projet actif) qu'on présélectionne à sa place.
 */
export function initialArrowIndex(count: number, preferActive = -1): number {
  if (count <= 0) return -1
  return preferActive >= 0 && preferActive < count ? preferActive : 0
}
