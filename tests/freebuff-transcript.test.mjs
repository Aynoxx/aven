import assert from "node:assert/strict"
import { buildTranscript, isSessionBar, isNoise, isUserLine, trimBorders, isDecorationOnly } from "../web/src/freebuff-transcript.ts"

// Cas réels observés dans le TUI Freebuff (screenshots utilisateur, v9.6.0).

// ── Rogner les bordures ─────────────────────────────────────────────────────────
assert.equal(trimBorders("│ 40/40 Freebucks remaining            │"), "40/40 Freebucks remaining")
assert.equal(trimBorders("| The AI code reviewer                     Ad |"), "The AI code reviewer                     Ad")
assert.equal(trimBorders("├──────┬──────┤"), "")

// Lignes de pure décoration → rejetées.
assert.ok(isDecorationOnly("├──────┬──────┤"))
// Le pipeline applique trimBorders AVANT isDecorationOnly : une boîte vide est vidée puis rejetée.
assert.equal(trimBorders("│      │"), "")
assert.ok(isDecorationOnly(trimBorders("│      │")))
assert.ok(isDecorationOnly("   "))
assert.ok(!isDecorationOnly("Enter a coding task or / for commands"))

// ── Barre de session ────────────────────────────────────────────────────────────
assert.ok(isSessionBar("40/40 Freebucks remaining"))
assert.ok(isSessionBar("40/40 freebucks remaining"))
assert.ok(isSessionBar("40/40 Freebucks remaining   "))
assert.ok(isSessionBar("5 day streak"))
assert.ok(isSessionBar("2h 30m restant"))
assert.ok(isSessionBar("2h left today"))
assert.ok(isSessionBar("session quota: 40"))
assert.ok(!isSessionBar("Corrige le bug d'authentification"))
assert.ok(!isSessionBar("Analyse le fichier src/main.ts"))

// ── Bruit (pubs, invitations, écran d'accueil, barres d'état) ──────────────────
assert.ok(isNoise("The AI code reviewer"))
assert.ok(isNoise("AI agents that review and test PRs with full context of the codebase."))
assert.ok(isNoise("Try it free  greptile.com"))
assert.ok(isNoise("✦ Refer friends → earn Freebucks:"))
assert.ok(isNoise("Copy invite link  Learn More ↗"))
assert.ok(isNoise("5 day streak"))
assert.ok(isNoise("Your first message starts the session."))
assert.ok(isNoise("Enter a coding task or / for commands"))
assert.ok(isNoise("← for history · ? for help"))
assert.ok(isNoise("GLM 5.3 Flash · max · ~/Downloads/Aven · /model to change · Chat: New chat"))
assert.ok(isNoise("Ad"))
assert.ok(!isNoise("Corrige le bug d'authentification"))
assert.ok(!isNoise("Voici l'analyse du fichier :"))

// ── Lignes utilisateur ──────────────────────────────────────────────────────────
assert.ok(isUserLine("❯ corrige le bug d'authentification"))
assert.ok(isUserLine("> résume le projet"))
assert.ok(isUserLine("vous: résume le projet"))
assert.ok(!isUserLine("Freebuff démarre l'analyse"))

// ── Intégration buildTranscript ────────────────────────────────────────────────
const raw = [
  "│ Your first message starts the session.        │",
  "│ 40/40 Freebucks remaining          │",
  "│ 5 day streak                │",
  "│ ✦ Refer friends → earn Freebucks: │",
  "│ Copy invite link  Learn More ↗    │",
  "│ The AI code reviewer                Ad │",
  "│ AI agents that review and test PRs with full context of the codebase. │",
  "│ Try it free  greptile.com           │",
  "│ ❯ Enter a coding task or / for commands │",
  "GLM 5.3 Flash · max · ~/Downloads/Aven · /model to change · Chat: New chat",
  "← for history · ? for help",
  "│ Bonjour, voici l'analyse demandée :         │",
  "│ le fichier src/main.ts contient l'erreur.   │",
]
const { lines, sessionBar } = buildTranscript(raw)
assert.equal(sessionBar, "40/40 Freebucks remaining")
const texts = lines.map((l) => l.text)
assert.deepEqual(texts, ["Bonjour, voici l'analyse demandée :", "le fichier src/main.ts contient l'erreur."])
assert.ok(lines.every((l) => !l.user))

const rawUser = ["❯ Corrige le bug puis explique", "Voici le correctif appliqué."]
const { lines: lu } = buildTranscript(rawUser)
assert.equal(lu[0].user, true)
assert.equal(lu[1].user, false)

console.log("freebuff-transcript: OK")
