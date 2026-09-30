// Installe le SDK .NET 8 en local, dans tools/ (gitignoré, sans droits admin).
// Idempotent : ne fait rien si le SDK est déjà présent.
import { existsSync } from "node:fs"
import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sdkDir = path.join(root, "tools", "dotnet-sdk")
const dotnet = path.join(sdkDir, process.platform === "win32" ? "dotnet.exe" : "dotnet")

if (existsSync(dotnet)) {
  console.log(`SDK déjà présent : ${dotnet}`)
  process.exit(0)
}

if (!existsSync(path.join(root, "tools", "dotnet-install.ps1"))) {
  console.error("tools/dotnet-install.ps1 absent — relance : curl -sL https://dot.net/v1/dotnet-install.ps1 -o tools/dotnet-install.ps1")
  process.exit(1)
}

console.log("Installation du SDK .NET 8 dans tools/dotnet-sdk (une fois, ~200 Mo)…")
execFileSync(
  "powershell",
  ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", path.join(root, "tools", "dotnet-install.ps1"), "-Channel", "8.0", "-InstallDir", sdkDir, "-NoPath"],
  { stdio: "inherit" },
)
console.log(`✓ SDK .NET 8 installé : ${dotnet}`)
