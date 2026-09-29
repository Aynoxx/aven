// v9.7.0 : View Transitions API — transitions de vue NATIVES Chromium (Electron embarque
// Chrome 134), zéro dépendance. `withViewTransition(fn)` enveloppe un changement d'état
// React : le navigateur capture l'ancien rendu, applique fn(), puis anime ancien→nouveau
// (::view-transition-old/new). Sans support de l'API (ou prefers-reduced-motion), fn()
// s'exécute directement — dégradation silencieuse, jamais de blocage.
// Logique DOM pure : testable sans charger de .tsx (limite du runner de tests).

type DocumentVT = Document & {
  startViewTransition?: (update: () => void | Promise<void>) => { finished: Promise<void> }
}

// Le callback de mise à jour est SYNCHRONE côté React 18 (les setState batchés hors
// d'actu se vident au microtask suivant) : on double requestAnimationFrame pour garantir
// que le nouveau rendu est peint AVANT que la capture ::new ne se fasse.
export function withViewTransition(update: () => void, name?: string): void {
  // Node (tests) n'a pas de DOM : le typeof-garde rend le fallback le chemin par défaut.
  const doc = (typeof document !== "undefined" ? document : undefined) as DocumentVT | undefined
  if (!doc || typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    update()
    return
  }
  if (name) setTransitionName(name)
  doc.startViewTransition(() => new Promise<void>((resolve) => {
    update()
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
  }))
}

// Shared element : donne le view-transition-name à la carte source juste avant la
// capture, et le retire après (sinon deux éléments porteraient le même nom en permanence).
export function setTransitionName(name: string | null): void {
  document.documentElement.dataset.vtSource = name ?? ""
}

// Le CSS ne peut pas interroger dataset depuis l'attribut sélecteur dynamiquement :
// ce helper construit le sélecteur d'attribut utilisé par App.css.
export function transitionNameSelector(): string {
  return "[data-vt-source]"
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
