// v9.6.0 : filtrage du transcript de l'agent Freebuff (module pur, testé).
// Le TUI Freebuff mélange discours, bordures, pubs et barres d'état : ce module
// transforme le buffer xterm en une conversation lisible.
//  - rogne les bordures de boîtes en début/fin de ligne (│ ║ | ─ ═ ├ ┤ …) ;
//  - sort la barre de SESSION (quota « 40/40 Freebucks remaining », durée restante,
//    streak) pour l'afficher dans la barre dédiée `.freebuff-sessionbar` ;
//  - retire le bruit non-parole : pubs (« The AI code reviewer », greptile.com,
//    « Refer friends », « Copy invite link », lignes « Ad »), écran d'accueil du TUI,
//    barres d'état (« GLM 5.3 Flash · max · … », « ← for history · ? for help ») ;
//  - garde le discours et marque les lignes de prompt utilisateur (❯ / >).
// Pure logique, aucun import : testable sans charger de .tsx (limite du runner).

// Bordures de boîtes TUI : ─-╿ couvre le bloc « box drawing » U+2500-U+257F.
export function trimBorders(line: string): string {
  return line
    .replace(/^[\s│║┃|┆┊┌┐└┘╭╮╰╯├┤┬┴┼─━═]+/, "")
    .replace(/[\s│║┃|┆┊┌┐└┘╭╮╰╯├┤┬┴┼─━═]+$/, "")
}

// Une ligne résiduelle n'est plus que de la décoration (bordures, spinners, règles).
export function isDecorationOnly(line: string): boolean {
  const t = line.trim()
  if (!t) return true
  return /^[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏✓✔✗·∙•←↑→↓—─-╿+\/=\\^|]*$/.test(t)
}

// Barre de session : quota Freebucks (« 40/40 Freebucks remaining »), durée restante,
// streak quotidien. Capture la ligne pour la barre dédiée hors transcript.
const SESSION_PATTERNS: RegExp[] = [
  /\d+\s*\/\s*\d+\s*(?:freebucks?|crédits?|credits?|quota)/i,
  /(?:freebucks?|crédits?|credits?|quota)\s*[\w\s]{0,20}\d+\s*\/\s*\d+/i,
  /\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)\b[^\n]{0,40}(?:restant|left|remaining|quota)/i,
  /(?:restant|left|remaining|quota)[^\n]{0,40}\d+\s*(?:h|hr|hrs|m|min|mins|s|sec|secs)\b/i,
  /\d+\s*(?:day|days|jour|jours)\s+streak/i,
  /\b(?:daily|session|quota)\b[^\n]{0,60}\d/i,
]

export function isSessionBar(line: string): boolean {
  return SESSION_PATTERNS.some((re) => re.test(line))
}

// Priorité d'affichage : le quota (« 40/40 Freebucks ») l'emporte sur le streak.
export function sessionBarScore(line: string): number {
  return /\d+\s*\/\s*\d+\s*(?:freebucks?|crédits?|credits?)/i.test(line) ? 2 : 1
}

// Bruit non-parole : pubs, invitations, écran d'accueil, barres d'état TUI.
const NOISE_PATTERNS: RegExp[] = [
  /\bgreptile\b/i,
  /\brefer\s+friends?\b/i,
  /\bearn\s+freebucks?\b/i,
  /copy\s+invite/i,
  /\bday\s+streak\b/i,
  /\btry\s+it\s+free\b/i,
  /\bthe\s+ai\s+code\s+reviewer\b/i,
  /\bagents?\s+that\s+(?:review|test)\b/i,
  /^\s*ad\s*$/i,
  /your\s+first\s+message\s+starts/i,
  /enter\s+a\s+coding\s+task\s+or\s+\//i,
  /\bfor\s+history\b.*\bfor\s+help\b/i,
  /^\s*←?\s*for\s+history/i,
  /\bmodel\s+to\s+change\b/i,
  /\bChat:\s*New\s+chat\b/i,
]

export function isNoise(line: string): boolean {
  return NOISE_PATTERNS.some((re) => re.test(line))
}

// Ligne de prompt utilisateur : « ❯ … », « > … » ou « tu/vous/moi : … ».
export function isUserLine(line: string): boolean {
  if (/^\s*[❯>»]\s*\S/.test(line)) return true
  return /^\s*(?:vous|tu|moi)\s*[:>]/i.test(line)
}

export type TranscriptLine = { text: string; user: boolean }

// Transforme les lignes brutes du TUI en conversation : bordures rognées, session
// extraite, bruit filtré, utilisateur marqué. Renvoie transcript + barre de session.
export function buildTranscript(rawLines: string[]): { lines: TranscriptLine[]; sessionBar: string } {
  const lines: TranscriptLine[] = []
  let sessionBar = ""
  let sessionScore = -1
  for (const raw of rawLines) {
    const trimmed = trimBorders(raw)
    if (!trimmed || isDecorationOnly(trimmed)) continue
    if (isSessionBar(trimmed)) {
      const score = sessionBarScore(trimmed)
      if (score > sessionScore) { sessionBar = trimmed.trim(); sessionScore = score }
      continue
    }
    if (isNoise(trimmed)) continue
    lines.push({ text: trimmed.replace(/\s+$/, ""), user: isUserLine(trimmed) })
  }
  return { lines, sessionBar }
}
