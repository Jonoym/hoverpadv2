# P6-03: NoteList Ticket Label Cleanup

## Objective
Simplify the NoteList by removing the link/unlink ticket controls. Notes are linked to tickets via the kanban board's "create linked note" flow — the NoteList just displays the ticket badge.

## Scope

### Removed Elements
- **Link dropdown** (`<select>` with ticket options): Users were confused by being able to link from the NoteList
- **"Unlink" button**: Removed alongside the dropdown
- Removed `linkNoteToTicket` and `unlinkNote` imports
- Removed `refreshTickets` from the store subscription (no longer needed)

### Preserved
- Purple ticket title badge still renders when `note.ticketId` is set

## Files Modified
| File | Changes |
|------|---------|
| `src/components/NoteList.tsx` | Removed link/unlink imports, handlers, dropdown UI, and unlink button |

## Acceptance Criteria
1. No link/unlink controls visible in NoteList
2. Ticket badge still displays for linked notes
3. TypeScript compiles clean

## Status
complete
