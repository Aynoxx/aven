import { flushSync } from "react-dom"
import { withViewTransition as runViewTransition } from "../view-transitions"

// v10.3.2 : le callback d'une transition de vue s'exécute HORS d'un rendu React.
// Sans commit synchrone, la capture ::new pouvait photographier l'ancien écran ;
// `flushSync` garantit que l'état est peint avant la capture. Constaté dans l'app
// réelle : avec l'attente de rAF du module, aucune transition n'animait du tout.
// v10.4.0 : le wrapper vit ici, partagé par le contrôleur, le shell et la page d'accueil.
export function withViewTransition(update: () => void, source?: string) {
  runViewTransition(() => flushSync(update), source)
}
