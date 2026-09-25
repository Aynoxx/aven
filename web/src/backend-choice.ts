// Choix du backend d'envoi (v9.0.0) : Freebuff est prioritaire sur l'agent code quand une
// clé Codebuff est enregistrée et que le réglage est actif. Le bouton du composeur reste
// l'override manuel, dans les deux sens (tri-état : auto / forcé Freebuff / forcé OpenCode).
// Pur : testable avec Node seul.

export type Backend = "opencode" | "freebuff"
export type ManualChoice = boolean | null // null = automatique (règle ci-dessous), true = forcé, false = désactivé

export function effectiveBackend(options: {
  tab: string
  hasCodebuffKey: boolean
  pref: boolean // réglage « Freebuff par défaut pour l'agent code »
  manual: ManualChoice
}): Backend {
  if (options.manual !== null) return options.manual ? "freebuff" : "opencode"
  if (options.hasCodebuffKey && options.pref && options.tab === "code") return "freebuff"
  return "opencode"
}

/** Cycle du bouton du composeur : auto → forcé Freebuff → forcé OpenCode → auto. */
export function nextManualChoice(current: ManualChoice): ManualChoice {
  if (current === null) return true
  if (current === true) return false
  return null
}
