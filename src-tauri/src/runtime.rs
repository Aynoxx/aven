// v10.0.0 : vie du runtime Aven (enfant Node en JSON-RPC ligne par ligne) —
// extraite du monolithe lib.rs. C'est aussi ici que vit la reprise après crash :
// l'enfant peut mourir (OOM, panic native, kill externe), et sans détection le
// frontend recevait « Le runtime Aven s'est arrêté » pour toujours.
use crate::workspaces::{active_workspace, read_workspace_store};
use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    io::{BufRead, BufReader, Write},
    path::PathBuf,
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        mpsc, Arc, Mutex,
    },
    thread,
    time::{Duration, Instant},
};
use tauri::{AppHandle, Emitter};

// v10.0.0 : imports scindés par profil — chaque corps de fonction n'existe que dans
// UN mode (debug : manifeste compilé ; release : ressources bundlées), donc ces
// symboles ne servent que là. Sans ce gate, cargo check signale un import inutilisé.
#[cfg(debug_assertions)]
use std::path::Path;
#[cfg(not(debug_assertions))]
use crate::workspaces::user_data_dir;
#[cfg(not(debug_assertions))]
use tauri::{path::BaseDirectory, Manager};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

// v10.0.0 : budget de reprise — au plus 3 redémarrages automatiques par minute.
// Passé ce seuil, on renvoie une erreur explicite plutôt qu'une boucle de crashes.
const RESTART_BUDGET_MAX: usize = 3;
const RESTART_BUDGET_WINDOW: Duration = Duration::from_secs(60);

// Pur : découpe l'historique des relances à la fenêtre glissante et autorise la
// suivante seulement si le budget n'est pas épuisé. Testé avec Node seul.
pub(crate) fn restart_allowed(history: &mut Vec<Instant>, now: Instant) -> bool {
    history.retain(|at| now.duration_since(*at) < RESTART_BUDGET_WINDOW);
    if history.len() >= RESTART_BUDGET_MAX {
        return false;
    }
    history.push(now);
    true
}

#[derive(Default)]
pub(crate) struct RuntimeState {
    pub(crate) node: Mutex<Option<Arc<NodeRuntime>>>,
    pub(crate) booted_workspace: Mutex<Option<String>>,
    pub(crate) quitting: AtomicBool,
    // v10.0.0 : horodatages des redémarrages automatiques (budget anti-boucle).
    pub(crate) restart_history: Mutex<Vec<Instant>>,
}

pub(crate) struct NodeRuntime {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
    // v10.0.0 : true quand le flux stdout se referme (l'enfant est mort) — vu par
    // runtime_call qui déclenche alors la reprise budgétée.
    dead: Arc<AtomicBool>,
}

impl NodeRuntime {
    pub(crate) fn spawn(app: &AppHandle) -> Result<Self, String> {
        let (node, host, cwd) = runtime_command(app)?;

        let mut command = Command::new(&node);
        command
            .arg(&host)
            .current_dir(&cwd)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());

        #[cfg(windows)]
        {
            use std::os::windows::process::CommandExt;
            command.creation_flags(0x08000000);
        }

