import { emit, listen } from "@tauri-apps/api/event";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import type { StateCreator, StoreMutatorIdentifier } from "zustand";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

const SYNC_EVENT = "store:sync";

interface SyncPayload {
  /** Label of the window that originated the change. */
  source: string;
  /** Partial state slice that changed. */
  patch: Record<string, unknown>;
}

interface TauriSyncOptions<T> {
  /** Which top-level keys to broadcast. Unlisted keys stay local. */
  syncKeys: (keyof T & string)[];
}

// ---------------------------------------------------------------------------
// Middleware
// ---------------------------------------------------------------------------

/**
 * Zustand middleware that synchronises selected state slices across
 * Tauri windows via `emit` / `listen`.
 *
 * How it works:
 * 1. Wraps `set()` — after every local state update, diffs the changed keys
 *    against `syncKeys`. If any match, emits a `store:sync` event carrying
 *    only the changed slice and the originating window label.
 * 2. On the receiving side a single `listen(SYNC_EVENT)` handler merges the
 *    incoming patch into the local store, but sets an internal flag so that
 *    the resulting `set()` call does NOT re-broadcast (no echo loop).
 */
type TauriSync = <
  T,
  Mps extends [StoreMutatorIdentifier, unknown][] = [],
  Mcs extends [StoreMutatorIdentifier, unknown][] = [],
>(
  initializer: StateCreator<T, Mps, Mcs>,
  options: TauriSyncOptions<T>,
) => StateCreator<T, Mps, Mcs>;

type TauriSyncImpl = <T>(
  initializer: StateCreator<T, [], []>,
  options: TauriSyncOptions<T>,
) => StateCreator<T, [], []>;

const tauriSyncImpl: TauriSyncImpl = (initializer, options) => (set, get, api) => {
  const { syncKeys } = options;
  const syncKeySet = new Set<string>(syncKeys);

  // Flag: when true, the current `set()` call was triggered by an
  // incoming sync event and must NOT be re-broadcast.
  let isReceiving = false;

  // -----------------------------------------------------------------------
  // Wrapped set — intercepts state changes and broadcasts if needed
  // -----------------------------------------------------------------------
  const wrappedSet: typeof set = (partial, replace) => {
    const prevState = get() as Record<string, unknown>;

    // Apply the state update locally first
    (set as (partial: unknown, replace?: boolean) => void)(partial, replace);

    // If this update came from a remote window, stop here
    if (isReceiving) return;

    const nextState = get() as Record<string, unknown>;

    // Build a patch of only the syncable keys that actually changed
    const patch: Record<string, unknown> = {};
    let hasChanges = false;

    for (const key of syncKeySet) {
      if (!Object.is(prevState[key], nextState[key])) {
        patch[key] = nextState[key];
        hasChanges = true;
      }
    }

    if (!hasChanges) return;

    // Fire-and-forget broadcast to all windows
    void (async () => {
      try {
        const windowLabel = getCurrentWebviewWindow().label;
        const payload: SyncPayload = { source: windowLabel, patch };
        await emit(SYNC_EVENT, payload);
      } catch (err) {
        console.error("[tauriSync] Failed to emit sync event:", err);
      }
    })();
  };

  // -----------------------------------------------------------------------
  // Start listening for remote sync events (once per store instance)
  // -----------------------------------------------------------------------
  void (async () => {
    try {
      const windowLabel = getCurrentWebviewWindow().label;

      await listen<SyncPayload>(SYNC_EVENT, (event) => {
        // Ignore events we sent ourselves
        if (event.payload.source === windowLabel) return;

        // Merge the remote patch into local state without re-broadcasting
        isReceiving = true;
        try {
          set(event.payload.patch as Partial<ReturnType<typeof get>> & ReturnType<typeof get>);
        } finally {
          isReceiving = false;
        }
      });
    } catch (err) {
      console.error("[tauriSync] Failed to start sync listener:", err);
    }
  })();

  // -----------------------------------------------------------------------
  // Initialise the store with the wrapped set
  // -----------------------------------------------------------------------
  return initializer(wrappedSet, get, api);
};

export const tauriSync = tauriSyncImpl as unknown as TauriSync;
