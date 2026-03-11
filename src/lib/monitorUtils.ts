import { availableMonitors } from "@tauri-apps/api/window";
import { WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import type { Monitor } from "@tauri-apps/api/window";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface MonitorInfo {
  /** Display name (e.g. "\\.\DISPLAY1") */
  name: string | null;
  /** Position in virtual screen space (physical pixels) */
  x: number;
  y: number;
  /** Size in physical pixels */
  width: number;
  height: number;
  scaleFactor: number;
}

// ---------------------------------------------------------------------------
// Monitor queries
// ---------------------------------------------------------------------------

/** Get all monitors as simplified MonitorInfo objects. */
export async function getMonitors(): Promise<MonitorInfo[]> {
  const monitors = await availableMonitors();
  return monitors.map(toMonitorInfo);
}

function toMonitorInfo(m: Monitor): MonitorInfo {
  return {
    name: m.name,
    x: m.position.x,
    y: m.position.y,
    width: m.size.width,
    height: m.size.height,
    scaleFactor: m.scaleFactor,
  };
}

/** Find which monitor contains a given point (physical pixels). */
export function monitorAt(
  monitors: MonitorInfo[],
  px: number,
  py: number,
): MonitorInfo | null {
  return (
    monitors.find(
      (m) => px >= m.x && px < m.x + m.width && py >= m.y && py < m.y + m.height,
    ) ?? null
  );
}

/** Find a monitor by name. Returns null if not found. */
export function monitorByName(
  monitors: MonitorInfo[],
  name: string | null,
): MonitorInfo | null {
  if (!name) return null;
  return monitors.find((m) => m.name === name) ?? null;
}

/** Get a display label for a monitor (e.g. "Display 1"). */
export function monitorLabel(monitor: MonitorInfo, index: number): string {
  // Strip Windows-style prefix like "\\.\DISPLAY1" → "DISPLAY1"
  const raw = monitor.name ?? `Monitor ${index + 1}`;
  const stripped = raw.replace(/^\\\\\.\\/i, "");
  return stripped;
}

// ---------------------------------------------------------------------------
// Snap-to-edge
// ---------------------------------------------------------------------------

/** Distance threshold (physical pixels) for detecting proximity to snap target. */
const SNAP_THRESHOLD = 20;

/**
 * Given a window position and size, compute a snapped position if the window
 * is within SNAP_THRESHOLD of any monitor edge. Snaps to SNAP_INSET from the
 * edge rather than flush. Returns null if no snap needed.
 */
export function computeSnap(
  monitors: MonitorInfo[],
  winX: number,
  winY: number,
  winWidth: number,
  winHeight: number,
): { x: number; y: number } | null {
  // Find which monitor the window's center (or top-left) is on
  const monitor = monitorAt(monitors, winX + winWidth / 2, winY + winHeight / 2)
    ?? monitorAt(monitors, winX, winY);
  if (!monitor) return null;

  let snappedX = winX;
  let snappedY = winY;
  let didSnap = false;

  const inset = 20;

  const leftTarget = monitor.x + inset;
  const rightTarget = monitor.x + monitor.width - winWidth - inset;
  const topTarget = monitor.y + inset;
  const bottomTarget = monitor.y + monitor.height - winHeight - inset;

  // Left edge
  if (Math.abs(winX - leftTarget) < SNAP_THRESHOLD) {
    snappedX = leftTarget;
    didSnap = true;
  }
  // Right edge
  if (Math.abs(winX - rightTarget) < SNAP_THRESHOLD) {
    snappedX = rightTarget;
    didSnap = true;
  }
  // Top edge
  if (Math.abs(winY - topTarget) < SNAP_THRESHOLD) {
    snappedY = topTarget;
    didSnap = true;
  }
  // Bottom edge
  if (Math.abs(winY - bottomTarget) < SNAP_THRESHOLD) {
    snappedY = bottomTarget;
    didSnap = true;
  }

  return didSnap ? { x: snappedX, y: snappedY } : null;
}

// ---------------------------------------------------------------------------
// Send all windows to a monitor
// ---------------------------------------------------------------------------

/**
 * Move all open Hoverpad child windows to the target monitor, preserving
 * their relative positions. Windows are translated by the offset between
 * their current monitor and the target. The control panel (main) is excluded.
 */
export async function sendAllWindowsToMonitor(
  targetMonitor: MonitorInfo,
): Promise<void> {
  const allWindows = await WebviewWindow.getAll();
  const childWindows = allWindows.filter((w) => w.label !== "main");
  if (childWindows.length === 0) return;

  const monitors = await getMonitors();

  for (const win of childWindows) {
    try {
      const pos = await win.outerPosition();
      const size = await win.outerSize();

      // Find the monitor this window is currently on
      const sourceMon = monitorAt(monitors, pos.x, pos.y);

      if (!sourceMon) {
        // Off-screen — center on target
        const cx = targetMonitor.x + Math.round((targetMonitor.width - size.width) / 2);
        const cy = targetMonitor.y + Math.round((targetMonitor.height - size.height) / 2);
        await win.setPosition(new PhysicalPosition(cx, cy));
        continue;
      }

      // Compute relative position within the source monitor (0..1)
      const relX = (pos.x - sourceMon.x) / sourceMon.width;
      const relY = (pos.y - sourceMon.y) / sourceMon.height;

      // Move to same relative position on the target monitor.
      // The OS handles DPI scaling of window size and content automatically
      // when the window crosses into a monitor with a different scale factor.
      const newX = Math.round(targetMonitor.x + relX * targetMonitor.width);
      const newY = Math.round(targetMonitor.y + relY * targetMonitor.height);

      await win.setPosition(new PhysicalPosition(newX, newY));
    } catch {
      // window may have closed
    }
  }
}

/**
 * Move the control panel to a target monitor, preserving its relative position.
 * The OS handles DPI scaling automatically when the window lands on the new monitor.
 */
export async function sendControlPanelToMonitor(
  targetMonitor: MonitorInfo,
): Promise<void> {
  const main = await WebviewWindow.getByLabel("main");
  if (!main) return;

  const monitors = await getMonitors();
  const pos = await main.outerPosition();

  const sourceMon = monitorAt(monitors, pos.x, pos.y);

  if (sourceMon) {
    const relX = (pos.x - sourceMon.x) / sourceMon.width;
    const relY = (pos.y - sourceMon.y) / sourceMon.height;
    const newX = Math.round(targetMonitor.x + relX * targetMonitor.width);
    const newY = Math.round(targetMonitor.y + relY * targetMonitor.height);
    await main.setPosition(new PhysicalPosition(newX, newY));
  } else {
    // Off-screen fallback — center near top
    const size = await main.outerSize();
    const cx = targetMonitor.x + Math.round((targetMonitor.width - size.width) / 2);
    await main.setPosition(new PhysicalPosition(cx, targetMonitor.y + 10));
  }
}
