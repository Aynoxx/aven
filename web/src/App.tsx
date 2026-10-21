import { useAvenApp } from "./app/use-aven-app"
import AppShell from "./app/AppShell"
import "./App.css"

// v10.4.0 : shell minimal — le contrôleur porte l'état, AppShell et les pages le rendu.
export default function App() {
  const app = useAvenApp()
  return <AppShell app={app} />
}
