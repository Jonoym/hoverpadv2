import { create } from "zustand";
import { tauriSync } from "./tauriSync";
import { listNotes, type NoteMeta } from "@/lib/noteService";
import {
  listTickets,
  listArchivedTickets,
  listColumns,
  type TicketMeta,
  type KanbanColumn,
} from "@/lib/ticketService";
import {
  discoverSessions,
  listSessions,
  type SessionMeta,
} from "@/lib/sessionService";
import {
  listClipboardEntries,
  type ClipboardEntry,
} from "@/lib/clipboardService";

// Re-export session types from sessionService for convenience
export type { SessionMeta };

// Re-export ticket types from ticketService for convenience
export type { TicketMeta, KanbanColumn };

// ---------------------------------------------------------------------------
// Store interface
// ---------------------------------------------------------------------------

export interface GlobalState {
  // --- Notes slice ---
  notes: NoteMeta[];
  notesLoading: boolean;
  refreshNotes: () => Promise<void>;

  // --- Sessions slice ---
  sessions: SessionMeta[];
  sessionsLoading: boolean;
  /** Status overrides from open session windows (sessionId → status). */
  sessionStatusOverrides: Record<string, SessionMeta["status"]>;
  refreshSessions: () => Promise<void>;
  /** Fast DB-only load for instant display on startup. */
  hydrateSessions: () => Promise<void>;
  /** Synchronously patch a session label in the store. No async, no races. */
  updateSessionLabel: (sessionId: string, label: string | null) => void;
  /** Called by session windows to push their live status to the control panel. */
  setSessionStatus: (sessionId: string, status: SessionMeta["status"]) => void;
  /** Called when a session window closes — removes the override. */
  clearSessionStatus: (sessionId: string) => void;
  /** Merge a single updated session into the store (for targeted file-change updates). */
  upsertSessionInStore: (session: SessionMeta) => void;

  // --- Columns slice ---
  columns: KanbanColumn[];
  columnsLoading: boolean;
  refreshColumns: () => Promise<void>;

  // --- Tickets slice ---
  tickets: TicketMeta[];
  ticketsLoading: boolean;
  refreshTickets: () => Promise<void>;

  // --- Archived tickets slice ---
  archivedTickets: TicketMeta[];
  archivedTicketsLoading: boolean;
  refreshArchivedTickets: () => Promise<void>;

  // --- Opacity slice ---
  opacity: number; // 0.0 to 1.0, default 1.0
  isHidden: boolean; // true when Ctrl+H toggled to invisible
  preHideOpacity: number; // opacity before Ctrl+H hide
  setOpacity: (value: number) => void;
  adjustOpacity: (delta: number) => void; // +0.1 or -0.1
  toggleVisibility: () => void; // Ctrl+H: toggle between hidden (opacity 0) and visible

  // --- Collapse slice ---
  /** Incremented each time the collapse hotkey fires. ControlPanel watches this. */
  collapseToggleCount: number;
  toggleCollapse: () => void;

  // --- Hide children slice ---
  /** When true, all windows except the control panel are hidden and the CP is collapsed. */
  childrenHidden: boolean;
  /** Incremented each time the hide-children hotkey fires. ControlPanel watches this. */
  hideChildrenToggleCount: number;
  toggleHideChildren: () => void;

  // --- Clipboard slice ---
  clipboardEntries: ClipboardEntry[];
  clipboardLoading: boolean;
  refreshClipboard: () => Promise<void>;
}

// ---------------------------------------------------------------------------
// Derived selectors (pure functions, not stored — avoids stale data)
// ---------------------------------------------------------------------------

/** Number of notes currently open in a window. */
export function selectOpenNoteCount(state: GlobalState): number {
  return state.notes.filter((n) => n.isOpen).length;
}

