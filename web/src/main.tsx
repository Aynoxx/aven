import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
// v9.2.0 : styles de l'émulateur de terminal (pont Freebuff) — chargés au boot de
// l'app, la lib ne s'active qu'à l'ouverture du dialogue.
import "@xterm/xterm/css/xterm.css"
import App from "./App.tsx"
import ErrorBoundary from "./ErrorBoundary.tsx"

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
)
