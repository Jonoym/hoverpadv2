import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { getDatabase } from "./database";
import { getSetting, setSetting, deleteSetting } from "./settingsService";
import { getClipboardWindowOpen, setClipboardWindowOpen } from "./settingsService";
import {
  createNoteWindow,
  createSessionWindow,
  createSessionGroupWindow,
  createCustomGroupWindow,
  createLogFileWindow,
  createClipboardWindow,
} from "./windowManager";
import { setNoteOpen } from "./noteService";
import { setSessionOpen } from "./sessionService";
import { setLogFileOpen } from "./logFileService";
import type { WindowState } from "./windowState";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface WorkspaceWindowEntry {
  windowType: "note" | "session" | "session-group" | "logfile" | "clipboard";
  /** The entity ID (noteId, sessionId, groupId, logFileId). Absent for clipboard. */
  entityId?: string;
  /** For project session groups, the project directory path. */
  projectDir?: string;
  /** For custom session groups, the group ID. */
  groupId?: string;
  /** Saved window geometry. */
  windowState?: WindowState | null;
}

export interface WorkspaceControlPanelState {
  collapsed: boolean;
  view: string;
  expSize: { width: number; height: number };
  expPosition: { x: number; y: number } | null;
}

export interface WorkspaceProfile {
  id: string;
  name: string;
  createdAt: string;
  windows: WorkspaceWindowEntry[];
  controlPanel: WorkspaceControlPanelState | null;
}

// ---------------------------------------------------------------------------
// Settings key helpers
// ---------------------------------------------------------------------------

const PROFILE_PREFIX = "workspace_profile:";
const PROFILE_LIST_KEY = "workspace_profile_list";

function profileKey(id: string): string {
  return `${PROFILE_PREFIX}${id}`;
}

