// Génère dist-host/aven-engine-host.mjs : le host du moteur bundlé en UN
// fichier autonome (SDK @opencode/client embarqué) — consommé tel quel par
// l'Electron actuel (engine-client.ts) et, en phase 5+, par le natif WinUI.
import { build } from "esbuild"

await build({
  entryPoints: [
    { in: "host/engine-host.ts", out: "aven-engine-host" },
    { in: "host/pty-host.ts", out: "aven-pty-host" },
    { in: "host/aven-app-host.ts", out: "aven-app-host" },
  ],
  outdir: "dist-host",
  // Extension .mjs obligatoire : Node exécute un .js comme CommonJS et l'ESM
  // (import/export) du bundle serait rejeté (piège phase 1).
  outExtension: { ".js": ".mjs" },
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  sourcemap: false,
  minify: false,
  legalComments: "none",
  // Impose le tsconfig du projet : sinon esbuild remonte AU-DELÀ du dépôt et
  // lit un tsconfig.json étranger (ex. un fichier vide au-dessus de l'espace).
  tsconfig: "host/tsconfig.json",
  // v11.3.0 : `ws` est du CommonJS et appelle `require()` pour les modules Node
  // (« events »…). En ESM, esbuild remplace ces appels par un `__require` qui lève
  // « Dynamic require of \"events\" is not supported » — le host ne démarrait plus.
  // Le banner fournit un vrai `require` de module à ce shim.
  banner: {
    js:
      "// Aven engine host — généré par scripts/build-engine-host.mjs, ne pas éditer.\n" +
      'import { createRequire as __avenCreateRequire } from "node:module";\n' +
      "const require = __avenCreateRequire(import.meta.url);",
  },
})
console.log("✓ dist-host/aven-engine-host.mjs")
console.log("✓ dist-host/aven-pty-host.mjs")
console.log("✓ dist-host/aven-app-host.mjs")
