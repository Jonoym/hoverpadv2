import { getDatabase } from "./database";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface TicketMeta {
  id: string;
  title: string;
  description: string | null;
  columnId: string;
  columnOrder: number;
  dueDate: string | null;
  createdAt: string;
  updatedAt: string;
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

function rowToTicket(row: TicketRow): TicketMeta {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    columnId: row.column_id,
    columnOrder: row.column_order,
    dueDate: row.due_date,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
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
    "SELECT * FROM tickets ORDER BY column_id, column_order ASC",
  );
  return rows.map(rowToTicket);
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
