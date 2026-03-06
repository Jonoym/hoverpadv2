import { emit, listen, type UnlistenFn, type Event } from "@tauri-apps/api/event";
import type { SessionEvent } from "./sessionService";

/**
 * Typed event payloads for cross-window communication.
 */
export interface HoverpadEventMap {
  "window:opened": { label: string; windowType: "note" | "session" };
  "window:closed": { label: string; windowType: "note" | "session" };
  "test:ping": { from: string; message: string };
  "session:event": { sessionId: string; event: SessionEvent };
  "session:status": { sessionId: string; status: "active" | "completed" | "errored" };
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
