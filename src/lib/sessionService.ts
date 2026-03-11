import { readDir, readTextFile, exists, remove } from "@tauri-apps/plugin-fs";
import { homeDir, join } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Partial file reader (uses Rust command for efficient head/tail reads)
// ---------------------------------------------------------------------------

interface HeadTailResult {
  headLines: string[];
  tailLines: string[];
  mtimeMs: number;
}

async function readFileHeadTail(
  path: string,
  head: number,
  tail: number,
): Promise<HeadTailResult> {
  return invoke<HeadTailResult>("read_file_head_tail", { path, head, tail });
}

// ---------------------------------------------------------------------------
// Mtime cache — skip re-reading files that haven't changed
// ---------------------------------------------------------------------------

/** Cached session metadata keyed by file path. */
const sessionCache = new Map<string, { mtimeMs: number; meta: SessionMeta }>();

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
  status: "active" | "completed" | "idle" | "errored" | "idle-agents" | "inactive";
  workingDir: string | null;
  projectGroupId: string | null;
  manualGroupIds: string[];
  ticketIds: string[];
  label: string | null;
  isOpen: boolean;
  /** The last user prompt text (truncated), extracted from the log tail. */
  lastUserMessage: string | null;
}

export interface FileChangeInfo {
  filePath: string;
  linesAdded: number;
  linesDeleted: number;
}

export interface SessionEvent {
  type: "user" | "assistant" | "progress" | "system" | "file-history-snapshot";
  timestamp: string;
  sessionId: string;
  toolName?: string;
  summary?: string;
  /** True when this is a tool result (user event with toolUseResult). */
  isToolResult?: boolean;
  /** File change info for Write/Edit/Read tool calls. */
  fileChanges?: FileChangeInfo[];
  /** Short file path for display (e.g., `.../kanban/KanbanCard.tsx`). */
  fileInfo?: string;
  /** Diff stats string (e.g., `+3/-2` or `+50 lines`). */
  diffStats?: string;
  /** Full text content for expandable display. */
  fullContent?: string;
  /** True when this is a background agent task-notification. */
  isTaskNotification?: boolean;
  /** Claude Code sub-agent ID (maps to subagents/agent-<id>.jsonl). */
  agentId?: string;
  /** True when this is the initial prompt sent to a sub-agent. */
  isAgentPrompt?: boolean;
  /** Short description for agent prompt display. */
  agentDescription?: string;
  raw?: unknown;
}

/** Shape of the row returned by SQLite SELECT on the sessions table. */
interface SessionRow {
  id: string;
  pid: number | null;
  started_at: string;
  ended_at: string | null;
  status: "active" | "completed" | "idle" | "errored" | "idle-agents" | "inactive";
  working_dir: string | null;
  project_group_id: string | null;
  manual_group_id: string | null;
  ticket_id: string | null;
  window_state: string | null;
  label: string | null;
  is_open: number;
  last_user_message: string | null;
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

      // Read only head + tail lines via Rust (avoids loading entire file)
      let headTail: HeadTailResult;
      try {
        headTail = await readFileHeadTail(filePath, 20, 10);
      } catch (err) {
        console.warn(
          `[sessionService] Failed to read session file ${file.name}:`,
          err,
        );
        continue;
      }

      // Check mtime cache — skip re-parsing if file hasn't changed.
      // Only use cache for stable statuses (completed/errored); active/idle
      // sessions need fresh tail reads because status depends on time elapsed.
      const cached = sessionCache.get(filePath);
      if (
        cached &&
        cached.mtimeMs === headTail.mtimeMs &&
        (cached.meta.status === "completed" || cached.meta.status === "errored")
      ) {
        sessions.push(cached.meta);
        continue;
      }

      const headLines = headTail.headLines;
      const tailLines = headTail.tailLines;
      if (headLines.length === 0) continue;

      // Find the first entry with a timestamp (skip file-history-snapshot
      // entries that may not have one at the top level)
      let startedAt: string | null = null;
      let workingDir: string | null = null;

      for (const line of headLines) {
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

      // Determine status from the last few log entries by checking
      // concrete signals rather than relying on a time threshold.
      let endedAt: string | null = null;
      let status: "active" | "completed" | "errored" | "idle" = "completed";

      for (let i = tailLines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(tailLines[i]!) as Record<string, unknown>;
          if (!entry.timestamp || typeof entry.timestamp !== "string") continue;

          const entryTime = new Date(entry.timestamp).getTime();
          const ageMs = Date.now() - entryTime;
          const entryType = entry.type as string | undefined;

          // 1) system + turn_duration → the turn finished cleanly
          if (entryType === "system") {
            const subtype = entry.subtype as string | undefined;
            if (subtype === "turn_duration") {
              status = "completed";
              endedAt = entry.timestamp;
              break;
            }
          }

          // 2) assistant message → Claude finished responding, waiting for user
          if (entryType === "assistant") {
            status = "completed";
            endedAt = entry.timestamp;
            break;
          }

          // 3) progress entry → tool is running; if recent, session is active
          if (entryType === "progress") {
            if (ageMs < 15_000) {
              status = "active";
              endedAt = null;
            } else {
              // Stale progress — session likely finished or was interrupted.
              // Mark as completed, not errored: we can't distinguish a crash
              // from a normal end when the turn_duration event is outside the
              // tail window. True errors have explicit error system events.
              status = "completed";
              endedAt = entry.timestamp;
            }
            break;
          }

          // 4) user entry (prompt or tool result) — Claude should respond
          if (entryType === "user") {
            if (ageMs < 15_000) {
              status = "active"; // Claude is likely processing
              endedAt = null;
            } else {
              // User sent input but no response followed — idle/stalled
              status = "idle";
              endedAt = null;
            }
            break;
          }

          // 5) file-history-snapshot — skip, look at earlier entries
          if (entryType === "file-history-snapshot") {
            continue;
          }

          // Fallback: unknown type with a timestamp
          endedAt = entry.timestamp;
          break;
        } catch {
          // Skip malformed lines
        }
      }

