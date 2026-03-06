# P5-02: Window State Persistence

## Objective
Save and restore window positions, sizes, and open/closed state across app restarts. When Hoverpad launches, it should restore the windows that were open when it was last closed.

## Scope

### Save Window State
- On window move/resize: update `window_state` JSON in the SQLite `notes`/`sessions` table
- Store: `{ x, y, width, height }` as JSON
- Debounce saves (2s after last move/resize) to avoid excessive writes
- Use Tauri's window event listeners for move/resize

### Restore Window State
- On app launch: query SQLite for notes with `is_open = 1`
- For each open note: create a note window at the saved position/size
- Same for sessions with `is_open = 1` (if applicable)
- Control Panel restores its own size/position from localStorage or a settings table

### Tauri Capabilities
- Need `core:window:allow-outer-position` (already added in P3-01)
- Need `core:window:allow-inner-size` (already added in P3-01)

### Window Manager Updates
- Modify `createNoteWindow` and `createSessionWindow` to accept optional position/size
- On creation, check SQLite for saved window_state and apply it

## Out of Scope
- Per-window opacity persistence (Phase 5 stretch)
- Control Panel collapsed/expanded state persistence

## Acceptance Criteria
1. Window position and size are saved to SQLite on move/resize
2. On app launch, previously open notes are restored
3. Restored windows appear at their saved positions
4. Windows that were closed before exit stay closed on next launch
5. Save is debounced to avoid excessive writes

## Status
done

## Review
PASS — [review](../reviews/P5-01-02-opacity-and-persistence.md)
