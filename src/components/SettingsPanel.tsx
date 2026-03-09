import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { cn } from "@/lib/utils";
import {
  getHotkeyBindings,
  getDefaultHotkeys,
  saveHotkeyBinding,
  resetHotkeyBinding,
  resetAllHotkeys,
} from "@/lib/settingsService";
import {
  keyEventToShortcutString,
  formatShortcutDisplay,
  ACTION_LABELS,
} from "@/lib/hotkeyUtils";

export function SettingsPanel() {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [capturingAction, setCapturingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const defaults = getDefaultHotkeys();

  const loadBindings = useCallback(async () => {
    try {
      const b = await getHotkeyBindings();
      setBindings(b);
    } catch (err) {
      console.error("[hoverpad] Failed to load hotkey bindings:", err);
    }
  }, []);

  useEffect(() => {
    void loadBindings();
  }, [loadBindings]);

  // Temporarily unregister all global hotkeys while capturing, so the OS-level
  // shortcuts don't fire and steal the key combo from our capture handler.
  // Re-register them when capture ends (success, cancel, or cleanup).
  useEffect(() => {
    if (!capturingAction) return;

    // Tracks whether the handler already re-registered hotkeys
    let captureHandled = false;

    // Unregister all current bindings so they don't intercept the key press
    const suspendedBindings = { ...bindings };
    (async () => {
      for (const shortcut of Object.values(suspendedBindings)) {
        if (shortcut) {
          try {
            await invoke("unregister_hotkey", { shortcutStr: shortcut });
          } catch {
            // may already be unregistered
          }
        }
      }
    })();

    // Re-register all bindings (called on cancel/cleanup)
    const reregisterAll = async (currentBindings: Record<string, string>) => {
      for (const [action, shortcut] of Object.entries(currentBindings)) {
        if (shortcut) {
          try {
            await invoke("register_hotkey", { action, shortcutStr: shortcut });
          } catch {
            // best effort — may already be registered
          }
        }
      }
    };

    const handler = async (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Escape cancels capture
      if (e.key === "Escape") {
        captureHandled = true;
        await reregisterAll(suspendedBindings);
        setCapturingAction(null);
        setError(null);
        return;
      }

      const shortcut = keyEventToShortcutString(e);
      if (!shortcut) return; // modifier-only press, keep listening

      // Check for conflicts with other actions
      for (const [action, bound] of Object.entries(bindings)) {
        if (action !== capturingAction && bound === shortcut) {
          setError(
            `"${shortcut}" is already used by "${ACTION_LABELS[action] ?? action}"`,
          );
          return;
        }
      }

      setError(null);

      try {
        // Save to database
        await saveHotkeyBinding(capturingAction!, shortcut);

        // Build the new bindings map and re-register all of them
        captureHandled = true;
        const newBindings = { ...suspendedBindings, [capturingAction!]: shortcut };
        await reregisterAll(newBindings);

        // Update local state
        const action = capturingAction!;
        setBindings((prev) => ({ ...prev, [action]: shortcut }));
        setCapturingAction(null);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setError(`Failed to set hotkey: ${msg}`);
        // Re-register old bindings on failure
        captureHandled = true;
        await reregisterAll(suspendedBindings);
        setCapturingAction(null);
      }
    };

    window.addEventListener("keydown", handler);
    return () => {
      window.removeEventListener("keydown", handler);
      // Only re-register if the handler didn't already handle it
      if (!captureHandled) {
        void reregisterAll(suspendedBindings);
      }
    };
  }, [capturingAction, bindings]);

  const handleReset = async (action: string) => {
    try {
      // Unregister current (non-fatal — may already be unregistered)
      const current = bindings[action];
      if (current) {
        try {
          await invoke("unregister_hotkey", { shortcutStr: current });
        } catch {
          // already unregistered — continue
        }
      }

      // Register default
      const defaultShortcut = defaults[action];
      if (defaultShortcut) {
        try {
          await invoke("register_hotkey", {
            action,
            shortcutStr: defaultShortcut,
          });
        } catch {
          // may already be registered
        }
      }

      // Remove custom from database
      await resetHotkeyBinding(action);

      // Update local state
      if (defaultShortcut) {
        setBindings((prev) => ({ ...prev, [action]: defaultShortcut }));
      }
    } catch (err) {
      console.error("[hoverpad] Failed to reset hotkey:", err);
    }
  };

  const handleResetAll = async () => {
    try {
      // Unregister all current bindings (non-fatal individually)
      for (const [action, shortcut] of Object.entries(bindings)) {
        if (shortcut) {
          try {
            await invoke("unregister_hotkey", { shortcutStr: shortcut });
          } catch {
            // already unregistered — continue
          }
        }
        // Register defaults
        const defaultShortcut = defaults[action];
        if (defaultShortcut) {
          try {
            await invoke("register_hotkey", {
              action,
              shortcutStr: defaultShortcut,
            });
          } catch {
            // may already be registered
          }
        }
      }

      await resetAllHotkeys();
      setBindings({ ...defaults });
    } catch (err) {
      console.error("[hoverpad] Failed to reset all hotkeys:", err);
    }
  };

  const actions = Object.keys(defaults);

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-zinc-100">
        Keyboard Shortcuts
      </h2>

      <div className="flex flex-col gap-1">
        {actions.map((action) => {
          const isCapturing = capturingAction === action;
          const shortcut = bindings[action] ?? defaults[action] ?? "";
          const isCustom = shortcut !== defaults[action];

          return (
            <div
              key={action}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2",
                "border border-zinc-700/50",
                isCapturing ? "bg-zinc-800/80" : "bg-zinc-900/50",
              )}
            >
              <span className="text-sm text-zinc-300">
                {ACTION_LABELS[action] ?? action}
              </span>

              <div className="flex items-center gap-2">
                {isCapturing ? (
                  <span className="text-xs text-amber-400 animate-pulse">
                    Press a key combo... (Esc to cancel)
                  </span>
                ) : (
                  <kbd
                    className={cn(
                      "rounded border px-2 py-0.5 font-mono text-xs",
                      isCustom
                        ? "border-blue-500/40 bg-blue-600/15 text-blue-300"
                        : "border-zinc-600 bg-zinc-800 text-zinc-300",
                    )}
                  >
                    {formatShortcutDisplay(shortcut)}
                  </kbd>
                )}

                {!isCapturing && (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setCapturingAction(action);
                        setError(null);
                      }}
                      className="rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-zinc-200"
                    >
                      Change
                    </button>
                    {isCustom && (
                      <button
                        type="button"
                        onClick={() => void handleReset(action)}
                        className="rounded px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-zinc-700/50 hover:text-zinc-300"
                      >
                        Reset
                      </button>
                    )}
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {error && (
        <p className="text-xs text-red-400">{error}</p>
      )}

      <div className="flex justify-end">
        <button
          type="button"
          onClick={() => void handleResetAll()}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium",
            "border border-zinc-700 bg-zinc-800 text-zinc-400",
            "transition-colors hover:bg-zinc-700 hover:text-zinc-200",
          )}
        >
          Reset All to Defaults
        </button>
      </div>
    </div>
  );
}