      // Extract last user prompt from tail (skip tool results and meta events)
      let lastUserMessage: string | null = null;
      for (let i = tailLines.length - 1; i >= 0; i--) {
        try {
          const entry = JSON.parse(tailLines[i]!) as Record<string, unknown>;
          if (entry.type !== "user") continue;
          if (entry.toolUseResult) continue;
          if (entry.isMeta) continue;
          const message = entry.message as { content?: string | unknown[] } | undefined;
          if (!message?.content) continue;
          if (Array.isArray(message.content)) {
            const hasToolResult = message.content.some(
              (c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "tool_result",
            );
            if (hasToolResult) continue;
          }
          const text =
            typeof message.content === "string"
              ? message.content
              : Array.isArray(message.content)
                ? message.content
                    .map((c) =>
                      typeof c === "object" && c !== null && "text" in c
                        ? (c as { text: string }).text
                        : "",
                    )
                    .join("")
                : null;
          if (text && text.trim()) {
            lastUserMessage = text.trim().slice(0, 200);
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
        manualGroupIds: [],
        ticketIds: [],
        label: null,
        isOpen: false,
        lastUserMessage,
      };

      // Upsert into SQLite and retrieve existing label
      try {
        const groupId = await ensureProjectGroup(workingDir);
        session.projectGroupId = groupId;
        await upsertSession(session);
        // Fetch existing user-set fields
        const db = await getDatabase();
        const userRows = await db.select<{ label: string | null; is_open: number; last_user_message: string | null }[]>(
          "SELECT label, is_open, last_user_message FROM sessions WHERE id = $1",
          [sessionId],
        );
        if (userRows.length > 0) {
          if (userRows[0]!.label) session.label = userRows[0]!.label;
          session.isOpen = userRows[0]!.is_open === 1;
          // Use DB value if tail didn't find one (message scrolled out of tail window)
          if (!session.lastUserMessage && userRows[0]!.last_user_message) {
            session.lastUserMessage = userRows[0]!.last_user_message;
          }
        }
        // Fetch ticket links from junction table
        const ticketRows = await db.select<{ ticket_id: string }[]>(
          "SELECT ticket_id FROM session_tickets WHERE session_id = $1",
          [sessionId],
        );
        session.ticketIds = ticketRows.map((r) => r.ticket_id);
        // Fetch group memberships from junction table
        const groupRows = await db.select<{ group_id: string }[]>(
          "SELECT group_id FROM session_group_members WHERE session_id = $1",
          [sessionId],
        );
        session.manualGroupIds = groupRows.map((r) => r.group_id);
      } catch (err) {
        console.warn(
          `[sessionService] Failed to upsert session ${sessionId}:`,
          err,
        );
      }

      // Derive display status for stale sessions (completed/idle, last activity 30+ min ago)
      const INACTIVE_THRESHOLD_MS = 30 * 60 * 1000;
      const lastActivity = session.endedAt ?? session.startedAt;
      if (
        (session.status === "completed" || session.status === "idle") &&
        Date.now() - new Date(lastActivity).getTime() > INACTIVE_THRESHOLD_MS
      ) {
        session.status = session.isOpen ? "idle" : "inactive";
      }

      // Cache the result for mtime-based skipping on next poll
      sessionCache.set(filePath, { mtimeMs: headTail.mtimeMs, meta: session });

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
    `INSERT INTO sessions (id, started_at, ended_at, status, working_dir, project_group_id, last_user_message)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT(id) DO UPDATE SET
       status = $4,
       ended_at = $3,
       working_dir = $5,
       project_group_id = $6,
       last_user_message = COALESCE($7, last_user_message)`,
    [
      session.id,
      session.startedAt,
      session.endedAt,
      session.status,
      session.workingDir,
      session.projectGroupId,
      session.lastUserMessage,
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

  // Fetch all group memberships in one query
  const memberships = await db.select<{ session_id: string; group_id: string }[]>(
    "SELECT session_id, group_id FROM session_group_members",
  );
  const groupsBySession = new Map<string, string[]>();
  for (const m of memberships) {
    if (!groupsBySession.has(m.session_id)) groupsBySession.set(m.session_id, []);
    groupsBySession.get(m.session_id)!.push(m.group_id);
  }

  // Fetch all ticket links
  const ticketLinks = await db.select<{ session_id: string; ticket_id: string }[]>(
    "SELECT session_id, ticket_id FROM session_tickets",
  );
  const ticketsBySession = new Map<string, string[]>();
  for (const tl of ticketLinks) {
    if (!ticketsBySession.has(tl.session_id)) ticketsBySession.set(tl.session_id, []);
    ticketsBySession.get(tl.session_id)!.push(tl.ticket_id);
  }

  const INACTIVE_MS = 30 * 60 * 1000;
  return rows.map((row) => {
    const isOpen = row.is_open === 1;
    const lastActivity = row.ended_at ?? row.started_at;
    const isStale =
      (row.status === "completed" || row.status === "idle") &&
      Date.now() - new Date(lastActivity).getTime() > INACTIVE_MS;
    return {
      id: row.id,
      sessionId: row.id,
      projectDir: row.working_dir ?? "",
      encodedProjectDir: "",
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: isStale ? (isOpen ? "idle" as const : "inactive" as const) : row.status,
      workingDir: row.working_dir,
      projectGroupId: row.project_group_id,
      manualGroupIds: groupsBySession.get(row.id) || [],
      ticketIds: ticketsBySession.get(row.id) || [],
      label: row.label,
      isOpen,
      lastUserMessage: row.last_user_message,
    };
  });
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shorten a file path to the last 2 segments. */
function shortFilePath(filePath: string): string {
  const parts = filePath.replace(/\\/g, "/").split("/");
  return parts.length > 2
    ? `.../${parts.slice(-2).join("/")}`
    : parts.join("/");
}

// ---------------------------------------------------------------------------
// Event parsing
// ---------------------------------------------------------------------------

/** Detect git/gh CLI commands in a Bash command string. */
const GIT_COMMAND_RE = /(?:^|[;&|]\s*)(?:git\s+(?:commit|push|add|stage|pr|merge|rebase|cherry-pick|tag|fetch|pull|stash|checkout|switch|branch|diff|log|reset|revert)|gh\s+)/m;

function isGitCommand(cmd: string): boolean {
  return GIT_COMMAND_RE.test(cmd);
}

/**
 * Parse a single JSONL line into a `SessionEvent`.
 * Returns `null` if the line is malformed or unrecognised.
 *
 * @param toolNameQueue - Optional queue of tool names from preceding assistant
 *   tool_use blocks. Tool results shift names off this queue to correlate.
 */
/** Entry in the tool correlation queue — carries file info for tool results. */
interface ToolQueueEntry {
  name: string;
  fileInfo?: string;
  diffStats?: string;
  /** Diff content for expandable display on the tool result row. */
  expandContent?: string;
}

export function parseSessionEvent(
  line: string,
  sessionId: string,
  toolNameQueue?: ToolQueueEntry[],
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
        const toolUseBlocks = content.filter(
          (c): c is { type: string; id?: string; name: string; input?: Record<string, unknown> } =>
            typeof c === "object" &&
            c !== null &&
            (c as Record<string, unknown>).type === "tool_use",
        );

        // Build per-block file info for queue + event structured fields
        const blockInfos: Array<{
          name: string;
          fileInfo?: string;
          diffStats?: string;
          expandContent?: string;
          fallbackSummary: string;
        }> = [];

        for (const block of toolUseBlocks) {
          const input = block.input;
          const filePath = input ? ((input.file_path ?? input.path) as string | undefined) : undefined;
          const info: { name: string; fileInfo?: string; diffStats?: string; expandContent?: string; fallbackSummary: string } = {
            name: block.name,
            fallbackSummary: block.name,
          };

          if (filePath) {
            info.fileInfo = shortFilePath(filePath);
            if (block.name === "Write" || block.name === "write") {
              const writeContent = (input!.content ?? "") as string;
              const lines = writeContent ? writeContent.split("\n").length : 0;
              info.diffStats = `+${lines} lines`;
              info.fallbackSummary = `${info.fileInfo} ${info.diffStats}`;
            } else if (block.name === "Edit" || block.name === "edit") {
              const oldStr = (input!.old_string ?? "") as string;
              const newStr = (input!.new_string ?? "") as string;
              const oldLines = oldStr ? oldStr.split("\n").length : 0;
              const newLines = newStr ? newStr.split("\n").length : 0;
              const parts: string[] = [];
              if (newLines > 0) parts.push(`+${newLines}`);
              if (oldLines > 0) parts.push(`-${oldLines}`);
              info.diffStats = parts.length > 0 ? parts.join("/") : undefined;
              info.fallbackSummary = `${info.fileInfo}${info.diffStats ? " " + info.diffStats : ""}`;
              // Build expandable diff content
              const diffLines: string[] = [];
              if (oldStr) {
                for (const line of oldStr.split("\n")) {
                  diffLines.push(`- ${line}`);
                }
              }
              if (newStr) {
                for (const line of newStr.split("\n")) {
                  diffLines.push(`+ ${line}`);
                }
              }
              if (diffLines.length > 0) {
                info.expandContent = diffLines.join("\n").slice(0, 2000);
              }
            } else {
              info.fallbackSummary = info.fileInfo;
            }
          } else if (input && (block.name === "Bash" || block.name === "bash")) {
            const cmd = (input.command ?? "") as string;
            if (cmd) {
              // Show first line of command, truncated
              const firstLine = cmd.split("\n")[0]!;
              info.fileInfo = firstLine.length > 80 ? firstLine.slice(0, 77) + "..." : firstLine;
              info.fallbackSummary = info.fileInfo;
              // Detect git/gh commands and relabel as "Git"
              if (isGitCommand(cmd)) {
                info.name = "Git";
              }
            }
          } else if (input && (block.name === "Grep" || block.name === "grep")) {
            const pattern = (input.pattern ?? "") as string;
            if (pattern) {
              info.fileInfo = pattern;
              info.fallbackSummary = pattern;
            }
          } else if (input && (block.name === "Glob" || block.name === "glob")) {
            const pattern = (input.pattern ?? "") as string;
            if (pattern) {
              info.fileInfo = pattern;
              info.fallbackSummary = pattern;
            }
          } else if (input && (block.name === "Skill" || block.name === "skill")) {
            const skillName = (input.skill ?? "") as string;
            if (skillName) {
              info.fileInfo = skillName;
              info.fallbackSummary = skillName;
            }
          } else if (input && (block.name === "Agent" || block.name === "agent")) {
            const desc = (input.description ?? "") as string;
            const prompt = (input.prompt ?? "") as string;
            if (desc) {
              info.fileInfo = desc;
              info.fallbackSummary = desc;
            }
            if (prompt) {
              info.expandContent = prompt.slice(0, 3000);
            }
          } else if (input && (block.name === "Task" || block.name === "task")) {
            const desc = (input.description ?? "") as string;
            if (desc) {
              info.fileInfo = desc;
              info.fallbackSummary = desc;
            }
          }
          blockInfos.push(info);
        }

        // Push to queue for correlation with tool results
        // (skip Agent — its result is matched by agentId, not FIFO queue)
        if (toolNameQueue) {
          for (const info of blockInfos) {
            if (info.name === "Agent" || info.name === "agent") continue;
            toolNameQueue.push({ name: info.name, fileInfo: info.fileInfo, diffStats: info.diffStats, expandContent: info.expandContent });
          }
        }

        if (blockInfos.length > 0) {
          if (blockInfos.length === 1) {
            const info = blockInfos[0]!;
            event.toolName = info.name;
            event.fileInfo = info.fileInfo;
            event.diffStats = info.diffStats;
            if (!info.fileInfo) {
              event.summary = info.fallbackSummary;
            } else {
              event.summary = "started";
            }
          } else {
            event.toolName = blockInfos.map(i => i.name).join(", ");
            event.summary = blockInfos.map(i => i.fallbackSummary).join(" · ");
          }

          // Capture any text content from the same message (AI explanation alongside tool calls)
          const mixedTextBlocks = content.filter(
            (c): c is { type: string; text: string } =>
              typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text",
          );
          if (mixedTextBlocks.length > 0) {
            event.fullContent = mixedTextBlocks.map((b) => b.text).join("\n");
          }
        } else {
          // Pure text content (AI response without tool calls)
          const textBlocks = content.filter(
            (c): c is { type: string; text: string } =>
              typeof c === "object" &&
              c !== null &&
              (c as Record<string, unknown>).type === "text",
          );
          if (textBlocks.length > 0) {
            const text = textBlocks.map((b) => b.text).join(" ");
            if (!text.trim()) return null; // Skip empty text responses
            event.summary = "responded";
            // Full text available on expand
            event.fullContent = text;
          } else {
            // No text content (e.g., thinking-only response) — skip
            return null;
          }
        }
      }
    } else if (type === "user") {
      const message = entry.message as
        | { content?: string | unknown[] }
        | undefined;
      const toolUseResult = entry.toolUseResult as
        | { interrupted?: boolean; content?: string | unknown[]; agentId?: string }
        | undefined;
      const isMeta = entry.isMeta === true;

      // Also detect tool_result blocks inside message.content arrays
      const contentArray = Array.isArray(message?.content) ? message!.content as unknown[] : null;
      const toolResultBlock = contentArray?.find(
        (c): c is { type: string; tool_use_id: string; content?: string } =>
          typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "tool_result",
      );

      if (toolUseResult || toolResultBlock) {
        event.isToolResult = true;

        // Agent results have agentId — they DON'T use the FIFO queue because
        // the agent runs many tool calls between spawn and result.
        if (toolUseResult?.agentId) {
          event.toolName = "Agent";
          event.agentId = toolUseResult.agentId as string;
          event.summary = "completed";
          // Extract description from prompt field
          const prompt = (toolUseResult as Record<string, unknown>).prompt as string | undefined;
          if (prompt) {
            event.fullContent = prompt.slice(0, 3000);
          }
          // Extract result text for display
          let resultText: string | undefined;
          if (Array.isArray(toolUseResult.content)) {
            resultText = toolUseResult.content
              .filter((c): c is { type: string; text: string } =>
                typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text")
              .map((c) => c.text)
              .join("\n");
          } else if (typeof toolUseResult.content === "string") {
            resultText = toolUseResult.content;
          }
          if (resultText) {
            // Use agent output as summary snippet, keep prompt as expandable
            event.fileInfo = resultText.slice(0, 100);
          }
        } else {
          // Normal tool result — pop from FIFO queue
          if (toolNameQueue && toolNameQueue.length > 0) {
            const entry = toolNameQueue.shift()!;
            event.toolName = entry.name;
            event.fileInfo = entry.fileInfo;
            event.diffStats = entry.diffStats;
            if (entry.expandContent) {
              event.fullContent = entry.expandContent;
            }
          }
          event.summary = toolUseResult?.interrupted ? "interrupted" : "completed";
          // Use result content for expandable display
          let resultText: string | undefined;
          if (toolUseResult?.content) {
            if (typeof toolUseResult.content === "string") {
              resultText = toolUseResult.content;
            } else if (Array.isArray(toolUseResult.content)) {
              resultText = toolUseResult.content
                .filter((c): c is { type: string; text: string } =>
                  typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "text")
                .map((c) => c.text)
                .join("\n");
            }
          }
          if (!resultText && typeof toolResultBlock?.content === "string") {
            resultText = toolResultBlock.content;
          }
          if (!event.fullContent && resultText && resultText.length > 0) {
            event.fullContent = resultText.slice(0, 500);
          }
        }
      } else if (message?.content) {
        const text =
          typeof message.content === "string"
            ? message.content
            : Array.isArray(message.content)
              ? message.content
                  .map((c) =>
                    typeof c === "object" && c !== null && "text" in c
                      ? (c as { text: string }).text
                      : "",
                  )
                  .join("")
              : "User input";

        if (isMeta) {
          // System-injected content (e.g., expanded skill prompt) — absorb into current group
          event.isToolResult = true; // prevents starting a new group
          event.toolName = "Skill";
          event.summary = "skill loaded";
          if (text.length > 0) {
            event.fullContent = text.slice(0, 2000);
          }
        } else if (text.includes("<task-notification>")) {
          // Background agent completion — mark as task notification
          event.isTaskNotification = true;
          event.isToolResult = true; // prevents starting a new group
          event.toolName = "TaskNotification";
          // Try to extract a clean summary from the notification content
          const resultMatch = text.match(
            /<(?:result|stdout)>([\s\S]*?)<\/(?:result|stdout)>/,
          );
          if (resultMatch?.[1]?.trim()) {
            event.summary = resultMatch[1].trim().slice(0, 150);
          } else {
            // Fallback: extract text after the closing tags
            const afterTags = text
              .replace(/<[^>]+>/g, " ")
              .replace(/\s+/g, " ")
              .trim();
            event.summary = afterTags
              ? afterTags.slice(0, 150)
              : "Agent completed";
          }
          event.fullContent = text;
        } else {
          if (!text.trim()) return null; // Skip empty user messages
          event.summary = text.slice(0, 100);
          if (
            typeof message.content === "string" &&
            message.content.length > 100
          ) {
            event.fullContent = message.content;
          }
        }
      }
    } else if (type === "progress") {
      // Skip all progress events — they add noise without useful info
      return null;
    } else if (type === "system") {
      const subtype = entry.subtype as string | undefined;
      const durationMs = entry.durationMs as number | undefined;
      if (subtype === "turn_duration" && durationMs !== undefined) {
        event.summary = `Turn completed (${Math.round(durationMs / 1000)}s)`;
      } else {
        // Skip vague system events — only keep turn_duration
        return null;
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
// Session tailing (event-driven via Rust file watcher)
// ---------------------------------------------------------------------------

interface TailState {
  /** Unlisten function for the file-changed event. */
  unlisten: UnlistenFn;
  /** Fallback poll interval (slow, 10s) in case watcher misses events. */
  fallbackIntervalId: ReturnType<typeof setInterval>;
  lastLineCount: number;
  lastProgressEmit: number;
  /** Full path to the .jsonl file being tailed. */
  filePath: string;
  /** Tool correlation queue. */
  toolNameQueue: ToolQueueEntry[];
  /** Callback for new events. */
  onEvent: (event: SessionEvent) => void;
  /** Session ID for this tail. */
  sessionId: string;
  /** Guard against concurrent reads. */
  reading: boolean;
}

/** Map of sessionId -> tailing state for active tails. */
const tailingState = new Map<string, TailState>();

/** Read new lines from a tailed file and dispatch events. */
async function readNewLines(state: TailState): Promise<void> {
  if (state.reading) return;
  state.reading = true;
  try {
    const newContent = await readTextFile(state.filePath);
    const newLines = newContent.split("\n").filter(Boolean);

    if (newLines.length <= state.lastLineCount) return;

    const freshLines = newLines.slice(state.lastLineCount);
    state.lastLineCount = newLines.length;

    for (const line of freshLines) {
      const event = parseSessionEvent(line, state.sessionId, state.toolNameQueue);
      if (!event) continue;

      if (event.type === "progress") {
        const now = Date.now();
        if (now - state.lastProgressEmit < 1000) continue;
        state.lastProgressEmit = now;
      }

      state.onEvent(event);
    }
  } catch (err) {
    console.warn(`[sessionService] Tailing read error for ${state.sessionId}:`, err);
  } finally {
    state.reading = false;
  }
}

/**
 * Start tailing a session's JSONL log file. Calls `onEvent` for each
 * new event parsed from the file. Progress events are throttled to at
 * most one per second.
 *
 * Uses the Rust file watcher for real-time notifications with a 10s
 * fallback poll for robustness.
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
  const toolNameQueue: ToolQueueEntry[] = [];

  // Process existing lines (initial load)
  for (const line of lines) {
    const event = parseSessionEvent(line, sessionId, toolNameQueue);
    if (!event) continue;

    if (event.type === "progress") {
      const eventTime = new Date(event.timestamp).getTime();
      if (eventTime - lastProgressEmit < 1000) continue;
      lastProgressEmit = eventTime;
    }

    onEvent(event);
  }

  // Normalize path separators for comparison with watcher events
  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

  const state: TailState = {
    unlisten: () => {},
    fallbackIntervalId: 0 as unknown as ReturnType<typeof setInterval>,
    lastLineCount: lines.length,
    lastProgressEmit,
    filePath,
    toolNameQueue,
    onEvent,
    sessionId,
    reading: false,
  };

  // Listen for file-changed events from the Rust watcher
  state.unlisten = await listen<{ path: string }>(
    "session:file-changed",
    (e) => {
      const changedPath = e.payload.path.replace(/\\/g, "/").toLowerCase();
      if (changedPath === normalizedPath) {
        void readNewLines(state);
      }
    },
  );

  // Fallback poll every 10s (in case the watcher misses an event)
  state.fallbackIntervalId = setInterval(() => {
    void readNewLines(state);
  }, 10_000);

  tailingState.set(sessionId, state);
}

/**
 * Stop tailing a session's log file.
 */
export function stopTailing(sessionId: string): void {
  const state = tailingState.get(sessionId);
  if (state) {
    state.unlisten();
    clearInterval(state.fallbackIntervalId);
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

// ---------------------------------------------------------------------------
// Sub-agent tailing
// ---------------------------------------------------------------------------

/**
 * Discover sub-agent IDs by listing files in the subagents/ directory.
 * Returns an array of agentId strings (extracted from filenames like `agent-<id>.jsonl`),
 * sorted by file modification time (oldest first).
 */
export async function discoverSubagentIds(
  sessionId: string,
  encodedProjectDir: string,
): Promise<string[]> {
  const home = await homeDir();
  const dir = await join(
    home,
    ".claude",
    "projects",
    encodedProjectDir,
    sessionId,
    "subagents",
  );

  if (!(await exists(dir))) return [];

  try {
    const entries = await readDir(dir);
    return entries
      .filter((e) => e.name?.startsWith("agent-") && e.name?.endsWith(".jsonl"))
      .map((e) => e.name!.replace("agent-", "").replace(".jsonl", ""))
      .sort(); // Lexicographic sort — UUIDs are ordered by creation time
  } catch {
    return [];
  }
}

/** Map of agentId -> tailing state for active sub-agent tails. */
const agentTailState = new Map<string, TailState>();

/**
 * Start tailing a sub-agent's JSONL log file. Uses the Rust file watcher
 * for real-time notifications with a 10s fallback poll.
 */
export async function startAgentTailing(
  sessionId: string,
  encodedProjectDir: string,
  agentId: string,
  onEvent: (event: SessionEvent) => void,
  agentDescription?: string,
): Promise<void> {
  if (agentTailState.has(agentId)) return;

  const home = await homeDir();
  const filePath = await join(
    home,
    ".claude",
    "projects",
    encodedProjectDir,
    sessionId,
    "subagents",
    `agent-${agentId}.jsonl`,
  );

  const fileExists = await exists(filePath);
  if (!fileExists) {
    console.warn(`[sessionService] Sub-agent file does not exist: ${filePath}`);
    return;
  }

  let content: string;
  try {
    content = await readTextFile(filePath);
  } catch (err) {
    console.warn(`[sessionService] Failed to read sub-agent file:`, err);
    return;
  }

  const lines = content.split("\n").filter(Boolean);
  let lastProgressEmit = 0;
  let firstUserSeen = false;
  const toolNameQueue: ToolQueueEntry[] = [];

  for (const line of lines) {
    const event = parseSessionEvent(line, sessionId, toolNameQueue);
    if (!event) continue;
    if (!firstUserSeen && event.type === "user" && !event.isToolResult) {
      firstUserSeen = true;
      event.isAgentPrompt = true;
      event.agentDescription = agentDescription;
    }
    if (event.type === "progress") {
      const eventTime = new Date(event.timestamp).getTime();
      if (eventTime - lastProgressEmit < 1000) continue;
      lastProgressEmit = eventTime;
    }
    onEvent(event);
  }

  const normalizedPath = filePath.replace(/\\/g, "/").toLowerCase();

  const state: TailState = {
    unlisten: () => {},
    fallbackIntervalId: 0 as unknown as ReturnType<typeof setInterval>,
    lastLineCount: lines.length,
    lastProgressEmit,
    filePath,
    toolNameQueue,
    onEvent,
    sessionId,
    reading: false,
  };

  // Listen for file-changed events from the Rust watcher
  state.unlisten = await listen<{ path: string }>(
    "session:file-changed",
    (e) => {
      const changedPath = e.payload.path.replace(/\\/g, "/").toLowerCase();
      if (changedPath === normalizedPath) {
        void readNewLines(state);
      }
    },
  );

  // Fallback poll every 10s
  state.fallbackIntervalId = setInterval(() => {
    void readNewLines(state);
  }, 10_000);

  agentTailState.set(agentId, state);
}

/**
 * Stop tailing a sub-agent's log file.
 */
export function stopAgentTailing(agentId: string): void {
  const state = agentTailState.get(agentId);
  if (state) {
    state.unlisten();
    clearInterval(state.fallbackIntervalId);
    agentTailState.delete(agentId);
  }
}

/**
 * Stop all active sub-agent tails.
 */
export function stopAllAgentTailing(): void {
  for (const [agentId] of agentTailState) {
    stopAgentTailing(agentId);
  }
}

// ---------------------------------------------------------------------------
// Session ↔ Ticket linking
// ---------------------------------------------------------------------------

/**
 * Link a session to a ticket (many-to-many via junction table).
 */
export async function linkSessionToTicket(
  sessionId: string,
  ticketId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT OR IGNORE INTO session_tickets (session_id, ticket_id) VALUES ($1, $2)",
    [sessionId, ticketId],
  );
}

/**
 * Unlink a session from a specific ticket.
 */
export async function unlinkSession(sessionId: string, ticketId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "DELETE FROM session_tickets WHERE session_id = $1 AND ticket_id = $2",
    [sessionId, ticketId],
  );
}

/**
 * Get all sessions linked to a specific ticket.
 */
export async function getSessionsForTicket(
  ticketId: string,
): Promise<SessionMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<SessionRow[]>(
    `SELECT s.* FROM sessions s
     JOIN session_tickets st ON st.session_id = s.id
     WHERE st.ticket_id = $1
     ORDER BY s.started_at DESC`,
    [ticketId],
  );

  const sessionIds = rows.map((r) => r.id);
  const memberships = sessionIds.length > 0
    ? await db.select<{ session_id: string; group_id: string }[]>(
        `SELECT session_id, group_id FROM session_group_members WHERE session_id IN (${sessionIds.map((_, i) => `$${i + 1}`).join(",")})`,
        sessionIds,
      )
    : [];
  const groupsBySession = new Map<string, string[]>();
  for (const m of memberships) {
    if (!groupsBySession.has(m.session_id)) groupsBySession.set(m.session_id, []);
    groupsBySession.get(m.session_id)!.push(m.group_id);
  }

  // Fetch ticket links for these sessions
  const ticketLinks = sessionIds.length > 0
    ? await db.select<{ session_id: string; ticket_id: string }[]>(
        `SELECT session_id, ticket_id FROM session_tickets WHERE session_id IN (${sessionIds.map((_, i) => `$${i + 1}`).join(",")})`,
        sessionIds,
      )
    : [];
  const ticketsBySession = new Map<string, string[]>();
  for (const tl of ticketLinks) {
    if (!ticketsBySession.has(tl.session_id)) ticketsBySession.set(tl.session_id, []);
    ticketsBySession.get(tl.session_id)!.push(tl.ticket_id);
  }

  const INACTIVE_MS = 30 * 60 * 1000;
  return rows.map((row) => {
    const isOpen = row.is_open === 1;
    const lastActivity = row.ended_at ?? row.started_at;
    const isStale =
      (row.status === "completed" || row.status === "idle") &&
      Date.now() - new Date(lastActivity).getTime() > INACTIVE_MS;
    return {
      id: row.id,
      sessionId: row.id,
      projectDir: row.working_dir ?? "",
      encodedProjectDir: "",
      startedAt: row.started_at,
      endedAt: row.ended_at,
      status: isStale ? (isOpen ? "idle" as const : "inactive" as const) : row.status,
      workingDir: row.working_dir,
      projectGroupId: row.project_group_id,
      manualGroupIds: groupsBySession.get(row.id) || [],
      ticketIds: ticketsBySession.get(row.id) || [],
      label: row.label,
      isOpen,
      lastUserMessage: row.last_user_message,
    };
  });
}

// ---------------------------------------------------------------------------
// Session renaming
// ---------------------------------------------------------------------------

/**
 * Set a user-defined label for a session.
 * Pass `null` to clear the label.
 */
export async function renameSession(
  sessionId: string,
  label: string | null,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE sessions SET label = $1 WHERE id = $2", [
    label,
    sessionId,
  ]);
  invalidateSessionCache(sessionId);
}

/**
 * Remove a session from the mtime cache so the next discoverSessions()
 * re-reads from DB instead of returning stale cached data.
 *
 * IMPORTANT: The sessionCache is per-window (each Tauri window has its own
 * JS module scope). renameSession() only invalidates the calling window's
 * cache. Other windows must call this explicitly when they receive a
 * "session:renamed" event so their next poll doesn't return a stale label.
 */
export function invalidateSessionCache(sessionId: string): void {
  for (const [path, entry] of sessionCache) {
    if (entry.meta.id === sessionId) {
      sessionCache.delete(path);
      break;
    }
  }
}

/**
 * Update the is_open flag for a session in SQLite.
 */
export async function setSessionOpen(
  sessionId: string,
  isOpen: boolean,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE sessions SET is_open = $1 WHERE id = $2", [
    isOpen ? 1 : 0,
    sessionId,
  ]);
}

export async function setSessionGroupOpen(
  groupId: string,
  isOpen: boolean,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE session_groups SET is_open = $1 WHERE id = $2", [
    isOpen ? 1 : 0,
    groupId,
  ]);
}

