import { useEffect, useRef, useState } from "react";
import { dropTargetForElements } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { cn } from "@/lib/utils";
import type { KanbanColumn as KanbanColumnType } from "@/lib/ticketService";
import type { TicketMeta } from "@/lib/ticketService";
import type { NoteMeta } from "@/lib/noteService";
import { KanbanCard } from "./KanbanCard";
import { CreateTicketInline } from "./CreateTicketInline";

interface KanbanColumnProps {
  column: KanbanColumnType;
  tickets: TicketMeta[];
  notes: NoteMeta[];
  onDeleteTicket: (id: string) => void;
  onCreateTicket: (title: string, columnId: string) => Promise<void>;
  onCreateLinkedNote: (ticketId: string) => void;
}

export function KanbanColumn({
  column,
  tickets,
  notes,
  onDeleteTicket,
  onCreateTicket,
  onCreateLinkedNote,
}: KanbanColumnProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return dropTargetForElements({
      element: el,
      getData: () => ({ columnId: column.id, type: "column" }),
      canDrop: ({ source }) => source.data.type === "ticket",
      onDragEnter: () => setIsDragOver(true),
      onDragLeave: () => setIsDragOver(false),
      onDrop: () => setIsDragOver(false),
    });
  }, [column.id]);

  // Sort tickets by column_order
  const sortedTickets = [...tickets].sort(
    (a, b) => a.columnOrder - b.columnOrder,
  );

  return (
    <div
      ref={ref}
      className={cn(
        "flex w-64 shrink-0 flex-col gap-2 rounded-lg border p-3",
        "border-neutral-700/30 bg-neutral-800/30",
        isDragOver && "border-blue-500/40 bg-neutral-800/60",
        "transition-colors duration-150",
      )}
    >
      {/* Column header */}
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
          {column.name}
        </h3>
        <span className="text-xs text-neutral-600">{tickets.length}</span>
      </div>

      {/* Ticket list */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {sortedTickets.map((ticket) => (
          <KanbanCard
            key={ticket.id}
            ticket={ticket}
            linkedNotes={notes.filter((n) => n.ticketId === ticket.id)}
            onDelete={onDeleteTicket}
            onCreateLinkedNote={onCreateLinkedNote}
          />
        ))}
      </div>

      {/* Inline ticket creation */}
      <CreateTicketInline columnId={column.id} onSubmit={onCreateTicket} />
    </div>
  );
}
