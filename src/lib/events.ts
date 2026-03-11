import { emit, listen, type UnlistenFn, type Event } from "@tauri-apps/api/event";
import type { SessionEvent } from "./sessionService";

/**
 * Typed event payloads for cross-window communication.
 */
export interface HoverpadEventMap {
  "window:opened": { label: string; windowType: "note" | "session" | "session-group" | "logfile" | "clipboard" | "notifications" };
  "window:closed": { label: string; windowType: "note" | "session" | "session-group" | "logfile" | "clipboard" | "notifications" };
  "window:flash": { label: string; color?: string };
  "test:ping": { from: string; message: string };
  "session:event": { sessionId: string; event: SessionEvent };
  "session:status": { sessionId: string; status: "active" | "completed" | "errored" };
  "session:notify": { sessionId: string; label: string; status: "completed" | "errored" };
  "note:renamed": { noteId: string; newTitle: string };
  "session:renamed": { sessionId: string; newLabel: string | null };
  /** Signals to a window that another window is about to snap to it. */
  "window:snap-preview": { label: string; active: boolean };
  /** Restore a minimized (opacity-hidden) window. label "*" restores all. */
  "window:restore": { label: string };
  /** Broadcast when a window is minimized or restored. */
  "window:minimized": { label: string; minimized: boolean };
  /** Emitted by Rust file watcher when a session .jsonl file changes. */
  "session:file-changed": { path: string };
}

export type HoverpadEventName = keyof HoverpadEventMap;

/**
 * Emit a typed event to all windows.
 */
export async function emitEvent<K extends HoverpadEventName>(
  event: K,
  payload: HoverpadEventMap[K],
): Promise<void> {
  await emit(event, payload);
}

/**
 * Listen for a typed event on the current window.
 * Returns an unlisten function for cleanup.
 */
export async function listenEvent<K extends HoverpadEventName>(
  event: K,
  handler: (event: Event<HoverpadEventMap[K]>) => void,
): Promise<UnlistenFn> {
  return await listen<HoverpadEventMap[K]>(event, handler);
}
