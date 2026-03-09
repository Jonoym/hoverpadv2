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
