# ADR-006: Note Filename Strategy

## Status
**Accepted**

## Context
Hoverpad stores notes as `.md` files on disk (source of truth for content) with a SQLite metadata index. Notes are created frequently via a Ctrl+N hotkey — often before a meaningful title exists. Filenames must work on both macOS and Windows, be collision-resistant, and support external editing (VS Code, Obsidian, etc.).

## Options Considered

| Strategy | Example | Readability | Collisions | Title Changes | Platform Safety |
|----------|---------|-------------|------------|---------------|-----------------|
| 1. UUID | `a1b2c3d4-e5f6-...-.md` | Poor | Excellent | No rename needed | Excellent |
| 2. Date + title slug | `2026-03-07-project-kickoff.md` | Excellent | Weak (dedup needed) | Rename or stale | Needs sanitization |
| 3. Date + UUID short | `2026-03-07-a1b2c3d4.md` | Moderate | Very strong | No rename needed | Excellent |
| 4. Title slug only | `project-kickoff.md` | Good | Poor | Rename or stale | Needs sanitization |
| 5. Incremental ID + title | `001-project-kickoff.md` | Good | Strong | Rename or stale | Needs sanitization + padding |

## Decision
**Strategy 3: Date + UUID short — `2026-03-07-a1b2c3d4.md`**

## Rationale

### Title-in-filename strategies are wrong for this system
The Ctrl+N quick-note workflow creates notes *before* they have a meaningful title. Any strategy deriving the filename from the title forces one of these bad positions:
- Create with a temp name, then rename (breaks file watchers, external editors, SQLite index)
- Defer file creation until title is set (note exists in SQLite but not on disk)
- Default to "Untitled" (produces `untitled.md`, `untitled-1.md` — ugly, collision-prone)

Beyond creation, titles change. Renaming a file on disk is destructive — external editors lose their reference, git history breaks, and renames can fail (target exists, file locked).

**The filename must be immutable from creation.** Strategies 2, 4, and 5 violate this.

### Why Date + UUID short over pure UUID
Pure UUID is architecturally equivalent but discards free, useful metadata: the creation date. ISO dates sort lexicographically and are immutable at creation time, so prepending the date costs nothing and provides genuine value when browsing the notes directory.

### Handling the readability gap
The 8-character hex suffix tells the user nothing about content. Mitigations:
1. **YAML frontmatter** in every note file makes it self-describing:
   ```yaml
   ---
   title: Project Kickoff
   uuid: a1b2c3d4-e5f6-7890-abcd-ef1234567890
   created: 2026-03-07T14:32:00Z
   ---
   ```
2. **SQLite index** is the primary navigation surface (search by title, content, tags). The filesystem is the backup/interop layer.
3. Most markdown previewers (macOS Quick Look, Windows preview, VS Code) display the H1 or frontmatter title.

## Implementation Details

- **UUID version:** Use UUID v7 (timestamp-prefixed, so the first 8 hex chars encode creation time). Provides chronological ordering within the UUID itself.
- **Truncation length:** 8 hex characters (32 bits). Collision probability within a million notes on the same day is ~1 in 8,000. For a personal note app, effectively zero.
- **Filename alphabet:** `[0-9a-f-.]` only — no sanitization needed, no platform-specific illegal characters.
- **Fixed length:** Always 21 characters (`YYYY-MM-DD-XXXXXXXX.md`) — well within any path limit.
- **SQLite schema:** `uuid` (full UUID v7, TEXT, primary key). `file_path` written once at creation, never updated.
- **File watcher reconciliation:** On startup or filesystem event, match files to SQLite rows by extracting UUID fragment from filename. New unmatched `.md` files = external creation (import). Missing files for existing rows = external deletion (tombstone or remove row).

## Consequences
- Users cannot identify a note by filename alone — must open the file or use the app's UI
- Filenames are stable forever — no rename cascades, no broken references
- Zero cross-platform edge cases — no slug sanitization, no Windows reserved name handling
- External tools (Obsidian, VS Code) can read notes via frontmatter metadata
