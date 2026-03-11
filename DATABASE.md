# Hoverpad Database Schema

SQLite database stored at `~/hoverpad/hoverpad.db`. Uses WAL journal mode with foreign keys enabled.

Schema is managed via idempotent migrations in `src/lib/database.ts`.

## Tables

### kanban_columns

Configurable kanban board columns. Seeded with defaults on first run.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | e.g. `backlog`, `in_progress`, `review`, `done` |
| name | TEXT | NOT NULL | Display name (e.g. "To Do") |
| sort_order | INTEGER | NOT NULL | Column position |
| created_at | TEXT | NOT NULL, DEFAULT now | ISO datetime |

**Default seeds:** `backlog` → "To Do", `in_progress` → "In Progress", `review` → "Review", `done` → "Done"

---

### tickets

Kanban cards.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| title | TEXT | NOT NULL | |
| description | TEXT | | Markdown body |
| column_id | TEXT | NOT NULL, FK → kanban_columns(id) | Current column |
| column_order | INTEGER | NOT NULL, DEFAULT 0 | Position within column |
| due_date | TEXT | | ISO date |
| archived | INTEGER | NOT NULL, DEFAULT 0 | 1 = archived |
| expanded | INTEGER | NOT NULL, DEFAULT 0 | Persists card expand/collapse state |
| created_at | TEXT | NOT NULL, DEFAULT now | |
| updated_at | TEXT | NOT NULL, DEFAULT now | |

---

### ticket_checklist_items

Checklist items on a ticket (separate from description).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| ticket_id | TEXT | NOT NULL, FK → tickets(id) ON DELETE CASCADE | |
| label | TEXT | NOT NULL | Checklist item text |
| checked | INTEGER | NOT NULL, DEFAULT 0 | 1 = checked |
| sort_order | INTEGER | NOT NULL, DEFAULT 0 | |
| created_at | TEXT | NOT NULL, DEFAULT now | |

---

### ticket_tags

User-defined labels/tags. Shared across tickets and notes.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| name | TEXT | NOT NULL, UNIQUE | Tag display name |
| color | TEXT | NOT NULL, DEFAULT 'neutral' | Color key |

---

### ticket_tag_members

Many-to-many: tickets ↔ tags.

| Column | Type | Constraints |
|--------|------|-------------|
| ticket_id | TEXT | NOT NULL, FK → tickets(id) ON DELETE CASCADE |
| tag_id | TEXT | NOT NULL, FK → ticket_tags(id) ON DELETE CASCADE |

**Primary key:** (ticket_id, tag_id)

---

### notes

Metadata index for markdown note files stored on disk at `~/hoverpad/notes/`.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| title | TEXT | NOT NULL | Extracted from frontmatter/filename |
| file_path | TEXT | NOT NULL, UNIQUE | Absolute path to `.md` file |
| preview | TEXT | DEFAULT '' | First ~100 chars of body |
| starred | INTEGER | NOT NULL, DEFAULT 0 | 1 = pinned/starred |
| is_open | INTEGER | NOT NULL, DEFAULT 0 | 1 = window currently open |
| window_state | TEXT | | JSON: `{x, y, width, height}` |
| ticket_id | TEXT | FK → tickets(id) | Legacy single-ticket link (migrated to note_tickets) |
| created_at | TEXT | NOT NULL, DEFAULT now | |
| updated_at | TEXT | NOT NULL, DEFAULT now | |

---

### notes_fts

Full-text search index for notes (FTS5, porter + unicode61 tokenizer).

| Column | Type | Notes |
|--------|------|-------|
| note_id | TEXT | UNINDEXED, matches notes(id) |
| title | TEXT | Indexed for search |

---

### note_tag_members

Many-to-many: notes ↔ tags (reuses ticket_tags).

| Column | Type | Constraints |
|--------|------|-------------|
| note_id | TEXT | NOT NULL, FK → notes(id) ON DELETE CASCADE |
| tag_id | TEXT | NOT NULL, FK → ticket_tags(id) ON DELETE CASCADE |

**Primary key:** (note_id, tag_id)

---

### note_tickets

Many-to-many: notes ↔ tickets.

| Column | Type | Constraints |
|--------|------|-------------|
| note_id | TEXT | NOT NULL, FK → notes(id) ON DELETE CASCADE |
| ticket_id | TEXT | NOT NULL, FK → tickets(id) ON DELETE CASCADE |

**Primary key:** (note_id, ticket_id)

---

### session_groups

Groups of Claude Code sessions. Two types: auto-created project groups and user-created manual groups.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| name | TEXT | NOT NULL | Display name (last path segment for projects) |
| group_type | TEXT | NOT NULL, CHECK IN ('project', 'manual') | |
| project_dir | TEXT | | Working directory (project groups only) |
| sort_order | INTEGER | NOT NULL, DEFAULT 0 | User-defined order |
| is_open | INTEGER | NOT NULL, DEFAULT 0 | 1 = group window currently open |
| window_state | TEXT | | JSON: `{x, y, width, height}` |
| created_at | TEXT | NOT NULL, DEFAULT now | |

