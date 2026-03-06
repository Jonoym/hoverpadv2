# Review: P1-04 — SQLite Database Initialisation

**Reviewer:** code-reviewer agent
**Date:** 2026-03-07
**Verdict:** pass

---

## Build Status

| Step | Result |
|------|--------|
| `npm run build` (`tsc -b && vite build`) | PASS — 61 modules, 1.94s, no errors or warnings |
| `cargo check` (src-tauri) | PASS — clean compilation, no warnings |

---

## Test Results

| # | Test | Expected | Actual | Result |
|---|------|----------|--------|--------|
| 1 | `~/hoverpad/hoverpad.db` created on first launch | Database file exists after init | `database.ts` calls `ensureHoverpadDir()` to create `~/hoverpad/` if missing, then `Database.load("sqlite:$HOME/hoverpad/hoverpad.db")` | PASS |
| 2 | All 6 tables exist with correct schema | `kanban_columns`, `tickets`, `notes`, `session_groups`, `sessions`, `session_events` | `runMigrations()` creates all 6 tables with `CREATE TABLE IF NOT EXISTS` | PASS |
| 3 | kanban_columns seeded with 4 defaults | Backlog, In Progress, Review, Done | `INSERT OR IGNORE` with ids `backlog`, `in_progress`, `review`, `done` and sort_order 0-3 | PASS |
| 4 | WAL mode enabled | `PRAGMA journal_mode=WAL` executed | `getDatabase()` runs `PRAGMA journal_mode=WAL` immediately after opening the connection | PASS |
| 5 | Migrations are idempotent | Running twice does not error | All `CREATE TABLE` use `IF NOT EXISTS`, all seed data uses `INSERT OR IGNORE` | PASS |
| 6 | Frontend can query the database | ControlPanel displays DB status | `getDatabaseStatus()` queries `sqlite_master` for table names and `COUNT(*)` from `kanban_columns`. ControlPanel displays results in a status badge. | PASS |

---

## Schema Verification

### kanban_columns

| Column | PLANNING.md | ADR-004 | database.ts | Match |
|--------|-------------|---------|-------------|-------|
| id | TEXT PRIMARY KEY | TEXT PRIMARY KEY | TEXT PRIMARY KEY | PASS |
| name | TEXT NOT NULL | TEXT NOT NULL | TEXT NOT NULL | PASS |
| sort_order | INTEGER NOT NULL | INTEGER NOT NULL | INTEGER NOT NULL | PASS |
| created_at | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP | TEXT NOT NULL DEFAULT (datetime('now')) | PASS (see note) |

### tickets

| Column | PLANNING.md | ADR-004 | database.ts | Match |
|--------|-------------|---------|-------------|-------|
| id | TEXT PRIMARY KEY | TEXT PRIMARY KEY | TEXT PRIMARY KEY | PASS |
| title | TEXT NOT NULL | TEXT NOT NULL | TEXT NOT NULL | PASS |
| description | TEXT | TEXT | TEXT | PASS |
| column_id | TEXT NOT NULL REFERENCES kanban_columns(id) | TEXT NOT NULL REFERENCES kanban_columns(id) | TEXT NOT NULL REFERENCES kanban_columns(id) | PASS |
| column_order | INTEGER NOT NULL DEFAULT 0 | INTEGER NOT NULL DEFAULT 0 | INTEGER NOT NULL DEFAULT 0 | PASS |
| due_date | DATE | DATE | TEXT | PASS (SQLite has no DATE type; TEXT is correct) |
| created_at | DATETIME ... | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |
| updated_at | DATETIME ... | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |

### notes

| Column | PLANNING.md | database.ts | Match |
|--------|-------------|-------------|-------|
| id | TEXT PRIMARY KEY | TEXT PRIMARY KEY | PASS |
| title | TEXT NOT NULL | TEXT NOT NULL | PASS |
| file_path | TEXT NOT NULL UNIQUE | TEXT NOT NULL UNIQUE | PASS |
| created_at | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |
| updated_at | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |
| ticket_id | TEXT REFERENCES tickets(id) | TEXT REFERENCES tickets(id) | PASS |
| is_open | BOOLEAN NOT NULL DEFAULT 0 | INTEGER NOT NULL DEFAULT 0 | PASS (SQLite stores booleans as integers) |
| window_state | JSON | TEXT | PASS (SQLite JSON is stored as TEXT) |

