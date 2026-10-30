import assert from "node:assert/strict"
import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

// v11.16.0 : une note demandée comme CONTENU se rédige, elle ne se recopie pas.
// La sonde fige la convention, dans l'ordre du risque :
//   A. la décision dictée / composition reste PURE et donne la priorité à la
//      dictée explicite (on ne réécrit jamais « note que… ») ;
//   B. la composition n'ouvre qu'une porte : aucun outil, aucune écriture ;
//   C. l'échec est DIT et n'écrit rien — jamais une note qui recopie la demande ;
//   D. le texte composé est relu avant le « oui », et l'écriture reste unique.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
// v12.0.0 : GitHub Actions checkout convertit le dépôt en CRLF ; les repères
// ci-dessous (« \n} », « \n}\n ») ne trouvaient plus la fin d'une fonction et la
// sonde relisait alors TOUT le fichier — elle échouait sur du code correct.
// On normalise la fin de ligne à la lecture : le texte analysé, pas le disque.
const read = (p) => readFileSync(path.join(root, p), "utf8").replaceAll("\r\n", "\n")
const pkg = JSON.parse(read("package.json"))
const tauri = JSON.parse(read("src-tauri/tauri.conf.json"))
const lock = JSON.parse(read("package-lock.json"))
const cargo = read("src-tauri/Cargo.toml")
const cargoLock = read("src-tauri/Cargo.lock")
const readme = read("README.md")
const agents = read("AGENTS.md")
const note = read("web/src/voice-agent/note.ts")
const hook = read("web/src/voice-agent/use-voice-agent.ts")
const speech = read("host/voice-agent-speech.ts")
const host = read("host/aven-app-host.ts")
const types = read("web/src/types.ts")
const e2e = read("scripts/test-voice-note-e2e.mjs")

const slice = (text, start, end) => {
  const from = text.indexOf(start)
  const to = end ? text.indexOf(end, from) : -1
  assert.ok(from > 0, `repère introuvable : ${start}`)
  return text.slice(from, to > from ? to : undefined)
}

// ── Version cohérente dans tous les manifestes ─────────────────────────────
assert.match(pkg.version, /^\d+\.\d+\.\d+$/, "package.json porte une version sémantique")
assert.equal(tauri.version, pkg.version, "tauri.conf.json suit package.json")
assert.equal(lock.version, pkg.version, "package-lock.json correspond à package.json")
assert.equal(lock.packages[""].version, pkg.version, "le paquet racine du lock est synchronisé")
assert.match(cargo, new RegExp(`^version = "${pkg.version.replaceAll(".", "\\.")}"$`, "m"), "Cargo.toml suit package.json")
assert.match(cargoLock, new RegExp(`\\[\\[package\\]\\]\\r?\\nname = "aven"\\r?\\nversion = "${pkg.version.replaceAll(".", "\\.")}"`), "Cargo.lock suit package.json")
assert.match(readme, new RegExp(`^# Aven v${pkg.version.replaceAll(".", "\\.")}$`, "m"), "README annonce la version courante")
assert.ok(pkg.scripts.verify.includes("scripts/verify-v11.16.0.mjs"), "npm run verify inclut la sonde courante")
assert.equal(pkg.scripts["verify:v11.16.0"], "node scripts/verify-v11.16.0.mjs", "la sonde a son entrée npm")
assert.match(readme, new RegExp(`v${pkg.version.replaceAll(".", "\\.")} — `), "README porte la note de la version courante")

// ── A. La dictée garde la priorité, la composition est un cas explicite ────
// Une note dictée ne doit JAMAIS être réécrite : la décision commence donc par
// écarter une dictée explicite, puis seulement reconnaît un contenu à composer.
const composeFn = slice(note, "export function noteNeedsComposition", "\n}")
assert.match(composeFn, /if \(!raw \|\| DICTATION_START\.test\(raw\)\) return false/,
  "une dictée explicite n'est jamais composée")
for (const marker of ["NOTE_IS_CONTENT", "NOTE_ON_TOPIC", "COMPOSE_MARKER", "HOW_TO"]) {
  assert.match(note, new RegExp(`const ${marker} =`), `le marqueur ${marker} existe`)
}assert.match(composeFn, /(?:NOTE_IS_CONTENT|NOTE_ON_TOPIC|NOTE_ON_TOPIC_EXT|COMPOSE_MARKER|HOW_TO|REQUEST_NATURAL)\.test\(raw\)/, "la composition reconnaît tous ses marqueurs")

