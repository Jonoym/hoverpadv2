import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cn } from "@/lib/utils";
import { emitEvent } from "@/lib/events";

const badgeColorMap = {
  blue: "bg-blue-600/20 text-blue-400",
  emerald: "bg-emerald-600/20 text-emerald-400",
  amber: "bg-amber-600/20 text-amber-400",
  purple: "bg-purple-600/20 text-purple-400",
  red: "bg-red-600/20 text-red-400",
} as const;

export interface WindowChromeProps {
  title: string;
  badge?: { label: string; color: "blue" | "emerald" | "amber" | "purple" | "red" };
  children: React.ReactNode;
  showMinimize?: boolean;
  /** Called before the window closes. Awaited before the actual close. */
  onBeforeClose?: () => Promise<void> | void;
  /** When provided, shows a collapse button in the title bar. */
  onCollapse?: () => void;
}

export function WindowChrome({
  title,
  badge,
  children,
  showMinimize = true,
  onBeforeClose,
  onCollapse,
}: WindowChromeProps) {
  const appWindow = getCurrentWebviewWindow();

  const handleMinimize = async () => {
    await appWindow.minimize();
  };

  const handleClose = async () => {
    // Run any pre-close logic (e.g. marking note as closed in DB)
    if (onBeforeClose) {
      await onBeforeClose();
    }

    // Determine window type from the label prefix
    const windowType = appWindow.label.startsWith("note-")
      ? "note"
      : appWindow.label.startsWith("session-")
        ? "session"
        : null;

    if (windowType) {
      await emitEvent("window:closed", {
        label: appWindow.label,
        windowType,
      });
    }

    await appWindow.close();
  };

  return (
    <div
      className={cn(
        "flex h-screen w-screen flex-col",
        "select-none overflow-hidden",
      )}
    >
      {/* Main panel */}
      <div
        className={cn(
          "flex flex-1 flex-col",
          "rounded-2xl border border-neutral-700/50 bg-neutral-900/90",
          "shadow-2xl backdrop-blur-md",
          "overflow-hidden",
        )}
      >
        {/* Title bar — drag region */}
        <div
          data-tauri-drag-region
          className={cn(
            "flex h-9 shrink-0 items-center justify-between",
            "rounded-t-2xl bg-neutral-800/50 px-3",
          )}
        >
          {/* Left: title + badge */}
          <div
            data-tauri-drag-region
            className="flex items-center gap-2 overflow-hidden"
          >
            <span
              data-tauri-drag-region
              className="truncate text-sm font-semibold text-neutral-100"
            >
              {title}
            </span>
            {badge && (
              <span
                data-tauri-drag-region
                className={cn(
                  "shrink-0 rounded-md px-2 py-0.5 text-xs",
                  badgeColorMap[badge.color],
                )}
              >
                {badge.label}
              </span>
            )}
          </div>

          {/* Right: window controls */}
          <div className="flex items-center gap-1">
            {onCollapse && (
              <button
                type="button"
                onClick={onCollapse}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md",
                  "text-neutral-400 transition-colors duration-150",
                  "hover:bg-blue-500/30 hover:text-blue-400",
                )}
                aria-label="Collapse"
              >
                {/* Chevron-up icon */}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M2 7L5 4L8 7"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  />
                </svg>
              </button>
            )}
            {showMinimize && (
              <button
                type="button"
                onClick={handleMinimize}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md",
                  "text-neutral-400 transition-colors duration-150",
                  "hover:bg-amber-500/30 hover:text-amber-400",
                )}
                aria-label="Minimize"
              >
                {/* Minus / minimize icon */}
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                >
                  <path
                    d="M1 5H9"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeLinecap="round"
                  />
                </svg>
              </button>
            )}
            <button
              type="button"
              onClick={handleClose}
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md",
                "text-neutral-400 transition-colors duration-150",
                "hover:bg-red-500/30 hover:text-red-400",
              )}
              aria-label="Close"
            >
              {/* X / close icon */}
              <svg
                width="10"
                height="10"
                viewBox="0 0 10 10"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
              >
                <path
                  d="M1 1L9 9M9 1L1 9"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </div>

        {/* Content area */}
        <div className="flex flex-1 flex-col gap-4 overflow-hidden p-5">
          {children}
        </div>
      </div>
    </div>
  );
}
