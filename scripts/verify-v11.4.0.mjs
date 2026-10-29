import assert from "node:assert/strict"
import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.4.0 : création de note à la voix. Ce que la sonde fige, dans l'ordre du
// risque — une note mal écrite est une erreur invisible :
//   A. aucun chemin d'écriture ne s'ouvre sans une réponse classée « confirm » ;
//   B. la question RÉPÈTE le contenu, et le refus est classé avant l'accord ;
//   C. une note dictée ne part jamais au LLM conversationnel (il répondrait
//      « c'est noté ») ; une note demandée comme contenu passe par l'appel de
//      composition dédié, qui ne peut pas écrire ;
//   D. consulter une note reste une navigation, jamais une création ;
//   E. l'écriture passe par l'IPC existant, l'écrit est rendu visible ;
//   F. la décision expire : un « oui » tardif n'écrit rien.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const read = (p) => readFileSync(path.join(root, p), "utf8")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")

const note = read("web/src/voice-agent/note.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const shell = read("web/src/workbench/WorkbenchShell.tsx")
const types = read("web/src/types.ts")
const host = read("host/aven-app-host.ts")
const tests = read("tests/voice-agent-note.test.mjs")

// ── Version cohérente dans tous les manifestes ───────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.4.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.4.0"], "node scripts/verify-v11.4.0.mjs", "la sonde a son entrée npm")

// ── A. Une seule écriture, atteinte seulement sur « confirm » ───────────────
assert.match(note, /Pur : testable avec Node seul/, "le module de note se déclare pur")
assert.match(note, /export function parseNoteDraft/, "le brouillon est extrait par une fonction exportée")
assert.match(note, /export function classifyNoteReply/, "la réponse orale est classée par une fonction exportée")
// Le point irréversible : la création de note n'existe qu'à UN endroit du hook.
const writeCalls = hook.match(/optionsRef\.current\.onCreateNote\(/g) ?? []
assert.equal(writeCalls.length, 1, "une seule ligne écrit la note")
assert.match(hook, /const writeConfirmedNote = useCallback/, "l'écriture est isolée dans writeConfirmedNote")
const writeInvocations = hook.match(/writeConfirmedNote\(/g) ?? []
assert.equal(writeInvocations.length, 1, "writeConfirmedNote n'est appelée qu'une fois")
assert.match(
  hook,
  /if \(reply === "confirm"\) \{\s*await writeConfirmedNote\(pending\.draft\)/,
  "l'écriture n'est atteinte que si la réponse est un accord classé",
)
assert.match(hook, /const reply = classifyNoteReply\(text\)/, "toute parole pendant l'attente est classée")
assert.doesNotMatch(hook, /localStorage/, "aucun brouillon n'est conservé dans le stockage du navigateur")

// ── B. La question répète le contenu ; le refus passe avant l'accord ────────
assert.match(
  note,
  /`Je note : « \$\{shown\} »\. Je l’enregistre \?`/,
  "la question de confirmation répète le contenu avant d'écrire",
)
const cancelAt = note.indexOf("CANCEL_START.test(value)")
const confirmAt = note.indexOf("CONFIRM_START.test(value)")
assert.ok(cancelAt > 0 && confirmAt > 0, "les deux familles de réponses sont testées")
assert.ok(cancelAt < confirmAt, "un refus est classé AVANT un accord")
assert.match(note, /n\['’\]enregistre\\s\+pas/, "« n'enregistre pas » est un refus explicite")
assert.match(note, /NOTE_CONFIRM_MS = 45_000/, "la fenêtre de décision est figée")
assert.match(note, /NOTE_CANCELLED_REPLY/, "le refus a sa phrase, dite à l'utilisateur")

// ── C. Une note dictée ne part JAMAIS au LLM conversationnel ───────────────
const parseAt = hook.indexOf("const note = parseNoteDraft(interpreted.demand)")
const askAt = hook.indexOf("await ask(interpreted.demand)")
assert.ok(parseAt > 0, "le hook extrait le brouillon de la demande interprétée")
assert.ok(askAt > 0, "le hook garde le chemin de demande libre")
assert.ok(parseAt < askAt, "le brouillon est décidé avant tout envoi au LLM")
// v11.16.0 : une phrase qui décrit le contenu à rédiger ne devient pas un
// brouillon littéral ; elle passe par l'appel de composition dédié, qui n'écrit
// pas. Le contenu dicté, lui, garde sa confirmation littérale.
assert.match(hook, /if \(note\.draft\.trim\(\) && noteNeedsComposition\(interpreted\.demand\)\) await composeNote\(interpreted\.demand\)/, "une note à rédiger est composée")
assert.match(hook, /else if \(note\.draft\.trim\(\)\) await askNoteConfirmation\(note\.draft\)/, "un contenu dicté ouvre la confirmation")
assert.match(hook, /else await askNoteContent\(\)/, "une note sans contenu demande le texte au lieu de deviner")
// « oui » n'a pas besoin de « Aven » : la réponse est consommée avant le réveil.
const answerAt = hook.indexOf("await answerPendingNote(text)")
const interpretAt = hook.indexOf("api.voiceAgentInterpret(")
assert.ok(answerAt > 0 && interpretAt > 0, "les deux chemins existent")
assert.ok(answerAt < interpretAt, "la réponse à la confirmation est traitée avant l'interprétation")

// ── D. Consulter une note n'en crée pas une ────────────────────────────────
const patternsBlock = note.slice(note.indexOf("const REQUEST_PATTERNS"), note.indexOf("const CANCEL_START"))
assert.doesNotMatch(patternsBlock, /ouvre|affiche|montre/i, "les verbes de consultation n'ouvrent pas une création")
assert.match(tests, /consulter une note n'est pas en créer une/, "le test verrouille ce piège")
assert.match(tests, /"ouvre une note"/, "la phrase exacte « ouvre une note » est testée")
assert.ok(existsSync(path.join(root, "tests/voice-agent-note.test.mjs")), "les tests du module existent")

// ── E. IPC existant, écrit visible, aucun nouveau secret ───────────────────
assert.match(types, /noteQuickCapture: \(title: string, markdown: string\) => Promise<Note>/, "le contrat IPC existant est réutilisé")
assert.match(host, /case "noteQuickCapture":/, "le host traite la capture rapide")
assert.match(shell, /api\.noteQuickCapture\(noteTitleFromDraft\(draft\), draft\)/, "le Poste écrit le contenu dicté")
assert.match(shell, /openNotesView\(note\.id\)/, "la note créée s'affiche — l'écrit doit être visible")
assert.match(shell, /return note\.title/, "le titre créé est rendu pour être dit")
assert.match(shell, /onCreateNote: async \(draft\) =>/, "le Poste branche la création de note")
assert.doesNotMatch(shell, /localStorage|writeFile/, "le renderer n'écrit aucun fichier")
assert.match(note, /noteTitleFromDraft/, "le titre dérive du contenu, pas d'un horodatage")
assert.equal((shell.match(/onCreateNote/g) ?? []).length, 1, "le Poste branche la création une seule fois")
assert.equal((hook.match(/onCreateNote/g) ?? []).length, 2, "une déclaration de type, un appel au Poste")

// ── F. La décision expire, le micro et le stop l'annulent ──────────────────
assert.match(hook, /noteConfirmationOpen\(pending\.askedAt\)/, "une réponse trop tardive n'écrit rien")
assert.match(note, /export function noteConfirmationOpen/, "la fenêtre est une fonction pure testée")
const clears = (hook.match(/clearPendingNote\(\)/g) ?? []).length
assert.ok(clears >= 4, `l'attente est annulée sur mute, stop, démontage et après décision (${clears})`)
assert.match(agents, /Une note dictée se confirme/, "AGENTS.md fige la règle de la confirmation orale")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

console.log("v11.4.0 verification: OK (note vocale — confirmation orale obligatoire, un seul chemin d'écriture)")
