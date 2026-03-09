import { useMemo, useState, useCallback, useEffect, useRef } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import { open } from "@tauri-apps/plugin-dialog";
import { createSessionWindow, createSessionGroupWindow, createCustomGroupWindow, createLogFileWindow } from "@/lib/windowManager";
import { listLogFiles, addLogFile, removeLogFile, renameLogFile, type LogFile } from "@/lib/logFileService";
import { ContextMenuPopover } from "@/components/ContextMenu";
import { listenEvent, emitEvent } from "@/lib/events";
import {
  renameSession,
  deleteSession,
  deleteProjectSessions,
  toHomeRelativePath,
  listManualGroups,
  createManualGroup,
  renameManualGroup,
  deleteManualGroup,
  reorderManualGroups,
  addSessionToGroup,
  removeSessionFromGroup,
  getSessionLogPath,
  type SessionMeta,
  type SessionGroup,
} from "@/lib/sessionService";


// ---------------------------------------------------------------------------
// Status helpers
// ---------------------------------------------------------------------------

const STATUS_DOT_COLORS: Record<SessionMeta["status"], string> = {
  active: "bg-emerald-400",
  completed: "bg-purple-400",
  idle: "bg-amber-400",
  "idle-agents": "bg-indigo-400",
  errored: "bg-red-400",
  inactive: "bg-neutral-500",
};

const STATUS_BORDER_COLORS: Record<SessionMeta["status"], string> = {
  active: "border-emerald-500/50",
  completed: "border-purple-500/50",
  idle: "border-amber-500/50",
  "idle-agents": "border-indigo-500/50",
  errored: "border-red-500/50",
  inactive: "border-neutral-600/40",
};

const STATUS_LABELS: Record<SessionMeta["status"], string> = {
  active: "Running",
  completed: "Done",
  idle: "Idle",
  "idle-agents": "Agents",
  errored: "Errored",
  inactive: "Inactive",
};

// ---------------------------------------------------------------------------
// Context menu wrapper — flips upward if it would overflow the viewport
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// Chevron icon
// ---------------------------------------------------------------------------

function ChevronIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={cn(
        "shrink-0 transition-transform duration-150",
        collapsed ? "rotate-0" : "rotate-90",
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
  );
}

// ---------------------------------------------------------------------------
// Group stats summary
// ---------------------------------------------------------------------------

