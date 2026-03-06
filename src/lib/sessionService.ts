import { readDir, readTextFile, exists } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionMeta {
  id: string;
  sessionId: string;
  projectDir: string;
  encodedProjectDir: string;
  startedAt: string;
  endedAt: string | null;
  status: "active" | "completed" | "errored";
  workingDir: string | null;
  projectGroupId: string | null;
  manualGroupId: string | null;
  ticketId: string | null;
}

export interface SessionEvent {
  type: "user" | "assistant" | "progress" | "system" | "file-history-snapshot";
  timestamp: string;
  sessionId: string;
  toolName?: string;
  summary?: string;
  raw?: unknown;
}

/** Shape of the row returned by SQLite SELECT on the sessions table. */
interface SessionRow {
  id: string;
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  status: "active" | "completed" | "errored";
  working_dir: string | null;
  project_group_id: string | null;
  manual_group_id: string | null;
  ticket_id: string | null;
  window_state: string | null;
}

// ---------------------------------------------------------------------------
// Path decoding
// ---------------------------------------------------------------------------

/**
 * Decode an encoded project directory name back to the original filesystem path.
 *
 * Claude Code encodes paths by replacing path separators with dashes:
 * - Windows: `C:\Users\Jono\Projects\ai\hoverpad` -> `C--Users-Jono-Projects-ai-hoverpad`
 * - macOS/Linux: `/Users/alice/myproject` -> `-Users-alice-myproject`
 *
 * Windows paths start with a drive letter followed by `--` (double dash),
 * macOS/Linux paths start with a leading dash (representing root `/`).
 */
export function decodeProjectPath(encoded: string): string {
  // Windows: starts with a drive letter followed by --
  // e.g. C--Users-Jono-Projects-ai-hoverpad -> C:\Users\Jono\Projects\ai\hoverpad
  const windowsMatch = encoded.match(/^([A-Z])--(.*)$/);
  if (windowsMatch) {
    const drive = windowsMatch[1]!;
    const rest = windowsMatch[2]!.replace(/-/g, "\\");
    return `${drive}:\\${rest}`;
  }

  // macOS/Linux: starts with a leading dash
  // e.g. -Users-alice-myproject -> /Users/alice/myproject
  if (encoded.startsWith("-")) {
    return encoded.replace(/-/g, "/");
  }

  // Fallback: return as-is
  return encoded;
}

// ---------------------------------------------------------------------------
// Session discovery
// ---------------------------------------------------------------------------

/**
 * Scan `~/.claude/projects/` for session JSONL files.
 *
 * For each project subdirectory, lists `.jsonl` files and reads their first
 * meaningful line (one with a `sessionId` and `timestamp`) to extract metadata.
 * Discovered sessions are upserted into the SQLite `sessions` table and returned
 * sorted by `startedAt` descending (newest first).
 */
