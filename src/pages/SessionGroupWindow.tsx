import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useParams } from "react-router-dom";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import { WindowChrome } from "@/components/WindowChrome";
import { useWindowStateSaver, saveWindowState } from "@/lib/windowState";
import { createSessionWindow } from "@/lib/windowManager";
import { ContextMenuPopover } from "@/components/ContextMenu";
import {
  discoverSessions,
  listSessions,
  setSessionOpen,
  setSessionGroupOpen,
  getSessionGroupIdForProject,
  listManualGroups,
  renameManualGroup,
  renameSession,
  invalidateSessionCache,
  deleteSession,
  getSessionLogPath,
  toHomeRelativePath,
  type SessionMeta,
} from "@/lib/sessionService";
import { emitEvent, listenEvent } from "@/lib/events";
import { useGlobalStore } from "@/stores/globalStore";
import { getSetting, setSetting } from "@/lib/settingsService";
import { homeDir } from "@tauri-apps/api/path";
import { invoke } from "@tauri-apps/api/core";
import { useWindowGrouping } from "@/lib/useWindowGrouping";

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

const STATUS_ORDER: Record<string, number> = {
  active: 0,
  "idle-agents": 1,
  idle: 2,
  errored: 3,
  completed: 4,
  inactive: 5,
};

const DRAG_THRESHOLD = 5;


// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionGroupWindow() {
  const { groupType, groupId } = useParams<{ groupType: string; groupId: string }>();
  const isProject = groupType === "project";
  const decodedId = groupId ? decodeURIComponent(groupId) : "";
  const orderKey = `sg-order:${groupType}:${decodedId}`;

  // Resolve the session_groups.id for window state persistence
  const [dbGroupId, setDbGroupId] = useState<string | undefined>(
    isProject ? undefined : decodedId,
  );

  useEffect(() => {
    if (!isProject || !decodedId) return;
    getSessionGroupIdForProject(decodedId).then((id) => {
      if (id) setDbGroupId(id);
    }).catch(console.error);
  }, [isProject, decodedId]);

  // Persist window position/size
  useWindowStateSaver(dbGroupId, "session_groups");

  // Track open state
  useEffect(() => {
    if (!dbGroupId) return;
    setSessionGroupOpen(dbGroupId, true).catch(console.error);
    return () => {
      saveWindowState(dbGroupId, "session_groups").catch(console.error);
      setSessionGroupOpen(dbGroupId, false).catch(console.error);
    };
  }, [dbGroupId]);

  const [title, setTitle] = useState(() =>
    isProject ? (decodedId.split(/[/\\]/).filter(Boolean).pop() || decodedId) : "Group",
  );
  const [sessions, setSessions] = useState<SessionMeta[]>([]);
  const [filter, setFilter] = useState("");
  const [openSessionIds, setOpenSessionIds] = useState<Set<string>>(new Set());
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const [homePath, setHomePath] = useState("");

  // Persisted order: array of session IDs
  const [savedOrder, setSavedOrder] = useState<string[]>([]);
  const orderLoadedRef = useRef(false);

  // Context menu
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number; session: SessionMeta } | null>(null);
  // Inline rename
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);

  // Drag state
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);
  const dropIndexRef = useRef<number | null>(null);
  const dragDataRef = useRef<{ sessionId: string; startX: number; startY: number; started: boolean } | null>(null);
  const dragOverlayRef = useRef<HTMLDivElement>(null);
  const rowRefs = useRef(new Map<string, HTMLDivElement>());
  const dragCleanupRef = useRef<(() => void) | null>(null);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu]);

  // Focus rename input
  useEffect(() => {
    if (renamingId && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingId]);

  // Load saved order on mount
  useEffect(() => {
    getSetting(orderKey).then((val) => {
      if (val) {
        try { setSavedOrder(JSON.parse(val)); } catch { /* ignore */ }
      }
      orderLoadedRef.current = true;
    }).catch(console.error);
  }, [orderKey]);

  const filterSessions = useCallback((all: SessionMeta[]) => {
    if (isProject) {
      return all.filter((s) => s.projectDir === decodedId);
    }
    return all.filter((s) => s.manualGroupIds.includes(decodedId));
  }, [decodedId, isProject]);

  const refresh = useCallback(async () => {
    try {
      const all = await discoverSessions();
      // Apply status overrides from open session windows (same as globalStore)
      const overrides = useGlobalStore.getState().sessionStatusOverrides;
      for (const session of all) {
        const override = overrides[session.sessionId];
        if (override) {
          session.status = override;
        }
      }
      setSessions(filterSessions(all));
      if (!isProject) {
        const groups = await listManualGroups();
        const group = groups.find((g) => g.id === decodedId);
        if (group) setTitle(group.name);
      }
    } catch (err) {
      console.error("[hoverpad] Failed to load sessions for group:", err);
    }
  }, [decodedId, isProject, filterSessions]);

  const refreshOpenIds = useCallback(async () => {
    const ids = new Set<string>();
    for (const s of sessions) {
      const win = await WebviewWindow.getByLabel(`session-${s.sessionId}`);
      if (win) ids.add(s.id);
    }
    setOpenSessionIds(ids);
  }, [sessions]);

  // Subscribe to status override changes for immediate updates
  const sessionStatusOverrides = useGlobalStore((s) => s.sessionStatusOverrides);
  useEffect(() => {
    setSessions((prev) => {
      let changed = false;
      const updated = prev.map((s) => {
        const override = sessionStatusOverrides[s.sessionId];
        if (override && s.status !== override) {
          changed = true;
          return { ...s, status: override };
        }
        return s;
      });
      return changed ? updated : prev;
    });
  }, [sessionStatusOverrides]);

  useEffect(() => {
    homeDir().then(setHomePath).catch(console.error);
    // Fast: load from DB immediately so labels/names appear right away
    listSessions().then((all) => setSessions(filterSessions(all))).catch(console.error);
    // Then do a full disk scan to pick up fresh status
    void refresh();
    const interval = setInterval(() => void refresh(), 5_000);
    const unlistenRename = listenEvent("session:renamed", (e) => {
      // Synchronous in-memory patch — no async, no races
      setSessions((prev) =>
        prev.map((s) =>
          s.sessionId === e.payload.sessionId ? { ...s, label: e.payload.newLabel } : s,
        ),
      );
      // Invalidate this window's cache so the next 5s poll doesn't revert the label
      invalidateSessionCache(e.payload.sessionId);
    });
    return () => {
      clearInterval(interval);
      unlistenRename.then((fn) => fn()).catch(console.error);
    };
  }, [refresh, filterSessions]);

  useEffect(() => {
    void refreshOpenIds();
    const interval = setInterval(() => void refreshOpenIds(), 2_000);
    return () => clearInterval(interval);
  }, [refreshOpenIds]);

  // Sort sessions: use saved order, new sessions go to top sorted by status/date
  const sorted = useMemo(() => {
    const filtered = filter.trim()
      ? sessions.filter((s) => {
          const q = filter.toLowerCase();
          return (
            s.label?.toLowerCase().includes(q) ||
            s.sessionId.toLowerCase().includes(q) ||
            s.workingDir?.toLowerCase().includes(q) ||
            s.lastUserMessage?.toLowerCase().includes(q)
          );
        })
      : sessions;

    if (savedOrder.length === 0) {
      // No saved order — use default status/date sort
      return [...filtered].sort((a, b) => {
        const sa = STATUS_ORDER[a.status] ?? 5;
        const sb = STATUS_ORDER[b.status] ?? 5;
        if (sa !== sb) return sa - sb;
        return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
      });
    }

    const orderMap = new Map(savedOrder.map((id, i) => [id, i]));
    const known = filtered.filter((s) => orderMap.has(s.id));
    const unknown = filtered.filter((s) => !orderMap.has(s.id));

    // New sessions go to top, sorted by status/date
    unknown.sort((a, b) => {
      const sa = STATUS_ORDER[a.status] ?? 5;
      const sb = STATUS_ORDER[b.status] ?? 5;
      if (sa !== sb) return sa - sb;
      return new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime();
    });

    // Known sessions in saved order
    known.sort((a, b) => orderMap.get(a.id)! - orderMap.get(b.id)!);

    return [...unknown, ...known];
  }, [sessions, savedOrder, filter]);

  const saveOrder = useCallback((ids: string[]) => {
    setSavedOrder(ids);
    void setSetting(orderKey, JSON.stringify(ids));
  }, [orderKey]);

  // ---- Drag-to-reorder ----

  const getDropIndex = useCallback((y: number): number => {
    let closest: { idx: number; dist: number } | null = null;
    for (let i = 0; i < sorted.length; i++) {
      const el = rowRefs.current.get(sorted[i]!.id);
      if (!el) continue;
      const rect = el.getBoundingClientRect();
      const mid = rect.top + rect.height / 2;
      const dist = Math.abs(y - mid);
      if (!closest || dist < closest.dist) {
        closest = { idx: y < mid ? i : i + 1, dist };
      }
    }
    return closest?.idx ?? sorted.length;
  }, [sorted]);

  const handleDragStart = useCallback((sessionId: string, e: React.PointerEvent) => {
    const tag = (e.target as HTMLElement).tagName;
    if (tag === "INPUT" || tag === "BUTTON") return;
    e.preventDefault();

    const session = sessions.find((s) => s.id === sessionId);
    const label = session?.label || sessionId.slice(0, 8);
    dragDataRef.current = { sessionId, startX: e.clientX, startY: e.clientY, started: false };

    const onPointerMove = (ev: PointerEvent) => {
      if (!dragDataRef.current) return;
      const dx = ev.clientX - dragDataRef.current.startX;
      const dy = ev.clientY - dragDataRef.current.startY;

      if (!dragDataRef.current.started) {
        if (Math.abs(dx) < DRAG_THRESHOLD && Math.abs(dy) < DRAG_THRESHOLD) return;
        dragDataRef.current.started = true;
        setDraggingId(sessionId);
      }

      if (dragOverlayRef.current) {
        dragOverlayRef.current.style.left = `${ev.clientX + 12}px`;
        dragOverlayRef.current.style.top = `${ev.clientY - 10}px`;
        dragOverlayRef.current.textContent = label;
      }

      const idx = getDropIndex(ev.clientY);
      dropIndexRef.current = idx;
      setDropIndex(idx);
    };

    const onPointerUp = () => {
      cleanup();
      if (!dragDataRef.current?.started) {
        dragDataRef.current = null;
        return;
      }

      const finalIdx = dropIndexRef.current;
      const draggedId = dragDataRef.current.sessionId;
      dragDataRef.current = null;
      dropIndexRef.current = null;
      setDraggingId(null);
      setDropIndex(null);

      if (finalIdx !== null) {
        // Build new order
        const currentIds = sorted.map((s) => s.id);
        const fromIdx = currentIds.indexOf(draggedId);
        if (fromIdx !== -1) {
          currentIds.splice(fromIdx, 1);
          const insertAt = finalIdx > fromIdx ? finalIdx - 1 : finalIdx;
          currentIds.splice(insertAt, 0, draggedId);
          saveOrder(currentIds);
        }
      }
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onPointerMove);
      document.removeEventListener("pointerup", onPointerUp);
      dragCleanupRef.current = null;
    };

    document.addEventListener("pointermove", onPointerMove);
    document.addEventListener("pointerup", onPointerUp);
    dragCleanupRef.current = cleanup;
  }, [sessions, sorted, getDropIndex, saveOrder]);

  // Clean up drag on unmount
  useEffect(() => {
    return () => { dragCleanupRef.current?.(); };
  }, []);

  // ---- Handlers ----

  const handleOpenSession = async (session: SessionMeta) => {
    try {
      await setSessionOpen(session.sessionId, true);
      await createSessionWindow(session.sessionId);
      setOpenSessionIds((prev) => new Set([...prev, session.id]));
    } catch (err) {
      console.error("[hoverpad] Failed to open session window:", err);
    }
  };

  const handleOpenVSCode = async (session: SessionMeta) => {
    if (!session.workingDir) return;
    try {
      await invoke("resume_session", { workingDir: session.workingDir });
    } catch (err) {
      console.error("[hoverpad] Failed to open VS Code:", err);
    }
  };

  const handleCopyResume = (session: SessionMeta) => {
    const cmd = `claude --resume "${session.sessionId}"`;
    navigator.clipboard.writeText(cmd).catch((err) => {
      console.error("[hoverpad] Failed to copy to clipboard:", err);
    });
    setCopiedId(session.id);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  };

  const handleRename = async (newName: string) => {
    if (!isProject) {
      try {
        await renameManualGroup(decodedId, newName);
        setTitle(newName);
      } catch (err) {
        console.error("[hoverpad] Failed to rename group:", err);
      }
    }
  };

  const { isGrouped, snapPreview, ungroup: handleUngroup, ungroupAll: handleUngroupAll } = useWindowGrouping();

  const handleStartRename = (session: SessionMeta) => {
    setCtxMenu(null);
    setRenamingId(session.id);
    setRenameValue(session.label || session.sessionId.slice(0, 8));
  };

  const handleFinishRename = async () => {
    if (!renamingId) return;
    const trimmed = renameValue.trim();
    const label = trimmed && trimmed !== renamingId.slice(0, 8) ? trimmed : null;
    // 1. Synchronous local patch — instant UI update, no races
    setSessions((prev) =>
      prev.map((s) => (s.id === renamingId ? { ...s, label } : s)),
    );
    setRenamingId(null);
    try {
      // 2. Persist to DB + invalidate cache
      await renameSession(renamingId, label);
      // 3. Broadcast to other windows
      await emitEvent("session:renamed", { sessionId: renamingId, newLabel: label });
    } catch (err) {
      console.error("[hoverpad] Failed to rename session:", err);
    }
  };

  const handleOpenLogFile = async (session: SessionMeta) => {
    setCtxMenu(null);
    try {
      const logPath = await getSessionLogPath(session.sessionId, session.encodedProjectDir);
      await invoke("open_path", { path: logPath });
    } catch (err) {
      console.error("[hoverpad] Failed to open log file:", err);
    }
  };

  const handleDeleteSession = async (session: SessionMeta) => {
    setCtxMenu(null);
    try {
      await deleteSession(session.id, session.encodedProjectDir);
      // Remove from saved order
      saveOrder(savedOrder.filter((id) => id !== session.id));
      void refresh();
    } catch (err) {
      console.error("[hoverpad] Failed to delete session:", err);
    }
  };

  const running = sessions.filter((s) => s.status === "active").length;
  const idle = sessions.filter((s) => s.status === "idle").length;
  const idleAgents = sessions.filter((s) => s.status === "idle-agents").length;
  const done = sessions.filter((s) => s.status === "completed").length;
  const errored = sessions.filter((s) => s.status === "errored").length;

  return (
    <WindowChrome
      title={title}
      titleIcon={isProject ? (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
        </svg>
      ) : (
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 2 7 12 12 22 7 12 2" />
          <polyline points="2 17 12 22 22 17" />
          <polyline points="2 12 12 17 22 12" />
        </svg>
      )}
      showMinimize={true}
      onRename={!isProject ? handleRename : undefined}
      isGrouped={isGrouped}
      onUngroup={isGrouped ? () => void handleUngroup() : undefined}
      onUngroupAll={isGrouped ? () => void handleUngroupAll() : undefined}
      snapPreview={snapPreview}
    >
      {/* Header stats */}
      <div className="flex items-center gap-3 px-1 pb-2 text-xs text-neutral-500">
        <span className="flex items-center gap-1.5 shrink-0">
          {running > 0 && <span className="text-emerald-400">{running} running</span>}
          {idleAgents > 0 && <span className="text-indigo-400">{idleAgents} agents</span>}
          {idle > 0 && <span className="text-amber-400">{idle} idle</span>}
          {done > 0 && <span className="text-purple-400">{done} done</span>}
          {errored > 0 && <span className="text-red-400">{errored} errored</span>}
          {sessions.length === 0 && <span className="text-neutral-600">No sessions</span>}
        </span>
        <input
          type="text"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter..."
          className="ml-auto w-32 rounded-lg border border-neutral-700/50 bg-neutral-800/50 px-2 py-1 text-xs text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Session list */}
      <div className="flex-1 overflow-y-auto pr-2">
        <div className="flex flex-col gap-0.5">
          {sorted.map((session, idx) => (
            <div key={session.id}>
              {/* Drop indicator */}
              {draggingId && dropIndex === idx && draggingId !== session.id && (
                <div className="h-0.5 mx-2 my-0.5 rounded bg-blue-500/60" />
              )}
              <div
                ref={(el) => { if (el) rowRefs.current.set(session.id, el); else rowRefs.current.delete(session.id); }}
                className={cn(
                  "group flex items-center gap-2 rounded-lg px-3 py-1.5",
                  "transition-colors duration-150 hover:bg-neutral-800/50",
                  "border cursor-grab active:cursor-grabbing",
                  openSessionIds.has(session.id) ? STATUS_BORDER_COLORS[session.status] : "border-transparent",
                  draggingId === session.id && "opacity-40",
                )}
                onClick={() => {
                  if (renamingId !== session.id && !dragDataRef.current?.started) void handleOpenSession(session);
                }}
                onContextMenu={(e) => {
                  e.preventDefault();
                  setCtxMenu({ x: e.clientX, y: e.clientY, session });
                }}
                onPointerDown={(e) => handleDragStart(session.id, e)}
              >
                {/* Status dot */}
                <span
                  className={cn(
                    "h-2 w-2 shrink-0 rounded-full",
                    STATUS_DOT_COLORS[session.status],
                  )}
                  title={STATUS_LABELS[session.status]}
                />

                {/* Info */}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {renamingId === session.id ? (
                      <input
                        ref={renameInputRef}
                        type="text"
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onBlur={() => void handleFinishRename()}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void handleFinishRename();
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="text-xs font-mono text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 w-32 outline-none focus:border-blue-500"
                      />
                    ) : (
                      <span className="text-sm font-mono text-neutral-400">
                        {session.label || session.sessionId.slice(0, 8)}
                      </span>
                    )}
                    <span className="text-xs text-neutral-500">
                      {timeAgo(session.startedAt)}
                    </span>
                  </div>
                  {session.lastUserMessage && (
                    <p className="line-clamp-2 text-xs text-neutral-300" title={session.lastUserMessage}>
                      {session.lastUserMessage}
                    </p>
                  )}
                  {session.workingDir && (
                    <p className="truncate text-xs text-neutral-600" title={session.workingDir}>
                      {toHomeRelativePath(session.workingDir, homePath)}
                    </p>
                  )}
                </div>

                {/* Actions */}
                <div className="flex items-center gap-1.5 shrink-0">
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); handleCopyResume(session); }}
                    className={cn(
                      "shrink-0 flex h-5 w-5 items-center justify-center rounded transition-colors duration-150 cursor-pointer",
                      copiedId === session.id
                        ? "text-emerald-400"
                        : "text-neutral-500 hover:text-neutral-300",
                    )}
                    title="Copy claude --resume command"
                  >
                    {copiedId === session.id ? (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M3 8.5L6.5 12L13 4" />
                      </svg>
                    ) : (
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                        <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
                        <path d="M10.5 5.5V3.5C10.5 2.67 9.83 2 9 2H3.5C2.67 2 2 2.67 2 3.5V9C2 9.83 2.67 10.5 3.5 10.5H5.5" />
                      </svg>
                    )}
                  </button>
                  {session.workingDir && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); void handleOpenVSCode(session); }}
                      className="shrink-0 flex h-5 w-5 items-center justify-center rounded text-neutral-500 transition-colors duration-150 hover:text-blue-400 cursor-pointer"
                      title="Open in VS Code"
                    >
                      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
                        <path d="M10 2h4v4" />
                        <path d="M14 2L7 9" />
                      </svg>
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
          {/* Drop indicator after last item */}
          {draggingId && dropIndex === sorted.length && (
            <div className="h-0.5 mx-2 my-0.5 rounded bg-blue-500/60" />
          )}

          {sorted.length === 0 && (
            <p className="px-3 py-4 text-center text-xs text-neutral-600 italic">
              {filter ? "No matching sessions" : "No sessions found"}
            </p>
          )}
        </div>
      </div>

      {/* Session context menu */}
      {ctxMenu && (
        <ContextMenuPopover x={ctxMenu.x} y={ctxMenu.y}>
          <button
            type="button"
            onClick={() => handleStartRename(ctxMenu.session)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => void handleOpenLogFile(ctxMenu.session)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Open Log File
          </button>
          <div className="my-1 h-px bg-neutral-700/50" />
          <button
            type="button"
            onClick={() => void handleDeleteSession(ctxMenu.session)}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/60 cursor-pointer"
          >
            Delete
          </button>
        </ContextMenuPopover>
      )}

      {/* Drag overlay */}
      {draggingId && (
        <div
          ref={dragOverlayRef}
          className="fixed z-[100] pointer-events-none px-3 py-1 rounded-md bg-neutral-800 border border-neutral-600 shadow-lg text-xs text-neutral-200 font-mono whitespace-nowrap"
          style={{ left: -9999, top: -9999 }}
        />
      )}
    </WindowChrome>
  );
}
