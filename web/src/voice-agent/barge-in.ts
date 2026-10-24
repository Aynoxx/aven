// v11.4.2 : quand le micro détecte une voix pendant la lecture, faut-il couper ?
//
// Deux situations se ressemblent à cet instant : toi qui reprends la parole, et
// Aven qui s'entend dans les haut-parleurs. Aucune transcription n'existe encore
// pour trancher. Les deux choix coûtent cher dans un sens :
//   - couper toujours → la question de confirmation se tronque à sa propre voix,
//     et l'utilisateur n'entend jamais « Je l'enregistre ? » ;
//   - ne jamais couper → une vraie reprise est recouverte par la lecture.
// On tranche donc à l'endroit où l'information existe : pendant une question de
// note, la lecture CONTINUE (la question reste entière) et s'arrête dès que le
// texte prouve que c'est bien toi (echo.ts écarte l'écho). Partout ailleurs, la
// reprise de parole coupe immédiatement, comme avant.
//
// Pur : testable avec Node seul, sans dépendance desktop ni réseau.
import type { VoicePhase } from "./session"

export function shouldInterruptSpeech(input: { phase: VoicePhase; awaitingNote: boolean }): boolean {
  const playing = input.phase === "speaking" || input.phase === "thinking"
  if (!playing) return false
  return !input.awaitingNote
}
