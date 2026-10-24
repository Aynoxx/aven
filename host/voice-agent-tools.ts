// v11.2.0 : l'agent vocal reçoit des OUTILS — premier canal d'ACTION, en lecture
// seule. Jusqu'ici le modèle ne pouvait que parler : aucune requête ne portait de
// champ `tools`, donc « qu'est-ce que j'ai noté sur le pricing ? » recevait une
// réponse plausible mais inventée. Ici la réponse est ancrée dans les données
// réelles de l'espace.
//
// Garde-fous de ce palier :
//   - liste FERMÉE (trois outils, tous en lecture) : aucune écriture, aucune
//     suppression, aucune navigation — ces actions viendront avec confirmation ;
//   - les arguments sont validés ici, jamais fait confiance au modèle ;
//   - un refus est renvoyé AU MODÈLE (message « tool ») pour qu'il corrige, au
//     lieu d'une exception qui casserait le tour ;
//   - aucune valeur sensible : l'état ne porte que le NOM de l'espace, jamais
//     son chemin complet (il ne doit pas partir chez le fournisseur distant).
//
// Pur : testable avec Node seul, sans dépendance desktop ni Tauri.

/** Nombre maximal de tours d'outils avant la réponse parlée finale. */
export const MAX_TOOL_STEPS = 3
/** Appels simultanés honorés sur un même tour (au-delà, refus explicite). */
export const MAX_CALLS_PER_TURN = 4
/** Taille maximale d'un résultat d'outil renvoyé au modèle. */
export const MAX_TOOL_RESULT_CHARS = 900
/** Nombre de notes renvoyées par une recherche. */
export const NOTE_HITS = 5

export const TOOL_NAMES = ["app_state", "search_notes", "read_note"] as const
export type VoiceToolName = (typeof TOOL_NAMES)[number]

export function isToolName(value: string): value is VoiceToolName {
  return (TOOL_NAMES as readonly string[]).includes(value)
}

export const VOICE_TOOLS = [
  {
    type: "function",
    function: {
      name: "app_state",
      description:
        "État connu du host : nom de l'espace actif, nombre de notes, version d'Aven. Ne connaît pas l'onglet affiché (le renderer le garde).",
      parameters: { type: "object", properties: {}, additionalProperties: false },
    },
  },
  {
    type: "function",
    function: {
      name: "search_notes",
      description:
        "Cherche dans les notes de l'espace par mots-clés et renvoie au plus cinq résultats : identifiant, titre, extrait.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "mots-clés en français, sans ponctuation" },
        },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "read_note",
      description:
        "Lit une note par son identifiant exact, tel que renvoyé par search_notes (chemin relatif terminé par .md).",
      parameters: {
        type: "object",
        properties: {
          id: { type: "string", description: "identifiant renvoyé par search_notes" },
        },
        required: ["id"],
        additionalProperties: false,
      },
    },
  },
] as const

/** Un appel d'outil tel que le modèle l'a demandé, arguments déjà décodés. */
export type VoiceToolCall = { id: string; name: string; args: Record<string, unknown> }

/** Résultat d'outil : le texte part au modèle, `ok` sert aux tests et aux sondes. */
export type VoiceToolOutcome = { ok: boolean; text: string }
export type VoiceToolRunner = (call: VoiceToolCall) => Promise<VoiceToolOutcome>

export type VoiceAppState = { workspace: string; notes: number; version: string }
export type VoiceNoteHit = { id: string; title: string; snippet: string }
export type VoiceNoteRow = { id: string; title: string; markdown: string }

/**
 * Données que l'agent peut consulter. Le host fournit les implémentations
 * réelles ; les tests fournissent des objets en mémoire.
 */
export type VoiceToolSources = {
  appState: () => VoiceAppState
  searchNotes: (query: string) => VoiceNoteHit[]
  readNote: (id: string) => VoiceNoteRow
}

function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object") return raw as Record<string, unknown>
  if (typeof raw !== "string") return {}
  try {
    const value = JSON.parse(raw)
    return value && typeof value === "object" ? (value as Record<string, unknown>) : {}
  } catch {
    // Arguments illisibles : la validation refusera, le modèle sera corrigé.
    return {}
  }
}

