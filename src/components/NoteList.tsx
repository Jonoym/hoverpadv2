import { useState, useEffect, useRef, useMemo, useCallback, memo } from "react";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cn } from "@/lib/utils";
import { timeAgo } from "@/lib/timeAgo";
import { deleteNote, setNoteOpen, toggleNoteStarred, renameNote, linkNoteToTicket, unlinkNote, searchNotes, type NoteMeta } from "@/lib/noteService";
import { createNoteWindow } from "@/lib/windowManager";
import { emitEvent } from "@/lib/events";
import { useGlobalStore } from "@/stores/globalStore";
import { useShallow } from "zustand/react/shallow";
import { ContextMenuPopover } from "@/components/ContextMenu";

// ---------------------------------------------------------------------------
// Column color mapping for ticket pills
// ---------------------------------------------------------------------------

const COLUMN_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  backlog: { bg: "bg-sky-900/40", text: "text-sky-300", border: "border-sky-700/40" },
  in_progress: { bg: "bg-blue-900/40", text: "text-blue-300", border: "border-blue-700/40" },
  review: { bg: "bg-amber-900/40", text: "text-amber-300", border: "border-amber-700/40" },
  done: { bg: "bg-green-900/40", text: "text-green-300", border: "border-green-700/40" },
};

function columnStyle(columnId: string) {
  return COLUMN_COLORS[columnId] ?? { bg: "bg-neutral-700/50", text: "text-neutral-300", border: "border-neutral-600/40" };
}

// ---------------------------------------------------------------------------
// Section header (used for starred banner and column headers)
// ---------------------------------------------------------------------------

function SectionHeader({
  title,
  count,
  isOpen,
  onToggle,
}: {
  title: string;
  count: number;
  isOpen: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 py-1.5 cursor-pointer"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        className={cn(
          "shrink-0 transition-transform text-neutral-500",
          isOpen ? "rotate-90" : "rotate-0",
        )}
      >
        <path
          d="M3 1L7 5L3 9"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      <span className="text-xs font-semibold uppercase tracking-wider text-neutral-400">
        {title}
      </span>
      <span className="text-xs text-neutral-600">{count}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Compact NoteRow (vertical stack for narrow columns)
// ---------------------------------------------------------------------------

