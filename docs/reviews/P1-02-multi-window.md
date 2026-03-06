# Review: P1-02 — Multi-Window Infrastructure

**Reviewer:** code-reviewer agent
**Date:** 2026-03-07
**Verdict:** pass

---

## Build Status

| Step | Result |
|------|--------|
| `npm run build` (`tsc -b && vite build`) | PASS — 61 modules, 1.94s, no errors or warnings |
| `cargo check` (src-tauri) | PASS — clean compilation, no warnings |

Both frontend and Rust compile cleanly with the multi-window code included.

---

## Test Results

| # | Test | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | Main window has buttons that spawn new windows | "New Note" and "New Session" buttons in ControlPanel | `handleNewNote` and `handleNewSession` call `createNoteWindow` / `createSessionWindow` with timestamped IDs | PASS |
| 2 | New windows open as separate OS-level windows (transparent, frameless, always-on-top) | Windows created with `transparent: true`, `decorations: false`, `shadow: false`, `alwaysOnTop: true` | `windowManager.ts` line 45-48 passes all four properties to `WebviewWindow` constructor | PASS |
| 3 | Windows can be closed individually | Each child window has a close button | `NoteWindow.tsx` and `SessionWindow.tsx` both have `handleClose` that calls `appWindow.close()` | PASS |
| 4 | React Router renders different content based on URL path | `/` = ControlPanel, `/note/:id` = NoteWindow, `/session/:id` = SessionWindow | `App.tsx` configures `BrowserRouter` with three `Route` entries matching these paths | PASS |
| 5 | Tauri events can be sent between windows | Cross-window emit/listen works | `events.ts` provides typed `emitEvent`/`listenEvent` wrappers around Tauri `emit`/`listen`. NoteWindow and SessionWindow emit `test:ping` events. ControlPanel listens for all event types and displays them in the event log. | PASS |
| 6 | Closing main window closes all child windows | `on_window_event` handler on main window closes all windows | `lib.rs` lines 78-90: attaches `CloseRequested` handler to main window, iterates all `webview_windows()` and closes each | PASS |

---

## Issues Found

### Minor

1. **Window stacking offset resets on reload**
   `windowCounter` in `windowManager.ts` is a module-level variable that resets to 0 when the Control Panel window reloads. If the user opens 3 windows, reloads the Control Panel, then opens another, it will overlap the first window position. Acceptable for Phase 1 since window state persistence is not in scope yet.

2. **No duplicate window guard for same note/session ID after re-creation**
   `createWindow` checks for existing windows by label and focuses them, which is correct. However, the ControlPanel generates IDs with `Date.now()` so there is no mechanism to reopen a previously-closed note window. This is expected behaviour for the placeholder implementation.

3. **`getCurrentWebviewWindow()` called at module level in NoteWindow/SessionWindow**
   `const appWindow = getCurrentWebviewWindow()` is called at the component body level (not inside a hook or callback). In React 19 with StrictMode, the component body runs twice during development. This is harmless since `getCurrentWebviewWindow()` is idempotent (returns the same window handle), but it would be slightly cleaner inside a `useMemo`. Not blocking.

### Style

4. **Consistent use of `cn()` utility**
   All three page components use the `cn()` utility for class merging. Consistent and correct.

---

## ADR Compliance

### ADR-008: Tauri v2 Overlay Windows

| Requirement | Status | Notes |
|-------------|--------|-------|
| Dynamic window creation via `WebviewWindow` (JS) | PASS | `windowManager.ts` uses `new WebviewWindow()` with config |
| Unique label per window | PASS | Labels are `note-{id}` / `session-{id}` with timestamp-based IDs |
| `transparent: true` on child windows | PASS | Passed in `createWindow` config |
| `decorations: false` on child windows | PASS | Passed in `createWindow` config |
| `shadow: false` on child windows | PASS | Passed in `createWindow` config |
| `alwaysOnTop: true` on child windows | PASS | Passed in `createWindow` config |
| Cross-window events via `emit`/`listen` | PASS | Typed wrapper in `events.ts` |
| Single SPA with URL-based routing | PASS | `BrowserRouter` with `Routes` in `App.tsx` |
| Closing Control Panel closes all windows | PASS | `on_window_event` handler in `lib.rs` |
| `tauri-plugin-window-state` NOT used | PASS | Not present |
| Capabilities for window creation declared | PASS | `default.json` includes `core:window:allow-create`, `core:webview:allow-create-webview-window` |

### ADR-002: State Management (Zustand)

Not directly applicable to this task. No Zustand stores were created, which is correct -- P1-02 is infrastructure only. The cross-window event system (`events.ts`) provides the foundation that the future `tauriSync` middleware will build on.

---

## Inter-Task Integration

ControlPanel.tsx successfully imports and uses modules from all three parallel tasks:
- `windowManager.ts` (P1-02)
- `events.ts` (P1-02)
- `database.ts` (P1-04)

The hotkey listeners in `App.tsx` (P1-03) coexist cleanly with the routing setup (P1-02). No conflicts detected.

---

## Summary

The multi-window infrastructure is well-implemented. The `windowManager.ts` module cleanly encapsulates window creation with proper ADR-008 config. The `events.ts` module provides a typed event system with good TypeScript ergonomics. The routing in `App.tsx` correctly dispatches based on URL path. The main-window-closes-all-windows behaviour is implemented in Rust with proper error handling. All six acceptance criteria are met.

**Verdict: PASS**