export async function getSessionGroupIdForProject(
  projectDir: string,
): Promise<string | null> {
  const db = await getDatabase();
  const rows = await db.select<{ id: string }[]>(
    "SELECT id FROM session_groups WHERE group_type = 'project' AND project_dir = $1",
    [projectDir],
  );
  return rows.length > 0 ? rows[0]!.id : null;
}

export async function listOpenSessionGroups(): Promise<SessionGroup[]> {
  const db = await getDatabase();
  const rows = await db.select<{
    id: string;
    name: string;
    group_type: string;
    project_dir: string | null;
    sort_order: number;
    created_at: string;
  }[]>("SELECT id, name, group_type, project_dir, sort_order, created_at FROM session_groups WHERE is_open = 1");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    groupType: r.group_type as "project" | "manual",
    projectDir: r.project_dir,
    sortOrder: r.sort_order,
    createdAt: r.created_at,
  }));
}

// ---------------------------------------------------------------------------
// Session log deletion
// ---------------------------------------------------------------------------

/** Build the absolute path to a session's JSONL log file. */
export async function getSessionLogPath(
  sessionId: string,
  encodedProjectDir: string,
): Promise<string> {
  const home = await homeDir();
  return join(home, ".claude", "projects", encodedProjectDir, `${sessionId}.jsonl`);
}

