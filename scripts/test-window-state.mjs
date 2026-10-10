// v10.0.x : test de bout en bout de la persistance de la fenêtre
// (tauri-plugin-window-state) sur le binaire réel :
//   1) état vierge  → lancement → fenêtre maximisée (défaut tauri.conf.json)
//   2) redimensionnement réel (ShowWindow/MoveWindow) → état fenêtré
//   3) sortie gracieuse (WM_QUIT sur les threads) → .window-state.json écrit
//   4) relance      → taille/position RESTAURÉES (et pas maximisé)
//   5) maximiser    → sortie → relance → maximisé restauré
//   6) nettoyage    → état supprimé → comportement par défaut rétabli
// Sortie 0 = toutes les étapes passées ; l'état de test est toujours supprimé.
import { spawn, spawnSync } from "node:child_process"
import { existsSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { setTimeout as sleep } from "node:timers/promises"

const EXE = "src-tauri/target/debug/aven.exe"
const STATE = `${process.env.APPDATA}\\com.local.aven\\.window-state.json`
const LOG = "test-window-state.log"

const lines = []
let exeProc = null
const say = (m) => { console.log(m); lines.push(m) }
const fail = (m) => { say("FAIL · " + m); finish(1) }
function finish(code) {
  // Nettoyage systématique : l'état de test ne doit pas dégrader le
  // démarrage suivant (défaut = maximisé, sans fichier).
  try { rmSync(STATE, { force: true }) } catch {}
  if (exeProc?.pid && alive(exeProc.pid)) {
    try { spawnSync(`taskkill /PID ${exeProc.pid} /T /F`, { shell: true, windowsHide: true }) } catch {}
  }
  writeFileSync(LOG, lines.join("\n") + "\n")
  process.exit(code)
}

function alive(pid) {
  try { process.kill(pid, 0); return true } catch { return false }
}

// ── Win32 : géométrie réelle de la fenêtre, sans dépendre d'aucun DPI virtuel ─
const PS = `
Add-Type @"
using System;
using System.Runtime.InteropServices;
public class AvenWin {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
  [DllImport("user32.dll")] public static extern bool MoveWindow(IntPtr h, int x, int y, int w, int hh, bool r);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern int IsZoomed(IntPtr h);
  [DllImport("user32.dll")] public static extern bool PostThreadMessage(uint t, uint m, IntPtr w, IntPtr l);
  public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }
}
"@
function Aven-Hwnd {
  $p = Get-Process aven -ErrorAction SilentlyContinue | Where-Object { $_.MainWindowHandle -ne 0 } | Select-Object -First 1
  if ($null -eq $p) { return [IntPtr]::Zero }
  return $p.MainWindowHandle
}
`

function ps(body) {
  const r = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", PS + body], {
    encoding: "utf8",
    windowsHide: true,
  })
  return { code: r.status, out: (r.stdout ?? "").trim(), err: (r.stderr ?? "").trim() }
}

const psRect = (h) => ps(`
$h = [IntPtr]${h}
$r = New-Object AvenWin+RECT
[void][AvenWin]::GetWindowRect($h, [ref]$r)
Write-Output ($r.Left.ToString() + ',' + $r.Top.ToString() + ',' + ($r.Right - $r.Left).ToString() + ',' + ($r.Bottom - $r.Top).ToString() + ',' + [AvenWin]::IsZoomed($h))
`)

const PS_WAIT = (timeoutS) => ps(`
$deadline = (Get-Date).AddSeconds(${timeoutS})
do {
  $h = Aven-Hwnd
  if ($h -ne [IntPtr]::Zero) { Write-Output $h; exit 0 }
  Start-Sleep -Milliseconds 500
} while ((Get-Date) -lt $deadline)
exit 1
`)

const launch = () => {
  exeProc = spawn(EXE, [], { detached: true, stdio: "ignore", windowsHide: true })
  say(`lancement pid ${exeProc.pid}`)
}

async function waitExit(ms) {
  const deadline = Date.now() + ms
  while (Date.now() < deadline) {
    if (!alive(exeProc.pid)) return true
    await sleep(500)
  }
  return false
}

function quitGracefully() {
  const r = ps(`
$p = Get-Process aven -ErrorAction SilentlyContinue
if ($null -eq $p) { exit 1 }
foreach ($t in $p.Threads) {
  try { [void][AvenWin]::PostThreadMessage($t.Id, 0x12, [IntPtr]::Zero, [IntPtr]::Zero) } catch {}
}
Write-Output 'wm-quit envoye'
`)
  return r.code === 0
}

function parseRect(line) {
  const parts = String(line ?? "").split(",")
  if (parts.length !== 5 || parts.some((p) => p.trim() === "" || Number.isNaN(Number(p)))) return null
  const [l, t, w, h, z] = parts.map(Number)
  return { l, t, w, h, z }
}

function etat() {
  try { return JSON.parse(readFileSync(STATE, "utf8")) } catch { return null }
}

function approx(a, b, tol) { return Math.abs(a - b) <= tol }

if (!existsSync(EXE)) fail(`${EXE} absent — lancer npm run tauri:check`)
try { rmSync(STATE, { force: true }) } catch {}

