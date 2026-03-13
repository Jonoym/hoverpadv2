import { useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { KanbanColumn as KanbanColumnType } from "@/lib/ticketService";
import type { TicketMeta } from "@/lib/ticketService";
import type { NoteMeta } from "@/lib/noteService";
import type { SessionMeta } from "@/lib/sessionService";
import { KanbanCard } from "./KanbanCard";
import { CreateTicketInline } from "./CreateTicketInline";

interface KanbanColumnProps {
  column: KanbanColumnType;
  columns: KanbanColumnType[];
  tickets: TicketMeta[];
  notes: NoteMeta[];
  sessions: SessionMeta[];
  onDeleteTicket: (id: string) => void;
  onRenameTicket: (ticketId: string, newTitle: string) => void;
  onMoveToColumn: (ticketId: string, columnId: string) => void;
  onCreateTicket: (title: string, columnId: string) => Promise<void>;
  onCreateLinkedNote: (ticketId: string) => void;
  onOpenNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onUnlinkNote: (noteId: string, ticketId: string) => void;
  onLinkNote: (ticketId: string, noteId: string) => void;
  onUpdateDescription: (ticketId: string, description: string) => void;
  onOpenSession: (sessionId: string) => void;
  onFocusSession: (session: SessionMeta) => void;
  onOpenTerminalSession: (session: SessionMeta) => void;
  onCopyResumeSession: (session: SessionMeta) => void;
  onDeleteSession: (session: SessionMeta) => void;
  onLinkSession: (ticketId: string, sessionId: string) => void;
  onUnlinkSession: (sessionId: string, ticketId: string) => void;
  onRemoveTag: (ticketId: string, tagId: string) => void;
  onAddChecklistItem: (ticketId: string, label: string) => void;
  onToggleChecklistItem: (itemId: string, checked: boolean) => void;
  onDeleteChecklistItem: (itemId: string) => void;
  onDragStart: (ticketId: string, columnId: string, title: string, cardWidth: number, e: React.PointerEvent) => void;
  registerRef: (columnId: string, el: HTMLDivElement | null) => void;
  isDragOver: boolean;
  draggingTicketId: string | null;
  onArchiveColumn?: () => void;
  archiveCount?: number;
}

export function KanbanColumn({
  column,
  columns,
  tickets,
  notes,
  sessions,
  onDeleteTicket,
  onRenameTicket,
  onMoveToColumn,
  onCreateTicket,
  onCreateLinkedNote,
  onOpenNote,
  onDeleteNote,
  onUnlinkNote,
  onLinkNote,
  onUpdateDescription,
  onOpenSession,
  onFocusSession,
  onOpenTerminalSession,
  onCopyResumeSession,
  onDeleteSession,
  onLinkSession,
  onUnlinkSession,
  onRemoveTag,
  onAddChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
  onDragStart,
  registerRef,
  isDragOver,
  draggingTicketId,
  onArchiveColumn,
  archiveCount,
}: KanbanColumnProps) {
  const ref = useRef<HTMLDivElement>(null);

  // Register this column's DOM element with the board for hit-testing
  useEffect(() => {
    registerRef(column.id, ref.current);
    return () => registerRef(column.id, null);
  }, [column.id, registerRef]);

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
        <div className="flex items-center gap-1.5">
          {onArchiveColumn && (archiveCount ?? 0) > 0 && (
            <button
              type="button"
              onClick={onArchiveColumn}
              className="cursor-pointer text-[10px] text-neutral-600 transition-colors duration-150 hover:text-neutral-400"
              title="Archive all done tickets"
            >
              Archive all
            </button>
          )}
          <span className="text-xs text-neutral-600">{tickets.length}</span>
        </div>
      </div>

      {/* Ticket list + inline creation pinned after last card */}
      <div className="flex flex-1 flex-col gap-1.5 overflow-y-auto">
        {sortedTickets.map((ticket) => (
          <KanbanCard
            key={ticket.id}
            ticket={ticket}
            columns={columns}
            linkedNotes={notes.filter((n) => n.ticketIds.includes(ticket.id))}
            linkedSessions={sessions.filter((s) => s.ticketIds.includes(ticket.id))}
            allSessions={sessions}
            allNotes={notes}
            onDelete={onDeleteTicket}
            onRename={onRenameTicket}
            onMoveToColumn={onMoveToColumn}
            onCreateLinkedNote={onCreateLinkedNote}
            onOpenNote={onOpenNote}
            onDeleteNote={onDeleteNote}
            onUnlinkNote={onUnlinkNote}
            onLinkNote={onLinkNote}
            onUpdateDescription={onUpdateDescription}
            onOpenSession={onOpenSession}
            onFocusSession={onFocusSession}
            onOpenTerminalSession={onOpenTerminalSession}
            onCopyResumeSession={onCopyResumeSession}
            onDeleteSession={onDeleteSession}
            onLinkSession={onLinkSession}
            onUnlinkSession={onUnlinkSession}
            onRemoveTag={onRemoveTag}
            onAddChecklistItem={onAddChecklistItem}
            onToggleChecklistItem={onToggleChecklistItem}
            onDeleteChecklistItem={onDeleteChecklistItem}
            onDragStart={onDragStart}
            isDragging={draggingTicketId === ticket.id}
          />
        ))}
        <CreateTicketInline columnId={column.id} onSubmit={onCreateTicket} />
      </div>
    </div>
  );
}
