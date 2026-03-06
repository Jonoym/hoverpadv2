# ADR-005: Kanban Drag-and-Drop Library & Calendar View

## Status
**Accepted**

## Context
The Control Panel needs a kanban board with drag-and-drop (cards between columns, reorder within columns) and a calendar view showing tickets by due date and notes/sessions by creation date.

---

## Part 1: Kanban Drag-and-Drop

### Options Considered

| Criterion | @dnd-kit | react-beautiful-dnd | Pragmatic D&D (Atlassian) | Custom HTML5 |
|---|---|---|---|---|
| Bundle size | 12-15 KB | 30 KB | **4.7-10 KB** | 0 KB |
| TypeScript | Excellent | Adequate | **Excellent** | N/A |
| Maintenance | **Stalled** | **Archived** | **Active (Atlassian-backed)** | Self |
| Kanban fit | Excellent | Excellent | **Excellent** | Possible |
| Desktop fit | Excellent | Fine | **Excellent** | Quirky |

### Decision: Pragmatic Drag and Drop (`@atlaskit/pragmatic-drag-and-drop`)

### Rationale
1. **Smallest bundle** (4.7 KB core) — matters for a desktop overlay app
2. **Actively maintained by Atlassian** — powers Jira, Trello, Confluence. Strong commercial incentive for long-term support
3. **Built for this exact use case** — Atlassian literally built it for kanban boards
4. **Framework-agnostic core** — low-level `draggable()` / `dropTargetForElements()` primitives integrate cleanly with SQLite persistence via Tauri commands
5. **No mobile/touch baggage** — doesn't ship code for platforms we don't target
6. **@dnd-kit risk:** The original author stepped back and the repo saw minimal activity through 2024-2025. A rewrite alpha was published but never stabilised.
7. **react-beautiful-dnd:** Archived by Atlassian in late 2023. They explicitly recommend Pragmatic D&D as the replacement.

### Packages
- `@atlaskit/pragmatic-drag-and-drop` — core draggable/droppable primitives
- `@atlaskit/pragmatic-drag-and-drop-hitbox` — `closestEdge` detection for reordering within columns
- `@atlaskit/pragmatic-drag-and-drop-react-drop-indicator` — optional styled drop indicator lines

---

## Part 2: Calendar View

### Options Considered

| Criterion | react-big-calendar | FullCalendar | Custom CSS Grid |
|---|---|---|---|
| Bundle size | 40-50 KB | 40-45 KB | 0 KB |
| TypeScript | Community types | **First-class** | N/A |
| Customizability | Good | **Excellent** | Total |
| Maintenance | Moderate | **Active** | Self |

### Decision: Phased approach — custom month view first, FullCalendar if week/day views are needed later

### Rationale

The calendar is primarily **display-focused** (showing items on dates), not a scheduling calendar (drag-to-create, drag-to-resize, recurring events).

**Phase 1 (with kanban in Phase 3): Custom month-view calendar**
- A month grid is simple: 7 columns, 5-6 rows, render items in each cell
- Primary use case is "see what's happening each day" — coloured dots/chips, not time-precision scheduling
- Custom view matches the app's design language without fighting library CSS
- Zero additional bundle size
- "Click a day" interaction is trivially implemented

**Phase 2 (if week/day views prove necessary): Add FullCalendar**
- Week/day views with proper time-slot layout and overlapping event handling are genuinely complex to build from scratch
- FullCalendar's TypeScript support, active maintenance, and content injection system make it the best library choice
- MIT-licensed packages (`@fullcalendar/daygrid`, `@fullcalendar/timegrid`, `@fullcalendar/interaction`) cover all needs without a paid license

### FullCalendar Packages (if needed later)
- `@fullcalendar/core`
- `@fullcalendar/react`
- `@fullcalendar/daygrid`
- `@fullcalendar/timegrid`
- `@fullcalendar/interaction`

---

## Integration Notes

Both kanban and calendar operate on the same data (tickets, notes, sessions) but care about different fields:
- **Kanban** reads tickets grouped by `column_id`, ordered by `column_order`
- **Calendar** reads tickets by `due_date`, notes by `created_at`

Both are rendering-layer only — they don't own state. SQLite via Tauri commands is the source of truth. The two libraries have zero coupling.

## Consequences
- Pragmatic D&D is low-level — more implementation work than a higher-level library, but full control over integration with Tauri IPC and SQLite
- Custom month calendar means building date grid logic, but avoids 40+ KB of library for a simple view
- FullCalendar can be added incrementally later without affecting existing code
