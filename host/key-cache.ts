// v11.5.2 : cache des clés déchiffrées côté host. Le déchiffrement DPAPI coûte
// un lancement PowerShell (~580 ms mesuré par clé) et il était refait À CHAQUE
// requête vocale : deux clés stockées × deux appels (STT puis LLM) ≈ 2,3 s par
// tour, soit ~40 % de la latence mesurée. Le clair ne quitte jamais le host, il
// ne vit qu'en mémoire du processus, et il est invalidé dès qu'une clé change.
//
// Pur : testable avec Node seul, sans DPAPI ni fichier. Le chargement réel est
// injecté, ce qui permet de compter exactement combien de fois il est appelé.

export type KeyLoader = (providerId: string) => string | undefined

export type KeyCache = {
  /** La clé en clair, chargée au premier accès puis gardée en mémoire. */
  get: (providerId: string) => string | undefined
  /** Oublie une clé (ou toutes) — à appeler dès que le stockage change. */
  clear: (providerId?: string) => void
}

export function createKeyCache(load: KeyLoader): KeyCache {
  // Une valeur `undefined` est une information : « aucune clé stockée » ne doit
  // pas relancer un déchiffrement à chaque tour. On la met donc en cache aussi.
  const values = new Map<string, string | undefined>()
  return {
    get(providerId: string) {
      if (values.has(providerId)) return values.get(providerId)
      // Un échec de déchiffrement n'est PAS mis en cache : il doit être visible
      // et pouvoir réussir au tour suivant (PowerShell peut échouer une fois).
      const value = load(providerId)
      values.set(providerId, value)
      return value
    },
    clear(providerId?: string) {
      if (providerId === undefined) values.clear()
      else values.delete(providerId)
    },
  }
}
