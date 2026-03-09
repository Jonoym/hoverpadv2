# Hoverpad Progress

## Current Phase
Phase 5 — Overlay & Polish

## Task Status

| ID | Task | Status | Progress File | Review |
|----|------|--------|---------------|--------|
| P1-01 | Tauri v2 scaffold with React + TypeScript | complete | [progress](P1-01-scaffold.md) | [review](../reviews/P1-01-scaffold.md) |
| P1-02 | Multi-window infrastructure | complete | [progress](P1-02-multi-window.md) | [review](../reviews/P1-02-multi-window.md) |
| P1-03 | Global hotkey registration | complete | [progress](P1-03-hotkeys.md) | [review](../reviews/P1-03-hotkeys.md) |
| P1-04 | SQLite database initialisation with schema | complete | [progress](P1-04-sqlite-schema.md) | [review](../reviews/P1-04-sqlite-schema.md) |
| P1-05 | Basic frameless window chrome with drag + close | complete | [progress](P1-05-window-chrome.md) | [review](../reviews/P1-05-window-chrome.md) |

| P2-01 | MDXEditor integration in note windows | complete | [progress](P2-01-mdxeditor.md) | [review](../reviews/P2-01-mdxeditor.md) |
| P2-02 | Note CRUD + hybrid storage | complete | [progress](P2-02-note-crud.md) | [review](../reviews/P2-02-note-crud.md) |
| P2-03 | Auto-save with debounce | complete | [progress](P2-03-auto-save.md) | [review](../reviews/P2-03-04-auto-save-and-listing.md) |
| P2-04 | Note listing in Control Panel | complete | [progress](P2-04-note-listing.md) | [review](../reviews/P2-03-04-auto-save-and-listing.md) |

| P3-01 | Collapsible panel behavior | complete | [progress](P3-01-collapsible-panel.md) | [review](../reviews/P3-01-02-panel-and-store.md) |
| P3-02 | Zustand global store + cross-window sync | complete | [progress](P3-02-zustand-store.md) | [review](../reviews/P3-01-02-panel-and-store.md) |
| P3-03 | Kanban board with tickets + drag-and-drop | complete | [progress](P3-03-kanban-board.md) | [review](../reviews/P3-03-kanban.md) |
| P3-04 | Link notes/sessions to tickets | complete | [progress](P3-04-ticket-linking.md) | [review](../reviews/P3-04-ticket-linking.md) |
|
| P4-01 | Session discovery + log tailing | complete | [progress](P4-01-session-discovery.md) | [review](../reviews/P4-01-session-discovery.md) |
| P4-02 | Session timeline UI | complete | [progress](P4-02-session-window-ui.md) | [review](../reviews/P4-02-03-session-ui.md) |
| P4-03 | Session list in Control Panel | complete | [progress](P4-03-session-list.md) | [review](../reviews/P4-02-03-session-ui.md) |

| P5-01 | Global opacity controls + click-through | complete | [progress](P5-01-opacity-controls.md) | [review](../reviews/P5-01-02-opacity-and-persistence.md) |
| P5-02 | Window state persistence | complete | [progress](P5-02-window-persistence.md) | [review](../reviews/P5-01-02-opacity-and-persistence.md) |
| P5-03 | Styling polish | complete | [progress](P5-03-styling-polish.md) | [review](../reviews/P5-03-styling-polish.md) |

| P6-01 | Control Panel cleanup | complete | [progress](P6-01-control-panel-cleanup.md) | — |
| P6-02 | Open notes from kanban cards | complete | [progress](P6-02-kanban-open-notes.md) | — |
| P6-03 | NoteList ticket label cleanup | complete | [progress](P6-03-notelist-cleanup.md) | — |
| P6-04 | Window minimum size | complete | [progress](P6-04-window-min-size.md) | — |
| P6-05 | Inline note rename | complete | [progress](P6-05-note-rename.md) | — |
| P6-06 | Note content preview | complete | [progress](P6-06-note-preview.md) | — |
| P6-07 | Note activity sections | complete | [progress](P6-07-note-activity-sections.md) | — |
| P6-08 | Session project accordion | complete | [progress](P6-08-session-accordion.md) | — |
| P6-09 | Session window & timeline polish | complete | [progress](P6-09-session-polish.md) | — |

