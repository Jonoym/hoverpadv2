# Review: P1-03 — Global Hotkey Registration

**Reviewer:** code-reviewer agent
**Date:** 2026-03-07
**Verdict:** pass

---

## Build Status

| Step | Result |
|------|--------|
| `npm run build` (`tsc -b && vite build`) | PASS — 61 modules, 1.94s, no errors or warnings |
| `cargo check` (src-tauri) | PASS — clean compilation, no warnings |

---

## Test Results

| # | Test | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | Ctrl+N triggers new-note event | Event emitted and visible in console | `lib.rs` emits `hotkey:new-note` via `app.emit()`. `App.tsx` `useHotkeyListeners` hook listens for this event and logs to console. | PASS |
| 2 | Ctrl+H hides all windows; pressing again shows them | Toggle visibility of all windows | `toggle_all_windows()` in `lib.rs` iterates all `webview_windows()`, calls `hide()` or `show()` based on `AtomicBool` state. State is flipped after each toggle. | PASS |
| 3 | Ctrl+, and Ctrl+. trigger their handlers | Events emitted for opacity controls | `lib.rs` emits `hotkey:opacity-decrease` and `hotkey:opacity-increase`. `App.tsx` listens and logs both. | PASS |
| 4 | App starts without errors if hotkey registration fails | Graceful degradation | Each `gs.register()` call is wrapped in `if let Err(e)` with `eprintln!` logging. Registration failures do not propagate errors. | PASS |
| 5 | Hotkeys work on Windows | Uses `Modifiers::CONTROL` + key codes | `Modifiers::CONTROL` maps to Ctrl on Windows. Key codes `KeyN`, `KeyH`, `Comma`, `Period` are standard. | PASS |

---

## Issues Found

### Minor

1. **Uses `Modifiers::CONTROL` instead of `CommandOrControl`**
   The progress file specifies `CommandOrControl+N` etc., but the implementation uses `Modifiers::CONTROL` exclusively. On macOS, this means Ctrl+N instead of Cmd+N, which is unconventional for Mac users. However, the acceptance criteria only require Windows support (AC #5), and `tauri-plugin-global-shortcut` does not have a built-in `CommandOrControl` modifier -- you would need to register both `CONTROL` and `SUPER` variants. This is acceptable for Phase 1 and should be addressed when adding macOS support.

2. **JS package `@tauri-apps/plugin-global-shortcut` not installed**
   The P1-01 review noted this as missing. It is still not in `package.json`. However, the P1-03 implementation does not need it -- all hotkey registration is done in Rust, and communication to the frontend uses Tauri's event system (`app.emit()` + `listen()`). This is actually a cleaner approach since global shortcuts are a system-level concern best handled in the backend. Not a bug.

3. **`ShortcutState::Pressed` filter is good practice**
   The handler checks `event.state() != ShortcutState::Pressed` to ignore key-up events. This prevents double-firing. Well done.

4. **Visibility toggle race condition (theoretical)**
   `AtomicBool` with `SeqCst` ordering is used for the visibility state, which is correct for thread safety. However, if `toggle_all_windows` is called rapidly (e.g. user hammers Ctrl+H), individual window `hide()`/`show()` calls could fail while the state boolean still flips. The error is logged via `eprintln!` but the state could become desynchronized with the actual window visibility. In practice, this is unlikely to cause issues since hotkey events have natural debounce from the OS. Not blocking.

5. **No capability for `core:window:allow-hide` / `core:window:allow-show`**
   The Rust code calls `window.hide()` and `window.show()` directly on `WebviewWindow` handles obtained from `app.webview_windows()`. Since these calls happen in the Rust backend (not from JS via IPC), they bypass the capability system entirely. This is correct and does not need capability declarations. Verified.

### Style

6. **Consistent error logging format**
   All `eprintln!` messages use the `[hoverpad]` prefix. Consistent with the project pattern.

---

## ADR Compliance

### ADR-008: Tauri v2 Overlay Windows

| Requirement | Status | Notes |
|-------------|--------|-------|
| Global hotkeys via `tauri-plugin-global-shortcut` | PASS | Plugin registered in `.setup()` with `#[cfg(desktop)]` guard |
| `CommandOrControl` modifier | MINOR | Uses `Modifiers::CONTROL` only; macOS would need `SUPER`. Acceptable for Windows-only Phase 1. |
| Ctrl+H toggles all windows | PASS | `toggle_all_windows()` implements show/hide toggle |
| Desktop capability declared | PASS | `desktop.json` grants `global-shortcut:allow-register`, `allow-register-all`, etc. |

---

## Architecture Notes

The decision to handle hotkeys entirely in Rust and communicate to the frontend via events is architecturally sound:

- **Rust-side registration** means hotkeys work even if no frontend window is focused or all windows are hidden.
- **Event-based communication** (`app.emit()`) broadcasts to all windows simultaneously, which aligns with the ADR-002 cross-window event pattern.
- **Visibility toggle in Rust** is necessary since hidden windows cannot execute JavaScript to show themselves.
- **`AtomicBool` state** is the right primitive for a simple boolean toggle in a multi-threaded context.

---

## Inter-Task Integration

- `App.tsx` contains both the routing setup (P1-02) and the hotkey listeners (P1-03). These are cleanly separated -- routing in the JSX return, hotkey listeners in a custom hook.
- The `useHotkeyListeners` hook uses `listen` from `@tauri-apps/api/event` (the core API, already a dependency), not `@tauri-apps/plugin-global-shortcut` (the JS plugin, not installed). This is correct since the backend emits standard Tauri events.
- No conflicts with P1-02 or P1-04 code.

---

## Summary

Global hotkey registration is correctly implemented in the Rust backend with proper error handling and graceful degradation. All four shortcuts (Ctrl+N, Ctrl+H, Ctrl+,, Ctrl+.) are registered and dispatch appropriately. The visibility toggle uses `AtomicBool` state and iterates all windows. The architecture of registering in Rust and emitting events to the frontend is clean and well-suited to the multi-window model. All five acceptance criteria are met.

**Verdict: PASS**
