// v10.0.0 : politique de notifications alignée sur host/notify-policy.ts.
// Deux divergences corrigées en comparant ligne à ligne avec la version Electron :
//  1. le titre d'un tour terminé était « Tour terminé » en Rust mais « Aven » en TS ;
//  2. une durée inconnue (aucun started mesuré) notifiait en Rust, jamais en TS —
//     la règle « un tour court ne notifie pas » protège aussi l'inconnu : 0 ms.
// should_notify/notify_content sont purs (aucune dépendance Tauri) : testés par
// cargo test, en miroir de tests/notify-policy.test.mjs.
use serde_json::Value;
use std::collections::HashMap;
use std::time::Instant;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum NotifyKind {
    TurnDone,
    TurnError,
    Permission,
    Form,
}

// Pur : miroir exact de shouldNotify(host/notify-policy.ts), seuil 8000 ms inclus
// côté strictement supérieur — 8000 ms pile ne notifie pas, comme en TS.
pub(crate) fn should_notify(
    window_focused: bool,
    enabled: bool,
    kind: NotifyKind,
    turn_duration_ms: Option<u64>,
) -> bool {
    if !enabled || window_focused {
        return false;
    }
    match kind {
        NotifyKind::Permission | NotifyKind::Form | NotifyKind::TurnError => true,
        NotifyKind::TurnDone => turn_duration_ms.unwrap_or(0) > 8000,
    }
}

// Pur : miroir exact de notifyContent(host/notify-policy.ts), libellés FR identiques.
pub(crate) fn notify_content(kind: NotifyKind, turn_duration_ms: Option<u64>) -> (&'static str, String) {
    match kind {
        NotifyKind::TurnDone => {
            let body = match turn_duration_ms {
                Some(ms) => format!(
                    "Tour terminé en {} s.",
                    ((ms as f64 / 1000.0).round() as u64).max(1)
                ),
                None => "Tour terminé.".to_string(),
            };
            ("Aven", body)
        }
        NotifyKind::TurnError => ("Aven", "Le tour de l'agent a échoué.".to_string()),
        NotifyKind::Permission => ("Aven", "L'agent attend ta permission.".to_string()),
        NotifyKind::Form => ("Aven", "Un formulaire attend tes réponses.".to_string()),
    }
}

pub(crate) fn notifications_enabled() -> bool {
    match crate::workspaces::user_data_dir()
        .ok()
        .map(|dir| dir.join("prefs.json"))
        .and_then(|path| std::fs::read_to_string(path).ok())
        .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
    {
        Some(value) => value
            .get("notifications")
            .and_then(Value::as_bool)
            .unwrap_or(true),
        None => true,
    }
}

// v9.1.0 : fenêtre au premier plan = tu vois déjà l'écran, jamais de toast.
// Copié de notifyDesktop(host/main.ts) : is_focused ET is_visible (cachée
// dans la tray ⇒ isVisible false, c'est voulu).
#[cfg(desktop)]
pub(crate) fn window_focused(app: &tauri::AppHandle) -> bool {
    use tauri::Manager;
    app.get_webview_window("main")
        .map(|w| w.is_focused().unwrap_or(false) && w.is_visible().unwrap_or(false))
        .unwrap_or(false)
}

