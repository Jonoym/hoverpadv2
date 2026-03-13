import { useCallback, useEffect, useRef, useState } from "react";
import { getCurrentWebviewWindow, WebviewWindow } from "@tauri-apps/api/webviewWindow";
import { listen } from "@tauri-apps/api/event";
import { PhysicalPosition } from "@tauri-apps/api/dpi";
import { groupWindows, ungroupWindow, ungroupGroup, listGroups } from "./windowGrouping";
import { emitEvent, listenEvent } from "./events";
import { getMonitors, type MonitorInfo } from "./monitorUtils";

/** Module-level set of minimized window labels, updated via events. */
const minimizedWindows = new Set<string>();

/** Proximity threshold (physical pixels) — shows blue preview border. */
const SNAP_PREVIEW_DISTANCE = 40;

/** Distance at which the snap actually commits and groups. */
const SNAP_COMMIT_DISTANCE = 25;

/** Gap between snapped windows (physical pixels). */
const SNAP_GAP = 4;

/** Distance beyond which a grouped window auto-ungroups. */
const UNGROUP_DISTANCE = 150;

/** Re-entrancy guard: true while we are programmatically moving grouped siblings. */
let isMovingSiblings = false;


// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useWindowGrouping() {
  const [isGrouped, setIsGrouped] = useState(false);
  const [snapPreview, setSnapPreview] = useState(false);
  const moveTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const isProcessingRef = useRef(false);
  const previewTargetRef = useRef<string | null>(null);
  const pendingSnapRef = useRef<{
    targetLabel: string;
    snapPos: { x: number; y: number };
    /** Labels of the TARGET window's group (if any). */
    targetGroupLabels: string[] | null;
    /** Labels of MY (dragged) window's group siblings (excluding myself). */
    myGroupSiblings: string[];
  } | null>(null);

  // Listen for snap-preview events from other windows targeting us
  useEffect(() => {
    const myLabel = getCurrentWebviewWindow().label;
    const unlisten = listenEvent("window:snap-preview", (e) => {
      if (e.payload.label === myLabel) {
        setSnapPreview(e.payload.active);
      }
    });
    return () => { unlisten.then((fn) => fn()).catch(console.error); };
  }, []);

  // Track minimized windows across all webviews
  useEffect(() => {
    const unlisten = listenEvent("window:minimized", (e) => {
      if (e.payload.minimized) {
        minimizedWindows.add(e.payload.label);
      } else {
        minimizedWindows.delete(e.payload.label);
      }
    });
    return () => { unlisten.then((fn) => fn()).catch(console.error); };
  }, []);

  // Check group membership on mount and periodically
  useEffect(() => {
    const myLabel = getCurrentWebviewWindow().label;
    const check = async () => {
      try {
        const groups = await listGroups();
        setIsGrouped(groups.some((g) => g.labels.includes(myLabel)));
      } catch {
        // best effort
      }
    };
    void check();
    const interval = setInterval(() => void check(), 3_000);
    return () => clearInterval(interval);
  }, []);

  // Clear preview on unmount
  useEffect(() => {
    return () => {
      if (previewTargetRef.current) {
        emitEvent("window:snap-preview", { label: previewTargetRef.current, active: false }).catch(() => {});
        previewTargetRef.current = null;
      }
    };
  }, []);

  // Detect platform — on non-Windows, we handle group drag + drag-end in frontend
  const isMacOrLinux = useRef(
    !navigator.platform.toUpperCase().includes("WIN"),
  );
  const dragEndTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  /** Last known position of this window, used to compute drag delta for group moves. */
  const lastPosRef = useRef<{ x: number; y: number } | null>(null);

  // Main drag-snap effect
  useEffect(() => {
    const appWindow = getCurrentWebviewWindow();

    const showPreview = (targetLabel: string) => {
      if (previewTargetRef.current && previewTargetRef.current !== targetLabel) {
        emitEvent("window:snap-preview", { label: previewTargetRef.current, active: false }).catch(() => {});
      }
      previewTargetRef.current = targetLabel;
      setSnapPreview(true);
      emitEvent("window:snap-preview", { label: targetLabel, active: true }).catch(() => {});
    };

    const clearPreview = () => {
      if (previewTargetRef.current) {
        emitEvent("window:snap-preview", { label: previewTargetRef.current, active: false }).catch(() => {});
        previewTargetRef.current = null;
      }
      setSnapPreview(false);
      pendingSnapRef.current = null;
    };

    /** Only updates preview state — never commits the snap. */
    const checkProximity = async () => {
      if (isProcessingRef.current) return;
      isProcessingRef.current = true;

      try {
        const myLabel = appWindow.label;

        // Don't snap if this window is minimized
        if (minimizedWindows.has(myLabel)) {
          clearPreview();
          return;
        }

        const myPos = await appWindow.outerPosition();
        const mySize = await appWindow.outerSize();

        const allWindows = await WebviewWindow.getAll();
        // Skip minimized windows and the control panel
        const others = allWindows.filter(
          (w) => w.label !== myLabel && w.label !== "main" && !minimizedWindows.has(w.label),
        );

        const groups = await listGroups();
        const myGroup = groups.find((g) => g.labels.includes(myLabel));

        // Find nearest window with aligned edges
        let nearest: {
          label: string;
          dist: number;
          snapPos: { x: number; y: number };
        } | null = null;

        for (const other of others) {
          try {
            const otherPos = await other.outerPosition();
            const otherSize = await other.outerSize();
            const snap = findEdgeSnap(
              myPos.x, myPos.y, mySize.width, mySize.height,
              otherPos.x, otherPos.y, otherSize.width, otherSize.height,
            );
            if (snap && snap.dist < (nearest?.dist ?? Infinity)) {
              nearest = { label: other.label, dist: snap.dist, snapPos: snap.snapPos };
            }
          } catch { /* window may have closed */ }
        }

        if (myGroup) {
          // Already grouped — check ungroup distance
          let minGroupDist = Infinity;
          for (const other of others) {
            if (!myGroup.labels.includes(other.label)) continue;
            try {
              const otherPos = await other.outerPosition();
              const otherSize = await other.outerSize();
              const dist = edgeDistance(
                myPos.x, myPos.y, mySize.width, mySize.height,
                otherPos.x, otherPos.y, otherSize.width, otherSize.height,
              );
              minGroupDist = Math.min(minGroupDist, dist);
            } catch { /* */ }
          }

          if (minGroupDist > UNGROUP_DISTANCE) {
            await ungroupWindow(myLabel);
            setIsGrouped(false);
            clearPreview();
            return;
          }

          // Near a non-group window? Show preview, store pending
          if (nearest && !myGroup.labels.includes(nearest.label)) {
            if (nearest.dist <= SNAP_PREVIEW_DISTANCE) {
              showPreview(nearest.label);
              if (nearest.dist <= SNAP_COMMIT_DISTANCE) {
                pendingSnapRef.current = {
                  targetLabel: nearest.label,
                  snapPos: nearest.snapPos,
                  targetGroupLabels: myGroup.labels,
                  myGroupSiblings: myGroup.labels.filter((l) => l !== myLabel),
                };
              } else {
                pendingSnapRef.current = null;
              }
            } else {
              clearPreview();
            }
          } else {
            clearPreview();
          }
        } else {
          // Not grouped
          if (nearest && nearest.dist <= SNAP_PREVIEW_DISTANCE) {
            showPreview(nearest.label);
            setSnapPreview(true);
            if (nearest.dist <= SNAP_COMMIT_DISTANCE) {
              const nearestGroup = groups.find((g) => g.labels.includes(nearest!.label));
              pendingSnapRef.current = {
                targetLabel: nearest.label,
                snapPos: nearest.snapPos,
                targetGroupLabels: nearestGroup?.labels ?? null,
                myGroupSiblings: [],
              };
            } else {
              pendingSnapRef.current = null;
            }
          } else {
            clearPreview();
          }
        }
      } catch {
        // best effort
      } finally {
        isProcessingRef.current = false;
      }
    };

    /** Commit: snap position + create/extend group. Only called when drag ends. */
    const commitSnap = async () => {
      const pending = pendingSnapRef.current;
      if (!pending) return;
      pendingSnapRef.current = null;

      try {
        const myLabel = appWindow.label;
        const monitors = await getMonitors();

        // Compute the delta so we can move group siblings by the same amount
        const myPos = await appWindow.outerPosition();
        const mySize = await appWindow.outerSize();
        const dx = pending.snapPos.x - myPos.x;
        const dy = pending.snapPos.y - myPos.y;

        // Clamp the snap position itself
        const clamped = clampToScreen(monitors, pending.snapPos.x, pending.snapPos.y, mySize.width, mySize.height);
        await appWindow.setPosition(new PhysicalPosition(clamped.x, clamped.y));

        // Move all siblings in my existing group by the same delta, clamped
        if (pending.myGroupSiblings.length > 0) {
          const allWindows = await WebviewWindow.getAll();
          for (const sibLabel of pending.myGroupSiblings) {
            const sibWindow = allWindows.find((w) => w.label === sibLabel);
            if (!sibWindow) continue;
            try {
              const sibPos = await sibWindow.outerPosition();
              const sibSize = await sibWindow.outerSize();
              const sibClamped = clampToScreen(
                monitors,
                sibPos.x + dx, sibPos.y + dy,
                sibSize.width, sibSize.height,
              );
              await sibWindow.setPosition(new PhysicalPosition(sibClamped.x, sibClamped.y));
            } catch { /* window may have closed */ }
          }
        }

        // Merge all labels into one group
        const allLabels = new Set<string>([myLabel, pending.targetLabel, ...pending.myGroupSiblings]);
        if (pending.targetGroupLabels) {
          for (const l of pending.targetGroupLabels) allLabels.add(l);
        } else {
          // Check if the target belongs to a group we didn't know about
          const groups = await listGroups();
          const nearestGroup = groups.find((g) => g.labels.includes(pending.targetLabel));
          if (nearestGroup) {
            for (const l of nearestGroup.labels) allLabels.add(l);
          }
        }

        await groupWindows([...allLabels]);
        setIsGrouped(true);
      } catch (err) {
        console.error("[hoverpad] Failed to commit snap:", err);
      }

      // Clear preview
      if (previewTargetRef.current) {
        emitEvent("window:snap-preview", { label: previewTargetRef.current, active: false }).catch(() => {});
        previewTargetRef.current = null;
      }
      setSnapPreview(false);
    };

    /**
     * Move grouped siblings on non-Windows when this window is dragged.
     * On Windows this is handled natively via WM_MOVING in the Rust subclass.
     */
    const moveGroupSiblings = async () => {
      if (!isMacOrLinux.current || isMovingSiblings) return;

      try {
        const myLabel = appWindow.label;
        const pos = await appWindow.outerPosition();

        const prev = lastPosRef.current;
        lastPosRef.current = { x: pos.x, y: pos.y };

        if (!prev) return;
        const dx = pos.x - prev.x;
        const dy = pos.y - prev.y;
        if (dx === 0 && dy === 0) return;

        const groups = await listGroups();
        const myGroup = groups.find((g) => g.labels.includes(myLabel));
        if (!myGroup || myGroup.labels.length < 2) return;

        const allWindows = await WebviewWindow.getAll();
        const siblings = allWindows.filter(
          (w) => w.label !== myLabel && myGroup.labels.includes(w.label),
        );
        if (siblings.length === 0) return;

        isMovingSiblings = true;
        try {
          await Promise.all(
            siblings.map(async (sib) => {
              try {
                const sibPos = await sib.outerPosition();
                await sib.setPosition(
                  new PhysicalPosition(sibPos.x + dx, sibPos.y + dy),
                );
              } catch { /* window may have closed */ }
            }),
          );
        } finally {
          isMovingSiblings = false;
        }
      } catch {
        isMovingSiblings = false;
      }
    };

    const handleMove = () => {
      // Skip moves caused by our own group-drag code
      if (isMovingSiblings) return;

      // Move grouped siblings immediately (non-Windows only)
      void moveGroupSiblings();

      // Debounced proximity check (preview only, never commits)
      clearTimeout(moveTimerRef.current);
      moveTimerRef.current = setTimeout(() => void checkProximity(), 80);

      // On macOS/Linux, detect drag-end via movement settling (no WM_EXITSIZEMOVE)
      if (isMacOrLinux.current) {
        clearTimeout(dragEndTimerRef.current);
        dragEndTimerRef.current = setTimeout(() => void commitSnap(), 200);
      }
    };

    // Listen for the native drag-end event (WM_EXITSIZEMOVE) from Rust (Windows only)
    const unlistenDragEnd = listen("window:drag-end", () => {
      void commitSnap();
    });

    const unlistenMove = appWindow.onMoved(handleMove);

    return () => {
      clearTimeout(moveTimerRef.current);
      clearTimeout(dragEndTimerRef.current);
      if (previewTargetRef.current) {
        emitEvent("window:snap-preview", { label: previewTargetRef.current, active: false }).catch(() => {});
        previewTargetRef.current = null;
      }
      setSnapPreview(false);
      unlistenMove.then((fn) => fn()).catch(console.error);
      unlistenDragEnd.then((fn) => fn()).catch(console.error);
    };
  }, []);

  const handleUngroup = useCallback(async () => {
    try {
      await ungroupWindow(getCurrentWebviewWindow().label);
      setIsGrouped(false);
    } catch (err) {
      console.error("[hoverpad] Failed to ungroup:", err);
    }
  }, []);

  const handleUngroupAll = useCallback(async () => {
    try {
      const myLabel = getCurrentWebviewWindow().label;
      const groups = await listGroups();
      const myGroup = groups.find((g) => g.labels.includes(myLabel));
      if (myGroup) {
        await ungroupGroup(myGroup.groupId);
        setIsGrouped(false);
      }
    } catch (err) {
      console.error("[hoverpad] Failed to ungroup all:", err);
    }
  }, []);

  return { isGrouped, snapPreview, ungroup: handleUngroup, ungroupAll: handleUngroupAll };
}

