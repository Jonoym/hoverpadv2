import Database from "@tauri-apps/plugin-sql";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";

let db: Database | null = null;

/**
 * Ensure the ~/hoverpad/ directory exists before we try to create
 * the SQLite database file inside it.
 */
async function ensureHoverpadDir(): Promise<void> {
  const dirExists = await exists("hoverpad", {
    baseDir: BaseDirectory.Home,
  });
  if (!dirExists) {
    await mkdir("hoverpad", {
      baseDir: BaseDirectory.Home,
      recursive: true,
    });
  }
}

/**
 * Run all schema migrations. Uses CREATE TABLE IF NOT EXISTS and
 * INSERT OR IGNORE so migrations are idempotent and safe to re-run.
 */
async function runMigrations(database: Database): Promise<void> {
  // -- Kanban columns (configurable, seeded with defaults)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS kanban_columns (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      sort_order  INTEGER NOT NULL,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // Seed default columns (only inserts if the id doesn't already exist)
  await database.execute(`
    INSERT OR IGNORE INTO kanban_columns (id, name, sort_order) VALUES
      ('backlog', 'Backlog', 0),
      ('in_progress', 'In Progress', 1),
      ('review', 'Review', 2),
      ('done', 'Done', 3)
  `);

  // -- Tickets (kanban cards)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS tickets (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      description  TEXT,
      column_id    TEXT NOT NULL REFERENCES kanban_columns(id),
      column_order INTEGER NOT NULL DEFAULT 0,
      due_date     TEXT,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // -- Notes metadata index
  await database.execute(`
    CREATE TABLE IF NOT EXISTS notes (
      id           TEXT PRIMARY KEY,
      title        TEXT NOT NULL,
      file_path    TEXT NOT NULL UNIQUE,
      created_at   TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at   TEXT NOT NULL DEFAULT (datetime('now')),
      ticket_id    TEXT REFERENCES tickets(id),
      is_open      INTEGER NOT NULL DEFAULT 0,
      window_state TEXT
    )
  `);

  // -- Session groups (project auto-groups and manual groups)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS session_groups (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      group_type  TEXT NOT NULL CHECK(group_type IN ('project', 'manual')),
      project_dir TEXT,
      created_at  TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // -- Claude Code sessions
  await database.execute(`
    CREATE TABLE IF NOT EXISTS sessions (
      id               TEXT PRIMARY KEY,
      pid              INTEGER,
      started_at       TEXT NOT NULL DEFAULT (datetime('now')),
      ended_at         TEXT,
      status           TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'completed', 'errored')),
      working_dir      TEXT,
      project_group_id TEXT REFERENCES session_groups(id),
      manual_group_id  TEXT REFERENCES session_groups(id),
      ticket_id        TEXT REFERENCES tickets(id),
      window_state     TEXT
    )
  `);

  // -- Session events (parsed from Claude Code JSONL logs)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS session_events (
      id         TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES sessions(id),
      timestamp  TEXT NOT NULL DEFAULT (datetime('now')),
      event_type TEXT NOT NULL CHECK(event_type IN ('tool_call', 'tool_result', 'progress', 'turn_complete', 'status_change')),
      tool_name  TEXT,
      payload    TEXT
    )
  `);
}

/**
 * Get (or create and initialise) the singleton database connection.
 *
 * - Ensures ~/hoverpad/ directory exists
 * - Opens (or creates) ~/hoverpad/hoverpad.db
 * - Enables WAL journal mode and foreign key enforcement
 * - Runs idempotent schema migrations
 */
export async function getDatabase(): Promise<Database> {
  if (!db) {
    await ensureHoverpadDir();

    // tauri-plugin-sql expands $HOME in the connection string
    db = await Database.load("sqlite:$HOME/hoverpad/hoverpad.db");

    await db.execute("PRAGMA journal_mode=WAL");
    await db.execute("PRAGMA foreign_keys=ON");

    await runMigrations(db);
  }
  return db;
}

export interface DatabaseStatus {
  tables: string[];
  columnCount: number;
}

/**
 * Query the database for a quick health check: which tables exist
 * and how many default kanban columns are seeded.
 */
export async function getDatabaseStatus(): Promise<DatabaseStatus> {
  const database = await getDatabase();

  const tableRows = await database.select<{ name: string }[]>(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
  );

  const countRows = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM kanban_columns",
  );

  return {
    tables: tableRows.map((r) => r.name),
    columnCount: countRows[0]?.count ?? 0,
  };
}