/**
 * Lit `message.tool_calls` d'une réponse de complétion. Un appel incomplet (sans
 * identifiant ou sans nom) est ignoré : il ne pourrait pas recevoir de réponse.
 */
export function readToolCalls(raw: unknown): VoiceToolCall[] {
  if (!Array.isArray(raw)) return []
  const out: VoiceToolCall[] = []
  for (const item of raw) {
    const call = item as { id?: unknown; function?: { name?: unknown; arguments?: unknown } }
    const id = typeof call?.id === "string" ? call.id : ""
    const name = typeof call?.function?.name === "string" ? call.function.name : ""
    if (!id || !name) continue
    out.push({ id, name, args: parseArgs(call?.function?.arguments) })
  }
  return out
}

/**
 * Identifiant de note sûr, sans toucher au disque : chemin relatif, pas de
 * traversée, pas d'absolu, extension .md. La validation finale reste celle de
 * `host/notes.ts` — celle-ci n'est qu'un premier filtre lisible par le modèle.
 */
export function safeNoteId(raw: unknown): string | null {
  const value = String(raw ?? "").trim().replace(/\\/g, "/")
  if (!value || value.length > 220 || !value.toLowerCase().endsWith(".md")) return null
  if (value.startsWith("/") || /^[a-zA-Z]:/.test(value)) return null
  const segments = value.split("/")
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) return null
  return segments.join("/")
}

/** Tronque un résultat d'outil : le contexte du modèle reste borné. */
export function clip(text: unknown, max = MAX_TOOL_RESULT_CHARS): string {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim()
  if (clean.length <= max) return clean
  return `${clean.slice(0, Math.max(0, max - 6)).trimEnd()} […]`
}

export function formatAppState(state: VoiceAppState): string {
  const notes = state.notes === 1 ? "1 note" : `${state.notes} notes`
  const version = state.version ? ` · Aven ${state.version}` : ""
  return `Espace « ${state.workspace || "aucun"} » · ${notes}${version}.`
}

export function formatNoteHits(hits: readonly VoiceNoteHit[], query: string): string {
  if (!hits.length) return `Aucune note ne correspond à « ${query} ».`
  const lines = hits.map((hit, index) => {
    const snippet = hit.snippet ? ` — ${clip(hit.snippet, 160)}` : ""
    return `${index + 1}. ${hit.id} — ${hit.title}${snippet}`
  })
  return `${hits.length === 1 ? "1 note" : `${hits.length} notes`} :\n${lines.join("\n")}`
}

export function formatNote(row: VoiceNoteRow): string {
  return `Note « ${row.title} » (${row.id}) :\n${clip(row.markdown, MAX_TOOL_RESULT_CHARS - 80)}`
}

/**
 * Exécute un appel d'outil. Ne lève JAMAIS : toute erreur (outil inconnu,
 * argument invalide, note absente) devient un message lisible que le modèle peut
 * exploiter pour répondre honnêtement ou demander une précision.
 */
export function createVoiceToolRunner(sources: VoiceToolSources): VoiceToolRunner {
  return async (call) => {
    if (!isToolName(call.name)) {
      return { ok: false, text: `Outil inconnu « ${call.name} ». Outils disponibles : ${TOOL_NAMES.join(", ")}.` }
    }
    try {
      switch (call.name) {
        case "app_state":
          return { ok: true, text: formatAppState(sources.appState()) }
        case "search_notes": {
          const query = String(call.args.query ?? "").trim()
          if (!query) return { ok: false, text: "La recherche exige un champ « query » non vide." }
          if (query.length > 120) return { ok: false, text: "Recherche trop longue : reformule en quelques mots." }
          return { ok: true, text: formatNoteHits(sources.searchNotes(query), query) }
        }
        case "read_note": {
          const id = safeNoteId(call.args.id)
          if (!id) return { ok: false, text: "Identifiant de note invalide : il doit venir de search_notes." }
          return { ok: true, text: formatNote(sources.readNote(id)) }
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, text: `Lecture impossible : ${message}` }
    }
    return { ok: false, text: "Outil non traité." }
  }
}
