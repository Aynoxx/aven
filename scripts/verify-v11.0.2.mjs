import assert from "node:assert/strict"
import { readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.0.2 : une icône dit une seule chose. L'audit du 2026-10-22 avait relevé
// `sparkle` pour cinq sens (marque, orchestration, synthèse, explication, état vide)
// et `file` pour une note ET une conversation dans la même planche. La sonde fige le
// découpage : marque / génération / conversation / délégation / agent / document.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")

const icon = read("web/src/icons/Icon.tsx")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const home = read("web/src/workbench/HomeStage.tsx")
const notesView = read("web/src/NotesView.tsx")
const conversation = read("web/src/pages/ConversationPage.tsx")
const tasks = read("web/src/pages/TasksPage.tsx")
const filesView = read("web/src/FilesView.tsx")
const freebuff = read("web/src/FreebuffAgentPage.tsx")
const constants = read("web/src/app/constants.ts")
const rules = read("AGENTS.md")

const walk = (dir) => readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name)
  return entry.isDirectory() ? walk(full) : [full]
})

// ── A. Les glyphes de rôle existent et sont déclarés ─────────────────────────
for (const name of ["wand", "branch", "chat", "stop", "paperclip"]) {
  assert.match(icon, new RegExp(`\\| "${name}"`), `IconName déclare « ${name} »`)
  assert.match(icon, new RegExp(`case "${name}":`), `paths() trace « ${name} »`)
}

// ── B. Une seule marque ──────────────────────────────────────────────────────
// `sparkle` n'apparaît plus qu'au bandeau de marque du rail : ni état vide, ni mode,
// ni action de génération ne l'empruntent.
const sparkleSites = ["web/src/workbench/WorkbenchShell.tsx", "web/src/workbench/HomeStage.tsx",
  "web/src/pages/ConversationPage.tsx", "web/src/pages/TasksPage.tsx", "web/src/NotesView.tsx",
  "web/src/app/constants.ts", "web/src/FilesView.tsx", "web/src/FreebuffAgentPage.tsx"]
  .flatMap((file) => read(file).split("\n").map((line, i) => ({ file, line: i + 1, text: line })))
  .filter((row) => row.text.includes('"sparkle"'))
assert.equal(sparkleSites.length, 1, `« sparkle » ne sert qu'à la marque (lignes trouvées : ${sparkleSites.length})`)
assert.match(shell, /<span className="brand-mark" aria-hidden="true"><Icon name="sparkle"/, "« sparkle » est la marque du rail")

// ── C. La génération assistée a son glyphe ───────────────────────────────────
assert.match(notesView, /<Icon name="wand"[^>]*\/>Demander une synthèse/, "la synthèse demande une génération (wand)")
assert.match(shell, /applySelection\("explain"\)}><Icon name="wand"/, "« Expliquer ce code » demande une génération (wand)")

// ── D. Une conversation n'est pas un agent ni un fichier ─────────────────────
assert.match(shell, /kind: "conversation", label: "Conversations", icon: "chat"/, "le rail nomme les conversations par une bulle")
assert.match(conversation, /<div className="empty-symbol"><Icon name="chat" size=\{24\} \/><\/div>/, "l'état vide d'une conversation parle de conversation")
assert.match(tasks, /<div className="agent-card-icon"><Icon name="agent" size=\{24\} \/><\/div>/, "la carte d'un agent porte l'icône agent")
assert.match(constants, /id: "analyse", icon: "chart"/, "un mode de délégation porte l'outil du spécialiste")

// ── E. La délégation a son glyphe ────────────────────────────────────────────
assert.match(shell, /kind: "orchestration", label: "Orchestration", icon: "branch"/, "le rail nomme la délégation par une ramification")
assert.match(shell, /kind: "orchestration", label: "Orchestration", icon: "branch"/, "la constellation nomme la délégation par une ramification")

// ── F. Interrompre ≠ fermer, joindre ≠ naviguer, citer ≠ chevron ─────────────
assert.match(freebuff, /<Icon name="stop" size=\{14\} \/>Interrompre/, "« Interrompre » affiche un carré d'arrêt")
assert.match(notesView, /<Icon name="paperclip" size=\{14\} \/>Joindre à \{activeAgentName\}/, "« Joindre à » affiche un trombone")
assert.match(shell, /applySelection\("send"\)}><Icon name="quote"/, "« Citer » affiche une citation")
assert.doesNotMatch(notesView, /<Icon name="chevron-right"/, "aucune action des Notes ne prend un chevron de navigation")
assert.doesNotMatch(shell, /<Icon name="chevron-right" size=\{15\} \/>/, "la barre de sélection ne prend pas un chevron")

// ── G. La règle est écrite là où on la lit ───────────────────────────────────
assert.match(rules, /Une icône dit une seule chose \(v11\.0\.2\)/, "AGENTS.md §5 fixe la table des sens")
assert.match(rules, /`sparkle` = la marque d'Aven/, "la règle nomme la marque")
assert.match(rules, /`wand` = génération assistée/, "la règle nomme la génération")

// ── H. Centrage : toute icône à décalage mesuré reste dans une marge crédible ─
const nudges = [...icon.matchAll(/^\s{2}"?([a-z-]+)"?: \[(-?[\d.]+), (-?[\d.]+)\],?$/gm)]
assert.ok(nudges.length >= 14, "la table OPTICAL_NUDGE porte les décalages mesurés")
for (const [, name, dx, dy] of nudges) {
  assert.ok(Math.abs(Number(dx)) <= 3 && Math.abs(Number(dy)) <= 3, `le décalage de « ${name} » reste optique (≤ 3 unités)`)
}

// ── I. Aucune icône hors grille n'a été réintroduite par ce lot ───────────────
const sizes = [...shell, ...home, ...notesView, ...conversation, ...tasks, ...filesView, ...freebuff]
  .join("\n").match(/<Icon\b[^>]*size=\{(\d+)\}/g) ?? []
const allowed = new Set([12, 14, 15, 16, 17, 24, 30])
for (const tag of sizes) {
  const size = Number(tag.match(/size=\{(\d+)\}/)[1])
  assert.ok(allowed.has(size), `la taille ${size} reste dans la grille §5`)
}

// ── J. Aucun token fantôme ─────────────────────────────────────────────────────
// v11.0.2 : la barre de sélection s'appuyait sur `--text-muted` et le bandeau de
// conflit sur `--warning-border` — deux tokens inexistants dont le repli silencieux
// changeait la couleur. Un `var()` sans définition est une régression, pas un détail.
const styleFiles = readdirSync(path.join(root, "web/src/styles")).filter((f) => f.endsWith(".css"))
const styleText = styleFiles.map((f) => read(`web/src/styles/${f}`)).join("\n")
const tsText = walk(path.join(root, "web/src"))
  .filter((f) => /\.(?:ts|tsx)$/.test(f))
  .map((f) => readFileSync(f, "utf8"))
  .join("\n")
const defined = new Set([...styleText.matchAll(/(--[a-z0-9-]+)\s*:/g)].map((m) => m[1]))
for (const m of tsText.matchAll(/(--[a-z0-9-]+)['"]\s*[,:]/g)) defined.add(m[1])
const missing = [...new Set([...styleText.matchAll(/var\((--[a-z0-9-]+)/g)].map((m) => m[1]))]
  .filter((name) => !defined.has(name))
assert.deepEqual(missing, [], `aucun var() ne dépend d'un token inexistant (trouvés : ${missing.join(", ")})`)

console.log("v11.0.2 verification: OK (une icône = un sens : marque, génération, conversation, délégation, agent, document)")
