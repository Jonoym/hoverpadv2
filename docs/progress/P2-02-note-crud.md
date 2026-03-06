# P2-02: Note CRUD + Hybrid Storage

## Objective
Implement full note lifecycle: create, open, edit, save, and delete notes. Notes are stored as `.md` files on disk (content source of truth) with SQLite metadata for indexing and relationships.

## Scope

### File System
- Notes directory: `~/hoverpad/notes/` (create on first use)
- Filename format: `YYYY-MM-DD-XXXXXXXX.md` (date + last 8 hex chars of UUID v7 random portion) — immutable after creation (ADR-006)
- YAML frontmatter in every note: `title`, `uuid`, `created` timestamp
- Read/write via `@tauri-apps/plugin-fs`

### SQLite Metadata
- On note creation: insert row into `notes` table with uuid, title, file_path, timestamps
- On note save: update `updated_at` in SQLite
- On note delete: delete `.md` file and SQLite row
- On note open: set `is_open = 1`, store window_state
- On note close: set `is_open = 0`

### Note Service (TypeScript)
All CRUD operations are implemented in `src/lib/noteService.ts` using Tauri's `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-sql` directly from the frontend. This avoids the complexity of Rust commands while leveraging the same underlying native APIs. File I/O and SQLite writes happen sequentially with error handling at each step.
- `createNote()` — generates UUID v7, creates .md file with frontmatter, inserts SQLite row, returns note metadata
- `saveNote(id, content)` — writes content to .md file, updates SQLite `updated_at`
- `loadNote(id)` — reads .md file content from disk, returns metadata + content
- `deleteNote(id)` — removes .md file and SQLite row
- `listNotes()` — queries SQLite for all notes, returns metadata list
- `setNoteOpen(id, isOpen)` — updates is_open flag in SQLite

### Frontend Integration
- `Ctrl+N` hotkey triggers note creation (via `hotkey:new-note` event)
- On creation: call `create_note` command → open note window with the new ID
- NoteWindow loads content via `load_note` on mount → passes to MDXEditor `setMarkdown()`
- NoteWindow title updates to match the note's title from frontmatter
- Explicit save via `Ctrl+S` within a note window (local hotkey, not global)

### Frontmatter Handling
- On create: generate frontmatter with title "Untitled Note", uuid, created timestamp
- On save: preserve existing frontmatter, update title if first H1 changed
- Parse frontmatter from loaded content to extract metadata

## Out of Scope
- Auto-save (P2-03)
- Note listing in Control Panel (P2-04)
- File watcher for external edits (future)

## Acceptance Criteria
1. Ctrl+N creates a new .md file in `~/hoverpad/notes/` and opens a note window
2. Note file has YAML frontmatter (title, uuid, created)
3. Note filename follows `YYYY-MM-DD-XXXXXXXX.md` format
4. Opening a note loads its content into MDXEditor
5. Ctrl+S in a note window saves the markdown to disk
6. SQLite `notes` table is updated on create/save/delete
7. Deleting a note removes both the file and SQLite row

## Status
complete

## Review
PARTIAL — see [review](../reviews/P2-02-note-crud.md). Two issues fixed:
1. Filename collision: now uses last 8 hex chars (random portion) + existence check before write
2. Scope updated: TypeScript-only approach documented as deliberate (no Rust commands needed)
