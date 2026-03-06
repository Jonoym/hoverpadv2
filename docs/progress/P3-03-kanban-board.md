# P3-03: Kanban Board with Tickets + Drag-and-Drop

## Objective
Build a kanban board in the Control Panel where users can create tickets, organize them in columns, and drag them between columns. Uses Pragmatic Drag and Drop per ADR-005.

## Scope

### Ticket Service (`src/lib/ticketService.ts`)
- `createTicket(title, columnId?)` — creates a ticket in the specified column (default: Backlog)
- `updateTicket(id, updates)` — update title, description, column, order, due_date
- `deleteTicket(id)` — remove ticket
- `listTickets()` — all tickets grouped by column, ordered by column_order
- `moveTicket(id, columnId, position)` — move to column at position, reorder siblings
- `listColumns()` — all kanban columns ordered by sort_order

### Kanban Components
- `KanbanBoard` — container that renders columns side by side
- `KanbanColumn` — drop zone with column header and ticket cards
- `KanbanCard` — draggable card showing ticket title, linked items count, due date
- `CreateTicketInline` — inline input at bottom of each column for quick ticket creation

### Drag and Drop
- Use `@atlaskit/pragmatic-drag-and-drop` (core + hitbox + react-drop-indicator)
- Cards are draggable between columns
- Drop indicators show insertion point
- On drop: call `moveTicket()` to update column_id and column_order in SQLite

### UI Layout
- Add a tab bar or view switcher to ControlPanel: "Notes" | "Board" | (future: "Calendar")
- Board view shows the kanban columns horizontally with overflow scroll
- Each column has a fixed width (~250px), scrollable vertically for many cards

### Styling
- Column headers: neutral-700 background, column name
- Cards: neutral-800 with hover:neutral-700, rounded-lg, subtle border
- Drag preview: semi-transparent clone of the card
- Drop indicator: blue line between cards

## Out of Scope
- Linking notes/sessions to tickets (P3-04)
- Calendar view (Phase 5)
- Ticket detail modal/editor (keep it simple — inline edit for now)

## Acceptance Criteria
1. Kanban board renders all columns from the database
2. Tickets can be created inline at the bottom of a column
3. Tickets display title and optional due date
4. Tickets can be dragged between columns
5. Drop position is persisted (column_order updated in SQLite)
6. Control Panel has a view switcher between Notes and Board views

## Status
complete

## Review
[P3-03-kanban.md](../reviews/P3-03-kanban.md) — PASS
