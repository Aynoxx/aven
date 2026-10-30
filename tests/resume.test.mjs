import assert from "node:assert/strict"
import { test } from "node:test"
import { ageLabel, excerptOf, noteExcerpt, resumeBoard } from "../web/src/workbench/resume.ts"

// v12.3.0 : « Reprendre » montre trois natures réelles, jamais du remplissage.
// Ces tests fixent les refus : pas de titre vide, pas de note vide, pas de fichier
// sans chemin, pas d'âge négatif, extrait réel et tronqué aux mots.

const NOW = Date.UTC(2026, 9, 30, 12, 0, 0)
const hour = (n) => n * 3_600_000
const min = (n) => n * 60_000

test("resumeBoard : une entrée par nature, dans l'ordre conversation → note → fichier", () => {
  const board = resumeBoard({
    chats: [{ id: "c1", title: "Refonte du Poste", updated: NOW - hour(3), preview: "On reprend la sphère." }],
    notes: [{ id: "n1", title: "Voix Pocket", markdown: "Le moteur local lit le PCM.", updated: NOW - hour(1) }],
    files: [{ path: "src-tauri/tauri.conf.json", name: "tauri.conf.json", opened: NOW - min(5) }],
  })
  assert.deepEqual(board.map((entry) => entry.kind), ["conversation", "note", "file"])
  assert.equal(board[0].excerpt, "On reprend la sphère.")
  assert.equal(board[1].excerpt, "Le moteur local lit le PCM.")
  assert.equal(board[2].excerpt, "src-tauri", "le fichier montre son dossier, pas un chemin qui répète son titre")
})

test("resumeBoard : l'extrait d'une note ne répète pas son titre", () => {
  const board = resumeBoard({
    chats: [],
    notes: [{ id: "n1", title: "Réveil vocal", markdown: "# Réveil vocal\n\nLe STT rend « Raven ».", updated: NOW }],
    files: [],
  })
  assert.equal(board[0].excerpt, "Le STT rend « Raven ».")
})

test("resumeBoard : un fichier à la racine n'a pas d'extrait redondant", () => {
  const board = resumeBoard({ chats: [], notes: [], files: [{ path: "journal.md", name: "journal.md", opened: NOW }] })
  assert.equal(board[0].excerpt, "")
})

test("noteExcerpt : un titre qui n'ouvre pas la note reste dans le corps", () => {
  assert.equal(noteExcerpt("Intro.\n\n## Sous-titre\n\nSuite."), "Intro. Sous-titre Suite.")
})

test("resumeBoard : la plus récente de chaque nature est retenue", () => {
  const board = resumeBoard({
    chats: [
      { id: "vieux", title: "Ancienne", updated: NOW - hour(30) },
      { id: "recent", title: "Récente", updated: NOW - hour(1) },
    ],
    notes: [
      { id: "n-vieille", title: "Vieille note", markdown: "Texte", updated: NOW - hour(40) },
      { id: "n-recente", title: "Note récente", markdown: "Texte", updated: NOW - hour(2) },
    ],
    files: [
      { path: "b.md", name: "b.md", opened: NOW - min(10) },
      { path: "a.md", name: "a.md", opened: NOW - min(2) },
    ],
  })
  assert.deepEqual(board.map((entry) => entry.id), ["recent", "n-recente", "a.md"])
})

test("resumeBoard : une conversation au titre par défaut et vide n'est pas une reprise", () => {
  const board = resumeBoard({
    chats: [{ id: "neuve", title: "Nouvelle conversation", updated: NOW }, { id: "vraie", title: "Refonte", updated: NOW - hour(2), preview: "On reprend la sphère." }],
    notes: [],
    files: [],
  })
  assert.deepEqual(board.map((entry) => entry.id), ["vraie"])
})

test("resumeBoard : une conversation au titre par défaut GARDE sa place si elle a un message", () => {
  const board = resumeBoard({
    chats: [{ id: "bavarde", title: "Nouvelle conversation", updated: NOW, preview: "Le maillage suit la phase." }],
    notes: [],
    files: [],
  })
  assert.deepEqual(board.map((entry) => entry.id), ["bavarde"])
})

