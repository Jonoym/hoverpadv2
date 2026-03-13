import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ControlPanel } from "./pages/ControlPanel";
import { NoteWindow } from "./pages/NoteWindow";
import { SessionWindow } from "./pages/SessionWindow";
import { SessionGroupWindow } from "./pages/SessionGroupWindow";
import { LogFileWindow } from "./pages/LogFileWindow";
import { ClipboardWindow } from "./pages/ClipboardWindow";
import { invoke } from "@tauri-apps/api/core";
import { createNote, setNoteOpen } from "./lib/noteService";
import { createNoteWindow, createSessionWindow, createSessionGroupWindow, createCustomGroupWindow, createLogFileWindow, createClipboardWindow, createNotificationWindow } from "./lib/windowManager";
import { setSessionOpen } from "./lib/sessionService";
import { setLogFileOpen } from "./lib/logFileService";
import { addClipboardEntry } from "./lib/clipboardService";
import { listenEvent, type HoverpadEventMap } from "./lib/events";
import { getDatabase } from "./lib/database";
import { useGlobalStore } from "./stores/globalStore";
import { getHotkeyBindings, getDefaultHotkeys } from "./lib/settingsService";
import { restoreSlot } from "./lib/workspaceService";
import { FindBar } from "./components/FindBar";
import { NotificationWindow } from "./pages/NotificationWindow";

// ---------------------------------------------------------------------------
// Window close history (module-level, main window only)
// ---------------------------------------------------------------------------

const MAX_HISTORY = 10;

interface ClosedWindowEntry {
  windowType: HoverpadEventMap["window:closed"]["windowType"];
  label: string;
  closedAt: number;
  /** Extra data needed to reopen certain window types (e.g. projectDir for session groups). */
  meta?: Record<string, string>;
}

const closedWindowHistory: ClosedWindowEntry[] = [];

function pushClosedWindow(entry: Omit<ClosedWindowEntry, "closedAt"> & { meta?: Record<string, string> }) {
  // Don't track notification window — it's always recreated automatically
  if (entry.windowType === "notifications") return;
  closedWindowHistory.push({ ...entry, closedAt: Date.now() });
  if (closedWindowHistory.length > MAX_HISTORY) closedWindowHistory.shift();
}

async function reopenLastClosed(): Promise<void> {
  const entry = closedWindowHistory.pop();
  if (!entry) return;

  try {
    switch (entry.windowType) {
      case "note": {
        const noteId = entry.label.replace("note-", "");
        await setNoteOpen(noteId, true);
        await createNoteWindow(noteId);
        await useGlobalStore.getState().refreshNotes();
        break;
      }
      case "session": {
        const sessionId = entry.label.replace("session-", "");
        await setSessionOpen(sessionId, true);
        await createSessionWindow(sessionId);
        break;
      }
      case "session-group": {
        // Labels: "session-group-custom-<id>" or "sg-<sanitizedDir>"
        if (entry.label.startsWith("session-group-custom-")) {
          const groupId = entry.label.replace("session-group-custom-", "");
          await createCustomGroupWindow(groupId);
        } else if (entry.meta?.projectDir) {
          await createSessionGroupWindow(entry.meta.projectDir);
        }
        break;
      }
      case "logfile": {
        const logFileId = entry.label.replace("logfile-", "");
        await setLogFileOpen(logFileId, true);
        await createLogFileWindow(logFileId);
        break;
      }
      case "clipboard": {
        await createClipboardWindow();
        break;
      }
    }
  } catch (err) {
    console.error("[hoverpad] Failed to reopen window:", err);
  }
}

/**
 * Listen for global hotkey events emitted from the Rust backend.
 * These are registered in lib.rs via tauri-plugin-global-shortcut.
 */