/**
 * Delete a single session's JSONL log file and remove it from SQLite.
 */
export async function deleteSession(
  sessionId: string,
  encodedProjectDir: string,
): Promise<void> {
  const home = await homeDir();
  const filePath = await join(
    home, ".claude", "projects", encodedProjectDir, `${sessionId}.jsonl`,
  );
  try {
    const fileExists = await exists(filePath);
    if (fileExists) await remove(filePath);
  } catch (err) {
    console.warn(`[sessionService] Failed to delete log file for ${sessionId}:`, err);
  }
  try {
    const db = await getDatabase();
    await db.execute("DELETE FROM session_events WHERE session_id = $1", [sessionId]);
    await db.execute("DELETE FROM sessions WHERE id = $1", [sessionId]);
  } catch {
    // best effort
  }
}

/**
 * Delete all JSONL log files for a specific encoded project directory.
 * Also removes the corresponding sessions from SQLite.
 */
export async function deleteProjectSessions(
  encodedProjectDir: string,
): Promise<void> {
  const home = await homeDir();
  const projectDirPath = await join(home, ".claude", "projects", encodedProjectDir);

  const dirExists = await exists(projectDirPath);
  if (!dirExists) return;

  let files: Awaited<ReturnType<typeof readDir>>;
  try {
    files = await readDir(projectDirPath);
  } catch {
    return;
  }

  const jsonlFiles = files.filter(
    (f) => !f.isDirectory && f.name.endsWith(".jsonl"),
  );

  for (const file of jsonlFiles) {
    const filePath = await join(projectDirPath, file.name);
    try {
      await remove(filePath);
    } catch (err) {
      console.warn(`[sessionService] Failed to delete ${file.name}:`, err);
    }

    // Remove from SQLite
    const sessionId = file.name.replace(/\.jsonl$/, "");
    try {
      const db = await getDatabase();
      await db.execute("DELETE FROM session_events WHERE session_id = $1", [sessionId]);
      await db.execute("DELETE FROM sessions WHERE id = $1", [sessionId]);
    } catch {
      // best effort
    }
  }
}

