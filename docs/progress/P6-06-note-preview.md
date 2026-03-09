# P6-06: Note Content Preview

## Objective
Show a short plain-text preview of each note's content in the NoteList, making it easier to distinguish between notes with similar titles.

## Scope

### Database Migration
- Added `preview TEXT DEFAULT ''` column to the `notes` table via idempotent `ALTER TABLE` (try/catch)

### noteService Changes
- Added `preview: string` field to `NoteMeta` type and `preview: string | null` to `NoteRow`
- Added `extractPreview(markdown, maxLen=100)` helper that:
  - Strips YAML frontmatter
  - Strips heading markers, bold/italic, links, images, inline code, code fences
  - Collapses whitespace
  - Truncates to 100 chars with "..." suffix
- Updated `saveNote()` to compute and store preview on each save
- Updated `rowToMeta()` to map the new column
- Updated `createNote()` to include `preview: ""` in the returned object

### NoteList UI
- Shows preview text as a truncated line below the title in neutral-500

## Files Modified
| File | Changes |
|------|---------|
| `src/lib/database.ts` | Added `ALTER TABLE notes ADD COLUMN preview` migration |
| `src/lib/noteService.ts` | Added `extractPreview()`, updated `NoteMeta`, `NoteRow`, `rowToMeta()`, `saveNote()`, `createNote()` |
| `src/components/NoteList.tsx` | Added preview line in `NoteRow` component |

## Acceptance Criteria
1. Preview column exists in SQLite (idempotent migration)
2. Saving a note updates the preview in the database
3. NoteList shows preview text below each note title
4. Preview strips markdown formatting and is ≤ 100 chars
5. TypeScript compiles clean

## Status
complete