## Phase Summary
- Phase 1 — Skeleton: 5/5 tasks complete
- Phase 2 — Notes: 4/4 tasks complete
- Phase 3 — Control Panel: 4/4 tasks complete
- Phase 4 — Claude Session Tracking: 3/3 tasks complete
- Phase 5 — Overlay & Polish: 3/3 tasks complete
- Phase 6 — User Feedback Round 1: 9/9 tasks complete

## User Testing Feedback

### Round 1 (critical fixes)
See [docs/feedback/user-testing-round1.md](../feedback/user-testing-round1.md) — 7 issues found and fixed (F1–F7).

### Round 2 (polish & features)
See [docs/feedback/user-testing-round1.md](../feedback/user-testing-round1.md) — 11 items addressed (F8–F18):

**Bug fixes:**
- F8: Session window controls → icon buttons, toolbar container
- F9: Kanban cards → clickable note titles
- F10: NoteList → removed link/unlink UI, kept ticket badge
- F11: Removed "New Session" button
- F12: Removed DB status display
- F13: Removed "Control Panel" badge
- F14: Note/session window minimum sizes

**New features:**
- F15: Inline note rename (double-click title)
- F16: Note content preview (100-char plain-text)
- F17: Note activity sections (Starred / Open / Recent / Inactive)
- F18: Session accordion with "Open All" per project

| P7-01 | MDXEditor toolbar fix | complete | [progress](P7-01-toolbar-fix.md) | — |
| P7-02 | NoteList horizontal columns | complete | [progress](P7-02-notelist-columns.md) | — |
| P7-03 | Ticket descriptions + session linking | complete | [progress](P7-03-ticket-descriptions.md) | — |
| P7-04 | Session timeline enhancements | complete | [progress](P7-04-session-timeline.md) | — |
| P7-05 | Note deletion closes window | complete | [progress](P7-05-note-delete-window.md) | — |
| P7-06 | Editor toolbar simplification + scroll fix | complete | [progress](P7-06-editor-toolbar.md) | — |
| P7-07 | Note ticket status labels | complete | [progress](P7-07-note-ticket-status.md) | — |
| P7-08 | Board DnD fix (overflow + monitor stability + card drop targets) | complete | [progress](P7-08-board-dnd-fix.md) | — |

- Phase 7 — User Feedback Rounds 2 & 3: 8/8 tasks complete

### Round 3 (layout & tooling)
See Round 2/3 progress files — 8 items addressed (F19–F26):

**Bug fixes:**
- F19: MDXEditor toolbar CSS root cause — `.mdxeditor > div` selector overriding toolbar flex
- F20: Note deletion now closes the open window before deleting
- F21: Board overflow changed to allow DnD across columns

**Layout & polish:**
- F22: NoteList horizontal columns (Starred pinned, Open/Recent/Inactive side-by-side)
- F23: Editor toolbar simplified to 1 line (removed UndoRedo, BlockTypeSelect, DiffSourceToggleWrapper)
- F24: Toolbar CSS set to `flex-wrap: nowrap; flex-shrink: 0`

**Session timeline:**
- F25: Tool results show which tool completed (e.g., "Edit completed" not just "Completed")
- F26: Vague system events filtered out, consistent label widths, full-width expanded view

**Kanban & notes:**
- F27: Ticket descriptions + linked sessions on kanban cards
- F28: Notes linked to tickets show ticket column/status label

## Project Status
ACTIVE — All phases delivered. Three rounds of user testing feedback applied.
