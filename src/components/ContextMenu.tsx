import { createPortal } from "react-dom";
import { cn } from "@/lib/utils";

/** Estimated height of a context menu (~40px per item + padding). */
const CTX_MENU_HEIGHT = 160;
/** Small upward nudge so the cursor lands on the first item, not above it. */
const NUDGE = 4;

/** Adjust y so the menu stays within the viewport. */
function ctxMenuY(y: number): number {
  let top = y - NUDGE;
  // If the menu would overflow the bottom, shift it up
  const overflow = top + CTX_MENU_HEIGHT - window.innerHeight;
  if (overflow > 0) top -= overflow + 8;
  // Clamp so it never goes above the viewport
  if (top < 4) top = 4;
  return top;
}

export function ContextMenuPopover({
  x,
  y,
  children,
}: {
  x: number;
  y: number;
  children: React.ReactNode;
}) {
  return createPortal(
    <div
      className={cn(
        "fixed z-[200] min-w-[140px] rounded-lg py-1",
        "bg-neutral-800 border border-neutral-700 shadow-xl",
      )}
      style={{ left: x, top: ctxMenuY(y) }}
    >
      {children}
    </div>,
    document.body,
  );
}
