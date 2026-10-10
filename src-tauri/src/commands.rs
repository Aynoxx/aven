// v10.0.0 : la commande unique aven_call est extraite du monolithe lib.rs.
// Elle reste LE point d'entrée RPC du frontend (parité stricte avec le façade
// web/src/api.ts) : actions fenêtre et store d'espaces côté Rust, tout le reste
// est rétrocédé au runtime Node via runtime_call.
use crate::runtime::{boot_runtime, runtime_call, RuntimeState};
use crate::shell::{open_system_path, open_url, write_text_file};
use crate::workspaces::{
    active_workspace, add_workspace, read_workspace_store, write_workspace_store,
};
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, State};

// v10.0.0 : Rust possède le registre des espaces ; chaque état exposé au frontend
// doit donc le recharger, plutôt que d'attendre une copie obsolète du runtime Node.
fn inject_workspaces(mut value: Value, workspaces: Vec<Value>) -> Value {
    if let Some(object) = value.as_object_mut() {
        object.insert("workspaces".to_string(), Value::Array(workspaces));
    }
    value
}

fn state_with_workspaces(value: Value) -> Result<Value, String> {
    Ok(inject_workspaces(value, read_workspace_store()?.0))
}

#[tauri::command]
pub(crate) fn aven_call(
    app: AppHandle,
    state: State<'_, RuntimeState>,
    method: String,
    args: Vec<Value>,
) -> Result<Value, String> {
    match method.as_str() {
        "openWorkspace" => {
            let workspace = active_workspace()?
                .ok_or_else(|| "Aucun espace de travail actif.".to_string())?;
            open_system_path(Path::new(&workspace))?;
            Ok(Value::String(workspace))
        }

        "openPath" => {
            let target = args
                .first()
                .and_then(Value::as_str)
                .ok_or_else(|| "Chemin absent.".to_string())?;
            let path = PathBuf::from(target)
                .canonicalize()
                .map_err(|_| "Le chemin choisi n'existe pas.".to_string())?;
            open_system_path(&path)?;
            Ok(Value::String(path.to_string_lossy().into_owned()))
        }

        "writeTextFile" => {
            let target = args
                .first()
                .and_then(Value::as_str)
                .ok_or_else(|| "Chemin de sortie absent.".to_string())?;
            let content = args
                .get(1)
                .and_then(Value::as_str)
                .ok_or_else(|| "Contenu de sortie absent.".to_string())?;
            Ok(Value::String(write_text_file(target, content)?))
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
                return crate::runtime::initial_state();
            }

            if booted != active {
                return state_with_workspaces(boot_runtime(&app, &state)?);
            }

            state_with_workspaces(runtime_call(&app, &state, "state", args)?)
        }

        // v10.0.0 : fournir les noms d'espaces au diagnostic sans exposer leurs chemins.
        "diagnostic" => {
            let workspaces = read_workspace_store()?.0;
            runtime_call(&app, &state, "diagnostic", vec![json!(workspaces)])
        }

        "workspace:list" => Ok(read_workspace_store()?.0.into()),

        "workspace:add" => {
            let path = args.first().and_then(Value::as_str).unwrap_or_default();
            let name = args.get(1).and_then(Value::as_str).unwrap_or_default();
            let (entry, clean) = add_workspace(path, name)?;

            if let Ok(mut node) = state.node.lock() {
                if let Some(runtime) = node.take() {
                    runtime.stop();
                }
            }
            *state
                .booted_workspace
                .lock()
                .map_err(|_| "État runtime indisponible.".to_string())? = None;

            let state_value = state_with_workspaces(boot_runtime(&app, &state)?)?;
            Ok(json!({
                "entry": entry,
                "state": state_value,
                "workspace": clean
            }))
        }

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

            state_with_workspaces(boot_runtime(&app, &state)?)
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

        _ => runtime_call(&app, &state, &method, args),
    }
}


#[cfg(test)]
mod tests {
    use super::inject_workspaces;
    use serde_json::json;

    #[test]
    fn state_keeps_runtime_fields_and_refreshes_workspace_list() {
        let value = json!({
            "status": "ready",
            "workspace": "C:/dev/aven",
            "workspaces": [{"path": "stale", "name": "Ancien"}],
            "sync": []
        });
        let current = vec![
            json!({"path": "C:/dev/aven", "name": "Aven"}),
            json!({"path": "C:/dev/autre", "name": "Autre"})
        ];

        let updated = inject_workspaces(value, current.clone());

        assert_eq!(updated["status"], "ready");
        assert_eq!(updated["workspace"], "C:/dev/aven");
        assert_eq!(updated["sync"], json!([]));
        assert_eq!(updated["workspaces"], json!(current));
    }

    #[test]
    fn state_can_represent_empty_workspace_registry() {
        let updated = inject_workspaces(json!({"status": "starting"}), vec![]);
        assert_eq!(updated["workspaces"], json!([]));
    }
}
