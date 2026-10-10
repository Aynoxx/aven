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

// v9.1.3 : trois actions exécutables en plus — ouvrir le CLI Freebuff dans un terminal,
// afficher les statistiques et créer une nouvelle conversation. L'agent vocal exécute
// désormais vraiment l'action demandée (routeAppAction côté renderer).
export const APP_ACTIONS = ["open-notes", "open-settings", "open-agents", "open-projects", "open-workspace", "open-freebuff", "open-stats", "new-chat"] as const
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
  "   - open-projects : gérer les espaces de travail ; open-workspace : ouvrir le dossier du projet dans l'explorateur ;",
  "   - open-freebuff : lancer Freebuff (CLI) dans un terminal ; open-stats : afficher les statistiques ;",
  "   - new-chat : créer une nouvelle conversation.",
  "   Une COMMANDE parle de l'application elle-même (« ouvre les paramètres », « lance Freebuff », « nouvelle conversation »).",
  "   Une demande de CONTENU ou de travail n'est JAMAIS une commande d'application (ex. « ouvre le fichier main.ts et corrige-le » = dictée ordinaire).",
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

//
// Filet de secours DÉTERMINISTE (v9.1.3) : la classification LLM peut échouer (quota,
// réseau, timeout) ou mal classer une phrase courte. Pour les commandes les plus
// courantes, des motifs serrés (verbe d'action + nom d'interface) donnent l'intention
// SANS passer par le modèle — et JAMAIS pour une demande de contenu (le motif exige un
// verbe d'action sur l'app, pas un objet quelconque : « ouvre le fichier main.ts » ne
// déclenche rien). Testé sans réseau dans voice-intent.test.mjs.
const FALLBACK_PATTERNS: Array<{ re: RegExp; intent: DictationIntent }> = [
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}(?:param[eè]tres?|r[eè]glages?)/i, intent: { intent: "app", action: "open-settings" } },
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}notes?\b/i, intent: { intent: "app", action: "open-notes" } },
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}(?:page d[es]? )?agents?\b/i, intent: { intent: "app", action: "open-agents" } },
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}(?:espaces? de travail|projets?)\b/i, intent: { intent: "app", action: "open-projects" } },
  { re: /(?:ouvre|ouvrir|lance|lancer|d[eé]marre|d[eé]marrer|l[eè]ve)[^.?!]{0,30}(?:dossier du )?projet\b/i, intent: { intent: "app", action: "open-workspace" } },
  { re: /(?:ouvre|ouvrir|lance|lancer|d[eé]marre|d[eé]marrer)[^.?!]{0,30}freebuff/i, intent: { intent: "app", action: "open-freebuff" } },
  { re: /(?:ouvre|ouvrir|affiche|afficher|montre|montrer|va (?:à|aux?|sur))[^.?!]{0,30}statistiques?\b/i, intent: { intent: "app", action: "open-stats" } },
  { re: /nouvelle (?:conversation|discussion|chat)|nouveau chat/i, intent: { intent: "app", action: "new-chat" } },
  { re: /(?:passe|passer|bascule|basculer|mets?-?toi)[^.?!]{0,30}(?:sur |chez |chez l')?(?:agent )?(projet|code|recherche|analyse)\b/i, intent: { intent: "agent", target: "projet" } },
]

/** Intention de secours déterministe pour les commandes les plus courantes. */
export function fallbackIntent(text: string): DictationIntent | undefined {
  const clean = text.trim()
  if (!clean || clean.length > 80) return undefined
  for (const p of FALLBACK_PATTERNS) {
    const m = clean.match(p.re)
    if (m) {
      if (p.intent.intent === "agent") {
        const target = AGENT_IDS.find((id) => id === m[1]?.toLowerCase())
        if (target) return { intent: "agent", target }
        return { intent: "agent" }
      }
      return p.intent
    }
  }
  return undefined
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
