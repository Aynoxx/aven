// Lancement du CLI Freebuff gratuit (v9.1.2) : le free tier ad-financé de Freebuff vit
// dans son CLI INTERACTIF (aucun mode headless — vérifié dans les sources officielles ;
// le SDK, lui, exige une clé Codebuff payante). L'intégration cohérente pour Aven :
// ouvrir une vraie fenêtre de terminal sur l'espace de travail, où l'utilisateur parle
// à Freebuff avec ses sessions gratuites. Même principe que « Ouvrir le dossier ».
// Pur : testable avec Node seul, sans Electron.

export type FreebuffCliCommand = { command: string; args: string[] }

/**
 * Commande qui ouvre une console Windows sur le dossier donné, prête à lancer Freebuff.
 * Chaque argument est spawné SÉPARÉMENT (pas de chaîne concaténée) : `start` reçoit le
 * titre puis `/D <dossier>` (dossier de départ), et le `cmd /k` enfant n'a AUCUN
 * guillemet imbriqué à analyser — le spawn Node cite chaque argument lui-même.
 */
export function buildLaunchCommand(workspace: string, action: "launch" | "login" | "install" = "launch"): FreebuffCliCommand {
  const ws = String(workspace || "").trim()
  if (!ws) throw new Error("Aucun espace de travail actif.")

  if (action === "install") {
    // Pas besoin de dossier : installation globale npm, visible dans la fenêtre.
    return { command: "cmd", args: ["/c", "start", "Freebuff", "cmd", "/k", "npm", "install", "-g", "freebuff"] }
  }
  if (action === "login") {
    return { command: "cmd", args: ["/c", "start", "Freebuff", "/D", ws, "cmd", "/k", "freebuff", "login"] }
  }
  return { command: "cmd", args: ["/c", "start", "Freebuff", "/D", ws, "cmd", "/k", "freebuff", "--cwd", ws] }
}

/**
 * Parse la sortie de `freebuff --version` : installé ? quelle version ?
 * Accepte « 0.0.203 », « freebuff/0.0.203 » ou toute ligne contenant un semver.
 */
export function parseVersionOutput(stdout: string, stderr: string = ""): { installed: boolean; version?: string } {
  const match = `${stdout}\n${stderr}`.match(/(\d+\.\d+\.\d+(?:[-+][\w.-]+)?)/)
  if (!match) return { installed: false }
  return { installed: true, version: match[1] }
}

/** Message utilisateur pour une plateforme non supportée (Aven cible Windows). */
export function unsupportedPlatform(platform: string): string {
  return `Le lancement du terminal n'est pris en charge que sous Windows (${platform} détecté). Installe le CLI manuellement : npm install -g freebuff, puis lance « freebuff » dans ton espace de travail.`
}
