# P2-02: Note CRUD + Hybrid Storage -- Review

## Verdict: PARTIAL

## Build Verification
- `npm run build`: PASS -- Vite builds successfully, 765 modules transformed. NoteEditor chunk is 1,345 kB (expected for MDXEditor; already code-split via lazy loading).
- `npx tsc --noEmit`: PASS -- zero type errors.
- `cargo check`: PASS -- Rust backend compiles cleanly.

## Acceptance Criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | Ctrl+N creates a new .md file in `~/hoverpad/notes/` and opens a note window | PASS | `hotkey:new-note` event in `lib.rs` -> `App.tsx` listener -> `createNote()` + `setNoteOpen()` + `createNoteWindow()`. ControlPanel "New Note" button follows the same path. |
| 2 | Note file has YAML frontmatter (title, uuid, created) | PASS | `generateFrontmatter()` in `noteService.ts` produces `---\ntitle: Untitled Note\nuuid: ...\ncreated: ...\n---`. All three required fields present. |
| 3 | Note filename follows `YYYY-MM-DD-XXXXXXXX.md` format | PASS* | `generateFilename()` produces correct pattern (verified via regex). However, see **Blocking issue #1** -- the 8 hex chars come from the UUID v7 timestamp, not random bytes, creating a collision window. |
| 4 | Opening a note loads its content into MDXEditor | PASS | `NoteWindow` calls `loadNote(id)` on mount, sets `initialContent`, passes to `NoteEditor` via `initialMarkdown` prop. `frontmatterPlugin()` is enabled so YAML frontmatter is handled by the editor. |
| 5 | Ctrl+S in a note window saves the markdown to disk | PASS | `NoteWindow` registers a `keydown` listener for Ctrl+S, calls `editorRef.current.getMarkdown()` then `saveNote(id, markdown)`. Save status indicator in title bar ("Saved" flash). |
| 6 | SQLite `notes` table is updated on create/save/delete | PASS | `createNote()` inserts row, `saveNote()` updates `title` and `updated_at`, `deleteNote()` removes row. `setNoteOpen()` toggles `is_open`. All use parameterised queries. |
| 7 | Deleting a note removes both the file and SQLite row | PASS | `deleteNote()` reads `file_path` from SQLite, calls `remove()` on disk, then `DELETE` from DB. Note: no caller currently invokes `deleteNote()` from the UI (no delete button exists yet), but the function is implemented and correct. |

## ADR Compliance

### ADR-006 (Note Filename Strategy)
- **Format**: Correct -- `YYYY-MM-DD-XXXXXXXX.md` with 8 hex chars from UUID v7.
- **Immutability**: Correct -- filename is generated once in `createNote()` and stored in SQLite `file_path` (UNIQUE). Never updated.
- **UUID v7**: Implementation generates a v7-compatible UUID with 48-bit ms timestamp prefix and random suffix. Uses `crypto.getRandomValues()` for the random portion.
- **Frontmatter**: All three required fields present (title, uuid, created).
- **Issue**: ADR-006 says "first 8 hex characters" of the UUID, but these encode the timestamp, not random data. ADR claims "Collision probability within a million notes on the same day is ~1 in 8,000" but this assumes the 8 chars are random. In reality, any two notes created within the same ~65-second window produce **identical filenames**. See Blocking issue #1.

### ADR-008 (Tauri Windows)
- **Capabilities**: `default.json` correctly grants `fs:allow-read-text-file`, `fs:allow-write-text-file`, `fs:allow-exists`, `fs:allow-mkdir`, `fs:allow-remove` all scoped to `$HOME/hoverpad/**`. The `sql:allow-execute` and `sql:allow-select` permissions are present.
- **Window creation**: `createNoteWindow()` creates frameless, transparent, always-on-top windows consistent with ADR-008.
- **Window labels**: `note-{id}` pattern with duplicate detection (focuses existing window).

## Issues Found

### Blocking

**1. Filename collision within ~65-second window (data loss risk)**

The first 8 hex characters of a UUID v7 are derived from the millisecond timestamp (`timestamp >> 16`), meaning they only change every ~65,536 ms. Two notes created on the same day within ~65 seconds will produce **identical filenames**. Since `writeTextFile` overwrites without checking existence, the second `createNote()` call will:
1. Overwrite the first note's `.md` file content
2. Fail on the SQLite INSERT (due to `file_path UNIQUE` constraint)
3. Throw an error to the caller

