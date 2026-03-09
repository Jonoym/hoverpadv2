export function keyEventToShortcutString(e: KeyboardEvent): string | null {
  // Ignore modifier-only presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const parts: string[] = [];
  if (e.ctrlKey) parts.push("Ctrl");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Must have at least one modifier
  if (parts.length === 0) return null;

  // Map key names
  const keyMap: Record<string, string> = {
    ",": ",",
    ".": ".",
    "/": "/",
    ";": ";",
    "'": "'",
    "[": "[",
    "]": "]",
    "\\": "\\",
    "`": "`",
    "-": "-",
    "=": "=",
    " ": "Space",
    ArrowUp: "Up",
    ArrowDown: "Down",
    ArrowLeft: "Left",
    ArrowRight: "Right",
  };

  const keyName =
    keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(keyName);

  return parts.join("+");
}

export function formatShortcutDisplay(shortcut: string): string {
  return shortcut; // Already human-readable
}

export const ACTION_LABELS: Record<string, string> = {
  "new-note": "New Note",
  "toggle-visibility": "Toggle Visibility",
  "toggle-collapse": "Toggle Control Panel",
  "hide-children": "Hide Children",
  "opacity-decrease": "Decrease Opacity",
  "opacity-increase": "Increase Opacity",
};
