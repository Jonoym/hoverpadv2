import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { cn } from "@/lib/utils";
import { WindowChrome } from "@/components/WindowChrome";
import { useGlobalStore } from "@/stores/globalStore";
import {
  togglePinEntry,
  deleteClipboardEntry,
  clearUnpinnedEntries,
  type ClipboardEntry,
} from "@/lib/clipboardService";
import {
  setClipboardWindowOpen,
  saveClipboardWindowState,
} from "@/lib/settingsService";
import { timeAgo } from "@/lib/timeAgo";
import { getMonitors, computeSnap, type MonitorInfo } from "@/lib/monitorUtils";
import { useWindowGrouping } from "@/lib/useWindowGrouping";

export function ClipboardWindow() {
  const [searchQuery, setSearchQuery] = useState("");
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const entries = useGlobalStore((s) => s.clipboardEntries);
  const refreshClipboard = useGlobalStore((s) => s.refreshClipboard);
  const { isGrouped, snapPreview, ungroup, ungroupAll } = useWindowGrouping();

  // Mark as open on mount
  useEffect(() => {
    void setClipboardWindowOpen(true);
    void refreshClipboard();
  }, [refreshClipboard]);

  // Persist window position/size on move and resize (debounced), with snap-to-edge
  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();
    let debounceTimer: ReturnType<typeof setTimeout> | undefined;
    let snapTimer: ReturnType<typeof setTimeout> | undefined;
    let monitors: MonitorInfo[] | null = null;
    let isSnapping = false;

    getMonitors().then((m) => { monitors = m; }).catch(console.error);

    const handleSave = () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        saveClipboardWindowState().catch(console.error);
      }, 2000);
    };

    const handleMove = () => {
      handleSave();
      if (isSnapping) return;
      clearTimeout(snapTimer);
      snapTimer = setTimeout(async () => {
        if (!monitors) return;
        try {
          const pos = await appWindow.outerPosition();
          const size = await appWindow.outerSize();
          const snap = computeSnap(monitors, pos.x, pos.y, size.width, size.height);
          if (snap) {
            isSnapping = true;
            await appWindow.setPosition(new PhysicalPosition(snap.x, snap.y));
            setTimeout(() => { isSnapping = false; }, 100);
          }
        } catch { /* window may have been destroyed */ }
      }, 150);
    };

    const unlistenMove = appWindow.onMoved(handleMove);
    const unlistenResize = appWindow.onResized(handleSave);

    return () => {
      clearTimeout(debounceTimer);
      clearTimeout(snapTimer);
      saveClipboardWindowState().catch(console.error);
      unlistenMove.then((fn) => fn()).catch(console.error);
      unlistenResize.then((fn) => fn()).catch(console.error);
    };
  }, []);

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return entries;
    const q = searchQuery.toLowerCase();
    return entries.filter((e) => e.content.toLowerCase().includes(q));
  }, [entries, searchQuery]);

  const handleCopy = useCallback(async (entry: ClipboardEntry) => {
    await invoke("write_clipboard", { text: entry.content });
    setCopiedId(entry.id);
    clearTimeout(copiedTimerRef.current);
    copiedTimerRef.current = setTimeout(() => setCopiedId(null), 1500);
  }, []);

  const handlePin = useCallback(async (id: string) => {
    await togglePinEntry(id);
    await refreshClipboard();
  }, [refreshClipboard]);

  const handleDelete = useCallback(async (id: string) => {
    await deleteClipboardEntry(id);
    await refreshClipboard();
  }, [refreshClipboard]);

  const handleClearAll = useCallback(async () => {
    await clearUnpinnedEntries();
    await refreshClipboard();
  }, [refreshClipboard]);

  const pinnedCount = entries.filter((e) => e.pinned).length;

  const handleBeforeClose = useCallback(async () => {
    await saveClipboardWindowState();
    await setClipboardWindowOpen(false);
  }, []);

  return (
    <WindowChrome title="Clipboard History" onBeforeClose={handleBeforeClose} isGrouped={isGrouped} onUngroup={isGrouped ? () => void ungroup() : undefined} onUngroupAll={isGrouped ? () => void ungroupAll() : undefined} snapPreview={snapPreview}>
      {/* Search */}
      <div className="relative">
        <input
          type="text"
          placeholder="Search clipboard..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className={cn(
            "w-full rounded-lg border border-neutral-700/50 bg-neutral-800/60",
            "px-3 py-1.5 text-sm text-neutral-200 placeholder-neutral-500",
            "outline-none focus:border-blue-500/50",
          )}
        />
        {searchQuery && (
          <button
            type="button"
            onClick={() => setSearchQuery("")}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
          >
            <svg width="12" height="12" viewBox="0 0 10 10" fill="none">
              <path d="M1 1L9 9M9 1L1 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>

      {/* Entry count + clear */}
      <div className="flex items-center justify-between text-xs text-neutral-500">
        <span>
          {filtered.length} {filtered.length === 1 ? "entry" : "entries"}
          {pinnedCount > 0 && ` (${pinnedCount} pinned)`}
        </span>
        {entries.length > pinnedCount && (
          <button
            type="button"
            onClick={handleClearAll}
            className="text-neutral-500 hover:text-red-400 transition-colors cursor-pointer"
          >
            Clear unpinned
          </button>
        )}
      </div>

      {/* Entry list */}
      <div className="flex-1 overflow-y-auto -mx-1 space-y-1">
        {filtered.length === 0 && (
          <div className="flex items-center justify-center h-32 text-neutral-500 text-sm">
            {searchQuery ? "No matches" : "Clipboard is empty"}
          </div>
        )}
        {filtered.map((entry) => (
          <ClipboardEntryRow
            key={entry.id}
            entry={entry}
            isCopied={copiedId === entry.id}
            onCopy={handleCopy}
            onPin={handlePin}
            onDelete={handleDelete}
          />
        ))}
      </div>
    </WindowChrome>
  );
}

