import { cn } from "@/lib/utils";

interface CollapsedTabProps {
  noteCount: number;
  activeSessions: number;
  idleSessions: number;
  idleAgentsSessions: number;
  doneSessions: number;
  onExpand: () => void;
}

export function CollapsedTab({
  noteCount,
  activeSessions,
  idleSessions,
  idleAgentsSessions,
  doneSessions,
  onExpand,
}: CollapsedTabProps) {
  // Stay pink as long as there are completed sessions
  const hasDone = doneSessions > 0;

  return (
    <div className="flex h-screen w-screen items-start justify-center">
      <div
        className={cn(
          "flex items-center gap-2.5 rounded-full px-3 py-1.5",
          hasDone ? "bg-[#241e30]/90" : "bg-neutral-900/90",
          "backdrop-blur-md",
          "border border-neutral-700/50 shadow-lg select-none",
          "transition-all duration-300",
        )}
      >
        {/* Drag handle */}
        <div
          data-tauri-drag-region
          className="flex cursor-grab items-center active:cursor-grabbing"
          title="Drag to move"
        >
          <svg
            data-tauri-drag-region
            width="8"
            height="14"
            viewBox="0 0 8 14"
            fill="none"
            className="text-neutral-600"
          >
            <circle cx="2" cy="2" r="1" fill="currentColor" />
            <circle cx="6" cy="2" r="1" fill="currentColor" />
            <circle cx="2" cy="7" r="1" fill="currentColor" />
            <circle cx="6" cy="7" r="1" fill="currentColor" />
            <circle cx="2" cy="12" r="1" fill="currentColor" />
            <circle cx="6" cy="12" r="1" fill="currentColor" />
          </svg>
        </div>

        {/* Clickable content — expands the panel */}
        <button
          type="button"
          onClick={onExpand}
          className={cn(
            "flex items-center gap-2.5",
            "rounded-full px-1 py-0.5",
            "cursor-pointer transition-colors duration-150",
            "hover:bg-neutral-800/60",
          )}
        >
          {/* Hoverpad icon */}
          <svg
            width="18"
            height="18"
            viewBox="0 0 1240 1240"
            xmlns="http://www.w3.org/2000/svg"
            className="shrink-0"
          >
            <rect width="1240" height="1240" rx="200" fill="#1e1e2e" />
            <text
              x="620"
              y="700"
              fontFamily="Arial, sans-serif"
              fontSize="500"
              fontWeight="bold"
              fill="#89b4fa"
              textAnchor="middle"
            >
              H
            </text>
          </svg>

          {/* Note count */}
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
            {noteCount}
          </span>

          <span className="text-neutral-700">·</span>

          {/* Active sessions */}
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
            {activeSessions}
          </span>

          <span className="text-neutral-700">·</span>

          {/* Idle sessions */}
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-400" />
            {idleSessions}
          </span>

          <span className="text-neutral-700">·</span>

          {/* Idle with agents */}
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-400">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-indigo-400" />
            {idleAgentsSessions}
          </span>

          <span className="text-neutral-700">·</span>

          {/* Done sessions */}
          <span className="flex items-center gap-1 text-xs font-medium text-neutral-400">
            <span className={cn(
              "inline-block h-1.5 w-1.5 rounded-full transition-all duration-300",
              "bg-purple-400",
            )} />
            {doneSessions}
          </span>
        </button>
      </div>
    </div>
  );
}
