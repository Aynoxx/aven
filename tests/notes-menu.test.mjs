import assert from "node:assert/strict"
import { test } from "node:test"
import { SLASH_COMMANDS, filterSlashCommands, mentionQueryBefore, nextMenuIndex, slashQueryBefore } from "../web/src/notes-menu.ts"

test("slash : début de mot uniquement, position exacte", () => {
  assert.deepEqual(slashQueryBefore("/"), { query: "", start: 0 })
  assert.deepEqual(slashQueryBefore("Bonjour /"), { query: "", start: 8 })
  assert.deepEqual(slashQueryBefore("Bonjour /tit"), { query: "tit", start: 8 })
  assert.deepEqual(slashQueryBefore("Bonjour/ tit"), null)
  assert.deepEqual(slashQueryBefore("https://aven"), null)
  assert.deepEqual(slashQueryBefore("Un / puis /tab"), { query: "tab", start: 10 })
})

test("mention : un seul arobase, début de mot", () => {
  assert.deepEqual(mentionQueryBefore("@"), { query: "", start: 0 })
  assert.deepEqual(mentionQueryBefore("Salut @uni"), { query: "uni", start: 6 })
  assert.deepEqual(mentionQueryBefore("Salut@uni"), null)
  assert.deepEqual(mentionQueryBefore("@a@b"), null)
  assert.deepEqual(mentionQueryBefore("Salut @"), { query: "", start: 6 })
})

test("commandes : vide = toutes, filtre accents et mots-clés, ordre stable", () => {
  assert.equal(filterSlashCommands("").length, SLASH_COMMANDS.length)
  assert.deepEqual(filterSlashCommands("tache").map((c) => c.id), ["task"])
  assert.deepEqual(filterSlashCommands("tableau").map((c) => c.id), ["table"])
  assert.deepEqual(filterSlashCommands("titre").map((c) => c.id), ["h1", "h2", "h3"])
  assert.deepEqual(filterSlashCommands("zzz"), [])
})

test("navigation : bouclage et index invalide", () => {
  assert.equal(nextMenuIndex(0, 3, 1), 1)
  assert.equal(nextMenuIndex(2, 3, 1), 0)
  assert.equal(nextMenuIndex(0, 3, -1), 2)
  assert.equal(nextMenuIndex(9, 3, 1), 0)
  assert.equal(nextMenuIndex(0, 0, 1), 0)
})
