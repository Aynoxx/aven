import assert from "node:assert/strict"
import { test } from "node:test"
import {
  ALL_TOOL_NAMES,
  MAX_TOOL_RESULT_CHARS,
  TOOL_NAMES,
  VOICE_TOOLS,
  clip,
  createVoiceToolRunner,
  formatNoteHits,
  readToolCalls,
  safeNoteId,
} from "../host/voice-agent-tools.ts"
import { AGENT_ACTIONS, MAX_ACTION_ARG_CHARS, MAX_WRITES_PER_TURN } from "../host/agent-actions.ts"
import { answerVoiceQuestion } from "../host/voice-agent-speech.ts"
import { DEFAULT_VOICE_PERSONALITY } from "../host/voice-agent-personality.ts"

// v11.2.0 : premier canal d'ACTION de l'agent vocal. Ces tests figent ce qui
// compte : périmètre en lecture seule, arguments jamais crus, boucle bornée, et
// conversation sans outil strictement inchangée.

const ok = (body) => new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } })

const toolCall = (name, args, id = "call_1") => ({
  choices: [
    {
      message: {
        content: null,
        tool_calls: [{ id, type: "function", function: { name, arguments: JSON.stringify(args) } }],
      },
    },
  ],
})

const say = (content) => ({ choices: [{ message: { content } }] })

const sources = (overrides = {}) => ({
  appState: () => ({ workspace: "aven", notes: 12, version: "11.2.0" }),
  searchNotes: () => [{ id: "projets/pricing.md", title: "Pricing", snippet: "offre gratuite" }],
  readNote: (id) => ({ id, title: "Pricing", markdown: "# Pricing\n\nL'offre reste gratuite." }),
  // v11.9.0 : exécutant des actions du catalogue (remplacé par les tests).
  runAction: async () => ({ status: "done", spoken: "C'est fait." }),
  ...overrides,
})

// ── A. Périmètre : trois outils, tous en lecture ────────────────────────────
test("périmètre : la liste est fermée et ne contient aucune écriture", () => {
  assert.deepEqual([...TOOL_NAMES], ["app_state", "search_notes", "read_note"])
  for (const name of TOOL_NAMES) {
    assert.doesNotMatch(name, /create|save|delete|write|move|archive/i, `« ${name} » reste une lecture`)
  }
})

// ── B. Lecture des appels du modèle ────────────────────────────────────────
test("appels : arguments décodés, appels incomplets ignorés", () => {
  const calls = readToolCalls([
    { id: "a", function: { name: "search_notes", arguments: '{"query":"pricing"}' } },
    { id: "b", function: { name: "read_note", arguments: "pas du json" } },
    { function: { name: "app_state" } },
    { id: "c" },
  ])
  assert.equal(calls.length, 2)
  assert.deepEqual(calls[0].args, { query: "pricing" })
  assert.deepEqual(calls[1].args, {})
  assert.deepEqual(readToolCalls(undefined), [])
})

// ── C. Identifiants de note : aucun chemin hors du dossier notes ───────────
test("identifiants : traversée, absolu et non-.md refusés", () => {
  assert.equal(safeNoteId("projets/pricing.md"), "projets/pricing.md")
  assert.equal(safeNoteId("C:\\secret.md"), null)
  assert.equal(safeNoteId("/etc/passwd.md"), null)
  assert.equal(safeNoteId("../evasion.md"), null)
  assert.equal(safeNoteId("projets//pricing.md"), null)
  assert.equal(safeNoteId("pricing.txt"), null)
  assert.equal(safeNoteId(""), null)
})

// ── D. Exécution : un refus est une réponse, jamais une exception ──────────
test("exécution : outil inconnu et note absente rendent un message au modèle", async () => {
  const run = createVoiceToolRunner(sources())
  const unknown = await run({ id: "1", name: "delete_note", args: { id: "a.md" } })
  assert.equal(unknown.ok, false)
  assert.match(unknown.text, /Outil inconnu/)
  assert.match(unknown.text, /search_notes/)

  const broken = createVoiceToolRunner(
    sources({
      readNote: () => {
        throw new Error("Note introuvable")
      },
    }),
  )
  const missing = await broken({ id: "2", name: "read_note", args: { id: "absente.md" } })
  assert.equal(missing.ok, false)
  assert.match(missing.text, /Lecture impossible : Note introuvable/)

  const traversal = await run({ id: "3", name: "read_note", args: { id: "../../secret.md" } })
  assert.equal(traversal.ok, false)
  assert.match(traversal.text, /invalide/)
})

