# Backend & Database

Tauri v2 Rust backend and SQLite conventions for Hoverpad.

## Architecture

- Rust backend handles: filesystem I/O, SQLite queries, process monitoring, file watching, global hotkeys
- Frontend communicates with backend exclusively via Tauri commands (`invoke`) and events (`emit`/`listen`)
- SQLite is the single source of truth for all structured data
- Note `.md` files on disk are the source of truth for note content

## SQLite

- Database file at a configurable location (default: `~/hoverpad/hoverpad.db`)
- Enable WAL mode on init: `PRAGMA journal_mode=WAL` (required for concurrent window access)
- Use `tauri-plugin-sql` with the sqlite feature
- All IDs are UUID v7 (TEXT primary key) — provides chronological ordering
- Timestamps as ISO 8601 TEXT (`DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP`)
- JSON columns for flexible data (`window_state JSON`)

### Schema Overview

```
kanban_columns  — configurable board columns (ADR-004)
tickets         — kanban cards, references column_id FK
notes           — metadata index, references ticket_id FK, file_path points to .md file
sessions        — Claude Code CLI sessions, references ticket_id FK
session_events  — parsed JSONL log events per session
session_groups  — project (auto) and manual groupings
```

See `docs/PLANNING.md` for full schema definitions.

## File System

- Notes directory: `~/hoverpad/notes/`
- Note filenames: `YYYY-MM-DD-XXXXXXXX.md` (date + UUID short, immutable) — see ADR-006
- YAML frontmatter in every note file (title, uuid, created timestamp)
- Use `notify` crate for file watching (note changes, Claude log tailing)
- Use `tauri-plugin-fs` for all file read/write from frontend

## Claude Session Monitoring

- See `docs/research/claude-code-logs.md` for full log format
- Session logs at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`
- Path encoding: separators replaced with dashes (e.g. `C--Users-Jono-Projects-ai-hoverpad`)
- Tail JSONL files with `notify` crate + async seek-to-end reading
- Parse entries by `type` field: `assistant` (tool calls), `user` (tool results), `progress` (execution updates), `system` (timing)
- Filter `progress` entries (~78% of log volume) — throttle for UI display
- Use `sysinfo` crate for process discovery (detect running `claude` processes, extract PID + working directory)
- Auto-group sessions by `working_dir` (project groups)

## Tauri Commands

- One command per operation — keep commands focused and small
- Return `Result<T, String>` from commands for error handling
- Use `tauri::State` for shared backend state (DB connection pool, file watchers)
- Emit events for push-based updates (session status changes, file modifications)

## Tauri Plugins

**Required:** `global-shortcut`, `sql`, `fs`, `process`
**Recommended:** `notification`, `dialog`, `os`, `store`
**Do not use:** `window-state` (conflicts with custom SQLite persistence — ADR-008)

## Rust Crates

- `notify` — file system watching
- `sysinfo` — process detection
- `serde` + `serde_json` — serialization
- `uuid` — v7 ID generation
- `tokio` — async runtime
- `cocoa` + `objc` — macOS-only, for fullscreen overlay behaviour (ADR-008)

## Permissions

- Tauri v2 requires explicit capability declarations for every API used
- Missing permissions cause silent failures — always declare in `capabilities/` config
- Test permissions on both macOS and Windows
