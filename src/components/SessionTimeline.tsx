import { useState, useCallback, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";
import type { SessionEvent } from "@/lib/sessionService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionTimelineProps {
  events: SessionEvent[];
  compact: boolean;
}

/** A group of events starting with a user message. */
interface EventGroup {
  userEvent: SessionEvent | null; // null for preamble events
  children: SessionEvent[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function formatTime(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return "--:--:--";
  }
}

/** Group events by user message. Each user message (non-tool-result) starts a new group. */
function groupEvents(events: SessionEvent[]): EventGroup[] {
  const groups: EventGroup[] = [];
  let current: EventGroup = { userEvent: null, children: [] };

  for (const event of events) {
    if (event.type === "user" && !event.isToolResult) {
      if (current.userEvent || current.children.length > 0) {
        groups.push(current);
      }
      current = { userEvent: event, children: [] };
    } else {
      current.children.push(event);
    }
  }

  if (current.userEvent || current.children.length > 0) {
    groups.push(current);
  }

  return groups;
}

// ---------------------------------------------------------------------------
// Agent derivation
// ---------------------------------------------------------------------------

export interface AgentInfo {
  id: number;
  description: string;
  startedAt: string;
  status: "running" | "completed";
  spawnIndex: number;
  resultIndex?: number;
  spawnEvent: SessionEvent;
  resultEvent?: SessionEvent;
  /** From resultEvent.agentId — maps to subagent log file. */
  agentId?: string;
}

/** Derive all agents (running + completed) from event stream (FIFO matching).
 *  Returns agents ordered most-recent-first. */
export function deriveAgents(events: SessionEvent[]): AgentInfo[] {
  const agents: AgentInfo[] = [];
  const seenSpawns = new Set<number>();

  for (let i = 0; i < events.length; i++) {
    const event = events[i]!;
    if (
      event.type === "assistant" &&
      event.toolName === "Agent" &&
      !seenSpawns.has(i)
    ) {
      seenSpawns.add(i);
      agents.push({
        id: agents.length,
        description: event.fileInfo || event.summary || "Agent task",
        startedAt: event.timestamp,
        status: "running",
        spawnIndex: i,
        spawnEvent: event,
      });
    } else if (
      event.type === "user" &&
      event.isToolResult &&
      event.toolName === "Agent"
    ) {
      // Complete oldest running agent (FIFO)
      const running = agents.find((a) => a.status === "running");
      if (running) {
        running.status = "completed";
        running.resultIndex = i;
        running.resultEvent = event;
        running.agentId = event.agentId;
      }
    }
  }

  // Most recent first
  agents.reverse();
  return agents;
}

// ---------------------------------------------------------------------------
// AgentDuration — live elapsed time counter
// ---------------------------------------------------------------------------

function AgentDuration({ startedAt }: { startedAt: string }) {
  const [elapsed, setElapsed] = useState(() =>
    Math.max(0, Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000)),
  );
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setElapsed(
        Math.max(
          0,
          Math.floor((Date.now() - new Date(startedAt).getTime()) / 1000),
        ),
      );
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, [startedAt]);

  if (elapsed < 60) return <span>{elapsed}s</span>;
  const mins = Math.floor(elapsed / 60);
  const secs = elapsed % 60;
  return (
    <span>
      {mins}m {secs.toString().padStart(2, "0")}s
    </span>
  );
}

// ---------------------------------------------------------------------------
// AgentTabBar — persistent tab bar for switching between agent views
// ---------------------------------------------------------------------------

