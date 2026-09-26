// Choix du backend d'envoi (v9.0.0, généralisé en v9.1.0) : Freebuff est le moteur de
// TOUS les agents (projet, code, recherche, analyse) quand une clé Codebuff est
// enregistrée et que le réglage est actif. Le bouton du composeur reste l'override
// manuel, dans les deux sens (tri-état : auto / forcé Freebuff / forcé OpenCode).
// Pur : testable avec Node seul.

export type Backend = "opencode" | "freebuff"
export type ManualChoice = boolean | null // null = automatique (règle ci-dessous), true = forcé, false = désactivé

export function effectiveBackend(options: {
  hasCodebuffKey: boolean
  pref: boolean // réglage « Utiliser Freebuff comme moteur des agents »
  manual: ManualChoice
}): Backend {
  if (options.manual !== null) return options.manual ? "freebuff" : "opencode"
  if (options.hasCodebuffKey && options.pref) return "freebuff"
  return "opencode"
}

/** Cycle du bouton du composeur : auto → forcé Freebuff → forcé OpenCode → auto. */
export function nextManualChoice(current: ManualChoice): ManualChoice {
  if (current === null) return true
  if (current === true) return false
  return null
}
