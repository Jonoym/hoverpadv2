# P3-02: Zustand Global Store + Cross-Window Sync

## Objective
Implement the Zustand-based state management architecture per ADR-002. Create a global store that syncs across all Tauri windows via emit/listen events, and a local store for per-window state.

## Scope

### Global Store (`src/stores/globalStore.ts`)
- Notes state: list of note metadata (synced from SQLite)
- Sessions state: list of session metadata (placeholder for Phase 4)
- Tickets state: list of ticket metadata (placeholder for Phase 3 kanban)
- Actions: `refreshNotes()`, `refreshSessions()`, `refreshTickets()`
- Derives counts: `openNoteCount`, `activeSessionCount`

### Cross-Window Sync Middleware (`tauriSync`)
- Custom Zustand middleware that:
  - On store update: emits a `store:sync` Tauri event with the changed slice
  - On receiving `store:sync` event: merges the payload into local store
  - Prevents echo loops (tag events with sender window label)
- Use Tauri's `emit()` to broadcast and `listen()` to receive
- Each window runs the same store code — middleware keeps them in sync

### Local Store (`src/stores/localStore.ts`)
- Per-window state: scroll position, editor state, window geometry
- NOT synced across windows — local to each webview
- Used by NoteWindow for editor-specific state

### Integration
- Replace direct `listNotes()` calls in ControlPanel/NoteList with store selectors
- ControlPanel subscribes to global store for note/session counts
- NoteWindow uses local store for editor state

## Out of Scope
- Offline/conflict resolution
- Persistence of store state (SQLite is the source of truth)

## Acceptance Criteria
1. Global store exists with notes, sessions, tickets slices
2. `tauriSync` middleware broadcasts changes across windows
3. Creating a note in one window updates the note list in Control Panel
4. Closing a note window updates `isOpen` status in Control Panel's note list
5. Local store exists for per-window state
6. No echo loops in sync middleware

## Status
complete

## Review
PASS — [review](../reviews/P3-01-02-panel-and-store.md)
