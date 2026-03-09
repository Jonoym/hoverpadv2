import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { PhysicalSize, PhysicalPosition, LogicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { useShallow } from "zustand/react/shallow";
import { cn } from "@/lib/utils";
import { createNoteWindow, createSessionWindow, createSessionGroupWindow, createCustomGroupWindow, createLogFileWindow } from "@/lib/windowManager";

import { listNotes } from "@/lib/noteService";
import { listenEvent } from "@/lib/events";
import { discoverSessions, listOpenSessionGroups } from "@/lib/sessionService";
import { listOpenLogFiles } from "@/lib/logFileService";
import { getDatabase } from "@/lib/database";
import { useGlobalStore, selectOpenNoteCount } from "@/stores/globalStore";
import { WindowChrome } from "@/components/WindowChrome";
import { NoteList } from "@/components/NoteList";
import { SessionList } from "@/components/SessionList";
import { KanbanBoard } from "@/components/kanban/KanbanBoard";
import { SettingsPanel } from "@/components/SettingsPanel";
import { CollapsedTab } from "@/components/CollapsedTab";

const COLLAPSED_WIDTH = 320;
const COLLAPSED_HEIGHT = 50;

/** Target logical widths per view. */
const VIEW_WIDTHS: Record<string, number> = {
  notes: 750,
  board: 1111,
  sessions: 500,
};


export function ControlPanel() {
  // View switcher state
  const [activeView, setActiveView] = useState<"notes" | "board" | "sessions">("notes");
  const [showSettings, setShowSettings] = useState(false);

  // Collapse/expand state
  const [isCollapsed, setIsCollapsed] = useState(false);
  const [expandedSize, setExpandedSize] = useState({ width: 800, height: 600 });
  const [expandedPosition, setExpandedPosition] = useState<{ x: number; y: number } | null>(null);

  // Subscribe to global store
  const { notes, notesLoading, refreshNotes, sessions, refreshSessions, hydrateSessions } = useGlobalStore(
    useShallow((s) => ({
      notes: s.notes,
      notesLoading: s.notesLoading,
      refreshNotes: s.refreshNotes,
      sessions: s.sessions,
      refreshSessions: s.refreshSessions,
      hydrateSessions: s.hydrateSessions,
    })),
  );
  const noteCount = useGlobalStore(selectOpenNoteCount);
  const collapseToggleCount = useGlobalStore((s) => s.collapseToggleCount);
  const hideChildrenToggleCount = useGlobalStore((s) => s.hideChildrenToggleCount);
  const childrenHidden = useGlobalStore((s) => s.childrenHidden);
  const isHidden = useGlobalStore((s) => s.isHidden);

  const switchView = useCallback((view: "notes" | "board" | "sessions") => {
    setShowSettings(false);
    setActiveView(view);
    const appWindow = getCurrentWebviewWindow();
    void appWindow.innerSize().then((size) => {
      void currentMonitor().then((monitor) => {
        const scale = monitor?.scaleFactor ?? 1;
        const currentHeight = size.height / scale;
        void appWindow.setSize(new LogicalSize(VIEW_WIDTHS[view]!, currentHeight));
      });
    });
  }, []);

  useEffect(() => {
    // Fast: load sessions from DB so names/labels appear instantly
    void hydrateSessions();
    // Hydrate the note list and do full session discovery (disk scan)
    void refreshNotes();
    void refreshSessions();

    // Poll sessions every 5s so status changes (running → idle) are picked up
    const interval = setInterval(() => { void refreshSessions(); }, 5_000);

    // Refresh immediately when renames happen in other windows
    const unlistenNote = listenEvent("note:renamed", () => { void refreshNotes(); });
    const unlistenSession = listenEvent("session:renamed", () => { void refreshSessions(); });

    return () => {
      clearInterval(interval);
      unlistenNote.then((fn) => fn()).catch(console.error);
      unlistenSession.then((fn) => fn()).catch(console.error);
    };
  }, [refreshNotes, refreshSessions, hydrateSessions]);

  // Restore previously open windows on app launch.
  // Module-level guard prevents duplicate restores from React StrictMode double-mount.
  const restoreGuardRef = useRef(false);
  useEffect(() => {
    if (restoreGuardRef.current) return;
    restoreGuardRef.current = true;
    (async () => {
      try {
        // Read which windows were open, then immediately clear all is_open
        // flags. Each window component re-sets is_open=1 on mount, so if the
        // app crashes before cleanup runs, flags won't be stale next launch.
        const db = await getDatabase();
        const allNotes = await listNotes();
        const openNotes = allNotes.filter((n) => n.isOpen);

        const allSessions = await discoverSessions();
        const openSessions = allSessions.filter((s) => s.isOpen);

        const groups = await listOpenSessionGroups();
        const logFiles = await listOpenLogFiles();

        // Clear all is_open flags now — window components will re-set on mount
        await db.execute("UPDATE notes SET is_open = 0 WHERE is_open = 1");
        await db.execute("UPDATE sessions SET is_open = 0 WHERE is_open = 1");
        await db.execute("UPDATE session_groups SET is_open = 0 WHERE is_open = 1");
        await db.execute("UPDATE log_files SET is_open = 0 WHERE is_open = 1");

        // Restore windows sequentially to avoid label races
        for (const note of openNotes) {
          await createNoteWindow(note.id);
        }

        for (const session of openSessions) {
          await createSessionWindow(session.sessionId);
        }

        for (const group of groups) {
          if (group.groupType === "project" && group.projectDir) {
            await createSessionGroupWindow(group.projectDir);
          } else if (group.groupType === "manual") {
            await createCustomGroupWindow(group.id);
          }
        }

        for (const lf of logFiles) {
          await createLogFileWindow(lf.id);
        }
      } catch (err) {
        console.error("[hoverpad] Failed to restore windows:", err);
      }
    })();
  }, []); // Run once on mount

  // ------------------------------------------------------------------
  // Persist control panel state to SQLite settings table
  // ------------------------------------------------------------------

  const saveDebounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Save control panel geometry on collapse/expand and position changes
  const saveControlPanelState = useCallback(async (
    collapsed: boolean,
    expSize: { width: number; height: number },
    expPosition: { x: number; y: number } | null,
    view: string,
  ) => {
    try {
      const db = await getDatabase();
      const value = JSON.stringify({ collapsed, expSize, expPosition, view });
      await db.execute(
        `INSERT INTO settings (key, value) VALUES ('control_panel_state', $1)
         ON CONFLICT(key) DO UPDATE SET value = $1`,
        [value],
      );
    } catch (err) {
      console.error("[hoverpad] Failed to save control panel state:", err);
    }
  }, []);

  // Debounced save on state changes (after initial load)
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (!initialLoadDone.current) return;
    clearTimeout(saveDebounceRef.current);
    saveDebounceRef.current = setTimeout(() => {
      void saveControlPanelState(isCollapsed, expandedSize, expandedPosition, activeView);
    }, 1000);
    return () => clearTimeout(saveDebounceRef.current);
  }, [isCollapsed, expandedSize, expandedPosition, activeView, saveControlPanelState]);

  // Restore control panel state on mount
  useEffect(() => {
    (async () => {
      try {
        const db = await getDatabase();
        const rows = await db.select<{ value: string }[]>(
          "SELECT value FROM settings WHERE key = 'control_panel_state'",
        );
        if (rows.length === 0) {
          initialLoadDone.current = true;
          return;
        }
        const state = JSON.parse(rows[0]!.value) as {
          collapsed?: boolean;
          expSize?: { width: number; height: number };
          expPosition?: { x: number; y: number } | null;
          view?: string;
        };

        if (state.expSize) setExpandedSize(state.expSize);
        if (state.expPosition) setExpandedPosition(state.expPosition);
        if (state.view && ["notes", "board", "sessions"].includes(state.view)) {
          setActiveView(state.view as "notes" | "board" | "sessions");
        }

        // Restore collapsed state — apply window geometry
        const appWindow = getCurrentWebviewWindow();
        if (state.collapsed) {
          const monitor = await currentMonitor();
          const screenWidth = monitor?.size.width ?? 1920;
          const scaleFactor = monitor?.scaleFactor ?? 1;
          const logicalScreenWidth = screenWidth / scaleFactor;
          const centerX = Math.round((logicalScreenWidth - COLLAPSED_WIDTH) / 2);
          await appWindow.setSize(new LogicalSize(COLLAPSED_WIDTH, COLLAPSED_HEIGHT));
          await appWindow.setPosition(new LogicalPosition(centerX, 10));
          setIsCollapsed(true);
        } else if (state.expSize) {
          // Apply view-specific width with saved height
          const restoredView = (state.view && ["notes", "board", "sessions"].includes(state.view))
            ? state.view
            : "notes";
          const targetWidth = VIEW_WIDTHS[restoredView] ?? VIEW_WIDTHS.notes!;
          const monitor = await currentMonitor();
          const scaleFactor = monitor?.scaleFactor ?? 1;
          const physicalWidth = Math.round(targetWidth * scaleFactor);
          await appWindow.setSize(new PhysicalSize(physicalWidth, state.expSize.height));
          if (state.expPosition) {
            await appWindow.setPosition(
              new PhysicalPosition(state.expPosition.x, state.expPosition.y),
            );
          }
        }
      } catch (err) {
        console.error("[hoverpad] Failed to restore control panel state:", err);
      }
      initialLoadDone.current = true;
    })();
  }, []);

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

      // Hide content, resize, then show new content
      document.documentElement.style.opacity = "0";
      await appWindow.setSize(new LogicalSize(COLLAPSED_WIDTH, COLLAPSED_HEIGHT));
      await appWindow.setPosition(new LogicalPosition(centerX, 10));
      setIsCollapsed(true);
      requestAnimationFrame(() => {
        document.documentElement.style.opacity = "";
      });
    } catch (err) {
      console.error("[hoverpad] Failed to collapse:", err);
      document.documentElement.style.opacity = "";
    }
  }, []);

  const handleExpand = useCallback(async () => {
    const appWindow = getCurrentWebviewWindow();
    try {
      // Hide content, resize, then show new content
      document.documentElement.style.opacity = "0";

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
      requestAnimationFrame(() => {
        document.documentElement.style.opacity = "";
      });
    } catch (err) {
      console.error("[hoverpad] Failed to expand:", err);
      document.documentElement.style.opacity = "";
    }
  }, [expandedSize, expandedPosition]);

  // React to global hotkey toggle-collapse
  // Skip when everything is hidden (Ctrl+H) — collapse shouldn't unhide
  const collapseToggleRef = useRef(collapseToggleCount);
  useEffect(() => {
    if (collapseToggleRef.current === collapseToggleCount) return;
    collapseToggleRef.current = collapseToggleCount;

    if (isHidden) return; // Don't toggle collapse while globally hidden

    if (isCollapsed) {
      void handleExpand();
    } else {
      void handleCollapse();
    }
  }, [collapseToggleCount, isCollapsed, isHidden, handleExpand, handleCollapse]);

  // React to global hotkey hide-children
  // Collapse the control panel when children are hidden, expand when shown
  const hideChildrenRef = useRef(hideChildrenToggleCount);
  useEffect(() => {
    if (hideChildrenRef.current === hideChildrenToggleCount) return;
    hideChildrenRef.current = hideChildrenToggleCount;

    if (childrenHidden && !isCollapsed) {
      void handleCollapse();
    } else if (!childrenHidden && isCollapsed) {
      void handleExpand();
    }
  }, [hideChildrenToggleCount, childrenHidden, isCollapsed, handleExpand, handleCollapse]);

  // Render collapsed tab if collapsed
  if (isCollapsed) {
    return (
      <CollapsedTab
        noteCount={noteCount}
        activeSessions={sessions.filter((s) => s.status === "active").length}
        idleSessions={sessions.filter((s) => s.status === "idle").length}
        idleAgentsSessions={sessions.filter((s) => s.status === "idle-agents").length}
        doneSessions={sessions.filter((s) => s.status === "completed").length}
        onExpand={() => void handleExpand()}
      />
    );
  }

  return (
    <WindowChrome
      title="Hoverpad"
      showMinimize={false}
      onCollapse={() => void handleCollapse()}
    >
      {/* View switcher tabs */}
      <div className="flex items-center border-b border-neutral-700/50">
        <div className="flex gap-4">
          <button
            type="button"
            onClick={() => switchView("notes")}
            className={cn(
              "border-b-2 pb-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
              activeView === "notes" && !showSettings
                ? "border-blue-500 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300",
            )}
          >
            Notes
          </button>
          <button
            type="button"
            onClick={() => switchView("board")}
            className={cn(
              "border-b-2 pb-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
              activeView === "board" && !showSettings
                ? "border-blue-500 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300",
            )}
          >
            Board
          </button>
          <button
            type="button"
            onClick={() => switchView("sessions")}
            className={cn(
              "border-b-2 pb-2 text-sm font-medium transition-colors duration-150 cursor-pointer",
              activeView === "sessions" && !showSettings
                ? "border-blue-500 text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300",
            )}
          >
            Sessions
          </button>
        </div>
        <button
          type="button"
          onClick={() => setShowSettings((prev) => !prev)}
          className={cn(
            "ml-auto border-b-2 px-3 pb-2 cursor-pointer transition-colors duration-150",
            showSettings
              ? "border-blue-500 text-neutral-100"
              : "border-transparent text-neutral-500 hover:text-neutral-300",
          )}
          title="Settings"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
          >
            <path
              fillRule="evenodd"
              d="M8.34 1.804A1 1 0 0 1 9.32 1h1.36a1 1 0 0 1 .98.804l.295 1.473c.497.144.971.342 1.416.587l1.25-.834a1 1 0 0 1 1.262.125l.962.962a1 1 0 0 1 .125 1.262l-.834 1.25c.245.445.443.919.587 1.416l1.473.294a1 1 0 0 1 .804.98v1.361a1 1 0 0 1-.804.98l-1.473.295a6.95 6.95 0 0 1-.587 1.416l.834 1.25a1 1 0 0 1-.125 1.262l-.962.962a1 1 0 0 1-1.262.125l-1.25-.834a6.953 6.953 0 0 1-1.416.587l-.294 1.473a1 1 0 0 1-.98.804H9.32a1 1 0 0 1-.98-.804l-.295-1.473a6.957 6.957 0 0 1-1.416-.587l-1.25.834a1 1 0 0 1-1.262-.125l-.962-.962a1 1 0 0 1-.125-1.262l.834-1.25a6.957 6.957 0 0 1-.587-1.416l-1.473-.294A1 1 0 0 1 1 10.68V9.32a1 1 0 0 1 .804-.98l1.473-.295c.144-.497.342-.971.587-1.416l-.834-1.25a1 1 0 0 1 .125-1.262l.962-.962A1 1 0 0 1 5.38 3.22l1.25.834a6.957 6.957 0 0 1 1.416-.587l.294-1.473ZM13 10a3 3 0 1 1-6 0 3 3 0 0 1 6 0Z"
              clipRule="evenodd"
            />
          </svg>
        </button>
      </div>

      {/* Content area */}
      <div className="relative flex flex-1 flex-col gap-2 overflow-hidden">
        {showSettings ? (
          <div className="flex-1 overflow-y-auto p-2">
            <SettingsPanel />
          </div>
        ) : (
          <>
            <div className={cn("flex-1 overflow-auto pr-2", activeView !== "notes" && "hidden")}>
              <NoteList notes={notes} loading={notesLoading} />
            </div>
            <div className={cn("flex-1 overflow-auto", activeView !== "board" && "hidden")}>
              <KanbanBoard />
            </div>
            <div className={cn("flex-1 overflow-y-auto pr-2", activeView !== "sessions" && "hidden")}>
              <SessionList sessions={sessions} onRefresh={refreshSessions} />
            </div>
          </>
        )}
      </div>

    </WindowChrome>
  );
}
