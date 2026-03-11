import { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { cn } from "@/lib/utils";
import { useWindowStateSaver, saveWindowState } from "@/lib/windowState";
import { WindowChrome } from "@/components/WindowChrome";
import { SessionTimeline, AgentTabBar, deriveAgents } from "@/components/SessionTimeline";
import { getLogFile, parseLogFile, renameLogFile, setLogFileOpen } from "@/lib/logFileService";
import type { SessionEvent } from "@/lib/sessionService";
import { useWindowGrouping } from "@/lib/useWindowGrouping";

export function LogFileWindow() {
  const { id } = useParams<{ id: string }>();
  useWindowStateSaver(id, "log_files");
  const { isGrouped, snapPreview, ungroup, ungroupAll } = useWindowGrouping();

  // Mark as open on mount (for window restore on next launch)
  useEffect(() => {
    if (!id) return;
    setLogFileOpen(id, true).catch(console.error);
  }, [id]);

  // Close handler — save state and mark closed (only on explicit close, not app quit)
  const handleBeforeClose = useCallback(async () => {
    if (!id) return;
    await saveWindowState(id, "log_files");
    await setLogFileOpen(id, false);
  }, [id]);

  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState("Log File");
  const [compact, setCompact] = useState(false);
  const [agentFilter, setAgentFilter] = useState<number | null>(null);
  const [hiddenAgents, setHiddenAgents] = useState<Set<number>>(new Set());
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;

    let cancelled = false;

    async function load() {
      try {
        const logFile = await getLogFile(id!);
        if (cancelled) return;

        if (!logFile) {
          setError("Log file not found in database.");
          setLoading(false);
          return;
        }

        setTitle(logFile.label || logFile.path.split(/[/\\]/).pop() || "Log File");

        const parsed = await parseLogFile(logFile.path);
        if (cancelled) return;

        setEvents(parsed);
      } catch (err) {
        if (!cancelled) setError(String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, [id]);

  const handleRename = useCallback(async (newName: string) => {
    if (!id) return;
    await renameLogFile(id, newName || null);
    setTitle(newName || "Log File");
  }, [id]);

  // Derive agents and filter events
  const allAgents = deriveAgents(events);
  const agents = allAgents.filter((a) => !hiddenAgents.has(a.spawnIndex));

  let filteredEvents: SessionEvent[];
  if (agentFilter !== null) {
    const agent = agents.find((a) => a.id === agentFilter);
    filteredEvents = events.filter((_e, i) =>
      agent && (i === agent.spawnIndex || i === agent.resultIndex),
    );
  } else {
    filteredEvents = events;
  }

  return (
    <WindowChrome
      title={title}
      onBeforeClose={handleBeforeClose}
      onRename={(name) => void handleRename(name)}
      isGrouped={isGrouped}
      onUngroup={isGrouped ? () => void ungroup() : undefined}
      onUngroupAll={isGrouped ? () => void ungroupAll() : undefined}
      snapPreview={snapPreview}
    >
      {/* Controls bar */}
      <div
        className={cn(
          "flex items-center gap-1.5",
          "rounded-lg bg-neutral-800/40 border border-neutral-700/30",
          "px-2 py-1",
        )}
      >
        <button
          type="button"
          onClick={() => setCompact((p) => !p)}
          className={cn(
            "flex h-6 items-center rounded-md px-1.5 text-xs font-medium transition-colors duration-150",
            compact
              ? "bg-blue-500/15 text-blue-400"
              : "text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200",
          )}
          title={compact ? "Switch to expanded view" : "Switch to compact view"}
        >
          {compact ? "Compact" : "Expanded"}
        </button>

        <div className="flex-1" />

        <span className="text-xs text-neutral-500">
          {events.length} event{events.length !== 1 ? "s" : ""}
        </span>
      </div>

      <AgentTabBar
        agents={agents}
        selectedAgent={agentFilter}
        onSelect={setAgentFilter}
        onRemoveAgent={(aid) => {
          const agent = agents.find((a) => a.id === aid);
          if (agent) {
            setHiddenAgents((prev) => new Set([...prev, agent.spawnIndex]));
            if (agentFilter === aid) setAgentFilter(null);
          }
        }}
        onRemoveAllAgents={() => {
          setHiddenAgents(new Set(allAgents.map((a) => a.spawnIndex)));
          setAgentFilter(null);
        }}
      />

      {/* Timeline */}
      <div ref={scrollRef} className="relative flex-1 overflow-y-auto">
        {loading ? (
          <div className="flex flex-1 items-center justify-center py-8 text-sm text-neutral-500">
            Loading log file...
          </div>
        ) : error ? (
          <div className="flex flex-1 items-center justify-center py-8 text-sm text-red-400">
            {error}
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-1 items-center justify-center py-8 text-sm text-neutral-500">
            No events found in log file.
          </div>
        ) : (
          <SessionTimeline events={filteredEvents} compact={compact} />
        )}
      </div>
    </WindowChrome>
  );
}
