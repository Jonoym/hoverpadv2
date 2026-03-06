import {
  exists,
  mkdir,
  writeTextFile,
  readTextFile,
  remove,
} from "@tauri-apps/plugin-fs";
import { BaseDirectory } from "@tauri-apps/api/path";
import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface NoteMeta {
  id: string;
  title: string;
  filePath: string;
  createdAt: string;
  updatedAt: string;
  ticketId: string | null;
  isOpen: boolean;
}

/** Shape of the row returned by SQLite SELECT on the notes table. */
interface NoteRow {
  id: string;
  title: string;
  file_path: string;
  created_at: string;
  updated_at: string;
  ticket_id: string | null;
  is_open: number; // SQLite stores booleans as 0/1
  window_state: string | null;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

const NOTES_DIR = "hoverpad/notes";

/**
 * Generate a UUID v7-like identifier.
 * Uses a 48-bit millisecond timestamp prefix for natural sort order,
 * followed by random bytes formatted as a standard UUID string.
 */
function generateNoteId(): string {
  const timestamp = Date.now();
  const timeHex = timestamp.toString(16).padStart(12, "0");
  const randomBytes = crypto.getRandomValues(new Uint8Array(10));
  const randomHex = Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return `${timeHex.slice(0, 8)}-${timeHex.slice(8, 12)}-7${randomHex.slice(0, 3)}-${(0x80 | (randomBytes[3]! & 0x3f)).toString(16)}${randomHex.slice(4, 6)}-${randomHex.slice(6, 18)}`;
}

/**
 * Generate the immutable filename for a note (ADR-006).
 * Format: YYYY-MM-DD-XXXXXXXX.md (date + first 8 hex chars of UUID without dashes)
 */
function generateFilename(id: string, date: Date): string {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  // Skip the timestamp prefix (first 12 hex chars) and take from the random portion
  const shortId = id.replace(/-/g, "").slice(-8);
  return `${yyyy}-${mm}-${dd}-${shortId}.md`;
}

/**
 * Generate YAML frontmatter for a new note.
 */
function generateFrontmatter(
  title: string,
  id: string,
  created: string,
): string {
  return `---\ntitle: ${title}\nuuid: ${id}\ncreated: ${created}\n---`;
}

/**
 * Parse the title from frontmatter YAML in a markdown string.
 * Returns the frontmatter `title:` value, or falls back to the first `# heading`.
 */
function parseTitleFromContent(markdown: string): string | null {
  // Try frontmatter first
  const fmMatch = markdown.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (fmMatch) {
    const titleMatch = fmMatch[1]!.match(/^title:\s*(.+)$/m);
    if (titleMatch) {
      return titleMatch[1]!.trim();
    }
  }

  // Fallback: first H1
  const h1Match = markdown.match(/^#\s+(.+)$/m);
  if (h1Match) {
    return h1Match[1]!.trim();
  }

  return null;
}

/**
 * Ensure the ~/hoverpad/notes/ directory exists.
 */
async function ensureNotesDir(): Promise<void> {
  const dirExists = await exists(NOTES_DIR, {
    baseDir: BaseDirectory.Home,
  });
  if (!dirExists) {
    await mkdir(NOTES_DIR, {
      baseDir: BaseDirectory.Home,
      recursive: true,
    });
  }
}

/**
 * Convert a SQLite NoteRow to a NoteMeta object.
 */
function rowToMeta(row: NoteRow): NoteMeta {
  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ticketId: row.ticket_id,
    isOpen: row.is_open === 1,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Create a new note: generates the file on disk and inserts a row in SQLite.
 */
export async function createNote(): Promise<NoteMeta> {
  const id = generateNoteId();
  const now = new Date();
  const createdAt = now.toISOString();
  const title = "Untitled Note";
  const filename = generateFilename(id, now);
  const filePath = `${NOTES_DIR}/${filename}`;

  // Build initial file content with frontmatter
  const frontmatter = generateFrontmatter(title, id, createdAt);
  const content = `${frontmatter}\n\n`;

  // Ensure directory exists, check for collision, then write the file
  await ensureNotesDir();
  const fileExists = await exists(filePath, { baseDir: BaseDirectory.Home });
  if (fileExists) {
    throw new Error(`Note file already exists (collision): ${filePath}`);
  }
  await writeTextFile(filePath, content, {
    baseDir: BaseDirectory.Home,
  });

  // Insert row into SQLite
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO notes (id, title, file_path, created_at, updated_at, is_open)
     VALUES ($1, $2, $3, $4, $5, 0)`,
    [id, title, filePath, createdAt, createdAt],
  );

  return {
    id,
    title,
    filePath,
    createdAt,
    updatedAt: createdAt,
    ticketId: null,
    isOpen: false,
  };
}

/**
 * Load a note's metadata from SQLite and content from the .md file on disk.
 */
export async function loadNote(
  id: string,
): Promise<{ meta: NoteMeta; content: string }> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT * FROM notes WHERE id = $1",
    [id],
  );

  if (rows.length === 0) {
    throw new Error(`Note not found: ${id}`);
  }

  const meta = rowToMeta(rows[0]!);

  const content = await readTextFile(meta.filePath, {
    baseDir: BaseDirectory.Home,
  });

  return { meta, content };
}

/**
 * Save note content to the .md file and update the SQLite index.
 * Parses title from frontmatter/H1 and updates `updated_at`.
 */
export async function saveNote(id: string, content: string): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT file_path, title FROM notes WHERE id = $1",
    [id],
  );

  if (rows.length === 0) {
    throw new Error(`Note not found: ${id}`);
  }

  const row = rows[0]!;

  // Write content to disk
  await writeTextFile(row.file_path, content, {
    baseDir: BaseDirectory.Home,
  });

  // Parse title from content
  const parsedTitle = parseTitleFromContent(content);
  const newTitle = parsedTitle ?? row.title;
  const updatedAt = new Date().toISOString();

  // Update SQLite
  await db.execute(
    `UPDATE notes SET title = $1, updated_at = $2 WHERE id = $3`,
    [newTitle, updatedAt, id],
  );
}

/**
 * Delete a note: remove the .md file from disk and the SQLite row.
 */
export async function deleteNote(id: string): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT file_path FROM notes WHERE id = $1",
    [id],
  );

  if (rows.length === 0) {
    throw new Error(`Note not found: ${id}`);
  }

  const filePath = rows[0]!.file_path;

  // Delete file from disk
  await remove(filePath, { baseDir: BaseDirectory.Home });

  // Delete SQLite row
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

/**
 * List all notes, ordered by most recently updated first.
 */
export async function listNotes(): Promise<NoteMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT * FROM notes ORDER BY updated_at DESC",
  );
  return rows.map(rowToMeta);
}

/**
 * Update the is_open flag for a note in SQLite.
 */
export async function setNoteOpen(
  id: string,
  isOpen: boolean,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE notes SET is_open = $1 WHERE id = $2", [
    isOpen ? 1 : 0,
    id,
  ]);
}

// ---------------------------------------------------------------------------
// Ticket linking
// ---------------------------------------------------------------------------

/**
 * Link a note to a ticket by setting its ticket_id.
 */
export async function linkNoteToTicket(
  noteId: string,
  ticketId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE notes SET ticket_id = $1 WHERE id = $2", [
    ticketId,
    noteId,
  ]);
}

/**
 * Unlink a note from its ticket by clearing ticket_id.
 */
export async function unlinkNote(noteId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE notes SET ticket_id = NULL WHERE id = $1", [noteId]);
}

/**
 * Get all notes linked to a specific ticket.
 */
export async function getLinkedNotes(ticketId: string): Promise<NoteMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT * FROM notes WHERE ticket_id = $1 ORDER BY updated_at DESC",
    [ticketId],
  );
  return rows.map(rowToMeta);
}
