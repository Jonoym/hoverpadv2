import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cn } from "@/lib/utils";
import { emitEvent, listenEvent } from "@/lib/events";
import { ContextMenuPopover } from "@/components/ContextMenu";

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
  /** Renders a small colored dot to the left of the title text. */
  statusDot?: { color: string };
  children: React.ReactNode;
  showMinimize?: boolean;
  /** Called before the window closes. Awaited before the actual close. */
  onBeforeClose?: () => Promise<void> | void;
  /** When provided, shows a collapse button in the title bar. */
  onCollapse?: () => void;
  /** Called when the user finishes renaming via the title bar context menu. */
  onRename?: (newName: string) => void;
}

export function WindowChrome({
  title,
  badge,
  statusDot,
  children,
  showMinimize = true,
  onBeforeClose,
  onCollapse,
  onRename,
}: WindowChromeProps) {
  const appWindow = getCurrentWebviewWindow();

  // Context menu state
  const [ctxMenu, setCtxMenu] = useState<{ x: number; y: number } | null>(null);
  // Inline rename state
  const [isRenaming, setIsRenaming] = useState(false);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  // Flash state — briefly highlights the window border
  const [flashColor, setFlashColor] = useState<string | null>(null);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  // Listen for flash events targeted at this window
  useEffect(() => {
    const label = appWindow.label;
    const unlisten = listenEvent("window:flash", (e) => {
      if (e.payload.label === label) {
        setFlashColor(e.payload.color ?? "border-blue-500");
        clearTimeout(flashTimerRef.current);
        flashTimerRef.current = setTimeout(() => setFlashColor(null), 700);
      }
    });
    return () => { unlisten.then((fn) => fn()); };
  }, [appWindow.label]);

  // Close context menu on outside click
  useEffect(() => {
    if (!ctxMenu) return;
    const close = () => setCtxMenu(null);
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [ctxMenu]);

  // Focus rename input when it appears
  useEffect(() => {
    if (isRenaming && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [isRenaming]);

  const handleStartRename = useCallback(() => {
    setCtxMenu(null);
    setRenameValue(title);
    setIsRenaming(true);
  }, [title]);

  const handleFinishRename = useCallback(() => {
    setIsRenaming(false);
    const trimmed = renameValue.trim();
    if (trimmed && trimmed !== title && onRename) {
      onRename(trimmed);
    }
  }, [renameValue, title, onRename]);

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
          "rounded-2xl border bg-neutral-900/90 transition-colors duration-300",
          flashColor ?? "border-neutral-700/50",
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
          onContextMenu={(e) => {
            if (onRename) {
              e.preventDefault();
              setCtxMenu({ x: e.clientX, y: e.clientY });
            }
          }}
        >
          {/* Left: title (or rename input) + badge */}
          <div
            data-tauri-drag-region
            className="flex items-center gap-2 overflow-hidden"
          >
            {statusDot && (
              <span
                data-tauri-drag-region
                className={cn("h-1.5 w-1.5 shrink-0 rounded-full", statusDot.color)}
              />
            )}
            {isRenaming ? (
              <input
                ref={renameInputRef}
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onBlur={handleFinishRename}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleFinishRename();
                  if (e.key === "Escape") setIsRenaming(false);
                }}
                className="min-w-0 flex-1 truncate text-sm font-semibold text-neutral-200 bg-neutral-800 border border-neutral-600 rounded px-1 py-0 outline-none focus:border-blue-500"
              />
            ) : (
              <span
                data-tauri-drag-region
                className="truncate text-sm font-semibold text-neutral-100"
              >
                {title}
              </span>
            )}
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
        <div className="flex flex-1 flex-col gap-2 overflow-hidden px-3 pt-2 pb-2">
          {children}
        </div>
      </div>

      {/* Title bar context menu */}
      {ctxMenu && (
        <ContextMenuPopover x={ctxMenu.x} y={ctxMenu.y}>
          <button
            type="button"
            onClick={handleStartRename}
            className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
          >
            Rename
          </button>
        </ContextMenuPopover>
      )}
    </div>
  );
}
