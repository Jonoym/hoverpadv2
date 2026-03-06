import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cn } from "@/lib/utils";
import { deleteNote, setNoteOpen, linkNoteToTicket, unlinkNote, type NoteMeta } from "@/lib/noteService";
import { createNoteWindow } from "@/lib/windowManager";
import { useGlobalStore } from "@/stores/globalStore";
import { useShallow } from "zustand/react/shallow";

// ---------------------------------------------------------------------------
// Time-ago helper
// ---------------------------------------------------------------------------

function timeAgo(dateString: string): string {
  const now = Date.now();
  const then = new Date(dateString).getTime();
  const diffMs = now - then;

  if (diffMs < 0) return "Just now";

  const seconds = Math.floor(diffMs / 1000);
  const minutes = Math.floor(seconds / 60);
  const hours = Math.floor(minutes / 60);
  const days = Math.floor(hours / 24);

  // suppress unused-variable lint (seconds is used to derive minutes)
  void seconds;

  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  if (days < 7) return `${days} day${days === 1 ? "" : "s"} ago`;

  // Older than a week: show a short date
  const d = new Date(dateString);
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: d.getFullYear() !== new Date().getFullYear() ? "numeric" : undefined,
  });
}

// ---------------------------------------------------------------------------
// NoteList component
// ---------------------------------------------------------------------------

interface NoteListProps {
  /** The list of notes to display (from the global store). */
  notes: NoteMeta[];
  /** Whether notes are currently being loaded. */
  loading: boolean;
}

export function NoteList({ notes, loading }: NoteListProps) {
  const { tickets, refreshNotes, refreshTickets } = useGlobalStore(
    useShallow((s) => ({
      tickets: s.tickets,
      refreshNotes: s.refreshNotes,
      refreshTickets: s.refreshTickets,
    })),
  );

  const handleOpen = async (note: NoteMeta) => {
    try {
      await setNoteOpen(note.id, true);
      await createNoteWindow(note.id);
      // Refresh the global store so isOpen updates everywhere
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to open note:", err);
    }
  };

  const handleFocus = async (note: NoteMeta) => {
    try {
      const win = await WebviewWindow.getByLabel(`note-${note.id}`);
      if (win) {
        await win.setFocus();
      } else {
        // Window doesn't exist anymore — re-open it
        await handleOpen(note);
      }
    } catch (err) {
      console.error("[hoverpad] Failed to focus note:", err);
    }
  };

  const handleDelete = async (note: NoteMeta) => {
    try {
      await deleteNote(note.id);
      // Refresh the global store so the deletion propagates everywhere
      await refreshNotes();
    } catch (err) {
      console.error("[hoverpad] Failed to delete note:", err);
    }
  };

  const handleLink = async (noteId: string, ticketId: string) => {
    try {
      await linkNoteToTicket(noteId, ticketId);
      await refreshNotes();
      await refreshTickets();
    } catch (err) {
      console.error("[hoverpad] Failed to link note to ticket:", err);
    }
  };

  const handleUnlink = async (noteId: string) => {
    try {
      await unlinkNote(noteId);
      await refreshNotes();
      await refreshTickets();
    } catch (err) {
      console.error("[hoverpad] Failed to unlink note:", err);
    }
  };

  if (loading) {
    return (
      <p className="text-xs text-neutral-500">Loading notes...</p>
    );
  }

  if (notes.length === 0) {
    return (
      <p className="text-xs text-neutral-500">
        No notes yet. Press Ctrl+N to create one.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      {notes.map((note) => (
        <div
          key={note.id}
          className={cn(
            "flex items-center gap-2 rounded-lg px-3 py-2",
            "border border-neutral-700/50 bg-neutral-800/50",
            "transition-colors duration-150 hover:bg-neutral-700/50",
          )}
        >
          {/* Title + timestamp + ticket badge */}
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-neutral-100">
              {note.title}
            </p>
            <div className="flex items-center gap-2">
              <p className="text-xs text-neutral-500">
                {timeAgo(note.updatedAt)}
              </p>
              {note.ticketId && (() => {
                const linkedTicket = tickets.find((t) => t.id === note.ticketId);
                return linkedTicket ? (
                  <span className="text-xs bg-purple-600/20 text-purple-400 rounded-md px-1.5 py-0.5">
                    {linkedTicket.title}
                  </span>
                ) : null;
              })()}
            </div>
          </div>

          {/* Ticket link/unlink controls */}
          <div className="flex shrink-0 items-center gap-1">
            {note.ticketId ? (
              <button
                type="button"
                onClick={() => void handleUnlink(note.id)}
                className="text-xs text-purple-400/70 transition-colors duration-150 hover:text-purple-300"
                title="Unlink from ticket"
              >
                Unlink
              </button>
            ) : (
              <select
                className="cursor-pointer bg-neutral-800 border border-neutral-700/50 text-sm text-neutral-300 rounded px-1 py-0.5 max-w-[120px] transition-colors duration-150 focus:outline-none focus:ring-1 focus:ring-blue-500/50"
                value=""
                onChange={(e) => {
                  if (e.target.value) {
                    void handleLink(note.id, e.target.value);
                  }
                }}
                title="Link to ticket"
              >
                <option value="">Link...</option>
                {tickets.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.title}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Action buttons */}
          <div className="flex shrink-0 items-center gap-2">
            {note.isOpen ? (
              <button
                type="button"
                onClick={() => void handleFocus(note)}
                className="text-xs text-blue-400 transition-colors duration-150 hover:text-blue-300"
              >
                Focus
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void handleOpen(note)}
                className="text-xs text-blue-400 transition-colors duration-150 hover:text-blue-300"
              >
                Open
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDelete(note)}
              className="text-xs text-red-400/50 transition-colors duration-150 hover:text-red-400"
            >
              Delete
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}