Result: the first note's file content is silently replaced. The SQLite row still references the old UUID, but the file now contains the second note's frontmatter.

**Fix options (pick one):**
- Use more UUID characters in the filename (e.g., include some of the random portion): `YYYY-MM-DD-XXXXXXXX-RRRR.md` (add 4 random hex chars)
- Check `exists()` before `writeTextFile()` and regenerate or append random suffix on collision
- Reverse the order: insert SQLite first (which will fail-fast on duplicate `file_path`), then write the file

**Severity**: This is a realistic scenario -- pressing Ctrl+N twice in a minute is normal usage.

**2. Architectural deviation: no Rust commands**

The P2-02 scope explicitly specifies "Tauri Commands (Rust)" for `create_note`, `save_note`, `load_note`, `delete_note`, `list_notes`. The implementation instead puts all logic in TypeScript (`noteService.ts`) using `@tauri-apps/plugin-fs` and `@tauri-apps/plugin-sql` directly from the frontend.

This matters because:
- **No atomicity**: File write + DB insert are separate async operations. If the DB insert fails after the file write, you get an orphaned file. If the file delete fails after the DB delete, you get a dangling DB row. Rust commands could wrap both in a transaction-like flow.
- **Spec compliance**: The scope document is explicit about Rust commands.

**Assessment**: The TypeScript approach works and is functionally correct for normal usage. The atomicity concern is real but low-impact for a personal note app. However, it deviates from the stated architecture. This is blocking because it contradicts the explicit scope -- but could be unblocked by updating the scope to reflect the chosen approach if that was a deliberate decision.

### Non-Blocking

**1. No UI path to delete notes**
`deleteNote()` is implemented but no UI element calls it. This is acceptable since the acceptance criteria only require the function to exist and work correctly. A delete button will presumably come with P2-04 (Note listing in Control Panel).

**2. No save-on-close**
The `onBeforeClose` handler marks the note as closed (`is_open = 0`) but does not save unsaved content. This is explicitly out of scope (P2-03 covers auto-save), but users will lose unsaved changes if they close without Ctrl+S. Consider at minimum a "discard unsaved changes?" confirmation dialog before P2-03 lands.

**3. YAML frontmatter title not quoted**
`generateFrontmatter()` produces `title: Untitled Note` without YAML quotes. This is safe for the default title but could cause YAML parsing issues if the title were ever set to a value containing colons, leading/trailing spaces, or special YAML characters (e.g., `title: My Note: Part 2`). Since the title is only set to `"Untitled Note"` at creation and the `parseTitleFromContent` regex handles this case, this is low risk. But the `saveNote` function updates the title in SQLite from parsed content -- it does NOT rewrite frontmatter. If the user manually edits frontmatter with a colon-containing title, `parseTitleFromContent` will still extract it correctly via the regex.

**4. `loadNote` does not set `is_open = 1`**
When a note is loaded (e.g., by navigating to `/note/:id`), the `loadNote()` function doesn't set `is_open`. The callers in `App.tsx` and `ControlPanel.tsx` explicitly call `setNoteOpen(note.id, true)` after creation, but any future "reopen note" flow would need to remember to do the same. This is fine for now since there's no reopen path.

**5. ADR-006 minor typo**
ADR-006 states "Always 21 characters" for the filename `YYYY-MM-DD-XXXXXXXX.md`, but it's actually 22 characters. This is an ADR documentation error, not an implementation bug.

**6. `generateNoteId` is not a standard UUID v7**
The implementation generates a UUID-v7-like identifier using `crypto.getRandomValues()` rather than the `uuid` npm package or the Rust `uuid` crate (which is in `Cargo.toml` dependencies). The format is correct (version nibble = 7, variant bits set) but it's a custom implementation. This is acceptable but worth noting if interoperability with standard UUID libraries matters later.

## Summary

The implementation is well-structured, cleanly typed, and covers the core CRUD lifecycle. Error handling is consistent, SQL queries are parameterised, file paths are safely constructed, and the code follows the project's established patterns. The two blocking issues are:

1. **Filename collision bug** -- a real data loss risk that needs a fix before this can ship.
2. **Missing Rust commands** -- either implement them or update the scope to document the deliberate TypeScript-only approach.

Once these are addressed, this task should pass review.
