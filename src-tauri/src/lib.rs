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

        builder = builder.plugin(
            tauri_plugin_global_shortcut::Builder::new()
                .with_handler(move |app, shortcut, event| {
                    if shortcut == &handler_shortcut && event.state() == ShortcutState::Pressed {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
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
