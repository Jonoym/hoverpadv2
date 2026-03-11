use std::collections::HashMap;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};

use tauri::{Emitter, Manager, State};

mod session_watcher;
mod window_group;

#[cfg(desktop)]
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

/// Maps shortcut strings (e.g. "Ctrl+N") to action names (e.g. "new-note").
/// Used by the global shortcut handler to determine which event to emit.
struct HotkeyState {
    bindings: Mutex<HashMap<String, String>>,
}

/// Managed state for the clipboard monitor background task.
struct ClipboardMonitorState {
    running: Arc<AtomicBool>,
    /// When true, the next clipboard change is skipped (because we wrote it ourselves).
    skip_next: Arc<AtomicBool>,
    last_hash: Arc<Mutex<u64>>,
}

#[cfg(desktop)]
fn parse_shortcut(s: &str) -> Result<Shortcut, String> {
    let parts: Vec<&str> = s.split('+').collect();
    if parts.len() < 2 {
        return Err(format!("Invalid shortcut: {}", s));
    }

    let mut modifiers = Modifiers::empty();
    for part in &parts[..parts.len() - 1] {
        match part.to_lowercase().as_str() {
            "ctrl" | "control" => modifiers |= Modifiers::CONTROL,
            "alt" => modifiers |= Modifiers::ALT,
            "shift" => modifiers |= Modifiers::SHIFT,
            "super" | "meta" => modifiers |= Modifiers::SUPER,
            _ => return Err(format!("Unknown modifier: {}", part)),
        }
    }

    let key_str = parts.last().unwrap();
    let code = match key_str.to_uppercase().as_str() {
        "A" => Code::KeyA,
        "B" => Code::KeyB,
        "C" => Code::KeyC,
        "D" => Code::KeyD,
        "E" => Code::KeyE,
        "F" => Code::KeyF,
        "G" => Code::KeyG,
        "H" => Code::KeyH,
        "I" => Code::KeyI,
        "J" => Code::KeyJ,
        "K" => Code::KeyK,
        "L" => Code::KeyL,
        "M" => Code::KeyM,
        "N" => Code::KeyN,
        "O" => Code::KeyO,
        "P" => Code::KeyP,
        "Q" => Code::KeyQ,
        "R" => Code::KeyR,
        "S" => Code::KeyS,
        "T" => Code::KeyT,
        "U" => Code::KeyU,
        "V" => Code::KeyV,
        "W" => Code::KeyW,
        "X" => Code::KeyX,
        "Y" => Code::KeyY,
        "Z" => Code::KeyZ,
        "0" => Code::Digit0,
        "1" => Code::Digit1,
        "2" => Code::Digit2,
        "3" => Code::Digit3,
        "4" => Code::Digit4,
        "5" => Code::Digit5,
        "6" => Code::Digit6,
        "7" => Code::Digit7,
        "8" => Code::Digit8,
        "9" => Code::Digit9,
        "," | "COMMA" => Code::Comma,
        "." | "PERIOD" => Code::Period,
        "/" | "SLASH" => Code::Slash,
        ";" | "SEMICOLON" => Code::Semicolon,
        "SPACE" => Code::Space,
        "ENTER" | "RETURN" => Code::Enter,
        "ESCAPE" | "ESC" => Code::Escape,
        "BACKSPACE" => Code::Backspace,
        "TAB" => Code::Tab,
        "UP" => Code::ArrowUp,
        "DOWN" => Code::ArrowDown,
        "LEFT" => Code::ArrowLeft,
        "RIGHT" => Code::ArrowRight,
        "DELETE" => Code::Delete,
        "HOME" => Code::Home,
        "END" => Code::End,
        "PAGEUP" => Code::PageUp,
        "PAGEDOWN" => Code::PageDown,
        "F1" => Code::F1,
        "F2" => Code::F2,
        "F3" => Code::F3,
        "F4" => Code::F4,
        "F5" => Code::F5,
        "F6" => Code::F6,
        "F7" => Code::F7,
        "F8" => Code::F8,
        "F9" => Code::F9,
        "F10" => Code::F10,
        "F11" => Code::F11,
        "F12" => Code::F12,
        "-" => Code::Minus,
        "=" => Code::Equal,
        "[" => Code::BracketLeft,
        "]" => Code::BracketRight,
        "\\" => Code::Backslash,
        "'" => Code::Quote,
        "`" => Code::Backquote,
        _ => return Err(format!("Unknown key: {}", key_str)),
    };

    Ok(Shortcut::new(Some(modifiers), code))
}

