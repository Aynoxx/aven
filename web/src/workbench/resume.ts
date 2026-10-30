// Pur : testable avec Node seul, sans dépendance desktop.
//
// v12.1.0 : l'accueil reprend le travail réel de l'utilisateur.
// v12.3.0 : « Reprendre » devient une vraie zone à trois entrées — conversation,
// note, fichier — une par nature. La décision vit ici pour être testée sans React.
// Ce que ce module refuse, et c'est le point : pas d'entrée sans titre, pas de note
// vide (elle n'apprend rien), pas de fichier sans chemin, pas d'âge négatif. Un
// accueil qui fabrique un historique est pire qu'un accueil qui n'affiche rien.

export type ResumeChat = { id: string; title: string; updated?: number; preview?: string }
export type ResumeNote = { id: string; title: string; markdown?: string; updated: number }
export type ResumeFile = { path: string; name: string; opened: number }

export type ResumeSources = {
  chats: ResumeChat[]
  notes: ResumeNote[]
  files: ResumeFile[]
}

export type ResumeKind = "conversation" | "note" | "file"

export type ResumeEntry = {
  kind: ResumeKind
  /** Identifiant de navigation : id de conversation/note, chemin pour un fichier. */
  id: string
  title: string
  /** Extrait court et réel (dernier message, début de note, chemin du fichier). */
  excerpt: string
  updated: number
}

const MAX_EXCERPT = 96

// Une conversation que personne n'a ouverte n'est pas une reprise : Aven crée la
// ligne « Nouvelle conversation » au démarrage. Tant qu'elle n'a ni message ni titre
// donné, la proposer revient à afficher un élément vide (constaté à l'écran).
const PLACEHOLDER_TITLES = new Set(["nouvelle conversation", "new conversation", "sans titre", "untitled"])

function cleanText(value: unknown): string {
  return String(value ?? "").replace(/\s+/g, " ").trim()
}

function timestamp(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) && n > 0 ? n : 0
}

/** Le plus récent d'une liste, ou null : l'ordre de l'entrée est une donnée, pas un hasard. */
function newest<T extends { updated: number }>(list: T[]): T | null {
  return list.reduce<T | null>((best, item) => (!best || item.updated > best.updated ? item : best), null)
}

/**
 * Retire le balisage Markdown d'un extrait : une ligne d'accueil ne se lit pas avec
 * des dièses, des astérisques ou un bloc de code. Tronqué aux mots, jamais au milieu.
 */
export function excerptOf(markdown: unknown, max = MAX_EXCERPT): string {
  const flat = String(markdown ?? "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/[*_>~|]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
  if (!flat) return ""
  if (flat.length <= max) return flat
  const cut = flat.slice(0, max)
  const lastSpace = cut.lastIndexOf(" ")
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

/**
 * Extrait d'une note : son corps, SANS la ligne de titre qui ouvre le fichier.
 * Le titre est déjà affiché au-dessus — le répéter dans l'extrait ne dit rien de
 * plus et gaspillait la seule ligne de lecture disponible (constaté à l'écran).
 */
export function noteExcerpt(markdown: unknown, max = MAX_EXCERPT): string {
  const lines = String(markdown ?? "").replace(/\r\n/g, "\n").split("\n")
  const first = lines.findIndex((line) => line.trim() !== "")
  if (first >= 0 && /^#\s+/.test(lines[first].trim())) lines.splice(first, 1)
  return excerptOf(lines.join("\n"), max)
}

/**
 * Les trois entrées de l'accueil, dans l'ordre fixe conversation → note → fichier
 * (l'ordre des trois colonnes, pas un tri par date : trois natures différentes ne se
 * comparent pas). Une nature absente n'est pas remplacée par du contenu de synthèse.
 */
export function resumeBoard(sources: ResumeSources): ResumeEntry[] {
  const chats = (sources.chats ?? [])
    .map((chat) => ({ ...chat, title: cleanText(chat.title), updated: timestamp(chat.updated), preview: cleanText(chat.preview) }))
    .filter((chat) => chat.id && chat.title)
    // Le titre par défaut n'est pas un titre : sans extrait, il n'y a rien à reprendre.
    .filter((chat) => !(PLACEHOLDER_TITLES.has(chat.title.toLowerCase()) && !chat.preview))
  const notes = (sources.notes ?? [])
    .map((note) => ({ ...note, title: cleanText(note.title), updated: timestamp(note.updated) }))
    // Une note sans contenu n'est pas une reprise : elle n'a rien à rouvrir.
    .filter((note) => note.id && note.title && cleanText(note.markdown))
    // v12.3.1 : une note dont le corps ne dit RIEN DE PLUS que son titre n'apprend
    // rien non plus. Cas réel dans l'espace de test : un titre et son corps
    // identiques (« sans contenu avec comme nom importation »), que la v12.3.0
    // proposait encore parce que le fichier, lui, n'était pas vide.
    .filter((note) => {
      const excerpt = noteExcerpt(note.markdown)
      return excerpt !== "" && excerpt.toLowerCase() !== note.title.toLowerCase()
    })
  const files = (sources.files ?? [])
    .map((file) => ({ ...file, path: cleanText(file.path), name: cleanText(file.name), opened: timestamp(file.opened) }))
    .filter((file) => file.path)

  const conversation = newest(chats)
  const note = newest(notes)
  const file = files.reduce<ResumeFile | null>((best, item) => (!best || item.opened > best.opened ? item : best), null)

  const entries: ResumeEntry[] = []
  if (conversation) {
    entries.push({
      kind: "conversation",
      id: conversation.id,
      title: conversation.title,
      excerpt: excerptOf(conversation.preview),
      updated: conversation.updated,
    })
  }
  if (note) {
    entries.push({
      kind: "note",
      id: note.id,
      title: note.title,
      excerpt: noteExcerpt(note.markdown),
      updated: note.updated,
    })
  }
  if (file) {
    // Le dossier, pas le chemin complet : à la racine, le chemin répète le titre.
    const dir = file.path.split("/").slice(0, -1).join("/")
    entries.push({
      kind: "file",
      id: file.path,
      title: file.name || file.path.split("/").pop() || file.path,
      excerpt: dir,
      updated: file.opened,
    })
  }
  return entries
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
