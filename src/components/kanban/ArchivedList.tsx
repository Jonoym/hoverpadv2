import { useState, useEffect, useRef } from "react";
import type { TicketMeta, KanbanColumn } from "@/lib/ticketService";
import type { NoteMeta } from "@/lib/noteService";
import type { SessionMeta } from "@/lib/sessionService";

interface ArchivedListProps {
  tickets: TicketMeta[];
  columns: KanbanColumn[];
  notes: NoteMeta[];
  sessions: SessionMeta[];
  onUnarchive: (ticketId: string, columnId: string) => void;
  onDelete: (ticketId: string) => void;
  onOpenNote: (noteId: string) => void;
  onOpenSession: (sessionId: string) => void;
}

function shortProjectName(projectDir: string): string {
  const segments = projectDir.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return segments[segments.length - 1] ?? projectDir;
}

interface ContextMenuState {
  x: number;
  y: number;
  ticketId: string;
}

export function ArchivedList({
  tickets,
  columns,
  notes,
  sessions,
  onUnarchive,
  onDelete,
  onOpenNote,
  onOpenSession,
}: ArchivedListProps) {
  const [search, setSearch] = useState("");
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = (e: MouseEvent) => {
      if (contextMenuRef.current && !contextMenuRef.current.contains(e.target as Node)) {
        setContextMenu(null);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  const filtered = search
    ? tickets.filter(
        (t) =>
          t.title.toLowerCase().includes(search.toLowerCase()) ||
          (t.description ?? "").toLowerCase().includes(search.toLowerCase()),
      )
    : tickets;

  if (tickets.length === 0) {
    return (
      <p className="py-8 text-center text-xs text-neutral-600">
        No archived tickets yet
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Search */}
      <div className="relative">
        <svg
          className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-neutral-500"
          xmlns="http://www.w3.org/2000/svg"
          viewBox="0 0 20 20"
          fill="currentColor"
        >
          <path
            fillRule="evenodd"
            d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
            clipRule="evenodd"
          />
        </svg>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search archived tickets..."
          className="w-full rounded-lg border border-neutral-700/50 bg-neutral-800/50 py-1.5 pl-8 pr-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {/* Results */}
      <div className="flex flex-col gap-1">
        {filtered.length === 0 ? (
          <p className="py-4 text-center text-xs text-neutral-600">
            No matches
          </p>
        ) : (
          filtered.map((ticket) => {
            const linkedNotes = notes.filter((n) => n.ticketIds.includes(ticket.id));
            const linkedSessions = sessions.filter((s) => s.ticketIds.includes(ticket.id));

            return (
              <div
                key={ticket.id}
                className="group rounded-lg border border-neutral-700/50 bg-neutral-800/50 px-3 py-2 transition-colors duration-150 hover:bg-neutral-700/50"
                onContextMenu={(e) => {
                  e.preventDefault();
                  setContextMenu({ x: e.clientX, y: e.clientY, ticketId: ticket.id });
                }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm text-neutral-100">{ticket.title}</p>
                    {ticket.description && (
                      <p className="mt-0.5 text-xs text-neutral-400 line-clamp-1">
                        {ticket.description}
                      </p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-neutral-600">
                    {new Date(ticket.updatedAt).toLocaleDateString(undefined, {
                      month: "short",
                      day: "numeric",
                    })}
                  </span>
                </div>

                {/* Linked items summary */}
                {(linkedNotes.length > 0 || linkedSessions.length > 0) && (
                  <div className="mt-1.5 flex flex-wrap gap-2">
                    {linkedNotes.map((note) => (
                      <button
                        key={note.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenNote(note.id);
                        }}
                        className="flex cursor-pointer items-center gap-1 rounded border border-neutral-700/40 bg-neutral-750/40 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-neutral-600/50 hover:text-neutral-300"
                      >
                        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="shrink-0">
                          <path d="M4 1h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M5 5h6M5 8h6M5 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        <span className="truncate max-w-[80px]">{note.title}</span>
                      </button>
                    ))}
                    {linkedSessions.map((session) => (
                      <button
                        key={session.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onOpenSession(session.id);
                        }}
                        className="flex cursor-pointer items-center gap-1 rounded border border-neutral-700/40 bg-neutral-750/40 px-1.5 py-0.5 text-[10px] text-neutral-400 transition-colors hover:border-neutral-600/50 hover:text-neutral-300"
                      >
                        <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="shrink-0">
                          <path d="M2 4V13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3H3a1 1 0 0 0-1 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                        </svg>
                        <span className="truncate max-w-[80px]">{shortProjectName(session.projectDir)}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[160px] rounded-md border border-neutral-700 bg-neutral-800 py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {columns.map((col) => (
            <button
              key={col.id}
              type="button"
              onClick={() => {
                onUnarchive(contextMenu.ticketId, col.id);
                setContextMenu(null);
              }}
              className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
            >
              Move to {col.name}
            </button>
          ))}
          <div className="my-1 border-t border-neutral-700/50" />
          <button
            type="button"
            onClick={() => {
              onDelete(contextMenu.ticketId);
              setContextMenu(null);
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/50"
          >
            Delete permanently
          </button>
        </div>
      )}
    </div>
  );
}
