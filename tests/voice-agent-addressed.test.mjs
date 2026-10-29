import assert from "node:assert/strict"
import { test } from "node:test"
import { AMBIENT_MAX_WORDS, classifyVoiceAddress, isAddressedToAgent } from "../host/voice-agent-addressed.ts"

// v11.14.1 : en veille, Aven ne répond qu'à une parole adressée. Ces tests
// protègent les quatre familles qui ne le sont pas — bruit étiqueté, hésitation,
// hallucination du STT sur le silence, remarque ambiante — et la demande réelle
// qui doit continuer de passer.

test("une hésitation seule n'est pas une demande", () => {
  for (const phrase of ["euh", "Hum…", "euh bon", "bah", "Ben, voilà", "ok", "d'accord", "merci", "oui", "non"]) {
    assert.equal(classifyVoiceAddress(phrase), "filler", phrase)
    assert.equal(isAddressedToAgent(phrase), false, phrase)
  }
})

test("une étiquette de bruit du STT est écartée", () => {
  for (const phrase of ["[Musique]", "(rires)", "*bruit*"]) {
    assert.equal(classifyVoiceAddress(phrase), "hallucination", phrase)
  }
})

test("les hallucinations de Whisper sur le silence sont écartées", () => {
  for (const phrase of [
    "Sous-titres réalisés par la communauté d'Amara.org",
    "Sous-titrage Société Radio-Canada",
    "Merci d'avoir regardé cette vidéo",
    "N'oubliez pas de vous abonner",
    "Merci de votre attention",
  ]) {
    assert.equal(classifyVoiceAddress(phrase), "hallucination", phrase)
  }
})

test("une remarque ambiante et courte n'est pas adressée", () => {
  for (const phrase of [
    "il fait beau aujourd'hui",
    "j'ai oublié mes clés",
    "on va manger à midi",
    "c'est bientôt l'heure",
    // Une question posée à quelqu'un d'autre ne devient pas une demande parce
    // qu'elle porte un point d'interrogation.
    "Bon, on y va ?",
  ]) {
    assert.equal(classifyVoiceAddress(phrase), "ambient", phrase)
    assert.equal(isAddressedToAgent(phrase), false, phrase)
  }
})

test("une vraie demande reste adressée", () => {
  for (const phrase of [
    "tu peux me résumer mes notes ?",
    "quelle heure est-il ?",
    "fais-moi un résumé de la dernière note",
    "j'aimerais une note sur Paul",
    "résume la conversation",
    "note que je dois appeler Paul",
    "explique-moi ce que tu viens de faire",
    "combien de notes j'ai",
    "on fait quoi ?",
    "peux-tu ouvrir les fichiers",
    // Une béquille en tête ne cache pas la demande.
    "bah, résume la note",
    "très bien, fais-moi un résumé",
  ]) {
    assert.equal(classifyVoiceAddress(phrase), "addressed", phrase)
  }
})

test("un énoncé long reste adressé même sans marque", () => {
  // Le doute profite à la conversation : couper une vraie demande serait pire
  // que répondre à une remarque. Au-delà du seuil, la parole est tenue pour
  // volontaire — et le seuil est une constante exportée, pas un nombre enfoui.
  const words = Array.from({ length: AMBIENT_MAX_WORDS + 1 }, (_, index) => `mot${index}`)
  assert.equal(classifyVoiceAddress(words.join(" ")), "addressed")
  assert.equal(classifyVoiceAddress(words.slice(0, AMBIENT_MAX_WORDS).join(" ")), "ambient")
})

test("une transcription vide n'est pas adressée", () => {
  assert.equal(classifyVoiceAddress(""), "empty")
  assert.equal(classifyVoiceAddress("   "), "empty")
  assert.equal(isAddressedToAgent(""), false)
})

// v11.14.1 : après une question d'Aven, « oui » n'est plus du bruit — c'est la
// réponse. Le contexte est passé par l'appelant, le module ne le devine pas.
test("une réponse courte est adressée quand Aven vient de poser une question", () => {
  for (const phrase of ["oui", "non", "ok", "d'accord", "vas-y"]) {
    assert.equal(classifyVoiceAddress(phrase, { expectsAnswer: true }), "addressed", phrase)
  }
  // Sans question ouverte, les mêmes mots restent du bruit de pièce.
  assert.equal(classifyVoiceAddress("oui"), "filler")
  assert.equal(classifyVoiceAddress("ok"), "filler")
})

// Un bruit franc reste écarté même si une question est ouverte.
test("une hallucination reste écartée même quand une question est ouverte", () => {
  assert.equal(
    classifyVoiceAddress("Sous-titres réalisés par la communauté d'Amara.org", { expectsAnswer: true }),
    "hallucination",
  )
  assert.equal(classifyVoiceAddress("[Musique]", { expectsAnswer: true }), "hallucination")
})