#[tauri::command]
async fn register_hotkey(
    app: tauri::AppHandle,
    action: String,
    shortcut_str: String,
    state: State<'_, HotkeyState>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let shortcut = parse_shortcut(&shortcut_str).map_err(|e| e.to_string())?;
        let gs = app.global_shortcut();
        gs.register(shortcut)
            .map_err(|e| format!("Failed to register {}: {}", shortcut_str, e))?;
        state
            .bindings
            .lock()
            .unwrap()
            .insert(shortcut_str, action);
    }
    Ok(())
}

#[tauri::command]
async fn unregister_hotkey(
    app: tauri::AppHandle,
    shortcut_str: String,
    state: State<'_, HotkeyState>,
) -> Result<(), String> {
    #[cfg(desktop)]
    {
        let shortcut = parse_shortcut(&shortcut_str).map_err(|e| e.to_string())?;
        let gs = app.global_shortcut();
        gs.unregister(shortcut)
            .map_err(|e| format!("Failed to unregister {}: {}", shortcut_str, e))?;
        state.bindings.lock().unwrap().remove(&shortcut_str);
    }
    Ok(())
}

/// Read the first `head` lines and last `tail` lines of a file efficiently.
/// Returns { head_lines, tail_lines, mtime_ms }.
#[tauri::command]
async fn read_file_head_tail(
    path: String,
    head: usize,
    tail: usize,
) -> Result<serde_json::Value, String> {
    use std::fs::File;

    let file = File::open(&path).map_err(|e| format!("Failed to open file: {e}"))?;
    let metadata = file.metadata().map_err(|e| format!("Failed to read metadata: {e}"))?;
    let mtime_ms = metadata
        .modified()
        .ok()
        .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0);
    let file_size = metadata.len();

    // Read head lines
    let mut reader = BufReader::new(&file);
    let mut head_lines = Vec::with_capacity(head);
    for _ in 0..head {
        let mut line = String::new();
        match reader.read_line(&mut line) {
            Ok(0) => break,
            Ok(_) => head_lines.push(line.trim_end_matches('\n').trim_end_matches('\r').to_string()),
            Err(_) => break,
        }
    }

    // Read tail lines by scanning backwards from end of file
    let mut tail_lines = Vec::new();
    if file_size > 0 && tail > 0 {
        let mut file_for_tail = File::open(&path).map_err(|e| format!("Failed to reopen: {e}"))?;
        // Read up to 64KB from the end (enough for ~10 JSONL lines)
        let chunk_size = std::cmp::min(file_size, 64 * 1024) as usize;
        let start_pos = file_size - chunk_size as u64;
        file_for_tail
            .seek(SeekFrom::Start(start_pos))
            .map_err(|e| format!("Seek failed: {e}"))?;
        let mut buf = vec![0u8; chunk_size];
        file_for_tail
            .read_exact(&mut buf)
            .map_err(|e| format!("Read failed: {e}"))?;

        // Split into lines from the end
        let text = String::from_utf8_lossy(&buf);
        let all_lines: Vec<&str> = text.lines().collect();
        // If we seeked into the middle of a line, skip the first partial line
        let skip = if start_pos > 0 { 1 } else { 0 };
        let usable = &all_lines[skip.min(all_lines.len())..];
        let start = if usable.len() > tail {
            usable.len() - tail
        } else {
            0
        };
        tail_lines = usable[start..].iter().map(|s| s.to_string()).collect();
    }

    Ok(serde_json::json!({
        "headLines": head_lines,
        "tailLines": tail_lines,
        "mtimeMs": mtime_ms,
    }))
}

/// Read the full text content of a file at any path.
#[tauri::command]
async fn read_text_file(path: String) -> Result<String, String> {
    std::fs::read_to_string(&path).map_err(|e| format!("Failed to read file: {e}"))
}

