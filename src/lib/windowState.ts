import { useEffect, useRef } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WindowState {
  x: number;
  y: number;
  width: number;
  height: number;
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
  table: "notes" | "sessions",
): Promise<void> {
  const appWindow = getCurrentWebviewWindow();
  const pos = await appWindow.outerPosition();
  const size = await appWindow.innerSize();

  const state: WindowState = {
    x: pos.x,
    y: pos.y,
    width: size.width,
    height: size.height,
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
  table: "notes" | "sessions",
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

/**
 * Hook that listens for window move/resize events and persists the
 * window's position and size to SQLite, debounced at 2 seconds.
 *
 * Usage:
 * ```ts
 * useWindowStateSaver(noteId, "notes");
 * ```
 */
export function useWindowStateSaver(
  id: string | undefined,
  table: "notes" | "sessions",
): void {
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!id) return;
    const appWindow = getCurrentWebviewWindow();

    const handleChange = () => {
      clearTimeout(debounceRef.current);
      debounceRef.current = setTimeout(() => {
        saveWindowState(id, table).catch(console.error);
      }, SAVE_DEBOUNCE_MS);
    };

    // Listen for move and resize events
    const unlistenMove = appWindow.onMoved(handleChange);
    const unlistenResize = appWindow.onResized(handleChange);

    return () => {
      clearTimeout(debounceRef.current);
      unlistenMove.then((fn) => fn()).catch(console.error);
      unlistenResize.then((fn) => fn()).catch(console.error);
    };
  }, [id, table]);
}