function useHotkeyListeners() {
  useEffect(() => {
    const unlisteners = [
      listen("hotkey:new-note", async () => {
        // Only the main window handles note creation to avoid duplicates
        const win = getCurrentWebviewWindow();
        if (win.label !== "main") return;
        console.log("[hoverpad] Hotkey: New Note triggered");
        try {
          const note = await createNote();
          await setNoteOpen(note.id, true);
          await createNoteWindow(note.id);
          // Refresh the global store so all windows see the new note
          await useGlobalStore.getState().refreshNotes();
        } catch (err) {
          console.error("[hoverpad] Failed to create note:", err);
        }
      }),
      listen("hotkey:opacity-decrease", () => {
        useGlobalStore.getState().adjustOpacity(-0.1);
      }),
      listen("hotkey:opacity-increase", () => {
        useGlobalStore.getState().adjustOpacity(0.1);
      }),
      listen("hotkey:toggle-visibility", () => {
        useGlobalStore.getState().toggleVisibility();
      }),
      listen("hotkey:toggle-collapse", () => {
        // Only the main window handles collapse toggle
        const win = getCurrentWebviewWindow();
        if (win.label === "main") {
          useGlobalStore.getState().toggleCollapse();
        }
      }),
      listen("hotkey:hide-children", () => {
        // Only the main window handles hide-children
        const win = getCurrentWebviewWindow();
        if (win.label === "main") {
          useGlobalStore.getState().toggleHideChildren();
        }
      }),
      listen("hotkey:toggle-clipboard", async () => {
        const win = getCurrentWebviewWindow();
        if (win.label !== "main") return;
        await createClipboardWindow();
      }),
      listen("hotkey:reopen-last-closed", async () => {
        const win = getCurrentWebviewWindow();
        if (win.label !== "main") return;
        await reopenLastClosed();
      }),
      // Workspace profile slot hotkeys (Ctrl+Shift+1 through Ctrl+Shift+5)
      ...Array.from({ length: 5 }, (_, i) =>
        listen(`hotkey:workspace-${i + 1}`, async () => {
          const win = getCurrentWebviewWindow();
          if (win.label !== "main") return;
          await restoreSlot(i + 1);
        }),
      ),
      // Listen for clipboard changes from the Rust monitor
      listen<{ content: string; contentType: string }>("clipboard:new-entry", async (e) => {
        const win = getCurrentWebviewWindow();
        if (win.label !== "main") return;
        await addClipboardEntry(e.payload.content, e.payload.contentType);
        await useGlobalStore.getState().refreshClipboard();
      }),
    ];

    // Track window closes (main window only)
    const win = getCurrentWebviewWindow();
    if (win.label === "main") {
      unlisteners.push(
        listenEvent("window:closed", async (e) => {
          const { windowType, label } = e.payload;
          let meta: Record<string, string> | undefined;

          // For project session groups, resolve the projectDir from the DB
          // since the window label is a lossy sanitization of the path.
          if (windowType === "session-group" && label.startsWith("sg-") && !label.startsWith("sg-custom-")) {
            try {
              const db = await getDatabase();
              const rows = await db.select<{ project_dir: string }[]>(
                "SELECT project_dir FROM session_groups WHERE group_type = 'project'",
              );
              // Match by re-sanitizing each project_dir the same way windowManager does
              const expectedSuffix = label.replace("sg-", "");
              const match = rows.find((r) =>
                r.project_dir.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60) === expectedSuffix,
              );
              if (match) meta = { projectDir: match.project_dir };
            } catch {
              // best effort
            }
          }

          pushClosedWindow({ windowType, label, meta });
        }),
      );

      invoke("start_clipboard_monitor").catch(console.error);
      createNotificationWindow().catch(console.error);
    }

    return () => {
      // Each listen() returns a Promise<UnlistenFn>. Resolve and call to clean up.
      for (const promise of unlisteners) {
        promise.then((unlisten) => unlisten());
      }
    };
  }, []);
}

/**
 * On mount, loads custom hotkey bindings from the database and re-registers
 * any that differ from the defaults with the Rust backend.
 */
function useCustomHotkeys() {
  useEffect(() => {
    (async () => {
      try {
        const bindings = await getHotkeyBindings();
        const defaults = getDefaultHotkeys();

        for (const [action, shortcut] of Object.entries(bindings)) {
          const defaultShortcut = defaults[action];
          if (shortcut !== defaultShortcut && defaultShortcut) {
            // Unregister the default, register the custom one
            await invoke("unregister_hotkey", {
              shortcutStr: defaultShortcut,
            });
            await invoke("register_hotkey", {
              action,
              shortcutStr: shortcut,
            });
          }
        }
      } catch (err) {
        console.error("[hoverpad] Failed to apply custom hotkeys:", err);
      }
    })();
  }, []);
}

