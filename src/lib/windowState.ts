import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { getDatabase } from "./database";
import { getMonitors, monitorAt, computeSnap } from "./monitorUtils";
import type { MonitorInfo } from "./monitorUtils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
  /** Name of the monitor the window was last on, for multi-monitor restore. */
  monitorName?: string | null;
  /** Scale factor of the monitor the window was last on. Used to adjust size
   *  when restoring on a monitor with a different DPI. */
  scaleFactor?: number;
}

// ---------------------------------------------------------------------------
// Save / Load
// ---------------------------------------------------------------------------

/**
 * Save the current window's position and size to the SQLite database.
 * Reads from the Tauri window API and writes to the `window_state` JSON
 * column of the given table.
 */
export async function saveWindowState(
  id: string,
  table: "notes" | "sessions" | "log_files" | "session_groups",
): Promise<void> {
  const appWindow = getCurrentWebviewWindow();
  const pos = await appWindow.outerPosition();
  const size = await appWindow.innerSize();

  // Determine which monitor this window is currently on
  let monitorName: string | null = null;
  let scaleFactor: number | undefined;
  try {
    const monitors = await getMonitors();
    const mon = monitorAt(monitors, pos.x, pos.y);
    monitorName = mon?.name ?? null;
    scaleFactor = mon?.scaleFactor;
  } catch {
    // best effort
  }

  const state: WindowState = {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
    monitorName,
    scaleFactor,
  };

  const db = await getDatabase();
  await db.execute(
    `UPDATE ${table} SET window_state = $1 WHERE id = $2`,
    [JSON.stringify(state), id],
  );
}

/**
 * Load a previously saved window state from the SQLite database.
 * Returns `null` if no state is saved or the JSON is invalid.
 */
export async function loadWindowState(
  id: string,
  table: "notes" | "sessions" | "log_files" | "session_groups",
): Promise<WindowState | null> {
  const db = await getDatabase();
  const rows = await db.select<{ window_state: string | null }[]>(
    `SELECT window_state FROM ${table} WHERE id = $1`,
    [id],
  );
  if (rows.length === 0 || !rows[0]!.window_state) return null;
  try {
    return JSON.parse(rows[0]!.window_state) as WindowState;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// React Hook
// ---------------------------------------------------------------------------

const SAVE_DEBOUNCE_MS = 2000;
const SNAP_DEBOUNCE_MS = 150;

/**
 * Hook that listens for window move/resize events and persists the
 * window's position and size to SQLite, debounced at 2 seconds.
 * Also handles snap-to-edge when the window is dragged near a monitor edge.
 *
 * Usage:
 * ```ts
 * useWindowStateSaver(noteId, "notes");
 * ```
 */
export function useWindowStateSaver(
  id: string | undefined,
  table: "notes" | "sessions" | "log_files" | "session_groups",
): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const snapDebounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const monitorsRef = useRef<MonitorInfo[] | null>(null);
  // Prevent snap from re-triggering itself
  const isSnappingRef = useRef(false);

  useEffect(() => {
    if (!id) return;
    const appWindow = getCurrentWebviewWindow();

    // Cache monitors on mount
    getMonitors()
      .then((m) => { monitorsRef.current = m; })
      .catch(console.error);

    const handleChange = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        saveWindowState(id, table).catch(console.error);
      }, SAVE_DEBOUNCE_MS);
    };

    const handleMove = () => {
      handleChange();

      // Snap-to-edge: debounce so it only fires after the user stops dragging
      if (isSnappingRef.current) return;
      clearTimeout(snapDebounceRef.current);
      snapDebounceRef.current = setTimeout(async () => {
        if (!monitorsRef.current) return;
        try {
          const pos = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          const snap = computeSnap(
            monitorsRef.current,
            pos.x,
            pos.y,
            size.width,
            size.height,
          );
          if (snap) {
            isSnappingRef.current = true;
            await appWindow.setPosition(new PhysicalPosition(snap.x, snap.y));
            // Small delay to let the onMoved event from snap pass through
            setTimeout(() => { isSnappingRef.current = false; }, 100);
          }
        } catch {
          // window may have been destroyed
        }
      }, SNAP_DEBOUNCE_MS);
    };

    // Listen for move and resize events
    const unlistenMove = appWindow.onMoved(handleMove);
    const unlistenResize = appWindow.onResized(handleChange);

    return () => {
      clearTimeout(debounceRef.current);
      clearTimeout(snapDebounceRef.current);
      // Force an immediate save on unmount (window closing) so state isn't lost
      saveWindowState(id, table).catch(console.error);
      unlistenMove.then((fn) => fn()).catch(console.error);
      unlistenResize.then((fn) => fn()).catch(console.error);
    };
  }, [id, table]);
}
