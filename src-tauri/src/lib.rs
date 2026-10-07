use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    io::{BufRead, BufReader, Write},
    path::{Path, PathBuf},
    process::{Child, ChildStdin, Command, Stdio},
    sync::{
        atomic::{AtomicU64, Ordering},
        mpsc,
        Arc, Mutex,
    },
    thread,
    time::Duration,
};
use tauri::{
    path::BaseDirectory,
    AppHandle, Emitter, Manager, State,
};

const REQUEST_TIMEOUT: Duration = Duration::from_secs(120);

#[derive(Default)]
struct RuntimeState {
    node: Mutex<Option<Arc<NodeRuntime>>>,
    booted_workspace: Mutex<Option<String>>,
}

struct NodeRuntime {
    child: Mutex<Child>,
    stdin: Mutex<ChildStdin>,
    next_id: AtomicU64,
    pending: Arc<Mutex<HashMap<u64, mpsc::Sender<Result<Value, String>>>>>,
}

impl NodeRuntime {
    fn spawn(app: &AppHandle) -> Result<Self, String> {
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

        {
            let pending = Arc::clone(&pending);
            let app = app.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stdout);

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
                            let _ = app.emit("aven:event", params);
                        }
                    }
                }

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
        })
    }

    fn call(&self, method: &str, args: Vec<Value>) -> Result<Value, String> {
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

        match rx.recv_timeout(REQUEST_TIMEOUT) {
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

    fn stop(&self) {
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

fn user_data_dir() -> Result<PathBuf, String> {
    #[cfg(windows)]
    {
        let root = env::var_os("APPDATA")
            .ok_or_else(|| "APPDATA est introuvable.".to_string())?;
        return Ok(PathBuf::from(root).join("Aven"));
    }

    let root = env::var_os("XDG_CONFIG_HOME")
        .or_else(|| env::var_os("HOME"))
        .ok_or_else(|| "Répertoire utilisateur introuvable.".to_string())?;
    Ok(PathBuf::from(root).join("Aven"))
}

fn read_workspace_store() -> Result<(Vec<Value>, Option<String>), String> {
    let path = user_data_dir()?.join("workspaces.json");
    let raw = match std::fs::read_to_string(&path) {
        Ok(value) => value,
        Err(_) => return Ok((Vec::new(), None)),
    };
    let data: Value =
        serde_json::from_str(&raw).map_err(|e| format!("workspaces.json invalide : {e}"))?;

    let list = data
        .get("list")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    let active = data
        .get("active")
        .and_then(Value::as_str)
        .map(ToString::to_string);

    Ok((list, active))
}

fn write_workspace_store(list: Vec<Value>, active: Option<String>) -> Result<(), String> {
    let dir = user_data_dir()?;
    std::fs::create_dir_all(&dir)
        .map_err(|e| format!("Impossible de créer le dossier Aven : {e}"))?;

    let content = serde_json::to_string_pretty(&json!({
        "list": list,
        "active": active
    }))
    .map_err(|e| format!("Encodage workspaces impossible : {e}"))?;

    std::fs::write(dir.join("workspaces.json"), content)
        .map_err(|e| format!("Impossible d'écrire workspaces.json : {e}"))
}

fn active_workspace() -> Result<Option<String>, String> {
    let (list, active) = read_workspace_store()?;
    let Some(active) = active else {
        return Ok(None);
    };

    if list.iter().any(|item| {
        item.get("path").and_then(Value::as_str) == Some(active.as_str())
            && Path::new(&active).is_dir()
    }) {
        return Ok(Some(active));
    }

    Ok(None)
}

fn template_dir(app: &AppHandle) -> Result<PathBuf, String> {
    #[cfg(debug_assertions)]
    {
        return env::current_dir()
            .map_err(|e| format!("Répertoire du projet introuvable : {e}"));
    }

    app.path()
        .resolve("runtime/template", BaseDirectory::Resource)
        .map_err(|e| format!("Ressources Aven introuvables : {e}"))
}

fn runtime_command(app: &AppHandle) -> Result<(String, PathBuf, PathBuf), String> {
    #[cfg(debug_assertions)]
    {
        let cwd = env::current_dir()
            .map_err(|e| format!("Répertoire du projet introuvable : {e}"))?;
        return Ok((
            "node".to_string(),
            cwd.join("dist-electron/aven-app-host.mjs"),
            cwd,
        ));
    }

    let node = app
        .path()
        .resolve("runtime/node.exe", BaseDirectory::Resource)
        .map_err(|e| format!("Node embarqué introuvable : {e}"))?;
    let host = app
        .path()
        .resolve("runtime/aven-app-host.mjs", BaseDirectory::Resource)
        .map_err(|e| format!("Host Aven introuvable : {e}"))?;
    let cwd = user_data_dir()?;

    Ok((node.to_string_lossy().into_owned(), host, cwd))
}

fn bundled_opencode(app: &AppHandle) -> Option<PathBuf> {
    #[cfg(debug_assertions)]
    {
        let _ = app;
        return None;
    }

    app.path()
        .resolve("runtime/opencode-bin/opencode.exe", BaseDirectory::Resource)
        .ok()
        .filter(|path| path.is_file())
}

fn provider_env() -> serde_json::Map<String, Value> {
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

fn initial_state() -> Result<Value, String> {
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
        "updatesConfigured": false
    }))
}

fn boot_runtime(app: &AppHandle, state: &RuntimeState) -> Result<Value, String> {
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

fn open_system_path(target: &Path) -> Result<(), String> {
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir « {} » : {e}", target.display()))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir « {} » : {e}", target.display()))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(target)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir « {} » : {e}", target.display()))?;
        return Ok(());
    }

    #[cfg(not(any(windows, target_os = "macos", unix)))]
    {
        let _ = target;
        Err("Ouverture système non supportée sur cette plateforme.".to_string())
    }
}