test("exécution : recherche vide, résultats et état lisible", async () => {
  const run = createVoiceToolRunner(sources())
  const state = await run({ id: "1", name: "app_state", args: {} })
  assert.equal(state.ok, true)
  assert.match(state.text, /aven/)
  assert.match(state.text, /12 notes/)
  assert.match(state.text, /11\.2\.0/)

  const empty = createVoiceToolRunner(sources({ searchNotes: () => [] }))
  const none = await empty({ id: "2", name: "search_notes", args: { query: "facture" } })
  assert.match(none.text, /Aucune note ne correspond à « facture »/)

  const blank = await run({ id: "3", name: "search_notes", args: { query: "   " } })
  assert.equal(blank.ok, false)

  const hit = await run({ id: "4", name: "search_notes", args: { query: "pricing" } })
  assert.match(hit.text, /projets\/pricing\.md — Pricing/)
})

test("exécution : un résultat démesuré est tronqué avant de partir au modèle", async () => {
  const run = createVoiceToolRunner(sources({ readNote: (id) => ({ id, title: "Long", markdown: "x".repeat(5000) }) }))
  const out = await run({ id: "1", name: "read_note", args: { id: "long.md" } })
  assert.ok(out.text.length <= MAX_TOOL_RESULT_CHARS, `résultat borné (${out.text.length})`)
  assert.match(out.text, /\[…\]$/)
})

test("formatage : titre et extrait, jamais le chemin absolu de la machine", () => {
  assert.equal(formatNoteHits([], "rien"), "Aucune note ne correspond à « rien ».")
  assert.match(clip("a".repeat(40), 10), /^a{4}/)
})

// ── E. Boucle : un appel d'outil, puis une réponse ancrée ──────────────────
test("boucle : l'outil est appelé, son résultat revient au modèle, la réponse est orale", async () => {
  const requests = []
  const responses = [toolCall("search_notes", { query: "pricing" }), say("Une note s'appelle Pricing.")]
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return ok(responses.shift() ?? say("Rien de plus."))
  }
  const { text } = await answerVoiceQuestion("qu'est-ce que j'ai noté sur le pricing ?", {
    apiKey: "cle",
    fetchImpl,
    personality: DEFAULT_VOICE_PERSONALITY,
    run: createVoiceToolRunner(sources()),
  })
  assert.equal(text, "Une note s'appelle Pricing.")
  assert.equal(requests.length, 2)
  assert.equal(requests[0].tool_choice, "auto")
  // v11.9.0 : les outils portent les lectures ET les actions du catalogue.
  assert.deepEqual(
    requests[0].tools.map((tool) => tool.function.name).slice(0, 3),
    ["app_state", "search_notes", "read_note"],
  )
  assert.ok(requests[0].tools.some((tool) => tool.function.name === "rename_chat"), "le catalogue est proposé au modèle")
  const toolMessage = requests[1].messages.find((message) => message.role === "tool")
  assert.ok(toolMessage, "le résultat d'outil revient au modèle")
  assert.equal(toolMessage.tool_call_id, "call_1")
  assert.match(toolMessage.content, /projets\/pricing\.md/)
  assert.ok(
    requests[1].messages.some((message) => message.role === "assistant" && Array.isArray(message.tool_calls)),
    "le tour d'appel est conservé dans l'historique",
  )
})

// ── F. Boucle bornée : jamais d'attente infinie, jamais de silence ─────────
test("boucle bornée : trois tours d'outils au plus, puis une réponse sans outil", async () => {
  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    if (requests.length <= 3) return ok(toolCall("app_state", {}, `call_${requests.length}`))
    return ok(say("Je n'arrive pas à conclure."))
  }
  const { text } = await answerVoiceQuestion("fais quelque chose", {
    apiKey: "cle",
    fetchImpl,
    personality: DEFAULT_VOICE_PERSONALITY,
    run: createVoiceToolRunner(sources()),
  })
  assert.equal(text, "Je n'arrive pas à conclure.")
  assert.equal(requests.length, 4, "3 tours d'outils + 1 tour final")
  assert.equal(requests[3].tools, undefined, "le tour final ne propose plus d'outil")
})