/** Number of sessions with status "active". */
export function selectActiveSessionCount(state: GlobalState): number {
  return state.sessions.filter((s) => s.status === "active").length;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Shallow-compare two NoteMeta arrays to avoid unnecessary re-renders. */
function notesEqual(a: NoteMeta[], b: NoteMeta[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    const na = a[i]!, nb = b[i]!;
    if (
      na.id !== nb.id ||
      na.title !== nb.title ||
      na.updatedAt !== nb.updatedAt ||
      na.isOpen !== nb.isOpen ||
      na.starred !== nb.starred ||
      na.preview !== nb.preview ||
      na.ticketIds?.join(",") !== nb.ticketIds?.join(",")
    ) {
      return false;
    }
  }
  return true;
}

// ---------------------------------------------------------------------------
// Store creation
// ---------------------------------------------------------------------------

export const useGlobalStore = create<GlobalState>()(
  tauriSync(
    (set) => ({
      // --- Notes ---
      notes: [],
      notesLoading: false,
      refreshNotes: async () => {
        try {
          const notes = await listNotes();
          const current = useGlobalStore.getState().notes;
          if (!notesEqual(current, notes)) {
            set({ notes });
          }
        } catch (err) {
          console.error("[globalStore] refreshNotes failed:", err);
        }
      },

      // --- Sessions ---
      sessions: [],
      sessionsLoading: false,
      sessionStatusOverrides: {},
      hydrateSessions: async () => {
        try {
          const sessions = await listSessions();
          // Only hydrate if we don't already have sessions (avoid overwriting fresh data)
          if (useGlobalStore.getState().sessions.length === 0) {
            set({ sessions });
          }
        } catch (err) {
          console.error("[globalStore] hydrateSessions failed:", err);
        }
      },
      updateSessionLabel: (sessionId, label) => {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.sessionId === sessionId ? { ...s, label } : s,
          ),
        }));
      },
      refreshSessions: async () => {
        try {
          const sessions = await discoverSessions();
          // Apply status overrides from open session windows
          const overrides = useGlobalStore.getState().sessionStatusOverrides;
          for (const session of sessions) {
            const override = overrides[session.sessionId];
            if (override) {
              session.status = override;
            }
          }
          set({ sessions, sessionsLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshSessions failed:", err);
          set({ sessionsLoading: false });
        }
      },
      setSessionStatus: (sessionId, status) => {
        set((state) => ({
          sessionStatusOverrides: { ...state.sessionStatusOverrides, [sessionId]: status },
          sessions: state.sessions.map((s) =>
            s.sessionId === sessionId ? { ...s, status } : s,
          ),
        }));
      },
      clearSessionStatus: (sessionId) => {
        set((state) => {
          const { [sessionId]: _, ...rest } = state.sessionStatusOverrides;
          return { sessionStatusOverrides: rest };
        });
      },
      upsertSessionInStore: (session) => {
        set((state) => {
          // Apply status override if one exists
          const override = state.sessionStatusOverrides[session.sessionId];
          const merged = override ? { ...session, status: override } : session;

          const idx = state.sessions.findIndex((s) => s.sessionId === merged.sessionId);
          if (idx >= 0) {
            const updated = [...state.sessions];
            updated[idx] = merged;
            return { sessions: updated };
          }
          // New session — insert at the right sorted position (newest first)
          const sessions = [...state.sessions, merged].sort(
            (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime(),
          );
          return { sessions };
        });
      },

      // --- Columns ---
      columns: [],
      columnsLoading: false,
      refreshColumns: async () => {
        set({ columnsLoading: true });
        try {
          const columns = await listColumns();
          set({ columns, columnsLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshColumns failed:", err);
          set({ columnsLoading: false });
        }
      },

      // --- Tickets ---
      tickets: [],
      ticketsLoading: false,
      refreshTickets: async () => {
        set({ ticketsLoading: true });
        try {
          const tickets = await listTickets();
          set({ tickets, ticketsLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshTickets failed:", err);
          set({ ticketsLoading: false });
        }
      },

      // --- Archived tickets ---
      archivedTickets: [],
      archivedTicketsLoading: false,
      refreshArchivedTickets: async () => {
        set({ archivedTicketsLoading: true });
        try {
          const archivedTickets = await listArchivedTickets();
          set({ archivedTickets, archivedTicketsLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshArchivedTickets failed:", err);
          set({ archivedTicketsLoading: false });
        }
      },

      // --- Opacity ---
      opacity: 1.0,
      isHidden: false,
      preHideOpacity: 1.0,
      setOpacity: (value) => {
        set({
          opacity: Math.max(0.2, Math.min(1.0, Math.round(value * 10) / 10)),
          isHidden: false,
        });
      },
      adjustOpacity: (delta) => {
        set((state) => {
          if (state.isHidden) {
            // Unhide first with restored opacity, then apply delta
            const restored = state.preHideOpacity;
            return {
              opacity: Math.max(0.2, Math.min(1.0, Math.round((restored + delta) * 10) / 10)),
              isHidden: false,
            };
          }
          return {
            opacity: Math.max(0.2, Math.min(1.0, Math.round((state.opacity + delta) * 10) / 10)),
          };
        });
      },
      toggleVisibility: () => {
        set((state) => {
          if (state.isHidden) {
            return { opacity: state.preHideOpacity, isHidden: false };
          }
          return { preHideOpacity: state.opacity, opacity: 0, isHidden: true };
        });
      },

      // --- Collapse ---
      collapseToggleCount: 0,
      toggleCollapse: () => {
        set((state) => ({ collapseToggleCount: state.collapseToggleCount + 1 }));
      },

      // --- Hide children ---
      childrenHidden: false,
      hideChildrenToggleCount: 0,
      toggleHideChildren: () => {
        set((state) => ({
          childrenHidden: !state.childrenHidden,
          hideChildrenToggleCount: state.hideChildrenToggleCount + 1,
        }));
      },

      // --- Clipboard ---
      clipboardEntries: [],
      clipboardLoading: false,
      refreshClipboard: async () => {
        try {
          const entries = await listClipboardEntries();
          set({ clipboardEntries: entries, clipboardLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshClipboard failed:", err);
          set({ clipboardLoading: false });
        }
      },
    }),
    {
      // Only broadcast data arrays — NOT loading flags or functions
      syncKeys: ["notes", "sessionStatusOverrides", "columns", "tickets", "opacity", "isHidden", "preHideOpacity", "childrenHidden", "clipboardEntries"],
    },
  ),
);

// When sessionStatusOverrides change (e.g. from a remote session window via
// tauriSync), re-apply overrides to the local sessions array so the control
// panel board stays in sync without a full refreshSessions round-trip.
useGlobalStore.subscribe(
  (state, prevState) => {
    if (state.sessionStatusOverrides !== prevState.sessionStatusOverrides && state.sessions.length > 0) {
      const overrides = state.sessionStatusOverrides;
      let changed = false;
      const updated = state.sessions.map((s) => {
        const override = overrides[s.sessionId];
        if (override && s.status !== override) {
          changed = true;
          return { ...s, status: override };
        }
        return s;
      });
      if (changed) {
        useGlobalStore.setState({ sessions: updated });
      }
    }
  },
);
