# P1-04: SQLite Database Initialisation with Schema

## Objective
Set up SQLite database creation and schema initialisation using `tauri-plugin-sql`. Create all tables defined in PLANNING.md.

## Scope
- Database file location: `~/hoverpad/hoverpad.db` (create the directory if it doesn't exist)
- Enable WAL mode: `PRAGMA journal_mode=WAL`
- Create migration SQL with all tables:
  - `kanban_columns` — with default seed data (Backlog, In Progress, Review, Done)
  - `tickets` — references kanban_columns
  - `notes` — metadata index with file_path, ticket reference, window_state JSON
  - `session_groups` — project and manual groups
  - `sessions` — with project_group_id, manual_group_id, ticket reference, window_state JSON
  - `session_events` — parsed log events per session
- Run migrations on app startup (idempotent — safe to run multiple times)
- Expose a basic Tauri command to verify the DB is accessible (e.g. `get_db_status` returning table count)

## Out of Scope
- CRUD operations for notes/tickets/sessions (later phases)
- Frontend UI for database content
- File system operations for notes directory

## Acceptance Criteria
1. `~/hoverpad/hoverpad.db` is created on first app launch
2. All 6 tables exist with correct schema
3. `kanban_columns` is seeded with 4 default columns
4. WAL mode is enabled
5. Migrations are idempotent (running twice doesn't error)
6. A Tauri command can query the database from the frontend

## Status
complete

## Review
[P1-04-sqlite-schema.md](../reviews/P1-04-sqlite-schema.md)
