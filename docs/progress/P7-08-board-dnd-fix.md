# P7-08: Board DnD Fix

## Status: Complete

## Problem

Kanban board drag-and-drop was not working. Cards could not be dragged at all, and when drag occasionally started, drops failed and cards snapped back.

## Root Cause

The app uses **transparent Tauri windows** (`transparent: true`, `decorations: false`) on Windows with WebView2. HTML5 Drag and Drop — the mechanism that Pragmatic Drag and Drop (`@atlaskit/pragmatic-drag-and-drop`) relies on — does not work reliably in transparent WebView2 windows on Windows. The `dragstart` event either fails to fire or the drag session is immediately cancelled by the browser engine.

Additionally, the `WindowChrome` component applies `select-none` (`user-select: none`) to the entire window, which can further prevent HTML5 drag initiation in some webview environments.

## Previous Fix Attempts

1. **Overflow fix** — Changed board wrapper from `overflow-y-auto` to `overflow-auto`. Did not resolve the issue.
2. **Pragmatic DnD refactor** — Stabilised the monitor with refs, added card-level drop targets, added dedicated drag handle. The underlying HTML5 DnD events still did not fire in the transparent window, so this did not help.

## Fix: Pointer-Event Based DnD

Replaced the Pragmatic Drag and Drop integration entirely with a custom **pointer-event based** drag-and-drop implementation. Pointer events (`pointerdown`, `pointermove`, `pointerup`) work reliably in all Tauri window configurations including transparent overlay windows.

### KanbanBoard.tsx
- Removed `monitorForElements` import and all Pragmatic DnD code
- Added `handleDragStart` callback: on `pointerdown` from a card, registers document-level `pointermove`/`pointerup`/`pointercancel` listeners
- Uses a **5px movement threshold** to distinguish clicks from drags
- Tracks drag data in a ref (`dragDataRef`) to avoid per-pixel React re-renders
- Updates a floating drag overlay position directly via DOM ref (`overlayRef`)
- Column hit-testing uses `getBoundingClientRect()` on registered column refs
- On drop, calls `moveTicket()` to persist the column change, then refreshes tickets

### KanbanCard.tsx
- Removed all `@atlaskit/pragmatic-drag-and-drop` imports (`draggable`, `dropTargetForElements`, `combine`)
- Added `onDragStart` and `isDragging` props
- Drag handle `<div>` fires `onPointerDown` → calls `props.onDragStart()`
- Added `touch-none` CSS to the drag handle to prevent touch scroll interference
- `isDragging` prop (from parent) reduces opacity to 30% on the card being dragged

### KanbanColumn.tsx
- Removed `dropTargetForElements` import and the `useEffect` that registered it
- Added `onDragStart`, `registerRef`, `isDragOver`, `draggingTicketId` props
- Registers its DOM ref with the board via `useEffect` + `registerRef` callback
- Passes `onDragStart` and `isDragging` through to cards
- `isDragOver` prop controls the blue highlight styling

## Files Modified
- `src/components/kanban/KanbanBoard.tsx`
- `src/components/kanban/KanbanCard.tsx`
- `src/components/kanban/KanbanColumn.tsx`
