import { cn } from "@/lib/utils";

interface CollapsedTabProps {
  noteCount: number;
  sessionCount: number;
  onExpand: () => void;
}

export function CollapsedTab({
  noteCount,
  sessionCount,
  onExpand,
}: CollapsedTabProps) {
  return (
    <div className="flex h-screen w-screen items-start justify-center">
      <button
        type="button"
        onClick={onExpand}
        className={cn(
          "flex items-center gap-2.5 rounded-full px-4 py-1.5",
          "bg-neutral-900/90 backdrop-blur-md",
          "border border-neutral-700/50",
          "shadow-lg transition-colors duration-150",
          "hover:bg-neutral-800/90 hover:border-neutral-600/50",
          "cursor-pointer select-none",
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
        <span className="flex items-center gap-1 text-xs font-medium text-neutral-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-400" />
          {noteCount}
        </span>

        {/* Session count */}
        <span className="flex items-center gap-1 text-xs font-medium text-neutral-300">
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-400" />
          {sessionCount}
        </span>
      </button>
    </div>
  );
}