function ClipboardEntryRow({
  entry,
  isCopied,
  onCopy,
  onPin,
  onDelete,
}: {
  entry: ClipboardEntry;
  isCopied: boolean;
  onCopy: (entry: ClipboardEntry) => void;
  onPin: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isMultiline = entry.content.includes("\n");
  const lineCount = entry.content.split("\n").length;

  return (
    <div
      className={cn(
        "group relative rounded-lg px-2 py-2 mx-1",
        "border transition-colors duration-150 cursor-pointer",
        isCopied
          ? "border-emerald-500/60"
          : entry.pinned
            ? "border-blue-500/50 hover:border-blue-400/60 hover:bg-neutral-800/40"
            : "border-neutral-700/40 hover:border-neutral-600/50 hover:bg-neutral-800/40",
      )}
      onClick={() => onCopy(entry)}
    >
      {/* Preview */}
      <div className="rounded bg-neutral-800/60 p-2">
        <div className="text-[11px] leading-[1.4] text-neutral-300 whitespace-pre-wrap break-words line-clamp-3">
          {entry.preview || entry.content.slice(0, 200)}
        </div>
      </div>

      {/* Metadata row */}
      <div className="mt-1 flex items-center gap-2 text-[10px] text-neutral-500">
        <span>{timeAgo(entry.copiedAt)}</span>
        {isMultiline && <span>{lineCount} lines</span>}
        {entry.content.length > 200 && (
          <span>{entry.content.length.toLocaleString()} chars</span>
        )}
      </div>

      {/* Action buttons — bottom right, visible on hover (pin always visible when pinned) */}
      <div className="absolute right-2 bottom-2 flex gap-1">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onPin(entry.id); }}
          className={cn(
            "flex h-5 w-5 items-center justify-center rounded transition-colors",
            entry.pinned
              ? "text-blue-400 hover:text-blue-300"
              : "text-neutral-500 hover:text-blue-400 hidden group-hover:flex",
          )}
          title={entry.pinned ? "Unpin" : "Pin"}
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill={entry.pinned ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M12 17v5" />
            <path d="M9 2h6l-1.5 5H18l-1 4H7l-1-4h3.5z" />
          </svg>
        </button>
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDelete(entry.id); }}
          className="flex h-5 w-5 items-center justify-center rounded text-neutral-500 hover:text-red-400 transition-colors"
          title="Delete"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6h18" />
            <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
            <line x1="10" y1="11" x2="10" y2="17" />
            <line x1="14" y1="11" x2="14" y2="17" />
          </svg>
        </button>
      </div>
    </div>
  );
}