/**
 * Delete all JSONL log files across all projects.
 * Also removes all sessions from SQLite.
 */
export async function deleteAllSessions(): Promise<void> {
  const home = await homeDir();
  const projectsPath = await join(home, ".claude", "projects");

  const dirExists = await exists(projectsPath);
  if (!dirExists) return;

  let projectDirs: Awaited<ReturnType<typeof readDir>>;
  try {
    projectDirs = await readDir(projectsPath);
  } catch {
    return;
  }

  for (const entry of projectDirs) {
    if (!entry.isDirectory) continue;
    await deleteProjectSessions(entry.name);
  }
}

// ---------------------------------------------------------------------------
// Path display helpers
// ---------------------------------------------------------------------------

/**
 * Convert an absolute path to a home-relative path (e.g., `~/Projects/ai/hoverpad`).
 */
export function toHomeRelativePath(
  absolutePath: string,
  homePath: string,
): string {
  const normAbs = absolutePath.replace(/\\/g, "/");
  const normHome = homePath.replace(/\\/g, "/").replace(/\/$/, "");

  if (normAbs.startsWith(normHome)) {
    const relative = normAbs.slice(normHome.length);
    return "~" + relative;
  }
  return absolutePath;
}

// ---------------------------------------------------------------------------
// Custom session groups
// ---------------------------------------------------------------------------