// ---------------------------------------------------------------------------
// Geometry helpers
// ---------------------------------------------------------------------------

/** Minimum overlap on the perpendicular axis for edges to be considered "aligned". */
const MIN_EDGE_OVERLAP = 40;

/** Max distance on the secondary axis before we align it (px). */
const ALIGN_THRESHOLD = 30;

interface SnapCandidate {
  /** Distance between the two parallel edges (gap). */
  dist: number;
  /** The snap position for window A. */
  snapPos: { x: number; y: number };
}

/**
 * Find the best edge-snap between two windows.
 * Only considers edges that are parallel AND overlapping on the perpendicular axis
 * by at least MIN_EDGE_OVERLAP px. Returns null if no valid edge pairing exists.
 */
function findEdgeSnap(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): SnapCandidate | null {
  let bestDist = Infinity;
  let best: SnapCandidate | null = null;

  const tryCandidate = (gap: number, snapPos: { x: number; y: number }) => {
    const d = Math.abs(gap);
    if (gap >= -SNAP_GAP && d < bestDist) {
      bestDist = d;
      best = { dist: d, snapPos };
    }
  };

  // Vertical overlap: how much do the two windows overlap on the Y axis?
  const vOverlap = Math.min(ay + ah, by + bh) - Math.max(ay, by);
  // Horizontal overlap: how much do the two windows overlap on the X axis?
  const hOverlap = Math.min(ax + aw, bx + bw) - Math.max(ax, bx);

  // --- Horizontal edge pairings (left/right edges, requires vertical overlap) ---
  if (vOverlap >= MIN_EDGE_OVERLAP) {
    const snapY = Math.abs(ay - by) <= ALIGN_THRESHOLD ? by : ay;
    // A's right edge ↔ B's left edge
    tryCandidate(bx - (ax + aw), { x: bx - aw - SNAP_GAP, y: snapY });
    // A's left edge ↔ B's right edge
    tryCandidate(ax - (bx + bw), { x: bx + bw + SNAP_GAP, y: snapY });
  }

  // --- Vertical edge pairings (top/bottom edges, requires horizontal overlap) ---
  if (hOverlap >= MIN_EDGE_OVERLAP) {
    const snapX = Math.abs(ax - bx) <= ALIGN_THRESHOLD ? bx : ax;
    // A's bottom edge ↔ B's top edge
    tryCandidate(by - (ay + ah), { x: snapX, y: by - ah - SNAP_GAP });
    // A's top edge ↔ B's bottom edge
    tryCandidate(ay - (by + bh), { x: snapX, y: by + bh + SNAP_GAP });
  }

  return best;
}

