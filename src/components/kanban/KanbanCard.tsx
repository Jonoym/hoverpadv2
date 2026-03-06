import { useEffect, useRef, useState } from "react";
import { draggable } from "@atlaskit/pragmatic-drag-and-drop/element/adapter";
import { cn } from "@/lib/utils";
import type { TicketMeta } from "@/lib/ticketService";
import type { NoteMeta } from "@/lib/noteService";

interface KanbanCardProps {
  ticket: TicketMeta;
  linkedNotes: NoteMeta[];
  onDelete: (id: string) => void;
  onCreateLinkedNote: (ticketId: string) => void;
}

/**
 * Format a due date string for display.
 * Shows "Today", "Tomorrow", "Yesterday", or a short date.
 */
function formatDueDate(dateStr: string): string {
  const due = new Date(dateStr);
  const now = new Date();

  // Normalize to start of day for comparison
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  return due.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/**
 * Determine the colour for a due date badge based on proximity.
 */
function dueDateColor(dateStr: string): string {
  const due = new Date(dateStr);
  const now = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays < 0) return "text-red-400";
  if (diffDays === 0) return "text-amber-400";
  if (diffDays <= 2) return "text-yellow-400";
  return "text-neutral-500";
}

export function KanbanCard({ ticket, linkedNotes, onDelete, onCreateLinkedNote }: KanbanCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    return draggable({
      element: el,
      getInitialData: () => ({
        ticketId: ticket.id,
        columnId: ticket.columnId,
        type: "ticket",
      }),
      onDragStart: () => setIsDragging(true),
      onDrop: () => setIsDragging(false),
    });
  }, [ticket.id, ticket.columnId]);

  return (
    <div
      ref={ref}
      className={cn(
        "group relative rounded-lg border px-3 py-2",
        "border-neutral-700/50 bg-neutral-800/50 shadow-sm",
        "transition-colors duration-150 hover:bg-neutral-700/50",
        "cursor-grab active:cursor-grabbing",
        isDragging && "opacity-50",
      )}
    >
      {/* Title */}
      <p className="truncate pr-5 text-sm text-neutral-100" title={ticket.title}>{ticket.title}</p>

      {/* Due date badge */}
      {ticket.dueDate && (
        <p className={cn("mt-1 text-xs", dueDateColor(ticket.dueDate))}>
          {formatDueDate(ticket.dueDate)}
        </p>
      )}

      {/* Linked notes badge + new note button */}
      <div className="mt-1 flex items-center gap-2">
        {linkedNotes.length > 0 && (
          <span className="text-xs text-blue-400">
            {linkedNotes.length} note{linkedNotes.length !== 1 ? "s" : ""}
          </span>
        )}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onCreateLinkedNote(ticket.id);
          }}
          className="text-xs text-blue-400 opacity-0 transition-all duration-150 hover:text-blue-300 group-hover:opacity-100"
          aria-label="Create linked note"
          title="New linked note"
        >
          + note
        </button>
      </div>

      {/* Delete button */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete(ticket.id);
        }}
        className={cn(
          "absolute right-1.5 top-1.5",
          "flex h-5 w-5 items-center justify-center rounded",
          "text-neutral-600 opacity-0 transition-all duration-150",
          "hover:bg-neutral-700 hover:text-red-400",
          "group-hover:opacity-100",
        )}
        aria-label="Delete ticket"
      >
        <svg
          width="10"
          height="10"
          viewBox="0 0 10 10"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <path
            d="M1 1L9 9M9 1L1 9"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
          />
        </svg>
      </button>
    </div>
  );
}