export async function discoverSessions(): Promise<SessionMeta[]> {
  const home = await homeDir();
  const projectsPath = await join(home, ".claude", "projects");

  // Check if the projects directory exists at all
  const projectsDirExists = await exists(projectsPath);
  if (!projectsDirExists) {
    return [];
  }

  const sessions: SessionMeta[] = [];

  // Read project directories
  let projectDirs: Awaited<ReturnType<typeof readDir>>;
  try {
    projectDirs = await readDir(projectsPath);
  } catch (err) {
    console.warn("[sessionService] Failed to read projects directory:", err);
    return [];
  }

  for (const entry of projectDirs) {
    // Only process directories (each is an encoded project path)
    if (!entry.isDirectory) continue;

    const encodedProjectDir = entry.name;
    const projectDir = decodeProjectPath(encodedProjectDir);
    const projectDirPath = await join(projectsPath, encodedProjectDir);

    // List files in this project directory
    let files: Awaited<ReturnType<typeof readDir>>;
    try {
      files = await readDir(projectDirPath);
    } catch (err) {
      console.warn(
        `[sessionService] Failed to read project dir ${encodedProjectDir}:`,
        err,
      );
      continue;
    }

    // Filter to .jsonl files (session logs)
    const jsonlFiles = files.filter(
      (f) => !f.isDirectory && f.name.endsWith(".jsonl"),
    );

    for (const file of jsonlFiles) {
      const sessionId = file.name.replace(/\.jsonl$/, "");

      // Skip if it doesn't look like a UUID
      if (
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(
          sessionId,
        )
      ) {
        continue;
      }

      const filePath = await join(projectDirPath, file.name);

      // Read the file to extract metadata from the first few lines
      let fileContent: string;
      try {
        fileContent = await readTextFile(filePath);
      } catch (err) {
        console.warn(
          `[sessionService] Failed to read session file ${file.name}:`,
          err,
        );
        continue;
      }

      const lines = fileContent.split("\n").filter(Boolean);
      if (lines.length === 0) continue;

      // Find the first entry with a timestamp (skip file-history-snapshot
      // entries that may not have one at the top level)
      let startedAt: string | null = null;
      let workingDir: string | null = null;

      for (const line of lines.slice(0, 20)) {
        try {
          const entry = JSON.parse(line) as Record<string, unknown>;
          if (entry.timestamp && typeof entry.timestamp === "string") {
            if (!startedAt) {
              startedAt = entry.timestamp;
            }
            if (!workingDir && entry.cwd && typeof entry.cwd === "string") {
              workingDir = entry.cwd;
            }
            // Once we have both, stop scanning
            if (startedAt && workingDir) break;
          }
          // file-history-snapshot may have timestamp in snapshot object
          if (
            !startedAt &&
            entry.type === "file-history-snapshot" &&
            entry.snapshot &&
            typeof entry.snapshot === "object"
          ) {
            const snapshot = entry.snapshot as Record<string, unknown>;
            if (snapshot.timestamp && typeof snapshot.timestamp === "string") {
              startedAt = snapshot.timestamp;
            }
          }
        } catch {
          // Skip malformed lines
        }
      }

      if (!startedAt) continue;

      // Determine status: check if the last line is a system turn_duration
      // (indicates the session completed its last turn) and whether the file
      // has been inactive. For simplicity, mark all discovered sessions as
      // "completed" since we can't tell if they're still running from the
      // file alone. Active detection will be refined later.
      let endedAt: string | null = null;
      let status: "active" | "completed" | "errored" = "completed";

      // Check the last few lines for a system turn_duration or recent timestamp
      const lastLines = lines.slice(-5);
      for (let i = lastLines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(lastLines[i]!) as Record<string, unknown>;
          if (entry.timestamp && typeof entry.timestamp === "string") {
            endedAt = entry.timestamp;

            // If the last entry is very recent (within 5 minutes), mark as active
            const lastTime = new Date(entry.timestamp).getTime();
            const now = Date.now();
            if (now - lastTime < 5 * 60 * 1000) {
              status = "active";
              endedAt = null;
            }
            break;
          }
        } catch {
          // Skip malformed lines
        }
      }

      // Use workingDir from the log, or fall back to decoded project path
      if (!workingDir) {
        workingDir = projectDir;
      }

      const session: SessionMeta = {
        id: sessionId,
        sessionId,
        projectDir,
        encodedProjectDir,
        startedAt,
        endedAt,
        status,
        workingDir,
        projectGroupId: null,
        manualGroupId: null,
        ticketId: null,
      };

      // Upsert into SQLite
      try {
        const groupId = await ensureProjectGroup(workingDir);
        session.projectGroupId = groupId;
        await upsertSession(session);
      } catch (err) {
        console.warn(
          `[sessionService] Failed to upsert session ${sessionId}:`,
          err,
        );
      }

      sessions.push(session);
    }
  }

  // Sort by startedAt descending (newest first)
  sessions.sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
  );

  return sessions;
}

// ---------------------------------------------------------------------------
// SQLite integration
// ---------------------------------------------------------------------------

/**
 * Insert or update a session in the SQLite `sessions` table.
 */
async function upsertSession(session: SessionMeta): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    `INSERT INTO sessions (id, started_at, ended_at, status, working_dir, project_group_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     ON CONFLICT(id) DO UPDATE SET
       status = $4,
       ended_at = $3,
       working_dir = $5,
       project_group_id = $6`,
    [
      session.id,
      session.startedAt,
      session.endedAt,
      session.status,
      session.workingDir,
      session.projectGroupId,
    ],
  );
}