export interface SessionGroup {
  id: string;
  name: string;
  groupType: "project" | "manual";
  projectDir: string | null;
  createdAt: string;
  sortOrder: number;
}

/**
 * List all manual (user-created) session groups.
 */
export async function listManualGroups(): Promise<SessionGroup[]> {
  const db = await getDatabase();
  const rows = await db.select<
    { id: string; name: string; group_type: string; project_dir: string | null; created_at: string; sort_order: number }[]
  >("SELECT * FROM session_groups WHERE group_type = 'manual' ORDER BY sort_order ASC, created_at DESC");
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    groupType: r.group_type as "manual",
    projectDir: r.project_dir,
    createdAt: r.created_at,
    sortOrder: r.sort_order ?? 0,
  }));
}

/**
 * Create a new manual session group.
 */
export async function createManualGroup(name: string): Promise<string> {
  const db = await getDatabase();
  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO session_groups (id, name, group_type) VALUES ($1, $2, 'manual')",
    [id, name],
  );
  return id;
}

/**
 * Rename a manual session group.
 */
export async function renameManualGroup(
  groupId: string,
  name: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE session_groups SET name = $1 WHERE id = $2", [name, groupId]);
}

/**
 * Delete a manual session group. Removes memberships (cascade) and the group row.
 */
