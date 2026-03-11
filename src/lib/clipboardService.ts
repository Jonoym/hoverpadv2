import { getDatabase } from "./database";

export interface ClipboardEntry {
  id: string;
  content: string;
  contentType: string;
  preview: string;
  copiedAt: string;
  pinned: boolean;
}

interface ClipboardEntryRow {
  id: string;
  content: string;
  content_type: string;
  preview: string;
  copied_at: string;
  pinned: number;
}

function rowToEntry(row: ClipboardEntryRow): ClipboardEntry {
  return {
    id: row.id,
    content: row.content,
    contentType: row.content_type,
    preview: row.preview,
    copiedAt: row.copied_at,
    pinned: row.pinned === 1,
  };
}

function generateId(): string {
  return crypto.randomUUID();
}

function makePreview(content: string, maxLen = 200): string {
  return content.replace(/\s+/g, " ").trim().slice(0, maxLen);
}

const MAX_ENTRIES = 500;

/**
 * Add a clipboard entry. If the same content already exists,
 * update its copied_at timestamp instead of creating a duplicate.
 */
export async function addClipboardEntry(
  content: string,
  contentType = "text",
): Promise<ClipboardEntry | null> {
  const db = await getDatabase();

  // Deduplicate: if same content exists, bump its timestamp
  const existing = await db.select<ClipboardEntryRow[]>(
    "SELECT * FROM clipboard_entries WHERE content = $1 LIMIT 1",
    [content],
  );

  if (existing.length > 0) {
    const row = existing[0]!;
    await db.execute(
      "UPDATE clipboard_entries SET copied_at = datetime('now') WHERE id = $1",
      [row.id],
    );
    return rowToEntry({ ...row, copied_at: new Date().toISOString() });
  }

  const id = generateId();
  const preview = makePreview(content);

  await db.execute(
    `INSERT INTO clipboard_entries (id, content, content_type, preview, copied_at, pinned)
     VALUES ($1, $2, $3, $4, datetime('now'), 0)`,
    [id, content, contentType, preview],
  );

  // Prune old unpinned entries beyond the limit
  await db.execute(
    `DELETE FROM clipboard_entries WHERE pinned = 0 AND id NOT IN (
      SELECT id FROM clipboard_entries ORDER BY pinned DESC, copied_at DESC LIMIT $1
    )`,
    [MAX_ENTRIES],
  );

  return {
    id,
    content,
    contentType,
    preview,
    copiedAt: new Date().toISOString(),
    pinned: false,
  };
}

/**
 * List clipboard entries, pinned first, then by most recent.
 */
export async function listClipboardEntries(limit = 200): Promise<ClipboardEntry[]> {
  const db = await getDatabase();
  const rows = await db.select<ClipboardEntryRow[]>(
    "SELECT * FROM clipboard_entries ORDER BY pinned DESC, copied_at DESC LIMIT $1",
    [limit],
  );
  return rows.map(rowToEntry);
}

/**
 * Search clipboard entries by content substring.
 */
export async function searchClipboardEntries(query: string): Promise<ClipboardEntry[]> {
  const db = await getDatabase();
  const rows = await db.select<ClipboardEntryRow[]>(
    "SELECT * FROM clipboard_entries WHERE content LIKE $1 ORDER BY pinned DESC, copied_at DESC LIMIT 100",
    [`%${query}%`],
  );
  return rows.map(rowToEntry);
}

/**
 * Toggle the pinned state of a clipboard entry.
 */
export async function togglePinEntry(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE clipboard_entries SET pinned = CASE WHEN pinned = 1 THEN 0 ELSE 1 END WHERE id = $1",
    [id],
  );
}

/**
 * Delete a single clipboard entry.
 */
export async function deleteClipboardEntry(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM clipboard_entries WHERE id = $1", [id]);
}

/**
 * Clear all unpinned clipboard entries.
 */
export async function clearUnpinnedEntries(): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM clipboard_entries WHERE pinned = 0");
}
