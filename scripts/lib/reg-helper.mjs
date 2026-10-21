import { execSync } from "node:child_process"
import { writeFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"

// v10.3.2 : accès au registre Windows via scripts PowerShell temporaires.
// Deux pièges mesurés sur cette machine, conquis ici :
//   1. `reg query` échoue sur toute clé dont le chemin contient des espaces
//      (« nom de clé non valide ») — on ne passe donc plus par reg.exe.
//   2. Les chemins sont écrits en barres obliques (HKCU:/Control Panel/Desktop),
//      que le provider Registre de PowerShell accepte : aucune contre-barre à
//      échapper entre le fichier source et l'interpréteur.
// Chaque appel écrit un .ps1 temporaire, l'exécute, puis le supprime.

const REG_PATH = "HKCU:/Control Panel/Desktop"
const VALUE_NAME = "ClientAreaAnimation"

const PS_READ = `$path = '${REG_PATH}'
$name = '${VALUE_NAME}'
try {
    $item = Get-ItemProperty -Path $path -Name $name -ErrorAction Stop
    Write-Output $item.$name
} catch {
    Write-Output 'NOT_FOUND'
}`

const PS_WRITE = (value) => `$path = '${REG_PATH}'
$name = '${VALUE_NAME}'
try {
    $current = Get-ItemProperty -Path $path -Name $name -ErrorAction Stop
    if ($current.$name -ne '${value}') {
        Set-ItemProperty -Path $path -Name $name -Value '${value}' -Type String -Force
        Write-Output 'SET'
    } else {
        Write-Output 'ALREADY'
    }
} catch {
    New-ItemProperty -Path $path -Name $name -Value '${value}' -PropertyType String -Force | Out-Null
    if ($?) { Write-Output 'CREATED' } else { Write-Output 'WRITE_FAILED' }
}`

const PS_DELETE = `$path = '${REG_PATH}'
$name = '${VALUE_NAME}'
try {
    Remove-ItemProperty -Path $path -Name $name -Force -ErrorAction Stop
    Write-Output 'REMOVED'
} catch {
    Write-Output 'DELETE_FAILED'
}`

function runPS(script) {
  const tmpFile = join(tmpdir(), `reg-helper-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.ps1`)
  try {
    writeFileSync(tmpFile, script, "utf8")
    return execSync(`powershell -ExecutionPolicy Bypass -File "${tmpFile}"`, {
      encoding: "utf8",
      maxBuffer: 10240,
      stdio: ["pipe", "pipe", "pipe"],
    }).trim()
  } finally {
    try { unlinkSync(tmpFile) } catch {}
  }
}

// Retourne la valeur ('0' | '1') ou null si la valeur est absente du registre.
export function readClientAreaAnimation() {
  const out = runPS(PS_READ)
  return out === "NOT_FOUND" ? null : out
}

// Retourne true si la valeur est garantie égale à `value` après l'appel.
export function setClientAreaAnimation(value) {
  const out = runPS(PS_WRITE(value))
  if (out === "SET" || out === "ALREADY" || out === "CREATED") return true
  throw new Error(`écriture registre refusée : ${out || "sortie vide"}`)
}

// Retourne true si la valeur a été supprimée (ou déjà absente : idempotent).
export function deleteClientAreaAnimation() {
  const out = runPS(PS_DELETE)
  if (out === "REMOVED") return true
  if (out === "DELETE_FAILED") return readClientAreaAnimation() === null
  throw new Error(`suppression registre refusée : ${out || "sortie vide"}`)
}

if (process.argv[1] && process.argv[1].endsWith("reg-helper.mjs")) {
  const op = process.argv[2]
  if (op === "read") console.log("valeur:", readClientAreaAnimation())
  else if (op === "set") console.log("set:", setClientAreaAnimation("1"))
  else if (op === "delete") console.log("delete:", deleteClientAreaAnimation())
  else console.log("usage: node scripts/lib/reg-helper.mjs [read|set|delete]")
}