export function AgentTabBar({
  agents,
  selectedAgent,
  onSelect,
  onRemoveAgent,
  onRemoveAllAgents,
}: {
  agents: AgentInfo[];
  selectedAgent: number | null;
  onSelect: (id: number | null) => void;
  onRemoveAgent?: (id: number) => void;
  onRemoveAllAgents?: () => void;
}) {
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    agentId?: number;
  } | null>(null);

  if (agents.length === 0) return null;

  const handleBarContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setCtxMenu({ x: e.clientX, y: e.clientY });
  };

  const handleAgentContextMenu = (e: React.MouseEvent, agentId: number) => {
    e.preventDefault();
    e.stopPropagation();
    setCtxMenu({ x: e.clientX, y: e.clientY, agentId });
  };

  return (
    <>
      <div
        className="flex gap-1.5 overflow-x-auto rounded-lg border border-neutral-700/30 bg-neutral-800/40 px-2 py-1.5"
        onContextMenu={handleBarContextMenu}
      >
        {/* "All" tab */}
        <button
          type="button"
          onClick={() => onSelect(null)}
          className={cn(
            "flex shrink-0 items-center justify-center rounded-md px-6 py-2 text-xs font-medium transition-colors duration-150",
            selectedAgent === null
              ? "bg-blue-500/20 text-blue-300 border border-blue-500/30"
              : "text-neutral-400 hover:bg-neutral-700/50 hover:text-neutral-200",
          )}
        >
          All
        </button>

        {/* Per-agent tabs */}
        {agents.map((agent) => (
          <button
            key={agent.id}
            type="button"
            onClick={() => onSelect(agent.id)}
            onContextMenu={(e) => handleAgentContextMenu(e, agent.id)}
            className={cn(
              "flex shrink-0 flex-col items-start gap-0.5 rounded-md px-3 py-2 text-left transition-colors duration-150",
              selectedAgent === agent.id
                ? "bg-indigo-500/20 border border-indigo-500/30"
                : "hover:bg-neutral-700/50",
            )}
          >
            {/* Top row: status dot + label + duration */}
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2 w-2 shrink-0 rounded-full",
                  agent.status === "running"
                    ? "bg-indigo-400 animate-pulse"
                    : "bg-emerald-400",
                )}
              />
              <span
                className={cn(
                  "text-[11px] font-semibold",
                  agent.status === "running"
                    ? "text-indigo-300"
                    : "text-emerald-300",
                )}
              >
                {agent.status === "running" ? "Running" : "Done"}
              </span>
              {agent.status === "running" && (
                <span className="font-mono text-[10px] text-indigo-400/70">
                  <AgentDuration startedAt={agent.startedAt} />
                </span>
              )}
            </div>
            {/* Description */}
            <span
              className={cn(
                "max-w-48 text-[11px] leading-snug",
                selectedAgent === agent.id
                  ? "text-neutral-200"
                  : "text-neutral-400",
              )}
              title={agent.description}
            >
              {agent.description}
            </span>
          </button>
        ))}
      </div>

      {/* Context menu */}
      {ctxMenu && (
        <>
          {/* Backdrop to close menu */}
          <div
            className="fixed inset-0 z-50"
            onClick={() => setCtxMenu(null)}
            onContextMenu={(e) => { e.preventDefault(); setCtxMenu(null); }}
          />
          <div
            className="fixed z-50 min-w-40 rounded-lg border border-neutral-700 bg-neutral-800 py-1 shadow-xl"
            style={{ left: ctxMenu.x, top: ctxMenu.y }}
          >
            {ctxMenu.agentId !== undefined && onRemoveAgent && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/50"
                onClick={() => {
                  onRemoveAgent(ctxMenu.agentId!);
                  setCtxMenu(null);
                }}
              >
                Remove agent
              </button>
            )}
            {onRemoveAllAgents && (
              <button
                type="button"
                className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-red-400 hover:bg-neutral-700/50"
                onClick={() => {
                  onRemoveAllAgents();
                  setCtxMenu(null);
                }}
              >
                Remove all agents
              </button>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Check if an event is an Agent spawn (assistant calling Agent tool). */
function isAgentSpawn(event: SessionEvent): boolean {
  return event.type === "assistant" && event.toolName === "Agent";
}

/** Check if an event is an Agent result (tool result for Agent). */
function isAgentResult(event: SessionEvent): boolean {
  return (
    event.type === "user" && !!event.isToolResult && event.toolName === "Agent"
  );
}

/** Check if an event is a background agent task-notification. */
function isTaskNotification(event: SessionEvent): boolean {
  return !!event.isTaskNotification;
}

/** Dot colour on the timeline lane. */
function dotColor(event: SessionEvent): string {
  if (event.isTaskNotification) return "bg-indigo-400";
  const tn = event.toolName?.toLowerCase();
  const isToolEvent = (event.type === "assistant" && !!event.toolName) || (event.type === "user" && event.isToolResult);
  if (isToolEvent && (tn === "edit" || tn === "write")) return "bg-emerald-400";
  if (isToolEvent && (tn === "read" || tn === "glob")) return "bg-amber-400";
  if (isToolEvent && tn === "git") return "bg-lime-400";
  if (isToolEvent && (tn === "bash" || tn === "grep")) return "bg-neutral-400";
  if (isToolEvent && tn === "agent") return "bg-indigo-400";
  if (isToolEvent && tn === "task") return "bg-rose-400";
  if (isToolEvent && tn === "skill") return "bg-cyan-400";
  if (event.type === "user") return "bg-blue-400";
  if (event.type === "assistant" && event.toolName) return "bg-amber-400";
  if (event.type === "assistant") return "bg-purple-400";
  return "bg-neutral-600";
}

// ---------------------------------------------------------------------------
// Gutter: the fixed-width column that holds the dot, centered on the line
// ---------------------------------------------------------------------------

const GUTTER_W = "w-6"; // 24px — line runs down the center at 12px

function Gutter({
  dotClass,
  size = "sm",
}: {
  dotClass: string;
  size?: "sm" | "lg";
}) {
  const sizeClass = size === "lg" ? "h-2.5 w-2.5" : "h-1.5 w-1.5";
  return (
    <div className={cn(GUTTER_W, "shrink-0 flex justify-center pt-2.5")}>
      <div className={cn(sizeClass, "rounded-full z-10", dotClass)} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Turn completed divider
// ---------------------------------------------------------------------------

function TurnDivider({ event }: { event: SessionEvent }) {
  return (
    <div className="flex items-center py-2 my-1">
      <div className={cn(GUTTER_W, "shrink-0 flex justify-center")}>
        <div className="h-2 w-2 rounded-full bg-neutral-500 z-10" />
      </div>
      <div className="flex flex-1 items-center gap-3">
        <div className="flex-1 border-t border-neutral-700/50" />
        <span className="shrink-0 text-xs font-medium text-neutral-500">
          {event.summary}
        </span>
        <span className="shrink-0 font-mono text-[10px] text-neutral-600">
          {formatTime(event.timestamp)}
        </span>
        <div className="flex-1 border-t border-neutral-700/50" />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Child event row (tool calls, tool results, AI text, progress)
// ---------------------------------------------------------------------------

function ChildEventRow({
  event,
  compact,
}: {
  event: SessionEvent;
  compact: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isProgress = event.type === "progress";
  const hasExpandableContent = !!event.fullContent;
  const isExpandable = hasExpandableContent && !compact;

  const toggleExpand = useCallback(() => {
    if (isExpandable) setIsExpanded((prev) => !prev);
  }, [isExpandable]);

  // Check if expanded content is a diff (Edit/Write tool)
  const isDiffContent = event.fullContent?.startsWith("- ") || event.fullContent?.startsWith("+ ");

  // Determine label and styling
  let label: string;
  let labelClass: string;
  let bgTint: string;

  // Tool-specific colors (applied to both assistant tool calls and user tool results)
  const tn = event.toolName?.toLowerCase();
  const isToolEvent = (event.type === "assistant" && !!event.toolName) || (event.type === "user" && event.isToolResult);

  if (isToolEvent && (tn === "edit" || tn === "write")) {
    label = event.toolName!;
    labelClass = "bg-emerald-500/15 text-emerald-400 font-mono";
    bgTint = "bg-emerald-500/5";
  } else if (isToolEvent && (tn === "read" || tn === "glob")) {
    label = event.toolName!;
    labelClass = "bg-amber-500/15 text-amber-400 font-mono";
    bgTint = "bg-amber-500/5";
  } else if (isToolEvent && tn === "git") {
    label = "Git";
    labelClass = "bg-lime-500/15 text-lime-400 font-mono";
    bgTint = "bg-lime-500/5";
  } else if (isToolEvent && (tn === "bash" || tn === "grep")) {
    label = event.toolName!;
    labelClass = "bg-neutral-500/15 text-neutral-400 font-mono";
    bgTint = "";
  } else if (isToolEvent && tn === "agent") {
    label = "Agent";
    labelClass = "bg-indigo-500/15 text-indigo-400 font-mono";
    bgTint = "bg-indigo-500/5";
  } else if (isToolEvent && tn === "task") {
    label = "Task";
    labelClass = "bg-rose-500/15 text-rose-400 font-mono";
    bgTint = "bg-rose-500/5";
  } else if (isToolEvent && tn === "skill") {
    label = "Skill";
    labelClass = "bg-cyan-500/15 text-cyan-400 font-mono";
    bgTint = "bg-cyan-500/5";
  } else if (event.type === "assistant" && event.toolName) {
    label = event.toolName;
    labelClass = "bg-amber-500/15 text-amber-400 font-mono";
    bgTint = "bg-amber-500/5";
  } else if (event.type === "assistant") {
    label = "AI";
    labelClass = "bg-purple-500/15 text-purple-400 font-semibold";
    bgTint = "bg-purple-500/5";
  } else if (event.type === "user" && event.isToolResult) {
    label = event.toolName || "Tool";
    labelClass = "bg-amber-500/15 text-amber-400 font-mono";
    bgTint = "bg-amber-500/5";
  } else if (event.type === "progress") {
    label = "Progress";
    labelClass = "text-neutral-600";
    bgTint = "";
  } else {
    label = event.type;
    labelClass = "text-neutral-600";
    bgTint = "";
  }

  return (
    <div
      className={cn(
        "flex rounded-lg",
        "transition-colors duration-150 hover:bg-neutral-800/50",
        bgTint,
        isProgress && "opacity-60",
      )}
    >
      {/* Gutter dot */}
      <Gutter dotClass={dotColor(event)} />

      {/* Content */}
      <div className="flex-1 min-w-0 py-0.5 pr-2">
        <div
          className={cn(
            "flex items-center gap-1",
            isExpandable && "cursor-pointer",
          )}
          onClick={toggleExpand}
        >
          {/* Timestamp */}
          <span className="w-16 shrink-0 font-mono text-[11px] text-neutral-500">
            {formatTime(event.timestamp)}
          </span>

          {/* Type label chip */}
          <span
            className={cn(
              "shrink-0 truncate rounded px-1.5 py-0.5 text-[11px] max-w-28",
              labelClass,
            )}
            title={event.type}
          >
            {compact ? label.slice(0, 8) : label}
          </span>

          {/* Summary / file info */}
          <span
            className={cn(
              "min-w-0 flex-1 text-xs",
              isProgress ? "text-neutral-500"
                : event.type === "assistant" && !event.toolName ? "text-neutral-500"
                : "text-neutral-300",
              compact || !isExpanded ? "truncate" : "whitespace-pre-wrap",
            )}
          >
            {event.fileInfo ? (
              <>
                <code className="bg-neutral-800 text-neutral-300 px-1 py-0.5 rounded text-[11px]">
                  {event.fileInfo}
                </code>
                {event.diffStats && (
                  <span className="font-mono text-[11px] ml-1.5">
                    {event.diffStats.split("/").map((part, i) => (
                      <span key={i}>
                        {i > 0 && <span className="text-neutral-500">/</span>}
                        <span className={part.startsWith("-") ? "text-red-400/80" : "text-emerald-400/80"}>
                          {part}
                        </span>
                      </span>
                    ))}
                  </span>
                )}
                {event.summary && (
                  <span className="text-neutral-500 ml-1.5">
                    {event.summary}
                  </span>
                )}
              </>
            ) : (
              event.summary ?? ""
            )}
          </span>

          {/* Expand indicator */}
          {isExpandable && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={cn(
                "shrink-0 mt-0.5 text-neutral-500 transition-transform duration-150",
                isExpanded ? "rotate-90" : "rotate-0",
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
          )}
        </div>

        {/* Expanded content */}
        {isExpanded && event.fullContent && (
          <div className="mt-1 max-h-40 overflow-y-auto rounded border border-neutral-700/30 bg-neutral-900/50 px-2 py-1.5 text-[11px] font-mono whitespace-pre-wrap">
            {isDiffContent ? (
              event.fullContent.split("\n").map((line, i) => (
                <div
                  key={i}
                  className={
                    line.startsWith("- ") ? "text-red-400/70"
                    : line.startsWith("+ ") ? "text-emerald-400/70"
                    : "text-neutral-400"
                  }
                >
                  {line}
                </div>
              ))
            ) : (
              <span className="text-neutral-400">{event.fullContent}</span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Agent Task Card — distinct card for Task tool spawn / completion
// ---------------------------------------------------------------------------

function AgentTaskCard({
  event,
  compact,
}: {
  event: SessionEvent;
  compact: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isSpawn = isAgentSpawn(event);
  const isNotification = isTaskNotification(event);
  const hasExpandableContent = !!event.fullContent;
  const isExpandable = hasExpandableContent && !compact;

  const toggleExpand = useCallback(() => {
    if (isExpandable) setIsExpanded((prev) => !prev);
  }, [isExpandable]);

  // Choose label + colours based on variant
  let chipLabel: string;
  let chipClass: string;
  let borderClass: string;
  if (isSpawn) {
    chipLabel = "Agent";
    chipClass = "bg-indigo-500/20 text-indigo-300";
    borderClass = "border-indigo-500/30 bg-indigo-500/10";
  } else if (isNotification) {
    chipLabel = "Agent";
    chipClass = "bg-indigo-500/15 text-indigo-300";
    borderClass = "border-indigo-500/20 bg-indigo-500/5";
  } else {
    chipLabel = "Agent";
    chipClass = "bg-indigo-500/20 text-indigo-300";
    borderClass = "border-indigo-500/20 bg-indigo-500/5";
  }

  return (
    <div className={cn("flex rounded-lg border", borderClass)}>
      {/* Gutter — large dot for visual weight */}
      <Gutter
        dotClass={isNotification ? "bg-indigo-400" : "bg-indigo-400"}
        size="lg"
      />

      {/* Content */}
      <div className="flex-1 min-w-0 py-1.5 pr-3">
        <div
          className={cn(
            "flex items-center gap-1",
            isExpandable && "cursor-pointer",
          )}
          onClick={toggleExpand}
        >
          {/* Timestamp */}
          <span className="w-16 shrink-0 font-mono text-[11px] text-indigo-400/70">
            {formatTime(event.timestamp)}
          </span>

          {/* Label chip */}
          <span
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold",
              chipClass,
            )}
          >
            {chipLabel}
          </span>

          {/* Description */}
          <span
            className={cn(
              "min-w-0 flex-1 text-xs font-medium",
              isSpawn ? "text-neutral-100" : "text-neutral-300",
              compact || !isExpanded ? "truncate" : "whitespace-pre-wrap",
            )}
          >
            {isNotification
              ? event.summary || "Agent completed"
              : event.fileInfo || event.summary || "Task"}
          </span>

          {/* Expand indicator */}
          {isExpandable && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={cn(
                "shrink-0 mt-0.5 text-neutral-500 transition-transform duration-150",
                isExpanded ? "rotate-90" : "rotate-0",
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
          )}
        </div>

        {/* Expanded content */}
        {isExpanded && event.fullContent && (
          <div className="mt-1.5 max-h-40 overflow-y-auto rounded border border-indigo-500/15 bg-neutral-900/50 px-2 py-1.5 text-[11px] text-neutral-400 font-mono whitespace-pre-wrap">
            {event.fullContent}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Render helper — choose AgentTaskCard vs ChildEventRow
// ---------------------------------------------------------------------------

function EventRow({
  event,
  compact,
}: {
  event: SessionEvent;
  compact: boolean;
}) {
  // Hide "started" (assistant tool call) rows for Read/Edit — only show "completed"
  if (event.type === "assistant" && event.toolName) {
    const tn = event.toolName.toLowerCase();
    if (tn === "read" || tn === "edit" || tn === "glob" || tn === "grep" || tn === "write") {
      return null;
    }
  }
  if (isAgentSpawn(event) || isAgentResult(event) || isTaskNotification(event)) {
    return <AgentTaskCard event={event} compact={compact} />;
  }
  return <ChildEventRow event={event} compact={compact} />;
}

// ---------------------------------------------------------------------------
// Agent prompt row — expandable full task description
// ---------------------------------------------------------------------------

function AgentPromptRow({
  content,
  compact,
  timestamp,
}: {
  content: string;
  compact: boolean;
  timestamp: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);
  const isExpandable = !compact;

  return (
    <div
      className={cn(
        "flex rounded-lg",
        "transition-colors duration-150 hover:bg-neutral-800/50",
        "bg-indigo-500/5",
      )}
    >
      <Gutter dotClass="bg-indigo-400" />
      <div className="flex-1 min-w-0 py-0.5 pr-2">
        <div
          className={cn(
            "flex items-center gap-1",
            isExpandable && "cursor-pointer",
          )}
          onClick={() => isExpandable && setIsExpanded((p) => !p)}
        >
          <span className="w-16 shrink-0 font-mono text-[11px] text-indigo-400/70">
            {formatTime(timestamp)}
          </span>

          <span className="shrink-0 rounded px-1.5 py-0.5 text-[11px] bg-indigo-500/15 text-indigo-400 font-mono">
            Prompt
          </span>

          <span className="min-w-0 flex-1 text-xs text-neutral-400 truncate">
            Full task instructions
          </span>

          {isExpandable && (
            <svg
              width="10"
              height="10"
              viewBox="0 0 10 10"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              className={cn(
                "shrink-0 mt-0.5 text-neutral-500 transition-transform duration-150",
                isExpanded ? "rotate-90" : "rotate-0",
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
          )}
        </div>

        {isExpanded && (
          <div className="mt-1 max-h-60 overflow-y-auto rounded border border-indigo-500/15 bg-neutral-900/50 px-2 py-1.5 text-[11px] text-neutral-400 font-mono whitespace-pre-wrap">
            {content}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// User message group (big header + collapsible children)
// ---------------------------------------------------------------------------

function UserGroup({
  group,
  compact,
  defaultExpanded,
}: {
  group: EventGroup;
  compact: boolean;
  defaultExpanded: boolean;
}) {
  const [isExpanded, setIsExpanded] = useState(defaultExpanded);

  const toggleExpand = useCallback(() => {
    setIsExpanded((prev) => !prev);
  }, []);

  // Separate turn_duration events from other children
  const turnEvents: SessionEvent[] = [];
  const childEvents: SessionEvent[] = [];
  for (const child of group.children) {
    if (child.type === "system") {
      turnEvents.push(child);
    } else {
      childEvents.push(child);
    }
  }

  if (!group.userEvent) {
    // Preamble group — render children flat
    return (
      <>
        {childEvents.map((event, i) => (
          <EventRow key={`pre-${i}`} event={event} compact={compact} />
        ))}
        {turnEvents.map((event, i) => (
          <TurnDivider key={`turn-pre-${i}`} event={event} />
        ))}
      </>
    );
  }

  const userEvent = group.userEvent;
  const isAgentPrompt = !!userEvent.isAgentPrompt;

  return (
    <div>
      {/* User message header — big, prominent */}
      <div
        className={cn(
          "flex rounded-lg cursor-pointer",
          isAgentPrompt
            ? "bg-indigo-500/10 border border-indigo-500/20 transition-colors duration-150 hover:bg-indigo-500/15"
            : "bg-blue-500/10 border border-blue-500/20 transition-colors duration-150 hover:bg-blue-500/15",
        )}
        onClick={toggleExpand}
      >
        {/* Gutter dot — bigger for user messages */}
        <div className={cn(GUTTER_W, "shrink-0 flex justify-center pt-3")}>
          <div className={cn(
            "h-2.5 w-2.5 rounded-full ring-2 ring-neutral-900 z-10",
            isAgentPrompt ? "bg-indigo-400" : "bg-blue-400",
          )} />
        </div>

        {/* Content */}
        <div className="flex-1 min-w-0 flex items-center gap-1 py-2 pr-3">
          {/* Timestamp */}
          <span className={cn(
            "w-16 shrink-0 font-mono text-[11px]",
            isAgentPrompt ? "text-indigo-400/70" : "text-blue-400/70",
          )}>
            {formatTime(userEvent.timestamp)}
          </span>

          {/* Label */}
          <span className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold",
            isAgentPrompt
              ? "bg-indigo-500/20 text-indigo-300"
              : "bg-blue-500/20 text-blue-300",
          )}>
            {isAgentPrompt ? "Agent Task" : "User"}
          </span>

          {/* Message preview — show description for agent prompts */}
          <span className="min-w-0 flex-1 text-sm font-medium text-neutral-100 truncate">
            {isAgentPrompt
              ? userEvent.agentDescription || "Agent task"
              : userEvent.summary ?? "User input"}
          </span>

          {/* Child count badge */}
          {childEvents.length > 0 && (
            <span className="shrink-0 text-[10px] text-neutral-500">
              {childEvents.length} events
            </span>
          )}

          {/* Collapse/expand chevron */}
          <svg
            width="10"
            height="10"
            viewBox="0 0 10 10"
            fill="none"
            xmlns="http://www.w3.org/2000/svg"
            className={cn(
              "shrink-0 text-neutral-500 transition-transform duration-150",
              isExpanded ? "rotate-90" : "rotate-0",
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
        </div>
      </div>

      {/* Collapsible children */}
      {isExpanded && (
        <div className="flex flex-col gap-1 mt-1">
          {/* Agent prompt: show full task as expandable row */}
          {isAgentPrompt && userEvent.fullContent && (
            <AgentPromptRow content={userEvent.fullContent} compact={compact} timestamp={userEvent.timestamp} />
          )}
          {childEvents.map((event, i) => (
            <EventRow key={`child-${i}`} event={event} compact={compact} />
          ))}
          {turnEvents.map((event, i) => (
            <TurnDivider key={`turn-${i}`} event={event} />
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function SessionTimeline({ events, compact }: SessionTimelineProps) {
  if (events.length === 0) {
    return (
      <div className="flex flex-1 items-center justify-center text-sm text-neutral-500">
        No events yet
      </div>
    );
  }

  const groups = groupEvents(events);

  return (
    <div className="relative flex flex-col gap-1">
      {/* Vertical timeline line — centered in the gutter column (w-6 = 24px, center = 12px) */}
      <div className="absolute left-3 top-0 bottom-0 w-px bg-neutral-700/40" />

      {groups.map((group, i) => (
        <UserGroup
          key={`group-${i}`}
          group={group}
          compact={compact}
          defaultExpanded={i === groups.length - 1}
        />
      ))}
    </div>
  );
}
