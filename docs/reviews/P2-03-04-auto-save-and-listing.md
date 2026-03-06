# P2-03 & P2-04: Auto-save and Note Listing — Review

## Verdict: PASS

## Build Verification

| Check | Result |
|-------|--------|
| `npm run build` | PASS — `tsc -b && vite build` succeeded. 766 modules transformed, dist output clean. One chunk size warning (NoteEditor at 1345 kB) is expected due to MDXEditor and is non-blocking. |
| `npx tsc --noEmit` | PASS — zero type errors. |

## P2-03: Auto-save with Debounce

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| AC1 | Editing triggers auto-save after 1s of inactivity | PASS | `handleChange` sets `isDirtyRef.current = true` and schedules `performSave` via `setTimeout` with `DEBOUNCE_MS = 1000`. |
| AC2 | Rapid typing delays the save (debounce) | PASS | Each `handleChange` call clears the previous `debounceRef.current` timer before scheduling a new one — classic debounce pattern. |
| AC3 | Ctrl+S saves immediately and cancels pending debounce | PASS | `keydown` handler cancels `debounceRef.current` and calls `performSave(id)` directly. |
| AC4 | Title bar shows "Saving..." and "Saved" indicators | PASS | `saveStatus` state drives `displayTitle` which appends " - Saving...", " - Saved", or " - Save failed" to the title passed to `WindowChrome`. Saved status auto-clears after 1.5s via `statusTimerRef`. |
| AC5 | Unsaved changes saved on window close | PASS | `handleClose` checks `isDirtyRef.current` and awaits `performSave(id)` before calling `setNoteOpen(id, false)`. The `onBeforeClose` callback in `WindowChrome` is awaited before emitting `window:closed` and closing. |
| AC6 | No duplicate saves (debounce and Ctrl+S don't race) | PASS | `isSavingRef` guard at the top of `performSave` returns early if a save is already in-flight. Ctrl+S clears the debounce timer before calling `performSave`. |

### Code Quality — P2-03

- **Timer cleanup**: Both `debounceRef` and `statusTimerRef` are cleared in the unmount effect (lines 117-122). No memory leak.
- **Ref-based debounce**: Correctly uses `useRef` instead of `useState` for the debounce timer, avoiding unnecessary re-renders and stale closures.
- **Content read at save time**: `performSave` reads markdown fresh from `editorRef.current?.getMarkdown()` rather than capturing stale content in the closure. This is the correct approach.
- **Error handling**: Save failures are logged and shown via "Save failed" indicator that auto-clears after 3s. Non-blocking to the editor.

## P2-04: Note Listing in Control Panel

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| AC1 | Control Panel shows note list with title and timestamp | PASS | `NoteList` fetches via `listNotes()`, renders each note's `title` (truncated) and relative timestamp via `timeAgo(note.updatedAt)`. |
| AC2 | "Open" opens a note window | PASS | `handleOpen` calls `setNoteOpen(note.id, true)` then `createNoteWindow(note.id)`, and updates local state to reflect `isOpen: true`. |
| AC3 | "Delete" removes file + SQLite row + updates list | PASS | `handleDelete` calls `deleteNote(note.id)` (which removes file from disk + SQLite row in noteService) then filters the note from local state. |
| AC4 | Creating a new note adds it to the list | PASS | `ControlPanel.handleNewNote` increments `refreshKey` after creating the note, which triggers `NoteList` to re-fetch. |
| AC5 | Sorted by most recently updated | PASS | `listNotes()` in noteService uses `ORDER BY updated_at DESC`. |
| AC6 | Already-open notes show "Focus" | PASS | Conditional rendering at line 138: if `note.isOpen` is true, renders "Focus" button (which calls `handleFocus` to set focus on existing window) instead of "Open". |

### Code Quality — P2-04

- **Refresh mechanism**: `refreshKey` prop is a clean, simple pattern for triggering re-fetches without Zustand (per scope: "no Zustand yet -- that's Phase 3").
- **Focus fallback**: `handleFocus` gracefully handles the case where the window no longer exists by re-opening it (line 84-86).
- **Event-driven updates**: `ControlPanel` listens for `window:closed` events and bumps `refreshKey`, which updates the `isOpen` status in the list.
- **Empty state**: Properly handled with "No notes yet" message.
- **timeAgo helper**: Well-structured with appropriate thresholds (just now, minutes, hours, days, dated).
- **Event listener cleanup**: `ControlPanel` correctly cleans up Tauri event listeners in the effect cleanup function (lines 68-72).

## Issues Found

### Blocking

None.

### Non-Blocking

1. **Chunk size warning**: The `NoteEditor` chunk is 1345 kB (447 kB gzipped). This is due to MDXEditor's large bundle. Consider code-splitting or lazy-loading strategies in a future task. Already lazy-loaded via `React.lazy`, which is the right approach; the warning is informational only.

2. **P2-04 progress file status mismatch**: `docs/progress/P2-04-note-listing.md` still says `pending` in its Status field even though the implementation is complete. Will be corrected as part of this review's progress update.

3. **No confirmation on delete**: `handleDelete` immediately deletes without user confirmation. This is acceptable for now (the scope explicitly does not mention confirmation), but consider adding a confirmation dialog in a future polish pass.

4. **Race condition edge case on close**: If `performSave` is already in-flight when the user closes the window, `handleClose` checks `isDirtyRef.current` (which was set to `false` by the in-flight save at line 70). If the user made edits *after* the in-flight save started but *before* close, the dirty flag would have been re-set by `handleChange`, so this is correctly handled. No actual issue.

5. **`nextId` module-level counter in ControlPanel**: The `nextId` counter for event log entries is a module-level `let` (line 17). This is fine for a single Control Panel instance but would misbehave if the module were hot-reloaded in a way that re-ran the module without resetting state. Negligible risk.
