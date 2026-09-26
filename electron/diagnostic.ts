// Diagnostic copiable (v9.1.0) : un JSON lisible qui décrit l'installation sans JAMAIS
// contenir une clé API (ni les valeurs enregistrées, ni une clé qui aurait fui dans un
// message d'erreur du tampon — la rédaction passe sur le document ENTIER, dernière ligne
// de défense). Pur : testable avec Node seul ; le test anti-fuite plante une fausse clé
// dans le tampon et vérifie qu'elle n'apparaît nulle part.
export type DiagnosticInput = {
  versions: Record<string, string | undefined>
  platform: string
  status: string
  opencodeVersion?: string
  cli?: string
  /** Identifiants des clés PRÉSENTES (ex. "openrouter") — jamais les valeurs. */
  keyIds: string[]
  /** Chaînes de modèles par agent (refs + libellés — aucune clé API). */
  assignments?: Record<string, { ref: string; label: string }[]>
  warning?: string
  keyWarnings?: Record<string, string>
  workspace?: string
  workspaces?: { path: string; name: string }[]
  /** Derniers événements internes : un message peut contenir n'importe quoi. */
  log: string[]
}

/**
 * Masque tout ce qui ressemble à un secret : formats usuels (sk-…, gsk_…,Bearer…)
 * et affectations `clé= valeur` / `token: valeur` longues. Over-large volontairement :
 * autant masquer un faux positif qu'exposer une vraie clé.
 */
export function redactSecrets(text: string): string {
  return String(text)
    .replace(/\b(sk|gsk|rk|dsk)-[A-Za-z0-9_-]{6,}/g, "$1-***")
    .replace(/\b(gsk_|xoxb-|hf_)[A-Za-z0-9_-]{6,}/g, "$1***")
    .replace(/\bBearer\s+[A-Za-z0-9._-]{8,}/gi, "Bearer ***")
    .replace(/\b(api[_-]?key|token|authorization|password)\s*[=:]\s*[^\s",;]{8,}/gi, "$1=***")
}

export function buildDiagnostic(input: DiagnosticInput): string {
  const warnings = [input.warning, ...Object.values(input.keyWarnings ?? {})].filter(Boolean)
  const doc = {
    app: "Aven",
    versions: input.versions,
    platform: input.platform,
    engine: { status: input.status, opencodeVersion: input.opencodeVersion, cli: input.cli },
    // Aucune valeur de clé ne doit JAMAIS arriver ici : seulement les ids de providers.
    keys: { present: input.keyIds },
    agents: input.assignments ?? {},
    workspace: input.workspace,
    workspaces: (input.workspaces ?? []).map((w) => w.name),
    warnings,
    log: input.log,
  }
  // Rédaction en tout dernier recours, sur le JSON sérialisé : même si un secret est
  // arrivé jusque-là (tampon, message d'erreur, libellé), il est masqué dans la sortie.
  return redactSecrets(JSON.stringify(doc, null, 2))
}
