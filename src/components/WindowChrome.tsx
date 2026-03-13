import { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { invoke } from "@tauri-apps/api/core";
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
  /** Optional icon rendered before the title text. */
  titleIcon?: React.ReactNode;
  children: React.ReactNode;
  showMinimize?: boolean;
  /** Called before the window closes. Awaited before the actual close. */
  onBeforeClose?: () => Promise<void> | void;
  /** When provided, shows a collapse button in the title bar. */
  onCollapse?: () => void;
  /** Called when the user finishes renaming via the title bar context menu. */
  onRename?: (newName: string) => void;
  /** When true, shows a group indicator and enables the "Ungroup" context menu item. */
  isGrouped?: boolean;
  /** Called when the user clicks "Ungroup" from the context menu. */
  onUngroup?: () => void;
  /** Called when the user clicks "Ungroup All" — dissolves the entire group. */
  onUngroupAll?: () => void;
  /** When true, shows a blue border indicating a snap/group is about to happen. */
  snapPreview?: boolean;
}

export function WindowChrome({
  title,
  badge,
  statusDot,
  titleIcon,
  children,
  showMinimize = true,
  onBeforeClose,
  onCollapse,
  onRename,
  isGrouped,
  onUngroup,
  onUngroupAll,
  snapPreview,
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

  // Prevent double-click maximize on the title bar (Win32 subclass)
  useEffect(() => {
    invoke("prevent_maximize", { label: appWindow.label }).catch(console.error);
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

  const handleMinimize = useCallback(() => {
    document.documentElement.dataset.minimized = "true";
    document.documentElement.style.opacity = "0";
    appWindow.setIgnoreCursorEvents(true).catch(console.error);
    emitEvent("window:minimized", { label: appWindow.label, minimized: true }).catch(console.error);
  }, [appWindow]);

  const handleRestore = useCallback(async () => {
    delete document.documentElement.dataset.minimized;
    // Re-apply the current global opacity
    const { useGlobalStore } = await import("@/stores/globalStore");
    const opacity = useGlobalStore.getState().opacity;
    document.documentElement.style.opacity = String(opacity);
    await appWindow.setIgnoreCursorEvents(opacity < 0.2);
    await emitEvent("window:minimized", { label: appWindow.label, minimized: false });
  }, [appWindow]);

  // Listen for restore events
  useEffect(() => {
    const label = appWindow.label;
    const unlisten = listenEvent("window:restore", (e) => {
      if (e.payload.label === label || e.payload.label === "*") {
        handleRestore();
      }
    });
    return () => { unlisten.then((fn) => fn()).catch(console.error); };
  }, [appWindow.label, handleRestore]);

  const handleClose = async () => {
    // Run any pre-close logic (e.g. marking note as closed in DB)
    if (onBeforeClose) {
      await onBeforeClose();
    }

    // Determine window type from the label prefix
    const label = appWindow.label;
    const windowType: Parameters<typeof emitEvent<"window:closed">>[1]["windowType"] | null =
      label.startsWith("note-") ? "note"
      : label.startsWith("sg-") || label.startsWith("session-group-custom-") ? "session-group"
      : label.startsWith("session-") ? "session"
      : label.startsWith("logfile-") ? "logfile"
      : label === "clipboard" ? "clipboard"
      : label === "notifications" ? "notifications"
      : null;

    if (windowType) {
      await emitEvent("window:closed", { label, windowType });
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
          "rounded-2xl border bg-neutral-900 transition-colors duration-200",
          snapPreview
            ? "border-blue-500/70 shadow-[0_0_12px_rgba(59,130,246,0.3)]"
            : flashColor ?? "border-neutral-700/50",
          "shadow-2xl",
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
            if (onRename || onUngroup || onUngroupAll) {
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
            {titleIcon && (
              <span data-tauri-drag-region className="shrink-0 text-neutral-400">
                {titleIcon}
              </span>
            )}
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
            {isGrouped && onUngroup && (
              <button
                type="button"
                onClick={onUngroup}
                className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-md",
                  "bg-blue-500/15 text-blue-400 transition-colors duration-150",
                  "hover:bg-blue-500/30 hover:text-blue-300",
                )}
                title="Ungroup this window"
              >
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M7 9l2-2" />
                  <path d="M11 5l-1.5 1.5a2.12 2.12 0 0 1 0 3l0 0a2.12 2.12 0 0 1-3 0L5 11" />
                  <path d="M5 11l1.5-1.5a2.12 2.12 0 0 1 0-3l0 0a2.12 2.12 0 0 1 3 0L11 5" />
                </svg>
              </button>
            )}
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
          {onRename && (
            <button
              type="button"
              onClick={handleStartRename}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
            >
              Rename
            </button>
          )}
          {isGrouped && onUngroup && (
            <button
              type="button"
              onClick={() => { setCtxMenu(null); onUngroup(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
            >
              Ungroup
            </button>
          )}
          {isGrouped && onUngroupAll && (
            <button
              type="button"
              onClick={() => { setCtxMenu(null); onUngroupAll(); }}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700/60 cursor-pointer"
            >
              Ungroup All
            </button>
          )}
        </ContextMenuPopover>
      )}
    </div>
  );
}
