// v11.4.3 : le service vocal d'Edge limite le débit (HTTP 429) quand on lui
// demande trop de synthèses. Or l'agent répète un petit nombre de phrases fixes
// (« C'est fait. », « Quel texte dois-je noter ? », les refus de note) : les
// redemander est inutile, coûte 400–900 ms et rapproche de la limite.
//
// Ce cache garde l'audio DÉJÀ synthétisé, par voix et par texte, en mémoire
// seulement, borné en taille et en durée. Un texte identique ne repart jamais au
// service ; changer de voix ne sert jamais l'ancienne.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

export type VoiceCache = {
  get(key: string): string | undefined
  set(key: string, value: string): void
  /** Nombre d'entrées vivantes (pour les tests et la mesure). */
  size(): number
}

export function createVoiceCache(options: {
  maxEntries?: number
  ttlMs?: number
  now?: () => number
} = {}): VoiceCache {
  const maxEntries = Math.max(1, options.maxEntries ?? 16)
  const ttlMs = Math.max(0, options.ttlMs ?? 30 * 60_000)
  const now = options.now ?? Date.now
  // `Map` conserve l'ordre d'insertion : la première clé est la moins récemment
  // utilisée, donc celle qu'on évince.
  const entries = new Map<string, { value: string; at: number }>()

  const alive = (key: string, at: number): string | undefined => {
    const entry = entries.get(key)
    if (!entry) return undefined
    if (at - entry.at > ttlMs) {
      entries.delete(key)
      return undefined
    }
    return entry.value
  }

  return {
    get(key) {
      const at = now()
      const value = alive(key, at)
      if (value === undefined) return undefined
      // Un accès rafraîchit la position : la phrase utilisée souvent survit.
      const entry = entries.get(key) as { value: string; at: number }
      entries.delete(key)
      entries.set(key, entry)
      return value
    },
    set(key, value) {
      const at = now()
      entries.delete(key)
      entries.set(key, { value, at })
      while (entries.size > maxEntries) {
        const oldest = entries.keys().next()
        if (oldest.done) break
        entries.delete(oldest.value)
      }
    },
    size() {
      const at = now()
      for (const key of [...entries.keys()]) alive(key, at)
      return entries.size
    },
  }
}
