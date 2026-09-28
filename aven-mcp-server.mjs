// Serveur MCP des notes Aven (v9.5.0) — zéro dépendance, protocole stdio (JSON-RPC 2.0).
// Le CLI Freebuff le lance via .agents/mcp.json (généré par agents-bridge.ts) : il
// expose les notes Markdown de CET espace — mêmes fichiers que la page Notes de
// l'interface Aven. Le dossier des notes est passé en argument (--notes-dir) par la
// config générée : le serveur vit dans l'installation d'Aven (racine en dev,
// resources/ packagé), jamais dans l'espace de travail.
// Outils : aven_notes_list, aven_notes_read, aven_notes_search (lecture seule —
// l'écriture des notes reste dans l'interface, où l'utilisateur valide).
import { existsSync, readdirSync, readFileSync } from "node:fs"
import path from "node:path"

function notesDirFromArgv() {
  const i = process.argv.indexOf("--notes-dir")
  if (i >= 0 && process.argv[i + 1]) return path.resolve(process.argv[i + 1])
  // Repli : cwd (le CLI lance les serveurs MCP depuis la racine du projet).
  return path.join(process.cwd(), ".opencodeapp", "notes")
}

const NOTE_DIR = notesDirFromArgv()

function notesIndex() {
  if (!existsSync(NOTE_DIR)) return []
  return readdirSync(NOTE_DIR)
    .filter((f) => f.toLowerCase().endsWith(".md"))
    .map((id) => {
      let markdown = ""
      try { markdown = readFileSync(path.join(NOTE_DIR, id), "utf8") } catch { return null }
      const first = markdown.match(/^#\s+(.+)$/m)
      return { id, title: first ? first[1] : id.replace(/\.md$/i, ""), markdown }
    })
    .filter(Boolean)
}

const tools = [
  { name: "aven_notes_list", description: "Liste les notes Markdown de l'espace Aven (id, titre)", inputSchema: { type: "object", properties: {}, additionalProperties: false } },
  { name: "aven_notes_read", description: "Lit une note Aven complète (Markdown)", inputSchema: { type: "object", properties: { id: { type: "string", description: "Nom du fichier, ex. comptes-rendus.md" } }, required: ["id"], additionalProperties: false } },
  { name: "aven_notes_search", description: "Recherche plein-texte dans les notes Aven (insensible à la casse)", inputSchema: { type: "object", properties: { query: { type: "string", description: "Texte cherché" } }, required: ["query"], additionalProperties: false } },
]

function text(t) {
  return { content: [{ type: "text", text: t }] }
}

function callTool(name, args) {
  const notes = notesIndex()
  if (name === "aven_notes_list") {
    return text(notes.map((n) => `- ${n.id} — ${n.title}`).join("\n") || "(aucune note)")
  }
  if (name === "aven_notes_read") {
    const id = String(args?.id ?? "").replace(/[\\/]/g, "")
    const note = notes.find((n) => n.id.toLowerCase() === id.toLowerCase())
    return note ? text(note.markdown) : { isError: true, ...text(`Note introuvable : ${id}`) }
  }
  if (name === "aven_notes_search") {
    const q = String(args?.query ?? "").toLowerCase().trim()
    if (!q) return text("(requête vide)")
    const hits = notes.filter((n) => n.markdown.toLowerCase().includes(q))
    return text(hits.map((n) => `- ${n.id} — ${n.title}`).join("\n") || "(aucun résultat)")
  }
  return { isError: true, ...text(`Outil inconnu : ${String(name)}`) }
}

let buffer = ""
process.stdin.setEncoding("utf8")
process.stdin.on("data", (chunk) => {
  buffer += chunk
  let index
  while ((index = buffer.indexOf("\n")) >= 0) {
    const line = buffer.slice(0, index).trim()
    buffer = buffer.slice(index + 1)
    if (!line) continue
    let msg
    try { msg = JSON.parse(line) } catch { continue }
    let result
    if (msg.method === "initialize") {
      result = { protocolVersion: msg.params?.protocolVersion ?? "2024-11-05", capabilities: { tools: {} }, serverInfo: { name: "aven-notes", version: "9.5.0" } }
    } else if (msg.method === "tools/list") {
      result = { tools }
    } else if (msg.method === "tools/call") {
      result = callTool(String(msg.params?.name ?? ""), msg.params?.arguments)
    } else if (msg.id === undefined || msg.id === null) {
      continue // notification (initialized, cancelled…) : rien à répondre
    } else {
      result = {} // méthode inconnue : réponse vide conforme
    }
    process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id: msg.id, result }) + "\n")
  }
})