test("boucle : un modèle qui ne rend que du texte n'appelle aucun outil", async () => {
  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return ok(say("Bonjour."))
  }
  const { text } = await answerVoiceQuestion("salut", {
    apiKey: "cle",
    fetchImpl,
    personality: DEFAULT_VOICE_PERSONALITY,
    run: createVoiceToolRunner(sources()),
  })
  assert.equal(text, "Bonjour.")
  assert.equal(requests.length, 1)
})

// ── G. Non-régression : sans exécutant, la conversation reste identique ────
test("sans outils, la requête ne porte aucun champ tools", async () => {
  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return ok(say("Bonjour."))
  }
  const { text } = await answerVoiceQuestion("salut", { apiKey: "cle", fetchImpl, personality: DEFAULT_VOICE_PERSONALITY })
  assert.equal(text, "Bonjour.")
  assert.equal(requests[0].tools, undefined)
  assert.equal(requests[0].tool_choice, undefined)
  assert.equal(requests[0].temperature, 0.4)
})

// ── H. v11.9.0 : le catalogue d'actions, et sa classe dangereuse ────────────
test("catalogue : les outils du modèle sont les lectures plus les actions", () => {
  const names = VOICE_TOOLS.map((tool) => tool.function.name)
  assert.deepEqual(names.slice(0, 3), [...TOOL_NAMES])
  assert.deepEqual(names.slice(3), AGENT_ACTIONS.map((action) => action.name))
  assert.deepEqual([...ALL_TOOL_NAMES], names)
  const destroy = AGENT_ACTIONS.filter((action) => action.risk === "destroy")
  assert.ok(destroy.length >= 2, "les destructives déclarées sont présentes")
  for (const action of destroy) assert.match(action.description, /PROPOSE/, `« ${action.name} » se propose`)
})

test("action : les arguments sont validés avant tout appel", async () => {
  let called = 0
  const run = createVoiceToolRunner(sources({ runAction: async () => { called += 1; return { status: "done", spoken: "ok" } } }))
  const missing = await run({ id: "1", name: "rename_chat", args: { chat: "Pricing" } })
  assert.equal(missing.ok, false)
  assert.match(missing.text, /Argument « title » manquant/)
  const tooLong = await run({ id: "2", name: "rename_chat", args: { chat: "Pricing", title: "x".repeat(MAX_ACTION_ARG_CHARS + 1) } })
  assert.equal(tooLong.ok, false)
  assert.match(tooLong.text, /trop long/)
  const notAString = await run({ id: "3", name: "rename_chat", args: { chat: 42, title: "Tarifs" } })
  assert.equal(notAString.ok, false)
  assert.match(notAString.text, /chaîne est attendue/)
  assert.equal(called, 0, "aucune action n'est appelée sur des arguments invalides")
})

test("action refusée : le message du host revient au modèle", async () => {
  const run = createVoiceToolRunner(sources({
    runAction: async () => ({ status: "refused", text: "Plusieurs cibles correspondent : « Pricing », « Tarifs »." }),
  }))
  const outcome = await run({ id: "1", name: "rename_chat", args: { chat: "pri", title: "X" } })
  assert.equal(outcome.ok, false)
  assert.match(outcome.text, /Plusieurs cibles/)
})

