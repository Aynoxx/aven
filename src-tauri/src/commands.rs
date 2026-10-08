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
                return boot_runtime(&app, &state);
            }

            runtime_call(&app, &state, "state", args)
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

            let state_value = boot_runtime(&app, &state)?;
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

        _ => runtime_call(&app, &state, &method, args),
    }
}
