import { useCallback, useEffect, useRef, useState } from "react";
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
import {
  getMonitors,
  monitorLabel,
  sendAllWindowsToMonitor,
  sendControlPanelToMonitor,
  type MonitorInfo,
} from "@/lib/monitorUtils";
import {
  listWorkspaceProfiles,
  captureWorkspace,
  restoreWorkspace,
  deleteWorkspaceProfile,
  renameWorkspaceProfile,
  getAllSlotAssignments,
  setSlotProfileId,
  MAX_WORKSPACE_SLOTS,
} from "@/lib/workspaceService";

export function SettingsPanel() {
  const [bindings, setBindings] = useState<Record<string, string>>({});
  const [capturingAction, setCapturingAction] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [monitorBusy, setMonitorBusy] = useState<number | null>(null);

  // Workspace profiles state
  const [profiles, setProfiles] = useState<{ id: string; name: string; createdAt: string }[]>([]);
  const [newProfileName, setNewProfileName] = useState("");
  const [savingProfile, setSavingProfile] = useState(false);
  const [restoringProfile, setRestoringProfile] = useState<string | null>(null);
  const [renamingProfile, setRenamingProfile] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const renameInputRef = useRef<HTMLInputElement>(null);
  const [slotAssignments, setSlotAssignments] = useState<Record<number, string>>({});

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

  // Load available monitors
  const loadMonitors = useCallback(async () => {
    try {
      const m = await getMonitors();
      setMonitors(m);
    } catch (err) {
      console.error("[hoverpad] Failed to load monitors:", err);
    }
  }, []);

  useEffect(() => {
    void loadMonitors();
  }, [loadMonitors]);

  // Load workspace profiles and slot assignments
  const loadProfiles = useCallback(async () => {
    try {
      const [p, slots] = await Promise.all([
        listWorkspaceProfiles(),
        getAllSlotAssignments(),
      ]);
      setProfiles(p);
      setSlotAssignments(slots);
    } catch (err) {
      console.error("[hoverpad] Failed to load workspace profiles:", err);
    }
  }, []);

  useEffect(() => {
    void loadProfiles();
  }, [loadProfiles]);

  // Focus rename input when entering rename mode
  useEffect(() => {
    if (renamingProfile && renameInputRef.current) {
      renameInputRef.current.focus();
      renameInputRef.current.select();
    }
  }, [renamingProfile]);

  const handleSaveProfile = async () => {
    const name = newProfileName.trim();
    if (!name) return;
    setSavingProfile(true);
    try {
      await captureWorkspace(name);
      setNewProfileName("");
      await loadProfiles();
    } catch (err) {
      console.error("[hoverpad] Failed to save workspace profile:", err);
    }
    setSavingProfile(false);
  };

  const handleRestoreProfile = async (id: string) => {
    setRestoringProfile(id);
    try {
      await restoreWorkspace(id);
    } catch (err) {
      console.error("[hoverpad] Failed to restore workspace:", err);
    }
    setRestoringProfile(null);
  };

  const handleDeleteProfile = async (id: string) => {
    try {
      await deleteWorkspaceProfile(id);
      await loadProfiles();
    } catch (err) {
      console.error("[hoverpad] Failed to delete workspace profile:", err);
    }
  };

  const handleSlotChange = async (profileId: string, slot: number | null) => {
    try {
      // Clear any existing assignment for this profile
      for (const [s, pid] of Object.entries(slotAssignments)) {
        if (pid === profileId) {
          await setSlotProfileId(Number(s), null);
        }
      }
      // Assign the new slot
      if (slot !== null) {
        // Clear existing profile in this slot
        await setSlotProfileId(slot, profileId);
      }
      await loadProfiles();
    } catch (err) {
      console.error("[hoverpad] Failed to update slot assignment:", err);
    }
  };

  const handleRenameProfile = async (id: string) => {
    const name = renameValue.trim();
    if (!name) {
      setRenamingProfile(null);
      return;
    }
    try {
      await renameWorkspaceProfile(id, name);
      setRenamingProfile(null);
      await loadProfiles();
    } catch (err) {
      console.error("[hoverpad] Failed to rename workspace profile:", err);
    }
  };

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

      {/* ------------------------------------------------------------------ */}
      {/* Multi-Monitor                                                       */}
      {/* ------------------------------------------------------------------ */}
      {monitors.length > 1 && (
        <>
          <div className="mt-2 border-t border-zinc-700/50 pt-4">
            <h2 className="text-sm font-semibold text-zinc-100">
              Monitors
            </h2>
            <p className="mt-1 text-xs text-zinc-500">
              Send all open windows to a monitor.
            </p>
          </div>

          <div className="flex flex-col gap-1">
            {monitors.map((mon, i) => (
              <div
                key={mon.name ?? i}
                className={cn(
                  "flex items-center justify-between rounded-lg px-3 py-2",
                  "border border-zinc-700/50 bg-zinc-900/50",
                )}
              >
                <div className="flex flex-col">
                  <span className="text-sm text-zinc-300">
                    {monitorLabel(mon, i)}
                  </span>
                  <span className="text-xs text-zinc-500">
                    {Math.round(mon.width / mon.scaleFactor)} &times; {Math.round(mon.height / mon.scaleFactor)}
                    {mon.scaleFactor !== 1 && ` (${Math.round(mon.scaleFactor * 100)}% scale)`}
                  </span>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    disabled={monitorBusy !== null}
                    onClick={async () => {
                      setMonitorBusy(i);
                      try {
                        await sendAllWindowsToMonitor(mon);
                        await sendControlPanelToMonitor(mon);
                      } catch (err) {
                        console.error("[hoverpad] Failed to move windows:", err);
                      }
                      setMonitorBusy(null);
                    }}
                    className={cn(
                      "rounded px-2 py-1 text-xs font-medium transition-colors",
                      "border border-zinc-600 bg-zinc-800 text-zinc-300",
                      monitorBusy === i
                        ? "opacity-50"
                        : "hover:bg-zinc-700 hover:text-zinc-100",
                    )}
                  >
                    {monitorBusy === i ? "Moving..." : "Send all here"}
                  </button>
                </div>
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => void loadMonitors()}
            className="self-end text-xs text-zinc-500 transition-colors hover:text-zinc-300"
          >
            Refresh monitors
          </button>
        </>
      )}

      {/* ------------------------------------------------------------------ */}
      {/* Workspace Profiles                                                  */}
      {/* ------------------------------------------------------------------ */}
      <div className="mt-2 border-t border-zinc-700/50 pt-4">
        <h2 className="text-sm font-semibold text-zinc-100">
          Workspace Profiles
        </h2>
        <p className="mt-1 text-xs text-zinc-500">
          Save and restore window arrangements.
        </p>
      </div>

      {/* Save new profile */}
      <div className="flex gap-2">
        <input
          type="text"
          value={newProfileName}
          onChange={(e) => setNewProfileName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") void handleSaveProfile();
          }}
          placeholder="Profile name..."
          className={cn(
            "flex-1 rounded-lg border border-zinc-700/50 bg-zinc-900/50 px-3 py-1.5",
            "text-sm text-zinc-200 placeholder-zinc-600",
            "outline-none focus:border-blue-500/50",
          )}
        />
        <button
          type="button"
          disabled={!newProfileName.trim() || savingProfile}
          onClick={() => void handleSaveProfile()}
          className={cn(
            "rounded-lg px-3 py-1.5 text-xs font-medium",
            "border border-zinc-600 bg-zinc-800 text-zinc-300",
            "transition-colors hover:bg-zinc-700 hover:text-zinc-100",
            "disabled:opacity-40 disabled:cursor-not-allowed",
          )}
        >
          {savingProfile ? "Saving..." : "Save Current"}
        </button>
      </div>

      {/* Profile list */}
      {profiles.length > 0 && (
        <div className="flex flex-col gap-1">
          {profiles.map((profile) => (
            <div
              key={profile.id}
              className={cn(
                "flex items-center justify-between rounded-lg px-3 py-2",
                "border border-zinc-700/50 bg-zinc-900/50",
              )}
            >
              <div className="flex flex-col min-w-0 flex-1">
                {renamingProfile === profile.id ? (
                  <input
                    ref={renameInputRef}
                    type="text"
                    value={renameValue}
                    onChange={(e) => setRenameValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void handleRenameProfile(profile.id);
                      if (e.key === "Escape") setRenamingProfile(null);
                    }}
                    onBlur={() => void handleRenameProfile(profile.id)}
                    className={cn(
                      "rounded border border-blue-500/50 bg-zinc-800 px-2 py-0.5",
                      "text-sm text-zinc-200 outline-none",
                    )}
                  />
                ) : (
                  <span className="text-sm text-zinc-300 truncate">
                    {profile.name}
                  </span>
                )}
                <span className="text-xs text-zinc-600">
                  {new Date(profile.createdAt).toLocaleDateString()}
                  {(() => {
                    const slot = Object.entries(slotAssignments).find(
                      ([, pid]) => pid === profile.id,
                    );
                    return slot ? ` · Ctrl+Shift+${slot[0]}` : "";
                  })()}
                </span>
              </div>

              <div className="flex items-center gap-1 ml-2 shrink-0">
                <select
                  value={
                    Object.entries(slotAssignments).find(
                      ([, pid]) => pid === profile.id,
                    )?.[0] ?? ""
                  }
                  onChange={(e) => {
                    const val = e.target.value;
                    void handleSlotChange(
                      profile.id,
                      val ? Number(val) : null,
                    );
                  }}
                  className={cn(
                    "rounded border border-zinc-700/50 bg-zinc-800 px-1 py-0.5",
                    "text-xs text-zinc-400 outline-none cursor-pointer",
                    "hover:border-zinc-600 focus:border-blue-500/50",
                  )}
                  title="Assign to hotkey slot"
                >
                  <option value="">Slot</option>
                  {Array.from({ length: MAX_WORKSPACE_SLOTS }, (_, i) => i + 1).map(
                    (slot) => {
                      const taken =
                        slotAssignments[slot] &&
                        slotAssignments[slot] !== profile.id;
                      return (
                        <option key={slot} value={slot} disabled={!!taken}>
                          {slot}{taken ? " (used)" : ""}
                        </option>
                      );
                    },
                  )}
                </select>
                <button
                  type="button"
                  disabled={restoringProfile !== null}
                  onClick={() => void handleRestoreProfile(profile.id)}
                  className={cn(
                    "rounded px-2 py-0.5 text-xs font-medium transition-colors",
                    "text-blue-400 hover:bg-blue-500/15 hover:text-blue-300",
                    restoringProfile === profile.id && "opacity-50",
                  )}
                >
                  {restoringProfile === profile.id ? "Loading..." : "Restore"}
                </button>
                {renamingProfile !== profile.id && (
                  <button
                    type="button"
                    onClick={() => {
                      setRenamingProfile(profile.id);
                      setRenameValue(profile.name);
                    }}
                    className="rounded px-2 py-0.5 text-xs text-zinc-400 transition-colors hover:bg-zinc-700/50 hover:text-zinc-200"
                  >
                    Rename
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => void handleDeleteProfile(profile.id)}
                  className="rounded px-2 py-0.5 text-xs text-zinc-500 transition-colors hover:bg-red-500/15 hover:text-red-400"
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {profiles.length === 0 && (
        <p className="text-xs text-zinc-600">
          No saved profiles yet. Save your current window layout to get started.
        </p>
      )}
    </div>
  );
}
