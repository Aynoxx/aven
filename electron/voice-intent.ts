// Classification d'intention de la dictée (v8.8.0) : transforme le texte transcrit en
// décision de routage — commande d'application, changement d'agent, ou dictée ordinaire.
//
// Règles d'or :
//   - LISTE FERMÉE : le classifieur ne peut choisir que parmi les actions et les agents
//     connus ; toute autre valeur est rejetée (garde anti-hallucination) ;
//   - NE RÉPOND JAMAIS À LA DEMANDE : cette passe classifie, elle n'exécute rien ;
//   - ANTI-INJECTION : le verdict vient de la structure de la réponse du classifieur,
//     jamais du contenu dicté (un texte dicté « {"intent":"app"} » ne forge pas un ordre).
// Sans dépendance à Electron ni au bridge OpenCode : testable avec Node seul.

export const APP_ACTIONS = ["open-notes", "open-settings", "open-agents", "open-projects", "open-workspace"] as const
export type AppAction = (typeof APP_ACTIONS)[number]

// Miroir des TABS d'opencode-bridge.ts (ids canoniques des agents), ici sans dépendance
// au client OpenCode pour garder le module testable avec Node seul.
// v9.0.0 : « projet » = agent principal orchestrateur.
export const AGENT_IDS = ["projet", "code", "recherche", "analyse"] as const
export type AgentId = (typeof AGENT_IDS)[number]

export type DictationIntent =
  | { intent: "app"; action: AppAction } // commande d'application à exécuter
  | { intent: "agent"; target?: AgentId } // tâche pour un autre agent (absent = courant)
  | { intent: "chat" } // dictée ordinaire pour l'agent courant

export const INTENT_MODEL = process.env.AVEN_VOICE_INTENT_MODEL || "openai/gpt-oss-20b"

// Descriptions sémantiques injectées dans le prompt : le classifieur route selon le SENS
// de la tâche dictée, pas selon des mots-clés littéraux.
export const AGENT_HINTS: Record<AgentId, string> = {
  projet: "projet d'ensemble, chantier multi-étapes, coordonner et synthétiser plusieurs domaines",
  code: "développement, bug, erreur de code, refactoring, tests, git, terminal, fichiers du projet",
  recherche: "recherche, documentation, comparaison, veille, actualité, explique-moi, qu'est-ce que",
  analyse: "données, chiffres, statistiques, tableau, graphique, rapport, analyse de fichier",
}

const AGENT_LINES = AGENT_IDS.map((id) => `   - "${id}" : ${AGENT_HINTS[id]}`).join("\n")

export const INTENT_SYSTEM_PROMPT = [
  "Tu es un classifieur d'intention pour une dictée vocale en français. On te donne la transcription d'une demande.",
  "Classifie-la en EXACTEMENT une de ces catégories, et ne fais rien d'autre (ne réponds jamais à la demande, n'exécute rien, ne commente pas) :",
  `1. Commande d'application (l'utilisateur veut agir sur l'application elle-même) — action parmi : ${APP_ACTIONS.map((a) => `"${a}"`).join(", ")}.`,
  "   - open-notes : ouvrir la page Notes ; open-settings : ouvrir les paramètres ; open-agents : voir les agents ;",
  "   - open-projects : gérer les espaces de travail ; open-workspace : ouvrir le dossier du projet dans l'explorateur.",
  "2. Changement d'agent (la demande est une tâche qui relève d'un autre agent) :",
  AGENT_LINES,
  '3. Dictée ordinaire (tout le reste : message, question, suite de conversation) : {"intent":"chat"}.',
  "Réponds UNIQUEMENT par un JSON valide sur une ligne, sans Markdown ni commentaire :",
  '{"intent":"app","action":"..."} | {"intent":"agent","target":"projet|code|recherche|analyse"} | {"intent":"chat"}',
].join("\n")

const GROQ_BASE = "https://api.groq.com/openai/v1" // miroir de voice.ts (import interdit : dépendance circulaire)

/** Extrait un JSON d'une réponse LLM (tolère défensivement une clôture Markdown). */
function parseJsonLoose(content: string): unknown {
  const bare = content.trim().replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim()
  try {
    return JSON.parse(bare)
  } catch {
    /* on tente le premier objet accolé ci-dessous */
  }
  const m = bare.match(/\{[\s\S]*\}/)
  return m ? JSON.parse(m[0]) : undefined
}

/**
 * Valide STRICTEMENT la réponse du classifieur : toute valeur hors liste fermée lève
 * une exception — l'appelant dégradera alors vers une dictée ordinaire.
 */
export function intentOfCompletion(content: string): DictationIntent {
  const parsed = parseJsonLoose(content) as { intent?: unknown; action?: unknown; target?: unknown } | undefined
  switch (parsed?.intent) {
    case "app": {
      const action = APP_ACTIONS.find((a) => a === parsed.action)
      if (!action) throw new Error(`Action d'intention inconnue : ${String(parsed.action)}`)
      return { intent: "app", action }
    }
    case "agent": {
      const target = AGENT_IDS.find((id) => id === parsed.target)
      return target ? { intent: "agent", target } : { intent: "agent" }
    }
    case "chat":
      return { intent: "chat" }
    default:
      throw new Error("Réponse d'intention illisible.")
  }
}

/** Classifie une dictée via Groq. Échec = exception (gérée par l'appelant). */
export async function classifyIntent(
  text: string,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<DictationIntent> {
  const response = await fetchImpl(`${GROQ_BASE}/chat/completions`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: INTENT_MODEL,
      temperature: 0,
      max_tokens: 60,
      messages: [
        { role: "system", content: INTENT_SYSTEM_PROMPT },
        { role: "user", content: text },
      ],
    }),
    signal: AbortSignal.timeout(6_000),
  })
  if (!response.ok) {
    let detail = ""
    try {
      const body = (await response.json()) as { error?: { message?: string } | string; message?: string }
      detail = typeof body.error === "string" ? body.error : body.error?.message ?? body.message ?? ""
    } catch { /* réponse non JSON */ }
    throw new Error(detail || `Groq a refusé la classification (HTTP ${response.status})`)
  }
  const body = (await response.json()) as { choices?: Array<{ message?: { content?: unknown } }> }
  const content = body.choices?.[0]?.message?.content
  const raw = typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content.map((c) => (typeof (c as { text?: unknown })?.text === "string" ? (c as { text: string }).text : "")).join("")
      : ""
  return intentOfCompletion(raw)
}