        let mut child = command
            .spawn()
            .map_err(|e| format!("Impossible de lancer le runtime Aven : {e}"))?;

        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "stdin du runtime Aven indisponible.".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "stdout du runtime Aven indisponible.".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "stderr du runtime Aven indisponible.".to_string())?;

        let pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>> =
            Arc::new(Mutex::new(HashMap::new()));
        let dead = Arc::new(AtomicBool::new(false));

        {
            let pending = Arc::clone(&pending);
            let dead = Arc::clone(&dead);
            let app = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);

                let mut turn_starts: HashMap<String, Instant> = HashMap::new();

                for line in reader.lines().flatten() {
                    let Ok(message) = serde_json::from_str::<Value>(&line) else {
                        continue;
                    };

                    if let Some(id) = message.get("id").and_then(Value::as_u64) {
                        if let Some(tx) = pending.lock().ok().and_then(|mut p| p.remove(&id)) {
                            let result = if let Some(error) = message.get("error") {
                                Err(error
                                    .get("message")
                                    .and_then(Value::as_str)
                                    .unwrap_or("Erreur runtime inconnue.")
                                    .to_string())
                            } else {
                                Ok(message.get("result").cloned().unwrap_or(Value::Null))
                            };
                            let _ = tx.send(result);
                        }
                    } else if message.get("method").and_then(Value::as_str) == Some("app.event") {
                        if let Some(params) = message.get("params").cloned() {
                            crate::notify::notify_from_event(&app, &mut turn_starts, &params);
                            let _ = app.emit("aven:event", params);
                        }
                    }
                }

                // v10.0.0 : le flux se referme = l'enfant est mort (ou a fini). On le
                // marque AVANT de libérer les appels en attente, pour qu'un appel
                // concurrent déjà en route déclenche la reprise dès le prochain tour.
                dead.store(true, Ordering::SeqCst);

                if let Ok(mut pending) = pending.lock() {
                    for (_, tx) in pending.drain() {
                        let _ = tx.send(Err("Le runtime Aven s'est arrêté.".to_string()));
                    }
                }
            });
        }

        thread::spawn(move || {
            let reader = BufReader::new(stderr);
            for line in reader.lines().flatten() {
                eprintln!("[aven-runtime] {line}");
            }
        });

        Ok(Self {
            child: Mutex::new(child),
            stdin: Mutex::new(stdin),
            next_id: AtomicU64::new(1),
            pending,
            dead,
        })
    }

    pub(crate) fn is_dead(&self) -> bool {
        self.dead.load(Ordering::SeqCst)
    }

    pub(crate) fn call(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
        self.call_with_timeout(method, args, REQUEST_TIMEOUT)
    }

    // v10.0.0 : variante à délai court pour l'arrêt de l'app — on ne bloque jamais
    // la fermeture plus de quelques secondes si le host est déjà grippé.
    pub(crate) fn call_with_timeout(
        &self,
        method: &str,
        args: Vec<Value>,
        timeout: Duration,
    ) -> Result<Value, String> {
        let id = self.next_id.fetch_add(1, Ordering::Relaxed);
        let request = json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": method,
            "params": args
        });
        let line = serde_json::to_string(&request)
            .map_err(|e| format!("Encodage RPC impossible : {e}"))?;

        let (tx, rx) = mpsc::channel();
        self.pending
            .lock()
            .map_err(|_| "Verrou RPC indisponible.".to_string())?
            .insert(id, tx);

        let write_result = self
            .stdin
            .lock()
            .map_err(|_| "stdin RPC indisponible.".to_string())
            .and_then(|mut input| {
                input
                    .write_all(line.as_bytes())
                    .and_then(|_| input.write_all(b"\n"))
                    .and_then(|_| input.flush())
                    .map_err(|e| format!("Écriture RPC impossible : {e}"))
            });

        if let Err(error) = write_result {
            if let Ok(mut pending) = self.pending.lock() {
                pending.remove(&id);
            }
            return Err(error);
        }

        match rx.recv_timeout(timeout) {
            Ok(result) => result,
            Err(_) => {
                if let Ok(mut pending) = self.pending.lock() {
                    pending.remove(&id);
                }
                Err(format!(
                    "Le runtime Aven n'a pas répondu à « {method} » dans le délai imparti."
                ))
            }
        }
    }

    pub(crate) fn stop(&self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

impl Drop for NodeRuntime {
    fn drop(&mut self) {
        if let Ok(mut child) = self.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
    }
}

// v10.0.0 : résolution ancrée sur le manifeste compilé, plus sur le cwd de
// lancement — `cargo test`, `npm run tauri:dev` et l'IDE n'ont pas le même cwd,
// et template_dir renvoyait alors un chemin fantôme en debug.
#[cfg(debug_assertions)]
fn project_root() -> Result<PathBuf, String> {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .map(Path::to_path_buf)
        .ok_or_else(|| "Racine du projet introuvable.".to_string())
}

pub(crate) fn template_dir(app: &AppHandle) -> Result<PathBuf, String> {
    // v10.0.0 : chaque profil n voit QUE sa branche (motif de shell.rs) — plus de
    // code inatteignable ni de paramètre inutilisé : cargo check sans warning.
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return project_root();
    }

    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resolve("runtime/template", BaseDirectory::Resource)
            .map_err(|_| "Ressources Aven introuvables.".to_string())
    }
}