test("action destroy : proposée, jamais exécutée, la question nomme la cible", async () => {
  let executed = 0
  const run = createVoiceToolRunner(sources({
    runAction: async (action, args) => {
      assert.equal(action.name, "delete_chat")
      assert.deepEqual(args, { chat: "Pricing" })
      return { status: "confirm", label: "Pricing", args: { chat: "session-1" } }
    },
  }))
  const proposal = await run({ id: "1", name: "delete_chat", args: { chat: "Pricing" } })
  assert.equal(proposal.ok, true)
  assert.equal(proposal.pending?.label, "Pricing")
  assert.deepEqual(proposal.pending?.args, { chat: "session-1" }, "la confirmation garde la cible RÉSOLUE")
  assert.match(proposal.text, /RIEN n'a été exécuté/)
  assert.equal(executed, 0, "rien n'est exécuté à la proposition")

  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    if (requests.length === 1) return ok(toolCall("delete_chat", { chat: "Pricing" }))
    return ok(say("C'est fait, j'ai supprimé la conversation."))
  }
  const answer = await answerVoiceQuestion("supprime la conversation Pricing", {
    apiKey: "cle",
    fetchImpl,
    personality: DEFAULT_VOICE_PERSONALITY,
    run: createVoiceToolRunner(sources({
      runAction: async () => ({ status: "confirm", label: "Pricing", args: { chat: "session-1" } }),
    })),
  })
  assert.equal(answer.text, "Je vais supprimer la conversation « Pricing ». Je le fais ?")
  assert.equal(answer.pending?.name, "delete_chat")
  assert.equal(requests.length, 1, "la boucle s'arrête à la proposition — le modèle ne commente pas")
})

// v11.15.0 : le modèle peut créer une note, mais seulement en la PROPOSANT.
// L'écriture reste derrière le « oui » ; la question relit le contenu, pas le titre.
test("création de note : proposée avec son contenu, jamais écrite dans la boucle", async () => {
  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return ok(toolCall("create_note", { title: "Idées", content: "ligne 1\nligne 2" }))
  }
  let proposed = 0
  const answer = await answerVoiceQuestion("crée une note sur mes idées", {
    apiKey: "cle",
    fetchImpl,
    personality: DEFAULT_VOICE_PERSONALITY,
    run: createVoiceToolRunner(sources({
      runAction: async (action, args) => {
        assert.equal(action.name, "create_note")
        assert.deepEqual(args, { title: "Idées", content: "ligne 1\nligne 2" })
        proposed += 1
        return { status: "confirm", label: "Idées", args }
      },
    })),
  })
  assert.equal(proposed, 1, "l'exécutant est appelé pour proposer, pas pour écrire")
  assert.equal(answer.text, "Je note : « ligne 1 ligne 2 ». Je l’enregistre ?")
  assert.equal(answer.pending?.name, "create_note")
  assert.equal(requests.length, 1, "la boucle s'arrête à la proposition")
})

test("écriture : l'annonce est celle du catalogue, sans second appel au modèle", async () => {
  const requests = []
  const fetchImpl = async (_url, init) => {
    requests.push(JSON.parse(init.body))
    return ok(toolCall("archive_chat", { chat: "Pricing" }))
  }
  const answer = await answerVoiceQuestion("archive la conversation Pricing", {
    apiKey: "cle",
    fetchImpl,
    personality: DEFAULT_VOICE_PERSONALITY,
    run: createVoiceToolRunner(sources({
      runAction: async () => ({ status: "done", spoken: "C'est fait : la conversation « Pricing » est archivée." }),
    })),
  })
  assert.equal(answer.text, "C'est fait : la conversation « Pricing » est archivée.")
  assert.equal(requests.length, 1, "l'annonce du catalogue remplace le tour du modèle")
})

test("lecture : aucune annonce imposée — le modèle parle, et seulement des faits", async () => {
  const run = createVoiceToolRunner(sources())
  const read = await run({ id: "1", name: "list_chats", args: {} })
  assert.equal(read.ok, true)
  assert.equal(read.announce, undefined)
  const write = await run({ id: "2", name: "archive_note", args: { note: "pricing.md" } })
  assert.equal(write.announce, "C'est fait.")
})

test(`écriture : au plus ${MAX_WRITES_PER_TURN} action par tour`, async () => {
  const run = createVoiceToolRunner(sources())
  const first = await run({ id: "1", name: "archive_chat", args: { chat: "Pricing" } })
  assert.equal(first.ok, true)
  const second = await run({ id: "2", name: "archive_note", args: { note: "pricing.md" } })
  assert.equal(second.ok, false)
  assert.match(second.text, /Une seule modification par tour/)
  // Les lectures restent libres : elles ne modifient rien.
  const read = await run({ id: "3", name: "list_chats", args: {} })
  assert.equal(read.ok, true)
})
