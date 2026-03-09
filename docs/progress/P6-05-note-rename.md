# P6-05: Inline Note Rename

## Objective
Allow users to rename notes directly from the NoteList by double-clicking the title, without needing to edit the markdown frontmatter manually.

## Scope

### noteService Changes
- Added `renameNote(id, newTitle)` function that:
  1. Reads the .md file from disk
  2. Updates the `title:` field in YAML frontmatter
  3. Writes the updated file back
  4. Updates the SQLite `title` and `updated_at` columns

### NoteList UI
- Double-click on a note title enters inline edit mode
- Shows a focused `<input>` with the current title pre-filled
- **Enter** or **blur** saves the new title (if non-empty and changed)
- **Escape** cancels without saving
- Extracted `NoteRow` as a sub-component to manage edit state per row

## Files Modified
| File | Changes |
|------|---------|
| `src/lib/noteService.ts` | Added `renameNote()` function |
| `src/components/NoteList.tsx` | Added inline rename UI with double-click trigger |

## Acceptance Criteria
1. Double-clicking a note title shows an editable input
2. Enter/blur saves the new title to both SQLite and .md frontmatter
3. Escape cancels the edit
4. Empty titles are rejected (reverts to original)
5. Title updates propagate to all views via `refreshNotes()`
6. TypeScript compiles clean

## Status
complete