---

### sessions

Claude Code CLI sessions. Discovered from `~/.claude/projects/<encoded-path>/<session-id>.jsonl` log files, then indexed here.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | Session UUID (matches JSONL filename) |
| pid | INTEGER | | OS process ID (if available) |
| label | TEXT | DEFAULT NULL | User-defined display name |
| started_at | TEXT | NOT NULL, DEFAULT now | |
| ended_at | TEXT | | |
| status | TEXT | NOT NULL, DEFAULT 'active', CHECK IN ('active', 'completed', 'errored') | DB status; runtime adds 'idle', 'idle-agents', 'inactive' |
| working_dir | TEXT | | Absolute path to project directory |
| project_group_id | TEXT | FK → session_groups(id) | Auto-assigned project group |
| manual_group_id | TEXT | FK → session_groups(id) | Legacy single-group link (migrated to session_group_members) |
| ticket_id | TEXT | FK → tickets(id) | Legacy single-ticket link (migrated to session_tickets) |
| last_user_message | TEXT | DEFAULT NULL | Cached last user prompt (truncated, from log tail) |
| is_open | INTEGER | NOT NULL, DEFAULT 0 | 1 = session window currently open |
| window_state | TEXT | | JSON: `{x, y, width, height}` |

**Runtime-only statuses** (not stored in DB): `idle`, `idle-agents`, `inactive` — derived from time elapsed and window state.

---

### session_events

Parsed events from Claude Code JSONL logs. Currently defined but not actively written to (events are parsed on-the-fly from log files).

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| session_id | TEXT | NOT NULL, FK → sessions(id) | |
| timestamp | TEXT | NOT NULL, DEFAULT now | |
| event_type | TEXT | NOT NULL, CHECK IN ('tool_call', 'tool_result', 'progress', 'turn_complete', 'status_change') | |
| tool_name | TEXT | | e.g. "Read", "Edit", "Bash" |
| payload | TEXT | | JSON blob |

---

### session_group_members

Many-to-many: sessions ↔ manual groups.

| Column | Type | Constraints |
|--------|------|-------------|
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE |
| group_id | TEXT | NOT NULL, FK → session_groups(id) ON DELETE CASCADE |

**Primary key:** (session_id, group_id)

---

### session_tickets

Many-to-many: sessions ↔ tickets.

| Column | Type | Constraints |
|--------|------|-------------|
| session_id | TEXT | NOT NULL, FK → sessions(id) ON DELETE CASCADE |
| ticket_id | TEXT | NOT NULL, FK → tickets(id) ON DELETE CASCADE |

**Primary key:** (session_id, ticket_id)

---

### log_files

Arbitrary JSONL log files added by the user for viewing.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| path | TEXT | NOT NULL, UNIQUE | Absolute file path |
| label | TEXT | | User-defined display name |
| is_open | INTEGER | NOT NULL, DEFAULT 0 | 1 = window currently open |
| window_state | TEXT | | JSON: `{x, y, width, height}` |
| added_at | TEXT | NOT NULL, DEFAULT now | |

---

### clipboard_entries

Clipboard history.

| Column | Type | Constraints | Notes |
|--------|------|-------------|-------|
| id | TEXT | PRIMARY KEY | UUID |
| content | TEXT | NOT NULL | Full clipboard content |
| content_type | TEXT | NOT NULL, DEFAULT 'text' | |
| preview | TEXT | NOT NULL, DEFAULT '' | Truncated preview |
| pinned | INTEGER | NOT NULL, DEFAULT 0 | 1 = pinned to top |
| copied_at | TEXT | NOT NULL, DEFAULT now | |

**Index:** `idx_clipboard_entries_copied_at` on `copied_at DESC`

---

### settings

Key-value store for user preferences, window order, hotkey bindings, etc.

| Column | Type | Constraints |
|--------|------|-------------|
| key | TEXT | PRIMARY KEY |
| value | TEXT | NOT NULL |

---

## Relationships

```
kanban_columns 1──* tickets
tickets        *──* ticket_tags       (via ticket_tag_members)
tickets        1──* ticket_checklist_items
tickets        *──* sessions          (via session_tickets)
tickets        *──* notes             (via note_tickets)
notes          *──* ticket_tags       (via note_tag_members)
session_groups 1──* sessions          (via project_group_id)
session_groups *──* sessions          (via session_group_members)
```

## Storage

- **Database file:** `~/hoverpad/hoverpad.db`
- **Note files:** `~/hoverpad/notes/YYYY-MM-DD-XXXXXXXX.md` (YAML frontmatter + markdown)
- **Session logs:** `~/.claude/projects/<encoded-path>/<session-id>.jsonl` (read-only, owned by Claude Code CLI)