pub(crate) fn runtime_command(app: &AppHandle) -> Result<(String, PathBuf, PathBuf), String> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        let cwd = project_root()?;
        return Ok((
            "node".to_string(),
            cwd.join("dist-host/aven-app-host.mjs"),
            cwd,
        ));
    }

    #[cfg(not(debug_assertions))]
    {
        let node = app
            .path()
            .resolve("runtime/node.exe", BaseDirectory::Resource)
            .map_err(|_| "Node embarqué introuvable.".to_string())?;
        let host = app
            .path()
            .resolve("runtime/aven-app-host.mjs", BaseDirectory::Resource)
            .map_err(|_| "Host Aven introuvable.".to_string())?;
        let cwd = user_data_dir()?;

        Ok((node.to_string_lossy().into_owned(), host, cwd))
    }
}

pub(crate) fn bundled_opencode(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return None;
    }

    #[cfg(not(debug_assertions))]
    {
        app.path()
            .resolve("runtime/opencode-bin/opencode.exe", BaseDirectory::Resource)
            .ok()
            .filter(|path| path.is_file())
    }
}

pub(crate) fn provider_env() -> serde_json::Map<String, Value> {
    let mut env = serde_json::Map::new();

    for key in ["OPENROUTER_API_KEY", "GROQ_API_KEY"] {
        if let Ok(value) = env::var(key) {
            if !value.trim().is_empty() {
                env.insert(key.to_string(), Value::String(value));
            }
        }
    }

    env
}

pub(crate) fn initial_state() -> Result<Value, String> {
    let (workspaces, _) = read_workspace_store()?;

    Ok(json!({
        "status": "starting",
        "needsWorkspace": true,
        "keys": {
            "openrouter": env::var("OPENROUTER_API_KEY").map(|v| !v.is_empty()).unwrap_or(false),
            "groq": env::var("GROQ_API_KEY").map(|v| !v.is_empty()).unwrap_or(false)
        },
        "providers": [
            {"id":"openrouter","label":"OpenRouter Free","url":"https://openrouter.ai/keys","note":"Accès au catalogue gratuit OpenRouter."},
            {"id":"groq","label":"Groq (chat + dictée)","url":"https://console.groq.com/keys","note":"Modèles gratuits pour le chat et la dictée."}
        ],
        "workspaces": workspaces,
    }))
}

pub(crate) fn boot_runtime(app: &AppHandle, state: &RuntimeState) -> Result<Value, String> {
    let Some(workspace) = active_workspace()? else {
        return initial_state();
    };

    if let Ok(mut slot) = state.node.lock() {
        if let Some(existing) = slot.take() {
            existing.stop();
        }
    }

    let runtime = Arc::new(NodeRuntime::spawn(app)?);
    let template = template_dir(app)?;

    let result = runtime.call(
        "initialize",
        vec![json!({
            "workspace": workspace,
            "templateDir": template,
            "env": provider_env(),
            "openRouterUsable": true,
            "binPath": bundled_opencode(app).map(|path| path.to_string_lossy().into_owned()),
            "binShell": false
        })],
    );

    match result {
        Ok(value) => {
            *state
                .node
                .lock()
                .map_err(|_| "État runtime indisponible.".to_string())? = Some(runtime);
            *state
                .booted_workspace
                .lock()
                .map_err(|_| "État runtime indisponible.".to_string())? =
                Some(workspace);
            Ok(value)
        }
        Err(error) => {
            runtime.stop();
            Err(error)
        }
    }
}

