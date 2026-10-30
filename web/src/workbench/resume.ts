// Pur : testable avec Node seul, sans dépendance desktop.
//
// v12.1.0 : l'accueil propose de REPRENDRE le travail réel de l'utilisateur. La
// décision — quels éléments, dans quel ordre, avec quel âge — vit ici pour être
// testée sans React : un accueil qui affiche un faux historique serait pire qu'un
// accueil qui n'affiche rien. Aucune donnée n'est inventée : tout vient des
// conversations et des notes réellement chargées.

export type ResumeChat = { id: string; title: string; updated?: number }
export type ResumeNote = { id: string; title: string; updated: number }

export type ResumeSource = {
  chats: ResumeChat[]
  notes: ResumeNote[]
}

export type ResumeItem = {
  kind: "conversation" | "note"
  id: string
  title: string
  updated: number
}

/** Deux lignes suffisent : la troisième ferait un tableau de bord (brief §4.3). */
const MAX_ITEMS = 2

function cleanTitle(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function timestamp(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/**
 * Le plus récent d'abord. À âge égal, une conversation passe avant une note : elle
 * a une suite à donner, là où la note est déjà écrite. Un élément sans identifiant
 * ou sans titre n'est pas repris — une ligne vide mentirait sur ce qu'on peut ouvrir.
 */
export function resumeItems(source: ResumeSource, limit = MAX_ITEMS): ResumeItem[] {
  const items: ResumeItem[] = [
    ...(source.chats ?? []).map((chat) => ({
      kind: "conversation" as const,
      id: chat.id,
      title: cleanTitle(chat.title),
      updated: timestamp(chat.updated),
    })),
    ...(source.notes ?? []).map((note) => ({
      kind: "note" as const,
      id: note.id,
      title: cleanTitle(note.title),
      updated: timestamp(note.updated),
    })),
  ].filter((item) => item.id && item.title)

  items.sort((a, b) => b.updated - a.updated || (a.kind === b.kind ? 0 : a.kind === "conversation" ? -1 : 1))
  return items.slice(0, Math.max(0, Math.floor(limit)))
}

/**
 * Âge lisible d'une entrée. Une horloge en avance (fichier copié, fuseau changé)
 * ne doit jamais annoncer « il y a -3 h » : on dit l'instant, jamais un temps
 * négatif. Au-delà d'une semaine, la date absolue est plus utile que le compte.
 */
export function ageLabel(updated: number, now = Date.now()): string {
  if (!Number.isFinite(updated) || updated <= 0) return "date inconnue"
  const delta = now - updated
  if (!Number.isFinite(delta) || delta < 60_000) return "à l’instant"

  const minutes = Math.floor(delta / 60_000)
  if (minutes < 60) return `il y a ${minutes} min`

  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`

  const days = Math.floor(hours / 24)
  if (days === 1) return "hier"
  if (days < 7) return `il y a ${days} j`

  const date = new Date(updated)
  const day = String(date.getDate()).padStart(2, "0")
  const month = String(date.getMonth() + 1).padStart(2, "0")
  return `le ${day}/${month}`
}
