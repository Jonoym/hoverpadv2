export function keyEventToShortcutString(e: KeyboardEvent): string | null {
  // Ignore modifier-only presses
  if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return null;

  const isMac = navigator.platform.toUpperCase().includes("MAC");
  const parts: string[] = [];
  if (e.ctrlKey && !isMac) parts.push("Ctrl");
  if (e.metaKey && isMac) parts.push("Super");
  if (e.ctrlKey && isMac) parts.push("Ctrl");
  if (e.metaKey && !isMac) parts.push("Super");
  if (e.altKey) parts.push("Alt");
  if (e.shiftKey) parts.push("Shift");

  // Must have at least one modifier
  if (parts.length === 0) return null;

  // Map key names
  // Shifted number keys produce symbols — map them back to digits
  const shiftedDigits: Record<string, string> = {
    "!": "1", "@": "2", "#": "3", "$": "4", "%": "5",
    "^": "6", "&": "7", "*": "8", "(": "9", ")": "0",
  };
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
    ...shiftedDigits,
  };

  const keyName =
    keyMap[e.key] ?? (e.key.length === 1 ? e.key.toUpperCase() : e.key);
  parts.push(keyName);

  return parts.join("+");
}

export function formatShortcutDisplay(shortcut: string): string {
  const isMac = navigator.platform.toUpperCase().includes("MAC");
  if (!isMac) return shortcut;
  // Show Mac-friendly symbols
  return shortcut
    .replace(/Super\+/g, "\u2318")
    .replace(/Ctrl\+/g, "\u2303")
    .replace(/Alt\+/g, "\u2325")
    .replace(/Shift\+/g, "\u21E7");
}

export const ACTION_LABELS: Record<string, string> = {
  "new-note": "New Note",
  "toggle-visibility": "Toggle Visibility",
  "toggle-collapse": "Toggle Control Panel",
  "hide-children": "Hide Children",
  "opacity-decrease": "Decrease Opacity",
  "opacity-increase": "Increase Opacity",
  "toggle-clipboard": "Toggle Clipboard",
  "reopen-last-closed": "Reopen Last Closed",
  "workspace-1": "Workspace Slot 1",
  "workspace-2": "Workspace Slot 2",
  "workspace-3": "Workspace Slot 3",
  "workspace-4": "Workspace Slot 4",
  "workspace-5": "Workspace Slot 5",
};
