# Hoverpad

Desktop overlay app for managing markdown notes and tracking Claude Code CLI sessions. Built with Tauri v2 + React + TypeScript.

## Quick Reference

- **Planning doc:** `docs/PLANNING.md`
- **Research:** `docs/research/`
- **Progress:** `docs/progress/`

## Tech Stack

| Layer | Choice | ADR |
|-------|--------|-----|
| Framework | Tauri v2 | [ADR-008](docs/adrs/ADR-008-tauri-overlay-windows.md) |
| Frontend | React + TypeScript | — |
| Styling | Tailwind CSS v4 + shadcn/ui | [ADR-001](docs/adrs/ADR-001-css-framework.md) |
| State | Zustand (global synced + local per window) | [ADR-002](docs/adrs/ADR-002-state-management.md) |
| Kanban DnD | Pragmatic Drag and Drop (Atlassian) | [ADR-005](docs/adrs/ADR-005-kanban-dnd-and-calendar.md) |
| Calendar | Custom month view (FullCalendar later if needed) | [ADR-005](docs/adrs/ADR-005-kanban-dnd-and-calendar.md) |
| Markdown Editor | MDXEditor | [ADR-007](docs/adrs/ADR-007-markdown-editor.md) |
| Database | SQLite via `tauri-plugin-sql` | — |
| Note Storage | `.md` files on disk + SQLite index | [ADR-006](docs/adrs/ADR-006-note-filename-strategy.md) |
| Kanban Columns | Configurable with defaults | [ADR-004](docs/adrs/ADR-004-kanban-columns.md) |

## Architecture

- **Multi-window:** Each note/session is its own OS-level Tauri window. Control Panel is the main window.
- **State sync:** Zustand global store with `tauriSync` middleware broadcasts via Tauri `emit`/`listen`. Local store per window for editor content, scroll, geometry.
- **Note files:** `~/hoverpad/notes/YYYY-MM-DD-XXXXXXXX.md` (date + UUID short). YAML frontmatter for metadata.
- **Session tracking:** Tail Claude Code JSONL logs at `~/.claude/projects/<encoded-path>/<session-id>.jsonl`. See `docs/research/claude-code-logs.md`.
- **Overlay:** Frameless, transparent, always-on-top. Click-through below opacity threshold. `Ctrl+H` to toggle all.

## Workflow

The project follows an **orchestrator → agent → reviewer** cycle:

1. **Orchestrator** reads `docs/PLANNING.md` and `docs/progress/project.md`, breaks work into tasks, delegates to agents
2. **Agents** implement tasks following the relevant skills (frontend, backend, styling) and ADRs
3. **Reviewer** builds the app, tests the work, writes a review in `docs/reviews/`, and delivers a verdict (pass/fail/partial)
4. **Orchestrator** reads the review verdict and decides: move to next task (pass), re-delegate with fixes (fail), or escalate to user (2x fail)

- **Progress tracker:** `docs/progress/project.md`
- **Per-task progress:** `docs/progress/P{phase}-{nn}-{slug}.md`
- **Reviews:** `docs/reviews/{task-id}-{slug}.md`

## Conventions

- ADRs live in `docs/adrs/` — see ADR writer skill for template
- Research docs in `docs/research/`
- Use Tailwind utility classes; avoid custom CSS except for MDXEditor overrides
- shadcn/ui components as the base — customise, don't wrap
- Zustand stores: `globalStore` (synced) and `localStore` (per window)
- SQLite is source of truth; frontend state is derived
- Note filenames are immutable after creation

## Important

All changes should be documented in docs/progress, docs/feedback, docs/adrs when necessary.`