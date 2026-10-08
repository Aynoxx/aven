// Résolveur pour les tests : les sources s'importent avec l'extension ".js"
// (convention NodeNext/TypeScript), mais en mode --experimental-strip-types Node ne
// réécrit pas ces spécificateurs vers les fichiers ".ts" réels. Ce hook fait la
// correspondance ".js introuvable → .ts voisin", sans dépendance externe.
// v10.0.0 (100 % Tauri) : le redirecteur « electron » a disparu avec le shell —
// plus aucun module du projet n'importe "electron".

export async function resolve(specifier, context, nextResolve) {
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
