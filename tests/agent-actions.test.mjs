import assert from "node:assert/strict"
import { test } from "node:test"
import {
  ACTION_CONFIRM_MS,
  ACTION_NAMES,
  AGENT_ACTIONS,
  MAX_ACTION_ARG_CHARS,
  NOTE_BODY_MAX_CHARS,
  VOICE_AGENTS,
  actionConfirmationOpen,
  actionConfirmationText,
  actionConfirmPrompt,
  actionDonePhrase,
  actionSpec,
  actionToolDefinitions,
  formatAgentLog,
  isAgentActionName,
  matchActionTarget,
  normalizeTarget,
  requiresActionConfirmation,
  resolveAgentName,
  validateActionArgs,
} from "../host/agent-actions.ts"

// v11.9.0 : le catalogue d'actions de l'agent vocal. Ces tests figent ce qui
// protège les données : une classe de risque par action, des arguments validés
// avant tout appel, une cible résolue par nom (jamais devinée), et une question
// de confirmation qui NOMME ce qui va disparaître.

const action = (name) => {
  const found = actionSpec(name)
  assert.ok(found, `action « ${name} » absente du catalogue`)
  return found
}

// ── A. Le catalogue est déclaré, fermé et lisible ───────────────────────────
test("catalogue : noms uniques, noms d'outil valides, libellés français", () => {
  assert.equal(new Set(ACTION_NAMES).size, ACTION_NAMES.length, "pas de doublon")
  assert.deepEqual([...ACTION_NAMES], AGENT_ACTIONS.map((entry) => entry.name), "l'index suit le catalogue")
  for (const entry of AGENT_ACTIONS) {
    assert.match(entry.name, /^[a-z][a-z0-9_]{2,40}$/, `« ${entry.name} » est un nom d'outil valide`)
    assert.ok(entry.label.length > 3 && entry.label.length < 60, `libellé lisible pour ${entry.name}`)
    assert.equal(isAgentActionName(entry.name), true)
    assert.ok(["read", "write", "destroy"].includes(entry.risk), `risque déclaré pour ${entry.name}`)
    assert.ok(entry.description.length > 40, `description utile pour ${entry.name}`)
    assert.ok(entry.verb && entry.target && entry.done, `phrases complètes pour ${entry.name}`)
  }
  assert.equal(isAgentActionName("drop_database"), false)
  assert.equal(actionSpec("drop_database"), undefined)
})

test("catalogue : une destruction sans confirmation n'existe pas", () => {
  const destroy = AGENT_ACTIONS.filter((entry) => entry.risk === "destroy")
  assert.ok(destroy.length >= 2, "les actions dangereuses sont déclarées, pas cachées")
  for (const entry of destroy) {
    assert.match(entry.description, /PROPOSE/, `« ${entry.name} » dit qu'elle est proposée`)
    assert.match(actionConfirmPrompt(entry, "Cible"), /Je le fais \?\s*$/, `question posée pour ${entry.name}`)
  }
  // Aucune action d'écriture ne se déclare en lecture, et réciproquement.
  for (const entry of AGENT_ACTIONS.filter((a) => a.risk === "read")) {
    assert.equal(entry.args.filter((arg) => arg.required).length, 0, `« ${entry.name} » se lit sans cible`)
  }
})

test("catalogue : aucun geste hors du Poste (pas de purge, pas d'espace, pas de système)", () => {
  assert.doesNotMatch(ACTION_NAMES.join(" "), /purge|workspace|system|shell|exec|external/i)
})

// v11.15.0 : la création de note rejoint le catalogue — le modèle pouvait la
// refuser alors qu'elle est demandée. Elle reste une écriture PROPOSÉE : le
// contenu est relu, puis attendu un « oui ».
test("catalogue : créer une note est une écriture proposée, au contenu relu", () => {
  const create = action("create_note")
  assert.equal(create.risk, "write")
  assert.equal(requiresActionConfirmation(create), true, "une note ne s'écrit pas sans « oui »")
  assert.match(create.description, /PROPOSÉE/)
  const question = actionConfirmationText(create, "Idées", { content: "ligne 1\nligne 2" })
  assert.match(question, /ligne 1 ligne 2/, "la question relit le contenu, pas seulement le titre")
  assert.match(question, /Je l’enregistre \?$/)
  // Les autres écritures gardent leur exécution directe : seule la note est
  // assez fragile pour exiger une relecture (v11.4.0).
  assert.equal(requiresActionConfirmation(action("rename_chat")), false)
})