test("resumeBoard : une note sans contenu n'est jamais une reprise", () => {
  const board = resumeBoard({
    chats: [],
    notes: [{ id: "vide", title: "Note vide", markdown: "   \n  ", updated: NOW }],
    files: [],
  })
  assert.deepEqual(board, [])
})

test("resumeBoard : une note qui ne dit pas plus que son titre n'est pas une reprise", () => {
  // Cas réel trouvé dans l'espace de test : le corps recopie le titre.
  const board = resumeBoard({
    chats: [],
    notes: [{ id: "stub", title: "sans contenu avec comme nom importation", markdown: "# sans contenu avec comme nom importation\n\nsans contenu avec comme nom importation\n", updated: NOW }],
    files: [],
  })
  assert.deepEqual(board, [])
})

test("resumeBoard : une note réduite à son seul titre est écartée", () => {
  const board = resumeBoard({ chats: [], notes: [{ id: "titre", title: "Idée", markdown: "# Idée\n", updated: NOW }], files: [] })
  assert.deepEqual(board, [])
})

test("resumeBoard : une note au corps réel reste proposée", () => {
  const board = resumeBoard({ chats: [], notes: [{ id: "vraie", title: "Idée", markdown: "# Idée\n\nUne piste pour le réveil.", updated: NOW }], files: [] })
  assert.equal(board[0].excerpt, "Une piste pour le réveil.")
})

test("resumeBoard : sans titre ou sans chemin, l'entrée est écartée", () => {
  const board = resumeBoard({
    chats: [{ id: "c1", title: "   ", updated: NOW }],
    notes: [{ id: "n1", title: "Titre", markdown: "Contenu", updated: NOW }],
    files: [{ path: "", name: "orphelin.md", opened: NOW }],
  })
  assert.deepEqual(board.map((entry) => entry.kind), ["note"])
})

test("resumeBoard : une compensation par une autre nature n'existe pas", () => {
  const board = resumeBoard({ chats: [], notes: [], files: [] })
  assert.deepEqual(board, [])
})

test("resumeBoard : une conversation sans aperçu garde son titre et un extrait vide", () => {
  const board = resumeBoard({ chats: [{ id: "c1", title: "Sans aperçu", updated: NOW }], notes: [], files: [] })
  assert.equal(board.length, 1)
  assert.equal(board[0].excerpt, "")
})

test("excerptOf : retire le balisage Markdown et les blocs de code", () => {
  const text = excerptOf("## Titre\n\nUne **idée** `forte`.\n\n```js\nconsole.log('x')\n```")
  assert.equal(text, "Titre Une idée forte.")
})

test("excerptOf : tronque aux mots, jamais au milieu, avec une ellipse", () => {
  const text = excerptOf("mot ".repeat(80), 40)
  assert.ok(text.length <= 41, `extrait trop long : ${text.length}`)
  assert.ok(text.endsWith("…"))
  assert.ok(text.slice(0, -1).endsWith("mot"), "la coupe tombe sur une frontière de mot")
})

test("excerptOf : un contenu vide reste vide, sans ellipse", () => {
  assert.equal(excerptOf("   \n "), "")
  assert.equal(excerptOf(undefined), "")
})

test("ageLabel : minutes, heures, hier, jours, date absolue", () => {
  assert.equal(ageLabel(NOW - 30_000, NOW), "à l’instant")
  assert.equal(ageLabel(NOW - min(12), NOW), "il y a 12 min")
  assert.equal(ageLabel(NOW - hour(3), NOW), "il y a 3 h")
  assert.equal(ageLabel(NOW - 24 * hour(1), NOW), "hier")
  assert.equal(ageLabel(NOW - 24 * hour(4), NOW), "il y a 4 j")
  assert.equal(ageLabel(Date.UTC(2026, 8, 12), NOW), "le 12/09")
})

test("ageLabel : une horloge en avance ne produit jamais un âge négatif", () => {
  assert.equal(ageLabel(NOW + hour(2), NOW), "à l’instant")
})

test("ageLabel : une date absente est dite, pas devinée", () => {
  assert.equal(ageLabel(0, NOW), "date inconnue")
  assert.equal(ageLabel(Number.NaN, NOW), "date inconnue")
})
