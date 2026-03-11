import { getDatabase } from "./database";

export interface HotkeyBinding {
  action: string;
  shortcut: string; // e.g. "Ctrl+N"
}

const DEFAULT_HOTKEYS: Record<string, string> = {
  "new-note": "Ctrl+N",
  "toggle-visibility": "Ctrl+H",
  "toggle-collapse": "Ctrl+J",
  "hide-children": "Ctrl+Shift+D",
  "opacity-decrease": "Ctrl+,",
  "opacity-increase": "Ctrl+.",
  "toggle-clipboard": "Ctrl+Shift+V",
  "reopen-last-closed": "Ctrl+Shift+T",
  "workspace-1": "Ctrl+Shift+1",
  "workspace-2": "Ctrl+Shift+2",
  "workspace-3": "Ctrl+Shift+3",
  "workspace-4": "Ctrl+Shift+4",
  "workspace-5": "Ctrl+Shift+5",
};

export async function getSetting(key: string): Promise<string | null> {
  const db = await getDatabase();
  const rows = await db.select<{ value: string }[]>(
    "SELECT value FROM settings WHERE key = $1",
    [key],
  );
  return rows.length > 0 ? (rows[0]?.value ?? null) : null;
}

export async function setSetting(key: string, value: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = $2",
    [key, value],
  );
}

export async function deleteSetting(key: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM settings WHERE key = $1", [key]);
}

export function getDefaultHotkeys(): Record<string, string> {
  return { ...DEFAULT_HOTKEYS };
}

export async function getHotkeyBindings(): Promise<Record<string, string>> {
  const bindings = { ...DEFAULT_HOTKEYS };
  for (const action of Object.keys(DEFAULT_HOTKEYS)) {
    const custom = await getSetting(`hotkey:${action}`);
    if (custom) bindings[action] = custom;
  }
  return bindings;
}

export async function saveHotkeyBinding(
  action: string,
  shortcut: string,
): Promise<void> {
  await setSetting(`hotkey:${action}`, shortcut);
}

export async function resetHotkeyBinding(action: string): Promise<void> {
  await deleteSetting(`hotkey:${action}`);
}

export async function resetAllHotkeys(): Promise<void> {
  for (const action of Object.keys(DEFAULT_HOTKEYS)) {
    await deleteSetting(`hotkey:${action}`);
  }
}

// ---------------------------------------------------------------------------
// Clipboard window state persistence (singleton, uses settings table)
// ---------------------------------------------------------------------------

export async function getClipboardWindowOpen(): Promise<boolean> {
  const val = await getSetting("clipboard:is_open");
  return val === "1";
}

export async function setClipboardWindowOpen(open: boolean): Promise<void> {
  await setSetting("clipboard:is_open", open ? "1" : "0");
}

export async function getClipboardWindowState(): Promise<{
  x: number;
  y: number;
  width: number;
  height: number;
} | null> {
  const val = await getSetting("clipboard:window_state");
  if (!val) return null;
  try {
    return JSON.parse(val);
  } catch {
    return null;
  }
}

export async function saveClipboardWindowState(): Promise<void> {
  const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
  const win = getCurrentWebviewWindow();
  const pos = await win.outerPosition();
  const size = await win.innerSize();
  await setSetting(
    "clipboard:window_state",
    JSON.stringify({ x: pos.x, y: pos.y, width: size.width, height: size.height }),
  );
}
