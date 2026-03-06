import { useEffect, useCallback } from "react";
import { monitorForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { useShallow } from "zustand/react/shallow";
import { useGlobalStore } from "@/stores/globalStore";
import {
  createTicket,
  deleteTicket,
  moveTicket,
} from "@/lib/ticketService";
import { createNote, linkNoteToTicket, setNoteOpen } from "@/lib/noteService";
import { createNoteWindow } from "@/lib/windowManager";
import { KanbanColumn } from "./KanbanColumn";

export function KanbanBoard() {
  const { columns, tickets, notes, columnsLoading, ticketsLoading, refreshColumns, refreshTickets, refreshNotes } =
    useGlobalStore(
      useShallow((s) => ({
        columns: s.columns,
        tickets: s.tickets,
        notes: s.notes,
        columnsLoading: s.columnsLoading,
        ticketsLoading: s.ticketsLoading,
        refreshColumns: s.refreshColumns,
        refreshTickets: s.refreshTickets,
        refreshNotes: s.refreshNotes,
      })),
    );

  // Hydrate data on mount
  useEffect(() => {
    void refreshColumns();
    void refreshTickets();
    void refreshNotes();
  }, [refreshColumns, refreshTickets, refreshNotes]);

  // Monitor for drag-and-drop events
  useEffect(() => {
    return monitorForElements({
      onDrop({ source, location }) {
        const destination = location.current.dropTargets[0];
        if (!destination) return;

        const ticketId = source.data.ticketId;
        const newColumnId = destination.data.columnId;

        if (typeof ticketId !== "string" || typeof newColumnId !== "string") {
          return;
        }

        // Count existing tickets in the target column to append at the end
        const ticketsInColumn = tickets.filter(
          (t) => t.columnId === newColumnId && t.id !== ticketId,
        );
        const position = ticketsInColumn.length;

        void moveTicket(ticketId, newColumnId, position).then(() => {
          void refreshTickets();
        });
      },
    });
  }, [tickets, refreshTickets]);

  // Group tickets by column
  const ticketsByColumn = new Map<string, typeof tickets>();
  for (const ticket of tickets) {
    const existing = ticketsByColumn.get(ticket.columnId);
    if (existing) {
      existing.push(ticket);
    } else {
      ticketsByColumn.set(ticket.columnId, [ticket]);
    }
  }

  const handleCreateTicket = useCallback(
    async (title: string, columnId: string) => {
      await createTicket(title, columnId);
      await refreshTickets();
    },
    [refreshTickets],
  );

  const handleDeleteTicket = useCallback(
    (id: string) => {
      void deleteTicket(id).then(() => {
        void refreshTickets();
      });
    },
    [refreshTickets],
  );

  const handleCreateLinkedNote = useCallback(
    (ticketId: string) => {
      void (async () => {
        try {
          const note = await createNote();
          await linkNoteToTicket(note.id, ticketId);
          await setNoteOpen(note.id, true);
          await createNoteWindow(note.id);
          await refreshNotes();
        } catch (err) {
          console.error("[hoverpad] Failed to create linked note:", err);
        }
      })();
    },
    [refreshNotes],
  );

  if (columnsLoading || ticketsLoading) {
    return (
      <p className="text-xs text-neutral-500">Loading board...</p>
    );
  }

  if (columns.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No kanban columns found. Check database initialisation.
      </p>
    );
  }

  return (
    <div className="flex gap-4 overflow-x-auto pb-2">
      {columns.map((column) => (
        <KanbanColumn
          key={column.id}
          column={column}
          tickets={ticketsByColumn.get(column.id) ?? []}
          notes={notes}
          onDeleteTicket={handleDeleteTicket}
          onCreateTicket={handleCreateTicket}
          onCreateLinkedNote={handleCreateLinkedNote}
        />
      ))}
    </div>
  );
}
