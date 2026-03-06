# P2-03: Auto-save with Debounce

## Objective
Implement automatic saving of note content as the user types, with a debounce delay to avoid excessive disk writes. Replaces the manual Ctrl+S-only workflow from P2-02 (Ctrl+S still works as an immediate save).

## Scope

### Debounced Auto-save
- On every MDXEditor `onChange` callback, schedule a debounced save (1 second delay)
- If the user keeps typing, the timer resets — save only fires after 1s of inactivity
- Use a `useRef`-based debounce (not lodash) to avoid stale closure issues
- Call `saveNote(id, markdown)` from noteService (already implemented in P2-02)

### Save Status Indicator
- Show save status in the title bar: "Saving..." while write is in progress, "Saved" briefly after completion
- Clear the status indicator after ~1.5s
- If save fails, show "Save failed" in the title bar (non-blocking — don't interrupt editing)

### Ctrl+S Immediate Save
- Keep the existing Ctrl+S handler from P2-02
- Ctrl+S should cancel any pending debounce timer and save immediately
- Same status indicator behavior

### Dirty State Tracking
- Track whether the editor content has changed since the last save
- On window close, if there are unsaved changes, trigger an immediate save before closing
- No confirmation dialog — just save silently

## Out of Scope
- Conflict resolution for external edits (future)
- Undo/redo integration with save points (MDXEditor handles this internally)

## Acceptance Criteria
1. Editing a note triggers an auto-save after 1 second of inactivity
2. Rapid typing delays the save (debounce behavior)
3. Ctrl+S saves immediately and cancels any pending debounce
4. Title bar shows "Saving..." and "Saved" indicators
5. Unsaved changes are saved on window close
6. No duplicate saves (debounce and Ctrl+S don't race)

## Status
complete

## Review
[P2-03-04-auto-save-and-listing](../reviews/P2-03-04-auto-save-and-listing.md) — PASS
