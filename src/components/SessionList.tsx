import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { createSessionWindow } from "@/lib/windowManager";
import type { SessionMeta } from "@/lib/sessionService";

// ---------------------------------------------------------------------------
// Time-ago helper (mirrors NoteList)
// ---------------------------------------------------------------------------

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  void seconds;

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  const d = new Date(dateString);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<SessionMeta["status"], string> = {
  active: "bg-emerald-400",
  completed: "bg-blue-400",
  errored: "bg-red-400",
};

const STATUS_LABELS: Record<SessionMeta["status"], string> = {
  active: "Active",
  completed: "Completed",
  errored: "Errored",
};

// ---------------------------------------------------------------------------
// Project name helper
// ---------------------------------------------------------------------------

/** Extract the last path segment as a human-readable project name. */
function projectName(projectDir: string): string {
  const segments = projectDir.split(/[/\\]/).filter(Boolean);
  return segments[segments.length - 1] || projectDir;
}

// ---------------------------------------------------------------------------
// SessionList component
// ---------------------------------------------------------------------------

interface SessionListProps {
  sessions: SessionMeta[];
  loading: boolean;
}

export function SessionList({ sessions, loading }: SessionListProps) {
  // Track which project groups are collapsed
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(
    new Set(),
  );

  // Group sessions by projectDir
  const grouped = useMemo(() => {
    const groups = new Map<string, SessionMeta[]>();
    for (const session of sessions) {
      const key = session.projectDir || "Unknown";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(session);
    }
    return groups;
  }, [sessions]);

  const toggleGroup = (key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const handleOpen = async (session: SessionMeta) => {
    try {
      await createSessionWindow(session.id);
    } catch (err) {
      console.error("[hoverpad] Failed to open session window:", err);
    }
  };

  if (loading) {
    return (
      <p className="text-xs text-neutral-500">Discovering sessions...</p>
    );
  }

  if (sessions.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No Claude Code sessions found. Sessions will appear when Claude Code is
        running.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1">
      {Array.from(grouped.entries()).map(([dir, groupSessions]) => {
        const isCollapsed = collapsedGroups.has(dir);
        const activeCount = groupSessions.filter(
          (s) => s.status === "active",
        ).length;

        return (
          <div key={dir}>
            {/* Project group header */}
            <button
              type="button"
              onClick={() => toggleGroup(dir)}
              className={cn(
                "flex w-full items-center justify-between px-2 py-1.5",
                "cursor-pointer rounded-lg transition-colors duration-150 hover:bg-neutral-700/30",
              )}
            >
              <div className="flex items-center gap-1.5">
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  className={cn(
                    "shrink-0 transition-transform",
                    isCollapsed ? "rotate-0" : "rotate-90",
                  )}
                >
                  <path
                    d="M3 1L7 5L3 9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
                <span className="text-sm font-medium text-neutral-200">
                  {projectName(dir)}
                </span>
              </div>
              <span className="text-xs text-neutral-500">
                {activeCount > 0 && (
                  <span className="mr-1 text-emerald-400">
                    {activeCount} active
                  </span>
                )}
                {groupSessions.length} total
              </span>
            </button>

            {/* Session rows */}
            {!isCollapsed && (
              <div className="flex flex-col gap-0.5 pl-2">
                {groupSessions.map((session) => (
                  <div
                    key={session.id}
                    className={cn(
                      "flex items-center gap-2 rounded-lg px-3 py-1.5",
                      "transition-colors duration-150 hover:bg-neutral-800/50",
                    )}
                  >
                    {/* Status dot */}
                    <span
                      className={cn(
                        "h-2 w-2 shrink-0 rounded-full",
                        STATUS_COLORS[session.status],
                      )}
                      title={STATUS_LABELS[session.status]}
                    />

                    {/* Session info */}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-mono text-neutral-400">
                          {session.sessionId.slice(0, 8)}
                        </span>
                        <span className="text-xs text-neutral-500">
                          {timeAgo(session.startedAt)}
                        </span>
                      </div>
                      {session.workingDir && (
                        <p
                          className="truncate text-xs text-neutral-500"
                          title={session.workingDir}
                        >
                          {session.workingDir}
                        </p>
                      )}
                    </div>

                    {/* Open button */}
                    <button
                      type="button"
                      onClick={() => void handleOpen(session)}
                      className="shrink-0 text-xs text-blue-400 transition-colors duration-150 hover:text-blue-300"
                    >
                      Open
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
