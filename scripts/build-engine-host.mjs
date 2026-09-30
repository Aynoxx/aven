// Génère dist-electron/aven-engine-host.mjs : le host du moteur bundlé en UN
// fichier autonome (SDK @opencode/client embarqué) — consommé tel quel par
// l'Electron actuel (engine-client.ts) et, en phase 5+, par le natif WinUI.
import { build } from "esbuild"

await build({
  entryPoints: [
    { in: "electron/engine-host.ts", out: "aven-engine-host" },
    { in: "electron/pty-host.ts", out: "aven-pty-host" },
  ],
  outdir: "dist-electron",
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
  tsconfig: "electron/tsconfig.json",
  banner: { js: "// Aven engine host — généré par scripts/build-engine-host.mjs, ne pas éditer." },
})
console.log("✓ dist-electron/aven-engine-host.mjs")
