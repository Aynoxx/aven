#!/usr/bin/env node
// Tests du socle natif EN LOCAL (aucun GitHub requis) : xUnit du pont + build MSIX
// de la coquille. Utilise le SDK .NET installé dans tools/dotnet-sdk — l'installe
// au besoin (scripts/install-dotnet-sdk.mjs). Options : --no-msix pour sauter le build.
import { existsSync } from "node:fs"
import { spawnSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const sdkDir = path.join(root, "tools", "dotnet-sdk")
const dotnet = path.join(sdkDir, process.platform === "win32" ? "dotnet.exe" : "dotnet")

if (!existsSync(dotnet)) {
  console.log("SDK .NET absent — installation locale (tools/dotnet-sdk)…")
  const r = spawnSync(process.execPath, [path.join(root, "scripts", "install-dotnet-sdk.mjs")], { stdio: "inherit" })
  if (r.status !== 0) process.exit(r.status ?? 1)
}

const env = { ...process.env, DOTNET_ROOT: sdkDir }
env.PATH = `${sdkDir}${path.delimiter}${env.PATH ?? ""}`

// 1. Tests xUnit du pont (contrat JSON-RPC + conversation + vrai bundle si dist/ présent).
console.log("── Tests du socle natif (xUnit) ──")
const test = spawnSync(dotnet, ["test", path.join(root, "native", "tests", "Aven.Tests", "Aven.Tests.csproj"), "-c", "Release"], {
  stdio: "inherit", env, cwd: path.join(root, "native"),
})
if (test.status !== 0) process.exit(test.status ?? 1)

// 2. Build MSIX de la coquille (l'acceptation « fenêtre vide buildée + paquet »).
if (!process.argv.includes("--no-msix")) {
  console.log("\n── Build MSIX de la coquille WinUI ──")
  const outDir = path.join(root, "native", ".tmp-msix")
  const build = spawnSync(
    dotnet,
    [
      "build", path.join(root, "native", "src", "Aven.Native", "Aven.Native.csproj"),
      "-c", "Release", "-p:Platform=x64",
      "-p:GenerateAppxPackageOnBuild=true",
      "-p:AppxPackageSigningEnabled=false",
      "-p:UapAppxPackageBuildMode=SideloadOnly",
      "-p:AppxBundle=Never",
      `-p:AppxPackageDir=${outDir}${path.sep}`,
    ],
    { stdio: "inherit", env, cwd: path.join(root, "native") },
  )
  if (build.status !== 0) process.exit(build.status ?? 1)
  console.log(`\nMSIX : ${outDir}`)
}

console.log("\nSocle natif : tout est vert en local ✅")
