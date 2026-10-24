import assert from "node:assert/strict"
import { test } from "node:test"
import { matchCommands, parseOmnibox, rankByQuery } from "../web/src/workbench/omnibox.ts"

test("parseOmnibox : texte nu = recherche", () => {
  assert.deepEqual(parseOmnibox("  note projet  "), { mode: "search", query: "note projet" })
})

test("parseOmnibox : « > » = commandes", () => {
  assert.deepEqual(parseOmnibox("> nouveau"), { mode: "command", query: "nouveau" })
})

test("parseOmnibox : « / » = portée explicite, alias compris", () => {
  assert.deepEqual(parseOmnibox("/notes semaine"), { mode: "scope", scope: "notes", query: "semaine" })
  assert.deepEqual(parseOmnibox("/fichiers src/app.ts"), { mode: "scope", scope: "files", query: "src/app.ts" })
  assert.deepEqual(parseOmnibox("/chats budget"), { mode: "scope", scope: "conversations", query: "budget" })
  // Portée inconnue : on ne devine pas une autre feature.
  assert.deepEqual(parseOmnibox("/inconnue x"), { mode: "scope", scope: "notes", query: "inconnue x" })
})

test("parseOmnibox : une recherche vide ne déclenche rien", () => {
  assert.deepEqual(parseOmnibox("   "), { mode: "search", query: "" })
})

test("matchCommands : vide = toutes, sinon filtre libellé ou identifiant", () => {
  assert.ok(matchCommands("").length >= 8)
  assert.equal(matchCommands("terminal").some((c) => c.id === "open-terminal"), true)
  assert.equal(matchCommands("zzz").length, 0)
})

test("rankByQuery : préfixe d'abord, ordre stable ensuite", () => {
  const items = ["Archiver la note", "Note de projet", "Note rapide"]
  assert.deepEqual(rankByQuery(items, "note", (x) => x), ["Note de projet", "Note rapide", "Archiver la note"])
  assert.deepEqual(rankByQuery(items, "NOTE", (x) => x), ["Note de projet", "Note rapide", "Archiver la note"])
  assert.deepEqual(rankByQuery(items, "", (x) => x), items)
})
