import { useEffect, useRef, useState } from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { ControlPanel } from "./pages/ControlPanel";
import { NoteWindow } from "./pages/NoteWindow";
import { SessionWindow } from "./pages/SessionWindow";
import { createNote, setNoteOpen } from "./lib/noteService";
import { createNoteWindow } from "./lib/windowManager";
import { useGlobalStore } from "./stores/globalStore";

/**
 * Listen for global hotkey events emitted from the Rust backend.
 * These are registered in lib.rs via tauri-plugin-global-shortcut.
 */
function useHotkeyListeners() {
  useEffect(() => {
    const unlisteners = [
      listen("hotkey:new-note", async () => {
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
 * Watches the global opacity value and applies it to the current window.
 * Uses CSS opacity on the document root (Tauri v2 has no JS setOpacity API).
 * Enables click-through when opacity drops below 20%.
 */
function useOpacityEffect() {
  const opacity = useGlobalStore((s) => s.opacity);

  useEffect(() => {
    // Apply visual opacity via CSS on the document root element
    document.documentElement.style.opacity = String(opacity);

    // Click-through at low opacity
    const isClickThrough = opacity < 0.2;
    const appWindow = getCurrentWebviewWindow();
    appWindow.setIgnoreCursorEvents(isClickThrough).catch(console.error);
  }, [opacity]);
}

/**
 * Brief floating indicator shown when opacity changes.
 * Appears for 1 second then fades out.
 */
function OpacityIndicator() {
  const opacity = useGlobalStore((s) => s.opacity);
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
  }, [opacity]);

  if (!visible) return null;

  return (
    <div className="fixed bottom-4 left-1/2 z-50 -translate-x-1/2 rounded-full border border-neutral-700/50 bg-neutral-800/90 px-3 py-1 text-xs text-neutral-300 backdrop-blur-md">
      Opacity: {Math.round(opacity * 100)}%
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
  useOpacityEffect();

  return (
    <BrowserRouter>
      <OpacityIndicator />
      <Routes>
        <Route path="/" element={<ControlPanel />} />
        <Route path="/note/:id" element={<NoteWindow />} />
        <Route path="/session/:id" element={<SessionWindow />} />
      </Routes>
    </BrowserRouter>
  );
}
