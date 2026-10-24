import assert from "node:assert/strict"
import { test } from "node:test"
import { displayPath } from "../web/src/display-path.ts"

// v11.0.1 : le préfixe `\\?\` vient de l'API Windows, pas de l'utilisateur. Il ne
// doit jamais atteindre l'écran ; un chemin déjà propre reste inchangé.

test("retire le préfixe de chemin étendu d'un lecteur", () => {
  assert.equal(displayPath("\\\\?\\C:\\Users\\Liam\\aven"), "C:\\Users\\Liam\\aven")
})

test("reconstruit un chemin UNC lisible", () => {
  assert.equal(displayPath("\\\\?\\UNC\\serveur\\partage"), "\\\\serveur\\partage")
})

test("laisse intact un chemin déjà propre", () => {
  assert.equal(displayPath("C:\\Users\\Liam"), "C:\\Users\\Liam")
})

test("valeur absente : chaîne vide, jamais « undefined »", () => {
  assert.equal(displayPath(undefined), "")
  assert.equal(displayPath(null), "")
  assert.equal(displayPath(""), "")
})
