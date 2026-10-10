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
// v9.7.1 : `source` pose data-vt-source AVANT la capture (le CSS sélectionne la carte
// source et la page cible par ce nom — morph carte→page) et le retire APRÈS la fin de
// la transition (sinon deux vues portent le même view-transition-name ensuite).
// v10.0.1 : la mise à jour ne s'exécute qu'UNE seule fois, qu'elle vienne du callback
// navigateur ou des filets de secours — un changement d'état ne se perd JAMAIS :
//   · startViewTransition qui LÈVE (view-transition-name en double, capture refusée)
//     → update() appliqué directement ;
//   · callback navigateur jamais invoqué (fenêtre gelée en arrière-plan)
//     → filet de 1 s : update() appliqué quand même, source libérée.
export function withViewTransition(update: () => void, source?: string): void {
  // Node (tests) n'a pas de DOM : le typeof-garde rend le fallback le chemin par défaut.
  const doc = (typeof document !== "undefined" ? document : undefined) as DocumentVT | undefined
  if (!doc || typeof doc.startViewTransition !== "function" || prefersReducedMotion()) {
    update()
    return
  }
  const setSource = (v: string | null) => {
    if (v) doc.documentElement.dataset.vtSource = v
    else delete doc.documentElement.dataset.vtSource
  }
  setSource(source ?? null)
  let applied = false
  const apply = () => { if (!applied) { applied = true; update() } }
  let transition: { finished: Promise<void> } | undefined
  try {
    transition = doc.startViewTransition(() => new Promise<void>((resolve) => {
      apply()
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    }))
  } catch {
    apply()
  }
  let done = false
  const clear = () => { if (!done) { done = true; setSource(null) } }
  // v9.7.1 : le retrait NE DÉPEND PAS seulement de `finished` — une fenêtre en
  // arrière-plan peut geler l'animation et laisser l'attribut orphelin indéfiniment
  // (constaté au smoke CDP). Filet : timeout de 2 s (durée > au morph le plus long).
  const safety = setTimeout(clear, 2000)
  // v10.0.1 : filet anti-gel — si le callback navigateur n'est jamais invoqué,
  // la page resterait bloquée sur l'ancien état : on applique la mise à jour.
  const stuck = setTimeout(() => { apply(); clear() }, 1000)
  // v10.0.1 : finished REJETÉE (transition annulée/sautée) est attrapée AVANT
  // finally — nettoyage assuré, jamais d'unhandledRejection.
  const finished = Promise.resolve(transition?.finished).catch(() => undefined)
  void finished.finally(() => { clearTimeout(stuck); clearTimeout(safety); clear() })
}

export function prefersReducedMotion(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function"
    && window.matchMedia("(prefers-reduced-motion: reduce)").matches
}
