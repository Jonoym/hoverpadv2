import { useState, useEffect, useRef, useCallback } from "react";
import { cn } from "@/lib/utils";
import { setTicketExpanded } from "@/lib/ticketService";
import type { TicketMeta } from "@/lib/ticketService";
import type { NoteMeta } from "@/lib/noteService";
import type { SessionMeta } from "@/lib/sessionService";

interface KanbanCardProps {
  ticket: TicketMeta;
  columns: { id: string; name: string }[];
  linkedNotes: NoteMeta[];
  linkedSessions: SessionMeta[];
  allSessions: SessionMeta[];
  allNotes: NoteMeta[];
  onDelete: (id: string) => void;
  onRename: (ticketId: string, newTitle: string) => void;
  onMoveToColumn: (ticketId: string, columnId: string) => void;
  onCreateLinkedNote: (ticketId: string) => void;
  onOpenNote: (noteId: string) => void;
  onDeleteNote: (noteId: string) => void;
  onUnlinkNote: (noteId: string, ticketId: string) => void;
  onLinkNote: (ticketId: string, noteId: string) => void;
  onUpdateDescription: (ticketId: string, description: string) => void;
  onOpenSession: (sessionId: string) => void;
  onFocusSession: (session: SessionMeta) => void;
  onCopyResumeSession: (session: SessionMeta) => void;
  onDeleteSession: (session: SessionMeta) => void;
  onLinkSession: (ticketId: string, sessionId: string) => void;
  onUnlinkSession: (sessionId: string, ticketId: string) => void;
  onRemoveTag: (ticketId: string, tagId: string) => void;
  onAddChecklistItem: (ticketId: string, label: string) => void;
  onToggleChecklistItem: (itemId: string, checked: boolean) => void;
  onDeleteChecklistItem: (itemId: string) => void;
  onDragStart: (ticketId: string, columnId: string, title: string, cardWidth: number, e: React.PointerEvent) => void;
  isDragging: boolean;
}

