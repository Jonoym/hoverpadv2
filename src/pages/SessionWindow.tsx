import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWindowStateSaver, saveWindowState } from "@/lib/windowState";
import { emitEvent, listenEvent } from "@/lib/events";
import { WindowChrome } from "@/components/WindowChrome";
import {
  SessionTimeline,
  AgentTabBar,
  deriveAgents,
} from "@/components/SessionTimeline";
import { useGlobalStore } from "@/stores/globalStore";
import {
  startTailing,
  stopTailing,
  startAgentTailing,
  stopAllAgentTailing,
  discoverSubagentIds,
  discoverSessions,
  renameSession,
  invalidateSessionCache,
  setSessionOpen,
  type SessionEvent,
  type SessionMeta,
} from "@/lib/sessionService";
import { invoke } from "@tauri-apps/api/core";
import { useWindowGrouping } from "@/lib/useWindowGrouping";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** After this many ms without an event while tailing, mark as idle (fallback). */
const IDLE_TIMEOUT_MS = 15_000;

/** Max events to keep in the sliding window while tailing. */
const MAX_TAILING_EVENTS = 500;

// ---------------------------------------------------------------------------
// Status → badge colour mapping
// ---------------------------------------------------------------------------

type SessionStatus = "active" | "idle" | "errored" | "completed" | "inactive";
type DisplayStatus = SessionStatus | "idle-agents";

const statusDotColor: Record<DisplayStatus, string> = {
  active: "bg-emerald-400",
  idle: "bg-amber-400",
  "idle-agents": "bg-indigo-400",
  errored: "bg-red-400",
  completed: "bg-purple-400",
  inactive: "bg-neutral-500",
};

