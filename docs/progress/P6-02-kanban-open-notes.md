# P6-02: Open Notes from Kanban Cards

## Objective
Allow users to click on linked note titles directly from kanban cards to open them, replacing the static "2 notes" count badge.

## Scope

### KanbanCard Changes
- Replaced static `{linkedNotes.length} note(s)` badge with individual clickable note title buttons
- Each button shows the note title (truncated to 140px), triggers `onOpenNote(noteId)`
- Clicking a note title calls `setNoteOpen()` + `createNoteWindow()` + `refreshNotes()`

### Prop Threading
- Added `onOpenNote: (noteId: string) => void` callback prop to `KanbanCard`, `KanbanColumn`, and `KanbanBoard`
- `KanbanBoard` implements `handleOpenNote` which opens the note window and refreshes state

## Files Modified
| File | Changes |
|------|---------|
| `src/components/kanban/KanbanCard.tsx` | Added `onOpenNote` prop, replaced note count with clickable title buttons |
| `src/components/kanban/KanbanColumn.tsx` | Added `onOpenNote` prop, passed to `KanbanCard` |
| `src/components/kanban/KanbanBoard.tsx` | Added `handleOpenNote` callback, passed to `KanbanColumn` |

## Acceptance Criteria
1. Kanban cards show individual note titles instead of a count
2. Clicking a note title opens it in a new window
3. "Create linked note" button still works alongside note titles
4. TypeScript compiles clean

## Status
complete
