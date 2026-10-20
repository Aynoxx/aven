// v10.3.0 : gestionnaire UNIQUE du CLI Freebuff — le CLI est installé au démarrage
// de l'app (et non plus à l'ouverture de la page Projet), jamais deux fois en même
// temps, et l'installation n'est déclarée réussie qu'après une vérification réelle
// (`freebuff --version`). Avant cette version, trois endroits lançaient chacun leur
// installation : App (bouton du bandeau), Réglages et la page Freebuff, avec deux
// boucles de sondage différentes et aucun verrou — d'où des installations npm
// concurrentes quand on ouvrait la page pendant que le bandeau installait.
//
// Pur : aucune I/O ici. `check` et `install` sont injectés (host), `sleep` et `now`
// aussi — le scénario complet est donc testable avec Node seul (AGENTS.md §8).
export type CliState = "unknown" | "checking" | "installing" | "ready" | "failed"

export type CliSnapshot = {
  state: CliState
  installed: boolean
  version?: string
  error?: string
}

export type CliManagerDeps = {
  /** Interroge le CLI réellement (`freebuff --version`). */
  check: () => Promise<{ installed: boolean; version?: string }>
  /** Lance l'installation globale (npm) et ne résout qu'une fois la commande finie. */
  install: () => Promise<void>
  sleep?: (ms: number) => Promise<void>
  now?: () => number
  /** Sondages de vérification après installation (défaut : 6 × 2 s = 12 s). */
  verifyAttempts?: number
  verifyIntervalMs?: number
  /** Après un échec, pas de nouvelle tentative automatique avant ce délai. */
  retryCooldownMs?: number
  /** Notifié à chaque changement d'état (le host en fait un événement renderer). */
  onChange?: (snapshot: CliSnapshot) => void
}

export type CliManager = {
  /** Idempotent : une seule installation en vol, quel que soit le nombre d'appelants. */
  ensure: (force?: boolean) => Promise<CliSnapshot>
  status: () => CliSnapshot
}

export function createCliManager(deps: CliManagerDeps): CliManager {
  const sleep = deps.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)))
  const now = deps.now ?? (() => Date.now())
  const verifyAttempts = Math.max(1, deps.verifyAttempts ?? 6)
  const verifyIntervalMs = Math.max(0, deps.verifyIntervalMs ?? 2_000)
  const cooldown = Math.max(0, deps.retryCooldownMs ?? 60_000)

  let snapshot: CliSnapshot = { state: "unknown", installed: false }
  let inflight: Promise<CliSnapshot> | null = null
  let failedAt = 0

  const publish = (next: Partial<CliSnapshot>) => {
    snapshot = { ...snapshot, ...next }
    try {
      deps.onChange?.({ ...snapshot })
    } catch {
      // Un abonné qui lève ne doit jamais casser l'installation.
    }
    return { ...snapshot }
  }

  const verify = async (): Promise<{ installed: boolean; version?: string }> => {
    for (let attempt = 0; attempt < verifyAttempts; attempt++) {
      if (attempt > 0) await sleep(verifyIntervalMs)
      try {
        const status = await deps.check()
        if (status.installed) return status
      } catch {
        // Une vérification qui échoue n'est pas une preuve d'absence : on ressaie.
      }
    }
    return { installed: false }
  }

  const run = async (): Promise<CliSnapshot> => {
    publish({ state: "checking", installed: false, error: undefined, version: undefined })

    const current = await verify()
    if (current.installed) {
      return publish({ state: "ready", installed: true, version: current.version, error: undefined })
    }

    publish({ state: "installing", installed: false })
    try {
      await deps.install()
    } catch (error) {
      failedAt = now()
      const message = error instanceof Error ? error.message : String(error)
      return publish({
        state: "failed",
        installed: false,
        error: `Installation du CLI Freebuff impossible : ${message}`,
      })
    }

    // Le code de sortie de npm ne suffit pas : le binaire doit répondre.
    const after = await verify()
    if (after.installed) {
      return publish({ state: "ready", installed: true, version: after.version, error: undefined })
    }
    failedAt = now()
    return publish({
      state: "failed",
      installed: false,
      error:
        "L'installation s'est terminée mais « freebuff --version » ne répond pas. Vérifie ta connexion, puis réessaie.",
    })
  }

  return {
    status: () => ({ ...snapshot }),
    ensure(force = false) {
      if (inflight) return inflight
      if (!force && snapshot.state === "ready" && snapshot.installed) {
        return Promise.resolve({ ...snapshot })
      }
      if (!force && snapshot.state === "failed" && now() - failedAt < cooldown) {
        return Promise.resolve({ ...snapshot })
      }
      inflight = run().finally(() => {
        inflight = null
      })
      return inflight
    },
  }
}
