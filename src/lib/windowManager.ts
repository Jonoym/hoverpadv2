import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { currentMonitor } from "@tauri-apps/api/window";
import { PhysicalPosition, PhysicalSize, LogicalPosition } from "@tauri-apps/api/dpi";
import { emitEvent } from "./events";
import { loadWindowState, type WindowState } from "./windowState";
import { getDatabase } from "./database";
import { getMonitors, monitorByName, monitorAt } from "./monitorUtils";
import { getClipboardWindowState } from "./settingsService";

/** Default logical size for new windows (no saved state). */
const DEFAULT_WIDTH = 600;
const DEFAULT_HEIGHT = 800;

/**
 * Resolves the base URL for new windows.
 * In dev mode this is the Vite dev server; in production it's the bundled dist.
 */
function getBaseUrl(): string {
  // In dev, window.location is the Vite dev server origin.
  // In production (tauri://), we use the same origin.
  return window.location.origin;
}

/**
 * Validate a saved window position against current monitor bounds.
 *
 * Strategy:
 * 1. If the saved position is still on-screen, use it as-is.
 * 2. If the saved monitor name matches a current monitor, translate the
 *    window's relative position to that monitor (handles monitor rearrangement).
 * 3. Otherwise, center on the primary monitor.
 */
async function validateWindowState(
  state: WindowState,
): Promise<WindowState> {
  try {
    const monitors = await getMonitors();
    if (monitors.length === 0) return state;

    // 1. Check if position is still on-screen — use as-is
    const currentMon = monitorAt(monitors, state.x, state.y);
    if (currentMon) return state;

    // 2. Try to find the saved monitor by name and translate position
    if (state.monitorName) {
      const savedMon = monitorByName(monitors, state.monitorName);
      if (savedMon) {
        // Clamp within the target monitor bounds
        const x = Math.max(
          savedMon.x,
          Math.min(savedMon.x + savedMon.width - state.width, state.x),
        );
        const y = Math.max(
          savedMon.y,
          Math.min(savedMon.y + savedMon.height - state.height, state.y),
        );
        return { ...state, x, y };
      }
    }

    // 3. Off-screen and monitor not found — center on primary
    const primary = monitors[0]!;
    return {
      ...state,
      x: primary.x + Math.round((primary.width - state.width) / 2),
      y: primary.y + Math.round((primary.height - state.height) / 2),
    };
  } catch {
    return state;
  }
}

interface WindowConfig {
  label: string;
  url: string;
  /** Default logical width (falls back to DEFAULT_WIDTH). */
  width?: number;
  /** Default logical height (falls back to DEFAULT_HEIGHT). */
  height?: number;
  minWidth?: number;
  minHeight?: number;
  windowType: "note" | "session" | "session-group" | "logfile" | "clipboard" | "notifications";
  savedState?: WindowState | null;
}

/** Track in-flight window creations to prevent duplicate concurrent calls. */
const pendingWindows = new Set<string>();

async function createWindow(config: WindowConfig): Promise<void> {
  const { label, url, width = DEFAULT_WIDTH, height = DEFAULT_HEIGHT, minWidth, minHeight, windowType } = config;
  let { savedState } = config;

  // Guard: already being created by a concurrent call
  if (pendingWindows.has(label)) return;

  // Check if window already exists; if so, focus it and flash the title bar
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    await emitEvent("window:flash", { label });
    return;
  }

  // Validate saved position against current monitor layout
  if (savedState) {
    savedState = await validateWindowState(savedState);
  }

  pendingWindows.add(label);

  // Wrap creation in a promise that resolves once the window is fully created,
  // so callers can safely await before creating the next window.
  const finalSavedState = savedState;
  try {
    await new Promise<void>((resolve, reject) => {
      const webview = new WebviewWindow(label, {
        url,
        width,
        height,
        minWidth,
        minHeight,
        transparent: true,
        decorations: false,
        shadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        maximizable: false,
        title: `Hoverpad - ${windowType} ${label}`,
      });

      webview.once("tauri://created", async () => {
        try {
          if (finalSavedState) {
            // Enforce minimum dimensions — saved state may be smaller than current minimums
            const scale = (await currentMonitor())?.scaleFactor ?? 1;
            const minW = minWidth ? Math.round(minWidth * scale) : 0;
            const minH = minHeight ? Math.round(minHeight * scale) : 0;
            const w = Math.max(finalSavedState.width, minW);
            const h = Math.max(finalSavedState.height, minH);
            await webview.setSize(new PhysicalSize(w, h));
            await webview.setPosition(new PhysicalPosition(finalSavedState.x, finalSavedState.y));
          } else {
            const monitor = await currentMonitor();
            if (monitor) {
              const scale = monitor.scaleFactor;
              const screenW = monitor.size.width / scale;
              const screenH = monitor.size.height / scale;
              const monX = monitor.position.x / scale;
              const monY = monitor.position.y / scale;
              const cx = Math.round(monX + (screenW - DEFAULT_WIDTH) / 2);
              const cy = Math.round(monY + (screenH - DEFAULT_HEIGHT) / 2);
              await webview.setPosition(new PhysicalPosition(cx * scale, cy * scale));
            }
          }
        } catch (err) {
          console.error(`[hoverpad] Failed to position window ${label}:`, err);
        }
        await emitEvent("window:opened", { label, windowType });
        resolve();
      });

      webview.once("tauri://error", (e) => {
        console.error(`Failed to create window ${label}:`, e);
        reject(e);
      });
    });
  } finally {
    pendingWindows.delete(label);
  }
}