/**
 * Ensure a project group exists for the given working directory.
 * Returns the group ID (existing or newly created).
 */
async function ensureProjectGroup(workingDir: string): Promise<string> {
  const db = await getDatabase();
  const existing = await db.select<{ id: string }[]>(
    "SELECT id FROM session_groups WHERE group_type = 'project' AND project_dir = $1",
    [workingDir],
  );
  if (existing.length > 0) return existing[0]!.id;

  const id = crypto.randomUUID();
  // Use the last path segment as the human-readable group name
  const name = workingDir.split(/[/\\]/).pop() || workingDir;
  await db.execute(
    `INSERT INTO session_groups (id, name, group_type, project_dir)
     VALUES ($1, $2, 'project', $3)`,
    [id, name, workingDir],
  );
  return id;
}

/**
 * List all sessions from SQLite, ordered by started_at descending.
 */
export async function listSessions(): Promise<SessionMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<SessionRow[]>(
    "SELECT * FROM sessions ORDER BY started_at DESC",
  );

  return rows.map((row) => ({
    id: row.id,
    sessionId: row.id,
    projectDir: row.working_dir ?? "",
    encodedProjectDir: "",
    startedAt: row.started_at,
    endedAt: row.ended_at,
    status: row.status,
    workingDir: row.working_dir,
    projectGroupId: row.project_group_id,
    manualGroupId: row.manual_group_id,
    ticketId: row.ticket_id,
  }));
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

/**
 * Parse a single JSONL line into a `SessionEvent`.
 * Returns `null` if the line is malformed or unrecognised.
 */
