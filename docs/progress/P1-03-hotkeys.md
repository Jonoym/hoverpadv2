# P1-03: Global Hotkey Registration

## Objective
Register global keyboard shortcuts via `tauri-plugin-global-shortcut` so the app responds to hotkeys even when not focused.

## Scope
- Register hotkeys in the Rust backend (setup hook):
  - `CommandOrControl+N` — log "new note" to console (actual note creation in Phase 2)
  - `CommandOrControl+H` — toggle visibility of all Hoverpad windows
  - `Ctrl+,` — log "decrease opacity" (actual opacity logic in Phase 5)
  - `Ctrl+.` — log "increase opacity" (actual opacity logic in Phase 5)
- Ctrl+H visibility toggle: iterate all app windows, call `hide()`/`show()` on each
- Store visibility state so toggle is consistent
- Handle hotkey registration errors gracefully (log warning, don't crash)

## Out of Scope
- Actual note creation (Phase 2)
- Opacity adjustment logic (Phase 5)
- User-configurable hotkeys (future)

## Acceptance Criteria
1. Pressing Ctrl+N while another app is focused triggers the handler (visible via console log or window spawn)
2. Pressing Ctrl+H hides all Hoverpad windows; pressing again shows them
3. Pressing Ctrl+, and Ctrl+. trigger their handlers
4. App starts without errors if a hotkey is already registered by another app
5. Hotkeys work on Windows

## Status
complete

## Review
[P1-03-hotkeys.md](../reviews/P1-03-hotkeys.md)