/**
 * Simple edge-to-edge distance (used for ungroup distance check).
 */
function edgeDistance(
  ax: number, ay: number, aw: number, ah: number,
  bx: number, by: number, bw: number, bh: number,
): number {
  const dx = Math.max(0, Math.max(ax - (bx + bw), bx - (ax + aw)));
  const dy = Math.max(0, Math.max(ay - (by + bh), by - (ay + ah)));
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Clamp a position so the window stays within visible monitor bounds.
 * Ensures the top edge never goes above any monitor's top and the window
 * stays at least partially visible.
 */
function clampToScreen(
  monitors: MonitorInfo[],
  x: number, y: number, w: number, _h: number,
): { x: number; y: number } {
  // Find the monitor whose area contains the window center (or nearest)
  const cx = x + w / 2;
  let best: MonitorInfo | null = null;
  let bestDist = Infinity;
  for (const m of monitors) {
    // Check if center is inside this monitor
    if (cx >= m.x && cx < m.x + m.width && y >= m.y && y < m.y + m.height) {
      best = m;
      break;
    }
    // Otherwise find nearest
    const dx = Math.max(0, Math.max(m.x - cx, cx - (m.x + m.width)));
    const dy = Math.max(0, Math.max(m.y - y, y - (m.y + m.height)));
    const dist = dx + dy;
    if (dist < bestDist) {
      bestDist = dist;
      best = m;
    }
  }
  if (!best) return { x, y };

  let nx = x;
  let ny = y;
  // Top must not go above monitor top
  if (ny < best.y) ny = best.y;
  // Must have at least 36px visible from top (title bar)
  if (ny > best.y + best.height - 36) ny = best.y + best.height - 36;
  // At least 100px visible horizontally
  if (nx + w < best.x + 100) nx = best.x + 100 - w;
  if (nx > best.x + best.width - 100) nx = best.x + best.width - 100;
  return { x: nx, y: ny };
}
