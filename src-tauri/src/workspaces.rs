// v10.0.0 : gestion des espaces de travail extraite du monolithe lib.rs.
// Le format disque (%APPDATA%/Aven/workspaces.json) est identique à celui d'Electron :
// aucune migration, les deux versions lisent le même fichier.
use serde_json::{json, Value};
use std::{env, path::Path, path::PathBuf};

pub(crate) fn user_data_dir() -> Result<PathBuf, String> {
    // v10.0.0 : les deux OS portent leur propre cfg (motif de shell.rs) — le corps
    // Unix n'existe plus dans un binaire Windows : plus de warning « unreachable ».
    #[cfg(windows)]
    {
        let root = env::var_os("APPDATA")
            .ok_or_else(|| "APPDATA est introuvable.".to_string())?;
        return Ok(PathBuf::from(root).join("Aven"));
    }

    #[cfg(not(windows))]
    {
        let root = env::var_os("XDG_CONFIG_HOME")
            .or_else(|| env::var_os("HOME"))
            .ok_or_else(|| "Répertoire utilisateur introuvable.".to_string())?;
        Ok(PathBuf::from(root).join("Aven"))
    }
}

pub(crate) fn read_workspace_store() -> Result<(Vec<Value>, Option<String>), String> {
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

pub(crate) fn write_workspace_store(
    list: Vec<Value>,
    active: Option<String>,
) -> Result<(), String> {
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

pub(crate) fn active_workspace() -> Result<Option<String>, String> {
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

pub(crate) fn workspace_name_valid(name: &str) -> bool {
    let clean = name.trim();
    if clean.is_empty() || clean == "." || clean == ".." {
        return false;
    }
    if clean.chars().any(|c| "<>:\"/\\|?*".contains(c)) {
        return false;
    }
    ![
        "CON", "PRN", "AUX", "NUL", "COM1", "COM2", "COM3", "COM4", "COM5", "COM6", "COM7", "COM8",
        "COM9", "LPT1", "LPT2", "LPT3", "LPT4", "LPT5", "LPT6", "LPT7", "LPT8", "LPT9",
    ].iter().any(|reserved| {
        clean.eq_ignore_ascii_case(reserved)
            || clean
                .strip_prefix(reserved)
                .map(|rest| rest.starts_with('.'))
                .unwrap_or(false)
    })
}

pub(crate) fn add_workspace(path: &str, name: &str) -> Result<(Value, String), String> {
    let clean = PathBuf::from(path)
        .canonicalize()
        .map_err(|_| "Le dossier de travail n'existe pas.".to_string())?;

    if !clean.is_dir() {
        return Err("Le chemin choisi n'est pas un dossier.".to_string());
    }

    let display_name = if name.trim().is_empty() {
        clean
            .file_name()
            .and_then(|v| v.to_str())
            .unwrap_or("Espace")
            .to_string()
    } else {
        name.trim().to_string()
    };

    if !workspace_name_valid(&display_name) {
        return Err("Nom d’espace de travail invalide.".to_string());
    }

    let (mut list, _) = read_workspace_store()?;
    if list.iter().any(|item| {
        item.get("path")
            .and_then(Value::as_str)
            .map(|value| Path::new(value) == clean)
            .unwrap_or(false)
    }) {
        return Err("Ce dossier fait déjà partie des espaces de travail connus.".to_string());
    }

    let entry = json!({
        "path": clean.to_string_lossy(),
        "name": display_name
    });

    list.push(entry.clone());
    let clean_string = clean.to_string_lossy().into_owned();
    write_workspace_store(list, Some(clean_string.clone()))?;

    Ok((entry, clean_string))
}

#[cfg(test)]
mod tests {
    use super::workspace_name_valid;

    #[test]
    fn accepts_normal_workspace_names() {
        assert!(workspace_name_valid("Projet Aven"));
        assert!(workspace_name_valid("Royaume-01"));
        assert!(workspace_name_valid("v10"));
    }

    #[test]
    fn rejects_invalid_windows_names() {
        assert!(!workspace_name_valid(""));
        assert!(!workspace_name_valid(".."));
        assert!(!workspace_name_valid("CON"));
        assert!(!workspace_name_valid("LPT1"));
        assert!(!workspace_name_valid("nom/invalide"));
        assert!(!workspace_name_valid("nom:invalide"));
    }
}
