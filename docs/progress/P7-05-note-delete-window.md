# P7-05: Note Deletion Closes Window

## Status: Complete

## Problem
Deleting a note from the Control Panel left the note window open, causing save failures.

## Fix
`handleDelete` in NoteList now:
1. Closes the window via `WebviewWindow.getByLabel(`note-${note.id}`)`
2. Sets note as not open via `setNoteOpen(note.id, false)`
3. Deletes the note via `deleteNote(note.id)`

## Files Modified
- `src/components/NoteList.tsx`
