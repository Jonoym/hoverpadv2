# Review: P5-01 -- Global Opacity Controls + Click-Through & P5-02 -- Window State Persistence

**Reviewer:** Claude (automated)
**Date:** 2026-03-07
**Verdict:** PASS

---

## Build Verification

| Check | Result |
|-------|--------|
| `npm run build` | PASS -- compiles cleanly (no errors; pre-existing chunk-size warning from NoteEditor bundle) |
| `npx tsc --noEmit` | PASS -- zero type errors |

---

## P5-01: Global Opacity Controls + Click-Through

### Acceptance Criteria

| AC | Criteria | Verdict | Notes |
|----|----------|---------|-------|
| AC1 | Ctrl+, decreases opacity by 10% | PASS | Rust backend (`lib.rs` lines 26-27, 44-49) registers `Ctrl+Comma` as a global shortcut and emits `hotkey:opacity-decrease` on key-down. `App.tsx` `useHotkeyListeners()` (line 31-33) listens for this event and calls `adjustOpacity(-0.1)`. The store clamps the result to `[0.1, 1.0]` with `Math.round(... * 10) / 10` to avoid floating-point drift. |
| AC2 | Ctrl+. increases opacity by 10% | PASS | Same mechanism as AC1 in the opposite direction. `Ctrl+Period` is registered in Rust (line 27) and emits `hotkey:opacity-increase` (lines 50-55). The frontend listener (line 34-36) calls `adjustOpacity(0.1)`. The upper bound is clamped to 1.0. |
| AC3 | Opacity change is visible on all windows | PASS | `useOpacityEffect()` in `App.tsx` (lines 53-65) subscribes to the `opacity` value from the global store and applies it via `document.documentElement.style.opacity = String(opacity)` on every change. Since `App.tsx` is the root component rendered by every window (control panel, note, session), this effect runs in all windows. The CSS opacity approach affects the entire document root, which provides a uniform visual dimming effect. |
| AC4 | Windows become click-through below 20% opacity | PASS | In `useOpacityEffect()` line 62, `const isClickThrough = opacity < 0.2` evaluates to `true` when opacity is `0.1` (the only value below 0.2, given the 10% step size and 0.1 floor). Line 63 calls `appWindow.setIgnoreCursorEvents(isClickThrough)` which enables click-through. The capability `core:window:allow-set-ignore-cursor-events` is present in `default.json` (line 87). |
| AC5 | Click-through is disabled when opacity rises above 20% | PASS | The same `useOpacityEffect()` hook runs on every `opacity` change. When opacity increases from 0.1 to 0.2 (via Ctrl+.), `opacity < 0.2` becomes `false`, and `setIgnoreCursorEvents(false)` is called, re-enabling mouse interaction. |
| AC6 | Opacity value syncs across all windows | PASS | The `tauriSync` middleware's `syncKeys` array (globalStore.ts line 147) includes `"opacity"`. When any window's store calls `adjustOpacity()`, the wrapped `set()` detects the opacity key changed and emits a `store:sync` event to all other windows. Receiving windows merge the patch into their local store, which triggers `useOpacityEffect()` to re-apply the CSS and click-through state. The `isReceiving` flag in `tauriSync.ts` prevents echo loops. |

### Opacity Indicator

The `OpacityIndicator` component (App.tsx lines 71-98) shows a floating pill at the bottom-center of each window when opacity changes. Key details:

- **First-render suppression**: An `isFirstRender` ref skips the indicator on mount, so windows don't flash "Opacity: 100%" when they open.
- **Auto-hide**: A 1-second timeout hides the indicator after the last change. The timer is properly cleared on each new change and on unmount.
- **Styling**: A centered, rounded pill with `backdrop-blur-md` and semi-transparent background, consistent with the dark overlay theme.
- **Placement**: Rendered at the top level of `App.tsx` (line 111), outside the route-specific content but inside `BrowserRouter`, ensuring it appears in all window types.

### Boundary Analysis

The opacity is clamped to `[0.1, 1.0]` in both `setOpacity` and `adjustOpacity` (globalStore.ts lines 131-143). This means:

- The minimum opacity is 10% (0.1), not 0%. This prevents windows from becoming fully invisible, which is a sensible UX safeguard.
- Click-through activates at 0.1 only (the sole value below 0.2 given 10% steps). There is exactly one click-through step.
- When click-through is active, the user must use Ctrl+. (not mouse) to increase opacity back, which works because the global shortcut is registered at the OS level, not in the webview.

---

## P5-02: Window State Persistence

### Acceptance Criteria

