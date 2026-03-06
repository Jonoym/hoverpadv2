import { create } from "zustand";
import { tauriSync } from "./tauriSync";
import { listNotes, type NoteMeta } from "@/lib/noteService";
import {
  listTickets,
  listColumns,
  type TicketMeta,
  type KanbanColumn,
} from "@/lib/ticketService";
import {
  discoverSessions,
  type SessionMeta,
} from "@/lib/sessionService";

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
  refreshSessions: () => Promise<void>;

  // --- Columns slice ---
  columns: KanbanColumn[];
  columnsLoading: boolean;
  refreshColumns: () => Promise<void>;

  // --- Tickets slice ---
  tickets: TicketMeta[];
  ticketsLoading: boolean;
  refreshTickets: () => Promise<void>;

  // --- Opacity slice ---
  opacity: number; // 0.0 to 1.0, default 1.0
  setOpacity: (value: number) => void;
  adjustOpacity: (delta: number) => void; // +0.1 or -0.1
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
// Store creation
// ---------------------------------------------------------------------------

export const useGlobalStore = create<GlobalState>()(
  tauriSync(
    (set) => ({
      // --- Notes ---
      notes: [],
      notesLoading: false,
      refreshNotes: async () => {
        set({ notesLoading: true });
        try {
          const notes = await listNotes();
          set({ notes, notesLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshNotes failed:", err);
          set({ notesLoading: false });
        }
      },

      // --- Sessions ---
      sessions: [],
      sessionsLoading: false,
      refreshSessions: async () => {
        set({ sessionsLoading: true });
        try {
          const sessions = await discoverSessions();
          set({ sessions, sessionsLoading: false });
        } catch (err) {
          console.error("[globalStore] refreshSessions failed:", err);
          set({ sessionsLoading: false });
        }
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

      // --- Opacity ---
      opacity: 1.0,
      setOpacity: (value) => {
        set({
          opacity: Math.max(0.1, Math.min(1.0, Math.round(value * 10) / 10)),
        });
      },
      adjustOpacity: (delta) => {
        set((state) => ({
          opacity: Math.max(
            0.1,
            Math.min(1.0, Math.round((state.opacity + delta) * 10) / 10),
          ),
        }));
      },
    }),
    {
      // Only broadcast data arrays — NOT loading flags or functions
      syncKeys: ["notes", "sessions", "columns", "tickets", "opacity"],
    },
  ),
);