// ── B. Les arguments ne sont jamais crus ────────────────────────────────────
test("validation : manquant, vide, trop long, non-chaîne et contrôle refusés", () => {
  const rename = action("rename_chat")
  const okArgs = validateActionArgs(rename, { chat: "  Pricing  ", title: "Tarifs" })
  assert.equal(okArgs.ok, true)
  assert.deepEqual(okArgs.args, { chat: "Pricing", title: "Tarifs" }, "les espaces sont normalisés")

  const cases = [
    [{ chat: "Pricing" }, /Argument « title » manquant/],
    [{ chat: "Pricing", title: "   " }, /Argument « title » vide/],
    [{ chat: "Pricing", title: "x".repeat(MAX_ACTION_ARG_CHARS + 1) }, /trop long/],
    [{ chat: 42, title: "Tarifs" }, /chaîne est attendue/],
    [{ chat: "Pricing", title: "deux\nlignes" }, /caractères de contrôle/],
  ]
  for (const [args, pattern] of cases) {
    const result = validateActionArgs(rename, args)
    assert.equal(result.ok, false, `refus attendu pour ${JSON.stringify(args)}`)
    assert.match(result.text, pattern)
  }
  // Un argument optionnel absent ne bloque pas.
  const create = action("create_chat")
  assert.equal(validateActionArgs(create, {}).ok, true)
  assert.deepEqual(validateActionArgs(create, {}).args, {})

  // v11.15.0 : le corps d'une note garde ses sauts de ligne — le validateur des
  // cibles les écrasait, ce qui aurait fait de toute note un seul paragraphe.
  const createNote = action("create_note")
  const noteArgs = validateActionArgs(createNote, { title: "Idées", content: "ligne 1\nligne 2" })
  assert.equal(noteArgs.ok, true)
  assert.equal(noteArgs.args.content, "ligne 1\nligne 2")
  assert.equal(validateActionArgs(createNote, { title: "Idées", content: "a\u0000b" }).ok, false)
  assert.equal(validateActionArgs(createNote, { title: "Idées", content: "x".repeat(NOTE_BODY_MAX_CHARS + 1) }).ok, false)
})

// ── C. La cible se résout par nom, et l'ambiguïté n'est pas un choix ────────
const chats = [
  { id: "ses_1", title: "Pricing" },
  { id: "ses_2", title: "Étude de marché" },
  { id: "ses_3", title: "Pricing v2" },
]

test("résolution : identifiant exact, titre exact, préfixe unique", () => {
  assert.deepEqual(matchActionTarget(chats, "ses_1")?.hit, chats[0], "l'identifiant exact gagne")
  assert.deepEqual(matchActionTarget(chats, "pricing")?.hit, chats[0], "titre exact avant le partiel")
  assert.deepEqual(matchActionTarget(chats, "ETUDE DE MARCHE")?.hit, chats[1], "accents et casse ignorés")
  assert.deepEqual(matchActionTarget(chats, "march")?.hit, chats[1], "sous-chaîne unique acceptée")
  assert.equal(matchActionTarget(chats, "tarifs"), null, "aucune correspondance")
  assert.equal(matchActionTarget(chats, "   "), null, "requête vide refusée")
})

test("résolution : deux cibles proches rendent les candidats, pas un choix", () => {
  const match = matchActionTarget(chats, "pric")
  assert.ok(match && "ambiguous" in match, "« pric » est ambigu")
  assert.deepEqual(match.ambiguous.map((row) => row.title), ["Pricing", "Pricing v2"])
  assert.equal(normalizeTarget("  Été  "), "ete")
})

