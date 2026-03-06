# P2-04: Note Listing in Control Panel

## Objective
Display a list of all notes in the Control Panel, allowing users to open existing notes and delete notes. Replaces the current event-log-only view with a functional note management interface.

## Scope

### Note List Component
- New `NoteList` component in `src/components/NoteList.tsx`
- Fetches all notes via `listNotes()` from noteService on mount
- Displays notes sorted by `updated_at` (most recent first)
- Each note row shows: title, created date (relative: "2 min ago"), and open/delete actions

### Note List Item UI
- Each row: note title (truncated), relative timestamp, action buttons
- "Open" button: calls `setNoteOpen(id, true)` + `createNoteWindow(id)`
- "Delete" button: calls `deleteNote(id)` and removes from the list
- If note is already open (`isOpen: true`), show "Focus" instead of "Open" — focuses the existing window
- Subtle styling consistent with the app's dark theme (neutral-800 cards, hover states)

### Control Panel Integration
- Replace the event log section with the note list (or show both — notes above, event log below collapsed)
- Keep the "New Note" and "New Session" buttons at the top
- Note list should auto-refresh when a note is created or deleted

### Refresh on Events
- Listen for `window:closed` events to update the `isOpen` status in the list
- After creating a note (via button or Ctrl+N), refresh the list
- Use a simple state-based approach (no Zustand yet — that's Phase 3)

## Out of Scope
- Search/filter (Phase 3 — Control Panel)
- Kanban integration (Phase 3)
- Drag-and-drop reordering (Phase 3)

## Acceptance Criteria
1. Control Panel shows a list of all notes with title and timestamp
2. Clicking "Open" on a note opens it in a note window
3. Clicking "Delete" removes the note (file + SQLite row) and updates the list
4. Creating a new note adds it to the list immediately
5. Notes are sorted by most recently updated
6. Already-open notes show "Focus" instead of "Open"

## Status
complete

## Review
[P2-03-04-auto-save-and-listing](../reviews/P2-03-04-auto-save-and-listing.md) — PASS
