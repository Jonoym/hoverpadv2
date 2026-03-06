# P3-01: Collapsible Panel Behavior

## Objective
Transform the Control Panel from a fixed window into a collapsible overlay that transitions between a small tab pinned to the top of the screen and a full expanded view.

## Scope

### Collapsed State
- Small tab pinned to top-center of screen (~200px wide, ~36px tall)
- Shows Hoverpad icon/logo + quick stats (open notes count, active sessions count)
- Clicking or hovering expands to full view
- Styled consistently with the dark theme (rounded, semi-transparent, backdrop blur)

### Expanded State
- Full Control Panel showing notes list, action buttons, and (future) kanban/calendar views
- Resizable within reasonable bounds (min 400x300, max 900x700)
- Close button collapses back to tab (doesn't close the app)
- Escape key collapses

### Transition
- Animate the window resize/position using Tauri's `setSize()` and `setPosition()` APIs
- Store collapsed/expanded state in memory (not persisted yet — that's Phase 5)
- The main window label stays "main" — just resize it

### Tab View Component
- New `CollapsedTab` component rendered when collapsed
- Shows: app icon, note count, session count
- Click handler triggers expansion

### Integration
- Modify ControlPanel.tsx to switch between `CollapsedTab` and the full panel view
- The expand/collapse state is local to the window (useState)

## Out of Scope
- Global hotkey for expand/collapse (documented as TBD in planning)
- Window state persistence (Phase 5)
- Smooth CSS transitions during resize (Tauri window resize is instant)

## Acceptance Criteria
1. Control Panel starts in expanded mode (default for now)
2. A collapse button in the title bar shrinks the window to a small tab
3. Clicking the tab expands back to full size
4. Collapsed tab shows note count and session count
5. Window position moves to top-center when collapsed
6. Expanding restores the previous size and position

## Status
done

## Review
PASS — [review](../reviews/P3-01-02-panel-and-store.md)