function formatDueDate(dateStr: string): string {
  const due = new Date(dateStr);
  const now = new Date();
  const dueDay = new Date(due.getFullYear(), due.getMonth(), due.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffMs = dueDay.getTime() - today.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";

  return due.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

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

function sessionDotColor(status: SessionMeta["status"]): string {
  switch (status) {
    case "active": return "bg-green-400";
    case "idle": return "bg-amber-400";
    case "idle-agents": return "bg-indigo-400";
    case "completed": return "bg-neutral-500";
    case "errored": return "bg-red-400";
    case "inactive": return "bg-neutral-500";
    default: return "bg-neutral-500";
  }
}

function sessionBorderColor(status: SessionMeta["status"]): string {
  switch (status) {
    case "active": return "border-green-500/50";
    case "idle": return "border-amber-500/40";
    case "idle-agents": return "border-indigo-500/50";
    case "completed": return "border-neutral-600/40";
    case "errored": return "border-red-500/50";
    case "inactive": return "border-neutral-600/40";
    default: return "border-neutral-600/40";
  }
}

function shortProjectName(projectDir: string): string {
  const segments = projectDir.replace(/\\/g, "/").split("/").filter(Boolean);
  if (segments.length >= 2) return segments.slice(-2).join("/");
  return segments[segments.length - 1] ?? projectDir;
}

const TAG_COLORS: Record<string, { bg: string; text: string; border: string }> = {
  neutral: { bg: "bg-neutral-700/50", text: "text-neutral-300", border: "border-neutral-600/40" },
  blue: { bg: "bg-blue-900/40", text: "text-blue-300", border: "border-blue-700/40" },
  green: { bg: "bg-green-900/40", text: "text-green-300", border: "border-green-700/40" },
  amber: { bg: "bg-amber-900/40", text: "text-amber-300", border: "border-amber-700/40" },
  red: { bg: "bg-red-900/40", text: "text-red-300", border: "border-red-700/40" },
  purple: { bg: "bg-purple-900/40", text: "text-purple-300", border: "border-purple-700/40" },
  pink: { bg: "bg-pink-900/40", text: "text-pink-300", border: "border-pink-700/40" },
};

function tagStyle(color: string) {
  return TAG_COLORS[color] ?? TAG_COLORS.neutral!;
}

function ChevronIcon({ expanded, className }: { expanded: boolean; className?: string }) {
  return (
    <svg
      width="10"
      height="10"
      viewBox="0 0 10 10"
      fill="none"
      className={cn("transition-transform duration-150", expanded && "rotate-90", className)}
    >
      <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

type ContextMenuState =
  | { x: number; y: number; type: "card" }
  | { x: number; y: number; type: "note"; noteId: string }
  | { x: number; y: number; type: "session"; session: SessionMeta };

export function KanbanCard({
  ticket,
  columns,
  linkedNotes,
  linkedSessions,
  allSessions,
  allNotes,
  onDelete,
  onRename,
  onMoveToColumn,
  onCreateLinkedNote,
  onOpenNote,
  onDeleteNote,
  onUnlinkNote,
  onLinkNote,
  onUpdateDescription,
  onOpenSession,
  onFocusSession,
  onCopyResumeSession,
  onDeleteSession,
  onLinkSession,
  onUnlinkSession,
  onRemoveTag,
  onAddChecklistItem,
  onToggleChecklistItem,
  onDeleteChecklistItem,
  onDragStart,
  isDragging,
}: KanbanCardProps) {
  const [expanded, setExpandedRaw] = useState(ticket.expanded);
  const setExpanded = useCallback((v: boolean | ((prev: boolean) => boolean)) => {
    setExpandedRaw((prev) => {
      const next = typeof v === "function" ? v(prev) : v;
      void setTicketExpanded(ticket.id, next);
      return next;
    });
  }, [ticket.id]);
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState(ticket.title);
  const [isEditingDesc, setIsEditingDesc] = useState(false);
  const [descValue, setDescValue] = useState(ticket.description ?? "");
  const [showSessionPicker, setShowSessionPicker] = useState(false);
  const [sessionSearch, setSessionSearch] = useState("");
  const [showNotePicker, setShowNotePicker] = useState(false);
  const [noteSearch, setNoteSearch] = useState("");
  const [newCheckLabel, setNewCheckLabel] = useState("");
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

  const detailCount = linkedNotes.length + linkedSessions.length;

  const handleDescSubmit = () => {
    const trimmed = descValue.trim();
    if (trimmed !== (ticket.description ?? "")) {
      onUpdateDescription(ticket.id, trimmed);
    }
    setIsEditingDesc(false);
  };

  const handleDescKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleDescSubmit();
    } else if (e.key === "Escape") {
      setDescValue(ticket.description ?? "");
      setIsEditingDesc(false);
    }
  };

  return (
    <div
      data-kanban-card
      className={cn(
        "group relative rounded-lg border px-3 py-2",
        "border-neutral-700/50 bg-neutral-800/50 shadow-sm",
        "transition-colors duration-150 hover:bg-neutral-700/50",
        isDragging && "opacity-30",
      )}
      onContextMenu={(e) => {
        // Only show card menu if not right-clicking a sub-card
        if ((e.target as HTMLElement).closest("[data-sub-card]")) return;
        e.preventDefault();
        e.stopPropagation();
        setContextMenu({ x: e.clientX, y: e.clientY, type: "card" });
      }}
    >
      {/* Drag handle + Title row */}
      {isRenaming ? (
        <input
          type="text"
          autoFocus
          value={renameValue}
          onChange={(e) => setRenameValue(e.target.value)}
          onBlur={() => {
            const trimmed = renameValue.trim();
            if (trimmed && trimmed !== ticket.title) onRename(ticket.id, trimmed);
            setIsRenaming(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const trimmed = renameValue.trim();
              if (trimmed && trimmed !== ticket.title) onRename(ticket.id, trimmed);
              setIsRenaming(false);
            }
            if (e.key === "Escape") setIsRenaming(false);
          }}
          className="w-full text-sm font-medium text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 outline-none focus:border-blue-500"
        />
      ) : (
        <div
          className="cursor-grab active:cursor-grabbing touch-none"
          onPointerDown={(e) => {
            if (e.button !== 0) return;
            const cardEl = e.currentTarget.closest("[data-kanban-card]") as HTMLElement | null;
            const width = cardEl?.offsetWidth ?? 0;
            onDragStart(ticket.id, ticket.columnId, ticket.title, width, e);
          }}
        >
          <p className="truncate text-sm text-neutral-100" title={ticket.title}>{ticket.title}</p>
        </div>
      )}

      {/* Description */}
      {isEditingDesc ? (
        <textarea
          value={descValue}
          onChange={(e) => setDescValue(e.target.value)}
          onBlur={handleDescSubmit}
          onKeyDown={handleDescKeyDown}
          autoFocus
          rows={2}
          className="mt-1 w-full resize-none rounded bg-neutral-700/50 px-1.5 py-1 text-xs text-neutral-300 outline-none ring-1 ring-blue-500/50"
          placeholder="Add description..."
        />
      ) : (
        <p
          className={cn(
            "mt-1 text-xs cursor-text line-clamp-2",
            ticket.description
              ? "text-neutral-400"
              : "text-neutral-600 opacity-0 group-hover:opacity-100 transition-opacity duration-150",
          )}
          onClick={() => {
            setDescValue(ticket.description ?? "");
            setIsEditingDesc(true);
          }}
          title={ticket.description ?? "Click to add description"}
        >
          {ticket.description || "Add description..."}
        </p>
      )}

      {/* Checklist */}
      <div className="mt-1.5 flex flex-col gap-0.5">
        {ticket.checklist.map((item) => (
          <label
            key={item.id}
            className="group/check flex items-center gap-1.5 text-xs cursor-pointer"
            onClick={(e) => e.stopPropagation()}
          >
            <span className={cn(
              "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border transition-colors duration-150 cursor-pointer",
              item.checked
                ? "border-blue-500/60 bg-blue-500/20"
                : "border-neutral-600 bg-neutral-800/50 hover:border-neutral-500",
            )}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onToggleChecklistItem(item.id, !item.checked);
              }}
            >
              {item.checked && (
                <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
                  <path d="M2 5.5L4 7.5L8 3" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-blue-400" />
                </svg>
              )}
            </span>
            <span className={cn(
              "flex-1 leading-tight",
              item.checked ? "text-neutral-500 line-through" : "text-neutral-300",
            )}>
              {item.label}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                onDeleteChecklistItem(item.id);
              }}
              className="shrink-0 cursor-pointer text-neutral-700 opacity-0 transition-opacity duration-150 hover:text-red-400 group-hover/check:opacity-100"
              title="Remove item"
            >
              ×
            </button>
          </label>
        ))}
        <input
          type="text"
          value={newCheckLabel}
          onChange={(e) => setNewCheckLabel(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const trimmed = newCheckLabel.trim();
              if (trimmed) {
                onAddChecklistItem(ticket.id, trimmed);
                setNewCheckLabel("");
              }
            }
            if (e.key === "Escape") {
              setNewCheckLabel("");
              (e.target as HTMLInputElement).blur();
            }
          }}
          placeholder="Add item..."
          className="w-full bg-transparent px-0 py-0.5 text-xs text-neutral-300 outline-none placeholder:text-neutral-700"
        />
      </div>

      {/* Due date badge */}
      {ticket.dueDate && (
        <p className={cn("mt-1 text-xs", dueDateColor(ticket.dueDate))}>
          {formatDueDate(ticket.dueDate)}
        </p>
      )}

      {/* Tags — always visible as pills */}
      {ticket.tags.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {ticket.tags.map((tag) => {
            const s = tagStyle(tag.color);
            return (
              <span
                key={tag.id}
                className={cn("inline-flex items-center gap-1 rounded-full border px-1.5 py-0.5 text-[10px]", s.bg, s.text, s.border)}
              >
                {tag.name}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveTag(ticket.id, tag.id);
                  }}
                  className="ml-0.5 cursor-pointer opacity-0 transition-opacity duration-150 hover:text-red-400 group-hover:opacity-100"
                  title="Remove tag"
                >
                  ×
                </button>
              </span>
            );
          })}
        </div>
      )}

      {/* Expand/collapse toggle */}
      {detailCount > 0 && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            setExpanded((p) => !p);
          }}
          className="mt-1.5 flex w-full cursor-pointer items-center gap-1 text-left text-[10px] text-neutral-500 transition-colors duration-150 hover:text-neutral-400"
        >
          <ChevronIcon expanded={expanded} className="text-neutral-500" />
          <span>
            {linkedNotes.length > 0 && `${linkedNotes.length} note${linkedNotes.length !== 1 ? "s" : ""}`}
            {linkedNotes.length > 0 && linkedSessions.length > 0 && " · "}
            {linkedSessions.length > 0 && `${linkedSessions.length} session${linkedSessions.length !== 1 ? "s" : ""}`}
          </span>
        </button>
      )}

      {/* Expandable detail sections */}
      {expanded && (
        <div className="mt-1 flex flex-col gap-2">
          {/* Linked notes */}
          {linkedNotes.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Notes</span>
              {linkedNotes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  data-sub-card
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpenNote(note.id);
                  }}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, type: "note", noteId: note.id });
                  }}
                  className="flex cursor-pointer items-center gap-1.5 rounded-md border border-neutral-700/40 bg-neutral-750/40 px-2 py-1.5 text-left transition-colors duration-150 hover:border-neutral-600/50 hover:bg-neutral-700/40"
                  title={note.title}
                >
                  <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 text-neutral-500">
                    <path d="M4 1h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" />
                    <path d="M5 5h6M5 8h6M5 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                  </svg>
                  <span className="truncate text-xs text-neutral-200">{note.title}</span>
                </button>
              ))}
            </div>
          )}

          {/* Linked sessions */}
          {linkedSessions.length > 0 && (
            <div className="flex flex-col gap-1">
              <span className="text-[10px] font-medium uppercase tracking-wider text-neutral-500">Sessions</span>
              {linkedSessions.map((session) => (
                <div
                  key={session.id}
                  data-sub-card
                  className={cn(
                    "group/session relative flex items-center gap-1.5 rounded-md border bg-neutral-750/40 px-2 py-1.5",
                    "transition-colors duration-150 hover:bg-neutral-700/40",
                    sessionBorderColor(session.status),
                  )}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setContextMenu({ x: e.clientX, y: e.clientY, type: "session", session });
                  }}
                >
                  <span className={cn("inline-block h-2 w-2 shrink-0 rounded-full", sessionDotColor(session.status))} />
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpenSession(session.id);
                    }}
                    className="flex min-w-0 flex-1 cursor-pointer flex-col gap-0.5 text-left"
                    title={session.projectDir}
                  >
                    <span className="truncate text-xs text-neutral-200">
                      {session.label || session.sessionId.slice(0, 8)}
                    </span>
                    <span className="flex items-center gap-1 text-[10px] text-neutral-500">
                      <svg width="8" height="8" viewBox="0 0 16 16" fill="none" className="shrink-0">
                        <path d="M2 4V13a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V6a1 1 0 0 0-1-1H8L6.5 3H3a1 1 0 0 0-1 1z" stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round" />
                      </svg>
                      <span className="truncate">{shortProjectName(session.projectDir)}</span>
                    </span>
                  </button>
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 transition-all duration-150 group-hover/session:opacity-100">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onCopyResumeSession(session);
                      }}
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-neutral-600 transition-colors duration-150 hover:text-blue-400"
                      title="Copy resume command"
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" className="shrink-0">
                        <rect x="5" y="5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.3" />
                        <path d="M11 5V3.5A1.5 1.5 0 0 0 9.5 2h-6A1.5 1.5 0 0 0 2 3.5v6A1.5 1.5 0 0 0 3.5 11H5" stroke="currentColor" strokeWidth="1.3" />
                      </svg>
                    </button>
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        onFocusSession(session);
                      }}
                      className="flex h-5 w-5 cursor-pointer items-center justify-center rounded text-neutral-600 transition-colors duration-150 hover:text-blue-400"
                      title="Open in VS Code"
                    >
                      <svg width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                        <path d="M6 2H3a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3" />
                        <path d="M10 2h4v4" />
                        <path d="M14 2L7 9" />
                      </svg>
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Session picker (opened from card context menu) */}
          {showSessionPicker && (() => {
            const unlinked = allSessions.filter(
              (s) => !s.ticketIds.includes(ticket.id) && (
                !sessionSearch ||
                (s.label ?? "").toLowerCase().includes(sessionSearch.toLowerCase()) ||
                s.sessionId.toLowerCase().includes(sessionSearch.toLowerCase())
              ),
            );
            return (
              <div className="rounded border border-neutral-700 bg-neutral-800 p-1 shadow-lg">
                <input
                  type="text"
                  autoFocus
                  value={sessionSearch}
                  onChange={(e) => setSessionSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowSessionPicker(false);
                  }}
                  placeholder="Search sessions..."
                  className="mb-1 w-full rounded bg-neutral-700/50 px-1.5 py-1 text-xs text-neutral-300 outline-none placeholder:text-neutral-600"
                />
                <div className="max-h-32 overflow-y-auto">
                  {unlinked.length === 0 ? (
                    <p className="px-1.5 py-1 text-[10px] text-neutral-600">No sessions available</p>
                  ) : (
                    unlinked.slice(0, 10).map((s) => (
                      <button
                        key={s.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLinkSession(ticket.id, s.id);
                          setShowSessionPicker(false);
                        }}
                        className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700/50"
                      >
                        <span className={cn("inline-block h-1.5 w-1.5 shrink-0 rounded-full", sessionDotColor(s.status))} />
                        <span className="truncate">{s.label || s.sessionId.slice(0, 8)}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })()}

          {/* Note picker (opened from card context menu) */}
          {showNotePicker && (() => {
            const unlinked = allNotes.filter(
              (n) => !n.ticketIds.includes(ticket.id) && (
                !noteSearch ||
                n.title.toLowerCase().includes(noteSearch.toLowerCase())
              ),
            );
            return (
              <div className="rounded border border-neutral-700 bg-neutral-800 p-1 shadow-lg">
                <input
                  type="text"
                  autoFocus
                  value={noteSearch}
                  onChange={(e) => setNoteSearch(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setShowNotePicker(false);
                  }}
                  placeholder="Search notes..."
                  className="mb-1 w-full rounded bg-neutral-700/50 px-1.5 py-1 text-xs text-neutral-300 outline-none placeholder:text-neutral-600"
                />
                <div className="max-h-32 overflow-y-auto">
                  {unlinked.length === 0 ? (
                    <p className="px-1.5 py-1 text-[10px] text-neutral-600">No notes available</p>
                  ) : (
                    unlinked.slice(0, 10).map((n) => (
                      <button
                        key={n.id}
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          onLinkNote(ticket.id, n.id);
                          setShowNotePicker(false);
                        }}
                        className="flex w-full cursor-pointer items-center gap-1.5 rounded px-1.5 py-1 text-xs text-neutral-300 hover:bg-neutral-700/50"
                      >
                        <svg width="10" height="10" viewBox="0 0 16 16" fill="none" className="shrink-0 text-neutral-500">
                          <path d="M4 1h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V3a2 2 0 0 1 2-2z" stroke="currentColor" strokeWidth="1.5" />
                          <path d="M5 5h6M5 8h6M5 11h3" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
                        </svg>
                        <span className="truncate">{n.title}</span>
                      </button>
                    ))
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <div
          ref={contextMenuRef}
          className="fixed z-50 min-w-[140px] rounded-md border border-neutral-700 bg-neutral-800 py-1 shadow-lg"
          style={{ left: contextMenu.x, top: contextMenu.y }}
        >
          {contextMenu.type === "card" && (
            <>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  setRenameValue(ticket.title);
                  setIsRenaming(true);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
              >
                Rename
              </button>
              <div className="my-1 border-t border-neutral-700/50" />
              <button
                type="button"
                onClick={() => {
                  onCreateLinkedNote(ticket.id);
                  setContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
              >
                New note
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  setExpanded(true);
                  setShowSessionPicker(true);
                  setSessionSearch("");
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
              >
                Link session
              </button>
              <button
                type="button"
                onClick={() => {
                  setContextMenu(null);
                  setExpanded(true);
                  setShowNotePicker(true);
                  setNoteSearch("");
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
              >
                Link note
              </button>
              <div className="my-1 border-t border-neutral-700/50" />
              {columns
                .filter((col) => col.id !== ticket.columnId)
                .map((col) => (
                  <button
                    key={col.id}
                    type="button"
                    onClick={() => {
                      onMoveToColumn(ticket.id, col.id);
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
                  onDelete(ticket.id);
                  setContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/50"
              >
                Delete ticket
              </button>
            </>
          )}
          {contextMenu.type === "note" && (
            <>
              <button
                type="button"
                onClick={() => {
                  onUnlinkNote(contextMenu.noteId, ticket.id);
                  setContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
              >
                Unlink note
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteNote(contextMenu.noteId);
                  setContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/50"
              >
                Delete note
              </button>
            </>
          )}
          {contextMenu.type === "session" && (
            <>
              <button
                type="button"
                onClick={() => {
                  onUnlinkSession(contextMenu.session.id, ticket.id);
                  setContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
              >
                Unlink session
              </button>
              <button
                type="button"
                onClick={() => {
                  onDeleteSession(contextMenu.session);
                  setContextMenu(null);
                }}
                className="flex w-full cursor-pointer items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/50"
              >
                Delete session
              </button>
            </>
          )}
        </div>
      )}

    </div>
  );
}
