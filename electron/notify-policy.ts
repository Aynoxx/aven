// Politique de notification Windows (v9.1.0) : Aven avertit quand un agent a besoin de
// toi, mais JAMAIS quand la fenêtre est au premier plan (tu vois déjà l'écran).
// Pur : testable avec Node seul, sans Electron.
export type NotifyKind = "turn-done" | "turn-error" | "permission" | "form"

export function shouldNotify(input: {
  windowFocused: boolean
  kind: NotifyKind
  turnDurationMs?: number
  enabled: boolean
}): boolean {
  if (!input.enabled || input.windowFocused) return false
  // Permission, formulaire et ÉCHEC : l'utilisateur doit agir ou savoir, quelle que soit la durée.
  if (input.kind === "permission" || input.kind === "form" || input.kind === "turn-error") return true
  // Un tour terminé ne mérite une notification que s'il a été long : pour un aller-retour
  // de quelques secondes l'utilisateur est encore devant l'écran.
  return (input.turnDurationMs ?? 0) > 8000
}

/** Libellé du toast (pur, testé avec la politique). */
export function notifyContent(kind: NotifyKind, durationMs?: number): { title: string; body: string } {
  switch (kind) {
    case "turn-done":
      return { title: "Aven", body: `Tour terminé${durationMs ? ` en ${Math.max(1, Math.round(durationMs / 1000))} s` : ""}.` }
    case "turn-error":
      return { title: "Aven", body: "Le tour de l'agent a échoué." }
    case "permission":
      return { title: "Aven", body: "L'agent attend ta permission." }
    case "form":
      return { title: "Aven", body: "Un formulaire attend tes réponses." }
  }
}