| AC | Criteria | Verdict | Notes |
|----|----------|---------|-------|
| AC1 | Window position and size are saved to SQLite on move/resize | PASS | `windowState.ts` exports `useWindowStateSaver(id, table)` which listens to `appWindow.onMoved()` and `appWindow.onResized()` events. On each event, it debounces a call to `saveWindowState()`, which reads the current `outerPosition()` and `innerSize()` from the Tauri window API and writes a `{ x, y, width, height }` JSON string to the `window_state` TEXT column in the specified table. The `notes` table (database.ts line 71) and `sessions` table (database.ts line 98) both have the `window_state` column. |
| AC2 | On app launch, previously open notes are restored | PASS | `ControlPanel.tsx` lines 77-87 contain a `useEffect` that runs once on mount, calls `listNotes()`, and iterates over all notes with `note.isOpen === true`, calling `createNoteWindow(note.id)` for each. The `is_open` column in SQLite (persisted via `setNoteOpen()`) tracks which notes were open when the app was last running. |
| AC3 | Restored windows appear at their saved positions | PASS | `windowManager.ts` `createNoteWindow()` (lines 68-84) calls `loadWindowState(noteId, "notes")` before creating the window. `loadWindowState()` (windowState.ts lines 51-66) queries SQLite for the `window_state` JSON and parses it. The `WindowState` object is passed as `savedState` to `createWindow()`, which uses `savedState?.width ?? width`, `savedState?.x ?? 150 + offset`, etc. (lines 42-46) when constructing the `WebviewWindow`. The same pattern applies to `createSessionWindow()` (lines 90-106), which calls `loadWindowState(sessionId, "sessions")`. |
| AC4 | Windows that were closed before exit stay closed | PASS | When a note window is closed, `NoteWindow.tsx` `handleClose()` (lines 155-176) calls `setNoteOpen(id, false)`, which sets `is_open = 0` in SQLite. On the next launch, `listNotes()` returns these notes with `isOpen: false`, and the restore loop in ControlPanel (line 81) only opens notes where `note.isOpen` is `true`. Session windows do not use an `is_open` flag (sessions table lacks it), so session restoration is out of scope for this task (only notes are restored). |
| AC5 | Save is debounced to avoid excessive writes | PASS | `useWindowStateSaver()` (windowState.ts lines 83-110) uses a `debounceRef` with a 2-second delay (`SAVE_DEBOUNCE_MS = 2000`, line 72). Each move/resize event clears the existing timer and sets a new one. Only the last event in a 2-second window triggers an actual `saveWindowState()` call. The timer is properly cleaned up on unmount via the `useEffect` return function. |

### Integration

- **NoteWindow**: Line 54 calls `useWindowStateSaver(id, "notes")`, wiring up the debounced save hook for all note windows.
- **SessionWindow**: Line 51 calls `useWindowStateSaver(sessionId, "sessions")`, providing the same persistence for session windows.
- **ControlPanel**: Does not use `useWindowStateSaver` since its collapse/expand state is managed locally (via React state and the Tauri window API). The progress doc noted that Control Panel persistence was out of scope for this task.

### Window Manager Flow

1. **Creating a window**: `createNoteWindow(noteId)` first loads saved state from SQLite, then passes it to the shared `createWindow()` function.
2. **Existing window check**: If a window with the same label already exists, `WebviewWindow.getByLabel(label)` returns it, and it is focused instead of creating a duplicate (lines 31-34).
3. **Fallback positioning**: Without saved state, windows use a cascading offset (`150 + windowCounter * 30` for both x and y), which prevents new windows from stacking exactly on top of each other.
4. **Overlay properties**: `transparent: true`, `decorations: false`, `shadow: false`, `alwaysOnTop: true` are set on every window, preserving the overlay behavior from earlier phases.

---

## Architecture Review

### P5-01 Data Flow

1. **User presses Ctrl+,** (OS-level global shortcut)
2. **Rust handler** in `lib.rs` emits `hotkey:opacity-decrease` to all windows
3. **`useHotkeyListeners`** in `App.tsx` catches the event, calls `adjustOpacity(-0.1)` on the global store
4. **`tauriSync` middleware** detects `opacity` key changed, emits `store:sync` to all windows
5. **All windows** (including the originating one) run `useOpacityEffect`, which sets CSS opacity and click-through state
6. **`OpacityIndicator`** detects the opacity change and shows a 1-second notification pill

This is a clean unidirectional flow: OS -> Rust -> JS event -> Zustand -> React effects. The sync middleware ensures all windows converge on the same opacity without any window needing to coordinate directly with another.

### P5-02 Data Flow

1. **User moves/resizes** a note or session window
2. **Tauri window events** (`onMoved`, `onResized`) fire in the hook
3. **Debounce timer** (2s) consolidates rapid changes
4. **`saveWindowState()`** reads current position/size from Tauri API, writes JSON to SQLite
5. **On next launch**, `ControlPanel` queries `listNotes()`, finds `is_open = 1` notes
6. **`createNoteWindow()`** loads the saved `window_state` JSON and passes it to the Tauri window constructor

