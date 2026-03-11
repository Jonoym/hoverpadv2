import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  getJournalForDate,
  getMonthActivity,
  generateJournalMarkdown,
  type JournalDay,
  type JournalSession,
  type JournalNote,
  type DateActivity,
} from "@/lib/journalService";
import { createNote, renameNote, setNoteOpen } from "@/lib/noteService";
import { createNoteWindow, createSessionWindow } from "@/lib/windowManager";
import { useGlobalStore } from "@/stores/globalStore";
import { timeAgo } from "@/lib/timeAgo";

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function todayString(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
}

function formatDateLong(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function shiftDate(dateStr: string, days: number): string {
  const d = new Date(dateStr + "T12:00:00");
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function toDateString(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function getWeekStart(dateStr: string): string {
  const d = new Date(dateStr + "T12:00:00");
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  d.setDate(d.getDate() + diff);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function getWeekDates(weekStart: string): string[] {
  const dates: string[] = [];
  for (let i = 0; i < 7; i++) dates.push(shiftDate(weekStart, i));
  return dates;
}

// ---------------------------------------------------------------------------
// Status color maps
// ---------------------------------------------------------------------------

const STATUS_COLORS: Record<string, string> = {
  active: "bg-emerald-400",
  idle: "bg-amber-400",
  "idle-agents": "bg-indigo-400",
  completed: "bg-purple-400",
  errored: "bg-red-400",
  inactive: "bg-neutral-500",
};

const STATUS_TEXT_COLORS: Record<string, string> = {
  active: "text-emerald-400",
  idle: "text-amber-400",
  "idle-agents": "text-indigo-400",
  completed: "text-purple-400",
  errored: "text-red-400",
  inactive: "text-neutral-500",
};

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type ViewMode = "day" | "week" | "month";

export function JournalView() {
  const [selectedDate, setSelectedDate] = useState(todayString);
  const [journal, setJournal] = useState<JournalDay | null>(null);
  const [loading, setLoading] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>("day");
  const refreshNotes = useGlobalStore((s) => s.refreshNotes);

  const isToday = selectedDate === todayString();

  const loadJournal = useCallback(async (date: string) => {
    setLoading(true);
    try {
      const data = await getJournalForDate(date);
      setJournal(data);
    } catch (err) {
      console.error("[journal] Failed to load:", err);
    }
    setLoading(false);
  }, []);

  useEffect(() => {
    void loadJournal(selectedDate);
  }, [selectedDate, loadJournal]);

  useEffect(() => {
    if (!isToday) return;
    const timer = setInterval(() => void loadJournal(selectedDate), 10_000);
    return () => clearInterval(timer);
  }, [isToday, selectedDate, loadJournal]);

  const handleSaveAsNote = useCallback(async () => {
    if (!journal) return;
    const markdown = generateJournalMarkdown(journal);
    const dateFormatted = formatDate(journal.date);
    const note = await createNote();
    const journalTitle = `Journal — ${dateFormatted}`;
    await renameNote(note.id, journalTitle);
    const { writeTextFile } = await import("@tauri-apps/plugin-fs");
    const { homeDir, join } = await import("@tauri-apps/api/path");
    const home = await homeDir();
    const { readTextFile } = await import("@tauri-apps/plugin-fs");
    const fullPath = await join(home, note.filePath);
    const existing = await readTextFile(fullPath);
    const fmEnd = existing.indexOf("---", existing.indexOf("---") + 3);
    const frontmatter = existing.slice(0, fmEnd + 3);
    await writeTextFile(fullPath, frontmatter + "\n\n" + markdown);
    await setNoteOpen(note.id, true);
    await createNoteWindow(note.id);
    await refreshNotes();
  }, [journal, refreshNotes]);

  const handleOpenNote = useCallback(async (noteId: string) => {
    await setNoteOpen(noteId, true);
    await createNoteWindow(noteId);
    await refreshNotes();
  }, [refreshNotes]);

  const handleOpenSession = useCallback(async (sessionId: string) => {
    await createSessionWindow(sessionId);
  }, []);

  const handleDrillToDay = useCallback((date: string) => {
    setSelectedDate(date);
    setViewMode("day");
  }, []);

  return (
    <div className="flex flex-col gap-0.5">
      {/* Sub-tabs */}
      <div className="flex h-8 items-center gap-1 px-2">
        {(["day", "week", "month"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            onClick={() => setViewMode(mode)}
            className={cn(
              "cursor-pointer rounded-md px-3 py-1 text-xs font-medium transition-colors duration-150",
              viewMode === mode
                ? "bg-neutral-700/60 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300",
            )}
          >
            {mode.charAt(0).toUpperCase() + mode.slice(1)}
          </button>
        ))}
      </div>

      {viewMode === "day" && (
        <DayView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          journal={journal}
          loading={loading}
          isToday={isToday}
          onSaveAsNote={handleSaveAsNote}
          onOpenSession={handleOpenSession}
          onOpenNote={handleOpenNote}
        />
      )}

      {viewMode === "week" && (
        <WeekView
          selectedDate={selectedDate}
          setSelectedDate={setSelectedDate}
          onDrillToDay={handleDrillToDay}
          onOpenSession={handleOpenSession}
          onOpenNote={handleOpenNote}
        />
      )}

      {viewMode === "month" && (
        <MonthView
          selectedDate={selectedDate}
          onSelectDate={handleDrillToDay}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared: collapsible section header
// ---------------------------------------------------------------------------

function SectionHeader({
  label,
  count,
  collapsed,
  onToggle,
}: {
  label: string;
  count: number;
  collapsed: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      className="flex w-full items-center gap-1.5 mb-1 cursor-pointer group"
    >
      <svg
        width="10"
        height="10"
        viewBox="0 0 10 10"
        fill="none"
        className={cn(
          "shrink-0 text-neutral-600 transition-transform duration-150",
          !collapsed && "rotate-90",
        )}
      >
        <path d="M3 1.5L7 5L3 8.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span className="text-xs font-medium text-neutral-500 uppercase tracking-wider group-hover:text-neutral-400 transition-colors">
        {label} ({count})
      </span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Shared: activity list (sessions + notes with collapsible sections)
// ---------------------------------------------------------------------------

function ActivityList({
  sessions,
  notes,
  onOpenSession,
  onOpenNote,
}: {
  sessions: JournalSession[];
  notes: JournalNote[];
  onOpenSession: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const [sessionsCollapsed, setSessionsCollapsed] = useState(false);
  const [notesCollapsed, setNotesCollapsed] = useState(false);

  if (sessions.length === 0 && notes.length === 0) return null;

  return (
    <>
      {sessions.length > 0 && (
        <div>
          <SectionHeader
            label="Sessions"
            count={sessions.length}
            collapsed={sessionsCollapsed}
            onToggle={() => setSessionsCollapsed((c) => !c)}
          />
          {!sessionsCollapsed && (
            <div className="space-y-1">
              {sessions.map((session) => (
                <SessionRow key={session.sessionId} session={session} onOpen={onOpenSession} />
              ))}
            </div>
          )}
        </div>
      )}

      {notes.length > 0 && (
        <div>
          <SectionHeader
            label="Notes Active"
            count={notes.length}
            collapsed={notesCollapsed}
            onToggle={() => setNotesCollapsed((c) => !c)}
          />
          {!notesCollapsed && (
            <div className="space-y-1">
              {notes.map((note) => (
                <NoteRow key={note.id} note={note} onOpen={onOpenNote} />
              ))}
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Day view
// ---------------------------------------------------------------------------

function DayView({
  selectedDate,
  setSelectedDate,
  journal,
  loading,
  isToday,
  onSaveAsNote,
  onOpenSession,
  onOpenNote,
}: {
  selectedDate: string;
  setSelectedDate: (fn: string | ((d: string) => string)) => void;
  journal: JournalDay | null;
  loading: boolean;
  isToday: boolean;
  onSaveAsNote: () => void;
  onOpenSession: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const completed = journal?.sessions.filter((s) => s.status === "completed").length ?? 0;
  const errored = journal?.sessions.filter((s) => s.status === "errored").length ?? 0;
  const active = journal?.sessions.filter((s) => s.status === "active" || s.status === "idle" || s.status === "idle-agents").length ?? 0;
  const newNotes = journal?.notes.filter((n) => !n.isMultiDay).length ?? 0;
  const continuedNotes = journal?.notes.filter((n) => n.isMultiDay).length ?? 0;

  return (
    <div className="flex flex-col gap-3 p-1">
      {/* Date navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => setSelectedDate((d: string) => shiftDate(d, -1))}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors cursor-pointer"
        >
          <ChevronLeft />
        </button>

        <span className="text-sm font-medium text-neutral-200">
          {formatDateLong(selectedDate)}
        </span>

        <div className="flex items-center gap-1">
          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayString())}
              className="rounded-md px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors cursor-pointer"
            >
              Today
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedDate((d: string) => shiftDate(d, 1))}
            disabled={isToday}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
              isToday
                ? "text-neutral-600 cursor-not-allowed"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
            )}
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Summary bar */}
      {journal && (journal.sessions.length > 0 || journal.notes.length > 0) && (
        <div className="flex items-center justify-between rounded-lg border border-neutral-700/30 bg-neutral-800/30 px-3 py-2">
          <div className="flex items-center gap-3 text-xs text-neutral-400">
            {journal.sessions.length > 0 && (
              <span>
                <span className="text-neutral-200 font-medium">{journal.sessions.length}</span> session{journal.sessions.length !== 1 ? "s" : ""}
                {completed > 0 && <span className="text-purple-400"> · {completed} done</span>}
                {errored > 0 && <span className="text-red-400"> · {errored} err</span>}
                {active > 0 && <span className="text-emerald-400"> · {active} active</span>}
              </span>
            )}
            {journal.notes.length > 0 && (
              <span>
                <span className="text-neutral-200 font-medium">{journal.notes.length}</span> note{journal.notes.length !== 1 ? "s" : ""}
                {newNotes > 0 && <span className="text-blue-400"> · {newNotes} new</span>}
                {continuedNotes > 0 && <span className="text-amber-400"> · {continuedNotes} continued</span>}
              </span>
            )}
          </div>
          <button
            type="button"
            onClick={onSaveAsNote}
            className="text-xs text-neutral-500 hover:text-neutral-300 transition-colors cursor-pointer"
            title="Save this day's journal as a markdown note"
          >
            Save as note
          </button>
        </div>
      )}

      {loading && (
        <div className="flex items-center justify-center py-8 text-neutral-500 text-sm">
          Loading...
        </div>
      )}

      {!loading && journal && journal.sessions.length === 0 && journal.notes.length === 0 && (
        <div className="flex flex-col items-center justify-center py-12 text-neutral-500 text-sm gap-1">
          <span>No activity on this day</span>
          {!isToday && (
            <button
              type="button"
              onClick={() => setSelectedDate(todayString())}
              className="text-blue-400 hover:text-blue-300 cursor-pointer"
            >
              Go to today
            </button>
          )}
        </div>
      )}

      {journal && (
        <ActivityList
          sessions={journal.sessions}
          notes={journal.notes}
          onOpenSession={onOpenSession}
          onOpenNote={onOpenNote}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Week view
// ---------------------------------------------------------------------------

const WEEKDAY_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function WeekView({
  selectedDate,
  setSelectedDate,
  onDrillToDay,
  onOpenSession,
  onOpenNote,
}: {
  selectedDate: string;
  setSelectedDate: (d: string) => void;
  onDrillToDay: (date: string) => void;
  onOpenSession: (id: string) => void;
  onOpenNote: (id: string) => void;
}) {
  const weekStart = getWeekStart(selectedDate);
  const weekDates = useMemo(() => getWeekDates(weekStart), [weekStart]);
  const weekEnd = weekDates[6]!;
  const today = todayString();

  const [weekJournals, setWeekJournals] = useState<Map<string, JournalDay>>(new Map());
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all(weekDates.map((d) => getJournalForDate(d))).then((results) => {
      if (cancelled) return;
      const map = new Map<string, JournalDay>();
      for (const j of results) map.set(j.date, j);
      setWeekJournals(map);
      setLoading(false);
    }).catch((err) => {
      console.error("[journal] Failed to load week:", err);
      if (!cancelled) setLoading(false);
    });
    return () => { cancelled = true; };
  }, [weekStart]); // eslint-disable-line react-hooks/exhaustive-deps

  const shiftWeek = useCallback((delta: number) => {
    setSelectedDate(shiftDate(weekStart, delta * 7));
  }, [weekStart, setSelectedDate]);

  const rangeLabel = useMemo(() => {
    const start = new Date(weekStart + "T00:00:00");
    const end = new Date(weekEnd + "T00:00:00");
    const sameMonth = start.getMonth() === end.getMonth();
    if (sameMonth) {
      return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.getDate()}, ${end.getFullYear()}`;
    }
    return `${start.toLocaleDateString(undefined, { month: "short", day: "numeric" })} – ${end.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })}`;
  }, [weekStart, weekEnd]);

  const isCurrentWeek = weekStart === getWeekStart(today);
  const isFutureWeek = weekDates[0]! > today;

  // Aggregate all sessions and notes across the week (deduped notes by id)
  const { allSessions, allNotes, weekTotals } = useMemo(() => {
    const sessions: JournalSession[] = [];
    const noteMap = new Map<string, JournalNote>();
    let completed = 0;
    let errored = 0;
    let active = 0;
    let newNotes = 0;
    let continuedNotes = 0;

    for (const j of weekJournals.values()) {
      sessions.push(...j.sessions);
      completed += j.sessions.filter((s) => s.status === "completed").length;
      errored += j.sessions.filter((s) => s.status === "errored").length;
      active += j.sessions.filter((s) => s.status === "active" || s.status === "idle" || s.status === "idle-agents").length;
      for (const n of j.notes) {
        if (!noteMap.has(n.id)) {
          noteMap.set(n.id, n);
          if (n.isMultiDay) continuedNotes++;
          else newNotes++;
        }
      }
    }

    // Sort sessions newest first
    sessions.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const notes = Array.from(noteMap.values());

    return {
      allSessions: sessions,
      allNotes: notes,
      weekTotals: {
        sessions: sessions.length,
        notes: notes.length,
        completed,
        errored,
        active,
        newNotes,
        continuedNotes,
      },
    };
  }, [weekJournals]);

  return (
    <div className="flex flex-col gap-2 p-1">
      {/* Week navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftWeek(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors cursor-pointer"
        >
          <ChevronLeft />
        </button>

        <span className="text-sm font-medium text-neutral-200">{rangeLabel}</span>

        <div className="flex items-center gap-1">
          {!isCurrentWeek && (
            <button
              type="button"
              onClick={() => setSelectedDate(today)}
              className="rounded-md px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors cursor-pointer"
            >
              This week
            </button>
          )}
          <button
            type="button"
            onClick={() => shiftWeek(1)}
            disabled={isFutureWeek}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
              isFutureWeek
                ? "text-neutral-600 cursor-not-allowed"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
            )}
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAY_SHORT.map((day) => (
          <div key={day} className="py-1 text-center text-[10px] font-medium text-neutral-600 uppercase">
            {day}
          </div>
        ))}
      </div>

      {loading && (
        <div className="flex items-center justify-center py-8 text-neutral-500 text-sm">
          Loading...
        </div>
      )}

      {/* 7-column grid */}
      {!loading && (
        <div className="grid grid-cols-7 gap-px">
          {weekDates.map((dateStr) => {
            const j = weekJournals.get(dateStr);
            const isFuture = dateStr > today;
            const isCurrent = dateStr === today;
            const sessionCount = j?.sessions.length ?? 0;
            const noteCount = j?.notes.length ?? 0;
            const totalCount = sessionCount + noteCount;

            return (
              <button
                key={dateStr}
                type="button"
                disabled={isFuture}
                onClick={() => onDrillToDay(dateStr)}
                className={cn(
                  "relative flex flex-col items-center rounded-lg py-2 px-1 transition-colors cursor-pointer gap-1",
                  isCurrent
                    ? "bg-neutral-800/60 text-neutral-100"
                    : isFuture
                      ? "text-neutral-700 cursor-not-allowed"
                      : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200",
                )}
              >
                <span className={cn("text-sm", isCurrent && "font-semibold text-blue-300")}>
                  {new Date(dateStr + "T00:00:00").getDate()}
                </span>
                {totalCount > 0 && (
                  <div className="flex items-center gap-0.5">
                    {sessionCount > 0 && <span className="h-1 w-1 rounded-full bg-purple-400" />}
                    {noteCount > 0 && <span className="h-1 w-1 rounded-full bg-blue-400" />}
                  </div>
                )}
                {totalCount > 0 && (
                  <span className="text-[10px] text-neutral-500">{totalCount}</span>
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Summary bar */}
      {!loading && weekTotals.sessions + weekTotals.notes > 0 && (
        <div className="flex items-center gap-3 rounded-lg border border-neutral-700/30 bg-neutral-800/30 px-3 py-2 text-xs text-neutral-400">
          {weekTotals.sessions > 0 && (
            <span>
              <span className="text-neutral-200 font-medium">{weekTotals.sessions}</span> session{weekTotals.sessions !== 1 ? "s" : ""}
              {weekTotals.completed > 0 && <span className="text-purple-400"> · {weekTotals.completed} done</span>}
              {weekTotals.errored > 0 && <span className="text-red-400"> · {weekTotals.errored} err</span>}
              {weekTotals.active > 0 && <span className="text-emerald-400"> · {weekTotals.active} active</span>}
            </span>
          )}
          {weekTotals.notes > 0 && (
            <span>
              <span className="text-neutral-200 font-medium">{weekTotals.notes}</span> note{weekTotals.notes !== 1 ? "s" : ""}
              {weekTotals.newNotes > 0 && <span className="text-blue-400"> · {weekTotals.newNotes} new</span>}
              {weekTotals.continuedNotes > 0 && <span className="text-amber-400"> · {weekTotals.continuedNotes} continued</span>}
            </span>
          )}
        </div>
      )}

      {/* Session & note lists */}
      {!loading && (
        <ActivityList
          sessions={allSessions}
          notes={allNotes}
          onOpenSession={onOpenSession}
          onOpenNote={onOpenNote}
        />
      )}

      {!loading && weekTotals.sessions === 0 && weekTotals.notes === 0 && (
        <div className="flex flex-col items-center justify-center py-8 text-neutral-500 text-sm gap-1">
          <span>No activity this week</span>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Month (calendar) view
// ---------------------------------------------------------------------------

const WEEKDAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function MonthView({
  selectedDate,
  onSelectDate,
}: {
  selectedDate: string;
  onSelectDate: (date: string) => void;
}) {
  const parsedDate = new Date(selectedDate + "T00:00:00");
  const [calYear, setCalYear] = useState(parsedDate.getFullYear());
  const [calMonth, setCalMonth] = useState(parsedDate.getMonth() + 1);
  const [activity, setActivity] = useState<Map<string, DateActivity>>(new Map());

  useEffect(() => {
    void getMonthActivity(calYear, calMonth).then((data) => {
      const map = new Map<string, DateActivity>();
      for (const d of data) map.set(d.date, d);
      setActivity(map);
    });
  }, [calYear, calMonth]);

  const today = todayString();

  const shiftMonth = useCallback((delta: number) => {
    setCalMonth((m) => {
      let newMonth = m + delta;
      let newYear = calYear;
      if (newMonth < 1) { newMonth = 12; newYear--; }
      else if (newMonth > 12) { newMonth = 1; newYear++; }
      setCalYear(newYear);
      return newMonth;
    });
  }, [calYear]);

  const { weeks, monthLabel } = useMemo(() => {
    const firstOfMonth = new Date(calYear, calMonth - 1, 1);
    const daysInMonth = new Date(calYear, calMonth, 0).getDate();
    let startDay = firstOfMonth.getDay() - 1;
    if (startDay < 0) startDay = 6;

    const label = firstOfMonth.toLocaleDateString(undefined, { month: "long", year: "numeric" });

    const cells: (number | null)[] = [];
    for (let i = 0; i < startDay; i++) cells.push(null);
    for (let d = 1; d <= daysInMonth; d++) cells.push(d);
    while (cells.length % 7 !== 0) cells.push(null);

    const rows: (number | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) rows.push(cells.slice(i, i + 7));

    return { weeks: rows, monthLabel: label };
  }, [calYear, calMonth]);

  const isCurrentMonth = calYear === new Date().getFullYear() && calMonth === new Date().getMonth() + 1;
  const isFutureMonth = calYear > new Date().getFullYear() ||
    (calYear === new Date().getFullYear() && calMonth > new Date().getMonth() + 1);

  return (
    <div className="flex flex-col gap-2 p-1">
      {/* Month navigation */}
      <div className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => shiftMonth(-1)}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors cursor-pointer"
        >
          <ChevronLeft />
        </button>

        <span className="text-sm font-medium text-neutral-200">{monthLabel}</span>

        <div className="flex items-center gap-1">
          {!isCurrentMonth && (
            <button
              type="button"
              onClick={() => {
                const now = new Date();
                setCalYear(now.getFullYear());
                setCalMonth(now.getMonth() + 1);
              }}
              className="rounded-md px-2 py-1 text-[11px] text-neutral-500 hover:bg-neutral-800/60 hover:text-neutral-200 transition-colors cursor-pointer"
            >
              This month
            </button>
          )}
          <button
            type="button"
            onClick={() => shiftMonth(1)}
            disabled={isFutureMonth}
            className={cn(
              "flex h-7 w-7 items-center justify-center rounded-lg transition-colors cursor-pointer",
              isFutureMonth
                ? "text-neutral-600 cursor-not-allowed"
                : "text-neutral-400 hover:bg-neutral-800/60 hover:text-neutral-200",
            )}
          >
            <ChevronRight />
          </button>
        </div>
      </div>

      {/* Weekday headers */}
      <div className="grid grid-cols-7 gap-px">
        {WEEKDAY_LABELS.map((day) => (
          <div key={day} className="py-1 text-center text-[10px] font-medium text-neutral-600 uppercase">
            {day}
          </div>
        ))}
      </div>

      {/* Calendar grid */}
      <div className="grid grid-cols-7 gap-px">
        {weeks.flat().map((day, idx) => {
          if (day === null) return <div key={`empty-${idx}`} className="h-10" />;

          const dateStr = toDateString(calYear, calMonth, day);
          const act = activity.get(dateStr);
          const isSelected = dateStr === selectedDate;
          const isCurrentDay = dateStr === today;
          const isFuture = dateStr > today;

          return (
            <button
              key={dateStr}
              type="button"
              disabled={isFuture}
              onClick={() => onSelectDate(dateStr)}
              className={cn(
                "relative flex h-10 flex-col items-center justify-center rounded-lg transition-colors cursor-pointer",
                isSelected
                  ? "bg-blue-500/20 text-blue-300"
                  : isCurrentDay
                    ? "bg-neutral-800/60 text-neutral-100"
                    : isFuture
                      ? "text-neutral-700 cursor-not-allowed"
                      : "text-neutral-400 hover:bg-neutral-800/40 hover:text-neutral-200",
              )}
            >
              <span className={cn("text-xs", isCurrentDay && !isSelected && "font-semibold")}>
                {day}
              </span>
              {act && (
                <div className="flex items-center gap-0.5 mt-0.5">
                  {act.sessionCount > 0 && <span className="h-1 w-1 rounded-full bg-purple-400" />}
                  {act.noteCount > 0 && <span className="h-1 w-1 rounded-full bg-blue-400" />}
                </div>
              )}
            </button>
          );
        })}
      </div>

      {/* Legend */}
      <div className="flex items-center justify-center gap-4 text-[10px] text-neutral-600">
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-purple-400" />
          <span>Sessions</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-blue-400" />
          <span>Notes</span>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Shared SVG icons
// ---------------------------------------------------------------------------

function ChevronLeft() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M8 2L4 6L8 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <path d="M4 2L8 6L4 10" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Row components
// ---------------------------------------------------------------------------

function SessionRow({
  session,
  onOpen,
}: {
  session: JournalSession;
  onOpen: (id: string) => void;
}) {
  const label = session.label || session.lastUserMessage?.slice(0, 50) || session.sessionId.slice(0, 8);
  const time = new Date(session.startedAt).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

  return (
    <div
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-neutral-800/40 transition-colors cursor-pointer group"
      onClick={() => onOpen(session.sessionId)}
    >
      <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", STATUS_COLORS[session.status] ?? "bg-neutral-500")} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-neutral-200">{label}</span>
        </div>
        <div className="flex items-center gap-2 mt-0.5 text-xs text-neutral-500">
          <span className={STATUS_TEXT_COLORS[session.status] ?? "text-neutral-500"}>{session.status}</span>
          <span>{time}</span>
          {session.projectName && <span className="truncate text-neutral-600">{session.projectName}</span>}
        </div>
      </div>
    </div>
  );
}

function NoteRow({
  note,
  onOpen,
}: {
  note: JournalNote;
  onOpen: (id: string) => void;
}) {
  return (
    <div
      className="flex items-start gap-2.5 rounded-lg px-2.5 py-2 hover:bg-neutral-800/40 transition-colors cursor-pointer group"
      onClick={() => onOpen(note.id)}
    >
      <span className="mt-1 shrink-0 text-neutral-500">
        {note.starred ? (
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor" className="text-amber-400">
            <path fillRule="evenodd" d="M10.868 2.884c-.321-.772-1.415-.772-1.736 0l-1.83 4.401-4.753.381c-.833.067-1.171 1.107-.536 1.651l3.62 3.102-1.106 4.637c-.194.813.691 1.456 1.405 1.02L10 15.591l4.069 2.485c.713.436 1.598-.207 1.404-1.02l-1.106-4.637 3.62-3.102c.635-.544.297-1.584-.536-1.65l-4.752-.382-1.831-4.401Z" clipRule="evenodd" />
          </svg>
        ) : (
          <svg width="14" height="14" viewBox="0 0 20 20" fill="currentColor">
            <path d="M2.695 14.763l-1.262 3.154a.5.5 0 00.65.65l3.155-1.262a4 4 0 001.343-.885L17.5 5.5a2.121 2.121 0 00-3-3L3.58 13.42a4 4 0 00-.885 1.343z" />
          </svg>
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="truncate text-sm text-neutral-200">{note.title}</span>
          {note.isMultiDay && (
            <span className="shrink-0 rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-400">{note.activeDays}d</span>
          )}
          {!note.isMultiDay && (
            <span className="shrink-0 rounded-md bg-blue-500/10 px-1.5 py-0.5 text-[10px] text-blue-400">new</span>
          )}
        </div>
        {note.preview && (
          <div className="mt-0.5 truncate text-xs text-neutral-500">{note.preview}</div>
        )}
        <div className="mt-0.5 text-xs text-neutral-600">
          {note.isMultiDay ? (
            <>Created {timeAgo(note.createdAt)} · edited {timeAgo(note.updatedAt)}</>
          ) : (
            <>Created {timeAgo(note.createdAt)}</>
          )}
        </div>
      </div>
    </div>
  );
}