try {
  // ── 1) Premier lancement : maximisé par défaut (tauri.conf.json) ───────────
  launch()
  const h1 = PS_WAIT(30)
  if (h1.code !== 0) fail("fenêtre introuvable au premier lancement")
  const g1 = psRect(h1.out.trim())
  const r1 = parseRect(g1.out)
  if (!r1) fail(`géométrie illisible au premier lancement (code=${g1.code}, out=${g1.out}, err=${g1.err.slice(0, 200)})`)
  if (r1.z !== 1) fail(`premier lancement non maximisé (rect=${r1.l},${r1.t},${r1.w},${r1.h}, zoomed=${r1.z})`)
  say(`PASS · premier lancement maximisé (rect=${r1.l},${r1.t},${r1.w},${r1.h})`)

  // ── 2) Redimensionnement réel : fenêtré à une position connue ─────────────
  const h1t = h1.out.trim()
  const moved = ps(`
$h = [IntPtr]${h1t}
[void][AvenWin]::ShowWindow($h, 9)
Start-Sleep -Milliseconds 400
[void][AvenWin]::MoveWindow($h, 150, 100, 900, 600, $true)
Start-Sleep -Milliseconds 800
Write-Output 'deplace'
`)
  if (moved.code !== 0) fail(`échec du redimensionnement : ${moved.err || moved.out}`)
  const g2 = psRect(h1t)
  const r2 = parseRect(g2.out)
  if (!r2) fail(`géométrie illisible après MoveWindow (code=${g2.code}, out=${g2.out}, err=${g2.err.slice(0, 200)})`)
  if (r2.z !== 0) fail(`fenêtre toujours maximisée après MoveWindow (rect=${JSON.stringify(r2)})`)
  if (r2.w < 700 || r2.w > 1100) fail(`largeur fenêtrée incohérente : ${r2.w}`)
  say(`PASS · fenêtre fenêtrée à ${r2.l},${r2.t} ${r2.w}×${r2.h}`)

  // ── 3) Sortie gracieuse → écriture de .window-state.json ──────────────────
  if (!quitGracefully()) fail("impossible d'envoyer WM_QUIT")
  if (!(await waitExit(20_000))) fail("le processus ne sort pas après WM_QUIT")
  exeProc = null
  if (!existsSync(STATE)) fail(".window-state.json non écrit à la sortie")
  const e3 = etat()
  if (!e3?.main) fail(`état illisible : ${JSON.stringify(e3)}`)
  if (e3.main.maximized !== false) fail(`état maximisé=false attendu : ${JSON.stringify(e3.main)}`)
  if (e3.main.width < 700 || e3.main.width > 1100) fail(`largeur sauvée incohérente : ${e3.main.width}`)
  say(`PASS · état sauvé à la sortie (fenêtré ${e3.main.width}×${e3.main.height} @${e3.main.x},${e3.main.y})`)

  // ── 4) Relance : taille/position restaurées, pas maximisé ─────────────────
  launch()
  const h2 = PS_WAIT(30)
  if (h2.code !== 0) fail("fenêtre introuvable à la relance")
  const g4 = psRect(h2.out.trim())
  const r4 = parseRect(g4.out)
  if (!r4) fail(`géométrie illisible à la relance (code=${g4.code}, out=${g4.out}, err=${g4.err.slice(0, 200)})`)
  if (r4.z !== 0) fail("relance maximisée alors que l'état sauvé est fenêtré")
  if (!approx(r4.l, r2.l, 8) || !approx(r4.t, r2.t, 8) || !approx(r4.w, r2.w, 8) || !approx(r4.h, r2.h, 8))
    fail(`taille/position non restaurées : voulu ${r2.l},${r2.t} ${r2.w}×${r2.h} — obtenu ${r4.l},${r4.t} ${r4.w}×${r4.h}`)
  say(`PASS · taille/position restaurées à la relance (${r4.l},${r4.t} ${r4.w}×${r4.h})`)

  // ── 5) État maximisé persistant lui aussi ─────────────────────────────────
  const h2t = h2.out.trim()
  const maxi = ps(`
[void][AvenWin]::ShowWindow([IntPtr]${h2t}, 3)
Start-Sleep -Milliseconds 800
Write-Output 'maximise'
`)
  if (maxi.code !== 0) fail("échec de la maximisation")
  if (!quitGracefully()) fail("échec WM_QUIT (cycle maximisé)")
  if (!(await waitExit(20_000))) fail("le processus ne sort pas après WM_QUIT (cycle maximisé)")
  exeProc = null
  const e5 = etat()
  if (e5?.main?.maximized !== true) fail(`état maximisé=true attendu : ${JSON.stringify(e5?.main)}`)
  launch()
  const h3 = PS_WAIT(30)
  if (h3.code !== 0) fail("fenêtre introuvable à la relance maximisée")
  const g5 = psRect(h3.out.trim())
  const r5 = parseRect(g5.out)
  if (!r5) fail(`géométrie illisible à la relance maximisée (code=${g5.code}, out=${g5.out}, err=${g5.err.slice(0, 200)})`)
  if (r5.z !== 1) fail(`relance non maximisée (rect=${JSON.stringify(r5)})`)
  say("PASS · état maximisé restauré à la relance")

  // ── 6) Sortie finale + nettoyage (défaut maximisé rétabli) ────────────────
  if (!quitGracefully()) fail("échec WM_QUIT (sortie finale)")
  if (!(await waitExit(20_000))) fail("sortie finale bloquée")
  exeProc = null
  say("PASS · état de test supprimé, comportement par défaut rétabli")
  say("WINDOW STATE : OK")
  finish(0)
} catch (error) {
  fail(String(error?.message ?? error))
}