/**
 * Create a new note window.
 * Loads saved window state (position/size) from SQLite if available.
 */
export async function createNoteWindow(noteId: string): Promise<void> {
  const label = `note-${noteId}`;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/note/${noteId}`;

  // Load saved window state from database
  const savedState = await loadWindowState(noteId, "notes");

  await createWindow({
    label,
    url,
    minWidth: 300,
    minHeight: 250,
    windowType: "note",
    savedState,
  });
}

/**
 * Create a new session-group window showing all sessions for a project directory.
 */
export async function createSessionGroupWindow(projectDir: string): Promise<void> {
  const encoded = encodeURIComponent(projectDir);
  // Tauri labels must be alphanumeric + hyphens/underscores
  const safeLabel = projectDir.replace(/[^a-zA-Z0-9-]/g, "_").slice(0, 60);
  const label = `sg-${safeLabel}`;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/session-group/project/${encoded}`;

  // Look up group ID to load saved window state
  let savedState: WindowState | null = null;
  try {
    const db = await getDatabase();
    const rows = await db.select<{ id: string }[]>(
      "SELECT id FROM session_groups WHERE group_type = 'project' AND project_dir = $1",
      [projectDir],
    );
    if (rows.length > 0) {
      savedState = await loadWindowState(rows[0]!.id, "session_groups");
    }
  } catch {
    // best effort
  }

  await createWindow({
    label,
    url,
    width: 300,
    height: 500,
    minWidth: 250,
    minHeight: 200,
    windowType: "session-group",
    savedState,
  });
}

/**
 * Create a new window showing sessions for a custom (manual) group.
 */
export async function createCustomGroupWindow(groupId: string): Promise<void> {
  const label = `session-group-custom-${groupId}`;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/session-group/custom/${groupId}`;

  const savedState = await loadWindowState(groupId, "session_groups");

  await createWindow({
    label,
    url,
    width: 300,
    height: 500,
    minWidth: 250,
    minHeight: 200,
    windowType: "session-group",
    savedState,
  });
}

/**
 * Create a new session window.
 * Loads saved window state (position/size) from SQLite if available.
 */
/**
 * Create a window for viewing an arbitrary log file.
 */
export async function createLogFileWindow(logFileId: string): Promise<void> {
  const label = `logfile-${logFileId}`;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/log-file/${logFileId}`;

  const savedState = await loadWindowState(logFileId, "log_files");

  await createWindow({
    label,
    url,
    minWidth: 350,
    minHeight: 300,
    windowType: "logfile",
    savedState,
  });
}

export async function createSessionWindow(sessionId: string): Promise<void> {
  const label = `session-${sessionId}`;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/session/${sessionId}`;

  // Load saved window state from database
  const savedState = await loadWindowState(sessionId, "sessions");

  await createWindow({
    label,
    url,
    minWidth: 350,
    minHeight: 300,
    windowType: "session",
    savedState,
  });
}

/**
 * Create (or focus) the singleton clipboard history window.
 */
export async function createClipboardWindow(): Promise<void> {
  const label = "clipboard";
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/clipboard`;

  // Load saved window state from settings
  const saved = await getClipboardWindowState();
  const savedState: WindowState | null = saved
    ? { x: saved.x, y: saved.y, width: saved.width, height: saved.height }
    : null;

  await createWindow({
    label,
    url,
    width: 400,
    height: 600,
    minWidth: 300,
    minHeight: 400,
    windowType: "clipboard",
    savedState,
  });
}

const NOTIF_WIDTH = 340;
const NOTIF_HEIGHT = 200;

/**
 * Create (or focus) the singleton notification overlay window.
 * Positioned at bottom-right of the primary monitor. Transparent, frameless,
 * always-on-top, click-through by default (the window manages its own cursor events).
 */
export async function createNotificationWindow(): Promise<void> {
  const label = "notifications";

  // Don't duplicate
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) return;
  if (pendingWindows.has(label)) return;
  pendingWindows.add(label);

  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/notifications`;

  try {
    await new Promise<void>((resolve, reject) => {
      const webview = new WebviewWindow(label, {
        url,
        width: NOTIF_WIDTH,
        height: NOTIF_HEIGHT,
        transparent: true,
        decorations: false,
        shadow: false,
        alwaysOnTop: true,
        skipTaskbar: true,
        maximizable: false,
        resizable: false,
        title: "Hoverpad Notifications",
      });

      webview.once("tauri://created", async () => {
        try {
          // Position at bottom-right of primary monitor
          const monitor = await currentMonitor();
          if (monitor) {
            const scale = monitor.scaleFactor;
            const screenW = monitor.size.width / scale;
            const screenH = monitor.size.height / scale;
            const x = screenW - NOTIF_WIDTH - 8;
            const y = screenH - NOTIF_HEIGHT - 60;
            await webview.setPosition(new LogicalPosition(x, y));
          }
          // Start click-through — the window toggles this when toasts appear
          await webview.setIgnoreCursorEvents(true);
        } catch (err) {
          console.error("[hoverpad] Failed to position notification window:", err);
        }
        resolve();
      });

      webview.once("tauri://error", (e) => {
        console.error("Failed to create notification window:", e);
        reject(e);
      });
    });
  } finally {
    pendingWindows.delete(label);
  }
}
