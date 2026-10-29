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
// v11.9.0 : les outils de l'agent ne sont plus une liste écrite à la main. Le
// catalogue `host/agent-actions.ts` fournit les actions de données (lecture,
// écriture, destruction) ; ce module les propose au modèle, valide leurs
// arguments, et n'exécute une destruction qu'en la PROPOSANT. Une seule écriture
// par tour : une demande ne peut pas enchaîner dix gestes.
//
// Pur : testable avec Node seul, sans dépendance desktop ni Tauri.

import {
  ACTION_NAMES,
  MAX_WRITES_PER_TURN,
  actionSpec,
  actionToolDefinitions,
  isAgentActionName,
  validateActionArgs,
  type AgentAction,
  type AgentLogEntry,
} from "./agent-actions.js"

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

const READ_TOOLS = [
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

/**
 * Outils proposés au modèle : les trois lectures de v11.2.0, puis les actions
 * du catalogue. Une action ajoutée au catalogue est immédiatement disponible —
 * et une action retirée l'est aussi, sans liste parallèle à tenir.
 */
export const VOICE_TOOLS = [...READ_TOOLS, ...actionToolDefinitions()]
/** Tous les noms d'outils acceptés (lectures + actions), pour les refus lisibles. */
export const ALL_TOOL_NAMES: readonly string[] = [...TOOL_NAMES, ...ACTION_NAMES]

/** Un appel d'outil tel que le modèle l'a demandé, arguments déjà décodés. */
export type VoiceToolCall = { id: string; name: string; args: Record<string, unknown> }

/**
 * Résultat d'outil : le texte part au modèle, `ok` sert aux tests et aux sondes.
 *
 * v11.9.0 : `pending` signale qu'une destruction a été PROPOSÉE et `announce`
 * qu'une écriture a été EXÉCUTÉE. Dans les deux cas la boucle remplace la
 * réponse du modèle par la phrase du catalogue : un modèle qui paraphrase
 * (« c'est fait » pour une action refusée) est exactement le mensonge qu'on
 * cherche à éviter, et la phrase canonique évite un aller-retour de plus.
 */
export type VoiceToolOutcome = { ok: boolean; text: string; pending?: VoicePendingAction; announce?: string }
export type VoiceToolRunner = (call: VoiceToolCall) => Promise<VoiceToolOutcome>

export type VoiceAppState = { workspace: string; notes: number; version: string }
export type VoiceNoteHit = { id: string; title: string; snippet: string }
export type VoiceNoteRow = { id: string; title: string; markdown: string }

/**
 * Issue d'une action exécutée par le host. `confirm` n'est rendue QUE par les
 * actions `destroy` : rien n'a été exécuté, et la cible résolue voyage avec la
 * proposition pour que la confirmation s'applique exactement à elle.
 */
export type VoiceActionOutcome =
  | { status: "done"; spoken: string }
  | { status: "confirm"; label: string; args: Record<string, string> }
  | { status: "refused"; text: string }

export type VoiceActionExecutor = (action: AgentAction, args: Record<string, string>) => Promise<VoiceActionOutcome>

/**
 * Données que l'agent peut consulter ou modifier. Le host fournit les
 * implémentations réelles ; les tests fournissent des objets en mémoire.
 */
export type VoiceToolSources = {
  appState: () => VoiceAppState
  searchNotes: (query: string) => VoiceNoteHit[]
  readNote: (id: string) => VoiceNoteRow
  /** Exécution des actions du catalogue — refusée pour `destroy`, proposée. */
  runAction: VoiceActionExecutor
}

/**
 * Action `destroy` proposée, en attente de la confirmation orale de
 * l'utilisateur. `args` porte les identifiants RÉSOLUS : la confirmation ne
 * relance pas une recherche qui pourrait tomber sur une autre cible.
 */
export type VoicePendingAction = { name: string; label: string; args: Record<string, string> }

/** Journal des actions, en mémoire seulement (voir `host/agent-actions.ts`). */
export type VoiceActionLog = readonly AgentLogEntry[]

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
 *
 * v11.9.0 : les actions du catalogue passent par `sources.runAction`, avec deux
 * garde-fous ici — arguments validés avant l'appel, et AU PLUS UNE écriture par
 * tour. Une destruction n'est jamais exécutée par cette fonction : l'exécutant
 * rend `confirm`, la boucle en fait une question posée à l'utilisateur.
 */
export function createVoiceToolRunner(sources: VoiceToolSources): VoiceToolRunner {
  // Compteur par tour : l'exécutant est créé pour une demande.
  let writes = 0
  return async (call) => {
    if (isToolName(call.name)) {
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
    const action = isAgentActionName(call.name) ? actionSpec(call.name) : undefined
    if (!action) {
      return { ok: false, text: `Outil inconnu « ${call.name} ». Outils disponibles : ${ALL_TOOL_NAMES.join(", ")}.` }
    }
    const validated = validateActionArgs(action, call.args)
    if (!validated.ok) return { ok: false, text: validated.text }
    if (action.risk !== "read") {
      if (writes >= MAX_WRITES_PER_TURN) {
        return { ok: false, text: "Une seule modification par tour : cette action n'a pas été exécutée." }
      }
      writes += 1
    }
    try {
      const outcome = await sources.runAction(action, validated.args)
      switch (outcome.status) {
        case "done":
          // Une écriture est ANNONCÉE par sa phrase, pas commentée par le modèle.
          return { ok: true, text: outcome.spoken, ...(action.risk === "read" ? {} : { announce: outcome.spoken }) }
        case "refused":
          return { ok: false, text: outcome.text }
        case "confirm":
          return {
            ok: true,
            text: `Action proposée : ${outcome.label}. RIEN n'a été exécuté : l'utilisateur doit confirmer oralement. Ne dis pas que c'est fait.`,
            pending: { name: action.name, label: outcome.label, args: outcome.args },
          }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return { ok: false, text: `Action impossible : ${message}` }
    }
  }
}
