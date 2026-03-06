import { useCallback, useEffect, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { PhysicalSize, PhysicalPosition, LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { createNoteWindow, createSessionWindow } from "@/lib/windowManager";
import { listenEvent, type HoverpadEventName } from "@/lib/events";
import { getDatabaseStatus, type DatabaseStatus } from "@/lib/database";
import { createNote, setNoteOpen, listNotes } from "@/lib/noteService";
import { useGlobalStore, selectOpenNoteCount, selectActiveSessionCount } from "@/stores/globalStore";
import { WindowChrome } from "@/components/WindowChrome";
import { NoteList } from "@/components/NoteList";
import { SessionList } from "@/components/SessionList";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { CollapsedTab } from "@/components/CollapsedTab";

const COLLAPSED_WIDTH = 220;
const COLLAPSED_HEIGHT = 50;

interface EventLogEntry {
  id: number;
  time: string;
  event: string;
  payload: string;
}

let nextId = 0;

export function ControlPanel() {
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [dbStatus, setDbStatus] = useState<
    | { state: "loading" }
    | { state: "ready"; data: DatabaseStatus }
    | { state: "error"; message: string }
  >({ state: "loading" });
  const [eventLogOpen, setEventLogOpen] = useState(false);

  // View switcher state
  const [activeView, setActiveView] = useState<"notes" | "board" | "sessions">("notes");

  // Collapse/expand state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedSize, setExpandedSize] = useState({ width: 800, height: 600 });
  const [expandedPosition, setExpandedPosition] = useState<{ x: number; y: number } | null>(null);

  // Subscribe to global store
  const { notes, notesLoading, refreshNotes, sessions, sessionsLoading, refreshSessions } = useGlobalStore(
    useShallow((s) => ({
      notes: s.notes,
      notesLoading: s.notesLoading,
      refreshNotes: s.refreshNotes,
      sessions: s.sessions,
      sessionsLoading: s.sessionsLoading,
      refreshSessions: s.refreshSessions,
    })),
  );
  const noteCount = useGlobalStore(selectOpenNoteCount);
  const sessionCount = useGlobalStore(selectActiveSessionCount);

  useEffect(() => {
    getDatabaseStatus()
      .then((data) => setDbStatus({ state: "ready", data }))
      .catch((err: unknown) =>
        setDbStatus({
          state: "error",
          message: err instanceof Error ? err.message : String(err),
        }),
      );

    // Hydrate the note list and session list from the database
    void refreshNotes();
    void refreshSessions();
  }, [refreshNotes, refreshSessions]);

  // Restore previously open note windows on app launch
  useEffect(() => {
    listNotes()
      .then((allNotes) => {
        for (const note of allNotes) {
          if (note.isOpen) {
            createNoteWindow(note.id).catch(console.error);
          }
        }
      })
      .catch(console.error);
  }, []); // Run once on mount

  const addLogEntry = useCallback((event: string, payload: unknown) => {
    const entry: EventLogEntry = {
      id: nextId++,
      time: new Date().toLocaleTimeString(),
      event,
      payload: JSON.stringify(payload),
    };
    setEventLog((prev) => [entry, ...prev].slice(0, 50));
  }, []);

  useEffect(() => {
    const eventNames: HoverpadEventName[] = [
      "window:opened",
      "window:closed",
      "test:ping",
    ];

    const unlisteners = eventNames.map((name) =>
      listenEvent(name, (e) => {
        addLogEntry(name, e.payload);

        // Refresh the note list when a window is closed (updates isOpen status)
        if (name === "window:closed") {
          void refreshNotes();
        }
      }),
    );

    return () => {
      unlisteners.forEach((p) => {
        p.then((unlisten) => unlisten()).catch(console.error);
      });
    };
  }, [addLogEntry, refreshNotes]);

  const handleCollapse = useCallback(async () => {
    const appWindow = getCurrentWebviewWindow();
    try {
      // Save current window size and position as physical pixels
      const size = await appWindow.innerSize();
      const position = await appWindow.outerPosition();
      setExpandedSize({ width: size.width, height: size.height });
      setExpandedPosition({ x: position.x, y: position.y });

      // Get screen dimensions for centering
      const monitor = await currentMonitor();
      const screenWidth = monitor?.size.width ?? 1920;
      const scaleFactor = monitor?.scaleFactor ?? 1;
      const logicalScreenWidth = screenWidth / scaleFactor;
      const centerX = Math.round((logicalScreenWidth - COLLAPSED_WIDTH) / 2);

      // Resize and reposition (collapsed uses logical sizes since they are constants)
      await appWindow.setSize(new LogicalSize(COLLAPSED_WIDTH, COLLAPSED_HEIGHT));
      await appWindow.setPosition(new LogicalPosition(centerX, 10));

      setIsCollapsed(true);
    } catch (err) {
      console.error("[hoverpad] Failed to collapse:", err);
    }
  }, []);

  const handleExpand = useCallback(async () => {
    const appWindow = getCurrentWebviewWindow();
    try {
      // Restore saved size using PhysicalSize (values were saved as physical pixels)
      await appWindow.setSize(
        new PhysicalSize(expandedSize.width, expandedSize.height),
      );

      // Restore saved position using PhysicalPosition, or center on screen
      if (expandedPosition) {
        await appWindow.setPosition(
          new PhysicalPosition(expandedPosition.x, expandedPosition.y),
        );
      } else {
        // Center on screen as fallback
        const monitor = await currentMonitor();
        const screenWidth = monitor?.size.width ?? 1920;
        const screenHeight = monitor?.size.height ?? 1080;
        const centerX = Math.round((screenWidth - expandedSize.width) / 2);
        const centerY = Math.round((screenHeight - expandedSize.height) / 2);
        await appWindow.setPosition(new PhysicalPosition(centerX, centerY));
      }

      setIsCollapsed(false);
    } catch (err) {
      console.error("[hoverpad] Failed to expand:", err);
    }
  }, [expandedSize, expandedPosition]);

  // Render collapsed tab if collapsed
  if (isCollapsed) {
    return (
      <CollapsedTab
        noteCount={noteCount}
        sessionCount={sessionCount}
        onExpand={() => void handleExpand()}
      />
    );
  }

  const handleNewNote = async () => {
    try {
      const note = await createNote();
      await setNoteOpen(note.id, true);
      await createNoteWindow(note.id);
      // Refresh the global store so the new note appears everywhere
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to create note:", err);
    }
  };

  const handleNewSession = async () => {
    const id = `test-${Date.now()}`;
    await createSessionWindow(id);
  };

  return (
    <WindowChrome
      title="Hoverpad"
      badge={{ label: "Control Panel", color: "blue" }}
      onCollapse={() => void handleCollapse()}
    >
      {/* Database status */}
      <div
        className={cn(
          "rounded-lg border px-3 py-2 text-xs",
          dbStatus.state === "ready"
            ? "border-emerald-500/30 bg-emerald-600/10 text-emerald-400"
            : dbStatus.state === "error"
              ? "border-red-500/30 bg-red-600/10 text-red-400"
              : "border-neutral-700/50 bg-neutral-800/50 text-neutral-500",
        )}
      >
        {dbStatus.state === "loading" && "Initialising database..."}
        {dbStatus.state === "error" && (
          <span>
            DB Error: <span className="font-mono">{dbStatus.message}</span>
          </span>
        )}
        {dbStatus.state === "ready" && (
          <span>
            DB OK &mdash; {dbStatus.data.tables.length} tables (
            {dbStatus.data.tables.join(", ")}), {dbStatus.data.columnCount}{" "}
            kanban columns
          </span>
        )}
      </div>

      {/* Action buttons */}
      <div className="flex gap-3">
        <button
          type="button"
          onClick={handleNewNote}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium",
            "bg-blue-600/20 text-blue-400",
            "border border-blue-500/30",
            "transition-colors duration-150 hover:bg-blue-600/30",
          )}
        >
          New Note
        </button>
        <button
          type="button"
          onClick={handleNewSession}
          className={cn(
            "rounded-lg px-4 py-2 text-sm font-medium",
            "bg-emerald-600/20 text-emerald-400",
            "border border-emerald-500/30",
            "transition-colors duration-150 hover:bg-emerald-600/30",
          )}
        >
          New Session
        </button>
      </div>

      {/* View switcher tabs */}
      <div className="flex gap-4 border-b border-neutral-700/50">
        <button
          type="button"
          onClick={() => setActiveView("notes")}
          className={cn(
            "pb-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
            activeView === "notes"
              ? "border-b-2 border-blue-500 text-neutral-100"
              : "text-neutral-500 hover:text-neutral-300",
          )}
        >
          Notes
        </button>
        <button
          type="button"
          onClick={() => setActiveView("board")}
          className={cn(
            "pb-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
            activeView === "board"
              ? "border-b-2 border-blue-500 text-neutral-100"
              : "text-neutral-500 hover:text-neutral-300",
          )}
        >
          Board
        </button>
        <button
          type="button"
          onClick={() => setActiveView("sessions")}
          className={cn(
            "pb-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
            activeView === "sessions"
              ? "border-b-2 border-blue-500 text-neutral-100"
              : "text-neutral-500 hover:text-neutral-300",
          )}
        >
          Sessions
        </button>
      </div>

      {/* Content area */}
      <div className="flex flex-1 flex-col gap-2 overflow-hidden">
        {activeView === "notes" ? (
          <div className="flex-1 overflow-y-auto">
            <NoteList notes={notes} loading={notesLoading} />
          </div>
        ) : activeView === "board" ? (
          <div className="flex-1 overflow-y-auto">
            <KanbanBoard />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            <SessionList sessions={sessions} loading={sessionsLoading} />
          </div>
        )}
      </div>

      {/* Collapsible event log */}
      <div className="flex flex-col gap-2">
        <button
          type="button"
          onClick={() => setEventLogOpen((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm font-medium text-neutral-400 transition-colors duration-150 cursor-pointer hover:text-neutral-300"
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn(
              "transition-transform",
              eventLogOpen ? "rotate-90" : "rotate-0",
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
          Event Log
          {eventLog.length > 0 && (
            <span className="text-xs text-neutral-500">
              ({eventLog.length})
            </span>
          )}
        </button>
        {eventLogOpen && (
          <div
            className={cn(
              "max-h-48 overflow-y-auto rounded-lg",
              "border border-neutral-700/50 bg-neutral-950/50 p-3",
            )}
          >
            {eventLog.length === 0 ? (
              <p className="text-xs text-neutral-500">
                No events yet. Open a window and send events to see them here.
              </p>
            ) : (
              <div className="flex flex-col gap-1">
                {eventLog.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-baseline gap-2 text-xs"
                  >
                    <span className="shrink-0 font-mono text-neutral-500">
                      {entry.time}
                    </span>
                    <span className="shrink-0 font-medium text-amber-400">
                      {entry.event}
                    </span>
                    <span className="truncate text-neutral-400">
                      {entry.payload}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </WindowChrome>
  );
}
