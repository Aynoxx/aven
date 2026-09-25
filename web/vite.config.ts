import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"

// base "./" : indispensable, sinon l'app packagée (file://) ne trouve pas ses fichiers JS/CSS.
// host 127.0.0.1 : sous Windows, "localhost" peut se résoudre en IPv6 (::1) et Electron, qui vise 127.0.0.1, serait refusé.
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { host: "127.0.0.1", port: 5173, strictPort: true },
})