// ── D. Un agent inconnu n'est pas remplacé en silence ──────────────────────
test("agent : projet par défaut, liste fermée, refus lisible sinon", () => {
  assert.deepEqual([...VOICE_AGENTS], ["projet", "code", "recherche", "analyse"])
  assert.deepEqual(resolveAgentName("code"), { ok: true, agent: "code" })
  assert.deepEqual(resolveAgentName("  Recherche "), { ok: true, agent: "recherche" })
  assert.deepEqual(resolveAgentName(undefined), { ok: true, agent: "projet" }, "sans agent, la conversation est « projet »")
  const refused = resolveAgentName("assistant")
  assert.equal(refused.ok, false)
  assert.match(refused.text, /Agent inconnu « assistant »/)
  assert.match(refused.text, /projet, code, recherche, analyse/, "le refus nomme les agents valides")
})

// ── E. Les phrases dites sont celles du catalogue ───────────────────────────
test("phrases : la question nomme la cible, l'annonce dit ce qui a été fait", () => {
  const remove = action("delete_chat")
  assert.equal(
    actionConfirmPrompt(remove, "Pricing"),
    "Je vais supprimer la conversation « Pricing ». Je le fais ?",
  )
  const trash = action("trash_note")
  assert.equal(
    actionConfirmPrompt(trash, "Idées"),
    "Je vais mettre à la corbeille la note « Idées ». Je le fais ?",
  )
  assert.equal(actionDonePhrase(remove, "Pricing"), "C'est fait : la conversation « Pricing » est supprimée.")
  assert.equal(
    actionDonePhrase(action("rename_chat"), "Pricing", "son nouveau titre est « Tarifs »"),
    "C'est fait : la conversation « Pricing » — son nouveau titre est « Tarifs ».",
  )
  assert.equal(
    actionDonePhrase(action("create_folder"), "Projets"),
    "C'est fait : le dossier « Projets » est créé.",
  )
})

// ── E. La décision expire ──────────────────────────────────────────────────
test("confirmation : la fenêtre de décision est bornée à 45 s", () => {
  assert.equal(ACTION_CONFIRM_MS, 45_000)
  const at = 1_000_000
  assert.equal(actionConfirmationOpen(at, at), true)
  assert.equal(actionConfirmationOpen(at, at + ACTION_CONFIRM_MS), true)
  assert.equal(actionConfirmationOpen(at, at + ACTION_CONFIRM_MS + 1), false)
  assert.equal(actionConfirmationOpen(at, at - 1), false, "une horloge incohérente ferme la fenêtre")
  assert.equal(actionConfirmationOpen(Number.NaN), false)
})

// ── F. Journal en mémoire, jamais un mensonge ──────────────────────────────
test("journal : vide puis lisible, jamais un succès inventé", () => {
  assert.match(formatAgentLog([]), /Aucune action/)
  const log = [
    { at: 1, name: "rename_chat", label: "Renommer une conversation", ok: true, spoken: "C'est fait : la conversation « Pricing » — son nouveau titre est « Tarifs »." },
    { at: 2, name: "trash_note", label: "Mettre une note à la corbeille", ok: false, spoken: "Je n'ai pas pu exécuter l'action." },
  ]
  const text = formatAgentLog(log)
  assert.match(text, /^Dernières actions de la session :/)
  assert.match(text, /✓ C'est fait/)
  assert.match(text, /✗ Je n'ai pas pu/)
})

// ── G. Les définitions d'outils dérivent du catalogue ─────────────────────
test("outils : une définition par action, arguments déclarés, champs fermés", () => {
  const defs = actionToolDefinitions()
  assert.equal(defs.length, AGENT_ACTIONS.length)
  for (const [index, def] of defs.entries()) {
    const entry = AGENT_ACTIONS[index]
    assert.equal(def.function.name, entry.name)
    assert.equal(def.function.description, entry.description)
    assert.deepEqual(Object.keys(def.function.parameters.properties), entry.args.map((arg) => arg.name))
    assert.deepEqual(def.function.parameters.required, entry.args.filter((arg) => arg.required).map((arg) => arg.name))
    assert.equal(def.function.parameters.additionalProperties, false)
  }
})
