import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { cn } from "@/lib/utils";
import { listenEvent } from "@/lib/events";
import { createSessionWindow } from "@/lib/windowManager";

interface Toast {
  id: string;
  sessionId: string;
  label: string;
  status: "completed" | "errored";
  timestamp: number;
}

const TOAST_DURATION = 5000;
const MAX_TOASTS = 4;

/**
 * Standalone notification window. Transparent background, no chrome.
 * Shows toast notifications when Claude Code sessions complete or error.
 * Manages its own click-through state (transparent = click-through).
 *
 * Listens for "session:notify" events emitted by SessionWindow when a
 * session transitions to completed/errored. This is event-driven (no
 * polling, no store watching) so it works reliably across window contexts.
 */
export function NotificationWindow() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const appWindow = useRef(getCurrentWebviewWindow());

  // Override global opacity — this window is always fully visible
  useEffect(() => {
    document.documentElement.style.opacity = "1";
  });

  // Toggle click-through based on whether there are toasts
  useEffect(() => {
    const hasToasts = toasts.length > 0;
    appWindow.current.setIgnoreCursorEvents(!hasToasts).catch(console.error);
  }, [toasts.length]);

  // Listen for session completion/error events
  useEffect(() => {
    const unlisten = listenEvent("session:notify", (e) => {
      const { sessionId, label, status } = e.payload;
      setToasts((prev) => [
        ...prev.slice(-(MAX_TOASTS - 1)),
        {
          id: `${sessionId}-${Date.now()}`,
          sessionId,
          label,
          status,
          timestamp: Date.now(),
        },
      ]);
    });
    return () => { unlisten.then((fn) => fn()).catch(console.error); };
  }, []);

  // Tick for fade animation + auto-dismiss expired toasts
  const [, setTick] = useState(0);
  useEffect(() => {
    if (toasts.length === 0) return;
    const timer = setInterval(() => {
      setToasts((prev) =>
        prev.filter((t) => Date.now() - t.timestamp < TOAST_DURATION),
      );
      setTick((t) => t + 1); // Force re-render for smooth fade
    }, 100);
    return () => clearInterval(timer);
  }, [toasts.length > 0]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const handleClick = useCallback((toast: Toast) => {
    // Focus/flash the session window (creates it if not open)
    createSessionWindow(toast.sessionId).catch(console.error);
    dismissToast(toast.id);
  }, [dismissToast]);

  // Transparent container — no background, no chrome
  return (
    <div className="flex h-screen w-screen flex-col items-end justify-end p-1 gap-2 overflow-hidden">
      {toasts.map((toast) => (
        <SessionToast
          key={toast.id}
          label={toast.label}
          status={toast.status}
          age={Math.min(1, (Date.now() - toast.timestamp) / TOAST_DURATION)}
          onClick={() => handleClick(toast)}
          onDismiss={() => dismissToast(toast.id)}
        />
      ))}
    </div>
  );
}

function SessionToast({
  label,
  status,
  onClick,
  onDismiss,
  age,
}: {
  label: string;
  status: "completed" | "errored";
  onClick: () => void;
  onDismiss: () => void;
  /** 0..1 progress toward expiry (0 = just appeared, 1 = about to dismiss) */
  age: number;
}) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setVisible(true));
  }, []);

  const isCompleted = status === "completed";
  // Start fading out in the last 30% of the toast lifetime
  const fadeOpacity = age > 0.7 ? Math.max(0, 1 - (age - 0.7) / 0.3) : 1;

  return (
    <div
      onClick={onClick}
      style={{ opacity: visible ? fadeOpacity : 0 }}
      className={cn(
        "w-72 rounded-2xl border px-4 py-2.5 shadow-2xl backdrop-blur-md cursor-pointer",
        "bg-neutral-900/90 border-neutral-700/50",
        "transition-transform duration-300 ease-out",
        "hover:bg-neutral-800/90 hover:border-neutral-600/60",
        visible ? "translate-x-0" : "translate-x-8",
      )}
    >
      <div className="flex items-center gap-2.5">
        {/* Status dot */}
        <span
          className={cn(
            "h-2 w-2 shrink-0 rounded-full",
            isCompleted ? "bg-purple-400" : "bg-red-400",
          )}
        />

        {/* Content */}
        <div className="min-w-0 flex-1">
          <div className="text-xs font-medium text-neutral-400">
            Session {status}
          </div>
          <div className="mt-0.5 truncate text-sm text-neutral-300">
            {label}
          </div>
        </div>

        {/* Dismiss */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onDismiss(); }}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-neutral-500 transition-colors hover:text-neutral-300 cursor-pointer"
        >
          <svg width="8" height="8" viewBox="0 0 10 10" fill="none">
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
  );
}
