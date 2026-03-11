use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;

use notify::{EventKind, RecommendedWatcher, RecursiveMode, Watcher};
use tauri::{AppHandle, Emitter, State};

/// Managed state holding the optional file watcher handle.
/// Dropping the watcher stops it automatically.
pub struct SessionWatcherState {
    watcher: Mutex<Option<RecommendedWatcher>>,
}

impl Default for SessionWatcherState {
    fn default() -> Self {
        Self {
            watcher: Mutex::new(None),
        }
    }
}

/// Start watching `~/.claude/projects/` recursively.
/// Emits `session:file-changed` with `{ path }` whenever a `.jsonl` file
/// is created or modified. Events are naturally debounced by the OS backend.
#[tauri::command]
pub async fn start_session_watcher(
    app: AppHandle,
    state: State<'_, SessionWatcherState>,
) -> Result<(), String> {
    let mut guard = state.watcher.lock().unwrap();

    // Already watching
    if guard.is_some() {
        return Ok(());
    }

    let projects_dir = resolve_projects_dir()?;
    if !projects_dir.exists() {
        return Err(format!(
            "Claude projects directory does not exist: {}",
            projects_dir.display()
        ));
    }

    let app_handle = app.clone();

    // Track last emit time per path to debounce rapid-fire events (100ms)
    let debounce_map = std::sync::Arc::new(Mutex::new(
        std::collections::HashMap::<PathBuf, std::time::Instant>::new(),
    ));
    let debounce_dur = Duration::from_millis(100);

    let watcher = notify::recommended_watcher(move |res: notify::Result<notify::Event>| {
        let event = match res {
            Ok(e) => e,
            Err(_) => return,
        };

        // Only care about creates and modifications
        match event.kind {
            EventKind::Create(_) | EventKind::Modify(_) => {}
            _ => return,
        }

        for path in &event.paths {
            // Only .jsonl files
            let ext = path.extension().and_then(|e| e.to_str());
            if ext != Some("jsonl") {
                continue;
            }

            // Simple debounce: skip if we emitted for this path within debounce_dur
            {
                let mut map = debounce_map.lock().unwrap();
                let now = std::time::Instant::now();
                if let Some(last) = map.get(path) {
                    if now.duration_since(*last) < debounce_dur {
                        continue;
                    }
                }
                map.insert(path.clone(), now);
            }

            let path_str = path.to_string_lossy().to_string();
            let _ = app_handle.emit(
                "session:file-changed",
                serde_json::json!({ "path": path_str }),
            );
        }
    })
    .map_err(|e| format!("Failed to create file watcher: {e}"))?;

    let mut w = watcher;
    w.watch(&projects_dir, RecursiveMode::Recursive)
        .map_err(|e| format!("Failed to watch directory: {e}"))?;

    *guard = Some(w);
    Ok(())
}

/// Stop the file watcher.
#[tauri::command]
pub async fn stop_session_watcher(
    state: State<'_, SessionWatcherState>,
) -> Result<(), String> {
    let mut guard = state.watcher.lock().unwrap();
    *guard = None; // Dropping the watcher stops it
    Ok(())
}

/// Resolve `~/.claude/projects/` as an absolute path.
fn resolve_projects_dir() -> Result<PathBuf, String> {
    let home = std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map_err(|_| "Could not determine home directory".to_string())?;
    Ok(PathBuf::from(home).join(".claude").join("projects"))
}
