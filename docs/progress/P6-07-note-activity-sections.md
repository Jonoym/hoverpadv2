# P6-07: Note Activity Sections

## Objective
Organize the NoteList into meaningful sections based on note activity and importance, replacing the flat chronological list.

## Scope

### Database Migration
- Added `starred INTEGER NOT NULL DEFAULT 0` column to the `notes` table via idempotent `ALTER TABLE` (try/catch)

### noteService Changes
- Added `starred: boolean` to `NoteMeta` and `starred: number` to `NoteRow`
- Added `toggleNoteStarred(id)` function that flips the `starred` flag in SQLite
- Updated `rowToMeta()` to map the new column

### NoteList Sections
Notes are categorized into four sections:

1. **Starred** — Notes with `starred === true`. Always displayed at top above a subtle divider. Star icon toggle on every row.
2. **Open** — Notes with `isOpen === true` (currently in a window). Not starred.
3. **Recent** — Notes updated within the last 7 days, not open, not starred.
4. **Inactive** — Notes older than 7 days, not open, not starred. Collapsed by default.

Each section has:
- Collapsible header with chevron icon + title + count
- Independent open/closed state tracked in `openSections` record
- Sections with 0 notes are hidden entirely

### Star Toggle
- Every note row shows a star icon (★ filled / ☆ outline)
- Clicking toggles starred status via `toggleNoteStarred()` + `refreshNotes()`
- Starring a note moves it to the Starred section; unstarring moves it back

## Files Modified
| File | Changes |
|------|---------|
| `src/lib/database.ts` | Added `ALTER TABLE notes ADD COLUMN starred` migration |
| `src/lib/noteService.ts` | Added `starred` field, `toggleNoteStarred()` function |
| `src/components/NoteList.tsx` | Complete rewrite with `SectionHeader`, `NoteRow` sub-components, activity categorization, and star toggle |

## Acceptance Criteria
1. Notes appear in correct sections based on starred/open/recent/inactive status
2. Star toggle works and moves notes between sections
3. Section headers are collapsible with counts
4. Inactive section is collapsed by default
5. Empty sections are hidden
6. TypeScript compiles clean

## Status
complete
