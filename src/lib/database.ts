import Database from "@tauri-apps/plugin-sql";
import { exists, mkdir } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";

let dbPromise: Promise<Database> | null = null;

/**
 * Resolve the absolute path to ~/hoverpad/.
 * Uses Tauri's homeDir() which works on all platforms (unlike $HOME on Windows).
 */
async function getHoverpadDir(): Promise<string> {
  const home = await homeDir();
  return await join(home, "hoverpad");
}

/**
 * Ensure the ~/hoverpad/ directory exists before we try to create
 * the SQLite database file inside it.
 */
async function ensureHoverpadDir(): Promise<void> {
  const dir = await getHoverpadDir();
  const dirExists = await exists(dir);
  if (!dirExists) {
    await mkdir(dir, { recursive: true });
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
      ('backlog', 'To Do', 0),
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

  // -- Migrations: add preview + starred columns to notes (idempotent)
  try {
    await database.execute(`ALTER TABLE notes ADD COLUMN preview TEXT DEFAULT ''`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    await database.execute(`ALTER TABLE notes ADD COLUMN starred INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migration: add label column to sessions (for user-defined names)
  try {
    await database.execute(`ALTER TABLE sessions ADD COLUMN label TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migration: session_group_members junction table (many-to-many)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS session_group_members (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      group_id   TEXT NOT NULL REFERENCES session_groups(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, group_id)
    )
  `);

  // -- Migration: add sort_order column to session_groups (for manual reordering)
  try {
    await database.execute(`ALTER TABLE session_groups ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migrate existing manual_group_id data into junction table
  try {
    await database.execute(`
      INSERT OR IGNORE INTO session_group_members (session_id, group_id)
      SELECT id, manual_group_id FROM sessions WHERE manual_group_id IS NOT NULL
    `);
  } catch {
    // best effort
  }

  // -- Ticket tags (user-defined labels/groups on tickets)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS ticket_tags (
      id        TEXT PRIMARY KEY,
      name      TEXT NOT NULL UNIQUE,
      color     TEXT NOT NULL DEFAULT 'neutral'
    )
  `);

  await database.execute(`
    CREATE TABLE IF NOT EXISTS ticket_tag_members (
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      tag_id    TEXT NOT NULL REFERENCES ticket_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (ticket_id, tag_id)
    )
  `);

  // -- Migration: add archived flag to tickets
  try {
    await database.execute(`ALTER TABLE tickets ADD COLUMN archived INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migration: session_tickets junction table (many-to-many session ↔ ticket)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS session_tickets (
      session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
      ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      PRIMARY KEY (session_id, ticket_id)
    )
  `);

  // Migrate existing ticket_id data from sessions table into junction table
  try {
    await database.execute(`
      INSERT OR IGNORE INTO session_tickets (session_id, ticket_id)
      SELECT id, ticket_id FROM sessions WHERE ticket_id IS NOT NULL
    `);
  } catch {
    // best effort
  }

  // -- Note tags (reuses ticket_tags definitions, separate junction table)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS note_tag_members (
      note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      tag_id  TEXT NOT NULL REFERENCES ticket_tags(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, tag_id)
    )
  `);

  // -- note_tickets junction table (many-to-many note ↔ ticket)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS note_tickets (
      note_id   TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
      ticket_id TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      PRIMARY KEY (note_id, ticket_id)
    )
  `);

  // Migrate existing ticket_id data from notes into junction table
  try {
    await database.execute(`
      INSERT OR IGNORE INTO note_tickets (note_id, ticket_id)
      SELECT id, ticket_id FROM notes WHERE ticket_id IS NOT NULL
    `);
  } catch {
    // best effort
  }

  // -- Migration: rename Backlog → To Do
  await database.execute(`UPDATE kanban_columns SET name = 'To Do' WHERE id = 'backlog'`);

  // -- Migration: add expanded flag to tickets (persists card expand/collapse state)
  try {
    await database.execute(`ALTER TABLE tickets ADD COLUMN expanded INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Ticket checklist items (separate from description)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS ticket_checklist_items (
      id         TEXT PRIMARY KEY,
      ticket_id  TEXT NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
      label      TEXT NOT NULL,
      checked    INTEGER NOT NULL DEFAULT 0,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  // -- Full-text search index for notes
  await database.execute(`
    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      note_id UNINDEXED, title,
      tokenize='porter unicode61'
    )
  `);

  // Backfill FTS from existing notes (only if empty)
  const ftsCount = await database.select<{ count: number }[]>(
    "SELECT COUNT(*) as count FROM notes_fts",
  );
  if (ftsCount[0]?.count === 0) {
    await database.execute(`
      INSERT INTO notes_fts (note_id, title)
      SELECT id, title FROM notes
    `);
  }

  // -- Settings (key-value store for user preferences, hotkey bindings, etc.)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS settings (
      key   TEXT PRIMARY KEY,
      value TEXT NOT NULL
    )
  `);

  // -- Migration: add is_open flag to sessions (for window restore on launch)
  try {
    await database.execute(`ALTER TABLE sessions ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Saved log files (arbitrary .jsonl paths added by the user)
  await database.execute(`
    CREATE TABLE IF NOT EXISTS log_files (
      id           TEXT PRIMARY KEY,
      path         TEXT NOT NULL UNIQUE,
      label        TEXT,
      added_at     TEXT NOT NULL DEFAULT (datetime('now')),
      window_state TEXT
    )
  `);

  // Migration: add window_state to log_files if missing
  try {
    await database.execute(`ALTER TABLE log_files ADD COLUMN window_state TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migration: add is_open flag to log_files (for window restore on launch)
  try {
    await database.execute(`ALTER TABLE log_files ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migration: add window_state and is_open to session_groups (for window restore)
  try {
    await database.execute(`ALTER TABLE session_groups ADD COLUMN window_state TEXT`);
  } catch {
    // Column already exists — safe to ignore
  }
  try {
    await database.execute(`ALTER TABLE session_groups ADD COLUMN is_open INTEGER NOT NULL DEFAULT 0`);
  } catch {
    // Column already exists — safe to ignore
  }

  // -- Migration: add last_user_message to sessions (cached from log tail)
  try {
    await database.execute(`ALTER TABLE sessions ADD COLUMN last_user_message TEXT DEFAULT NULL`);
  } catch {
    // Column already exists — safe to ignore
  }
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
  if (!dbPromise) {
    dbPromise = (async () => {
      await ensureHoverpadDir();

      // Build absolute path — tauri-plugin-sql does NOT expand $HOME.
      // Absolute paths work because Rust's PathBuf::push replaces the base.
      const dir = await getHoverpadDir();
      const dbPath = await join(dir, "hoverpad.db");
      const db = await Database.load(`sqlite:${dbPath}`);

      await db.execute("PRAGMA journal_mode=WAL");
      await db.execute("PRAGMA foreign_keys=ON");

      await runMigrations(db);
      return db;
    })();
  }
  return dbPromise;
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
