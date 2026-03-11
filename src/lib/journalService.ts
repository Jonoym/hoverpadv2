import { getDatabase } from "./database";
import type { SessionMeta } from "./sessionService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface JournalDay {
  date: string; // YYYY-MM-DD
  sessions: JournalSession[];
  notes: JournalNote[];
}

export interface JournalSession {
  sessionId: string;
  label: string | null;
  lastUserMessage: string | null;
  status: SessionMeta["status"];
  startedAt: string;
  endedAt: string | null;
  workingDir: string | null;
  /** Short project name derived from workingDir. */
  projectName: string | null;
}

export interface JournalNote {
  id: string;
  title: string;
  preview: string;
  createdAt: string;
  updatedAt: string;
  /** True if the note was created on a different day. */
  isMultiDay: boolean;
  /** Number of days this note has been active (created to last updated). */
  activeDays: number;
  isOpen: boolean;
  starred: boolean;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

interface SessionRow {
  id: string;
  started_at: string;
  ended_at: string | null;
  status: string;
  working_dir: string | null;
  label: string | null;
  last_user_message: string | null;
}

interface NoteRow {
  id: string;
  title: string;
  preview: string | null;
  created_at: string;
  updated_at: string;
  is_open: number;
  starred: number;
}

function shortProjectName(workingDir: string | null): string | null {
  if (!workingDir) return null;
  // Take the last path segment
  const parts = workingDir.replace(/\\/g, "/").split("/").filter(Boolean);
  return parts[parts.length - 1] ?? null;
}

function daysBetween(dateA: string, dateB: string): number {
  const a = new Date(dateA);
  const b = new Date(dateB);
  return Math.max(1, Math.ceil(Math.abs(b.getTime() - a.getTime()) / 86_400_000));
}

/**
 * Get journal data for a specific date.
 * Returns sessions that started on that day and notes that were edited on that day.
 */
export async function getJournalForDate(date: string): Promise<JournalDay> {
  const db = await getDatabase();

  // Sessions that started on this date
  const sessionRows = await db.select<SessionRow[]>(
    `SELECT id, started_at, ended_at, status, working_dir, label, last_user_message
     FROM sessions
     WHERE date(started_at) = $1
     ORDER BY started_at DESC`,
    [date],
  );

  const sessions: JournalSession[] = sessionRows.map((r) => ({
    sessionId: r.id,
    label: r.label,
    lastUserMessage: r.last_user_message,
    status: r.status as SessionMeta["status"],
    startedAt: r.started_at,
    endedAt: r.ended_at,
    workingDir: r.working_dir,
    projectName: shortProjectName(r.working_dir),
  }));

  // Notes that were updated on this date (includes multi-day notes)
  const noteRows = await db.select<NoteRow[]>(
    `SELECT id, title, preview, created_at, updated_at, is_open, starred
     FROM notes
     WHERE date(updated_at) = $1 OR date(created_at) = $1
     ORDER BY updated_at DESC`,
    [date],
  );

  const notes: JournalNote[] = noteRows.map((r) => {
    const createdDate = r.created_at.slice(0, 10);
    const isMultiDay = createdDate !== date;
    return {
      id: r.id,
      title: r.title,
      preview: r.preview ?? "",
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      isMultiDay,
      activeDays: daysBetween(r.created_at, r.updated_at),
      isOpen: r.is_open === 1,
      starred: r.starred === 1,
    };
  });

  return { date, sessions, notes };
}

/**
 * Get dates that have any journal activity (sessions or note edits).
 * Returns the most recent N dates with activity, for calendar navigation.
 */
export async function getActiveDates(limit = 60): Promise<string[]> {
  const db = await getDatabase();
  const rows = await db.select<{ d: string }[]>(
    `SELECT DISTINCT d FROM (
       SELECT date(started_at) as d FROM sessions
       UNION
       SELECT date(updated_at) as d FROM notes
     )
     ORDER BY d DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => r.d);
}

export interface DateActivity {
  date: string;
  sessionCount: number;
  noteCount: number;
}

/**
 * Get activity counts per date for a date range (inclusive).
 * Returns only dates that have at least one session or note.
 */
export async function getDateRangeActivity(startDate: string, endDate: string): Promise<DateActivity[]> {
  const db = await getDatabase();

  const rows = await db.select<{ d: string; sessions: number; notes: number }[]>(
    `SELECT d, COALESCE(s_count, 0) as sessions, COALESCE(n_count, 0) as notes
     FROM (
       SELECT d, SUM(is_session) as s_count, SUM(is_note) as n_count FROM (
         SELECT date(started_at) as d, 1 as is_session, 0 as is_note FROM sessions
           WHERE date(started_at) BETWEEN $1 AND $2
         UNION ALL
         SELECT date(updated_at) as d, 0 as is_session, 1 as is_note FROM notes
           WHERE date(updated_at) BETWEEN $1 AND $2
         UNION ALL
         SELECT date(created_at) as d, 0 as is_session, 1 as is_note FROM notes
           WHERE date(created_at) BETWEEN $1 AND $2
             AND date(updated_at) != date(created_at)
       )
       GROUP BY d
     )
     ORDER BY d`,
    [startDate, endDate],
  );

  return rows.map((r) => ({
    date: r.d,
    sessionCount: r.sessions,
    noteCount: r.notes,
  }));
}

/**
 * Get activity counts per date for an entire month.
 */
export async function getMonthActivity(year: number, month: number): Promise<DateActivity[]> {
  const startDate = `${year}-${String(month).padStart(2, "0")}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`;
  return getDateRangeActivity(startDate, endDate);
}

/**
 * Generate markdown content for a journal day, suitable for saving as a note.
 */
export function generateJournalMarkdown(journal: JournalDay): string {
  const lines: string[] = [];
  const dateObj = new Date(journal.date + "T00:00:00");
  const formatted = dateObj.toLocaleDateString(undefined, {
    weekday: "long",
    year: "numeric",
    month: "long",
    day: "numeric",
  });

  lines.push(`# Journal — ${formatted}`);
  lines.push("");

  // Sessions section
  if (journal.sessions.length > 0) {
    lines.push(`## Sessions (${journal.sessions.length})`);
    lines.push("");
    for (const s of journal.sessions) {
      const name = s.label || s.lastUserMessage?.slice(0, 60) || s.sessionId.slice(0, 8);
      const project = s.projectName ? ` — ${s.projectName}` : "";
      const time = new Date(s.startedAt).toLocaleTimeString(undefined, {
        hour: "2-digit",
        minute: "2-digit",
      });
      lines.push(`- **${name}**${project} — ${s.status} (${time})`);
    }
    lines.push("");
  }

  // Notes section
  if (journal.notes.length > 0) {
    lines.push(`## Notes Active (${journal.notes.length})`);
    lines.push("");
    for (const n of journal.notes) {
      const multi = n.isMultiDay ? ` (active ${n.activeDays} days)` : " (new)";
      lines.push(`- **${n.title}**${multi}`);
      if (n.preview) {
        lines.push(`  > ${n.preview.slice(0, 120)}`);
      }
    }
    lines.push("");
  }

  // Summary
  const completed = journal.sessions.filter((s) => s.status === "completed").length;
  const errored = journal.sessions.filter((s) => s.status === "errored").length;
  const newNotes = journal.notes.filter((n) => !n.isMultiDay).length;
  const continuedNotes = journal.notes.filter((n) => n.isMultiDay).length;

  lines.push("## Summary");
  lines.push("");
  lines.push(
    `${journal.sessions.length} sessions (${completed} completed, ${errored} errored) · ` +
    `${journal.notes.length} notes (${newNotes} new, ${continuedNotes} continued)`,
  );

  return lines.join("\n");
}
