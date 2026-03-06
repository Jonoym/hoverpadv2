# P4-01: Session Discovery + Log Tailing

## Objective
Detect running Claude Code CLI sessions and tail their JSONL log files for real-time event streaming. This is the Rust-side backend that feeds data to the session windows.

## Scope

### Rust Backend Commands
Create Tauri commands in `src-tauri/src/` for session operations:

- `discover_sessions` — scan `~/.claude/projects/` for active session directories, return list of session metadata
- `start_tailing(session_id)` — begin tailing a session's JSONL file, emit parsed events to frontend via Tauri events
- `stop_tailing(session_id)` — stop tailing a specific session
- `list_active_tails` — return which sessions are currently being tailed

### Session Discovery
- Scan `~/.claude/projects/` directory structure
- Each subdirectory is an encoded project path (e.g., `C--Users-Jono-Projects-ai-hoverpad`)
- Within each project dir, `.jsonl` files are session logs
- Decode the directory name to get the original working directory
- Cross-reference with `~/.claude/history.jsonl` for session metadata

### Log Tailing (Rust)
- Use `tokio` async file reading with seek-to-end for new sessions
- Use `notify` crate for file change detection (cross-platform: macOS FSEvents, Windows ReadDirectoryChanges)
- On each new line: parse JSON, classify by `type` field, emit to frontend
- Throttle `progress` events (~78% of entries) — emit at most 1 per second per session
- Handle file rotation/truncation gracefully

### Event Emission
- Emit parsed events as Tauri events: `session:event:{session_id}`
- Event payload: `{ type, timestamp, toolName?, summary? }`
- Separate event for session lifecycle: `session:status` (started, ended, errored)

### SQLite Integration
- On session discovery: insert/update `sessions` table
- On session events: optionally insert into `session_events` table (configurable — can be heavy)
- Auto-create project group in `session_groups` if working_dir is new

### Tauri Capabilities
- Add `fs:allow-read` scope for `$HOME/.claude/**` (already in capabilities)
- May need process-related permissions

## Out of Scope
- Session window UI (P4-02)
- Process detection via PID scanning (simplify to file-based discovery)
- Sub-agent tracking (future enhancement)

## Acceptance Criteria
1. `discover_sessions` returns a list of sessions from `~/.claude/projects/`
2. Directory names are decoded to original project paths
3. `start_tailing` begins streaming events from a JSONL file
4. Events are emitted to the frontend via Tauri events
5. `progress` events are throttled to 1/second
6. Sessions table is updated on discovery
7. Tailing handles file growth (new lines appended) correctly

## Status
complete

## Review
PASS — [review](../reviews/P4-01-session-discovery.md)
