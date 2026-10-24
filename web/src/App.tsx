import { useAvenApp } from "./app/use-aven-app"
import WorkbenchShell from "./workbench/WorkbenchShell"
import "./App.css"

// v11.0.0 : le contrôleur porte l'état, le Poste le rend. AppShell et les « pages »
// ont disparu : un rail, des onglets, une scène, un inspecteur, une barre.
export default function App() {
  const app = useAvenApp()
  return <WorkbenchShell app={app} />
}