function generateId(): string {
  return `wp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

/** List all saved workspace profile summaries (id + name). */
export async function listWorkspaceProfiles(): Promise<
  { id: string; name: string; createdAt: string }[]
> {
  const raw = await getSetting(PROFILE_LIST_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw) as { id: string; name: string; createdAt: string }[];
  } catch {
    return [];
  }
}

/** Load a full workspace profile by ID. */
export async function loadWorkspaceProfile(
  id: string,
): Promise<WorkspaceProfile | null> {
  const raw = await getSetting(profileKey(id));
  if (!raw) return null;
  try {
    return JSON.parse(raw) as WorkspaceProfile;
  } catch {
    return null;
  }
}

/** Save (create or update) a workspace profile. */
async function saveWorkspaceProfile(profile: WorkspaceProfile): Promise<void> {
  // Save profile data
  await setSetting(profileKey(profile.id), JSON.stringify(profile));

  // Update the list index
  const list = await listWorkspaceProfiles();
  const idx = list.findIndex((p) => p.id === profile.id);
  const entry = {
    id: profile.id,
    name: profile.name,
    createdAt: profile.createdAt,
  };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    list.push(entry);
  }
  await setSetting(PROFILE_LIST_KEY, JSON.stringify(list));
}

/** Delete a workspace profile. */
export async function deleteWorkspaceProfile(id: string): Promise<void> {
  await deleteSetting(profileKey(id));

  const list = await listWorkspaceProfiles();
  const filtered = list.filter((p) => p.id !== id);
  await setSetting(PROFILE_LIST_KEY, JSON.stringify(filtered));
}

/** Rename a workspace profile. */
export async function renameWorkspaceProfile(
  id: string,
  newName: string,
): Promise<void> {
  const profile = await loadWorkspaceProfile(id);
  if (!profile) return;
  profile.name = newName;
  await saveWorkspaceProfile(profile);
}

// ---------------------------------------------------------------------------
// Capture current workspace
// ---------------------------------------------------------------------------

/** Snapshot the current workspace layout into a named profile. */
export async function captureWorkspace(name: string): Promise<WorkspaceProfile> {
  const db = await getDatabase();
  const windows: WorkspaceWindowEntry[] = [];

  // Open notes
  const noteRows = await db.select<{ id: string; window_state: string | null }[]>(
    "SELECT id, window_state FROM notes WHERE is_open = 1",
  );
  for (const row of noteRows) {
    windows.push({
      windowType: "note",
      entityId: row.id,
      windowState: row.window_state ? safeParseJSON(row.window_state) : null,
    });
  }

  // Open sessions
  const sessionRows = await db.select<{ id: string; window_state: string | null }[]>(
    "SELECT id, window_state FROM sessions WHERE is_open = 1",
  );
  for (const row of sessionRows) {
    windows.push({
      windowType: "session",
      entityId: row.id,
      windowState: row.window_state ? safeParseJSON(row.window_state) : null,
    });
  }

  // Open session groups
  const groupRows = await db.select<{
    id: string;
    group_type: string;
    project_dir: string | null;
    window_state: string | null;
  }[]>("SELECT id, group_type, project_dir, window_state FROM session_groups WHERE is_open = 1");
  for (const row of groupRows) {
    windows.push({
      windowType: "session-group",
      entityId: row.id,
      projectDir: row.project_dir ?? undefined,
      groupId: row.group_type === "manual" ? row.id : undefined,
      windowState: row.window_state ? safeParseJSON(row.window_state) : null,
    });
  }

  // Open log files
  const logRows = await db.select<{ id: string; window_state: string | null }[]>(
    "SELECT id, window_state FROM log_files WHERE is_open = 1",
  );
  for (const row of logRows) {
    windows.push({
      windowType: "logfile",
      entityId: row.id,
      windowState: row.window_state ? safeParseJSON(row.window_state) : null,
    });
  }

  // Clipboard
  const clipboardOpen = await getClipboardWindowOpen();
  if (clipboardOpen) {
    windows.push({ windowType: "clipboard" });
  }

  // Control panel state
  let controlPanel: WorkspaceControlPanelState | null = null;
  const cpRaw = await getSetting("control_panel_state");
  if (cpRaw) {
    try {
      controlPanel = JSON.parse(cpRaw) as WorkspaceControlPanelState;
    } catch {
      // ignore
    }
  }

  const profile: WorkspaceProfile = {
    id: generateId(),
    name,
    createdAt: new Date().toISOString(),
    windows,
    controlPanel,
  };

  await saveWorkspaceProfile(profile);
  return profile;
}

// ---------------------------------------------------------------------------
// Restore a workspace
// ---------------------------------------------------------------------------

/** Close all open child windows (everything except main and notifications). */
async function closeAllChildWindows(): Promise<void> {
  const allWindows = await WebviewWindow.getAll();
  for (const win of allWindows) {
    if (win.label === "main" || win.label === "notifications") continue;
    try {
      await win.destroy();
    } catch {
      // window may already be closed
    }
  }

  // Clear all is_open flags in the database
  const db = await getDatabase();
  await db.execute("UPDATE notes SET is_open = 0 WHERE is_open = 1");
  await db.execute("UPDATE sessions SET is_open = 0 WHERE is_open = 1");
  await db.execute("UPDATE session_groups SET is_open = 0 WHERE is_open = 1");
  await db.execute("UPDATE log_files SET is_open = 0 WHERE is_open = 1");
  await setClipboardWindowOpen(false);
}

/** Restore a workspace profile: close everything, then open the saved windows. */
export async function restoreWorkspace(profileId: string): Promise<boolean> {
  const profile = await loadWorkspaceProfile(profileId);
  if (!profile) return false;

  // Close all existing child windows
  await closeAllChildWindows();

  // Small delay to let windows finish closing
  await new Promise((r) => setTimeout(r, 200));

  // Write saved window states into the database so windowManager picks them up
  const db = await getDatabase();

  for (const entry of profile.windows) {
    if (entry.windowState && entry.entityId) {
      const stateJSON = JSON.stringify(entry.windowState);
      switch (entry.windowType) {
        case "note":
          await db.execute("UPDATE notes SET window_state = $1 WHERE id = $2", [stateJSON, entry.entityId]);
          break;
        case "session":
          await db.execute("UPDATE sessions SET window_state = $1 WHERE id = $2", [stateJSON, entry.entityId]);
          break;
        case "session-group":
          await db.execute("UPDATE session_groups SET window_state = $1 WHERE id = $2", [stateJSON, entry.entityId]);
          break;
        case "logfile":
          await db.execute("UPDATE log_files SET window_state = $1 WHERE id = $2", [stateJSON, entry.entityId]);
          break;
      }
    }
  }

  // Open windows sequentially to avoid label races
  for (const entry of profile.windows) {
    try {
      switch (entry.windowType) {
        case "note":
          if (entry.entityId) {
            await setNoteOpen(entry.entityId, true);
            await createNoteWindow(entry.entityId);
          }
          break;
        case "session":
          if (entry.entityId) {
            await setSessionOpen(entry.entityId, true);
            await createSessionWindow(entry.entityId);
          }
          break;
        case "session-group":
          if (entry.projectDir) {
            await createSessionGroupWindow(entry.projectDir);
          } else if (entry.groupId) {
            await createCustomGroupWindow(entry.groupId);
          }
          break;
        case "logfile":
          if (entry.entityId) {
            await setLogFileOpen(entry.entityId, true);
            await createLogFileWindow(entry.entityId);
          }
          break;
        case "clipboard":
          await createClipboardWindow();
          break;
      }
    } catch (err) {
      console.error(`[hoverpad] Failed to restore ${entry.windowType} window:`, err);
    }
  }

  // Restore control panel state if present
  if (profile.controlPanel) {
    await setSetting("control_panel_state", JSON.stringify(profile.controlPanel));
    // Apply control panel geometry
    await applyControlPanelState(profile.controlPanel);
  }

  return true;
}

// ---------------------------------------------------------------------------
// Slot assignments (hotkey slots 1-5)
// ---------------------------------------------------------------------------

export const MAX_WORKSPACE_SLOTS = 5;
const SLOT_PREFIX = "workspace_slot:";

function slotKey(slot: number): string {
  return `${SLOT_PREFIX}${slot}`;
}

/** Get the profile ID assigned to a slot (1-5), or null. */
export async function getSlotProfileId(slot: number): Promise<string | null> {
  return getSetting(slotKey(slot));
}

/** Assign a profile to a hotkey slot (1-5). Pass null to clear. */
export async function setSlotProfileId(
  slot: number,
  profileId: string | null,
): Promise<void> {
  if (profileId) {
    await setSetting(slotKey(slot), profileId);
  } else {
    await deleteSetting(slotKey(slot));
  }
}

/** Load all slot assignments as a map of slot → profileId. */
export async function getAllSlotAssignments(): Promise<Record<number, string>> {
  const assignments: Record<number, string> = {};
  for (let i = 1; i <= MAX_WORKSPACE_SLOTS; i++) {
    const id = await getSlotProfileId(i);
    if (id) assignments[i] = id;
  }
  return assignments;
}

/** Restore the workspace profile assigned to a slot. Returns false if no profile is assigned. */
export async function restoreSlot(slot: number): Promise<boolean> {
  const profileId = await getSlotProfileId(slot);
  if (!profileId) return false;
  return restoreWorkspace(profileId);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function safeParseJSON(raw: string): WindowState | null {
  try {
    return JSON.parse(raw) as WindowState;
  } catch {
    return null;
  }
}

async function applyControlPanelState(
  state: WorkspaceControlPanelState,
): Promise<void> {
  try {
    const { PhysicalSize, PhysicalPosition, LogicalSize, LogicalPosition } = await import("@tauri-apps/api/dpi");
    const appWindow = getCurrentWebviewWindow();
    const monitor = await currentMonitor();
    const scale = monitor?.scaleFactor ?? 1;

    if (state.collapsed) {
      const screenWidth = monitor?.size.width ?? 1920;
      const logicalScreenWidth = screenWidth / scale;
      const centerX = Math.round((logicalScreenWidth - 320) / 2);
      await appWindow.setSize(new LogicalSize(320, 50));
      await appWindow.setPosition(new LogicalPosition(centerX, 10));
    } else if (state.expSize) {
      await appWindow.setSize(
        new PhysicalSize(state.expSize.width, state.expSize.height),
      );
      if (state.expPosition) {
        await appWindow.setPosition(
          new PhysicalPosition(state.expPosition.x, state.expPosition.y),
        );
      }
    }
  } catch (err) {
    console.error("[hoverpad] Failed to apply control panel state:", err);
  }
}
