# P7-07: Note Ticket Status Labels

## Status: Complete

## Changes
- NoteList subscribes to `columns` from global store
- NoteRow receives columns data, looks up ticket's column name
- Ticket badge now shows "Column · Ticket Title" (e.g., "In Progress · Fix bug")

## Files Modified
- `src/components/NoteList.tsx`
