# Claude Code Session Log Format — Research

## Log File Locations

All Claude Code data lives under `~/.claude/` on both macOS and Windows (no `%APPDATA%` usage).

| Path | Purpose |
|------|---------|
| `~/.claude/projects/<encoded-path>/<session-id>.jsonl` | **Session transcript** — the primary log |
| `~/.claude/projects/<encoded-path>/<session-id>/subagents/agent-<id>.jsonl` | Sub-agent (Task tool) logs |
| `~/.claude/history.jsonl` | Global input history — every user prompt, all projects |
| `~/.claude/debug/<session-id>.txt` | Debug logs (timestamped plaintext) |
| `~/.claude/telemetry/` | Telemetry JSON files |
| `~/.claude/file-history/<session-id>/` | Pre-edit file snapshots |
| `~/.claude/todos/<session-id>-agent-<id>.json` | Per-session task state |

### Project Path Encoding

Path separators are replaced with dashes:
- Windows: `C:\Users\Jono\Projects\ai\hoverpad` -> `C--Users-Jono-Projects-ai-hoverpad/`
- macOS: `/Users/alice/myproject` -> `-Users-alice-myproject/`

## Session JSONL Format

One JSON object per line. Every entry has these common fields:

```json
{
  "uuid": "...",
  "parentUuid": "...",
  "sessionId": "4f9f58b8-fd55-4a4a-af43-7c8520573edc",
  "timestamp": "2026-03-06T14:46:58.127Z",
  "version": "2.1.62",
  "cwd": "/c/Users/Jono/Projects/ai/hoverpad",
  "gitBranch": "main",
  "type": "user | assistant | progress | system | file-history-snapshot",
  "isSidechain": false
}
```

### Entry Types

#### `user` — User prompts and tool results
```json
{
  "type": "user",
  "message": {
    "role": "user",
    "content": "Help me write..."
  },
  "toolUseResult": {
    "stdout": "...",
    "stderr": "...",
    "interrupted": false
  },
  "permissionMode": "default"
}
```

#### `assistant` — Model responses with tool calls
```json
{
  "type": "assistant",
  "message": {
    "model": "claude-opus-4-6",
    "role": "assistant",
    "content": [
      {"type": "thinking", "thinking": "..."},
      {"type": "text", "text": "..."},
      {"type": "tool_use", "id": "toolu_...", "name": "Bash", "input": {...}}
    ],
    "usage": {
      "input_tokens": 3,
      "cache_creation_input_tokens": 22334,
      "cache_read_input_tokens": 10427,
      "output_tokens": 14
    }
  }
}
```

#### `progress` — Real-time tool execution updates (~78% of all entries)
```json
{
  "type": "progress",
  "data": {
    "type": "bash_progress",
    "output": "...",
    "fullOutput": "...",
    "elapsedTimeSeconds": 3
  },
  "toolUseID": "bash-progress-0",
  "parentToolUseID": "toolu_01QwPBoCtxrB8paeaP2zFehU"
}
```

#### `system` — Turn timing metadata
```json
{
  "type": "system",
  "subtype": "turn_duration",
  "durationMs": 55155
}
```

#### `file-history-snapshot` — Pre-edit file state
```json
{
  "type": "file-history-snapshot",
  "messageId": "...",
  "snapshot": { "trackedFileBackups": {}, "timestamp": "..." }
}
```

### Global history.jsonl
```json
{
  "display": "set up this repository...",
  "timestamp": 1772211460822,
  "project": "C:\\Users\\Jono\\Projects\\remote",
  "sessionId": "d5a0e799-8ff4-44ae-876f-bce050e45c31"
}
```

## Session Identification

- **UUID v4** (e.g. `4f9f58b8-fd55-4a4a-af43-7c8520573edc`)
- Also assigned a human-readable slug (e.g. `"frolicking-coalescing-wreath"`)
- Same ID used across: session JSONL, debug log, file-history, todos, telemetry
- Resumable with `claude --resume <session-id>`

## Real-Time Tailing

**Fully feasible.** Logs are written incrementally during the session as JSONL (append-only). Each line is a self-contained JSON object. Verified by watching file size grow during an active session.

Considerations:
- New sessions create new JSONL files — need to watch for new files appearing
- `progress` entries are very frequent; filter by `type` if only conversation turns are needed
- `parentUuid` creates a linked-list for conversation tree reconstruction
- Sub-agent logs are in separate files under `subagents/`

## Log Retention

Claude Code **deletes session logs after 30 days by default**. To prevent:
```json
// ~/.claude/settings.json
{ "cleanupPeriodDays": 99999 }
```

## References

- https://kentgigger.com/posts/claude-code-conversation-history
- https://simonwillison.net/2025/Oct/22/claude-code-logs/
- https://github.com/daaain/claude-code-log
- https://github.com/ZeroSumQuant/claude-conversation-extractor