const NoteRow = memo(function NoteRow({
  note,
  tickets,
  columns,
  onOpen,
  onFocus,
  onDelete,
  onToggleStar,
  onRename,
  onLinkTicket,
  onUnlinkTicket,
}: {
  note: NoteMeta;
  tickets: { id: string; title: string; columnId: string }[];
  columns: { id: string; name: string }[];
  onOpen: (note: NoteMeta) => void;
  onFocus: (note: NoteMeta) => void;
  onDelete: (note: NoteMeta) => void;
  onToggleStar: (note: NoteMeta) => void;
  onRename: (noteId: string, newTitle: string) => void;
  onLinkTicket: (noteId: string, ticketId: string) => void;
  onUnlinkTicket: (noteId: string, ticketId: string) => void;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState(note.title);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);
  const [showTicketPicker, setShowTicketPicker] = useState(false);
  const [ticketSearch, setTicketSearch] = useState("");
  const ticketPickerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [contextMenu]);

  useEffect(() => {
    if (!showTicketPicker) return;
    const handler = (e: MouseEvent) => {
      if (ticketPickerRef.current && !ticketPickerRef.current.contains(e.target as Node)) {
        setShowTicketPicker(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showTicketPicker]);

  const startRename = () => {
    setEditValue(note.title);
    setIsEditing(true);
  };

  const handleRenameSubmit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== note.title) {
      onRename(note.id, trimmed);
    }
    setIsEditing(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      handleRenameSubmit();
    } else if (e.key === "Escape") {
      setIsEditing(false);
    }
  };

  const handleClick = () => {
    if (isEditing) return;
    if (note.isOpen) {
      onFocus(note);
    } else {
      onOpen(note);
    }
  };

  const linkedTickets = note.ticketIds
    .map((tid) => tickets.find((t) => t.id === tid))
    .filter((t): t is { id: string; title: string; columnId: string } => !!t);

  const filteredTickets = tickets.filter(
    (t) =>
      !note.ticketIds.includes(t.id) &&
      (!ticketSearch ||
        t.title.toLowerCase().includes(ticketSearch.toLowerCase())),
  );

  return (
    <>
      <div
        className={cn(
          "group flex h-[72px] flex-col overflow-hidden rounded-lg px-2.5 py-2 cursor-pointer",
          "border border-neutral-700/50 bg-neutral-800/50",
          "transition-colors duration-150 hover:bg-neutral-700/50",
        )}
        onClick={handleClick}
        onContextMenu={(e) => {
          e.preventDefault();
          setContextMenu({ x: e.clientX, y: e.clientY });
        }}
      >
        {/* Row 1: Star + Title + Timestamp */}
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              onToggleStar(note);
            }}
            className={cn(
              "shrink-0 text-xs cursor-pointer transition-colors duration-150",
              note.starred
                ? "text-amber-400"
                : "text-neutral-600 hover:text-amber-400/60",
            )}
            title={note.starred ? "Unstar" : "Star"}
          >
            {note.starred ? "\u2605" : "\u2606"}
          </button>

          <div className="min-w-0 flex-1">
            {isEditing ? (
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleRenameSubmit}
                onKeyDown={handleKeyDown}
                onClick={(e) => e.stopPropagation()}
                autoFocus
                className="w-full text-xs font-medium text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 outline-none focus:border-blue-500"
              />
            ) : (
              <p className="truncate text-xs font-medium text-neutral-100" title={note.title}>
                {note.title}
              </p>
            )}
          </div>

          <span className="shrink-0 text-[10px] text-neutral-500 whitespace-nowrap">
            {timeAgo(note.updatedAt)}
          </span>
        </div>

        {/* Row 2: Preview text (always rendered for consistent height) */}
        <p className={cn(
          "text-xs text-neutral-500 mt-0.5",
          linkedTickets.length > 0 ? "line-clamp-1" : "line-clamp-2",
        )}>
          {note.preview || "\u00A0"}
        </p>

        {/* Row 3: Linked ticket pills */}
        {linkedTickets.length > 0 && (
          <div className="mt-auto flex items-center gap-1 overflow-x-auto [&::-webkit-scrollbar]:hidden">
            {linkedTickets.map((ticket) => {
              const cs = columnStyle(ticket.columnId);
              return (
                <span
                  key={ticket.id}
                  className={cn(
                    "inline-flex shrink-0 items-center gap-0.5 rounded-full border px-1.5 py-0 text-[10px]",
                    cs.bg, cs.text, cs.border,
                  )}
                >
                  {ticket.title}
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onUnlinkTicket(note.id, ticket.id);
                    }}
                    className="ml-0.5 cursor-pointer opacity-0 transition-opacity duration-150 hover:text-red-400 group-hover:opacity-100"
                    title="Unlink ticket"
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        )}

        {/* Inline ticket picker (opened from context menu) */}
        {showTicketPicker && (
          <div
            ref={ticketPickerRef}
            className="rounded border border-neutral-700 bg-neutral-800 p-1 shadow-lg"
            onClick={(e) => e.stopPropagation()}
          >
            <input
              type="text"
              autoFocus
              value={ticketSearch}
              onChange={(e) => setTicketSearch(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setShowTicketPicker(false);
              }}
              placeholder="Search tickets..."
              className="mb-1 w-full rounded bg-neutral-700/50 px-1.5 py-1 text-xs text-neutral-300 outline-none placeholder:text-neutral-600"
            />
            <div className="max-h-32 overflow-y-auto">
              {filteredTickets.length === 0 ? (
                <p className="px-1.5 py-1 text-[10px] text-neutral-600">No tickets available</p>
              ) : (
                filteredTickets.slice(0, 10).map((t) => {
                  const col = columns.find((c) => c.id === t.columnId);
                  const cs = columnStyle(t.columnId);
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onLinkTicket(note.id, t.id);
                        setShowTicketPicker(false);
                      }}
                      className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700/50"
                    >
                      <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", cs.bg)} />
                      <span className="truncate">{t.title}</span>
                      {col && (
                        <span className="ml-auto shrink-0 text-[10px] text-neutral-600">{col.name}</span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <ContextMenuPopover x={contextMenu.x} y={contextMenu.y}>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              startRename();
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
          >
            Rename
          </button>
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              setShowTicketPicker(true);
              setTicketSearch("");
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
          >
            Link to ticket
          </button>
          <div className="my-1 border-t border-neutral-700/50" />
          <button
            type="button"
            onClick={() => {
              setContextMenu(null);
              onDelete(note);
            }}
            className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/50"
          >
            Delete
          </button>
        </ContextMenuPopover>
      )}
    </>
  );
});

// ---------------------------------------------------------------------------
// NoteList component
// ---------------------------------------------------------------------------

interface NoteListProps {
  notes: NoteMeta[];
  loading: boolean;
}

const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

export function NoteList({ notes, loading }: NoteListProps) {
  const { tickets, columns, refreshNotes } = useGlobalStore(
    useShallow((s) => ({
      tickets: s.tickets,
      columns: s.columns,
      refreshNotes: s.refreshNotes,
    })),
  );

  // Search state
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<NoteMeta[] | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!searchQuery.trim()) {
      setSearchResults(null);
      return;
    }

    debounceRef.current = setTimeout(() => {
      searchNotes(searchQuery)
        .then(setSearchResults)
        .catch((err) => {
          console.error("[hoverpad] Search failed:", err);
          setSearchResults(null);
        });
    }, 300);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery]);

  // Section collapse state
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    starred: true,
    open: true,
    recent: true,
    inactive: false,
  });

  const toggleSection = useCallback((key: string) => {
    setOpenSections((prev) => ({ ...prev, [key]: !prev[key] }));
  }, []);

  // Categorize notes
  const { starred, open, recent, inactive } = useMemo(() => {
    const now = Date.now();
    const starredNotes: NoteMeta[] = [];
    const openNotes: NoteMeta[] = [];
    const recentNotes: NoteMeta[] = [];
    const inactiveNotes: NoteMeta[] = [];

    for (const note of notes) {
      if (note.starred) {
        starredNotes.push(note);
        continue;
      }
      if (note.isOpen) {
        openNotes.push(note);
        continue;
      }
      const updatedMs = new Date(note.updatedAt).getTime();
      if (now - updatedMs < SEVEN_DAYS_MS) {
        recentNotes.push(note);
      } else {
        inactiveNotes.push(note);
      }
    }

    return {
      starred: starredNotes,
      open: openNotes,
      recent: recentNotes,
      inactive: inactiveNotes,
    };
  }, [notes]);

  const handleOpen = useCallback(async (note: NoteMeta) => {
    try {
      await setNoteOpen(note.id, true);
      await createNoteWindow(note.id);
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to open note:", err);
    }
  }, [refreshNotes]);

  const handleFocus = useCallback(async (note: NoteMeta) => {
    try {
      const win = await WebviewWindow.getByLabel(`note-${note.id}`);
      if (win) {
        await win.setFocus();
      } else {
        await handleOpen(note);
      }
    } catch (err) {
      console.error("[hoverpad] Failed to focus note:", err);
    }
  }, [handleOpen]);

  const handleDelete = useCallback(async (note: NoteMeta) => {
    try {
      const win = await WebviewWindow.getByLabel(`note-${note.id}`);
      if (win) {
        await win.close();
      }
      await setNoteOpen(note.id, false);
      await deleteNote(note.id);
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to delete note:", err);
    }
  }, [refreshNotes]);

  const handleToggleStar = useCallback(async (note: NoteMeta) => {
    try {
      await toggleNoteStarred(note.id);
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to toggle star:", err);
    }
  }, [refreshNotes]);

  const handleRename = useCallback(async (noteId: string, newTitle: string) => {
    try {
      await renameNote(noteId, newTitle);
      await refreshNotes();
      await emitEvent("note:renamed", { noteId, newTitle });
    } catch (err) {
      console.error("[hoverpad] Failed to rename note:", err);
    }
  }, [refreshNotes]);

  const handleLinkTicket = useCallback(async (noteId: string, ticketId: string) => {
    try {
      await linkNoteToTicket(noteId, ticketId);
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to link note to ticket:", err);
    }
  }, [refreshNotes]);

  const handleUnlinkTicket = useCallback(async (noteId: string, ticketId: string) => {
    try {
      await unlinkNote(noteId, ticketId);
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to unlink note:", err);
    }
  }, [refreshNotes]);

  if (loading) {
    return (
      <p className="text-xs text-neutral-500">Loading notes...</p>
    );
  }

  if (notes.length === 0 && !searchQuery) {
    return (
      <p className="text-xs text-neutral-500">
        No notes yet. Press "New Note" to create one.
      </p>
    );
  }

  const renderNotes = (list: NoteMeta[]) =>
    list.map((note) => (
      <NoteRow
        key={note.id}
        note={note}
        tickets={tickets}
        columns={columns}
        onOpen={(n) => void handleOpen(n)}
        onFocus={(n) => void handleFocus(n)}
        onDelete={(n) => void handleDelete(n)}
        onToggleStar={(n) => void handleToggleStar(n)}
        onRename={(id, title) => void handleRename(id, title)}
        onLinkTicket={(nId, tId) => void handleLinkTicket(nId, tId)}
        onUnlinkTicket={(nId, tId) => void handleUnlinkTicket(nId, tId)}
      />
    ));

  // Collect the sections to display (non-empty ones)
  const sections: { key: string; title: string; notes: NoteMeta[]; defaultOpen: boolean }[] = [];
  if (open.length > 0) sections.push({ key: "open", title: "Open", notes: open, defaultOpen: true });
  if (recent.length > 0) sections.push({ key: "recent", title: "Recent", notes: recent, defaultOpen: true });
  if (inactive.length > 0) sections.push({ key: "inactive", title: "Inactive", notes: inactive, defaultOpen: false });

  return (
    <div className="flex flex-col gap-1">
      {/* Search input */}
      <div className="relative mb-1">
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
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search notes..."
          className="w-full rounded-lg border border-neutral-700/50 bg-neutral-800/50 py-1.5 pl-8 pr-3 text-sm text-neutral-100 placeholder-neutral-500 outline-none transition-colors duration-150 focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50"
        />
      </div>

      {searchResults !== null && searchResults.length === 0 && (
        <p className="text-xs text-neutral-500">No matching notes found.</p>
      )}

      {searchResults !== null ? (
        /* Flat search results */
        <div className="flex flex-col gap-1.5">
          {searchResults.map((note) => (
            <NoteRow
              key={note.id}
              note={note}
              tickets={tickets}
              columns={columns}
              onOpen={(n) => void handleOpen(n)}
              onFocus={(n) => void handleFocus(n)}
              onDelete={(n) => void handleDelete(n)}
              onToggleStar={(n) => void handleToggleStar(n)}
              onRename={(id, title) => void handleRename(id, title)}
              onLinkTicket={(nId, tId) => void handleLinkTicket(nId, tId)}
              onUnlinkTicket={(nId, tId) => void handleUnlinkTicket(nId, tId)}
            />
          ))}
        </div>
      ) : (
      <>
      {/* Starred section — full-width pinned banner */}
      {starred.length > 0 && (
        <div>
          <SectionHeader
            title="Starred"
            count={starred.length}
            isOpen={openSections.starred ?? true}
            onToggle={() => toggleSection("starred")}
          />
          {openSections.starred && (
            <div className="flex gap-1.5 overflow-x-auto [&::-webkit-scrollbar]:hidden pb-1 mb-2">
              {starred.map((note) => (
                <div key={note.id} className="w-56 shrink-0">
                  {renderNotes([note])}
                </div>
              ))}
            </div>
          )}
          <div className="border-b border-neutral-700/30 mb-1" />
        </div>
      )}

      {/* Open / Recent / Inactive — side-by-side columns */}
      {sections.length > 0 && (
        <div className="flex gap-3 overflow-x-auto pb-2">
          {sections.map((sec) => (
            <div key={sec.key} className="w-56 shrink-0 flex flex-col rounded-lg border border-neutral-700/30 bg-neutral-800/30 p-3">
              <SectionHeader
                title={sec.title}
                count={sec.notes.length}
                isOpen={openSections[sec.key] ?? sec.defaultOpen}
                onToggle={() => toggleSection(sec.key)}
              />
              {(openSections[sec.key] ?? sec.defaultOpen) && (
                <div className="flex flex-col gap-1.5">
                  {renderNotes(sec.notes)}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      </>
      )}
    </div>
  );
}