/** Border color for flash when status changes. */
const statusFlashColor: Partial<Record<SessionStatus, string>> = {
  completed: "border-purple-500",
  errored: "border-red-500",
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionWindow() {
  const { id: sessionId } = useParams<{ id: string }>();

  // Persist window position/size to SQLite on move/resize
  useWindowStateSaver(sessionId, "sessions");

  // Event state
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [status, setStatus] = useState<SessionStatus>("active");
  const [compact, setCompact] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [isTailing, setIsTailing] = useState(false);
  const [hasNewEvents, setHasNewEvents] = useState(false);
  const [agentFilter, setAgentFilter] = useState<number | null>(null);
  const [agentEvents, setAgentEvents] = useState<Map<string, SessionEvent[]>>(new Map());
  const [agentLoading, setAgentLoading] = useState(false);
  /** Set of spawnIndex values for hidden (removed) agents. */
  const [hiddenAgents, setHiddenAgents] = useState<Set<number>>(new Set());

  // Total event count (persists across sliding window trims)
  const totalEventCountRef = useRef(0);

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventTimeRef = useRef<number>(Date.now());
  /** Tracks whether tailing was explicitly started (prevents double-start). */
  const tailingStartedRef = useRef(false);

  // Global store — look up the session metadata for encodedProjectDir
  const sessions = useGlobalStore((s) => s.sessions);
  const refreshSessions = useGlobalStore((s) => s.refreshSessions);
  const updateSessionLabel = useGlobalStore((s) => s.updateSessionLabel);
  const setSessionStatus = useGlobalStore((s) => s.setSessionStatus);
  const clearSessionStatus = useGlobalStore((s) => s.clearSessionStatus);

  // Push status changes to the global store so the control panel stays in sync
  useEffect(() => {
    if (sessionId) {
      const hasRunning = deriveAgents(events).some((a) => a.status === "running");
      const effective: SessionMeta["status"] =
        (status === "idle" || status === "completed") && hasRunning
          ? "idle-agents"
          : status;
      setSessionStatus(sessionId, effective);
    }
  }, [sessionId, status, events, setSessionStatus]);

  // Flash the window border + notify when status transitions to completed/errored
  const prevStatusRef = useRef<SessionStatus>(status);
  useEffect(() => {
    const prev = prevStatusRef.current;
    prevStatusRef.current = status;
    if (prev === status) return;
    if ((status === "completed" || status === "errored") && sessionId) {
      const flashColor = statusFlashColor[status];
      if (flashColor) {
        emitEvent("window:flash", { label: `session-${sessionId}`, color: flashColor }).catch(console.error);
      }
      // Notify the notification window
      const meta = useGlobalStore.getState().sessions.find((s) => s.sessionId === sessionId);
      const label = meta?.label || meta?.lastUserMessage?.slice(0, 60) || sessionId.slice(0, 8);
      emitEvent("session:notify", { sessionId, label, status }).catch(console.error);
    }
  }, [status, sessionId]);

  // Clear the override when the window unmounts
  useEffect(() => {
    return () => {
      if (sessionId) clearSessionStatus(sessionId);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ------------------------------------------------------------------
  // Listen for renames from other windows so our title stays in sync
  // ------------------------------------------------------------------

  useEffect(() => {
    const unlisten = listenEvent("session:renamed", (e) => {
      // Synchronous in-memory patch — no async refresh needed
      updateSessionLabel(e.payload.sessionId, e.payload.newLabel);
      // Invalidate this window's cache so the next poll doesn't revert the label
      invalidateSessionCache(e.payload.sessionId);
    });
    return () => { unlisten.then((fn) => fn()).catch(console.error); };
  }, [updateSessionLabel]);

  // ------------------------------------------------------------------
  // Idle detection
  // ------------------------------------------------------------------

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    lastEventTimeRef.current = Date.now();

    // When tailing goes quiet without a turn_duration signal, mark as completed (not idle).
    // The flow should be: active → completed → idle (on focus), never active → idle directly.
    idleTimerRef.current = setTimeout(() => {
      setStatus((prev) => (prev === "active" ? "completed" : prev));
    }, IDLE_TIMEOUT_MS);
  }, []);

  // ------------------------------------------------------------------
  // Focus detection — acknowledge "Done" → "Idle" on window focus
  // ------------------------------------------------------------------

  useEffect(() => {
    const handleFocus = () => {
      setStatus((prev) => (prev === "completed" ? "idle" : prev));
    };
    window.addEventListener("focus", handleFocus);
    return () => window.removeEventListener("focus", handleFocus);
  }, []);

  // ------------------------------------------------------------------
  // Event callback — appended events from tailing
  // ------------------------------------------------------------------

  const handleEvent = useCallback(
    (event: SessionEvent) => {
      totalEventCountRef.current += 1;
      setEvents((prev) => {
        const next = [...prev, event];
        // Sliding window: drop oldest events when tailing exceeds cap
        if (next.length > MAX_TAILING_EVENTS) {
          return next.slice(next.length - MAX_TAILING_EVENTS);
        }
        return next;
      });

      if (
        event.type === "system" &&
        event.summary?.toLowerCase().includes("error")
      ) {
        // Error detected in system event
        setStatus("errored");
      } else if (
        event.type === "system" &&
        event.summary?.toLowerCase().includes("turn completed")
      ) {
        // turn_duration signal — the turn finished
        setStatus("completed");
      } else {
        // Any other event means the session is actively working
        setStatus("active");
      }

      resetIdleTimer();

      // If user has scrolled away, show "new events" indicator
      if (!autoScroll) {
        setHasNewEvents(true);
      }
    },
    [autoScroll, resetIdleTimer],
  );

  // ------------------------------------------------------------------
  // Start / stop tailing
  // ------------------------------------------------------------------

  const doStartTailing = useCallback(
    async (sid: string, encodedProjectDir: string) => {
      if (tailingStartedRef.current) return;
      tailingStartedRef.current = true;
      setIsTailing(true);
      resetIdleTimer();
      await startTailing(sid, encodedProjectDir, handleEvent);
    },
    [handleEvent, resetIdleTimer],
  );

  const doStopTailing = useCallback(
    (sid: string) => {
      stopTailing(sid);
      tailingStartedRef.current = false;
      setIsTailing(false);
      if (idleTimerRef.current) {
        clearTimeout(idleTimerRef.current);
        idleTimerRef.current = null;
      }
      // Keep current status (don't flip to idle/completed automatically)
    },
    [],
  );

  // ------------------------------------------------------------------
  // Mount: discover sessions if needed, then start tailing
  // ------------------------------------------------------------------

  useEffect(() => {
    if (!sessionId) return;

    let cancelled = false;

    async function init() {
      // Try to find the session in the global store first
      let meta = sessions.find((s) => s.sessionId === sessionId);

      if (!meta) {
        // Not in store yet — trigger a discovery
        await refreshSessions();
      }

      // Re-check after refresh (need to read from store again)
      meta = useGlobalStore.getState().sessions.find((s) => s.sessionId === sessionId);

      if (!meta) {
        // Last resort: run discoverSessions directly
        const discovered = await discoverSessions();
        meta = discovered.find((s) => s.sessionId === sessionId);
      }

      if (cancelled) return;

      if (meta?.encodedProjectDir) {
        // Mark session window as open in SQLite for restore on next launch
        await setSessionOpen(sessionId!, true);

        await doStartTailing(sessionId!, meta.encodedProjectDir);

        // If the discovered status is "completed", reflect that
        if (meta.status === "completed") {
          setStatus("completed");
        } else if (meta.status === "errored") {
          setStatus("errored");
        }
      } else {
        console.warn(
          `[SessionWindow] Could not find encodedProjectDir for session ${sessionId}`,
        );
      }
    }

    void init();

    return () => {
      cancelled = true;
      if (sessionId) doStopTailing(sessionId);
      stopAllAgentTailing();
    };
    // Only run on mount / sessionId change — deliberately omitting doStartTailing/doStopTailing
    // to avoid infinite re-renders. These are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

  // ------------------------------------------------------------------
  // Agent tailing — start when an agent tab is selected
  // ------------------------------------------------------------------

  /** Tracks which agentIds we've already started tailing. */
  const tailedAgentIdsRef = useRef<Set<string>>(new Set());
  /** Maps agent tab ID → discovered file ID (for running agents without agentId). */
  const [agentTabFileMap, setAgentTabFileMap] = useState<Map<number, string>>(new Map());

  /**
   * Try to start tailing a sub-agent by its agentId.
   * Returns true if tailing was started (or already active).
   */
  const tryStartAgentTail = useCallback(
    (aid: string, description?: string) => {
      if (tailedAgentIdsRef.current.has(aid)) return true;
      if (!sessionId) return false;

      const meta = useGlobalStore
        .getState()
        .sessions.find((s) => s.sessionId === sessionId);
      if (!meta?.encodedProjectDir) return false;

      tailedAgentIdsRef.current.add(aid);
      setAgentLoading(true);

      const collectedEvents: SessionEvent[] = [];

      void startAgentTailing(sessionId, meta.encodedProjectDir, aid, (event) => {
        collectedEvents.push(event);
        setAgentEvents((prev) => {
          const next = new Map(prev);
          next.set(aid, [...collectedEvents]);
          return next;
        });
        setAgentLoading(false);
      }, description).then(() => {
        setAgentLoading(false);
      });

      return true;
    },
    [sessionId],
  );

  // When an agent tab is selected, start tailing — either via known agentId
  // or by discovering sub-agent files on disk for running agents.
  useEffect(() => {
    if (agentFilter === null || !sessionId) return;

    const agents = deriveAgents(events);
    const agent = agents.find((a) => a.id === agentFilter);
    if (!agent) return;

    // If we already know the agentId (agent completed), start tailing directly
    if (agent.agentId) {
      tryStartAgentTail(agent.agentId, agent.description);
      return;
    }

    // Agent is still running — discover sub-agent files on disk and match by order
    const meta = useGlobalStore
      .getState()
      .sessions.find((s) => s.sessionId === sessionId);
    if (!meta?.encodedProjectDir) return;

    let cancelled = false;

    // Poll for sub-agent files until we find one for this agent.
    // To handle resumed sessions (where old sub-agent files exist), we
    // exclude file IDs that are already known from completed agents or
    // already being tailed, then match remaining files to remaining
    // running agents by spawn order.
    const pollForFile = async () => {
      while (!cancelled) {
        const fileIds = await discoverSubagentIds(sessionId, meta.encodedProjectDir);

        // Collect all agentIds already accounted for (completed agents + tailed)
        const currentAgents = deriveAgents(events);
        const accountedIds = new Set<string>(tailedAgentIdsRef.current);
        for (const a of currentAgents) {
          if (a.agentId) accountedIds.add(a.agentId);
        }

        // Unaccounted file IDs (new files from this run)
        const newFileIds = fileIds.filter((id) => !accountedIds.has(id));

        // Running agents without an agentId, sorted by spawn order
        const runningAgents = currentAgents
          .filter((a) => !a.agentId)
          .sort((a, b) => a.spawnIndex - b.spawnIndex);

        // Match by order: 1st new file → 1st running agent, etc.
        for (let i = 0; i < runningAgents.length && i < newFileIds.length; i++) {
          if (runningAgents[i]!.id === agentFilter) {
            const fileId = newFileIds[i]!;
            setAgentTabFileMap((prev) => new Map(prev).set(agentFilter, fileId));
            tryStartAgentTail(fileId, agent.description);
            return; // Done — file found and tailing started
          }
        }

        // Wait before trying again
        await new Promise((r) => setTimeout(r, 1000));
      }
    };

    void pollForFile();

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, sessionId, events.length, tryStartAgentTail]);

  // ------------------------------------------------------------------
  // Auto-scroll
  // ------------------------------------------------------------------

  useEffect(() => {
    if (autoScroll && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events, autoScroll]);

  const handleScroll = useCallback(() => {
    if (!scrollRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 40;

    if (!isAtBottom && autoScroll) {
      setAutoScroll(false);
    } else if (isAtBottom && !autoScroll) {
      setAutoScroll(true);
      setHasNewEvents(false);
    }
  }, [autoScroll]);

  const handleResumeScroll = useCallback(() => {
    setAutoScroll(true);
    setHasNewEvents(false);
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  // ------------------------------------------------------------------
  // Controls
  // ------------------------------------------------------------------

  const handleToggleTailing = useCallback(() => {
    if (!sessionId) return;

    if (isTailing) {
      doStopTailing(sessionId);
    } else {
      // Re-start from scratch: clear old events, stop agent tails, re-parse full log
      setEvents([]);
      totalEventCountRef.current = 0;
      setAgentEvents(new Map());
      setAgentTabFileMap(new Map());
      tailedAgentIdsRef.current = new Set();
      stopAllAgentTailing();
      const meta = useGlobalStore
        .getState()
        .sessions.find((s) => s.sessionId === sessionId);
      if (meta?.encodedProjectDir) {
        void doStartTailing(sessionId, meta.encodedProjectDir);
      }
    }
  }, [sessionId, isTailing, doStartTailing, doStopTailing]);

  const handleClear = useCallback(() => {
    setEvents([]);
    totalEventCountRef.current = 0;
    setHasNewEvents(false);
  }, []);

  const handleToggleCompact = useCallback(() => {
    setCompact((prev) => !prev);
  }, []);

  const handleToggleAutoScroll = useCallback(() => {
    setAutoScroll((prev) => {
      if (!prev) {
        // Turning auto-scroll on — jump to bottom
        setHasNewEvents(false);
        requestAnimationFrame(() => {
          if (scrollRef.current) {
            scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
          }
        });
      }
      return !prev;
    });
  }, []);

  // ------------------------------------------------------------------
  // Close handler — stop tailing
  // ------------------------------------------------------------------

  const handleBeforeClose = useCallback(async () => {
    if (sessionId) {
      // Save window position/size immediately before closing
      await saveWindowState(sessionId, "sessions");
      doStopTailing(sessionId);
      await setSessionOpen(sessionId, false);
    }
    stopAllAgentTailing();
  }, [sessionId, doStopTailing]);

  // ------------------------------------------------------------------
  // Rename handler
  // ------------------------------------------------------------------

  // ------------------------------------------------------------------
  // Rename handler
  // ------------------------------------------------------------------

  const handleRename = useCallback(async (newName: string) => {
    if (!sessionId) return;
    const label = newName || null;
    // 1. Synchronous store patch — title updates immediately, no flicker
    updateSessionLabel(sessionId, label);
    try {
      // 2. Persist to DB + invalidate cache
      await renameSession(sessionId, label);
      // 3. Broadcast to other windows
      await emitEvent("session:renamed", { sessionId, newLabel: label });
    } catch (err) {
      console.error("[hoverpad] Failed to rename session:", err);
    }
  }, [sessionId, updateSessionLabel]);

  // ------------------------------------------------------------------
  // Window grouping (drag-snap auto-group/ungroup)
  // ------------------------------------------------------------------

  const { isGrouped, snapPreview, ungroup: handleUngroup, ungroupAll: handleUngroupAll } = useWindowGrouping();

  // ------------------------------------------------------------------
  // Derive display values
  // ------------------------------------------------------------------

  const sessionMeta = sessions.find((s) => s.sessionId === sessionId);
  const displayTitle = sessionMeta?.label || `Session ${sessionId ? sessionId.slice(0, 8) : ""}`;

  // If idle but agents are still running, show indigo
  const hasRunningAgents = deriveAgents(events).some((a) => a.status === "running");
  const displayStatus: DisplayStatus =
    (status === "idle" || status === "completed") && hasRunningAgents
      ? "idle-agents"
      : status;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <WindowChrome
      title={displayTitle}
      statusDot={{ color: statusDotColor[displayStatus] }}
      onBeforeClose={handleBeforeClose}
      onRename={(name) => void handleRename(name)}
      isGrouped={isGrouped}
      onUngroup={isGrouped ? () => void handleUngroup() : undefined}
      onUngroupAll={isGrouped ? () => void handleUngroupAll() : undefined}
      snapPreview={snapPreview}
    >
      {/* Controls bar */}
      <div
        className={cn(
          "flex items-center gap-1.5",
          "rounded-lg bg-neutral-800/40 border border-neutral-700/30",
          "px-2 py-1",
        )}
      >
        {/* Focus in VS Code */}
        {sessionMeta?.workingDir && (
          <button
            type="button"
            onClick={() => invoke("resume_session", { workingDir: sessionMeta.workingDir }).catch(console.error)}
            className={cn(
              "flex h-6 items-center gap-1.5 rounded-md px-2 transition-colors duration-150",
              "bg-blue-500/15 text-blue-400 hover:bg-blue-500/25",
            )}
            title="Open in VS Code"
          >
            <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
              <path d="M10 2h4v4" />
              <path d="M14 2L7 9" />
            </svg>
            <span className="text-xs font-medium">Open</span>
          </button>
        )}

        {/* Divider */}
        <div className="h-4 w-px bg-neutral-700/50" />

        {/* Play / Pause icon button */}
        <button
          type="button"
          onClick={handleToggleTailing}
          className={cn(
            "flex h-6 w-6 items-center justify-center rounded-md transition-colors duration-150",
            isTailing
              ? "text-emerald-400 hover:bg-emerald-500/20"
              : "text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200",
          )}
          title={isTailing ? "Pause tailing" : "Resume tailing"}
        >
          {isTailing ? (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <rect x="1" y="1" width="3" height="8" rx="0.5" />
              <rect x="6" y="1" width="3" height="8" rx="0.5" />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" fill="currentColor">
              <path d="M2 1L9 5L2 9V1Z" />
            </svg>
          )}
        </button>

        {/* Clear icon button */}
        <button
          type="button"
          onClick={handleClear}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral-400 transition-colors duration-150 hover:bg-neutral-700/50 hover:text-neutral-200"
          title="Clear event log"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M1 1L9 9M9 1L1 9" />
          </svg>
        </button>

        {/* Divider */}
        <div className="h-4 w-px bg-neutral-700/50" />

        {/* Compact / Expanded toggle */}
        <button
          type="button"
          onClick={handleToggleCompact}
          className={cn(
            "flex h-6 items-center rounded-md px-1.5 text-xs font-medium transition-colors duration-150",
            compact
              ? "bg-blue-500/15 text-blue-400"
              : "text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200",
          )}
          title={compact ? "Switch to expanded view" : "Switch to compact view"}
        >
          {compact ? "Compact" : "Expanded"}
        </button>

        {/* Auto-scroll toggle */}
        <button
          type="button"
          onClick={handleToggleAutoScroll}
          className={cn(
            "flex h-6 items-center rounded-md px-1.5 text-xs font-medium transition-colors duration-150",
            autoScroll
              ? "bg-blue-500/15 text-blue-400"
              : "text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200",
          )}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        >
          {autoScroll ? "Auto" : "Manual"}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Event count */}
        <span className="text-xs text-neutral-500">
          {totalEventCountRef.current > events.length
            ? `${events.length}/${totalEventCountRef.current}`
            : events.length}{" "}
          event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Agent tab bar */}
      {(() => {
        const allAgents = deriveAgents(events);
        const agents = allAgents.filter((a) => !hiddenAgents.has(a.spawnIndex));

        // Determine which events to show based on selected agent tab
        let filteredEvents: SessionEvent[];
        let showLoading = false;

        if (agentFilter !== null) {
          const agent = agents.find((a) => a.id === agentFilter);

          // Find agent events — check by known agentId first, then by any
          // key in agentEvents that we're tailing for this agent
          // Find events for this agent tab — by known agentId or discovered file
          let agentEventsForTab: SessionEvent[] | undefined;
          if (agent?.agentId && agentEvents.has(agent.agentId)) {
            agentEventsForTab = agentEvents.get(agent.agentId);
          } else {
            // Check if we discovered a file for this tab via directory scan
            const discoveredId = agentTabFileMap.get(agentFilter!);
            if (discoveredId && agentEvents.has(discoveredId)) {
              agentEventsForTab = agentEvents.get(discoveredId);
            }
          }

          if (agentEventsForTab && agentEventsForTab.length > 0) {
            filteredEvents = agentEventsForTab;
          } else if (agentLoading) {
            filteredEvents = [];
            showLoading = true;
          } else {
            // No data yet — show spawn + result from main
            filteredEvents = events.filter((_e, i) => {
              return (
                agent &&
                (i === agent.spawnIndex || i === agent.resultIndex)
              );
            });
          }
        } else {
          filteredEvents = events;
        }

        return (
          <>
            <AgentTabBar
              agents={agents}
              selectedAgent={agentFilter}
              onSelect={setAgentFilter}
              onRemoveAgent={(id) => {
                const agent = agents.find((a) => a.id === id);
                if (agent) {
                  setHiddenAgents((prev) => new Set([...prev, agent.spawnIndex]));
                  if (agentFilter === id) setAgentFilter(null);
                }
              }}
              onRemoveAllAgents={() => {
                setHiddenAgents(new Set(allAgents.map((a) => a.spawnIndex)));
                setAgentFilter(null);
              }}
            />

            {/* Timeline */}
            <div
              ref={scrollRef}
              onScroll={handleScroll}
              className="relative flex-1 overflow-y-auto pr-2"
            >
              {showLoading ? (
                <div className="flex flex-1 items-center justify-center py-8 text-sm text-neutral-500">
                  Loading agent events...
                </div>
              ) : (
                <SessionTimeline events={filteredEvents} compact={compact} />
              )}

              {/* "New events" indicator */}
              {hasNewEvents && !autoScroll && (
                <button
                  type="button"
                  onClick={handleResumeScroll}
                  className={cn(
                    "sticky bottom-2 left-1/2 -translate-x-1/2",
                    "rounded-full px-3 py-1 cursor-pointer",
                    "bg-blue-600/80 text-xs text-neutral-100",
                    "shadow-lg backdrop-blur-sm",
                    "transition-colors duration-150 hover:bg-blue-600",
                  )}
                >
                  New events ↓
                </button>
              )}
            </div>
          </>
        );
      })()}
    </WindowChrome>
  );
}