The SQLite-as-source-of-truth pattern is consistent with the project's architecture: the database holds all persisted state, and the frontend reads from it on startup.

---

## Code Quality

### Strengths

1. **Minimal implementation footprint.** P5-01 adds only ~65 lines of new code (`useOpacityEffect`, `OpacityIndicator`, hotkey listeners, opacity slice). P5-02 adds a single ~110-line `windowState.ts` module and ~10-line hooks in each window component. No existing code was significantly restructured.

2. **Correct floating-point handling.** The `Math.round(... * 10) / 10` pattern in `adjustOpacity` prevents accumulation of floating-point errors (e.g., 0.1 + 0.1 + 0.1 !== 0.3 in IEEE 754, but rounding to one decimal place corrects this).

3. **Proper resource cleanup.** Both the opacity indicator timer (line 88) and the window state debounce timer (line 104-108) are cleared in their respective `useEffect` cleanup functions. The `onMoved`/`onResized` unlisten promises are resolved and called in the cleanup return.

4. **Defensive loading.** `loadWindowState()` returns `null` for missing or malformed JSON (try-catch around `JSON.parse`), and the window manager gracefully falls back to default positions when `savedState` is null.

5. **Consistent use of the shared `createWindow()` function.** Both `createNoteWindow` and `createSessionWindow` use the same underlying function with a `WindowConfig` interface, which was extended to accept `savedState` without changing the existing signature for callers that don't need it.

### Issues

1. **Session windows are not restored on launch.** The `ControlPanel` restore loop (lines 77-87) only restores notes with `is_open = 1`. The sessions table lacks an `is_open` column entirely, so session windows cannot be restored. The progress doc for P5-02 mentions "Same for sessions with `is_open = 1` (if applicable)" under scope, but the sessions table in `database.ts` has no `is_open` column. The implementation correctly saves session window positions (via `useWindowStateSaver` in `SessionWindow`), but cannot restore them because there is no `is_open` tracking. **Severity: Low.** The progress doc's "if applicable" qualifier makes this acceptable for now, and session windows are ephemeral by nature (tied to a running Claude Code process). This could be addressed in a future enhancement if desired.

2. **Click-through has only one step.** With the floor at 0.1 and the threshold at 0.2, there is exactly one opacity level (10%) where click-through is active. The progress doc specified "below 20%", which is correctly implemented, but users might expect a more gradual transition or a wider click-through range. **Severity: Trivial.** This is a design decision, not a bug. The spec is satisfied.

3. **No persistence of the opacity value itself.** Opacity resets to 1.0 on every app restart. If the user had set opacity to 50% before closing, they would need to press Ctrl+, five times to return to that level. Saving the opacity to localStorage or SQLite would improve the experience. **Severity: Low.** The progress doc and acceptance criteria do not mention persistence across restarts, so this is a potential enhancement, not a missing requirement.

4. **SQL injection surface in `saveWindowState`.** The `table` parameter in `saveWindowState()` is interpolated directly into the SQL query (``UPDATE ${table} SET window_state = $1 WHERE id = $2``). While the only callers pass hardcoded string literals (`"notes"` or `"sessions"`), and the TypeScript type restricts to `"notes" | "sessions"`, this pattern is worth noting. In the current codebase it is safe, but a future refactor could inadvertently introduce risk. **Severity: Trivial.** The type system prevents misuse, and parameterised table names are not supported by most SQL drivers.

5. **`useOpacityEffect` uses CSS opacity instead of Tauri's `setOpacity()`.** The comment on line 52 states "Tauri v2 has no JS setOpacity API", which is correct -- the Tauri v2 WebviewWindow JS API does not expose a `setOpacity` method. Using `document.documentElement.style.opacity` is an appropriate workaround. However, this means the window frame/shadow (if any were present) would not be affected. Since the windows are frameless and shadowless, this distinction is moot. **Severity: None.** Correct approach given the constraints.

---

## Summary

Both P5-01 and P5-02 satisfy all acceptance criteria. The opacity control system provides a clean Ctrl+,/Ctrl+. interface with 10% step increments, visual opacity applied via CSS, click-through at the lowest opacity level, a brief floating indicator for feedback, and cross-window synchronization through the existing tauriSync middleware. The window state persistence system saves position and size to SQLite on move/resize with a 2-second debounce, restores previously open note windows at their saved positions on app launch, and correctly leaves closed windows closed. The code quality is consistent with the rest of the codebase, with proper resource cleanup, defensive error handling, and minimal implementation footprint. The most actionable enhancement opportunities are persisting the opacity value across restarts and adding session window restoration, neither of which are required by the current acceptance criteria.

**Verdict: PASS**
