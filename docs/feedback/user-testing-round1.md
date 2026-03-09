# User Testing Feedback — Round 1

Date: 2026-03-07
Tester: Jono (project owner)
Build: Post Phase 5 completion

## Issues Found

### F1: DB Error Code 14 — unable to open database file
**Severity:** Critical (app non-functional)
**Observed:** "DB Error: error returned from database: (Code: 14) unable to open database file"
**Root Cause:** `tauri-plugin-sql` does NOT expand path variables like `$HOME` — it treats them as literal directory names. The original `sqlite:$HOME/hoverpad/hoverpad.db` created a literal `$HOME` directory inside the app config dir. Additionally, `ensureHoverpadDir()` used `BaseDirectory.Home` (FS plugin) which resolved differently from the SQL plugin's path.
**Fix (attempt 1):** Resolve path via `homeDir()` and string concatenation — still failed.
**Fix (attempt 2):** Use Tauri's `homeDir()` + `join()` path API to construct a proper absolute path. `tauri-plugin-sql` works with absolute paths because Rust's `PathBuf::push` replaces the base when given an absolute path. Also switched `ensureHoverpadDir()` to use the same absolute path instead of `BaseDirectory.Home`.
**Status:** Fixed

### F2: Window dragging not working
**Severity:** High (can't reposition windows)
**Observed:** Cannot move/drag windows by clicking and dragging the title bar.
**Root Cause:** `data-tauri-drag-region` internally calls `window.startDragging()`, which requires the `core:window:allow-start-dragging` capability. This permission was missing from `capabilities/default.json`.
**Fix:** Add `core:window:allow-start-dragging` to the capabilities.
**Status:** Fixed

### F3: Opacity minimum should be 20%, not 10%
**Severity:** Low (UX preference)
**Observed:** Ctrl+, can decrease opacity to 10%. User prefers 20% as the minimum.
**Root Cause:** `globalStore.ts` clamps opacity to `Math.max(0.1, ...)`.
**Fix:** Change minimum from 0.1 to 0.2 in both `setOpacity` and `adjustOpacity`.
**Status:** Fixed
**ADR Impact:** Updates P5-01 acceptance criteria (minimum 20% instead of 10% floor).

### F4: Ctrl+H should make windows invisible, not hide them
**Severity:** Medium (behavioral change)
**Observed:** Ctrl+H calls `window.hide()`/`window.show()` in Rust, which fully closes/shows windows at the OS level.
**Desired:** Windows should remain open but become fully transparent (opacity 0) with click-through enabled. Ctrl+H again restores the previous opacity.
**Root Cause:** `toggle_all_windows()` in `lib.rs` uses `window.hide()` / `window.show()`.
**Fix:** Rust emits `hotkey:toggle-visibility` event instead of hiding. Frontend toggles between opacity 0 (fully transparent + click-through) and the previous opacity value. Global store tracks `isHidden` flag and `preHideOpacity`.
**Status:** Fixed
**ADR Impact:** Changes the Ctrl+H behavior spec in planning docs and P5-01 progress.

### F5: Windows appear in alt-tab
**Severity:** Medium (UX — overlay windows shouldn't be in task switcher)
**Observed:** Hoverpad windows show up in the Windows alt-tab task switcher.
**Desired:** As an overlay app, windows should not appear in alt-tab.
**Fix:** Add `skipTaskbar: true` to the main window in `tauri.conf.json` and to dynamically created windows in `windowManager.ts`.
**Status:** Fixed

### F6: Database still cannot connect (follow-up to F1)
**Severity:** Critical (app non-functional)
**Observed:** After F1 fix using `homeDir()` + string concatenation, the database still fails to connect.
**Root Cause:** String concatenation (`${home}hoverpad/hoverpad.db`) can produce malformed paths on Windows. The `ensureHoverpadDir()` was still using `BaseDirectory.Home` (FS plugin resolution) which may differ from the SQL path.
**Fix:** Use `join()` from `@tauri-apps/api/path` for proper cross-platform path construction. Both `ensureHoverpadDir()` and `getDatabase()` now use the same `getHoverpadDir()` helper with `homeDir()` + `join()`.
**Status:** Fixed

### F7: Minimising the Control Panel makes it disappear
**Severity:** Medium (can't recover the window)
**Observed:** Clicking the minimize button on the Control Panel minimises it to the taskbar, but since `skipTaskbar: true` is set, there's no way to restore it.
**Desired:** Remove the minimize button from the Control Panel. Ctrl+H covers the hide/show use case.
**Fix:** Set `showMinimize={false}` on the `WindowChrome` in `ControlPanel.tsx`.
**Status:** Fixed

---

## Round 2 — Post-Phase 5 Polish & Features

Date: 2026-03-07

### F8: Session formatting/design needs polish
**Severity:** Medium (UX)
**Observed:** SessionWindow controls bar uses negative margins, text-only buttons. Timeline events lack visual distinction between user/assistant turns.
**Fix:** Replaced text buttons with icon buttons (play/pause/clear). Added rounded toolbar container. Timeline now has vertical lane marker, colored lane dots, and subtle background tints per turn type. Tool names rendered as monospace colored chips.
**Status:** Fixed

### F9: Can't open notes from kanban cards
**Severity:** Medium (missing functionality)
**Observed:** KanbanCard shows "2 notes" count but no way to click through to the actual notes.
**Fix:** Replaced static note count with clickable note title buttons. Added `onOpenNote` callback threaded through Board → Column → Card.
**Status:** Fixed

### F10: Replace link/unlink with ticket label
**Severity:** Low (UX clutter)
**Observed:** NoteList shows a dropdown to link and "Unlink" button for every note — overly complex.
**Fix:** Removed link/unlink UI entirely. Ticket badge still displays when a note is linked (set via kanban's "create linked note").
**Status:** Fixed

### F11: Remove "New Session" button
**Severity:** Low (creates broken sessions)
**Observed:** "New Session" button in Control Panel creates test sessions with `test-{timestamp}` IDs that have no backing log file.
**Fix:** Removed button, handler, and `createSessionWindow` import from ControlPanel.
**Status:** Fixed

### F12: Remove DB status display
**Severity:** Low (dev-only info)
**Observed:** Control Panel shows "DB OK — 6 tables (kanban_columns, tickets, notes, ...)" which is not useful for end users.
**Fix:** Removed DB status `<div>`, state, and `getDatabaseStatus` import.
**Status:** Fixed

### F13: Remove "Control Panel" badge
**Severity:** Low (clutter)
**Observed:** Window title bar shows "Hoverpad" + blue "Control Panel" badge — unnecessary.
**Fix:** Removed `badge` prop from `<WindowChrome>`.
**Status:** Fixed

### F14: Note window minimum size
**Severity:** Low (can resize to unusable)
**Observed:** Note windows can be resized to very small sizes, making them unusable.
**Fix:** Added `minWidth: 300, minHeight: 250` for note windows and `minWidth: 350, minHeight: 300` for session windows in `windowManager.ts`.
**Status:** Fixed

### F15: Rename notes inline
**Severity:** Medium (new feature)
**Observed:** No way to rename notes without editing frontmatter.
**Fix:** Double-click note title in NoteList to enter inline edit mode. Enter/blur saves, Escape cancels. Updates both SQLite title and .md frontmatter.
**Status:** Implemented

### F16: Note content preview
**Severity:** Low (new feature)
**Observed:** NoteList only shows title and timestamp — hard to distinguish similar notes.
**Fix:** Added `preview` column to notes table. `saveNote()` computes a 100-char plain-text preview (strips frontmatter + markdown). NoteList shows preview line under title.
**Status:** Implemented

### F17: Notes activity columns
**Severity:** Medium (new feature)
**Observed:** All notes in a single flat list — hard to find relevant ones.
**Fix:** NoteList now splits into sections: Starred (pinned at top with star toggle), Open (currently in a window), Recent (updated within 7 days), Inactive (older). Each section has collapsible header with count.
**Status:** Implemented

### F18: Session project accordion
**Severity:** Low (new feature)
**Observed:** Session groups work but lack polish — no smooth animation, no "open all" shortcut.
**Fix:** Enhanced SessionList with smooth CSS accordion animation, "Open All" button per project group, and left-border accent for active sessions.
**Status:** Implemented