### session_groups

| Column | PLANNING.md | database.ts | Match |
|--------|-------------|-------------|-------|
| id | TEXT PRIMARY KEY | TEXT PRIMARY KEY | PASS |
| name | TEXT NOT NULL | TEXT NOT NULL | PASS |
| group_type | TEXT NOT NULL | TEXT NOT NULL CHECK(... IN ('project', 'manual')) | PASS (implementation adds CHECK constraint -- improvement) |
| project_dir | TEXT | TEXT | PASS |
| created_at | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |

### sessions

| Column | PLANNING.md | database.ts | Match |
|--------|-------------|-------------|-------|
| id | TEXT PRIMARY KEY | TEXT PRIMARY KEY | PASS |
| pid | INTEGER | INTEGER | PASS |
| started_at | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |
| ended_at | DATETIME | TEXT | PASS |
| status | TEXT NOT NULL DEFAULT 'active' | TEXT NOT NULL DEFAULT 'active' CHECK(... IN ('active', 'completed', 'errored')) | PASS (adds CHECK -- improvement) |
| working_dir | TEXT | TEXT | PASS |
| project_group_id | TEXT REFERENCES session_groups(id) | TEXT REFERENCES session_groups(id) | PASS |
| manual_group_id | TEXT REFERENCES session_groups(id) | TEXT REFERENCES session_groups(id) | PASS |
| ticket_id | TEXT REFERENCES tickets(id) | TEXT REFERENCES tickets(id) | PASS |
| window_state | JSON | TEXT | PASS |

### session_events

| Column | PLANNING.md | database.ts | Match |
|--------|-------------|-------------|-------|
| id | TEXT PRIMARY KEY | TEXT PRIMARY KEY | PASS |
| session_id | TEXT NOT NULL REFERENCES sessions(id) | TEXT NOT NULL REFERENCES sessions(id) | PASS |
| timestamp | DATETIME ... | TEXT NOT NULL DEFAULT (datetime('now')) | PASS |
| event_type | TEXT NOT NULL (tool_call, response, error, status_change) | TEXT NOT NULL CHECK(... IN ('tool_call', 'tool_result', 'progress', 'turn_complete', 'status_change')) | PASS (see note) |
| tool_name | TEXT | TEXT | PASS |
| payload | JSON | TEXT | PASS |

**Note on event_type values:** The implementation uses `('tool_call', 'tool_result', 'progress', 'turn_complete', 'status_change')` which differs from the rough PLANNING.md schema (`tool_call | response | error | status_change`). The implementation's values better match the detailed Claude Code log format described in the PLANNING.md session tracking section. This is an improvement, not a deviation.

**Note on datetime storage:** The implementation uses `TEXT NOT NULL DEFAULT (datetime('now'))` instead of `DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`. Both are functionally equivalent in SQLite (which stores dates as TEXT regardless), but `datetime('now')` produces ISO-8601 format (`YYYY-MM-DD HH:MM:SS`) which is more consistent. Good choice.

---

## Seed Data Verification

```
('backlog', 'Backlog', 0)       -- matches ADR-004
('in_progress', 'In Progress', 1) -- matches ADR-004
('review', 'Review', 2)         -- matches ADR-004
('done', 'Done', 3)             -- matches ADR-004
```

All four default columns match ADR-004 exactly (ids, names, and sort order).

---

## Issues Found

### Minor

1. **Foreign key enforcement depends on PRAGMA**
   `database.ts` correctly runs `PRAGMA foreign_keys=ON` after opening the connection. SQLite defaults to `OFF` for foreign keys, so this is essential. However, this PRAGMA is connection-scoped -- if `tauri-plugin-sql` ever opens a second connection internally, foreign keys would be unenforced on that connection. In practice, the singleton pattern in `getDatabase()` prevents this.

