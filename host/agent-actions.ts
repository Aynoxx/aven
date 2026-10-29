// v11.9.0 : l'agent vocal reçoit des ACTIONS DE DONNÉES — il ne se contente plus
// de lire, il agit (renommer, archiver, épingler, déplacer…) et le dit.
//
// Le risque d'une telle marche n'est pas de mal répondre : c'est de laisser un
// modèle décider d'une écriture ou d'une suppression à partir d'une
// transcription approximative (« archive » entendu « supprime »). D'où trois
// classes, et une seule asymétrie qui compte :
//
//   read    exécution directe, résultat rendu au modèle ;
//   write   exécution directe, phrase d'annonce rendue à l'utilisateur ;
//   destroy JAMAIS exécutée par le modèle : elle est PROPOSÉE, puis attendue une
//           confirmation orale nommée (la question répète la cible). Un « oui »
//           mal transcrit ne répare pas une donnée supprimée.
//
// Ce module ne touche ni au disque, ni au réseau, ni à Tauri : il décrit, valide
// et formule. L'exécution vit chez son appelant (`host/aven-app-host.ts`), qui
// est le seul à posséder l'API des conversations et des notes.
//
// v11.15.0 : la création de note REJOINT le catalogue, sur demande explicite. Le
// modèle peut donc proposer une note au lieu de répondre qu'il ne peut pas. Elle
// n'est jamais écrite dans la foulée : `create_note` est une écriture PROPOSÉE,
// le contenu est relu, puis attendu un « oui » — la même discipline que la note
// dictée (v11.4.0). Une seule ligne l'écrit, après confirmation.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.

/** Classe de risque d'une action — elle décide du comportement, pas de l'humeur. */
export type ActionRisk = "read" | "write" | "destroy"

/** Nature d'un argument : décide de la forme acceptée et de la validation. */
export type ActionArgKind = "chat" | "note" | "folder" | "text" | "agent" | "body"

export type ActionArg = {
  name: string
  kind: ActionArgKind
  required: boolean
  max: number
  description: string
}

export type AgentAction = {
  /** Nom d'outil (API OpenAI : minuscules, chiffres, `_`), identifiant stable. */
  name: string
  /** Libellé français, pour le journal et les phrases. */
  label: string
  risk: ActionRisk
  /**
   * v11.15.0 : écriture qui exige la confirmation d'une destruction (création de
   * note). Le risque reste `write` — la nature de l'action ne change pas, seule
   * sa porte d'exécution est plus étroite.
   */
  confirm?: boolean
  /** Phrase vue par le modèle : elle doit dire QUAND l'utiliser. */
  description: string
  args: readonly ActionArg[]
  /** Groupe nominal de la cible (« la conversation ») pour les phrases dites. */
  target: string
  /** Participe passé accordé (« supprimée »), pour la phrase de résultat. */
  done: string
  /** Verbe à l'infinitif, pour la question de confirmation (« supprimer »). */
  verb: string
}

/** Au-delà, un argument n'est plus une cible : c'est une divagation du modèle. */
export const MAX_ACTION_ARG_CHARS = 120
/** Le corps d'une note n'est pas une cible : il garde ses sauts de ligne. */
export const NOTE_BODY_MAX_CHARS = 4_000
/** Titre court d'une note proposée. */
export const NOTE_TITLE_MAX_CHARS = 80
/** Longueur du contenu relu dans la question de confirmation. */
export const NOTE_PROMPT_MAX_CHARS = 180
/** Fenêtre pendant laquelle une confirmation attendue reste valable (45 s). */
export const ACTION_CONFIRM_MS = 45_000
/** Journal en mémoire : de quoi répondre « qu'est-ce que tu viens de faire ? ». */
export const AGENT_LOG_LIMIT = 20
/** Une seule écriture par tour : une demande ne peut pas enchaîner dix gestes. */
export const MAX_WRITES_PER_TURN = 1
/** Nombre de conversations rendues par `list_chats`. */
export const CHAT_LIST_LIMIT = 30

