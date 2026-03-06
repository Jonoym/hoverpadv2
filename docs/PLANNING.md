# Hoverpad - Foundation Planning Document

## Project Overview

Hoverpad is a desktop overlay application for managing notes and tracking Claude Code CLI sessions. It runs as a collection of transparent, always-on-top windows that can be toggled on/off with hotkeys. The application provides a centralised Control Panel for organising work through kanban boards and a calendar view, while individual notes and session monitors live in their own draggable, opacity-controlled windows.

## Tech Stack

| Layer | Technology | ADR |
|-------|-----------|-----|
| Framework | Tauri v2 | [ADR-008](adrs/ADR-008-tauri-overlay-windows.md) |
| Frontend | React + TypeScript | — |
| Styling | Tailwind CSS v4 + shadcn/ui | [ADR-001](adrs/ADR-001-css-framework.md) |
| Markdown Editor | MDXEditor | [ADR-007](adrs/ADR-007-markdown-editor.md) |
| Database | SQLite (via `tauri-plugin-sql`) | — |
| Note Storage | Markdown files on disk + SQLite metadata index | [ADR-006](adrs/ADR-006-note-filename-strategy.md) |
| State Management | Zustand (global synced + local stores per window) | [ADR-002](adrs/ADR-002-state-management.md) |
| Kanban Drag-and-Drop | Pragmatic Drag and Drop (Atlassian) | [ADR-005](adrs/ADR-005-kanban-dnd-and-calendar.md) |
| Calendar | Custom month view (FullCalendar if week/day needed later) | [ADR-005](adrs/ADR-005-kanban-dnd-and-calendar.md) |

---

## Architecture

### 1. Windowing Model

**Decision: OS-level multi-window via Tauri**

Every note and session monitor is its own native OS window. The Control Panel is the primary window.

| Window Type | Purpose | Count |
|-------------|---------|-------|
| Control Panel | Central hub — kanban, calendar, note/session list | 1 (singleton) |
| Note Window | Individual markdown note editor | 0..N |
| Session Window | Claude Code CLI session monitor | 0..N |

**Window Properties (shared across all types):**
- Always-on-top by default
- Adjustable opacity (transparent overlay mode)
- Click-through when fully transparent or below an opacity threshold
- Draggable, resizable
- Frameless with custom title bar (rounded macOS-style)
- Consistent styling between Note and Session windows

**Tauri Implementation Details:**
- Each window is created via `WebviewWindow::new()` from the Rust backend or `new WebviewWindow()` from the JS API
- Window state (position, size, opacity) persisted in SQLite so windows reopen where they were
- IPC between windows uses Tauri's event system (`emit` / `listen`) for cross-window communication
- The Control Panel is the "owner" — closing it closes all child windows

### 2. Note System

**Storage: Hybrid (Markdown files + SQLite index)**

Notes are stored as `.md` files in a configurable local directory (default: `~/hoverpad/notes/`). SQLite maintains an index for metadata, search, and relationships.

**Markdown File (source of truth for content):**
```
~/hoverpad/notes/
  ├── 2026-03-07-project-kickoff.md
  ├── 2026-03-07-api-design.md
  └── .../
```

**SQLite Metadata Record:**
```sql
CREATE TABLE notes (
  id          TEXT PRIMARY KEY,  -- UUID
  title       TEXT NOT NULL,
  file_path   TEXT NOT NULL UNIQUE,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ticket_id   TEXT REFERENCES tickets(id),
  is_open     BOOLEAN NOT NULL DEFAULT 0,
  window_state JSON  -- { x, y, width, height, opacity }
);
```

**Editor: MDXEditor**
- Rich WYSIWYG Markdown editing with live preview
- Supports standard Markdown (headings, lists, code blocks, links, images)
- MDXEditor plugins to evaluate: toolbar, lists, headings, code highlighting, markdown shortcuts
- Content is auto-saved on change (debounced ~1s) — writes to the `.md` file and updates `updated_at` in SQLite
- File watcher on the notes directory to detect external edits

**Note Lifecycle:**
1. User presses `Ctrl/Cmd + N` or clicks "New Note" in Control Panel
2. Tauri creates a new `.md` file and SQLite record
3. A new OS window opens with MDXEditor loaded
4. Edits auto-save to disk + update SQLite metadata
5. Closing the window sets `is_open = false` but preserves the note
6. Reopening from Control Panel restores window position/size/opacity

### 3. Claude Code Session Tracking

**Approach: Tail Claude Code session logs + process detection**

**Cross-platform requirement: Must work on both macOS and Windows.**

Hoverpad discovers active Claude Code CLI sessions by scanning for running processes and tailing their session log files for real-time event streaming.

**Detection & Monitoring Strategy:**

See full log format research in [`docs/research/claude-code-logs.md`](research/claude-code-logs.md).

