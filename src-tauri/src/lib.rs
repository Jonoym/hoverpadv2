use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{Emitter, Manager};

/// Tracks whether all windows are currently visible.
/// Starts as `true` since windows are shown on launch.
struct VisibilityState(AtomicBool);

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .manage(VisibilityState(AtomicBool::new(true)))
        .setup(|app| {
            #[cfg(desktop)]
            {
                use tauri_plugin_global_shortcut::{
                    Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState,
                };

                // Define shortcuts
                let new_note = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyN);
                let toggle_visibility = Shortcut::new(Some(Modifiers::CONTROL), Code::KeyH);
                let opacity_decrease = Shortcut::new(Some(Modifiers::CONTROL), Code::Comma);
                let opacity_increase = Shortcut::new(Some(Modifiers::CONTROL), Code::Period);

                // Register the plugin with a handler that dispatches based on which shortcut fired
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            // Only act on key-down, not key-up
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }

                            if shortcut == &new_note {
                                if let Err(e) = app.emit("hotkey:new-note", ()) {
                                    eprintln!("[hoverpad] failed to emit hotkey:new-note: {e}");
                                }
                            } else if shortcut == &toggle_visibility {
                                toggle_all_windows(app);
                            } else if shortcut == &opacity_decrease {
                                if let Err(e) = app.emit("hotkey:opacity-decrease", ()) {
                                    eprintln!(
                                        "[hoverpad] failed to emit hotkey:opacity-decrease: {e}"
                                    );
                                }
                            } else if shortcut == &opacity_increase {
                                if let Err(e) = app.emit("hotkey:opacity-increase", ()) {
                                    eprintln!(
                                        "[hoverpad] failed to emit hotkey:opacity-increase: {e}"
                                    );
                                }
                            }
                        })
                        .build(),
                )?;

                // Register each shortcut individually, logging warnings on failure
                let gs = app.global_shortcut();
                if let Err(e) = gs.register(new_note) {
                    eprintln!("[hoverpad] failed to register Ctrl+N: {e}");
                }
                if let Err(e) = gs.register(toggle_visibility) {
                    eprintln!("[hoverpad] failed to register Ctrl+H: {e}");
                }
                if let Err(e) = gs.register(opacity_decrease) {
                    eprintln!("[hoverpad] failed to register Ctrl+,: {e}");
                }
                if let Err(e) = gs.register(opacity_increase) {
                    eprintln!("[hoverpad] failed to register Ctrl+.: {e}");
                }
            }

            // When the main window is closed, close all other windows and exit
            let handle = app.handle().clone();
            let main_window = app
                .get_webview_window("main")
                .expect("main window not found");

            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Close all webview windows
                    for (_, window) in handle.webview_windows() {
                        let _ = window.close();
                    }
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

/// Toggle all webview windows between hidden and shown.
/// Uses an `AtomicBool` stored in Tauri managed state to track visibility.
fn toggle_all_windows(app: &tauri::AppHandle) {
    let state = app.state::<VisibilityState>();
    let currently_visible = state.0.load(Ordering::SeqCst);

    for (_label, window) in app.webview_windows() {
        let result = if currently_visible {
            window.hide()
        } else {
            window.show()
        };

        if let Err(e) = result {
            eprintln!("[hoverpad] failed to toggle window visibility: {e}");
        }
    }

    // Flip the tracked state
    state.0.store(!currently_visible, Ordering::SeqCst);
}