/**
 * Watches the global opacity value and applies it to the current window.
 * Uses CSS opacity on the document root (Tauri v2 has no JS setOpacity API).
 * Enables click-through when opacity drops below 20%.
 */
function useOpacityEffect() {
  const opacity = useGlobalStore((s) => s.opacity);
  const prevOpacityRef = useRef(opacity);

  useEffect(() => {
    const win = getCurrentWebviewWindow();
    // Notification window manages its own opacity — skip it
    if (win.label === "notifications") return;

    const wasHidden = prevOpacityRef.current < 0.2;
    prevOpacityRef.current = opacity;

    // When global opacity becomes visible, clear per-window minimized state
    // so Ctrl+H unhide restores all minimized windows
    if (opacity >= 0.2 && document.documentElement.dataset.minimized === "true") {
      delete document.documentElement.dataset.minimized;
    }

    // Don't override opacity if window is still minimized
    if (document.documentElement.dataset.minimized === "true") return;

    // Apply visual opacity via CSS on the document root element
    document.documentElement.style.opacity = String(opacity);

    // Click-through when hidden (opacity 0) or at the minimum threshold
    const isClickThrough = opacity < 0.2;
    win.setIgnoreCursorEvents(isClickThrough).catch(console.error);

    // When unhiding, focus the window so it's immediately interactive
    if (wasHidden && opacity >= 0.2) {
      win.setFocus().catch(console.error);
    }
  }, [opacity]);
}

/**
 * Hides/shows child windows (non-main) when the hide-children toggle fires.
 * Main window handles its own collapse separately in ControlPanel.
 */
function useChildrenHiddenEffect() {
  const childrenHidden = useGlobalStore((s) => s.childrenHidden);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip initial render — don't hide on mount
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    const win = getCurrentWebviewWindow();
    if (win.label === "main" || win.label === "notifications") return;

    if (childrenHidden) {
      win.hide().catch(console.error);
    } else {
      win.show().catch(console.error);
    }
  }, [childrenHidden]);
}

/**
 * Brief floating indicator shown when opacity changes.
 * Appears for 1 second then fades out.
 */
function OpacityIndicator() {
  const opacity = useGlobalStore((s) => s.opacity);
  const isHidden = useGlobalStore((s) => s.isHidden);
  const [visible, setVisible] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const isFirstRender = useRef(true);

  useEffect(() => {
    // Skip showing indicator on the initial render
    if (isFirstRender.current) {
      isFirstRender.current = false;
      return;
    }

    setVisible(true);
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setVisible(false), 1000);

    return () => clearTimeout(timerRef.current);
  }, [opacity, isHidden]);

  if (!visible) return null;

  const label = isHidden ? "Hidden" : `Opacity: ${Math.round(opacity * 100)}%`;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-neutral-700/50 bg-neutral-800/90 px-3 py-1 text-xs text-neutral-300 backdrop-blur-md">
      {label}
    </div>
  );
}

/**
 * App component with routing.
 * Each Tauri window loads the same entry point but with a different URL path,
 * so the router determines which view to render.
 */
export function App() {
  useHotkeyListeners();
  useCustomHotkeys();
  useOpacityEffect();
  useChildrenHiddenEffect();

  return (
    <BrowserRouter>
      <FindBar />
      <OpacityIndicator />
      <Routes>
        <Route path="/" element={<ControlPanel />} />
        <Route path="/note/:id" element={<NoteWindow />} />
        <Route path="/session/:id" element={<SessionWindow />} />
        <Route path="/session-group/:groupType/:groupId" element={<SessionGroupWindow />} />
        <Route path="/log-file/:id" element={<LogFileWindow />} />
        <Route path="/clipboard" element={<ClipboardWindow />} />
        <Route path="/notifications" element={<NotificationWindow />} />
      </Routes>
    </BrowserRouter>
  );
}
