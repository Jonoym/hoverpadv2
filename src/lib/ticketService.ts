import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketTag {
  id: string;
  name: string;
  color: string;
}

export interface ChecklistItem {
  id: string;
  ticketId: string;
  label: string;
  checked: boolean;
  sortOrder: number;
}

export interface TicketMeta {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  columnOrder: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
  archived: boolean;
  expanded: boolean;
  tags: TicketTag[];
  checklist: ChecklistItem[];
}

export interface KanbanColumn {
  id: string;
  name: string;
  sortOrder: number;
}

/** Shape of the row returned by SQLite SELECT on the tickets table. */
interface TicketRow {
  id: string;
  title: string;
  description: string | null;
  column_id: string;
  column_order: number;
  due_date: string | null;
  created_at: string;
  updated_at: string;
  archived: number;
  expanded: number;
}

interface ChecklistRow {
  id: string;
  ticket_id: string;
  label: string;
  checked: number;
  sort_order: number;
}

/** Shape of the row returned by SQLite SELECT on the kanban_columns table. */
interface ColumnRow {
  id: string;
  name: string;
  sort_order: number;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function rowToTicket(row: TicketRow, tags: TicketTag[] = [], checklist: ChecklistItem[] = []): TicketMeta {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    columnId: row.column_id,
    columnOrder: row.column_order,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archived: row.archived === 1,
    expanded: row.expanded === 1,
    tags,
    checklist,
  };
}

interface TagRow {
  id: string;
  name: string;
  color: string;
}

interface TagMemberRow {
  ticket_id: string;
  tag_id: string;
  tag_name: string;
  tag_color: string;
}

function rowToChecklist(row: ChecklistRow): ChecklistItem {
  return {
    id: row.id,
    ticketId: row.ticket_id,
    label: row.label,
    checked: row.checked === 1,
    sortOrder: row.sort_order,
  };
}

/** Fetch all checklist items and group them by ticket_id. */
async function fetchChecklistsByTicket(): Promise<Map<string, ChecklistItem[]>> {
  const db = await getDatabase();
  const rows = await db.select<ChecklistRow[]>(
    "SELECT * FROM ticket_checklist_items ORDER BY sort_order ASC",
  );
  const map = new Map<string, ChecklistItem[]>();
  for (const row of rows) {
    const item = rowToChecklist(row);
    const existing = map.get(row.ticket_id);
    if (existing) {
      existing.push(item);
    } else {
      map.set(row.ticket_id, [item]);
    }
  }
  return map;
}

function rowToColumn(row: ColumnRow): KanbanColumn {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
  };
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * List all kanban columns ordered by sort_order.
 */
export async function listColumns(): Promise<KanbanColumn[]> {
  const db = await getDatabase();
  const rows = await db.select<ColumnRow[]>(
    "SELECT * FROM kanban_columns ORDER BY sort_order ASC",
  );
  return rows.map(rowToColumn);
}

/**
 * List all tickets ordered by column_order within each column.
 */
export async function listTickets(): Promise<TicketMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<TicketRow[]>(
    "SELECT * FROM tickets WHERE archived = 0 ORDER BY column_id, column_order ASC",
  );

  // Fetch all tag memberships in one query
  const tagMembers = await db.select<TagMemberRow[]>(
    `SELECT ttm.ticket_id, tt.id as tag_id, tt.name as tag_name, tt.color as tag_color
     FROM ticket_tag_members ttm
     JOIN ticket_tags tt ON tt.id = ttm.tag_id`,
  );

  // Group tags by ticket
  const tagsByTicket = new Map<string, TicketTag[]>();
  for (const tm of tagMembers) {
    const existing = tagsByTicket.get(tm.ticket_id);
    const tag: TicketTag = { id: tm.tag_id, name: tm.tag_name, color: tm.tag_color };
    if (existing) {
      existing.push(tag);
    } else {
      tagsByTicket.set(tm.ticket_id, [tag]);
    }
  }

  // Fetch all checklist items
  const checklistByTicket = await fetchChecklistsByTicket();

  return rows.map((r) => rowToTicket(r, tagsByTicket.get(r.id) ?? [], checklistByTicket.get(r.id) ?? []));
}