1. **Session discovery:** Watch `~/.claude/projects/` for new `.jsonl` files appearing. Cross-reference with `~/.claude/history.jsonl` which contains `sessionId`, `project` path, and `timestamp` for every user prompt. On macOS this is `~/.claude/`, on Windows `C:\Users\<name>\.claude\` — same structure on both platforms.
2. **Project path resolution:** Claude Code encodes project paths by replacing separators with dashes (e.g. `C:\Users\Jono\Projects\ai\hoverpad` -> `C--Users-Jono-Projects-ai-hoverpad/`). Reverse this encoding to derive the original `working_dir` for automatic project grouping.
3. **Log file tailing:** Tail the active session JSONL file (`~/.claude/projects/<encoded-path>/<session-id>.jsonl`) using Rust async file watching (`notify` crate + seek-to-end reading). Each line is a self-contained JSON object.
4. **Event parsing:** Parse JSONL entries by `type` field:
   - `assistant` entries with `tool_use` content blocks → tool calls (tool name, input, timestamps)
   - `user` entries with `toolUseResult` → tool results (stdout, stderr, success/failure)
   - `progress` entries → real-time tool execution updates (bash output, elapsed time) — **these are ~78% of all entries**, filter or throttle for UI display
   - `system` entries with `subtype: "turn_duration"` → turn completion timing
5. **Lifecycle detection:** Session start = new JSONL file appears. Session end = process disappears (via `sysinfo` crate PID scanning) or no new writes for a configurable timeout.
6. **Sub-agent tracking:** Monitor `<session-id>/subagents/agent-<id>.jsonl` files for Task tool sub-conversations.

**Important: Log Retention**
Claude Code deletes logs after 30 days by default. Hoverpad should warn users to set `"cleanupPeriodDays"` in `~/.claude/settings.json` or optionally copy relevant log data into its own SQLite database for long-term retention.

**Session Grouping:**

Sessions can be grouped in two ways:

- **By project (automatic):** Sessions are auto-grouped by their `working_dir`. The Control Panel shows a collapsible project tree where each project directory contains its sessions. This is derived from the process's cwd at detection time.
- **By manual group:** Users can create custom groups and drag sessions into them from the Control Panel. A session can belong to one project group (automatic) and one manual group simultaneously.

**SQLite Schema:**
```sql
CREATE TABLE session_groups (
  id          TEXT PRIMARY KEY,  -- UUID
  name        TEXT NOT NULL,
  group_type  TEXT NOT NULL,     -- 'project' | 'manual'
  project_dir TEXT,              -- populated for project groups, NULL for manual
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE sessions (
  id            TEXT PRIMARY KEY,  -- UUID
  pid           INTEGER,           -- OS process ID
  started_at    DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ended_at      DATETIME,
  status        TEXT NOT NULL DEFAULT 'active',  -- active | completed | errored
  working_dir   TEXT,
  project_group_id TEXT REFERENCES session_groups(id),  -- auto-assigned by working_dir
  manual_group_id  TEXT REFERENCES session_groups(id),  -- user-assigned
  ticket_id     TEXT REFERENCES tickets(id),
  window_state  JSON
);

CREATE TABLE session_events (
  id          TEXT PRIMARY KEY,
  session_id  TEXT NOT NULL REFERENCES sessions(id),
  timestamp   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  event_type  TEXT NOT NULL,  -- tool_call | response | error | status_change
  tool_name   TEXT,
  payload     JSON
);
```

**Session Window UI:**
- Scrollable timeline of tool calls and events, formatted with icons/labels per tool type
- Status indicator: colour-coded header (green = active, amber = idle, red = errored, blue = completed)
- Auto-scroll to latest event with option to scroll up through history
- Compact mode showing just tool names + timestamps, expandable to full detail

**Alerting:**
- Window border/header colour transitions when session completes (active green -> completed blue)
- Optional system notification on session completion

### 4. Control Panel

**Behaviour: Collapsible overlay**

- **Collapsed state:** Small tab pinned to the top of the screen (e.g. 200px wide, 30px tall). Shows app icon + quick stats (open notes count, active sessions count). Hovering or clicking expands it.
- **Expanded state:** Full panel showing all notes, sessions, kanban board, and calendar.

**Views:**

#### 4a. Notes & Sessions List
- Grid or list of all notes (open and closed) with title, last modified, linked ticket
- List of all Claude sessions with status, start time, working directory
- Quick actions: open, close, delete, link to ticket

#### 4b. Kanban Board
- Configurable columns (e.g. Backlog, In Progress, Review, Done)
- Cards are **tickets** (separate entity from notes/sessions)
- Tickets can have linked notes and linked sessions displayed as chips/badges on the card
- Drag-and-drop between columns
- Create ticket inline or via modal

#### 4c. Calendar View
- Month/week/day views
- Tickets placed on their due date
- Notes and sessions shown on their creation date (or linked ticket's date)
- Click a day to see all associated items

**Schemas:**
```sql
CREATE TABLE kanban_columns (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL,
  created_at  DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Seed with defaults
INSERT INTO kanban_columns (id, name, sort_order) VALUES
  ('backlog', 'Backlog', 0),
  ('in_progress', 'In Progress', 1),
  ('review', 'Review', 2),
  ('done', 'Done', 3);

CREATE TABLE tickets (
  id           TEXT PRIMARY KEY,  -- UUID
  title        TEXT NOT NULL,
  description  TEXT,
  column_id    TEXT NOT NULL REFERENCES kanban_columns(id),
  column_order INTEGER NOT NULL DEFAULT 0,
  due_date     DATE,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```
See [ADR-004](adrs/ADR-004-kanban-columns.md) for rationale on configurable columns.

### 5. Global Hotkeys & Overlay Controls

**Hotkeys (registered globally via Tauri):**

| Shortcut | Action |
|----------|--------|
| `Ctrl/Cmd + N` | Open a new note window |
| `Ctrl + ,` | Decrease opacity of all windows by 10% |
| `Ctrl + .` | Increase opacity of all windows by 10% |
| `Ctrl + H` | Toggle all windows visible/hidden |
| TBD | Toggle Control Panel expand/collapse |

**Overlay Behaviour:**
- All windows are `always_on_top` and `transparent` (Tauri window config)
- Opacity is adjustable per-window AND globally via hotkey
- Below a configurable opacity threshold (e.g. 20%), windows become click-through using `set_ignore_cursor_events(true)` in Tauri
- A "show/hide all" hotkey toggles visibility of every Hoverpad window at once

**Implementation Notes:**
- Global hotkeys via `tauri-plugin-global-shortcut`
- Opacity state stored in each window's `window_state` JSON in SQLite
- Cross-window opacity sync via Tauri event broadcast

### 6. Styling

**Direction: Modern macOS-inspired**

- Frameless windows with custom title bar (drag region + window controls)
- Rounded corners (border-radius on window container, Tauri's `decorations: false`)
- Subtle backdrop blur / frosted glass effect where supported
- Dark mode by default with potential light mode toggle
- Consistent card-based UI for notes and session windows
- Colour palette TBD — lean toward neutral dark with accent colours for status indicators

**Shared Window Chrome:**
Note windows and Session windows use the same outer shell:
- Custom title bar with drag handle, opacity slider, close/minimize buttons
- Rounded container with subtle border
- Only the inner content differs (MDXEditor vs session timeline)

---

## Data Flow

```
[Claude CLI Process] --> [Log Files (~/.claude/)]
                                |
              [Rust Backend: File Watcher + Process Scanner]
                                |
                          [Tauri Events]
                                |
                  [Session Window UI] + [SQLite: session_events]

[MDXEditor in Note Window] --onChange--> [Rust Backend: File Writer]
                                            |
                                  [.md file on disk] + [SQLite: notes metadata]

[Control Panel UI] --Tauri Commands--> [Rust Backend: DB queries]
                                            |
                                  [SQLite: tickets, notes, sessions]
```

---

## Resolved Decisions

All architectural decisions have been researched and documented. See `docs/adrs/` for full details.

| ID | Decision | Outcome |
|----|----------|---------|
| [ADR-001](adrs/ADR-001-css-framework.md) | CSS framework | **Tailwind CSS v4 + shadcn/ui** |
| [ADR-002](adrs/ADR-002-state-management.md) | State management | **Zustand** (global synced store + local store per window) |
| ADR-003 | Claude CLI monitoring | **Log file tailing + process detection** |
| [ADR-004](adrs/ADR-004-kanban-columns.md) | Kanban columns | **Configurable with sensible defaults** (schema ready, UI deferred) |
| [ADR-005](adrs/ADR-005-kanban-dnd-and-calendar.md) | Kanban DnD + Calendar | **Pragmatic Drag and Drop** + custom month view (FullCalendar later if needed) |
| [ADR-006](adrs/ADR-006-note-filename-strategy.md) | Note filenames | **Date + UUID short** (`2026-03-07-a1b2c3d4.md`) |
| [ADR-007](adrs/ADR-007-markdown-editor.md) | Markdown editor | **MDXEditor** (Milkdown as fallback) |
| [ADR-008](adrs/ADR-008-tauri-overlay-windows.md) | Overlay windows | **Frameless transparent + platform-specific Rust for macOS fullscreen** |

---

## Implementation Phases

### Phase 1 — Skeleton
- Tauri v2 project scaffold with React + TypeScript
- Multi-window infrastructure (create/destroy/position windows)
- Global hotkey registration
- SQLite database initialisation with schema
- Basic frameless window chrome with drag + close

### Phase 2 — Notes
- MDXEditor integration in note windows
- Note CRUD (create, open, edit, save, delete)
- Hybrid storage (file write + SQLite metadata)
- Auto-save with debounce
- Note listing in Control Panel

### Phase 3 — Control Panel
- Collapsible panel behaviour (tab at top of screen <-> expanded view)
- Notes and sessions list view
- Basic kanban board with tickets + drag-and-drop
- Link notes/sessions to tickets

### Phase 4 — Claude Session Tracking
- Process detection for running Claude CLI instances
- Event parsing and real-time streaming to session windows
- Session timeline UI with formatted tool calls
- Status colour indicators and completion alerts

### Phase 5 — Overlay & Polish
- Global opacity controls (Ctrl+< / Ctrl+>)
- Click-through at low opacity
- Show/hide all toggle
- Window state persistence (restore positions on relaunch)
- Calendar view
- Styling polish (blur, animations, transitions)