export async function deleteManualGroup(groupId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM session_group_members WHERE group_id = $1", [groupId]);
  await db.execute("DELETE FROM session_groups WHERE id = $1", [groupId]);
}

/**
 * Reorder manual groups. Accepts the full ordered list of group IDs.
 */
export async function reorderManualGroups(orderedIds: string[]): Promise<void> {
  const db = await getDatabase();
  for (let i = 0; i < orderedIds.length; i++) {
    await db.execute("UPDATE session_groups SET sort_order = $1 WHERE id = $2", [i, orderedIds[i]]);
  }
}

/**
 * Add a session to a manual group. No-op if already a member.
 */
export async function addSessionToGroup(
  sessionId: string,
  groupId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT OR IGNORE INTO session_group_members (session_id, group_id) VALUES ($1, $2)",
    [sessionId, groupId],
  );
  invalidateSessionCache(sessionId);
}

/**
 * Remove a session from a manual group.
 */
export async function removeSessionFromGroup(
  sessionId: string,
  groupId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "DELETE FROM session_group_members WHERE session_id = $1 AND group_id = $2",
    [sessionId, groupId],
  );
  invalidateSessionCache(sessionId);
}

/**
 * Remove a session from all manual groups.
 */
export async function removeSessionFromAllGroups(
  sessionId: string,
): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM session_group_members WHERE session_id = $1", [sessionId]);
  invalidateSessionCache(sessionId);
}

// ---------------------------------------------------------------------------
// Rust file watcher control
// ---------------------------------------------------------------------------

/** Start the Rust-side file watcher for `~/.claude/projects/`. */
export async function startSessionWatcher(): Promise<void> {
  try {
    await invoke("start_session_watcher");
  } catch (err) {
    console.warn("[sessionService] Failed to start session watcher:", err);
  }
}

/** Stop the Rust-side file watcher. */
export async function stopSessionWatcher(): Promise<void> {
  try {
    await invoke("stop_session_watcher");
  } catch (err) {
    console.warn("[sessionService] Failed to stop session watcher:", err);
  }
}

/**
 * Subscribe to session file changes and trigger a callback with the path.
 * Returns an unlisten function. The callback is debounced per-path so that
 * rapid changes to the same file coalesce, but different files update independently.
 */
export async function onSessionFileChanged(
  callback: (path: string) => void,
  debounceMs = 300,
): Promise<UnlistenFn> {
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  return listen<{ path: string }>("session:file-changed", (e) => {
    const path = e.payload.path;
    const existing = timers.get(path);
    if (existing) clearTimeout(existing);
    timers.set(
      path,
      setTimeout(() => {
        timers.delete(path);
        callback(path);
      }, debounceMs),
    );
  });
}

