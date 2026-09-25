import fs from 'node:fs'
import path from 'node:path'
import { spawnSync } from 'node:child_process'

const root = process.cwd()
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8')
const checks = []
function check(name, ok, detail = '') {
  checks.push({ name, ok, detail })
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) process.exitCode = 1
}

const app = read('web/src/App.tsx')
const css = read('web/src/App.css')
const router = read('electron/router.ts')
const main = read('electron/main.ts')
const voice = read('web/src/live-voice.ts')
const atomic = read('electron/atomic-file.ts')

check('Version 8.7.x', /^8\.7\.\d+$/.test(JSON.parse(read('package.json')).version))
check('Hub sans coordonnées héritées', !/--hub-[xy]\b/.test(css))
const angles = ['90deg', '18deg', '-54deg', '-126deg', '162deg']
const foundAngles = angles.filter((angle) => css.includes(angle)).length
check('5 positions angulaires présentes', foundAngles === 5, `${foundAngles}/5`)
check('Centre des cartes sur un rayon commun', /translateY\(calc\(-1 \* var\(--hub-r\)\)\)/.test(css))
check('Fermeture Notes → Accueil', /const closeNotesToHome = useCallback/.test(app) && /setShowHome\(true\)/.test(app) && /NotesDialog initialId=\{notesInitialId\} onClose=\{closeNotesToHome\}/.test(app))
check('Escape Notes → Accueil', /else if \(showNotes\) closeNotesToHome\(\)/.test(app))
check('Protection contre les courses de chargement de messages', /messageLoadSeq/.test(app) && /chatIdRef\.current !== id/.test(app))
check('Boot Electron sérialisé', /bootQueue/.test(main) && /bootGeneration/.test(main) && /async function shutdown/.test(main))
check('Persistance atomique', /function writeTextAtomic/.test(atomic) && /renameSync\(temp, file\)/.test(atomic))
check('Router ne choisit pas un modèle en cooldown', /chain\.find\(\(m\) => !this\.cooling\(m\.ref\)\)\?\.ref/.test(router) && !/\?\? chain\[0\]/.test(router))
check('Détection des modèles compatible OpenCode v2', /model\.enabled !== false && model\.disabled !== true/.test(main) && /model\.status !== \"deprecated\"/.test(main))
const operations = read('electron/operations.ts')
check('Création de session avec modèle explicite', /model: parseRef\(model\)/.test(operations) && /Aucun modèle disponible pour l’agent/.test(operations))
check('Modèle relu après création de session', /const fresh = await b\.client\.session\.get/.test(operations) && /const resolved = refOf\(fresh\.model \?\? s\.model\)/.test(operations))
check('Pas de statut UI « attribution automatique » infini', !/Attribué automatiquement/.test(app) && /Aucun modèle assigné/.test(app))
check('Nettoyage des sessions du router', /this\.known\.delete\(d\.sessionID\)/.test(router) && /forget\(sessionID: string\)/.test(router))
check('Chargement parallèle des sous-sessions', /Promise\.all/.test(read('electron/operations.ts')) && /mapConcurrent/.test(read('electron/operations.ts')))
check('AudioWorklet avec fallback', /AudioWorkletNode/.test(voice) && /fallback ScriptProcessor/.test(voice))
check('Handshake vocal après ouverture WebSocket', /await socketOpen[\s\S]*this\.send\(\{\s*setup:/.test(voice))
check('Attente de setupComplete', /await setupDone/.test(voice) && /parsed\?\.setupComplete/.test(voice))
check('Nettoyage AudioContext', /inputContext\.close\(\)/.test(voice) && /outputContext\.close\(\)/.test(voice))
check('Aucun closeNotesToHome utilisé avant sa déclaration', !/useEffect\([\s\S]{0,1600}closeNotesToHome[\s\S]{0,300}\}, \[[^\]]*closeNotesToHome/.test(app))

const braceCount = (css.match(/\{/g) ?? []).length
const closeCount = (css.match(/\}/g) ?? []).length
check('Accolades CSS équilibrées', braceCount === closeCount, `${braceCount}/${closeCount}`)

const git = spawnSync('git', ['status', '--short'], { cwd: root, encoding: 'utf8' })
if (git.status === 0) console.log(`ℹ Git status:\n${git.stdout.trim() || '(propre)'}`)

const failed = checks.filter((c) => !c.ok).length
console.log(`\n${checks.length - failed}/${checks.length} contrôles OK`)
if (failed) process.exit(1)
