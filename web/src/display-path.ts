// v11.0.1 : chemins Windows affichés dans l'interface. Le host renvoie la forme
// canonique `\\?\C:\…` (préfixe de chemin étendu, imposé par l'API Windows) et le
// rendu l'affichait telle quelle, préfixe compris. Pur : testable avec Node seul,
// sans dépendance desktop (tests/display-path.test.mjs).
export function displayPath(input: string | null | undefined): string {
  const value = String(input ?? "")
  if (!value) return ""
  // `\\?\UNC\serveur\partage` → `\\serveur\partage`
  if (value.startsWith("\\\\?\\UNC\\")) return "\\\\" + value.slice(8)
  // `\\?\C:\dossier` → `C:\dossier`
  if (value.startsWith("\\\\?\\")) return value.slice(4)
  return value
}
