import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs"
import path from "node:path"
import { writeTextAtomic, writeJsonAtomicPretty } from "./atomic-file.js"
import { isFreeModelRef } from "./priorities.js"

// Sans dépendance à Electron : testable avec Node seul.

export type FileSyncResult = { file: string; status: "created" | "updated" | "unchanged" | "custom" }

/**
 * Pour chaque fichier suivi (relatif au dossier de travail) :
 *  - absent → copié depuis le modèle, et une copie "baseline" est gardée à part
 *    (pour savoir plus tard si l'utilisateur l'a modifié) ;
 *  - présent et identique à la baseline connue (donc jamais modifié) → si le
 *    modèle a changé depuis, on met à jour le fichier ET la baseline ;
 *  - présent mais différent de la baseline (donc modifié par l'utilisateur) →
 *    on ne touche à rien, on le signale juste comme "custom" (voir Réglages).
 * Dossier de travail hérité (créé avant ce mécanisme, sans baseline connue) :
 *  aucune baseline → traité comme "custom" par prudence, jamais écrasé.
 */
export function syncTrackedFiles(workspace: string, templateDir: string, relFiles: string[]): FileSyncResult[] {
  const baselineDir = path.join(workspace, ".opencode-app", "baseline")
  mkdirSync(baselineDir, { recursive: true })
  const results: FileSyncResult[] = []

  for (const rel of relFiles) {
    const dest = path.join(workspace, rel)
    const template = path.join(templateDir, rel)
    const baseline = path.join(baselineDir, rel.replace(/[\\/]/g, "__"))
    mkdirSync(path.dirname(dest), { recursive: true })

    if (!existsSync(template)) continue // fichier livré absent (ex. build custom) : on ignore
    const templateContent = readFileSync(template, "utf8")

    if (!existsSync(dest)) {
      writeTextAtomic(dest, templateContent)
      writeTextAtomic(baseline, templateContent)
      results.push({ file: rel, status: "created" })
      continue
    }

    const current = readFileSync(dest, "utf8")
    const known = existsSync(baseline) ? readFileSync(baseline, "utf8") : undefined

    if (known !== undefined && current === known) {
      if (current !== templateContent) {
        writeTextAtomic(dest, templateContent)
        writeTextAtomic(baseline, templateContent)
        results.push({ file: rel, status: "updated" })
      } else {
        results.push({ file: rel, status: "unchanged" })
      }
    } else {
      // Modifié par l'utilisateur (ou dossier hérité sans baseline) : on ne touche jamais.
      // On rafraîchit quand même la baseline connue pour ne pas re-signaler le même état indéfiniment,
      // SAUF s'il n'y en avait aucune (dossier hérité) : dans ce cas on en crée une neutre, sans comparer.
      if (known === undefined) writeTextAtomic(baseline, current)
      results.push({ file: rel, status: "custom" })
    }
  }
  return results
}

/**
 * Cas particulier de model-priorities.json : en plus de la logique ci-dessus,
 * on fusionne dans le fichier de l'utilisateur les modèles du gabarit qu'il
 * n'a pas encore (ajout uniquement, on ne modifie ni ne supprime rien
 * d'existant). Utile même quand le fichier est "custom" : un modèle peut être
 * personnalisé (priorités changées) sans que les NOUVEAUX modèles livrés avec
 * l'app apparaissent jamais, puisque le fichier entier n'est plus jamais copié.
 */
export function mergeNewModels(workspace: string, templateDir: string, rel = "model-priorities.json"): string[] {
  const dest = path.join(workspace, rel)
  const template = path.join(templateDir, rel)
  if (!existsSync(dest) || !existsSync(template)) return []
  try {
    const userDoc = JSON.parse(readFileSync(dest, "utf8")) as { models?: Record<string, unknown> }
    const templateDoc = JSON.parse(readFileSync(template, "utf8")) as { models?: Record<string, unknown> }
    if (!userDoc.models || !templateDoc.models) return []
    const added: string[] = []
    for (const [ref, entry] of Object.entries(templateDoc.models)) {
      if (!(ref in userDoc.models)) {
        userDoc.models[ref] = entry
        added.push(ref)
      }
    }
    if (added.length) writeJsonAtomicPretty(dest, userDoc)
    return added
  } catch {
    return [] // fichier utilisateur invalide : on laisse loadTable() le signaler normalement
  }
}

/** Retire physiquement les modèles payants d'une table d'espace de travail. */
export function prunePaidModels(workspace: string, rel = "model-priorities.json"): string[] {
  const dest = path.join(workspace, rel)
  if (!existsSync(dest)) return []
  try {
    const userDoc = JSON.parse(readFileSync(dest, "utf8")) as { models?: Record<string, unknown> }
    if (!userDoc.models || typeof userDoc.models !== "object") return []
    const removed = Object.keys(userDoc.models).filter((ref) => !isFreeModelRef(ref))
    if (!removed.length) return []
    for (const ref of removed) delete userDoc.models[ref]
    writeJsonAtomicPretty(dest, userDoc)
    return removed
  } catch {
    return []
  }
}

/** Liste récursive des chemins relatifs d'un dossier (utilisé pour lister .opencode/agents/*.md). */
export function listRel(dir: string): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir).map((f) => f)
}
