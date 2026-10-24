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
    // v11.3.0 : les modules du renderer s'importent SANS extension (Vite les
    // résout à la compilation), ce que Node ne fait pas. Sans ce repli, tester
    // `playback.ts` échouait sur son `./trim` — jamais sur son comportement.
    if (err?.code === "ERR_MODULE_NOT_FOUND" && specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
      try {
        return await nextResolve(specifier + ".ts", context)
      } catch {
        /* pas de .ts voisin : erreur d'origine */
      }
    }
    throw err
  }
}

// node:test charge les fichiers de test avec son propre loader : on lui fournit aussi
// le resolve hook via export nommé standard (module.register appelé par register.mjs).
