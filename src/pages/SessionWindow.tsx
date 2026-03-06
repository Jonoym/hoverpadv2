import {
  useState,
  useEffect,
  useRef,
  useCallback,
} from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWindowStateSaver } from "@/lib/windowState";
import { WindowChrome } from "@/components/WindowChrome";
import { SessionTimeline } from "@/components/SessionTimeline";
import { useGlobalStore } from "@/stores/globalStore";
import {
  startTailing,
  stopTailing,
  discoverSessions,
  type SessionEvent,
} from "@/lib/sessionService";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** After this many ms without an event while tailing, we consider the session idle. */
const IDLE_TIMEOUT_MS = 30_000;

// ---------------------------------------------------------------------------
// Status → badge colour mapping
// ---------------------------------------------------------------------------

type SessionStatus = "active" | "idle" | "errored" | "completed";

const statusBadge: Record<
  SessionStatus,
  { label: string; color: "emerald" | "amber" | "red" | "purple" }
> = {
  active: { label: "Active", color: "emerald" },
  idle: { label: "Idle", color: "amber" },
  errored: { label: "Error", color: "red" },
  completed: { label: "Done", color: "purple" },
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

  // Refs
  const scrollRef = useRef<HTMLDivElement>(null);
  const idleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastEventTimeRef = useRef<number>(Date.now());
  /** Tracks whether tailing was explicitly started (prevents double-start). */
  const tailingStartedRef = useRef(false);

  // Global store — look up the session metadata for encodedProjectDir
  const sessions = useGlobalStore((s) => s.sessions);
  const refreshSessions = useGlobalStore((s) => s.refreshSessions);

  // ------------------------------------------------------------------
  // Idle detection
  // ------------------------------------------------------------------

  const resetIdleTimer = useCallback(() => {
    if (idleTimerRef.current) clearTimeout(idleTimerRef.current);
    lastEventTimeRef.current = Date.now();

    // Only go idle while we're actively tailing
    idleTimerRef.current = setTimeout(() => {
      setStatus((prev) => (prev === "active" ? "idle" : prev));
    }, IDLE_TIMEOUT_MS);
  }, []);

  // ------------------------------------------------------------------
  // Event callback — appended events from tailing
  // ------------------------------------------------------------------

  const handleEvent = useCallback(
    (event: SessionEvent) => {
      setEvents((prev) => [...prev, event]);

      // Check for error events
      if (
        event.type === "system" &&
        event.summary?.toLowerCase().includes("error")
      ) {
        setStatus("errored");
      } else {
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
    };
    // Only run on mount / sessionId change — deliberately omitting doStartTailing/doStopTailing
    // to avoid infinite re-renders. These are stable refs.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId]);

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
      // Re-start: find meta from store
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
      doStopTailing(sessionId);
    }
  }, [sessionId, doStopTailing]);

  // ------------------------------------------------------------------
  // Derive display values
  // ------------------------------------------------------------------

  const badge = statusBadge[status];
  const shortId = sessionId ? sessionId.slice(0, 8) : "Session";
  const displayTitle = `Session ${shortId}`;

  // ------------------------------------------------------------------
  // Render
  // ------------------------------------------------------------------

  return (
    <WindowChrome
      title={displayTitle}
      badge={badge}
      onBeforeClose={handleBeforeClose}
    >
      {/* Controls bar */}
      <div
        className={cn(
          "flex items-center gap-3",
          "px-3 py-1.5",
          "bg-neutral-800/30 border-b border-neutral-700/30",
          "-mx-5 -mt-4 mb-2",
        )}
      >
        {/* Play / Pause */}
        <button
          type="button"
          onClick={handleToggleTailing}
          className={cn(
            "text-xs font-medium transition-colors duration-150",
            isTailing
              ? "text-emerald-400 hover:text-emerald-300"
              : "text-neutral-400 hover:text-neutral-200",
          )}
          title={isTailing ? "Pause tailing" : "Resume tailing"}
        >
          {isTailing ? "Pause" : "Play"}
        </button>

        {/* Clear */}
        <button
          type="button"
          onClick={handleClear}
          className="text-xs text-neutral-400 transition-colors duration-150 hover:text-neutral-200"
          title="Clear event log"
        >
          Clear
        </button>

        {/* Divider */}
        <div className="h-3 w-px bg-neutral-700/50" />

        {/* Compact / Expanded */}
        <button
          type="button"
          onClick={handleToggleCompact}
          className={cn(
            "text-xs transition-colors duration-150",
            compact
              ? "text-blue-400 hover:text-blue-300"
              : "text-neutral-400 hover:text-neutral-200",
          )}
          title={compact ? "Switch to expanded view" : "Switch to compact view"}
        >
          {compact ? "Compact" : "Expanded"}
        </button>

        {/* Auto-scroll */}
        <button
          type="button"
          onClick={handleToggleAutoScroll}
          className={cn(
            "text-xs transition-colors duration-150",
            autoScroll
              ? "text-blue-400 hover:text-blue-300"
              : "text-neutral-400 hover:text-neutral-200",
          )}
          title={autoScroll ? "Disable auto-scroll" : "Enable auto-scroll"}
        >
          {autoScroll ? "Auto" : "Manual"}
        </button>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Event count */}
        <span className="text-xs text-neutral-500">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      {/* Timeline */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="relative flex-1 overflow-y-auto"
      >
        <SessionTimeline events={events} compact={compact} />

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
    </WindowChrome>
  );
}
