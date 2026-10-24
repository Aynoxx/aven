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
  noteTitleFromDraft,
  parseNoteDraft,
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
})

test("une note demandée sans contenu ne devine rien", () => {
  assert.deepEqual(parseNoteDraft("crée une note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("nouvelle note"), { draft: "" })
  assert.deepEqual(parseNoteDraft("prends une note"), { draft: "" })
})

// Le piège : « ouvre une note » est une NAVIGATION (open-notes). Si la création
// l'absorbait, demander à voir ses notes créerait une note vide.
test("consulter une note n'est pas en créer une", () => {
  for (const phrase of ["ouvre une note", "affiche mes notes", "supprime la note", "montre-moi les notes"]) {
    assert.equal(parseNoteDraft(phrase), null, phrase)
  }
})

test("brouillon nettoyé : politesses, guillemets, ponctuation de tête", () => {
  assert.deepEqual(parseNoteDraft("note que j'ai rendez-vous demain s'il te plaît"), { draft: "j'ai rendez-vous demain" })
  assert.deepEqual(parseNoteDraft("note : « acheter du pain »"), { draft: "acheter du pain" })
  assert.deepEqual(parseNoteDraft("note : , appel Paul"), { draft: "appel Paul" })
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