fn open_url(url: &str) -> Result<(), String> {
    if ![
        "https://openrouter.ai/keys",
        "https://console.groq.com/keys",
    ]
    .contains(&url)
    {
        return Err("URL externe refusée par la liste blanche Aven.".to_string());
    }

    #[cfg(windows)]
    {
        Command::new("cmd")
            .args(["/C", "start", "", url])
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le lien : {e}"))?;
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le lien : {e}"))?;
        return Ok(());
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map_err(|e| format!("Impossible d'ouvrir le lien : {e}"))?;
        return Ok(());
    }

    #[cfg(not(any(windows, target_os = "macos", unix)))]
    {
        let _ = url;
        Err("Ouverture de lien non supportée sur cette plateforme.".to_string())
    }
}

fn runtime_call(state: &RuntimeState, method: &str, args: Vec<Value>) -> Result<Value, String> {
    let node = state
        .node
        .lock()
        .map_err(|_| "État runtime indisponible.".to_string())?;

    let runtime = node
        .as_ref()
        .ok_or_else(|| "Le runtime Aven n'est pas démarré.".to_string())?;

    runtime.call(method, args)
}

#[tauri::command]
fn aven_call(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match method.as_str() {
        "minimizeWindow" => {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;
            window.minimize().map_err(|e| format!("Impossible de réduire la fenêtre : {e}"))?;
            Ok(json!(true))
        }

        "toggleMaximize" => {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;
            let maximized = window
                .is_maximized()
                .map_err(|e| format!("État de fenêtre indisponible : {e}"))?;
            if maximized {
                window.unmaximize().map_err(|e| format!("Impossible de restaurer la fenêtre : {e}"))?;
            } else {
                window.maximize().map_err(|e| format!("Impossible de maximiser la fenêtre : {e}"))?;
            }
            Ok(json!(true))
        }

        "closeWindow" => {
            let window = app
                .get_webview_window("main")
                .ok_or_else(|| "Fenêtre principale introuvable.".to_string())?;
            window.close().map_err(|e| format!("Impossible de fermer la fenêtre : {e}"))?;
            Ok(json!(true))
        }

        "openWorkspace" => {
            let workspace = active_workspace()?
                .ok_or_else(|| "Aucun espace de travail actif.".to_string())?;
            open_system_path(Path::new(&workspace))?;
            Ok(Value::String(workspace))
        }

        "openExternal" => {
            let url = args.first().and_then(Value::as_str).unwrap_or_default();
            open_url(url)?;
            Ok(Value::Null)
        }

        "state" => {
            let active = active_workspace()?;
            let booted = state
                .booted_workspace
                .lock()
                .map_err(|_| "État runtime indisponible.".to_string())?
                .clone();

            if active.is_none() {
                return initial_state();
            }

            if booted != active {
                return boot_runtime(&app, &state);
            }

            runtime_call(&state, "state", args)
        }

        "workspace:list" => Ok(read_workspace_store()?.0.into()),

        "workspace:switch" => {
            let wanted = PathBuf::from(
                args.first()
                    .and_then(Value::as_str)
                    .unwrap_or_default(),
            );

            let (list, _) = read_workspace_store()?;
            let clean = wanted
                .canonicalize()
                .map_err(|_| "Le dossier de travail n'existe pas.".to_string())?;

            if !list.iter().any(|item| {
                item.get("path")
                    .and_then(Value::as_str)
                    .map(Path::new)
                    .map(|path| path == clean)
                    .unwrap_or(false)
            }) {
                return Err("Espace de travail non autorisé.".to_string());
            }

            write_workspace_store(list, Some(clean.to_string_lossy().into_owned()))?;
            *state
                .booted_workspace
                .lock()
                .map_err(|_| "État runtime indisponible.".to_string())? = None;

            boot_runtime(&app, &state)
        }

        "workspace:remove" => {
            let wanted = args
                .first()
                .and_then(Value::as_str)
                .unwrap_or_default()
                .to_string();

            let (list, active) = read_workspace_store()?;
            let next = list
                .into_iter()
                .filter(|item| item.get("path").and_then(Value::as_str) != Some(wanted.as_str()))
                .collect::<Vec<_>>();

            let next_active = if active.as_deref() == Some(wanted.as_str()) {
                None
            } else {
                active
            };

            write_workspace_store(next.clone(), next_active.clone())?;

            if next_active.is_none() {
                if let Ok(mut node) = state.node.lock() {
                    if let Some(runtime) = node.take() {
                        runtime.stop();
                    }
                }
                *state
                    .booted_workspace
                    .lock()
                    .map_err(|_| "État runtime indisponible.".to_string())? = None;
            }

            Ok(next.into())
        }

        _ => runtime_call(&state, &method, args),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(RuntimeState::default())
        .invoke_handler(tauri::generate_handler![aven_call])
        .build(tauri::generate_context!())
        .expect("error while building Aven")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut state) = app.state::<RuntimeState>().node.lock() {
                    if let Some(runtime) = state.take() {
                        runtime.stop();
                    }
                }
            }
        });
}
