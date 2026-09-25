// Résolveur pour les tests : les sources Electron s'importent avec l'extension ".js"
// (convention NodeNext/TypeScript), mais en mode --experimental-strip-types Node ne
// réécrit pas ces spécificateurs vers les fichiers ".ts" réels. Ce hook fait la
// correspondance ".js introuvable → .ts voisin", sans dépendance externe.
// Le paquet npm "electron" (le binaire desktop, sans exports ESM utilisables sous Node)
// est redirigé vers un stub local : certains modules testés (settings.ts, workspaces.ts…)
// importent app/safeStorage ; seuls des appels réels en auraient besoin, jamais les
// fonctions testées ici.
import { fileURLToPath, pathToFileURL } from "node:url"

// fileURLToPath (et non .pathname) : sous Windows, "/C:/…" n'est pas un chemin valide.
const STUB_URL = pathToFileURL(fileURLToPath(new URL("./electron-stub.mjs", import.meta.url))).href

export async function resolve(specifier, context, nextResolve) {
  if (specifier === "electron") {
    return { url: STUB_URL, shortCircuit: true }
  }
  try {
    return await nextResolve(specifier, context)
  } catch (err) {
    if (err?.code === "ERR_MODULE_NOT_FOUND" && specifier.endsWith(".js")) {
      try {
        return await nextResolve(specifier.slice(0, -3) + ".ts", context)
      } catch {
        /* le .ts n'existe pas non plus : erreur d'origine */
      }
    }
    throw err
  }
}

// node:test charge les fichiers de test avec son propre loader : on lui fournit aussi
// le resolve hook via export nommé standard (module.register appelé par register.mjs).