// Miroir volontaire de `AGENT_IDS` (`host/voice-intent.ts`) : les agents qu'une
// conversation peut recevoir. Dupliqué ici parce que ce module reste pur, et
// qu'un agent inconnu ne doit PAS être remplacé en silence par « projet » —
// créer la conversation du mauvais agent serait une erreur invisible.
export const VOICE_AGENTS = ["projet", "code", "recherche", "analyse"] as const

/** Nom d'agent valide, ou refus lisible. Sans valeur, le défaut est « projet ». */
export function resolveAgentName(value: unknown): { ok: true; agent: string } | { ok: false; text: string } {
  const clean = String(value ?? "").trim().toLowerCase()
  if (!clean) return { ok: true, agent: VOICE_AGENTS[0] }
  const found = VOICE_AGENTS.find((agent) => agent === clean)
  if (!found) return { ok: false, text: `Agent inconnu « ${String(value)} » : précise parmi ${VOICE_AGENTS.join(", ")}.` }
  return { ok: true, agent: found }
}

// Les cibles sont résolues PAR NOM — le host ne connaît pas « l'objet
// sélectionné ». Chaque description le dit au modèle, sinon il invente un
// identifiant plausible.
export const AGENT_ACTIONS: readonly AgentAction[] = [
  {
    name: "list_chats",
    label: "Lister les conversations",
    risk: "read",
    description:
      "Liste les conversations de l'espace (les plus récentes d'abord, archivées comprises) : identifiant, titre, agent. À utiliser avant toute action sur une conversation dont le nom exact n'est pas connu.",
    args: [],
    target: "la conversation",
    done: "listée",
    verb: "lister",
  },
  {
    name: "recent_actions",
    label: "Rappeler ses dernières actions",
    risk: "read",
    description:
      "Rend ce qu'Aven vient d'exécuter dans cette session (les vingt dernières actions, avec leur résultat). À utiliser quand l'utilisateur demande « qu'est-ce que tu viens de faire ? ».",
    args: [],
    target: "l'action",
    done: "relue",
    verb: "rappeler",
  },
  {
    name: "rename_chat",
    label: "Renommer une conversation",
    risk: "write",
    description:
      "Renomme une conversation existante. `chat` est son identifiant (renvoyé par list_chats) ou son titre actuel ; en cas de doute entre plusieurs conversations, l'appel échoue et demande de préciser.",
    args: [
      { name: "chat", kind: "chat", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la conversation" },
      { name: "title", kind: "text", required: true, max: MAX_ACTION_ARG_CHARS, description: "nouveau titre, court et lisible" },
    ],
    target: "la conversation",
    done: "renommée",
    verb: "renommer",
  },
  {
    name: "create_chat",
    label: "Créer une conversation",
    risk: "write",
    description:
      "Crée une conversation vide avec un agent : projet, code, recherche ou analyse (défaut : projet). Le titre reste « Nouvelle conversation » jusqu'à ce que l'utilisateur écrive ou demande un renommage. Un agent hors de cette liste est refusé : demande lequel avant de créer.",
    args: [{ name: "agent", kind: "agent", required: false, max: 40, description: "projet, code, recherche ou analyse" }],
    target: "la conversation",
    done: "créée",
    verb: "créer",
  },
  {
    name: "archive_chat",
    label: "Archiver une conversation",
    risk: "write",
    description:
      "Archive une conversation (elle sort de la liste sans être supprimée, et reste récupérable). `chat` est son identifiant ou son titre.",
    args: [{ name: "chat", kind: "chat", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la conversation" }],
    target: "la conversation",
    done: "archivée",
    verb: "archiver",
  },
  {
    name: "pin_note",
    label: "Épingler une note",
    risk: "write",
    description:
      "Épingle (ou détache si elle l'était) une note en tête de liste. `note` est son identifiant (renvoyé par search_notes) ou son titre.",
    args: [{ name: "note", kind: "note", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la note" }],
    target: "la note",
    done: "épinglée",
    verb: "épingler",
  },
  {
    name: "move_note",
    label: "Déplacer une note",
    risk: "write",
    description:
      "Déplace une note dans un dossier de notes (le dossier est créé s'il manque). `folder` vide déplace la note à la racine.",
    args: [
      { name: "note", kind: "note", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la note" },
      { name: "folder", kind: "folder", required: true, max: MAX_ACTION_ARG_CHARS, description: "dossier de destination, ex. « Projets »" },
    ],
    target: "la note",
    done: "déplacée",
    verb: "déplacer",
  },
  {
    name: "archive_note",
    label: "Archiver une note",
    risk: "write",
    description:
      "Archive une note (elle quitte la liste sans être supprimée). `note` est son identifiant ou son titre.",
    args: [{ name: "note", kind: "note", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la note" }],
    target: "la note",
    done: "archivée",
    verb: "archiver",
  },
  {
    name: "create_folder",
    label: "Créer un dossier de notes",
    risk: "write",
    description: "Crée un dossier dans les notes. `folder` est un chemin relatif, ex. « Projets/2026 ».",
    args: [{ name: "folder", kind: "folder", required: true, max: MAX_ACTION_ARG_CHARS, description: "chemin relatif du dossier" }],
    target: "le dossier",
    done: "créé",
    verb: "créer",
  },
  {
    name: "create_note",
    label: "Créer une note",
    risk: "write",
    // v11.15.0 : une note ne s'écrit pas sur une transcription approximative.
    // Le modèle la PROPOSE (titre + contenu), l'utilisateur l'entend relire, puis
    // répond « oui ». Le contenu n'est donc jamais un effet de bord du LLM.
    confirm: true,
    description:
      "Crée une note dans l'espace actif. `content` est le texte de la note, `title` un titre court et lisible. La note est PROPOSÉE, son contenu relu : elle n'est écrite qu'après la confirmation orale.",
    args: [
      { name: "title", kind: "text", required: true, max: NOTE_TITLE_MAX_CHARS, description: "titre court de la note" },
      { name: "content", kind: "body", required: true, max: NOTE_BODY_MAX_CHARS, description: "texte de la note, sauts de ligne admis" },
    ],
    target: "la note",
    done: "créée",
    verb: "créer",
  },
  {
    name: "delete_chat",
    label: "Supprimer une conversation",
    risk: "destroy",
    description:
      "PROPOSE la suppression d'une conversation (irréversible). L'action n'est pas exécutée : elle est dite à l'utilisateur, qui doit confirmer oralement. `chat` est son identifiant ou son titre.",
    args: [{ name: "chat", kind: "chat", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la conversation" }],
    target: "la conversation",
    done: "supprimée",
    verb: "supprimer",
  },
  {
    name: "trash_note",
    label: "Mettre une note à la corbeille",
    risk: "destroy",
    description:
      "PROPOSE de mettre une note à la corbeille (restaurable depuis les notes). L'action n'est pas exécutée : elle est dite à l'utilisateur, qui doit confirmer oralement. `note` est son identifiant ou son titre.",
    args: [{ name: "note", kind: "note", required: true, max: MAX_ACTION_ARG_CHARS, description: "identifiant ou titre de la note" }],
    target: "la note",
    done: "mise à la corbeille",
    verb: "mettre à la corbeille",
  },
]

export const ACTION_NAMES: readonly string[] = AGENT_ACTIONS.map((action) => action.name)

export function isAgentActionName(value: string): boolean {
  return ACTION_NAMES.includes(value)
}

export function actionSpec(name: string): AgentAction | undefined {
  return AGENT_ACTIONS.find((action) => action.name === name)
}

/**
 * Une action `destroy` — et toute écriture marquée `confirm` — n'est jamais
 * exécutée par le modèle : elle est proposée puis confirmée oralement.
 */
export function requiresActionConfirmation(action: AgentAction): boolean {
  return action.risk === "destroy" || action.confirm === true
}

/** Définition d'outil au format OpenAI, dérivée du catalogue (jamais recopiée). */
export function actionToolDefinitions() {
  return AGENT_ACTIONS.map((action) => ({
    type: "function" as const,
    function: {
      name: action.name,
      description: action.description,
      parameters: {
        type: "object",
        properties: Object.fromEntries(action.args.map((arg) => [arg.name, { type: "string", description: arg.description }])),
        required: action.args.filter((arg) => arg.required).map((arg) => arg.name),
        additionalProperties: false,
      },
    },
  }))
}

export type ActionArgsValidation = { ok: true; args: Record<string, string> } | { ok: false; text: string }

/**
 * Valide les arguments d'une action. Le modèle n'est jamais cru : chaînes
 * seulement, longueur bornée, caractères de contrôle refusés. Un corps de note
 * garde ses sauts de ligne ; une cible ou un titre reste une ligne.
 */
export function validateActionArgs(action: AgentAction, raw: Record<string, unknown>): ActionArgsValidation {
  const args: Record<string, string> = {}
  for (const spec of action.args) {
    const value = raw?.[spec.name]
    if (value === undefined || value === null) {
      if (spec.required) return { ok: false, text: `Argument « ${spec.name} » manquant pour ${action.name}.` }
      continue
    }
    if (typeof value !== "string") return { ok: false, text: `Argument « ${spec.name} » invalide : une chaîne est attendue.` }
    // v11.15.0 : le corps d'une note garde ses sauts de ligne ; une cible ou un
    // titre reste une ligne (l'ancien écrasement ferait de toute note un pavé).
    const normalized = spec.kind === "body" ? value.replace(/\r\n?/g, "\n") : value
    const clean = spec.kind === "body" ? normalized.trim() : normalized.replace(/\s+/g, " ").trim()
    if (!clean) {
      if (spec.required) return { ok: false, text: `Argument « ${spec.name} » vide pour ${action.name}.` }
      continue
    }
    if (clean.length > spec.max) return { ok: false, text: `Argument « ${spec.name} » trop long (maximum ${spec.max} caractères).` }
    const control = spec.kind === "body" ? /[\u0000-\u0009\u000b-\u001f\u007f]/ : /[\u0000-\u001f\u007f]/
    if (control.test(normalized)) return { ok: false, text: `Argument « ${spec.name} » invalide : caractères de contrôle refusés.` }
    args[spec.name] = clean
  }
  return { ok: true, args }
}

export type ActionTarget = { id: string; title: string }

/**
 * Résout une cible par identifiant exact, puis titre exact, puis titre
 * approché. Une correspondance multiple n'est PAS un choix : elle rend les
 * candidats, et l'appelant demande de préciser (une devinette silencieuse
 * écrirait dans la mauvaise note).
 */
export function matchActionTarget<T extends ActionTarget>(
  items: readonly T[],
  query: string,
): { hit: T } | { ambiguous: T[] } | null {
  const asked = normalizeTarget(query)
  if (!asked) return null
  const exactId = items.find((item) => item.id.toLowerCase() === asked)
  if (exactId) return { hit: exactId }
  const exactTitle = items.filter((item) => normalizeTarget(item.title) === asked)
  if (exactTitle.length === 1) return { hit: exactTitle[0] }
  const partial = items.filter((item) => normalizeTarget(item.title).includes(asked) || normalizeTarget(item.id).includes(asked))
  if (partial.length === 1) return { hit: partial[0] }
  if (partial.length === 0) return null
  return { ambiguous: partial.slice(0, 3) }
}

/** Minuscules, sans accents, espaces normalisés — la comparaison est indulgente. */
export function normalizeTarget(value: unknown): string {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
}

/** Texte rendu au modèle quand plusieurs cibles correspondent. */
export function actionAmbiguityText(action: AgentAction, query: string, candidates: readonly ActionTarget[]): string {
  const names = candidates.map((candidate) => `« ${candidate.title} »`).join(", ")
  return `Plusieurs cibles correspondent à « ${query} » pour ${action.name} : ${names}. Repose la question à l'utilisateur avec ces titres au lieu de choisir.`
}

/** Texte rendu au modèle quand aucune cible ne correspond. */
export function actionNotFoundText(action: AgentAction, query: string): string {
  return `Aucune cible trouvée pour « ${query} » (${action.name}). Utilise ${action.name === "trash_note" || action.name === "pin_note" || action.name === "move_note" || action.name === "archive_note" ? "search_notes" : "list_chats"} ou demande le nom exact à l'utilisateur.`
}

/**
 * Question de confirmation d'une action `destroy`. Elle RÉPÈTE la cible : c'est
 * le seul endroit du système où l'on nomme ce qui va disparaître, et c'est ce
 * qui empêche un « oui » de valider autre chose que ce qui a été dit.
 */
export function actionConfirmPrompt(action: AgentAction, label: string): string {
  return `Je vais ${action.verb} ${action.target} « ${label} ». Je le fais ?`
}

/**
 * Question de confirmation d'une action proposée. Une création de note RÉPÈTE le
 * contenu, comme la note dictée (v11.4.0) : sans cela, un « oui » validerait un
 * titre sans que personne ait entendu le texte qui sera écrit.
 */
export function actionConfirmationText(
  action: AgentAction,
  label: string,
  args: Record<string, string> = {},
): string {
  if (action.name !== "create_note") return actionConfirmPrompt(action, label)
  const body = String(args.content ?? "").replace(/\s+/g, " ").trim()
  const shown = body.length <= NOTE_PROMPT_MAX_CHARS
    ? body
    : body.slice(0, NOTE_PROMPT_MAX_CHARS).replace(/\s+\S*$/, "") + "…"
  return `Je note : « ${shown} ». Je l’enregistre ?`
}

/** Phrase d'annonce après une action exécutée. `detail` précise le résultat. */
export function actionDonePhrase(action: AgentAction, label: string, detail?: string): string {
  if (detail && detail.trim()) return `C'est fait : ${action.target} « ${label} » — ${detail.trim()}.`
  return `C'est fait : ${action.target} « ${label} » est ${action.done}.`
}

/** Réponses dites par le renderer, jamais par le modèle. */
export const ACTION_CANCELLED_REPLY = "D’accord, je ne fais rien."
export const ACTION_UNCONFIRMED_REPLY = "Je n’ai pas exécuté l’action."
export const ACTION_EXPIRED_REPLY = "Trop tard : je n’ai rien exécuté. Redemande-moi."
export const ACTION_NONE_PENDING_REPLY = "Il n’y a plus rien à confirmer."
export const ACTION_EXECUTION_FAILED_REPLY = "Je n’ai pas pu exécuter l’action."

/**
 * La confirmation attendue est-elle encore ouverte ? Au-delà de
 * ACTION_CONFIRM_MS, un « oui » tardif ne doit pas exécuter une action dont
 * l'utilisateur ne se souvient plus.
 */
export function actionConfirmationOpen(askedAt: number, now: number = Date.now()): boolean {
  return Number.isFinite(askedAt) && now >= askedAt && now - askedAt <= ACTION_CONFIRM_MS
}

/** Entrée du journal en mémoire — jamais écrite sur disque. */
export type AgentLogEntry = { at: number; name: string; label: string; ok: boolean; spoken: string }

export function formatAgentLog(entries: readonly AgentLogEntry[]): string {
  if (!entries.length) return "Aucune action exécutée dans cette session."
  const lines = entries.map((entry) => `${entry.ok ? "✓" : "✗"} ${entry.spoken}`)
  return `Dernières actions de la session :\n${lines.join("\n")}`
}
