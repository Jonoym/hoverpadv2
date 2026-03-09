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
  ticketIds: string[];
  isOpen: boolean;
  preview: string;
  starred: boolean;
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
  preview: string | null;
  starred: number; // SQLite stores booleans as 0/1
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
function rowToMeta(row: NoteRow, ticketIds: string[] = []): NoteMeta {
  return {
    id: row.id,
    title: row.title,
    filePath: row.file_path,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ticketIds,
    isOpen: row.is_open === 1,
    preview: row.preview ?? "",
    starred: row.starred === 1,
  };
}

/**
 * Extract a plain-text preview from markdown content.
 * Strips frontmatter, markdown formatting, and trims to maxLen.
 */
function extractPreview(markdown: string, maxLen = 100): string {
  // Strip frontmatter
  let text = markdown.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
  // Strip headings markers
  text = text.replace(/^#{1,6}\s+/gm, "");
  // Strip bold/italic markers
  text = text.replace(/(\*{1,3}|_{1,3})(.*?)\1/g, "$2");
  // Strip links: [text](url) -> text
  text = text.replace(/\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Strip images
  text = text.replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1");
  // Strip inline code backticks
  text = text.replace(/`([^`]*)`/g, "$1");
  // Strip code fences
  text = text.replace(/```[\s\S]*?```/g, "");
  // Collapse whitespace
  text = text.replace(/\s+/g, " ").trim();

  return text.length > maxLen ? text.slice(0, maxLen) + "..." : text;
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

  // Insert into FTS index
  await db.execute(
    `INSERT INTO notes_fts (note_id, title) VALUES ($1, $2)`,
    [id, title],
  );

  return {
    id,
    title,
    filePath,
    createdAt,
    updatedAt: createdAt,
    ticketIds: [],
    isOpen: false,
    preview: "",
    starred: false,
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

  const ticketRows = await db.select<{ ticket_id: string }[]>(
    "SELECT ticket_id FROM note_tickets WHERE note_id = $1",
    [id],
  );
  const meta = rowToMeta(rows[0]!, ticketRows.map((r) => r.ticket_id));

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

  // Parse title from content and compute preview
  const parsedTitle = parseTitleFromContent(content);
  const newTitle = parsedTitle ?? row.title;
  const updatedAt = new Date().toISOString();
  const preview = extractPreview(content);

  // Update SQLite
  await db.execute(
    `UPDATE notes SET title = $1, updated_at = $2, preview = $3 WHERE id = $4`,
    [newTitle, updatedAt, preview, id],
  );

  // Refresh FTS index
  await db.execute(`DELETE FROM notes_fts WHERE note_id = $1`, [id]);
  await db.execute(
    `INSERT INTO notes_fts (note_id, title) VALUES ($1, $2)`,
    [id, newTitle],
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

  // Delete from FTS index
  await db.execute("DELETE FROM notes_fts WHERE note_id = $1", [id]);

  // Delete SQLite row
  await db.execute("DELETE FROM notes WHERE id = $1", [id]);
}

/**
 * Backfill empty preview fields by reading each note's .md file.
 * Runs once per app session.
 */
let previewsBackfilled = false;
async function backfillPreviews(): Promise<void> {
  if (previewsBackfilled) return;
  previewsBackfilled = true;

  const db = await getDatabase();
  const rows = await db.select<{ id: string; file_path: string }[]>(
    "SELECT id, file_path FROM notes WHERE preview IS NULL OR preview = ''",
  );
  for (const row of rows) {
    try {
      const content = await readTextFile(row.file_path, { baseDir: BaseDirectory.Home });
      const preview = extractPreview(content);
      if (preview) {
        await db.execute("UPDATE notes SET preview = $1 WHERE id = $2", [preview, row.id]);
      }
    } catch {
      // File may not exist — skip
    }
  }
}

/**
 * List all notes, ordered by most recently updated first.
 */
export async function listNotes(): Promise<NoteMeta[]> {
  await backfillPreviews();
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT * FROM notes ORDER BY updated_at DESC",
  );

  // Fetch all note↔ticket links in one query
  const noteTickets = await db.select<{ note_id: string; ticket_id: string }[]>(
    "SELECT note_id, ticket_id FROM note_tickets",
  );
  const ticketsByNote = new Map<string, string[]>();
  for (const nt of noteTickets) {
    const existing = ticketsByNote.get(nt.note_id);
    if (existing) {
      existing.push(nt.ticket_id);
    } else {
      ticketsByNote.set(nt.note_id, [nt.ticket_id]);
    }
  }

  return rows.map((r) => rowToMeta(r, ticketsByNote.get(r.id) ?? []));
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
// Star / rename
// ---------------------------------------------------------------------------

/**
 * Toggle the starred status of a note.
 */
export async function toggleNoteStarred(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE notes SET starred = CASE WHEN starred = 1 THEN 0 ELSE 1 END WHERE id = $1",
    [id],
  );
}

/**
 * Rename a note: updates the title in SQLite and rewrites the frontmatter
 * `title:` field in the .md file on disk.
 */
export async function renameNote(
  id: string,
  newTitle: string,
): Promise<void> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    "SELECT file_path FROM notes WHERE id = $1",
    [id],
  );

  if (rows.length === 0) {
    throw new Error(`Note not found: ${id}`);
  }

  const filePath = rows[0]!.file_path;

  // Read file, update frontmatter title
  const content = await readTextFile(filePath, {
    baseDir: BaseDirectory.Home,
  });

  let updatedContent: string;
  const fmMatch = content.match(/^(---\r?\n)([\s\S]*?)(\r?\n---)/);
  if (fmMatch) {
    const updatedFm = fmMatch[2]!.replace(
      /^title:\s*.+$/m,
      `title: ${newTitle}`,
    );
    updatedContent = `${fmMatch[1]}${updatedFm}${fmMatch[3]}${content.slice(fmMatch[0].length)}`;
  } else {
    // No frontmatter — just update SQLite
    updatedContent = content;
  }

  await writeTextFile(filePath, updatedContent, {
    baseDir: BaseDirectory.Home,
  });

  const updatedAt = new Date().toISOString();
  await db.execute(
    "UPDATE notes SET title = $1, updated_at = $2 WHERE id = $3",
    [newTitle, updatedAt, id],
  );

  // Refresh FTS index
  await db.execute(`DELETE FROM notes_fts WHERE note_id = $1`, [id]);
  await db.execute(
    `INSERT INTO notes_fts (note_id, title) VALUES ($1, $2)`,
    [id, newTitle],
  );
}

// ---------------------------------------------------------------------------
// Ticket linking
// ---------------------------------------------------------------------------

/**
 * Link a note to a ticket via the junction table.
 */
export async function linkNoteToTicket(
  noteId: string,
  ticketId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT OR IGNORE INTO note_tickets (note_id, ticket_id) VALUES ($1, $2)",
    [noteId, ticketId],
  );
}

/**
 * Unlink a note from a specific ticket.
 */
export async function unlinkNote(noteId: string, ticketId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "DELETE FROM note_tickets WHERE note_id = $1 AND ticket_id = $2",
    [noteId, ticketId],
  );
}

/**
 * Get all notes linked to a specific ticket.
 */
export async function getLinkedNotes(ticketId: string): Promise<NoteMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    `SELECT n.* FROM notes n
     JOIN note_tickets nt ON nt.note_id = n.id
     WHERE nt.ticket_id = $1
     ORDER BY n.updated_at DESC`,
    [ticketId],
  );
  // Fetch ticket links for each note
  const noteIds = rows.map((r) => r.id);
  if (noteIds.length === 0) return [];
  const allLinks = await db.select<{ note_id: string; ticket_id: string }[]>(
    "SELECT note_id, ticket_id FROM note_tickets",
  );
  const ticketsByNote = new Map<string, string[]>();
  for (const link of allLinks) {
    if (!noteIds.includes(link.note_id)) continue;
    const existing = ticketsByNote.get(link.note_id);
    if (existing) existing.push(link.ticket_id);
    else ticketsByNote.set(link.note_id, [link.ticket_id]);
  }
  return rows.map((r) => rowToMeta(r, ticketsByNote.get(r.id) ?? []));
}

// ---------------------------------------------------------------------------
// Full-text search
// ---------------------------------------------------------------------------

/**
 * Search notes using FTS5 full-text search.
 * Each word token is wrapped in double quotes with a * suffix for prefix matching.
 * Results are ordered by FTS5 rank (best match first).
 */
export async function searchNotes(query: string): Promise<NoteMeta[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  // Sanitize: split into word tokens, wrap each in quotes with * for prefix matching
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const ftsQuery = tokens.map((t) => `"${t.replace(/"/g, "")}"*`).join(" ");

  const db = await getDatabase();
  const rows = await db.select<NoteRow[]>(
    `SELECT n.*
     FROM notes_fts fts
     JOIN notes n ON n.id = fts.note_id
     WHERE notes_fts MATCH $1
     ORDER BY fts.rank`,
    [ftsQuery],
  );
  return rows.map((r) => rowToMeta(r));
}

// ---------------------------------------------------------------------------
// Note tags
// ---------------------------------------------------------------------------