assert.match(note, /const DICTATION_START =\s*\r?\n?\s*\/\^\(\?:note\|retiens\|pense/, "la dictée est reconnue par son verbe")

// ── B. Une seule porte de rédaction, sans outil ni écriture ────────────────
const composeVoice = slice(speech, "export async function composeVoiceNote", "\n}\n")
assert.match(composeVoice, /withTools: false/, "la rédaction n'offre aucun outil au modèle")
assert.doesNotMatch(composeVoice, /\btools:/, "la rédaction ne déclare aucun outil")
assert.doesNotMatch(composeVoice, /notesCreate|onCreateNote|writeTextAtomic/, "la rédaction n'écrit rien")
assert.match(speech, /ne recopies pas la demande/, "le prompt interdit la recopie de la demande")
assert.match(speech, /sans titre, sans préambule/, "le prompt rend le texte de la note, pas un discours")
const composeTokens = Number(speech.match(/COMPOSE_NOTE_MAX_TOKENS = ([\d_]+)/)?.[1]?.replaceAll("_", ""))
assert.ok(composeTokens >= 700, `un vrai résumé a de la place (max_tokens=${composeTokens})`)
assert.match(types, /voiceAgentComposeNote: \(demand: string\) => Promise<\{ content: string \}>/,
  "le contrat IPC rend le contenu composé")
assert.equal(host.match(/case "voiceAgentComposeNote"/g)?.length, 1, "une seule route de composition")
assert.match(slice(host, 'case "voiceAgentComposeNote"', "}\n    }"), /return composeVoiceNote\(demand, \{ apiKey: requireGroqKey\(\) \}\)/,
  "la route compose avec la clé Groq, sans autre chemin")

// ── C. L'échec est dit, et n'écrit rien ────────────────────────────────────
// Le pire résultat serait une note silencieuse qui recopie la demande : sur
// panne de rédaction, on préfère aucune note et une erreur audible.
const composeNote = slice(hook, "const composeNote = useCallback", "}, [awaitNote")
assert.match(composeNote, /const result = await api\.voiceAgentComposeNote\(demand\)/, "le renderer appelle la rédaction")
assert.match(composeNote, /if \(!content\) throw new Error\(/, "un contenu vide est un échec, pas une note")
assert.match(composeNote, /catch \(error\) \{\s*\r?\n\s*reportError\(error\)/, "l'échec est dit à l'utilisateur")
assert.doesNotMatch(composeNote, /onCreateNote/, "la rédaction n'écrit jamais la note")
assert.match(agents, /Une note se comprend, elle ne se recopie pas \(v11\.16\.0\)/, "AGENTS.md dit la règle")

// ── D. Le texte composé est relu, puis l'écriture reste unique ─────────────
assert.match(composeNote, /awaitNote\(content\)/, "le texte composé devient le brouillon relu")
assert.match(composeNote, /await say\(noteConfirmPrompt\(content\)\)/, "la question relit le texte composé")
// La question est prononcée : le Markdown d'une note rédigée ne se lit pas.
assert.match(note, /export function spokenDraft/, "la relecture orale est un module pur")
const promptFn = slice(note, "export function noteConfirmPrompt", "\n}\n")
assert.match(promptFn, /spokenDraft\(draft\)/, "la question ne lit pas le Markdown écrit")
assert.doesNotMatch(promptFn, /String\(draft \?\? ""\)/, "aucun chemin ne relit le texte brut")
const answerPending = slice(hook, "const answerPendingNote = useCallback", "}, [askNoteConfirmation")
const needsAt = answerPending.indexOf("noteNeedsComposition(text)")
const confirmAt = answerPending.indexOf("await askNoteConfirmation(text)")
assert.ok(needsAt > 0 && confirmAt > needsAt, "la réponse décrite est composée avant d'être confirmée mot pour mot")
const writes = hook.match(/onCreateNote\(/g) ?? []
assert.equal(writes.length, 1, "un seul chemin écrit la note")
assert.match(slice(hook, "const writeConfirmedNote = useCallback", "}, [clearPendingNote"), /onCreateNote\(draft\)/,
  "l'écriture vit dans la branche confirmée")

// ── E. Le bout en bout prouve le contenu, pas la demande ───────────────────
assert.match(e2e, /const CONTENT_REQUEST =/, "le test de bout en bout énonce une demande de contenu")
assert.match(e2e, /assert\.notEqual\(created\.markdown\.trim\(\), CONTENT_REQUEST, "la note ne doit pas être la demande seule"\)/,
  "le test refuse la recopie de la demande")

console.log("v11.16.0 verification: OK (note composée, jamais recopiée, écriture toujours confirmée)")
