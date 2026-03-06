# ADR-004: Kanban Column Persistence

## Status
**Accepted**

## Context
The Control Panel includes a kanban board where tickets are the core entity (notes and sessions link to tickets). The existing planning doc had `tickets.status` as a hardcoded string enum (`backlog | in_progress | review | done`). We need to decide whether columns are fixed or user-configurable.

## Options Considered

### A. Hardcoded Columns
- Simpler schema: `tickets.status` is a fixed enum
- No column management UI to build
- **Con:** Not everyone's workflow maps to Backlog/InProgress/Review/Done. Feels rigid for a power-user tool.

### B. Fully User-Configurable
- Users can model their actual workflow
- **Con:** Requires column management UI (add/rename/reorder/delete), column deletion UX is tricky (what happens to tickets?)

### C. Configurable with Sensible Defaults
- Schema supports configurability from day one
- Ship with default columns, defer management UI to later phase
- Avoids painful data migration later

## Decision
**Option C: Configurable with sensible defaults**

## Rationale

Hoverpad is a power-user tool for developers. These users will want to customise their workflow. The schema cost of configurability is trivial (one extra table, one FK change), and it avoids a painful migration from hardcoded strings to a relational model later.

### Schema

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
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT,
  column_id    TEXT NOT NULL REFERENCES kanban_columns(id),
  column_order INTEGER NOT NULL DEFAULT 0,
  due_date     DATE,
  created_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
```

### Phasing
- **Phase 3 (initial):** Render columns from `kanban_columns` table. No add/rename/reorder/delete UI — defaults just work.
- **Phase 5 or later:** Add column management UI. Schema already supports it — purely a frontend task.

### Column Deletion UX (when built)
When the user deletes a column, show a dialog: "Move N tickets to [dropdown of remaining columns] or delete them?" This is the standard pattern (Trello, Jira, Notion).

## Consequences
- Tickets reference `column_id` (FK) instead of a hardcoded status string
- Schema is future-proof from day one — no migration needed when column management UI is added
- Initial implementation is identical complexity to hardcoded columns (just read from a table instead of an enum)
