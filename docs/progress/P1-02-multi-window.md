# P1-02: Multi-Window Infrastructure

## Objective
Implement the ability to dynamically create, destroy, and manage multiple OS-level Tauri windows. This is the foundation for note windows, session windows, and the Control Panel.

## Scope
- Window creation utility that spawns new Tauri webview windows with unique labels
- All windows load the same SPA, routed by URL path (e.g. `/control-panel`, `/note/:id`, `/session/:id`)
- React Router setup with routes for each window type (placeholder components for now)
- Cross-window communication via Tauri events (`emit`/`listen`)
- Window close handling (cleanup on close)
- A simple test: button in the main window that opens a second window

## Out of Scope
- Custom title bar / window chrome (P1-05)
- SQLite persistence of window state (P1-04)
- Global hotkeys (P1-03)
- Actual note or session content

## Acceptance Criteria
1. Main window has a button that spawns a new window
2. New windows open as separate OS-level windows (transparent, frameless, always-on-top)
3. Windows can be closed individually
4. React Router renders different content based on the window's URL path
5. Tauri events can be sent from one window and received in another
6. Closing the main window closes all child windows

## Status
complete

## Review
[P1-02-multi-window.md](../reviews/P1-02-multi-window.md)