#[cfg(desktop)]
pub(crate) fn notify_from_event(
    app: &tauri::AppHandle,
    turn_starts: &mut HashMap<String, Instant>,
    params: &Value,
) {
    use tauri_plugin_notification::NotificationExt;

    let Some(event_type) = params.get("type").and_then(Value::as_str) else {
        return;
    };
    let data = params.get("data").cloned().unwrap_or(Value::Null);
    let session_id = data.get("sessionID").and_then(Value::as_str).unwrap_or_default();

    // Mesure de durée TOUJOURS enregistrée, même fenêtre focalisée (comme en TS) :
    // seul l'envoi du toast dépend du focus.
    let turn_duration_ms = match event_type {
        "session.execution.started" if !session_id.is_empty() => {
            turn_starts.insert(session_id.to_string(), Instant::now());
            return;
        }
        "session.execution.succeeded" if !session_id.is_empty() => turn_starts
            .remove(session_id)
            .map(|started| started.elapsed().as_millis() as u64),
        "session.execution.failed" if !session_id.is_empty() => {
            turn_starts.remove(session_id);
            None
        }
        _ => None,
    };

    let kind = match event_type {
        "session.execution.succeeded" if !session_id.is_empty() => NotifyKind::TurnDone,
        "session.execution.failed" if !session_id.is_empty() => NotifyKind::TurnError,
        "permission.asked" => NotifyKind::Permission,
        "form.created" => NotifyKind::Form,
        _ => return,
    };

    if !should_notify(window_focused(app), notifications_enabled(), kind, turn_duration_ms) {
        return;
    }

    let (title, body) = notify_content(kind, turn_duration_ms);
    if let Err(error) = app.notification().builder().title(title).body(body).show() {
        eprintln!("[aven-notification] {error}");
    }
}

// v10.0.0 : la mesure des tours survit à la fenêtre focalisée (started enregistré
// avant tout test de focus) — le timing devient observable pour les tests.
#[cfg(test)]
mod tests {
    use super::{notify_content, should_notify, NotifyKind};

    const KINDS: [NotifyKind; 4] = [
        NotifyKind::TurnDone,
        NotifyKind::TurnError,
        NotifyKind::Permission,
        NotifyKind::Form,
    ];

    #[test]
    fn never_when_focused_all_kinds() {
        for kind in KINDS {
            assert!(
                !should_notify(true, true, kind, Some(60_000)),
                "kind={kind:?}"
            );
        }
    }

    #[test]
    fn never_when_disabled_all_kinds() {
        for kind in KINDS {
            assert!(
                !should_notify(false, false, kind, Some(60_000)),
                "kind={kind:?}"
            );
        }
    }

    #[test]
    fn turn_done_requires_more_than_8_seconds() {
        assert!(!should_notify(false, true, NotifyKind::TurnDone, None));
        assert!(!should_notify(false, true, NotifyKind::TurnDone, Some(0)));
        assert!(!should_notify(false, true, NotifyKind::TurnDone, Some(8_000)));
        assert!(should_notify(false, true, NotifyKind::TurnDone, Some(8_001)));
        assert!(should_notify(false, true, NotifyKind::TurnDone, Some(60_000)));
    }

    #[test]
    fn urgent_kinds_always_notify_when_background() {
        assert!(should_notify(false, true, NotifyKind::TurnError, None));
        assert!(should_notify(false, true, NotifyKind::Permission, None));
        assert!(should_notify(false, true, NotifyKind::Form, None));
        assert!(should_notify(false, true, NotifyKind::TurnError, Some(500)));
    }

    #[test]
    fn content_mirrors_typescript_labels() {
        assert_eq!(
            notify_content(NotifyKind::TurnDone, Some(9_500)),
            ("Aven", "Tour terminé en 10 s.".to_string())
        );
        assert_eq!(
            notify_content(NotifyKind::TurnDone, Some(1_200)),
            ("Aven", "Tour terminé en 1 s.".to_string())
        );
        assert_eq!(
            notify_content(NotifyKind::TurnError, None),
            ("Aven", "Le tour de l'agent a échoué.".to_string())
        );
        assert_eq!(
            notify_content(NotifyKind::Permission, None),
            ("Aven", "L'agent attend ta permission.".to_string())
        );
        assert_eq!(
            notify_content(NotifyKind::Form, None),
            ("Aven", "Un formulaire attend tes réponses.".to_string())
        );
    }

    #[test]
    fn turn_done_without_measured_duration_never_notifies() {
        // Un started jamais mesuré (fenêtre focalisée à ce moment-là, événement
        // manquant…) vaut 0 ms : jamais de toast, comme en TS — c'est la divergence
        // que ce module corrige par rapport à l'ancien lib.rs.
        assert!(!should_notify(false, true, NotifyKind::TurnDone, None));
    }
}