export function parseSessionEvent(
  line: string,
  sessionId: string,
): SessionEvent | null {
  try {
    const entry = JSON.parse(line) as Record<string, unknown>;

    const type = entry.type as SessionEvent["type"] | undefined;
    if (!type) return null;

    // Get timestamp from top-level or from snapshot
    let timestamp = entry.timestamp as string | undefined;
    if (!timestamp && type === "file-history-snapshot") {
      const snapshot = entry.snapshot as Record<string, unknown> | undefined;
      timestamp = snapshot?.timestamp as string | undefined;
    }
    if (!timestamp) return null;

    const event: SessionEvent = {
      type,
      timestamp,
      sessionId,
    };

    if (type === "assistant") {
      const message = entry.message as Record<string, unknown> | undefined;
      const content = message?.content as unknown[] | undefined;
      if (Array.isArray(content)) {
        // Find tool_use blocks
        const toolUses = content
          .filter(
            (c): c is { type: string; name: string } =>
              typeof c === "object" &&
              c !== null &&
              (c as Record<string, unknown>).type === "tool_use",
          )
          .map((c) => c.name);

        if (toolUses.length > 0) {
          event.toolName = toolUses.join(", ");
          event.summary = `Tool call: ${toolUses.join(", ")}`;
        } else {
          // Check for text content
          const textBlocks = content.filter(
            (c): c is { type: string; text: string } =>
              typeof c === "object" &&
              c !== null &&
              (c as Record<string, unknown>).type === "text",
          );
          if (textBlocks.length > 0) {
            const text = textBlocks.map((b) => b.text).join(" ");
            event.summary = text.slice(0, 100);
          } else {
            event.summary = "Response";
          }
        }
      }
    } else if (type === "user") {
      const message = entry.message as
        | { content?: string | unknown[] }
        | undefined;
      const toolUseResult = entry.toolUseResult as
        | { interrupted?: boolean }
        | undefined;

      if (toolUseResult) {
        event.summary = `Tool result (${toolUseResult.interrupted ? "interrupted" : "completed"})`;
      } else if (message?.content) {
        const text =
          typeof message.content === "string"
            ? message.content
            : "User input";
        event.summary = text.slice(0, 100);
      }
    } else if (type === "progress") {
      const data = entry.data as { type?: string } | undefined;
      event.summary = `Progress: ${data?.type || "update"}`;
      event.toolName = entry.parentToolUseID as string | undefined;
    } else if (type === "system") {
      const subtype = entry.subtype as string | undefined;
      const durationMs = entry.durationMs as number | undefined;
      if (subtype === "turn_duration" && durationMs !== undefined) {
        event.summary = `Turn completed (${Math.round(durationMs / 1000)}s)`;
      } else {
        event.summary = "System event";
      }
    } else if (type === "file-history-snapshot") {
      event.summary = "File snapshot";
    }

    return event;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Session tailing
// ---------------------------------------------------------------------------

interface TailState {
  intervalId: ReturnType<typeof setInterval>;
  lastLineCount: number;
  lastProgressEmit: number;
}

/** Map of sessionId -> tailing state for active tails. */
const tailingState = new Map<string, TailState>();

/**
 * Start tailing a session's JSONL log file. Calls `onEvent` for each
 * new event parsed from the file. Progress events are throttled to at
 * most one per second.
 *
 * The initial call processes all existing lines (for initial load),
 * then polls every 2 seconds for new lines appended to the file.
 *
 * @param sessionId - The UUID of the session to tail
 * @param encodedProjectDir - The encoded project directory name
 * @param onEvent - Callback invoked for each parsed event
 */
export async function startTailing(
  sessionId: string,
  encodedProjectDir: string,
  onEvent: (event: SessionEvent) => void,
): Promise<void> {
  // Don't start a duplicate tail
  if (tailingState.has(sessionId)) {
    return;
  }

  const home = await homeDir();
  const filePath = await join(
    home,
    ".claude",
    "projects",
    encodedProjectDir,
    `${sessionId}.jsonl`,
  );

  // Verify the file exists
  const fileExists = await exists(filePath);
  if (!fileExists) {
    console.warn(
      `[sessionService] Session file does not exist: ${filePath}`,
    );
    return;
  }

  // Read initial content and process all existing lines
  let content: string;
  try {
    content = await readTextFile(filePath);
  } catch (err) {
    console.warn(
      `[sessionService] Failed to read session file for tailing:`,
      err,
    );
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  let lastProgressEmit = 0;

  // Process existing lines (initial load)
  for (const line of lines) {
    const event = parseSessionEvent(line, sessionId);
    if (!event) continue;

    // Throttle progress events during initial load too
    if (event.type === "progress") {
      const eventTime = new Date(event.timestamp).getTime();
      if (eventTime - lastProgressEmit < 1000) continue;
      lastProgressEmit = eventTime;
    }

    onEvent(event);
  }

  const state: TailState = {
    intervalId: 0 as unknown as ReturnType<typeof setInterval>,
    lastLineCount: lines.length,
    lastProgressEmit,
  };

  // Start polling for new lines
  state.intervalId = setInterval(async () => {
    try {
      const newContent = await readTextFile(filePath);
      const newLines = newContent.split("\n").filter(Boolean);

      if (newLines.length <= state.lastLineCount) return;

      // Process only newly appended lines
      const freshLines = newLines.slice(state.lastLineCount);
      state.lastLineCount = newLines.length;

      for (const line of freshLines) {
        const event = parseSessionEvent(line, sessionId);
        if (!event) continue;

        // Throttle progress events to ~1 per second
        if (event.type === "progress") {
          const now = Date.now();
          if (now - state.lastProgressEmit < 1000) continue;
          state.lastProgressEmit = now;
        }

        onEvent(event);
      }
    } catch (err) {
      console.warn(`[sessionService] Tailing poll error for ${sessionId}:`, err);
    }
  }, 2000);

  tailingState.set(sessionId, state);
}

/**
 * Stop tailing a session's log file.
 */
export function stopTailing(sessionId: string): void {
  const state = tailingState.get(sessionId);
  if (state) {
    clearInterval(state.intervalId);
    tailingState.delete(sessionId);
  }
}

/**
 * Stop all active tailing sessions.
 */
export function stopAllTailing(): void {
  for (const [sessionId] of tailingState) {
    stopTailing(sessionId);
  }
}

/**
 * List the session IDs that are currently being tailed.
 */
export function listActiveTails(): string[] {
  return Array.from(tailingState.keys());
}
