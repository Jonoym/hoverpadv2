import { invoke } from "@tauri-apps/api/core";
import { getDatabase } from "./database";
import { parseSessionEvent, type SessionEvent } from "./sessionService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface LogFile {
  id: string;
  path: string;
  label: string | null;
  addedAt: string;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function listLogFiles(): Promise<LogFile[]> {
  const db = await getDatabase();
  const rows = await db.select<
    { id: string; path: string; label: string | null; added_at: string }[]
  >("SELECT id, path, label, added_at FROM log_files ORDER BY added_at DESC");
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    label: r.label,
    addedAt: r.added_at,
  }));
}

export async function addLogFile(path: string, label?: string): Promise<LogFile> {
  const db = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  await db.execute(
    "INSERT OR IGNORE INTO log_files (id, path, label, added_at) VALUES (?, ?, ?, ?)",
    [id, path, label ?? null, now],
  );
  return { id, path, label: label ?? null, addedAt: now };
}

export async function renameLogFile(id: string, label: string | null): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE log_files SET label = ? WHERE id = ?", [label, id]);
}

export async function removeLogFile(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM log_files WHERE id = ?", [id]);
}

export async function setLogFileOpen(id: string, isOpen: boolean): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE log_files SET is_open = ? WHERE id = ?", [isOpen ? 1 : 0, id]);
}

export async function listOpenLogFiles(): Promise<LogFile[]> {
  const db = await getDatabase();
  const rows = await db.select<
    { id: string; path: string; label: string | null; added_at: string }[]
  >("SELECT id, path, label, added_at FROM log_files WHERE is_open = 1");
  return rows.map((r) => ({
    id: r.id,
    path: r.path,
    label: r.label,
    addedAt: r.added_at,
  }));
}

export async function getLogFile(id: string): Promise<LogFile | null> {
  const db = await getDatabase();
  const rows = await db.select<
    { id: string; path: string; label: string | null; added_at: string }[]
  >("SELECT id, path, label, added_at FROM log_files WHERE id = ?", [id]);
  if (rows.length === 0) return null;
  const r = rows[0]!;
  return { id: r.id, path: r.path, label: r.label, addedAt: r.added_at };
}

// ---------------------------------------------------------------------------
// Parse a full log file into events
// ---------------------------------------------------------------------------

export async function parseLogFile(filePath: string): Promise<SessionEvent[]> {
  const text = await invoke<string>("read_text_file", { path: filePath });
  const lines = text.split("\n").filter((l) => l.trim());
  const events: SessionEvent[] = [];
  const toolQueue: { name: string; fileInfo?: string; diffStats?: string; expandContent?: string }[] = [];

  for (const line of lines) {
    const event = parseSessionEvent(line, "logfile", toolQueue);
    if (event) events.push(event);
  }

  return events;
}
