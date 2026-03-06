# P4-02: Session Timeline UI

## Objective
Build the session window UI that displays a real-time timeline of Claude Code CLI events, formatted with icons and labels per tool type, with status color indicators.

## Scope

### Session Window Component
Replace the placeholder in `src/pages/SessionWindow.tsx` with:
- Scrollable timeline of tool calls and events
- Auto-scroll to latest event with option to scroll up through history
- Status indicator in the title bar (color-coded via WindowChrome badge)

### Event Timeline
- Each event rendered as a timeline item with:
  - Timestamp (relative or absolute, toggleable)
  - Event type icon (tool call, response, error, status change)
  - Tool name (for tool_call events)
  - Summary text (truncated, expandable)
- Compact mode: just tool names + timestamps in a single line
- Expanded mode: full payload details

### Status Colors
- Active (green): session is running, receiving events
- Idle (amber): no events for 30+ seconds
- Errored (red): last event was an error
- Completed (blue): session ended normally
- Map to WindowChrome badge colors: emerald, amber, red (use purple for completed since blue is taken by notes)

### Event Parsing
- Listen for `session:event:{sessionId}` Tauri events
- Parse event types: tool_call, response, error, status_change
- Format tool calls with their tool name (e.g., "Bash", "Edit", "Read")
- Format responses with success/failure status

### Session Controls
- Play/pause tailing (toggle button)
- Clear event log
- Toggle compact/expanded mode

## Out of Scope
- Process detection (P4-01 handles discovery)
- Session grouping UI (future — Control Panel feature)
- System notifications on completion (Phase 5)

## Acceptance Criteria
1. Session window displays a scrollable timeline of events
2. Events are formatted with timestamp, type icon, and tool name
3. Status indicator changes color based on session state
4. Auto-scroll follows new events
5. Compact and expanded view modes work
6. Session window receives real-time events from the Rust backend

## Status
done

## Review
[P4-02-03-session-ui](../reviews/P4-02-03-session-ui.md) — PASS