/// Open a file or folder with the OS default handler.
#[tauri::command]
async fn open_path(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path does not exist: {path}"));
    }

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("cmd")
            .args(["/c", "start", "", &path])
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open path: {e}"))?;
    }

    Ok(())
}

/// Open VSCode at the given directory.
#[tauri::command]
async fn resume_session(working_dir: String) -> Result<(), String> {
    let path = std::path::Path::new(&working_dir);
    if !path.exists() || !path.is_dir() {
        return Err(format!("Directory does not exist: {working_dir}"));
    }
    std::process::Command::new("code")
        .arg(&working_dir)
        .spawn()
        .map_err(|e| format!("Failed to open VSCode: {e}"))?;
    Ok(())
}

/// Hash a string for change detection.
fn hash_string(s: &str) -> u64 {
    let mut hasher = DefaultHasher::new();
    s.hash(&mut hasher);
    hasher.finish()
}

/// Start a background task that polls the system clipboard every 750ms.
/// On each change, emits a `clipboard:new-entry` event to the frontend.
#[tauri::command]
async fn start_clipboard_monitor(
    app: tauri::AppHandle,
    state: State<'_, ClipboardMonitorState>,
) -> Result<(), String> {
    if state.running.load(Ordering::SeqCst) {
        return Ok(()); // already running
    }
    state.running.store(true, Ordering::SeqCst);

    let running = Arc::clone(&state.running);
    let skip_next = Arc::clone(&state.skip_next);
    let last_hash = Arc::clone(&state.last_hash);

    tokio::spawn(async move {
        loop {
            if !running.load(Ordering::SeqCst) {
                break;
            }

            tokio::time::sleep(std::time::Duration::from_millis(750)).await;

            if !running.load(Ordering::SeqCst) {
                break;
            }

            // Read clipboard text
            let text = {
                match arboard::Clipboard::new() {
                    Ok(mut cb) => cb.get_text().ok(),
                    Err(_) => None,
                }
            };

            if let Some(content) = text {
                if content.is_empty() || content.len() > 100_000 {
                    continue;
                }

                let new_hash = hash_string(&content);
                let mut hash_guard = last_hash.lock().unwrap();

                if new_hash != *hash_guard {
                    *hash_guard = new_hash;

                    // Check if we should skip (we wrote this ourselves)
                    if skip_next.swap(false, Ordering::SeqCst) {
                        continue;
                    }

                    let _ = app.emit("clipboard:new-entry", serde_json::json!({
                        "content": content,
                        "contentType": "text",
                    }));
                }
            }
        }
    });

    Ok(())
}

/// Stop the clipboard monitor background task.
#[tauri::command]
async fn stop_clipboard_monitor(
    state: State<'_, ClipboardMonitorState>,
) -> Result<(), String> {
    state.running.store(false, Ordering::SeqCst);
    Ok(())
}

