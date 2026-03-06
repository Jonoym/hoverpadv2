# P1-05: Basic Frameless Window Chrome with Drag + Close

## Objective
Create a shared window shell component that provides a custom title bar with drag region, close button, and consistent styling across all window types. This replaces the native window chrome that was removed by `decorations: false`.

## Scope
- Shared `WindowChrome` component used by all window types (Control Panel, Note, Session)
- Custom title bar with:
  - Drag region using `data-tauri-drag-region` attribute
  - Window title text
  - Close button (calls `getCurrentWindow().close()`)
  - Minimize button (calls `getCurrentWindow().minimize()`)
- Rounded corners on the outer container (`rounded-2xl`)
- Subtle border (`border border-white/10`)
- Dark translucent background (`bg-neutral-900/90 backdrop-blur-md`)
- Integrate into existing page components (ControlPanel, NoteWindow, SessionWindow)
- Remove the temporary test buttons from ControlPanel (move to proper UI)

## Out of Scope
- Opacity slider in title bar (Phase 5)
- Window state persistence (Phase 5)
- Actual note content or session content (Phase 2/4)

## Acceptance Criteria
1. All windows have a consistent custom title bar at the top
2. Windows can be dragged by the title bar
3. Close button closes the window
4. Minimize button minimizes the window
5. Windows have rounded corners and subtle border
6. The window background is semi-transparent with backdrop blur
7. Styling matches ADR-001 (Tailwind) and ADR-008 (overlay) conventions

## Status
complete

## Review
[P1-05-window-chrome review](../reviews/P1-05-window-chrome.md) — initial FAIL, reworked:
- Added `core:window:allow-minimize` to capabilities
- Changed `backdrop-blur-sm` to `backdrop-blur-md`