function GroupStats({
  sessions,
  openSessionIds,
}: {
  sessions: SessionMeta[];
  openSessionIds: Set<string>;
}) {
  const running = sessions.filter((s) => s.status === "active").length;
  const done = sessions.filter((s) => s.status === "completed").length;
  const idle = sessions.filter((s) => s.status === "idle").length;
  const errored = sessions.filter((s) => s.status === "errored").length;
  const open = sessions.filter((s) => openSessionIds.has(s.id)).length;

  if (sessions.length === 0) {
    return <span className="text-xs text-neutral-600 shrink-0">empty</span>;
  }

  return (
    <span className="flex items-center gap-1.5 text-xs text-neutral-500 shrink-0">
      {running > 0 && <span className="text-emerald-400">{running} running</span>}
      {done > 0 && <span className="text-purple-400">{done} done</span>}
      {idle > 0 && <span className="text-amber-400">{idle} idle</span>}
      {errored > 0 && <span className="text-red-400">{errored} errored</span>}
      {open > 0 && (
        <span className="text-neutral-400">
          &middot; {open} open
        </span>
      )}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Session row (shared between both views)
// ---------------------------------------------------------------------------

interface SessionRowProps {
  session: SessionMeta;
  renamingId: string | null;
  renameValue: string;
  renameInputRef: React.RefObject<HTMLInputElement | null>;
  displayPath: (dir: string) => string;
  openSessionIds: Set<string>;
  draggingSessionId: string | null;
  onRenameChange: (value: string) => void;
  onFinishRename: () => void;
  onCancelRename: () => void;
  onFocus: (session: SessionMeta) => void;
  onWatch: (session: SessionMeta) => void;
  onCopyResume: (session: SessionMeta) => void;
  onDragStart?: (sessionId: string, e: React.PointerEvent) => void;
  onContextMenu?: (session: SessionMeta, x: number, y: number) => void;
}

function SessionRow({
  session,
  renamingId,
  renameValue,
  renameInputRef,
  displayPath,
  openSessionIds,
  draggingSessionId,
  onRenameChange,
  onFinishRename,
  onCancelRename,
  onFocus,
  onWatch,
  onCopyResume,
  onDragStart,
  onContextMenu: onCtxMenu,
}: SessionRowProps) {
  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onCtxMenu?.(session, e.clientX, e.clientY);
  };

  return (
    <>
      <div
        className={cn(
          "group flex items-center gap-2 rounded-lg px-3 py-1.5",
          "transition-colors duration-150 hover:bg-neutral-800/50 cursor-pointer",
          "border",
          openSessionIds.has(session.id) ? STATUS_BORDER_COLORS[session.status] : "border-transparent",
          draggingSessionId === session.id && "opacity-40",
          onDragStart && "cursor-grab active:cursor-grabbing",
        )}
        onClick={() => {
          if (renamingId !== session.id) onWatch(session);
        }}
        onContextMenu={handleContextMenu}
        onPointerDown={onDragStart ? (e) => {
          // Don't start drag from inputs
          const tag = (e.target as HTMLElement).tagName;
          if (tag === "INPUT" || tag === "BUTTON") return;
          onDragStart(session.id, e);
        } : undefined}
      >
        {/* Status dot */}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            STATUS_DOT_COLORS[session.status],
          )}
          title={STATUS_LABELS[session.status]}
        />

        {/* Session info */}
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            {renamingId === session.id ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => onRenameChange(e.target.value)}
                onBlur={onFinishRename}
                onClick={(e) => e.stopPropagation()}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onFinishRename();
                  if (e.key === "Escape") onCancelRename();
                }}
                className="text-xs font-mono text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 w-32 outline-none focus:border-blue-500"
              />
            ) : (
              <span className="text-xs font-mono text-neutral-400">
                {session.label || session.sessionId.slice(0, 8)}
              </span>
            )}
            <span className="text-xs text-neutral-500">
              {timeAgo(session.startedAt)}
            </span>
          </div>
          {session.workingDir && (
            <p
              className="flex items-center gap-1 truncate text-xs text-neutral-500"
              title={session.workingDir}
            >
              <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0">
                <path d="M2 4V13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3H3a1 1 0 0 0-1 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
              </svg>
              <span className="truncate">{displayPath(session.workingDir)}</span>
            </p>
          )}
        </div>

        {/* Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onCopyResume(session); }}
            className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors duration-150 hover:text-neutral-300 cursor-pointer"
            title="Copy claude --resume command"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" />
            </svg>
          </button>
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onFocus(session); }}
            className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors duration-150 hover:text-blue-400 cursor-pointer"
            title="Open in VS Code"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
              <path d="M10 2h4v4" />
              <path d="M14 2L7 9" />
            </svg>
          </button>
        </div>
      </div>

    </>
  );
}

// ---------------------------------------------------------------------------
// SessionList component
// ---------------------------------------------------------------------------

interface SessionListProps {
  sessions: SessionMeta[];
  onRefresh?: () => void;
}

type ViewMode = "project" | "custom" | "files";

export function SessionList({ sessions, onRefresh }: SessionListProps) {
  const [viewMode, setViewMode] = useState<ViewMode>("project");
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());
  const [homePath, setHomePath] = useState<string>("");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [manualGroups, setManualGroups] = useState<SessionGroup[]>([]);
  // Context menus — only one open at a time
  const [sessionContextMenu, setSessionContextMenu] = useState<{
    x: number; y: number;
    session: SessionMeta;
    inGroupId?: string;
  } | null>(null);
  const [groupContextMenu, setGroupContextMenu] = useState<{
    x: number; y: number;
    type: "project" | "custom";
    id: string;
    encodedDir?: string;
  } | null>(null);
  const [renamingGroupId, setRenamingGroupId] = useState<string | null>(null);
  const [renameGroupValue, setRenameGroupValue] = useState("");
  const [groupSearch, setGroupSearch] = useState<Record<string, string>>({});
  // Drag state — sessions
  const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
  const [draggingLabel, setDraggingLabel] = useState("");
  const [dragOverGroupId, setDragOverGroupId] = useState<string | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const dragDataRef = useRef<{ sessionId: string; startX: number; startY: number; started: boolean } | null>(null);
  const groupDropRefs = useRef(new Map<string, HTMLDivElement>());
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const scrollRafRef = useRef<number>(0);
  // Drag state — group reorder
  const [draggingGroupId, setDraggingGroupId] = useState<string | null>(null);
  const [groupDropIndex, setGroupDropIndex] = useState<number | null>(null);
  const groupDragOverlayRef = useRef<HTMLDivElement>(null);
  const groupDragDataRef = useRef<{ groupId: string; startX: number; startY: number; started: boolean } | null>(null);
  const groupHeaderRefs = useRef(new Map<string, HTMLDivElement>());
  const groupDragCleanupRef = useRef<(() => void) | null>(null);

  const [openSessionIds, setOpenSessionIds] = useState<Set<string>>(new Set());

  // Log files state
  const [logFiles, setLogFiles] = useState<LogFile[]>([]);
  const [fileSearch, setFileSearch] = useState("");
  const [logFileContextMenu, setLogFileContextMenu] = useState<{
    x: number; y: number; file: LogFile;
  } | null>(null);
  const [renamingLogFileId, setRenamingLogFileId] = useState<string | null>(null);
  const [renameLogFileValue, setRenameLogFileValue] = useState("");
  const renameLogFileInputRef = useRef<HTMLInputElement>(null);

  const renameInputRef = useRef<HTMLInputElement>(null);
  const renameGroupInputRef = useRef<HTMLInputElement>(null);

  // Close all context menus helper
  const closeAllMenus = useCallback(() => {
    setSessionContextMenu(null);
    setGroupContextMenu(null);
    setLogFileContextMenu(null);
  }, []);

  // Close any open context menu on outside click or scroll
  useEffect(() => {
    if (!groupContextMenu && !sessionContextMenu && !logFileContextMenu) return;
    const handleClose = () => closeAllMenus();
    document.addEventListener("click", handleClose);
    document.addEventListener("scroll", handleClose, true);
    return () => {
      document.removeEventListener("click", handleClose);
      document.removeEventListener("scroll", handleClose, true);
    };
  }, [groupContextMenu, sessionContextMenu, logFileContextMenu, closeAllMenus]);

  // Session context menu handler — closes group menu too
  const handleSessionContextMenu = useCallback((session: SessionMeta, x: number, y: number, inGroupId?: string) => {
    setGroupContextMenu(null);
    setSessionContextMenu({ x, y, session, inGroupId });
  }, []);

  // Track which log file windows are open
  const [openLogFileIds, setOpenLogFileIds] = useState<Set<string>>(new Set());

  // Check which session windows are open
  const refreshOpenSessions = useCallback(async () => {
    const openIds = new Set<string>();
    for (const session of sessions) {
      const win = await WebviewWindow.getByLabel(`session-${session.id}`);
      if (win) openIds.add(session.id);
    }
    setOpenSessionIds(openIds);

    const openFileIds = new Set<string>();
    for (const file of logFiles) {
      const win = await WebviewWindow.getByLabel(`logfile-${file.id}`);
      if (win) openFileIds.add(file.id);
    }
    setOpenLogFileIds(openFileIds);
  }, [sessions, logFiles]);

  useEffect(() => {
    homeDir().then(setHomePath);
  }, []);

  // Refresh open session tracking on mount, session changes, and window events
  useEffect(() => {
    refreshOpenSessions();
    const unsubs = [
      listenEvent("window:opened", () => { refreshOpenSessions(); }),
      listenEvent("window:closed", () => { refreshOpenSessions(); }),
    ];
    return () => { unsubs.forEach((p) => p.then((u) => u()).catch(console.error)); };
  }, [refreshOpenSessions]);

  // Load manual groups
  useEffect(() => {
    listManualGroups().then(setManualGroups).catch(console.error);
  }, []);

  const refreshGroups = useCallback(() => {
    listManualGroups().then(setManualGroups).catch(console.error);
  }, []);

  // Load log files
  useEffect(() => {
    listLogFiles().then(setLogFiles).catch(console.error);
  }, []);

  const refreshLogFiles = useCallback(() => {
    listLogFiles().then(setLogFiles).catch(console.error);
  }, []);

  const handleAddLogFile = useCallback(async () => {
    const selected = await open({
      multiple: false,
      filters: [{ name: "JSONL Logs", extensions: ["jsonl"] }],
    });
    if (!selected) return;
    const path = typeof selected === "string" ? selected : selected;
    await addLogFile(path);
    refreshLogFiles();
  }, [refreshLogFiles]);

  const handleRemoveLogFile = useCallback(async (id: string) => {
    await removeLogFile(id);
    refreshLogFiles();
  }, [refreshLogFiles]);

  const handleStartRenameLogFile = useCallback((file: LogFile) => {
    setRenamingLogFileId(file.id);
    setRenameLogFileValue(file.label || file.path.split(/[/\\]/).pop() || "");
  }, []);

  const handleFinishRenameLogFile = useCallback(async () => {
    if (!renamingLogFileId) return;
    const trimmed = renameLogFileValue.trim();
    await renameLogFile(renamingLogFileId, trimmed || null);
    setRenamingLogFileId(null);
    refreshLogFiles();
  }, [renamingLogFileId, renameLogFileValue, refreshLogFiles]);

  // Focus inputs when they appear
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  useEffect(() => {
    if (renamingGroupId && renameGroupInputRef.current) {
      renameGroupInputRef.current.focus();
      renameGroupInputRef.current.select();
    }
  }, [renamingGroupId]);

  useEffect(() => {
    if (renamingLogFileId && renameLogFileInputRef.current) {
      renameLogFileInputRef.current.focus();
      renameLogFileInputRef.current.select();
    }
  }, [renamingLogFileId]);

  // ---------- Grouping logic ----------

  const projectGroups = useMemo(() => {
    const groups = new Map<string, { sessions: SessionMeta[]; encodedDir: string }>();
    for (const session of sessions) {
      const key = session.projectDir || "Unknown";
      if (!groups.has(key)) {
        groups.set(key, { sessions: [], encodedDir: session.encodedProjectDir });
      }
      const group = groups.get(key)!;
      group.sessions.push(session);
      if (session.encodedProjectDir && !group.encodedDir) {
        group.encodedDir = session.encodedProjectDir;
      }
    }
    return groups;
  }, [sessions]);

  const customGrouped = useMemo(() => {
    const result: { group: SessionGroup; sessions: SessionMeta[] }[] = [];

    const byGroupId = new Map<string, SessionMeta[]>();
    for (const session of sessions) {
      for (const gid of session.manualGroupIds) {
        if (!byGroupId.has(gid)) byGroupId.set(gid, []);
        byGroupId.get(gid)!.push(session);
      }
    }

    for (const group of manualGroups) {
      result.push({ group, sessions: byGroupId.get(group.id) || [] });
    }

    return result;
  }, [sessions, manualGroups]);

  // Filter sessions by a search query for a given group key
  const filterSessions = useCallback((sessionList: SessionMeta[], groupKey: string) => {
    const q = (groupSearch[groupKey] || "").trim().toLowerCase();
    if (!q) return sessionList;
    return sessionList.filter((s) => {
      const label = (s.label || s.sessionId.slice(0, 8)).toLowerCase();
      const dir = (s.projectDir || "").toLowerCase();
      const workDir = (s.workingDir || "").toLowerCase();
      return label.includes(q) || dir.includes(q) || workDir.includes(q);
    });
  }, [groupSearch]);

  const updateGroupSearch = useCallback((groupKey: string, value: string) => {
    setGroupSearch((prev) => ({ ...prev, [groupKey]: value }));
  }, []);

  // ---------- Helpers ----------

  const displayPath = useCallback(
    (dir: string) => {
      if (!homePath) return dir;
      return toHomeRelativePath(dir, homePath);
    },
    [homePath],
  );

  const toggleGroup = useCallback((key: string) => {
    setCollapsedGroups((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  // ---------- Handlers ----------

  const handleWatch = async (session: SessionMeta) => {
    try {
      await createSessionWindow(session.id);
    } catch (err) {
      console.error("[hoverpad] Failed to open session window:", err);
    }
  };

  const handleFocus = async (session: SessionMeta) => {
    try {
      await invoke("resume_session", {
        workingDir: session.workingDir || session.projectDir,
      });
    } catch (err) {
      console.error("[hoverpad] Failed to focus VSCode:", err);
    }
  };

  const handleCopyResume = (session: SessionMeta) => {
    const cmd = `claude --resume "${session.sessionId}"`;
    navigator.clipboard.writeText(cmd).catch((err) => {
      console.error("[hoverpad] Failed to copy to clipboard:", err);
    });
  };

  const handleStartRename = (session: SessionMeta) => {
    setRenamingId(session.id);
    setRenameValue(session.label || session.sessionId.slice(0, 8));
  };

  const handleFinishRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    const label = trimmed && trimmed !== renamingId.slice(0, 8) ? trimmed : null;
    try {
      await renameSession(renamingId, label);
      onRefresh?.();
      await emitEvent("session:renamed", { sessionId: renamingId, newLabel: label });
    } catch (err) {
      console.error("[hoverpad] Failed to rename session:", err);
    }
    setRenamingId(null);
  };

  const handleDeleteProject = async (encodedDir: string) => {
    try {
      await deleteProjectSessions(encodedDir);
      onRefresh?.();
    } catch (err) {
      console.error("[hoverpad] Failed to delete project sessions:", err);
    }
  };

  const handleDeleteSession = async (session: SessionMeta) => {
    try {
      await deleteSession(session.id, session.encodedProjectDir);
      onRefresh?.();
    } catch (err) {
      console.error("[hoverpad] Failed to delete session:", err);
    }
  };


  const handleCreateUntitledGroup = async () => {
    try {
      await createManualGroup("Untitled Group");
      refreshGroups();
    } catch (err) {
      console.error("[hoverpad] Failed to create group:", err);
    }
  };

  const handleStartRenameGroup = (group: SessionGroup) => {
    setRenamingGroupId(group.id);
    setRenameGroupValue(group.name);
  };

  const handleFinishRenameGroup = async () => {
    if (!renamingGroupId) return;
    const trimmed = renameGroupValue.trim();
    if (trimmed) {
      try {
        await renameManualGroup(renamingGroupId, trimmed);
        refreshGroups();
      } catch (err) {
        console.error("[hoverpad] Failed to rename group:", err);
      }
    }
    setRenamingGroupId(null);
  };

  const handleDeleteGroup = async (groupId: string) => {
    try {
      await deleteManualGroup(groupId);
      refreshGroups();
      onRefresh?.();
    } catch (err) {
      console.error("[hoverpad] Failed to delete group:", err);
    }
  };

  const handleRemoveFromGroup = async (sessionId: string, groupId: string) => {
    try {
      await removeSessionFromGroup(sessionId, groupId);
      onRefresh?.();
    } catch (err) {
      console.error("[hoverpad] Failed to remove from group:", err);
    }
  };

  // ---------- Drag & drop ----------

  const DRAG_THRESHOLD = 5;

  const registerGroupDropRef = useCallback((groupId: string, el: HTMLDivElement | null) => {
    if (el) groupDropRefs.current.set(groupId, el);
    else groupDropRefs.current.delete(groupId);
  }, []);

  const getGroupAtPoint = useCallback((x: number, y: number): string | null => {
    for (const [groupId, el] of groupDropRefs.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return groupId;
      }
    }
    return null;
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      dragCleanupRef.current?.();
      groupDragCleanupRef.current?.();
    };
  }, []);

  // Ref to avoid stale closure in drag handler
  const onRefreshRef = useRef(onRefresh);
  onRefreshRef.current = onRefresh;

  const handleSessionDragStart = useCallback((sessionId: string, e: React.PointerEvent) => {
    // Don't drag if interacting with inputs or buttons
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "BUTTON") return;

    e.preventDefault();
    dragDataRef.current = { sessionId, startX: e.clientX, startY: e.clientY, started: false };

    const session = sessions.find((s) => s.id === sessionId);
    const label = session?.label || sessionId.slice(0, 8);

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragDataRef.current) return;
      const dx = ev.clientX - dragDataRef.current.startX;
      const dy = ev.clientY - dragDataRef.current.startY;

      if (!dragDataRef.current.started) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragDataRef.current.started = true;
        setDraggingSessionId(sessionId);
        setDraggingLabel(label);
      }

      // Position overlay
      if (dragOverlayRef.current) {
        dragOverlayRef.current.style.left = `${ev.clientX + 12}px`;
        dragOverlayRef.current.style.top = `${ev.clientY - 10}px`;
      }

      // Auto-scroll when dragging near top/bottom edges of scroll container
      const sc = scrollContainerRef.current;
      if (sc) {
        const rect = sc.getBoundingClientRect();
        const EDGE = 40;
        const SPEED = 8;
        cancelAnimationFrame(scrollRafRef.current);
        if (ev.clientY < rect.top + EDGE && sc.scrollTop > 0) {
          const autoScroll = () => {
            sc.scrollTop -= SPEED;
            if (sc.scrollTop > 0 && dragDataRef.current?.started) {
              scrollRafRef.current = requestAnimationFrame(autoScroll);
            }
          };
          scrollRafRef.current = requestAnimationFrame(autoScroll);
        } else if (ev.clientY > rect.bottom - EDGE && sc.scrollTop < sc.scrollHeight - sc.clientHeight) {
          const autoScroll = () => {
            sc.scrollTop += SPEED;
            if (sc.scrollTop < sc.scrollHeight - sc.clientHeight && dragDataRef.current?.started) {
              scrollRafRef.current = requestAnimationFrame(autoScroll);
            }
          };
          scrollRafRef.current = requestAnimationFrame(autoScroll);
        }
      }

      // Hit-test group headers
      const hoveredGroup = getGroupAtPoint(ev.clientX, ev.clientY);
      setDragOverGroupId(hoveredGroup);
    };

    const onPointerUp = async (ev: PointerEvent) => {
      cleanup();
      if (!dragDataRef.current?.started) {
        dragDataRef.current = null;
        return;
      }

      const targetGroup = getGroupAtPoint(ev.clientX, ev.clientY);
      dragDataRef.current = null;
      setDraggingSessionId(null);
      setDragOverGroupId(null);

      if (targetGroup !== null && targetGroup !== "__ungroup__") {
        try {
          await addSessionToGroup(sessionId, targetGroup);
          onRefreshRef.current?.();
        } catch (err) {
          console.error("[hoverpad] Failed to assign group via drag:", err);
        }
      }
    };

    const cleanup = () => {
      cancelAnimationFrame(scrollRafRef.current);
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      dragCleanupRef.current = null;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    dragCleanupRef.current = cleanup;
  }, [sessions, getGroupAtPoint]);

  // ---------- Group drag-to-reorder ----------

  const registerGroupHeaderRef = useCallback((groupId: string, el: HTMLDivElement | null) => {
    if (el) groupHeaderRefs.current.set(groupId, el);
    else groupHeaderRefs.current.delete(groupId);
  }, []);

  const getGroupDropIndex = useCallback((y: number): number | null => {
    let closest: { idx: number; dist: number } | null = null;
    for (let i = 0; i < manualGroups.length; i++) {
      const el = groupHeaderRefs.current.get(manualGroups[i]!.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const midY = rect.top + rect.height / 2;
      const dist = Math.abs(y - midY);
      if (!closest || dist < closest.dist) {
        closest = { idx: y < midY ? i : i + 1, dist };
      }
    }
    return closest?.idx ?? null;
  }, [manualGroups]);

  const handleGroupDragStart = useCallback((groupId: string, e: React.PointerEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "BUTTON") return;

    e.preventDefault();
    groupDragDataRef.current = { groupId, startX: e.clientX, startY: e.clientY, started: false };

    const group = manualGroups.find((g) => g.id === groupId);
    const label = group?.name || groupId.slice(0, 8);

    const onPointerMove = (ev: PointerEvent) => {
      if (!groupDragDataRef.current) return;
      const dx = ev.clientX - groupDragDataRef.current.startX;
      const dy = ev.clientY - groupDragDataRef.current.startY;

      if (!groupDragDataRef.current.started) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        groupDragDataRef.current.started = true;
        setDraggingGroupId(groupId);
      }

      if (groupDragOverlayRef.current) {
        groupDragOverlayRef.current.style.left = `${ev.clientX + 12}px`;
        groupDragOverlayRef.current.style.top = `${ev.clientY - 10}px`;
        groupDragOverlayRef.current.textContent = label;
      }

      setGroupDropIndex(getGroupDropIndex(ev.clientY));
    };

    const onPointerUp = async (ev: PointerEvent) => {
      cleanup();
      if (!groupDragDataRef.current?.started) {
        groupDragDataRef.current = null;
        return;
      }

      const dropIdx = getGroupDropIndex(ev.clientY);
      groupDragDataRef.current = null;
      setDraggingGroupId(null);
      setGroupDropIndex(null);

      if (dropIdx === null) return;
      const fromIdx = manualGroups.findIndex((g) => g.id === groupId);
      if (fromIdx < 0) return;
      // Adjust target index since removing the item shifts indices
      const toIdx = dropIdx > fromIdx ? dropIdx - 1 : dropIdx;
      if (toIdx === fromIdx) return;

      const reordered = [...manualGroups];
      const [moved] = reordered.splice(fromIdx, 1);
      reordered.splice(toIdx, 0, moved!);
      setManualGroups(reordered);
      try {
        await reorderManualGroups(reordered.map((g) => g.id));
      } catch (err) {
        console.error("[hoverpad] Failed to reorder groups:", err);
        refreshGroups();
      }
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      groupDragCleanupRef.current = null;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    groupDragCleanupRef.current = cleanup;
  }, [manualGroups, getGroupDropIndex, refreshGroups]);

  // ---------- Shared session row props ----------

  const baseRowProps = {
    renamingId,
    renameValue,
    renameInputRef,
    displayPath,
    openSessionIds,
    draggingSessionId,
    onRenameChange: setRenameValue,
    onFinishRename: () => void handleFinishRename(),
    onCancelRename: () => setRenamingId(null),
    onFocus: (s: SessionMeta) => void handleFocus(s),
    onWatch: (s: SessionMeta) => void handleWatch(s),
    onCopyResume: handleCopyResume,
    onContextMenu: (s: SessionMeta, x: number, y: number) => handleSessionContextMenu(s, x, y),
  };

  // In custom view, sessions are draggable
  const projectRowProps = { ...baseRowProps };
  const customRowProps = { ...baseRowProps, onDragStart: handleSessionDragStart };

  // ---------- Render ----------

  if (sessions.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No Claude Code sessions found. Sessions will appear when Claude Code is running.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-0.5" ref={(el) => { scrollContainerRef.current = el?.parentElement ?? null; }}>
      {/* Top bar: view toggle + clear all */}
      <div className="flex h-8 items-center justify-between px-2">
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => setViewMode("project")}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150",
              viewMode === "project"
                ? "bg-neutral-700/60 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            Projects
          </button>
          <button
            type="button"
            onClick={() => setViewMode("custom")}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150",
              viewMode === "custom"
                ? "bg-neutral-700/60 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            Groups
          </button>
          <button
            type="button"
            onClick={() => setViewMode("files")}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150",
              viewMode === "files"
                ? "bg-neutral-700/60 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            Files
          </button>
        </div>
        {viewMode === "custom" && (
          <button
            type="button"
            onClick={() => void handleCreateUntitledGroup()}
            className="text-[11px] text-neutral-500 hover:text-neutral-300 cursor-pointer"
          >
            + Group
          </button>
        )}
        {viewMode === "files" && (
          <button
            type="button"
            onClick={() => void handleAddLogFile()}
            className="text-[11px] text-neutral-500 hover:text-neutral-300 cursor-pointer"
          >
            + File
          </button>
        )}
      </div>

      {/* ============ BY PROJECT VIEW ============ */}
      {viewMode === "project" &&
        Array.from(projectGroups.entries()).map(([dir, { sessions: groupSessions, encodedDir }]) => {
          const isCollapsed = collapsedGroups.has(dir);

          return (
            <div
              key={dir}
              className="rounded-lg overflow-hidden border border-transparent"
              onContextMenu={(e) => {
                e.preventDefault();
                setSessionContextMenu(null);
                setGroupContextMenu({ x: e.clientX, y: e.clientY, type: "project", id: dir, encodedDir });
              }}
            >
              <div
                className={cn("flex w-full items-center gap-2 px-2 py-2 cursor-pointer", "bg-neutral-800/30")}
                onClick={() => toggleGroup(dir)}
              >
                <div className="flex items-center gap-1.5 shrink-0 text-neutral-400">
                  <ChevronIcon collapsed={isCollapsed} />
                  <span className="text-sm font-medium text-neutral-200 whitespace-nowrap" title={dir}>
                    {dir.split(/[/\\]/).filter(Boolean).pop() || dir}
                  </span>
                  <GroupStats sessions={groupSessions} openSessionIds={openSessionIds} />
                </div>
                <input
                  type="text"
                  value={groupSearch[dir] || ""}
                  onChange={(e) => updateGroupSearch(dir, e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  placeholder="Filter..."
                  className="ml-auto w-28 rounded-lg border border-neutral-700/50 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
                />
              </div>

              <div
                className={cn(
                  "overflow-hidden transition-all duration-200 ease-in-out",
                  isCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100",
                )}
              >
                <div className="flex flex-col gap-0.5 pl-1">
                  {filterSessions(groupSessions, dir).map((session) => (
                    <SessionRow key={session.id} session={session} {...projectRowProps} />
                  ))}
                </div>
              </div>
            </div>
          );
        })}

      {/* ============ CUSTOM GROUPS VIEW ============ */}
      {viewMode === "custom" && (
        <>
          {/* Custom groups */}
          {customGrouped.map(({ group, sessions: groupSessions }, groupIdx) => {
            const isCollapsed = collapsedGroups.has(group.id);
            const showDropBefore = draggingGroupId !== null && groupDropIndex === groupIdx && draggingGroupId !== group.id;

            return (
              <div key={group.id}>
                {/* Drop indicator line */}
                {showDropBefore && (
                  <div className="h-0.5 mx-2 my-0.5 rounded bg-blue-500/60" />
                )}
                <div
                  ref={(el) => {
                    registerGroupDropRef(group.id, el);
                    registerGroupHeaderRef(group.id, el);
                  }}
                  className={cn(
                    "rounded-lg overflow-hidden border transition-colors duration-150",
                    dragOverGroupId === group.id && !draggingGroupId
                      ? "border-blue-500/40 bg-neutral-800/60"
                      : "border-transparent",
                    draggingGroupId === group.id && "opacity-40",
                  )}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    setSessionContextMenu(null);
                    setGroupContextMenu({ x: e.clientX, y: e.clientY, type: "custom", id: group.id });
                  }}
                >
                <div
                  className={cn(
                    "flex w-full items-center gap-2 px-2 py-2 cursor-grab active:cursor-grabbing",
                    "bg-neutral-800/30",
                  )}
                  onClick={() => {
                    if (!groupDragDataRef.current?.started) toggleGroup(group.id);
                  }}
                  onPointerDown={(e) => handleGroupDragStart(group.id, e)}
                >
                  <div className="flex items-center gap-1.5 shrink-0 text-neutral-400">
                    <ChevronIcon collapsed={isCollapsed} />
                    {renamingGroupId === group.id ? (
                      <input
                        ref={renameGroupInputRef}
                        type="text"
                        value={renameGroupValue}
                        onChange={(e) => setRenameGroupValue(e.target.value)}
                        onBlur={() => void handleFinishRenameGroup()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleFinishRenameGroup();
                          if (e.key === "Escape") setRenamingGroupId(null);
                        }}
                        onClick={(e) => e.stopPropagation()}
                        className="text-sm font-medium text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 w-32 outline-none focus:border-blue-500"
                      />
                    ) : (
                      <span className="text-sm font-medium text-neutral-200 whitespace-nowrap">
                        {group.name}
                      </span>
                    )}
                    <GroupStats sessions={groupSessions} openSessionIds={openSessionIds} />
                  </div>
                  <input
                    type="text"
                    value={groupSearch[group.id] || ""}
                    onChange={(e) => updateGroupSearch(group.id, e.target.value)}
                    onClick={(e) => e.stopPropagation()}
                    placeholder="Filter..."
                    className="ml-auto w-28 rounded-lg border border-neutral-700/50 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
                  />
                </div>

                <div
                  className={cn(
                    "overflow-hidden transition-all duration-200 ease-in-out",
                    isCollapsed ? "max-h-0 opacity-0" : "max-h-[2000px] opacity-100",
                  )}
                >
                  <div className="flex flex-col gap-0.5 pl-1">
                    {groupSessions.length === 0 ? (
                      <p className="text-xs text-neutral-600 px-3 py-1.5 italic">
                        No sessions assigned yet
                      </p>
                    ) : (
                      filterSessions(groupSessions, group.id).map((session) => (
                        <SessionRow
                          key={session.id}
                          session={session}
                          {...customRowProps}
                          onContextMenu={(s, x, y) => handleSessionContextMenu(s, x, y, group.id)}
                        />
                      ))
                    )}
                  </div>
                </div>
              </div>
              </div>
            );
          })}
          {/* Drop indicator after last group */}
          {draggingGroupId !== null && groupDropIndex === customGrouped.length && (
            <div className="h-0.5 mx-2 my-0.5 rounded bg-blue-500/60" />
          )}

          {/* All Sessions — searchable flat list */}
          <div className="rounded-lg overflow-hidden mt-1">
            <div
              className={cn(
                "flex w-full items-center gap-2 px-2 py-2 cursor-pointer",
                "bg-neutral-800/30",
              )}
              onClick={() => toggleGroup("__all_sessions__")}
            >
              <div className="flex items-center gap-1.5 shrink-0 text-neutral-400">
                <ChevronIcon collapsed={collapsedGroups.has("__all_sessions__")} />
                <span className="text-sm font-medium text-neutral-200">All Sessions</span>
                <span className="text-xs text-neutral-500 shrink-0">
                  {(() => {
                    const filtered = filterSessions(sessions, "__all_sessions__");
                    const q = (groupSearch["__all_sessions__"] || "").trim();
                    return q && filtered.length !== sessions.length
                      ? `${filtered.length} / ${sessions.length}`
                      : `${sessions.length}`;
                  })()}
                </span>
              </div>
              <input
                type="text"
                value={groupSearch["__all_sessions__"] || ""}
                onChange={(e) => updateGroupSearch("__all_sessions__", e.target.value)}
                onClick={(e) => e.stopPropagation()}
                placeholder="Filter..."
                className="ml-auto w-28 rounded-lg border border-neutral-700/50 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
              />
            </div>
            <div
              className={cn(
                "overflow-hidden transition-all duration-200 ease-in-out",
                collapsedGroups.has("__all_sessions__") ? "max-h-0 opacity-0" : "max-h-[5000px] opacity-100",
              )}
            >
              <div className="flex flex-col gap-0.5 pl-1">
                {(() => {
                  const filtered = filterSessions(sessions, "__all_sessions__");
                  return filtered.length === 0 ? (
                    <p className="text-xs text-neutral-600 px-3 py-1.5 italic">No matching sessions</p>
                  ) : (
                    filtered.map((session) => (
                      <SessionRow key={session.id} session={session} {...customRowProps} />
                    ))
                  );
                })()}
              </div>
            </div>
          </div>
        </>
      )}

      {/* ============ FILES VIEW ============ */}
      {viewMode === "files" && (
        <div className="flex flex-col gap-1">
          {/* Search */}
          {logFiles.length > 0 && (
            <div className="relative">
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
              >
                <path
                  fillRule="evenodd"
                  d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
                  clipRule="evenodd"
                />
              </svg>
              <input
                type="text"
                value={fileSearch}
                onChange={(e) => setFileSearch(e.target.value)}
                placeholder="Search files..."
                className="w-full rounded-lg border border-neutral-700/50 bg-neutral-800/50 py-1.5 pl-8 pr-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
              />
            </div>
          )}
          {logFiles.length === 0 ? (
            <p className="text-xs text-neutral-500 px-3 py-4 text-center">
              No log files added yet. Click "+ File" to add a JSONL log file.
            </p>
          ) : (
            (() => {
              const filteredFiles = fileSearch.trim()
                ? logFiles.filter((f) => {
                    const q = fileSearch.toLowerCase();
                    return (
                      (f.label || "").toLowerCase().includes(q) ||
                      f.path.toLowerCase().includes(q)
                    );
                  })
                : logFiles;
              return filteredFiles.length === 0 ? (
                <p className="text-xs text-neutral-600 px-3 py-1.5 italic">No matching files</p>
              ) : (
                filteredFiles.map((file) => (
              <div
                key={file.id}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-1.5 cursor-pointer hover:bg-neutral-800/50 transition-colors duration-150",
                  "border",
                  openLogFileIds.has(file.id) ? "border-blue-500/50" : "border-transparent",
                )}
                onClick={() => void createLogFileWindow(file.id)}
                onContextMenu={(e) => {
                  e.preventDefault();
                  closeAllMenus();
                  setLogFileContextMenu({ x: e.clientX, y: e.clientY, file });
                }}
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" className="shrink-0 text-neutral-500">
                  <path d="M4 1h5l4 4v9a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                  <path d="M9 1v4h4" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                </svg>
                <div className="flex flex-col min-w-0 flex-1">
                  {renamingLogFileId === file.id ? (
                    <input
                      ref={renameLogFileInputRef}
                      type="text"
                      value={renameLogFileValue}
                      onChange={(e) => setRenameLogFileValue(e.target.value)}
                      onBlur={() => void handleFinishRenameLogFile()}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") void handleFinishRenameLogFile();
                        if (e.key === "Escape") setRenamingLogFileId(null);
                      }}
                      onClick={(e) => e.stopPropagation()}
                      className="text-sm text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 outline-none focus:border-blue-500"
                    />
                  ) : (
                    <span className="text-sm text-neutral-200 truncate">
                      {file.label || file.path.split(/[/\\]/).pop() || "Untitled"}
                    </span>
                  )}
                  <span className="text-[11px] text-neutral-500 truncate" title={file.path}>
                    {file.path}
                  </span>
                </div>
              </div>
            ))
              );
            })()
          )}
        </div>
      )}

      {/* Log file context menu */}
      {logFileContextMenu && (
        <ContextMenuPopover x={logFileContextMenu.x} y={logFileContextMenu.y}>
          <button
            type="button"
            onClick={() => { const f = logFileContextMenu.file; closeAllMenus(); handleStartRenameLogFile(f); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              const f = logFileContextMenu.file;
              closeAllMenus();
              void (async () => {
                try { await invoke("open_path", { path: f.path }); }
                catch (err) { console.error("[hoverpad] Failed to open log file:", err); }
              })();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Open in Editor
          </button>
          <div className="my-1 h-px bg-neutral-700/50" />
          <button
            type="button"
            onClick={() => { const f = logFileContextMenu.file; closeAllMenus(); void handleRemoveLogFile(f.id); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/60 cursor-pointer"
          >
            Remove
          </button>
        </ContextMenuPopover>
      )}

      {/* Session context menu */}
      {sessionContextMenu && (
        <ContextMenuPopover x={sessionContextMenu.x} y={sessionContextMenu.y}>
          <button
            type="button"
            onClick={() => { const s = sessionContextMenu.session; closeAllMenus(); handleStartRename(s); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              const s = sessionContextMenu.session;
              closeAllMenus();
              void (async () => {
                try {
                  const logPath = await getSessionLogPath(s.sessionId, s.encodedProjectDir);
                  await invoke("open_path", { path: logPath });
                } catch (err) {
                  console.error("[hoverpad] Failed to open log file:", err);
                }
              })();
            }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Open Log File
          </button>
          {sessionContextMenu.inGroupId && (
            <button
              type="button"
              onClick={() => { const { session, inGroupId } = sessionContextMenu; closeAllMenus(); void handleRemoveFromGroup(session.id, inGroupId!); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-amber-400 hover:bg-neutral-700/60 cursor-pointer"
            >
              Remove from Group
            </button>
          )}
          <div className="my-1 h-px bg-neutral-700/50" />
          <button
            type="button"
            onClick={() => { const s = sessionContextMenu.session; closeAllMenus(); void handleDeleteSession(s); }}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/60 cursor-pointer"
          >
            Delete
          </button>
        </ContextMenuPopover>
      )}

      {/* Group context menu */}
      {groupContextMenu && (
        <ContextMenuPopover x={groupContextMenu.x} y={groupContextMenu.y}>
          {groupContextMenu.type === "project" && (
            <button
              type="button"
              onClick={() => {
                const dir = groupContextMenu.id;
                closeAllMenus();
                void createSessionGroupWindow(dir);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
            >
              Open in Window
            </button>
          )}
          {groupContextMenu.type === "custom" && (
            <>
              <button
                type="button"
                onClick={() => {
                  const id = groupContextMenu.id;
                  closeAllMenus();
                  void createCustomGroupWindow(id);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
              >
                Open in Window
              </button>
              <button
                type="button"
                onClick={() => {
                  const group = manualGroups.find((g) => g.id === groupContextMenu.id);
                  closeAllMenus();
                  if (group) handleStartRenameGroup(group);
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
              >
                Rename
              </button>
            </>
          )}
          <div className="my-1 h-px bg-neutral-700/50" />
          {groupContextMenu.type === "project" ? (
            <button
              type="button"
              onClick={() => {
                const encodedDir = groupContextMenu.encodedDir;
                setGroupContextMenu(null);
                if (encodedDir) void handleDeleteProject(encodedDir);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/60 cursor-pointer"
            >
              Delete Project Logs
            </button>
          ) : (
            <button
              type="button"
              onClick={() => {
                const id = groupContextMenu.id;
                setGroupContextMenu(null);
                void handleDeleteGroup(id);
              }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/60 cursor-pointer"
            >
              Delete Group
            </button>
          )}
        </ContextMenuPopover>
      )}

      {/* Drag overlay — sessions */}
      {draggingSessionId && (
        <div
          ref={dragOverlayRef}
          className="fixed z-[100] pointer-events-none px-3 py-1 rounded-md bg-neutral-800 border border-neutral-600 shadow-lg text-xs text-neutral-200 font-mono whitespace-nowrap"
          style={{ left: -9999, top: -9999 }}
        >
          {draggingLabel}
        </div>
      )}

      {/* Drag overlay — groups */}
      {draggingGroupId && (
        <div
          ref={groupDragOverlayRef}
          className="fixed z-[100] pointer-events-none px-3 py-1 rounded-md bg-neutral-800 border border-blue-500/50 shadow-lg text-xs text-neutral-200 font-medium whitespace-nowrap"
          style={{ left: -9999, top: -9999 }}
        />
      )}
    </div>
  );
}
