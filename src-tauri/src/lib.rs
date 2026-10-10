// v10.0.0 : le monolithe lib.rs (966 lignes) est découpé en modules — la logique
// décisionnelle vit dans des modules purs testés (cargo test) :
//   runtime   — enfant Node JSON-RPC, reprise après crash, boot, état initial
//   workspaces — store workspaces.json, validation des noms Windows
//   notify    — politique de notifications, miroir pur de host/notify-policy.ts
//   shell     — ouverture système, liste blanche d'URLs, écriture de fichiers
//   commands  — la commande unique aven_call (point d'entrée RPC du frontend)
// Ce fichier ne garde que l'assemblage : plugins, tray, raccourcis, cycle de vie.
mod commands;
mod notify;
mod runtime;
mod shell;
mod workspaces;

use runtime::RuntimeState;
use std::sync::atomic::Ordering;
use tauri::Manager;

// v10.0.x : position/taille/état maximisé mémorisés entre les lancements.
// Flags restreints : VISIBLE/DECORATIONS/FULLSCREEN sont exclus — notre
// fermeture avale la fenêtre vers le tray, sauvegarder « visible=false »
// rendrait le prochain démarrage muet. Voir restore dans .setup() ci-dessous.
fn window_state_flags() -> tauri_plugin_window_state::StateFlags {
    use tauri_plugin_window_state::StateFlags;
    StateFlags::SIZE | StateFlags::POSITION | StateFlags::MAXIMIZED
}

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, Modifiers, Shortcut, ShortcutState};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        builder = builder.plugin(
            tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.unminimize();
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }),
        );

        let handler_shortcut = Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT),
            Code::KeyO,
        );
        // v10.1.0 : capture rapide façon Kortex — Ctrl+Shift+N restaure la fenêtre
        // ET demande l'ouverture de la capture (événement aven:event → renderer).
        let capture_shortcut = Shortcut::new(
            Some(Modifiers::CONTROL | Modifiers::SHIFT),
            Code::KeyN,
        );

        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if event.state() != ShortcutState::Pressed {
                        return;
                    }
                    if shortcut != &handler_shortcut && shortcut != &capture_shortcut {
                        return;
                    }
                    if let Some(window) = app.get_webview_window("main") {
                        let _ = window.unminimize();
                        let _ = window.show();
                        let _ = window.set_focus();
                        if shortcut == &capture_shortcut {
                            use tauri::Emitter;
                            let _ = window.emit(
                                "aven:event",
                                serde_json::json!({ "type": "quick-capture", "data": {} }),
                            );
                        }
                    }
                })
                .build(),
        );

        // v10.0.x : persistance de la fenêtre. skip_initial_state("main") : la
        // restauration est faite à la main dans .setup() — le plugin ne fait que
        // « maximize » (jamais unmaximize) et la config ouvre maximisé, un état
        // fenêtré sauvé serait sinon écrasé à chaque lancement.
        builder = builder.plugin(
            tauri_plugin_window_state::Builder::new()
                .with_state_flags(window_state_flags())
                .skip_initial_state("main")
                .build(),
        );
    }

    builder
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_notification::init())
        .manage(RuntimeState::default())
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                let state = window.app_handle().state::<RuntimeState>();
                if !state.quitting.load(Ordering::Relaxed) {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .setup(|app| {
            // v10.0.x : restauration explicite de la fenêtre. Si un état sauvé existe
            // (.window-state.json), on repart fenêtré pour que le plugin replace
            // taille/position puis re-maximise si l'état le dit ; sans état, le
            // maximisé de tauri.conf.json fait foi (premier lancement).
            {
                use tauri_plugin_window_state::WindowExt;
                let window = app
                    .get_webview_window("main")
                    .expect("fenêtre principale Aven introuvable");
                let etat = app
                    .path()
                    .app_config_dir()?
                    .join(tauri_plugin_window_state::DEFAULT_FILENAME);
                if etat.exists() {
                    let _ = window.unmaximize();
                }
                window.restore_state(window_state_flags())?;
            }

            #[cfg(desktop)]
            {
                use tauri::{
                    menu::{Menu, MenuItem},
                    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
                };
                use tauri_plugin_global_shortcut::GlobalShortcutExt;

                let show = MenuItem::with_id(app, "show", "Afficher", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "Quitter", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;

                TrayIconBuilder::new()
                    .icon(app.default_window_icon().ok_or("Icône Aven introuvable.")?.clone())
                    .menu(&menu)
                    .show_menu_on_left_click(false)
                    .on_menu_event(|app, event| match event.id.as_ref() {
                        "show" => {
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                        "quit" => {
                            let state = app.state::<RuntimeState>();
                            state.quitting.store(true, Ordering::Relaxed);
                            app.exit(0);
                        }
                        _ => {}
                    })
                    .on_tray_icon_event(|tray, event| {
                        if let TrayIconEvent::Click {
                            button: MouseButton::Left,
                            button_state: MouseButtonState::Up,
                            ..
                        } = event
                        {
                            let app = tray.app_handle();
                            if let Some(window) = app.get_webview_window("main") {
                                let _ = window.unminimize();
                                let _ = window.show();
                                let _ = window.set_focus();
                            }
                        }
                    })
                    .build(app)?;

                app.global_shortcut().register(Shortcut::new(
                    Some(Modifiers::CONTROL | Modifiers::SHIFT),
                    Code::KeyO,
                ))?;
                app.global_shortcut().register(Shortcut::new(
                    Some(Modifiers::CONTROL | Modifiers::SHIFT),
                    Code::KeyN,
                ))?;
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![commands::aven_call])
        .build(tauri::generate_context!())
        .expect("error while building Aven")
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                if let Ok(mut state) = app.state::<RuntimeState>().node.lock() {
                    if let Some(runtime) = state.take() {
                        // v10.0.0 : arrêt GRÂCE du host (PTY freebuff compris) avant le
                        // kill — borné à 3 s pour ne jamais bloquer la fermeture.
                        let _ = runtime.call_with_timeout(
                            "shutdown",
                            vec![],
                            std::time::Duration::from_secs(3),
                        );
                        runtime.stop();
                    }
                }
            }
        });
}