// v10.0.0 : appel RPC avec reprise après crash. Si l'enfant est mort, on le remplace
// (budget : 3 par minute) avant de transmettre — le frontend n'a plus à redémarrer
// l'app pour récupérer d'un OOM ou d'un kill externe.
pub(crate) fn runtime_call(
    app: &AppHandle,
    state: &RuntimeState,
    method: &str,
    args: Vec<Value>,
) -> Result<Value, String> {
    let dead = {
        let slot = state
            .node
            .lock()
            .map_err(|_| "État runtime indisponible.".to_string())?;
        slot.as_ref().map(|rt| rt.is_dead()).unwrap_or(false)
    };

    if dead {
        if let Ok(mut slot) = state.node.lock() {
            if let Some(runtime) = slot.take() {
                runtime.stop();
            }
        }
        *state
            .booted_workspace
            .lock()
            .map_err(|_| "État runtime indisponible.".to_string())? = None;

        // Pas d'espace actif : rien à relancer, l'écran de choix reprend la main.
        if active_workspace()?.is_none() {
            return Err("Le runtime Aven s'est arrêté.".to_string());
        }

        let allowed = {
            let mut history = state
                .restart_history
                .lock()
                .map_err(|_| "État runtime indisponible.".to_string())?;
            restart_allowed(&mut history, Instant::now())
        };
        if !allowed {
            return Err(
                "Le runtime Aven a redémarré trop souvent. Réessaie dans un minute, \
                 ou change d'espace de travail."
                    .to_string(),
            );
        }

        boot_runtime(app, state)?;
    }

    let node = state
        .node
        .lock()
        .map_err(|_| "État runtime indisponible.".to_string())?;

    let runtime = node
        .as_ref()
        .ok_or_else(|| "Le runtime Aven n'est pas démarré.".to_string())?;

    runtime.call(method, args)
}

#[cfg(test)]
mod tests {
    use super::restart_allowed;
    use std::time::{Duration, Instant};

    #[test]
    fn budget_allows_three_restarts_then_refuses() {
        let mut history = Vec::new();
        let now = Instant::now();
        assert!(restart_allowed(&mut history, now));
        assert!(restart_allowed(&mut history, now));
        assert!(restart_allowed(&mut history, now));
        assert!(!restart_allowed(&mut history, now), "4e en moins d'une minute : refusé");
        assert_eq!(history.len(), 3, "l'historique grossit jusqu'au budget");
    }

    #[test]
    fn budget_window_slides_and_frees_slots() {
        let base = Instant::now();
        let mut history = vec![base, base + Duration::from_secs(1), base + Duration::from_secs(2)];
        // 63 s après le premier échec : les trois entrées ont > 60 s d'ancienneté.
        let later = base + Duration::from_secs(63);

        assert!(
            restart_allowed(&mut history, later),
            "les échecs de plus d'une minute sont purgés"
        );
        assert_eq!(history.len(), 1, "seul le redémarrage courant reste");
    }

    #[test]
    fn budget_keeps_recent_entries_inside_the_window() {
        let base = Instant::now();
        let mut history = vec![base, base + Duration::from_secs(1), base + Duration::from_secs(2)];
        // 61 s après le premier : base+2 n'a que 59 s, il reste dans la fenêtre.
        let later = base + Duration::from_secs(61);

        assert!(
            restart_allowed(&mut history, later),
            "deux entrées récentes purgées, une reste : budget non épuisé"
        );
        assert_eq!(history.len(), 2, "l'entrée de 59 s survit à la purge");
    }

    #[test]
    fn fresh_history_is_always_allowed() {
        let mut history = Vec::new();
        assert!(restart_allowed(&mut history, Instant::now()));
    }
}