/**
 * Create a new ticket in the specified column (defaults to "backlog").
 * The ticket is appended at the end of the column (highest column_order + 1).
 */
export async function createTicket(
  title: string,
  columnId: string = "backlog",
): Promise<TicketMeta> {
  const db = await getDatabase();
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  // Get the next column_order for this column
  const maxRows = await db.select<{ max_order: number | null }[]>(
    "SELECT MAX(column_order) as max_order FROM tickets WHERE column_id = $1",
    [columnId],
  );
  const nextOrder = (maxRows[0]?.max_order ?? -1) + 1;

  await db.execute(
    `INSERT INTO tickets (id, title, column_id, column_order, created_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [id, title, columnId, nextOrder, now, now],
  );

  return {
    id,
    title,
    description: null,
    columnId,
    columnOrder: nextOrder,
    dueDate: null,
    createdAt: now,
    updatedAt: now,
    archived: false,
    expanded: false,
    tags: [],
    checklist: [],
  };
}

/**
 * Update a ticket's title, description, or due date.
 */
export async function updateTicket(
  id: string,
  updates: Partial<Pick<TicketMeta, "title" | "description" | "dueDate">>,
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  const setClauses: string[] = ["updated_at = $1"];
  const params: unknown[] = [now];
  let paramIndex = 2;

  if (updates.title !== undefined) {
    setClauses.push(`title = $${paramIndex}`);
    params.push(updates.title);
    paramIndex++;
  }
  if (updates.description !== undefined) {
    setClauses.push(`description = $${paramIndex}`);
    params.push(updates.description);
    paramIndex++;
  }
  if (updates.dueDate !== undefined) {
    setClauses.push(`due_date = $${paramIndex}`);
    params.push(updates.dueDate);
    paramIndex++;
  }

  params.push(id);
  await db.execute(
    `UPDATE tickets SET ${setClauses.join(", ")} WHERE id = $${paramIndex}`,
    params,
  );
}

/**
 * Delete a ticket by ID.
 */
export async function deleteTicket(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM tickets WHERE id = $1", [id]);
}

/**
 * Move a ticket to a new column at a specific position.
 * Shifts existing tickets in the target column to make room.
 */
export async function moveTicket(
  id: string,
  columnId: string,
  position: number,
): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  // Shift existing tickets in the target column at or after the target position
  await db.execute(
    `UPDATE tickets SET column_order = column_order + 1
     WHERE column_id = $1 AND column_order >= $2 AND id != $3`,
    [columnId, position, id],
  );

  // Move the ticket to the target column and position
  await db.execute(
    `UPDATE tickets SET column_id = $1, column_order = $2, updated_at = $3
     WHERE id = $4`,
    [columnId, position, now, id],
  );
}

// ---------------------------------------------------------------------------
// Archiving
// ---------------------------------------------------------------------------

/**
 * List all archived tickets, newest first.
 */
export async function listArchivedTickets(): Promise<TicketMeta[]> {
  const db = await getDatabase();
  const rows = await db.select<TicketRow[]>(
    "SELECT * FROM tickets WHERE archived = 1 ORDER BY updated_at DESC",
  );

  const tagMembers = await db.select<TagMemberRow[]>(
    `SELECT ttm.ticket_id, tt.id as tag_id, tt.name as tag_name, tt.color as tag_color
     FROM ticket_tag_members ttm
     JOIN ticket_tags tt ON tt.id = ttm.tag_id`,
  );

  const tagsByTicket = new Map<string, TicketTag[]>();
  for (const tm of tagMembers) {
    const existing = tagsByTicket.get(tm.ticket_id);
    const tag: TicketTag = { id: tm.tag_id, name: tm.tag_name, color: tm.tag_color };
    if (existing) {
      existing.push(tag);
    } else {
      tagsByTicket.set(tm.ticket_id, [tag]);
    }
  }

  const checklistByTicket = await fetchChecklistsByTicket();

  return rows.map((r) => rowToTicket(r, tagsByTicket.get(r.id) ?? [], checklistByTicket.get(r.id) ?? []));
}

/**
 * Persist the expanded/collapsed state of a ticket card.
 */
export async function setTicketExpanded(id: string, expanded: boolean): Promise<void> {
  const db = await getDatabase();
  await db.execute("UPDATE tickets SET expanded = $1 WHERE id = $2", [expanded ? 1 : 0, id]);
}

/**
 * Archive all tickets in a given column.
 */
export async function archiveColumnTickets(columnId: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();
  await db.execute(
    "UPDATE tickets SET archived = 1, updated_at = $1 WHERE column_id = $2 AND archived = 0",
    [now, columnId],
  );
}

/**
 * Unarchive a ticket and move it to a specific column.
 */
export async function unarchiveTicket(id: string, columnId: string): Promise<void> {
  const db = await getDatabase();
  const now = new Date().toISOString();

  const maxRows = await db.select<{ max_order: number | null }[]>(
    "SELECT MAX(column_order) as max_order FROM tickets WHERE column_id = $1 AND archived = 0",
    [columnId],
  );
  const nextOrder = (maxRows[0]?.max_order ?? -1) + 1;

  await db.execute(
    "UPDATE tickets SET archived = 0, column_id = $1, column_order = $2, updated_at = $3 WHERE id = $4",
    [columnId, nextOrder, now, id],
  );
}

// ---------------------------------------------------------------------------
// Ticket Tags
// ---------------------------------------------------------------------------

/** List all available tags. */
export async function listTags(): Promise<TicketTag[]> {
  const db = await getDatabase();
  const rows = await db.select<TagRow[]>("SELECT * FROM ticket_tags ORDER BY name ASC");
  return rows.map((r) => ({ id: r.id, name: r.name, color: r.color }));
}

/** Create a new tag. Returns the created tag. */
export async function createTag(name: string, color: string = "neutral"): Promise<TicketTag> {
  const db = await getDatabase();
  const id = crypto.randomUUID();
  await db.execute(
    "INSERT INTO ticket_tags (id, name, color) VALUES ($1, $2, $3)",
    [id, name, color],
  );
  return { id, name, color };
}

/** Delete a tag (removes from all tickets too via CASCADE). */
export async function deleteTag(id: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM ticket_tags WHERE id = $1", [id]);
}

/** Add a tag to a ticket. */
export async function addTagToTicket(ticketId: string, tagId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "INSERT OR IGNORE INTO ticket_tag_members (ticket_id, tag_id) VALUES ($1, $2)",
    [ticketId, tagId],
  );
}

/** Remove a tag from a ticket. */
export async function removeTagFromTicket(ticketId: string, tagId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "DELETE FROM ticket_tag_members WHERE ticket_id = $1 AND tag_id = $2",
    [ticketId, tagId],
  );
}

// ---------------------------------------------------------------------------
// Checklist Items
// ---------------------------------------------------------------------------

/** Add a checklist item to a ticket. */
export async function addChecklistItem(ticketId: string, label: string): Promise<ChecklistItem> {
  const db = await getDatabase();
  const id = crypto.randomUUID();

  const maxRows = await db.select<{ max_order: number | null }[]>(
    "SELECT MAX(sort_order) as max_order FROM ticket_checklist_items WHERE ticket_id = $1",
    [ticketId],
  );
  const nextOrder = (maxRows[0]?.max_order ?? -1) + 1;

  await db.execute(
    "INSERT INTO ticket_checklist_items (id, ticket_id, label, checked, sort_order) VALUES ($1, $2, $3, 0, $4)",
    [id, ticketId, label, nextOrder],
  );

  return { id, ticketId, label, checked: false, sortOrder: nextOrder };
}

/** Toggle a checklist item's checked state. */
export async function toggleChecklistItem(itemId: string, checked: boolean): Promise<void> {
  const db = await getDatabase();
  await db.execute(
    "UPDATE ticket_checklist_items SET checked = $1 WHERE id = $2",
    [checked ? 1 : 0, itemId],
  );
}

/** Delete a checklist item. */
export async function deleteChecklistItem(itemId: string): Promise<void> {
  const db = await getDatabase();
  await db.execute("DELETE FROM ticket_checklist_items WHERE id = $1", [itemId]);
}