/**
 * UUID regex for validating session IDs extracted from file paths.
 */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Fast targeted refresh for a single session file.
 * Extracts session ID and project dir from the file path, reads only that
 * file's head+tail, recomputes status, and returns the updated SessionMeta.
 * Returns null if the path doesn't match a valid session file.
 */
export async function refreshSessionByPath(filePath: string): Promise<SessionMeta | null> {
  // Normalize to forward slashes for parsing
  const normalized = filePath.replace(/\\/g, "/");

  // Expected structure: .../.claude/projects/<encodedProjectDir>/<sessionId>.jsonl
  // Also handle subagent paths: .../<sessionId>/subagents/agent-<id>.jsonl (skip these)
  const match = normalized.match(/\/\.claude\/projects\/([^/]+)\/([^/]+)\.jsonl$/);
  if (!match) return null;

  const encodedProjectDir = match[1]!;
  const sessionId = match[2]!;

  // Must be a valid UUID
  if (!UUID_RE.test(sessionId)) return null;

  const projectDir = decodeProjectPath(encodedProjectDir);

  // Read head + tail
  let headTail: HeadTailResult;
  try {
    headTail = await readFileHeadTail(filePath, 20, 10);
  } catch {
    return null;
  }

  // Update mtime cache
  const cached = sessionCache.get(filePath);
  if (
    cached &&
    cached.mtimeMs === headTail.mtimeMs &&
    (cached.meta.status === "completed" || cached.meta.status === "errored")
  ) {
    return cached.meta;
  }

  const headLines = headTail.headLines;
  const tailLines = headTail.tailLines;
  if (headLines.length === 0) return null;

  // Extract start time and working dir from head
  let startedAt: string | null = null;
  let workingDir: string | null = null;

  for (const line of headLines) {
    try {
      const entry = JSON.parse(line) as Record<string, unknown>;
      if (entry.timestamp && typeof entry.timestamp === "string") {
        if (!startedAt) startedAt = entry.timestamp;
        if (!workingDir && entry.cwd && typeof entry.cwd === "string") {
          workingDir = entry.cwd;
        }
        if (startedAt && workingDir) break;
      }
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
      // skip
    }
  }

  if (!startedAt) return null;

  // Determine status from tail
  let endedAt: string | null = null;
  let status: "active" | "completed" | "errored" | "idle" = "completed";

  for (let i = tailLines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(tailLines[i]!) as Record<string, unknown>;
      if (!entry.timestamp || typeof entry.timestamp !== "string") continue;

      const entryTime = new Date(entry.timestamp).getTime();
      const ageMs = Date.now() - entryTime;
      const entryType = entry.type as string | undefined;

      if (entryType === "system") {
        const subtype = entry.subtype as string | undefined;
        if (subtype === "turn_duration") {
          status = "completed";
          endedAt = entry.timestamp;
          break;
        }
      }
      if (entryType === "assistant") {
        status = "completed";
        endedAt = entry.timestamp;
        break;
      }
      if (entryType === "progress") {
        if (ageMs < 15_000) {
          status = "active";
          endedAt = null;
        } else {
          status = "completed";
          endedAt = entry.timestamp;
        }
        break;
      }
      if (entryType === "user") {
        if (ageMs < 15_000) {
          status = "active";
          endedAt = null;
        } else {
          status = "idle";
          endedAt = null;
        }
        break;
      }
      if (entryType === "file-history-snapshot") continue;

      endedAt = entry.timestamp;
      break;
    } catch {
      // skip
    }
  }

  // Extract last user message
  let lastUserMessage: string | null = null;
  for (let i = tailLines.length - 1; i >= 0; i--) {
    try {
      const entry = JSON.parse(tailLines[i]!) as Record<string, unknown>;
      if (entry.type !== "user") continue;
      if (entry.toolUseResult) continue;
      if (entry.isMeta) continue;
      const message = entry.message as { content?: string | unknown[] } | undefined;
      if (!message?.content) continue;
      if (Array.isArray(message.content)) {
        const hasToolResult = message.content.some(
          (c) => typeof c === "object" && c !== null && (c as Record<string, unknown>).type === "tool_result",
        );
        if (hasToolResult) continue;
      }
      const text =
        typeof message.content === "string"
          ? message.content
          : Array.isArray(message.content)
            ? message.content
                .map((c) =>
                  typeof c === "object" && c !== null && "text" in c
                    ? (c as { text: string }).text
                    : "",
                )
                .join("")
            : null;
      if (text && text.trim()) {
        lastUserMessage = text.trim().slice(0, 200);
        break;
      }
    } catch {
      // skip
    }
  }

  if (!workingDir) workingDir = projectDir;

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
    manualGroupIds: [],
    ticketIds: [],
    label: null,
    isOpen: false,
    lastUserMessage,
  };

  // Enrich from DB
  try {
    const groupId = await ensureProjectGroup(workingDir);
    session.projectGroupId = groupId;
    await upsertSession(session);
    const db = await getDatabase();
    const userRows = await db.select<{ label: string | null; is_open: number; last_user_message: string | null }[]>(
      "SELECT label, is_open, last_user_message FROM sessions WHERE id = $1",
      [sessionId],
    );
    if (userRows.length > 0) {
      if (userRows[0]!.label) session.label = userRows[0]!.label;
      session.isOpen = userRows[0]!.is_open === 1;
      if (!session.lastUserMessage && userRows[0]!.last_user_message) {
        session.lastUserMessage = userRows[0]!.last_user_message;
      }
    }
    const ticketRows = await db.select<{ ticket_id: string }[]>(
      "SELECT ticket_id FROM session_tickets WHERE session_id = $1",
      [sessionId],
    );
    session.ticketIds = ticketRows.map((r) => r.ticket_id);
    const groupRows = await db.select<{ group_id: string }[]>(
      "SELECT group_id FROM session_group_members WHERE session_id = $1",
      [sessionId],
    );
    session.manualGroupIds = groupRows.map((r) => r.group_id);
  } catch {
    // best effort
  }

  // Inactive threshold
  const INACTIVE_THRESHOLD_MS = 30 * 60 * 1000;
  const lastActivity = session.endedAt ?? session.startedAt;
  if (
    (session.status === "completed" || session.status === "idle") &&
    Date.now() - new Date(lastActivity).getTime() > INACTIVE_THRESHOLD_MS
  ) {
    session.status = session.isOpen ? "idle" : "inactive";
  }

  // Update cache
  sessionCache.set(filePath, { mtimeMs: headTail.mtimeMs, meta: session });

  return session;
}
