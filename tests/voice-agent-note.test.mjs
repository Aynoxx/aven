import assert from "node:assert/strict"
import { test } from "node:test"
import {
  NOTE_CANCELLED_REPLY,
  NOTE_CONFIRM_MS,
  NOTE_CONTENT_PROMPT,
  classifyNoteReply,
  noteConfirmPrompt,
  noteConfirmationOpen,
  noteCreatedReply,
  noteNeedsComposition,
  noteTitleFromDraft,
  parseNoteDraft,
  spokenDraft,
} from "../web/src/voice-agent/note.ts"

// v11.4.0 : la création de note à la voix n'écrit qu'après un « oui » explicite.
// Ces tests fixent les deux moitiés de cette promesse : ce qu'on extrait de la
// phrase, et ce qu'on accepte comme réponse.

test("brouillon extrait des formulations naturelles", () => {
  assert.deepEqual(parseNoteDraft("note que j'ai rendez-vous demain"), { draft: "j'ai rendez-vous demain" })
  assert.deepEqual(parseNoteDraft("note bien que le client rappelle lundi"), { draft: "le client rappelle lundi" })
  assert.deepEqual(parseNoteDraft("note : acheter du pain"), { draft: "acheter du pain" })
  assert.deepEqual(parseNoteDraft("crée une note pour la réunion de demain"), { draft: "la réunion de demain" })
  assert.deepEqual(parseNoteDraft("prends note que Paul doit un livre"), { draft: "Paul doit un livre" })
  assert.deepEqual(parseNoteDraft("ajoute un mémo : réviser le protocole"), { draft: "réviser le protocole" })
  // v11.15.0 : les formulations qui partaient au LLM, faute de motif, et qui
  // recevaient « je ne peux pas créer de note ».
  assert.deepEqual(parseNoteDraft("crée-moi une note pour la réunion"), { draft: "la réunion" })
  assert.deepEqual(parseNoteDraft("fais une note sur le client"), { draft: "le client" })
  assert.deepEqual(parseNoteDraft("peux-tu créer une note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("je voudrais que tu crées une note sur Paul"), { draft: "Paul" })
  assert.deepEqual(parseNoteDraft("génère une note sur demain"), { draft: "demain" })
})

test("une note demandée sans contenu ne devine rien", () => {
  assert.deepEqual(parseNoteDraft("crée une note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("nouvelle note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("prends une note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("crée-moi une note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("fais une note"), { draft: "" })
})

// Le piège : « ouvre une note » est une NAVIGATION (open-notes). Si la création
// l'absorbait, demander à voir ses notes créerait une note vide.
test("consulter une note n'est pas en créer une", () => {
  for (const phrase of ["ouvre une note", "affiche mes notes", "supprime la note", "montre-moi les notes"]) {
    assert.equal(parseNoteDraft(phrase), null, phrase)
  }
  // Une création sans contenu est une demande ; une suppression reste une
  // destruction, elle ne crée jamais de note par accident.
  assert.deepEqual(parseNoteDraft("crée une note"), { draft: "" })
  assert.equal(parseNoteDraft("supprime une note"), null)
})

test("brouillon nettoyé : politesses, guillemets, ponctuation de tête", () => {
  assert.deepEqual(parseNoteDraft("note que j'ai rendez-vous demain s'il te plaît"), { draft: "j'ai rendez-vous demain" })
  assert.deepEqual(parseNoteDraft("note : « acheter du pain »"), { draft: "acheter du pain" })
  assert.deepEqual(parseNoteDraft("note : , appel Paul"), { draft: "appel Paul" })
})

// v11.15.0 : une note à COMPOSER (« qui résume… ») n'est pas un brouillon dicté.
// Elle part au modèle, qui peut désormais la proposer via create_note.
test("une note à composer par l'agent n'est pas interceptée", () => {
  assert.equal(parseNoteDraft("crée une note qui résume la réunion"), null)
  assert.equal(parseNoteDraft("fais une note qui explique le protocole"), null)
})

// v11.16.0 : la réponse à « Quel texte dois-je noter ? » peut décrire le contenu
// au lieu de le dicter. La distinguer d'une dictée est la condition pour qu'Aven
// rédige un vrai résumé au lieu de recopier la demande.
test("composer une note n'est pas la dicter", () => {
  for (const phrase of [
    "La note doit contenir un résumé de comment faire une boucle en Python.",
    "je veux une note qui explique les boucles",
    "fais une note sur les itérations Python",
    "un résumé de la réunion",
  ]) {
    assert.equal(noteNeedsComposition(phrase), true, phrase)
  }
  for (const phrase of [
    "J'ai rendez-vous demain à 14 h.",
    "acheter du pain",
    "Note que j'ai rendez-vous demain.",
    "Note : acheter du pain.",
    "Note bien que le résumé est prêt.",
    "penser à appeler Paul",
  ]) {
    assert.equal(noteNeedsComposition(phrase), false, phrase)
  }
})

test("une phrase de conversation n'est pas une demande de note", () => {
  assert.equal(parseNoteDraft("quelle heure est-il ?"), null)
  assert.equal(parseNoteDraft(""), null)
  assert.equal(parseNoteDraft("   "), null)
})

test("la réponse orale est classée : accord, refus, incompris", () => {
  for (const phrase of ["oui", "Oui.", "ouais", "ok", "d'accord", "vas-y", "confirme", "je confirme", "enregistre", "enregistre-la", "c'est bon", "exactement"]) {
    assert.equal(classifyNoteReply(phrase), "confirm", phrase)
  }
  for (const phrase of ["non", "Non merci.", "annule", "laisse tomber", "n'enregistre pas", "ne l'enregistre pas", "attends", "efface", "pas maintenant"]) {
    assert.equal(classifyNoteReply(phrase), "cancel", phrase)
  }
  for (const phrase of ["quelle heure est-il ?", "ouvre les notes", "", "   "]) {
    assert.equal(classifyNoteReply(phrase), "other", phrase)
  }
})

test("aucune phrase n'est à la fois un accord et un refus", () => {
  for (const phrase of ["oui", "non", "d'accord", "n'enregistre pas", "annule", "confirme"]) {
    const reply = classifyNoteReply(phrase)
    assert.ok(reply === "confirm" || reply === "cancel", phrase)
    // Le refus est testé en premier dans le module : ce test le prouve de l'extérieur.
    if (/^(?:non|annule|n['’]|ne\s)/i.test(phrase)) assert.equal(reply, "cancel", phrase)
  }
})

test("la question de confirmation répète le contenu et demande un accord", () => {
  const prompt = noteConfirmPrompt("j'ai rendez-vous demain")
  assert.match(prompt, /j'ai rendez-vous demain/)
  assert.match(prompt, /Je l’enregistre \?$/)
  // Un brouillon très long est abrégé : on ne lit pas 600 caractères avant de demander.
  const long = noteConfirmPrompt("mot ".repeat(200))
  assert.ok(long.length < 260, `phrase trop longue : ${long.length}`)
})

// v11.16.0 : la note composée porte du Markdown, la question est PRONONCÉE.
// Le texte écrit garde tout ; seule la relecture orale est aplatie — sinon la
// voix lit « ### », « ** » et le contenu d'un bloc de code.
test("la relecture orale retire le Markdown, jamais le texte écrit", () => {
  const note = "# Boucle\n\nUn **résumé** :\n```python\nfor i in range(3):\n    print(i)\n```\n- indentation obligatoire"
  const spoken = spokenDraft(note)
  assert.doesNotMatch(spoken, /```|#{1,6}|\*\*|`/)
  assert.doesNotMatch(spoken, /print\(i\)/, "un bloc de code ne se lit pas à voix haute")
  assert.match(spoken, /résumé/)
  assert.match(spoken, /indentation obligatoire/)
  const prompt = noteConfirmPrompt(note)
  assert.doesNotMatch(prompt, /```|###|\*\*/)
  assert.match(prompt, /Je l’enregistre \?$/)
  // Une note faite uniquement de code n'a rien à relire : on le dit.
  assert.match(noteConfirmPrompt("```python\nprint(1)\n```"), /un texte rédigé/)
})

test("confirmation après écriture et refus sont des phrases fixes", () => {
  assert.equal(noteCreatedReply("Rendez-vous demain"), "Note créée : « Rendez-vous demain ».")
  assert.equal(noteCreatedReply(), "Note créée.")
  assert.match(NOTE_CANCELLED_REPLY, /rien enregistré/)
  assert.match(NOTE_CONTENT_PROMPT, /Quel texte/)
})

test("titre dérivé : court, lisible, jamais vide", () => {
  assert.equal(noteTitleFromDraft("j'ai rendez-vous demain"), "j'ai rendez-vous demain")
  assert.equal(noteTitleFromDraft("Acheter du pain."), "Acheter du pain")
  assert.equal(noteTitleFromDraft("   "), "Note vocale")
  const long = noteTitleFromDraft("le client rappelle lundi pour valider le devis et relancer la facturation")
  assert.ok(long.length <= 61, `titre trop long : ${long.length}`)
  assert.match(long, /…$/)
})

test("la fenêtre de confirmation se referme", () => {
  assert.equal(noteConfirmationOpen(1_000, 1_000), true)
  assert.equal(noteConfirmationOpen(1_000, 1_000 + NOTE_CONFIRM_MS), true)
  assert.equal(noteConfirmationOpen(1_000, 1_000 + NOTE_CONFIRM_MS + 1), false)
  // Une question posée dans le futur (horloge incohérente) n'ouvre rien.
  assert.equal(noteConfirmationOpen(5_000, 1_000), false)
})

// v11.4.0 : la fenêtre de décision est plus longue que la fenêtre de suivi
// ordinaire (10 s) — répondre à une question n'est pas réagir à une réponse.
test("la fenêtre de confirmation dépasse celle du suivi conversationnel", () => {
  assert.ok(NOTE_CONFIRM_MS > 10_000)
})
