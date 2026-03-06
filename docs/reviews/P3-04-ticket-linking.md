# Review: P3-04 — Link Notes/Sessions to Tickets

**Reviewer:** Claude (automated)
**Date:** 2026-03-07
**Verdict:** PASS

---

## Build Verification

| Check | Result |
|-------|--------|
| `npm run build` | PASS — compiles cleanly (no errors, only a pre-existing chunk-size warning from the NoteEditor bundle) |
| `npx tsc --noEmit` | PASS — zero type errors |

---

## Acceptance Criteria

| AC | Criteria | Verdict | Notes |
|----|----------|---------|-------|
| AC1 | Notes can be linked to a ticket via the note list UI | PASS | `NoteList` renders a `<select>` dropdown populated from `tickets` in the global store. Selecting a ticket calls `handleLink` which invokes `linkNoteToTicket(noteId, ticketId)` and refreshes both notes and tickets. |
| AC2 | Kanban cards show linked note/session counts as badges | PASS (partial) | `KanbanCard` receives `linkedNotes` prop and displays "{count} note(s)" badge when non-empty. Session counts are not shown because sessions are still a Phase 4 placeholder — this is acceptable; session linking will be added when the session infrastructure exists. |
| AC3 | Unlinking a note clears ticket_id | PASS | `NoteList` shows an "Unlink" button when a note has a `ticketId`. Clicking calls `unlinkNote(noteId)` which executes `UPDATE notes SET ticket_id = NULL WHERE id = $1`. Both notes and tickets are refreshed after. |
| AC4 | Creating a note from a ticket card auto-links it | PASS | `KanbanCard` renders a "+ note" button (visible on hover via `group-hover:opacity-100`). Click calls `onCreateLinkedNote(ticket.id)` which flows up to `KanbanBoard.handleCreateLinkedNote`. This creates a note, links it, marks it open, opens the window, and refreshes the store — all in a single async flow. |
| AC5 | Linked items visible from both views | PASS | From the note side: `NoteList` shows a purple ticket-title badge next to linked notes. From the ticket side: `KanbanCard` shows a blue note-count badge. The `KanbanColumn` filters `notes.filter(n => n.ticketId === ticket.id)` to compute each card's linked notes. |

---

## Architecture Review

### Data Flow

The implementation follows the established patterns cleanly:

1. **Database layer** (`noteService.ts`): Three new functions — `linkNoteToTicket`, `unlinkNote`, `getLinkedNotes` — all use parameterised SQL queries. The `ticket_id` column already exists in the notes schema with a foreign key to `tickets(id)`.

2. **Store layer** (`globalStore.ts`): No changes needed. The existing `notes` array in the global store already includes `ticketId` via `rowToMeta()`. Both `refreshNotes()` and `refreshTickets()` are called after link/unlink operations to keep both views consistent.

3. **UI layer**: Link state is derived from the store at render time — `KanbanColumn` filters notes by `ticketId`, `NoteList` looks up the ticket title from the tickets array. No redundant state or caching.

4. **Cross-window sync**: Because `notes` and `tickets` are both in `syncKeys`, link/unlink operations propagate to all windows via the `tauriSync` middleware.

### `getLinkedNotes` Function

The `getLinkedNotes(ticketId)` function is exported from `noteService.ts` but not currently used by any component — `KanbanColumn` instead filters the full `notes` array from the store. This is actually the correct approach for the current scale (avoids extra DB round-trips). The function is available for future use in contexts where the full note list isn't already loaded (e.g., a ticket detail panel).

---

## Code Quality

### Strengths

1. **Consistent refresh pattern.** Both `handleLink` and `handleUnlink` in `NoteList` call `refreshNotes()` and `refreshTickets()` to keep both views synchronised. The `handleCreateLinkedNote` in `KanbanBoard` similarly refreshes notes after the multi-step create-link-open flow.

2. **Clean prop threading.** The `notes` prop flows from `KanbanBoard` (which subscribes to `store.notes`) through `KanbanColumn` (which filters per-ticket) to `KanbanCard` (which renders the badge). No prop drilling through unrelated components.

3. **Error handling.** All async handlers are wrapped in try/catch with console error logging, consistent with the rest of the codebase.

4. **UX details.** The "+ note" button on kanban cards uses `group-hover:opacity-100` to stay out of the way until needed. The unlink button in the note list uses muted purple to visually associate it with the ticket badge. `e.stopPropagation()` on the card buttons prevents accidental drag initiation.

5. **Type safety.** `KanbanCardProps` properly types `linkedNotes` as `NoteMeta[]` and `onCreateLinkedNote` as `(ticketId: string) => void`. The `NoteList` correctly uses optional chaining via `note.ticketId &&` before looking up the ticket.

### Minor Issues

1. **No ON DELETE SET NULL for ticket_id FK.** If a ticket is deleted, its linked notes will have a dangling `ticket_id` referencing a non-existent ticket row. The FK constraint in the schema doesn't specify `ON DELETE SET NULL` or `ON DELETE CASCADE`. Since `deleteTicket` in `ticketService.ts` only deletes the ticket row, orphaned `ticket_id` references will persist until manually unlinked. In practice, the `NoteList` handles this gracefully — the `tickets.find()` returns `undefined` so no badge renders — but the stale `ticket_id` value remains in SQLite. Low priority; a migration adding `ON DELETE SET NULL` or a cleanup step in `deleteTicket` would resolve this.

2. **`handleCreateLinkedNote` does not refresh tickets.** After creating a linked note, only `refreshNotes()` is called. The ticket data itself hasn't changed (no column in the tickets table is modified), so this is technically correct. However, if a future feature shows linked-note counts in a ticket detail view sourced from the tickets slice, this would need revisiting.

3. **Select dropdown could overflow.** The ticket picker `<select>` in `NoteList` has `max-w-[120px]`, which will truncate long ticket titles. This is acceptable for the current compact layout but could benefit from a tooltip or a proper combobox in a future polish pass.

4. **No empty-state for ticket picker.** If there are zero tickets, the `<select>` shows only the "Link..." placeholder with no options. It would be slightly better to hide the picker or show a tooltip like "Create tickets first" — but this is a minor UX nit.

---

## Summary

The implementation covers all five acceptance criteria. Notes can be linked and unlinked from both the note list and kanban views. Creating a note from a kanban card auto-links it. Linked items are visible from both directions — ticket badges in the note list, note-count badges on kanban cards. The session portion of AC2 is deferred to Phase 4, which is appropriate since sessions are still a placeholder. Code quality is consistent with the rest of the codebase: parameterised SQL, proper error handling, clean component decomposition, and cross-window sync. The only structural concern is the missing `ON DELETE SET NULL` on the FK, which should be addressed in a future migration but does not block this task.

**Verdict: PASS**
