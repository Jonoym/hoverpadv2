import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ControlPanel } from "./pages/ControlPanel";
import { NoteWindow } from "./pages/NoteWindow";
import { SessionWindow } from "./pages/SessionWindow";
import { SessionGroupWindow } from "./pages/SessionGroupWindow";
import { LogFileWindow } from "./pages/LogFileWindow";
import { invoke } from "@tauri-apps/api/core";
import { createNote, setNoteOpen } from "./lib/noteService";
import { createNoteWindow } from "./lib/windowManager";
import { useGlobalStore } from "./stores/globalStore";
import { getHotkeyBindings, getDefaultHotkeys } from "./lib/settingsService";
import { FindBar } from "./components/FindBar";

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
    ];

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

  useEffect(() => {
    // Apply visual opacity via CSS on the document root element
    document.documentElement.style.opacity = String(opacity);

    // Click-through when hidden (opacity 0) or at the minimum threshold
    const isClickThrough = opacity < 0.2;
    const appWindow = getCurrentWebviewWindow();
    appWindow.setIgnoreCursorEvents(isClickThrough).catch(console.error);
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
    if (win.label === "main") return; // ControlPanel handles itself

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
      </Routes>
    </BrowserRouter>
  );
}
