import { useEffect, useCallback, useRef, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { useGlobalStore } from "@/stores/globalStore";
import { cn } from "@/lib/utils";
import {
  createTicket,
  deleteTicket,
  moveTicket,
  updateTicket,
  removeTagFromTicket,
  archiveColumnTickets,
  unarchiveTicket,
  addChecklistItem,
  toggleChecklistItem,
  deleteChecklistItem,
} from "@/lib/ticketService";
import { createNote, linkNoteToTicket, setNoteOpen, deleteNote, unlinkNote } from "@/lib/noteService";
import { linkSessionToTicket, unlinkSession, deleteSession, type SessionMeta } from "@/lib/sessionService";
import { createNoteWindow, createSessionWindow } from "@/lib/windowManager";
import { invoke } from "@tauri-apps/api/core";
import { KanbanColumn } from "./KanbanColumn";
import { ArchivedList } from "./ArchivedList";

const DRAG_THRESHOLD = 5; // px of movement before drag activates

export function KanbanBoard() {
  const { columns, tickets, archivedTickets, notes, sessions, columnsLoading, ticketsLoading, refreshColumns, refreshTickets, refreshArchivedTickets, refreshNotes, refreshSessions } =
    useGlobalStore(
      useShallow((s) => ({
        columns: s.columns,
        tickets: s.tickets,
        archivedTickets: s.archivedTickets,
        notes: s.notes,
        sessions: s.sessions,
        columnsLoading: s.columnsLoading,
        ticketsLoading: s.ticketsLoading,
        refreshColumns: s.refreshColumns,
        refreshTickets: s.refreshTickets,
        refreshArchivedTickets: s.refreshArchivedTickets,
        refreshNotes: s.refreshNotes,
        refreshSessions: s.refreshSessions,
      })),
    );

  // Refs for stable access in pointer event handlers
  const ticketsRef = useRef(tickets);
  ticketsRef.current = tickets;
  const refreshTicketsRef = useRef(refreshTickets);
  refreshTicketsRef.current = refreshTickets;

  // Column DOM refs for hit-testing during drag
  const columnRefs = useRef(new Map<string, HTMLDivElement>());

  // Drag overlay ref — position updated via DOM for smooth tracking
  const overlayRef = useRef<HTMLDivElement>(null);

  // Cleanup ref for unmount safety
  const cleanupRef = useRef<(() => void) | null>(null);

  // React state — only for rendering changes (not per-pixel updates)
  const [draggingTicketId, setDraggingTicketId] = useState<string | null>(null);
  const [draggingTitle, setDraggingTitle] = useState("");
  const [draggingWidth, setDraggingWidth] = useState<number | null>(null);
  const [hoverColumnId, setHoverColumnId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<"active" | "archived">("active");

  // Transient drag data — stored in ref to avoid re-renders
  const dragDataRef = useRef<{
    ticketId: string;
    columnId: string;
    title: string;
    startX: number;
    startY: number;
    started: boolean;
  } | null>(null);

  const registerColumnRef = useCallback((columnId: string, el: HTMLDivElement | null) => {
    if (el) {
      columnRefs.current.set(columnId, el);
    } else {
      columnRefs.current.delete(columnId);
    }
  }, []);

  const getColumnAtPoint = useCallback((x: number, y: number): string | null => {
    for (const [columnId, el] of columnRefs.current) {
      const rect = el.getBoundingClientRect();
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return columnId;
      }
    }
    return null;
  }, []);

  // Hydrate data on mount
  useEffect(() => {
    void refreshColumns();
    void refreshTickets();
    void refreshArchivedTickets();
    void refreshNotes();
    void refreshSessions();
  }, [refreshColumns, refreshTickets, refreshArchivedTickets, refreshNotes, refreshSessions]);

  // Cleanup listeners on unmount
  useEffect(() => {
    return () => cleanupRef.current?.();
  }, []);

  // Called by KanbanCard on pointerdown on the drag handle
  const handleDragStart = useCallback((ticketId: string, columnId: string, title: string, cardWidth: number, e: React.PointerEvent) => {
    e.preventDefault();

    dragDataRef.current = {
      ticketId,
      columnId,
      title,
      startX: e.clientX,
      startY: e.clientY,
      started: false,
    };

    const onMove = (ev: PointerEvent) => {
      const d = dragDataRef.current;
      if (!d) return;

      if (!d.started) {
        const dist = Math.hypot(ev.clientX - d.startX, ev.clientY - d.startY);
        if (dist < DRAG_THRESHOLD) return;
        // Threshold met — activate drag
        d.started = true;
        setDraggingTicketId(d.ticketId);
        setDraggingTitle(d.title);
        setDraggingWidth(cardWidth);
      }

      // Move overlay directly via DOM
      if (overlayRef.current) {
        overlayRef.current.style.left = `${ev.clientX + 12}px`;
        overlayRef.current.style.top = `${ev.clientY - 12}px`;
      }

      // Column hit-test
      const col = getColumnAtPoint(ev.clientX, ev.clientY);
      setHoverColumnId(col);
    };

    const onUp = (ev: PointerEvent) => {
      cleanup();

      const d = dragDataRef.current;
      dragDataRef.current = null;

      if (d?.started) {
        const targetColumnId = getColumnAtPoint(ev.clientX, ev.clientY);
        if (targetColumnId) {
          const currentTickets = ticketsRef.current;
          const ticketsInColumn = currentTickets.filter(
            (t) => t.columnId === targetColumnId && t.id !== d.ticketId,
          );
          void moveTicket(d.ticketId, targetColumnId, ticketsInColumn.length).then(() => {
            void refreshTicketsRef.current();
          });
        }
      }

      setDraggingTicketId(null);
      setDraggingWidth(null);
      setHoverColumnId(null);
    };

    const onCancel = () => {
      cleanup();
      dragDataRef.current = null;
      setDraggingTicketId(null);
      setDraggingWidth(null);
      setHoverColumnId(null);
    };

    const cleanup = () => {
      document.removeEventListener("pointermove", onMove);
      document.removeEventListener("pointerup", onUp);
      document.removeEventListener("pointercancel", onCancel);
      cleanupRef.current = null;
    };

    document.addEventListener("pointermove", onMove);
    document.addEventListener("pointerup", onUp);
    document.addEventListener("pointercancel", onCancel);
    cleanupRef.current = cleanup;
  }, [getColumnAtPoint]);

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

  const handleMoveToColumn = useCallback(
    (ticketId: string, columnId: string) => {
      void (async () => {
        try {
          // Use ref for fresh ticket data (avoids stale closure)
          const currentTickets = ticketsRef.current;
          const ticketsInCol = currentTickets.filter(
            (t) => t.columnId === columnId && t.id !== ticketId,
          );
          await moveTicket(ticketId, columnId, ticketsInCol.length);
          await refreshTickets();
        } catch (err) {
          console.error("[hoverpad] Failed to move ticket:", err);
        }
      })();
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

  const handleRenameTicket = useCallback(
    (ticketId: string, newTitle: string) => {
      void updateTicket(ticketId, { title: newTitle }).then(() => {
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

  const handleOpenNote = useCallback(
    (noteId: string) => {
      void (async () => {
        try {
          await setNoteOpen(noteId, true);
          await createNoteWindow(noteId);
          await refreshNotes();
        } catch (err) {
          console.error("[hoverpad] Failed to open note from kanban:", err);
        }
      })();
    },
    [refreshNotes],
  );

  const handleDeleteNote = useCallback(
    (noteId: string) => {
      void (async () => {
        try {
          await deleteNote(noteId);
          await refreshNotes();
        } catch (err) {
          console.error("[hoverpad] Failed to delete note from kanban:", err);
        }
      })();
    },
    [refreshNotes],
  );

  const handleUnlinkNote = useCallback(
    (noteId: string, ticketId: string) => {
      void (async () => {
        try {
          await unlinkNote(noteId, ticketId);
          await refreshNotes();
        } catch (err) {
          console.error("[hoverpad] Failed to unlink note from kanban:", err);
        }
      })();
    },
    [refreshNotes],
  );

  const handleLinkNote = useCallback(
    (ticketId: string, noteId: string) => {
      void (async () => {
        try {
          await linkNoteToTicket(noteId, ticketId);
          await refreshNotes();
        } catch (err) {
          console.error("[hoverpad] Failed to link note to ticket:", err);
        }
      })();
    },
    [refreshNotes],
  );

  const handleUpdateDescription = useCallback(
    (ticketId: string, description: string) => {
      void (async () => {
        try {
          await updateTicket(ticketId, { description: description || null });
          await refreshTickets();
        } catch (err) {
          console.error("[hoverpad] Failed to update ticket description:", err);
        }
      })();
    },
    [refreshTickets],
  );

  const handleOpenSession = useCallback(
    (sessionId: string) => {
      void (async () => {
        try {
          await createSessionWindow(sessionId);
        } catch (err) {
          console.error("[hoverpad] Failed to open session from kanban:", err);
        }
      })();
    },
    [],
  );

  const handleFocusSession = useCallback(
    (session: SessionMeta) => {
      void invoke("open_vscode", {
        workingDir: session.workingDir || session.projectDir,
      }).catch((err) => {
        console.error("[hoverpad] Failed to open VS Code from kanban:", err);
      });
    },
    [],
  );

  const handleOpenTerminalSession = useCallback(
    (session: SessionMeta) => {
      void invoke("open_terminal", {
        workingDir: session.workingDir || session.projectDir,
      }).catch((err) => {
        console.error("[hoverpad] Failed to open terminal from kanban:", err);
      });
    },
    [],
  );

  const handleCopyResumeSession = useCallback(
    (session: SessionMeta) => {
      const cmd = `claude --resume "${session.sessionId}"`;
      navigator.clipboard.writeText(cmd).catch((err) => {
        console.error("[hoverpad] Failed to copy to clipboard:", err);
      });
    },
    [],
  );

  const handleDeleteSession = useCallback(
    (session: SessionMeta) => {
      void (async () => {
        try {
          await deleteSession(session.id, session.encodedProjectDir);
          await refreshSessions();
        } catch (err) {
          console.error("[hoverpad] Failed to delete session from kanban:", err);
        }
      })();
    },
    [refreshSessions],
  );

  const handleLinkSession = useCallback(
    (ticketId: string, sessionId: string) => {
      void (async () => {
        try {
          await linkSessionToTicket(sessionId, ticketId);
          await refreshSessions();
        } catch (err) {
          console.error("[hoverpad] Failed to link session to ticket:", err);
        }
      })();
    },
    [refreshSessions],
  );

  const handleUnlinkSession = useCallback(
    (sessionId: string, ticketId: string) => {
      void (async () => {
        try {
          await unlinkSession(sessionId, ticketId);
          await refreshSessions();
        } catch (err) {
          console.error("[hoverpad] Failed to unlink session:", err);
        }
      })();
    },
    [refreshSessions],
  );

  const handleArchiveDone = useCallback(
    () => {
      void (async () => {
        try {
          await archiveColumnTickets("done");
          await refreshTickets();
          await refreshArchivedTickets();
        } catch (err) {
          console.error("[hoverpad] Failed to archive done tickets:", err);
        }
      })();
    },
    [refreshTickets, refreshArchivedTickets],
  );

  const handleUnarchive = useCallback(
    (ticketId: string, columnId: string) => {
      void (async () => {
        try {
          await unarchiveTicket(ticketId, columnId);
          await refreshTickets();
          await refreshArchivedTickets();
        } catch (err) {
          console.error("[hoverpad] Failed to unarchive ticket:", err);
        }
      })();
    },
    [refreshTickets, refreshArchivedTickets],
  );

  const handleDeleteArchivedTicket = useCallback(
    (id: string) => {
      void deleteTicket(id).then(() => {
        void refreshArchivedTickets();
      });
    },
    [refreshArchivedTickets],
  );

  const handleAddChecklistItem = useCallback(
    (ticketId: string, label: string) => {
      void addChecklistItem(ticketId, label).then(() => {
        void refreshTickets();
      });
    },
    [refreshTickets],
  );

  const handleToggleChecklistItem = useCallback(
    (itemId: string, checked: boolean) => {
      void toggleChecklistItem(itemId, checked).then(() => {
        void refreshTickets();
      });
    },
    [refreshTickets],
  );

  const handleDeleteChecklistItem = useCallback(
    (itemId: string) => {
      void deleteChecklistItem(itemId).then(() => {
        void refreshTickets();
      });
    },
    [refreshTickets],
  );

  const handleRemoveTag = useCallback(
    (ticketId: string, tagId: string) => {
      void (async () => {
        try {
          await removeTagFromTicket(ticketId, tagId);
          await refreshTickets();
        } catch (err) {
          console.error("[hoverpad] Failed to remove tag:", err);
        }
      })();
    },
    [refreshTickets],
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

  const doneTicketCount = ticketsByColumn.get("done")?.length ?? 0;

  return (
    <div className="flex flex-col gap-0.5">
      {/* Tabs */}
      <div className="flex h-8 items-center gap-1 px-2">
        <button
          type="button"
          onClick={() => setActiveTab("active")}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150",
            activeTab === "active"
              ? "bg-neutral-700/60 text-neutral-100"
              : "text-neutral-500 hover:text-neutral-300",
          )}
        >
          Active
        </button>
        <button
          type="button"
          onClick={() => setActiveTab("archived")}
          className={cn(
            "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150",
            activeTab === "archived"
              ? "bg-neutral-700/60 text-neutral-100"
              : "text-neutral-500 hover:text-neutral-300",
          )}
        >
          Archived
          {archivedTickets.length > 0 && (
            <span className="ml-1.5 text-neutral-600">{archivedTickets.length}</span>
          )}
        </button>
      </div>

      {/* Active board view */}
      {activeTab === "active" && (
        <div className="relative flex gap-4 overflow-x-auto pb-2">
          {columns.map((column) => (
            <KanbanColumn
              key={column.id}
              column={column}
              columns={columns}
              tickets={ticketsByColumn.get(column.id) ?? []}
              notes={notes}
              sessions={sessions}
              onDeleteTicket={handleDeleteTicket}
              onRenameTicket={handleRenameTicket}
              onMoveToColumn={handleMoveToColumn}
              onCreateTicket={handleCreateTicket}
              onCreateLinkedNote={handleCreateLinkedNote}
              onOpenNote={handleOpenNote}
              onDeleteNote={handleDeleteNote}
              onUnlinkNote={handleUnlinkNote}
              onLinkNote={handleLinkNote}
              onUpdateDescription={handleUpdateDescription}
              onOpenSession={handleOpenSession}
              onFocusSession={handleFocusSession}
              onOpenTerminalSession={handleOpenTerminalSession}
              onCopyResumeSession={handleCopyResumeSession}
              onDeleteSession={handleDeleteSession}
              onLinkSession={handleLinkSession}
              onUnlinkSession={handleUnlinkSession}
              onRemoveTag={handleRemoveTag}
              onAddChecklistItem={handleAddChecklistItem}
              onToggleChecklistItem={handleToggleChecklistItem}
              onDeleteChecklistItem={handleDeleteChecklistItem}
              onDragStart={handleDragStart}
              registerRef={registerColumnRef}
              isDragOver={hoverColumnId === column.id}
              draggingTicketId={draggingTicketId}
              onArchiveColumn={column.id === "done" ? handleArchiveDone : undefined}
              archiveCount={column.id === "done" ? doneTicketCount : undefined}
            />
          ))}

          {/* Drag overlay — follows cursor via DOM ref, pointer-events disabled */}
          {draggingTicketId && (
            <div
              ref={overlayRef}
              className="pointer-events-none fixed z-50 rounded-lg border border-blue-500/50 bg-neutral-800/90 px-3 py-2 shadow-lg backdrop-blur-sm"
              style={{ left: -9999, top: -9999, width: draggingWidth ?? undefined }}
            >
              <p className="truncate text-sm text-neutral-100">{draggingTitle}</p>
            </div>
          )}
        </div>
      )}

      {/* Archived list view */}
      {activeTab === "archived" && (
        <ArchivedList
          tickets={archivedTickets}
          columns={columns}
          notes={notes}
          sessions={sessions}
          onUnarchive={handleUnarchive}
          onDelete={handleDeleteArchivedTicket}
          onOpenNote={handleOpenNote}
          onOpenSession={handleOpenSession}
        />
      )}
    </div>
  );
}
