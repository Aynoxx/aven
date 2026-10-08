// v10.0.0 : actions système (ouverture de chemins, liens, écriture de fichiers)
// extraites du monolithe lib.rs. La liste blanche des URLs double volontairement
// celle de electron/providers.ts : elle est sonde-par-sonde (verify-v10.0.0.mjs)
// pour que toute nouvelle URL côté Electron exige aussi une décision Rust.
use std::path::Path;
use std::process::Command;

pub(crate) fn open_system_path(target: &Path) -> Result<(), String> {
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

pub(crate) fn open_url(url: &str) -> Result<(), String> {
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

// v10.0.0 : chemin de sortie ASSUMÉ libre — il vient du save dialog choisi par
// l'utilisateur (parité exacte avec l'export Electron, qui écrivait aussi au
// chemin renvoyé par le renderer). Le risque est documenté plutôt que masqué :
// restreindre casserait l'export vers un dossier librement choisi.
pub(crate) fn write_text_file(target: &str, content: &str) -> Result<String, String> {
    let path = std::path::PathBuf::from(target);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| format!("Impossible de préparer le dossier de sortie : {e}"))?;
    }
    std::fs::write(&path, content)
        .map_err(|e| format!("Impossible d'écrire le fichier : {e}"))?;
    Ok(path.to_string_lossy().into_owned())
}