/// Write text to the system clipboard (for re-copying entries).
/// Sets the skip_next flag so the monitor doesn't re-detect this write.
#[tauri::command]
async fn write_clipboard(
    text: String,
    state: State<'_, ClipboardMonitorState>,
) -> Result<(), String> {
    state.skip_next.store(true, Ordering::SeqCst);

    // Update last_hash to match what we're writing
    let new_hash = hash_string(&text);
    {
        let mut hash_guard = state.last_hash.lock().unwrap();
        *hash_guard = new_hash;
    }

    let mut cb = arboard::Clipboard::new().map_err(|e| format!("Clipboard error: {e}"))?;
    cb.set_text(&text).map_err(|e| format!("Failed to write clipboard: {e}"))?;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let hotkey_state = HotkeyState {
        bindings: Mutex::new(HashMap::new()),
    };

    // Populate with defaults
    {
        let mut map = hotkey_state.bindings.lock().unwrap();
        map.insert("Ctrl+N".to_string(), "new-note".to_string());
        map.insert("Ctrl+H".to_string(), "toggle-visibility".to_string());
        map.insert("Ctrl+J".to_string(), "toggle-collapse".to_string());
        map.insert("Ctrl+Shift+D".to_string(), "hide-children".to_string());
        map.insert("Ctrl+,".to_string(), "opacity-decrease".to_string());
        map.insert("Ctrl+.".to_string(), "opacity-increase".to_string());
        map.insert("Ctrl+Shift+V".to_string(), "toggle-clipboard".to_string());
        map.insert("Ctrl+Shift+T".to_string(), "reopen-last-closed".to_string());
    }

    let clipboard_state = ClipboardMonitorState {
        running: Arc::new(AtomicBool::new(false)),
        skip_next: Arc::new(AtomicBool::new(false)),
        last_hash: Arc::new(Mutex::new(0)),
    };

    let window_group_state = window_group::WindowGroupState::default();
    let session_watcher_state = session_watcher::SessionWatcherState::default();

    tauri::Builder::default()
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .plugin(tauri_plugin_process::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(hotkey_state)
        .manage(clipboard_state)
        .manage(window_group_state)
        .manage(session_watcher_state)
        .invoke_handler(tauri::generate_handler![
            open_path,
            read_text_file,
            resume_session,
            read_file_head_tail,
            register_hotkey,
            unregister_hotkey,
            start_clipboard_monitor,
            stop_clipboard_monitor,
            write_clipboard,
            window_group::group_windows,
            window_group::ungroup_window,
            window_group::ungroup_all,
            window_group::ungroup_group,
            window_group::list_groups,
            window_group::prevent_maximize,
            session_watcher::start_session_watcher,
            session_watcher::stop_session_watcher
        ])
        .setup(|app| {
            #[cfg(desktop)]
            {
                let app_handle = app.handle().clone();

                // Register the plugin with a handler that dispatches based on which shortcut fired
                app.handle().plugin(
                    tauri_plugin_global_shortcut::Builder::new()
                        .with_handler(move |app, shortcut, event| {
                            // Only act on key-down, not key-up
                            if event.state() != ShortcutState::Pressed {
                                return;
                            }

                            let state = app.state::<HotkeyState>();
                            let bindings = state.bindings.lock().unwrap();

                            // Find which action this shortcut maps to
                            for (shortcut_str, action) in bindings.iter() {
                                if let Ok(registered) = parse_shortcut(shortcut_str) {
                                    if shortcut == &registered {
                                        let event_name = format!("hotkey:{}", action);
                                        if let Err(e) = app.emit(&event_name, ()) {
                                            eprintln!(
                                                "[hoverpad] failed to emit {}: {e}",
                                                event_name
                                            );
                                        }
                                        return;
                                    }
                                }
                            }
                        })
                        .build(),
                )?;

                // Register each default shortcut individually, logging warnings on failure
                let gs = app_handle.global_shortcut();
                let default_shortcuts = [
                    ("Ctrl+N", "new-note"),
                    ("Ctrl+H", "toggle-visibility"),
                    ("Ctrl+J", "toggle-collapse"),
                    ("Ctrl+Shift+D", "hide-children"),
                    ("Ctrl+,", "opacity-decrease"),
                    ("Ctrl+.", "opacity-increase"),
                    ("Ctrl+Shift+V", "toggle-clipboard"),
                    ("Ctrl+Shift+T", "reopen-last-closed"),
                    ("Ctrl+Shift+1", "workspace-1"),
                    ("Ctrl+Shift+2", "workspace-2"),
                    ("Ctrl+Shift+3", "workspace-3"),
                    ("Ctrl+Shift+4", "workspace-4"),
                    ("Ctrl+Shift+5", "workspace-5"),
                ];

                for (shortcut_str, _action) in &default_shortcuts {
                    if let Ok(shortcut) = parse_shortcut(shortcut_str) {
                        if let Err(e) = gs.register(shortcut) {
                            eprintln!("[hoverpad] failed to register {}: {e}", shortcut_str);
                        }
                    }
                }
            }

            // When the main window is closed, close all other windows and exit
            let handle = app.handle().clone();
            let main_window = app
                .get_webview_window("main")
                .expect("main window not found");

            main_window.on_window_event(move |event| {
                if let tauri::WindowEvent::CloseRequested { .. } = event {
                    // Close all other webview windows, then exit the process
                    for (label, window) in handle.webview_windows() {
                        if label != "main" {
                            let _ = window.destroy();
                        }
                    }
                    handle.exit(0);
                }
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
