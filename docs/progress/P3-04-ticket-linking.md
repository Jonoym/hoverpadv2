# P3-04: Link Notes/Sessions to Tickets

## Objective
Allow users to associate notes and sessions with kanban tickets. Linked items appear as badges/chips on the kanban card and in the note/session list.

## Scope

### Linking Operations
- `linkNoteToTicket(noteId, ticketId)` — set `ticket_id` on the notes table row
- `unlinkNote(noteId)` — clear `ticket_id`
- `linkSessionToTicket(sessionId, ticketId)` — set `ticket_id` on sessions table
- `unlinkSession(sessionId)` — clear `ticket_id`
- Add these to `ticketService.ts` or `noteService.ts` as appropriate

### Kanban Card Enhancement
- Show linked note count and session count as small badges on each card
- Clicking a badge expands to show the linked items with quick-open actions

### Note List Enhancement
- Show the linked ticket title (if any) next to each note
- Add a "Link to ticket" dropdown/picker on each note row

### Control Panel Integration
- When viewing a ticket's details, show its linked notes and sessions
- Quick actions: open linked note, create a new note linked to this ticket

## Out of Scope
- Drag-to-link (drag a note onto a ticket card)
- Bulk linking operations

## Acceptance Criteria
1. Notes can be linked to a ticket via the note list UI
2. Kanban cards show linked note/session counts as badges
3. Unlinking a note clears the ticket_id
4. Creating a note from a ticket card auto-links it
5. Linked items are visible from both the ticket and the note views

## Status
complete

## Review
PASS — [review](../reviews/P3-04-ticket-linking.md)