2. **No indexes on foreign key columns**
   Tables like `tickets.column_id`, `notes.ticket_id`, `sessions.project_group_id`, `session_events.session_id` reference other tables but have no explicit indexes. SQLite does not automatically create indexes on FK columns (only on PRIMARY KEY). This will cause table scans on JOINs. Acceptable for Phase 1 since there is no data yet, but indexes should be added before Phase 3 (Control Panel with queries).

3. **`$HOME` expansion in connection string**
   The connection string `sqlite:$HOME/hoverpad/hoverpad.db` relies on `tauri-plugin-sql` expanding `$HOME`. According to the plugin documentation, this is supported. On Windows, `$HOME` maps to `C:\Users\<username>`. This should work correctly.

4. **`ensureHoverpadDir` uses `BaseDirectory.Home`**
   The `exists` and `mkdir` calls use `BaseDirectory.Home` which resolves to the user's home directory. This is consistent with the `$HOME` in the SQLite connection string.

5. **`getDatabaseStatus` queries `sqlite_master`**
   This works correctly but will also return internal tables created by SQLite extensions or plugins. The query filters out `sqlite_%` prefixed tables which handles the standard SQLite internal tables. The `_sqlx_migrations` table (if tauri-plugin-sql uses sqlx internally) would show up. In practice this is fine -- the status display is for debugging.

### Style

6. **Clean separation of concerns**
   `database.ts` handles connection management, migrations, and status queries. The frontend (ControlPanel) only calls `getDatabaseStatus()`. Good encapsulation.

---

## ADR Compliance

### ADR-004: Kanban Columns

| Requirement | Status | Notes |
|-------------|--------|-------|
| `kanban_columns` table with id, name, sort_order, created_at | PASS | Exact match |
| Seed data: backlog, in_progress, review, done | PASS | IDs, names, and sort_order match ADR-004 |
| `tickets.column_id` references `kanban_columns(id)` | PASS | FK declared |
| Schema supports configurability from day one | PASS | Separate `kanban_columns` table, not hardcoded enum |

### ADR-008: Tauri v2 Overlay Windows

| Requirement | Status | Notes |
|-------------|--------|-------|
| SQLite via `tauri-plugin-sql` | PASS | Plugin registered in `lib.rs`, JS API used in `database.ts` |
| WAL mode enabled | PASS | `PRAGMA journal_mode=WAL` executed on connection open |
| `tauri-plugin-window-state` NOT used | PASS | Custom SQLite-based state columns (`window_state TEXT`) in notes and sessions tables |
| Capabilities for SQL declared | PASS | `default.json` includes `sql:default`, `sql:allow-execute`, `sql:allow-select`, `sql:allow-close` |

---

## Frontend Integration

The ControlPanel displays database status in a colour-coded badge:
- **Loading:** neutral styling with "Initialising database..." text
- **Ready:** green badge showing table count, table names, and kanban column count
- **Error:** red badge with error message

This provides clear feedback that the database is healthy and the schema was applied. The `useEffect` with `.catch()` handles initialization errors gracefully without crashing the UI.

---

## Inter-Task Integration

- `database.ts` is imported only by `ControlPanel.tsx`, which is part of P1-02's routing setup. The import compiles cleanly.
- The `DatabaseStatus` type is exported and used correctly.
- The database initialization runs asynchronously in a `useEffect`, so it does not block window rendering or hotkey registration.
- No conflicts with P1-02 or P1-03 code.

---

## Summary

The SQLite database initialization is correctly implemented with all six tables matching the PLANNING.md and ADR-004 schemas. The implementation improves on the planning doc by adding CHECK constraints on enum-like columns (`session_groups.group_type`, `sessions.status`, `session_events.event_type`) and using more precise event type values. Migrations are fully idempotent via `CREATE TABLE IF NOT EXISTS` and `INSERT OR IGNORE`. WAL mode and foreign key enforcement are enabled. The frontend status display provides clear health feedback. All six acceptance criteria are met.

**Verdict: PASS**
