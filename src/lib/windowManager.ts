import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { emitEvent } from "./events";
import { loadWindowState, type WindowState } from "./windowState";

/** Counter to offset windows so they don't stack exactly. */
let windowCounter = 0;

/**
 * Resolves the base URL for new windows.
 * In dev mode this is the Vite dev server; in production it's the bundled dist.
 */
function getBaseUrl(): string {
  // In dev, window.location is the Vite dev server origin.
  // In production (tauri://), we use the same origin.
  return window.location.origin;
}

interface WindowConfig {
  label: string;
  url: string;
  width: number;
  height: number;
  windowType: "note" | "session";
  savedState?: WindowState | null;
}

async function createWindow(config: WindowConfig): Promise<void> {
  const { label, url, width, height, windowType, savedState } = config;

  // Check if window already exists; if so, focus it
  const existing = await WebviewWindow.getByLabel(label);
  if (existing) {
    await existing.setFocus();
    return;
  }

  // Use saved state if available, otherwise offset from the default position
  const offset = windowCounter * 30;
  windowCounter++;

  const webview = new WebviewWindow(label, {
    url,
    width: savedState?.width ?? width,
    height: savedState?.height ?? height,
    x: savedState?.x ?? 150 + offset,
    y: savedState?.y ?? 150 + offset,
    transparent: true,
    decorations: false,
    shadow: false,
    alwaysOnTop: true,
    title: `Hoverpad - ${windowType} ${label}`,
  });

  // Wait for the window to be created, then emit an event
  webview.once("tauri://created", async () => {
    await emitEvent("window:opened", { label, windowType });
  });

  webview.once("tauri://error", (e) => {
    console.error(`Failed to create window ${label}:`, e);
  });
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
    width: 400,
    height: 500,
    windowType: "note",
    savedState,
  });
}

/**
 * Create a new session window.
 * Loads saved window state (position/size) from SQLite if available.
 */
export async function createSessionWindow(sessionId: string): Promise<void> {
  const label = `session-${sessionId}`;
  const baseUrl = getBaseUrl();
  const url = `${baseUrl}/session/${sessionId}`;

  // Load saved window state from database
  const savedState = await loadWindowState(sessionId, "sessions");

  await createWindow({
    label,
    url,
    width: 400,
    height: 600,
    windowType: "session",
    savedState,
  });
}
