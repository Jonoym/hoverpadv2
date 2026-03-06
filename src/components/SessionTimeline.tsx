import { cn } from "@/lib/utils";
import type { SessionEvent } from "@/lib/sessionService";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SessionTimelineProps {
  events: SessionEvent[];
  compact: boolean;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Format a timestamp as HH:mm:ss. */
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

interface TypeIndicator {
  label: string;
  className: string;
}

/** Map an event to its type indicator (label + colour). */
function getTypeIndicator(event: SessionEvent): TypeIndicator {
  switch (event.type) {
    case "user":
      return { label: ">", className: "text-blue-400 font-bold" };

    case "assistant":
      if (event.toolName) {
        return { label: event.toolName, className: "text-amber-400" };
      }
      return { label: "AI", className: "text-purple-400" };

    case "progress":
      return { label: "...", className: "text-neutral-500" };

    case "system":
      return { label: "\u23F1", className: "text-neutral-500" };

    case "file-history-snapshot":
      return { label: "snap", className: "text-neutral-600" };

    default:
      return { label: "?", className: "text-neutral-600" };
  }
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

  return (
    <div className="flex flex-col gap-0.5">
      {events.map((event, index) => {
        const indicator = getTypeIndicator(event);
        const isProgress = event.type === "progress";

        return (
          <div
            key={`${event.timestamp}-${index}`}
            className={cn(
              "flex items-start gap-2 rounded-lg px-2 py-0.5",
              "transition-colors duration-150 hover:bg-neutral-800/50",
              isProgress && "opacity-60",
            )}
          >
            {/* Timestamp */}
            <span className="w-16 shrink-0 font-mono text-xs text-neutral-500">
              {formatTime(event.timestamp)}
            </span>

            {/* Type indicator */}
            <span
              className={cn(
                "w-14 shrink-0 text-xs font-medium",
                indicator.className,
              )}
              title={event.type}
            >
              {compact ? indicator.label.slice(0, 8) : indicator.label}
            </span>

            {/* Summary text */}
            <span
              className={cn(
                "min-w-0 text-xs",
                isProgress ? "text-neutral-500" : "text-neutral-300",
                compact ? "truncate" : "whitespace-pre-wrap",
              )}
            >
              {event.summary ?? ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
