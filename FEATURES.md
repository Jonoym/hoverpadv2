# Hoverpad — Feature Ideas

New feature ideas organized by category, from most impactful to exploratory.

---

## Session Intelligence

### 1. Session Cost Tracker
Parse token usage from JSONL logs and display estimated cost per session/project. Aggregate daily/weekly/monthly spending with a small chart in the control panel.

### 2. Session Search
Full-text search across all session events (tool calls, outputs, user prompts). Find "that thing Claude did last Tuesday" without opening every session.

### 3. Session Replay
Playback a completed session like a video timeline. Scrub through events with a slider, see tool calls unfold in real-time speed or accelerated. Great for reviewing what happened.

### 4. Session Diff Viewer
Show file changes made during a session. Parse `file_editor`/`write` tool calls to build a cumulative diff view of what Claude modified.

### 5. Session Templates / Prompts Library
Save frequently-used prompts (e.g., "review this PR", "write tests for X") as quick-launch templates. One-click to start a new Claude session with a saved prompt.

### 6. Session Notifications
Desktop toast notifications when a session completes, errors, or has been idle for too long. Especially useful when sessions are hidden behind other windows.

### 7. Session Branching Visualization
When sessions spawn sub-agents, show a tree/graph view of the agent hierarchy, which agents are active, and how work flows between them.

---

## Notes & Knowledge

### 8. Bidirectional Note Linking (Wiki-style)
`[[note-title]]` syntax that creates links between notes. Backlinks panel showing "notes that reference this note." Build a personal knowledge graph.

### 9. Session-to-Note Extraction
One-click "Save to Note" from any session event or timeline range. Capture Claude's explanation, a code snippet, or an entire conversation segment as a markdown note.

### 10. Note Templates
Predefined templates for common note types: meeting notes, bug reports, code reviews, daily standups. Auto-populate with date, project context, linked sessions.

### 11. Quick Capture / Scratchpad
A tiny floating input (like Spotlight) that appears with a hotkey. Type a quick thought, it becomes a note or appends to a daily journal note. No window management needed.

### 12. Code Snippet Manager
Extract and tag code blocks from notes and sessions. Searchable snippet library with syntax highlighting and one-click copy.

---

## Kanban & Productivity

### 13. Time Tracking per Ticket
Start/stop timer on kanban cards. Track how long you spend on each task. Optionally auto-link active Claude sessions to the "In Progress" ticket.

### 14. Auto-Link Sessions to Tickets
When a Claude session's working directory matches a ticket's linked project, auto-suggest linking them. Or detect when a session's prompt mentions a ticket title.

### 15. Recurring Tickets
Tickets that auto-recreate on a schedule (daily standup, weekly review). Template-based with checklist items.

### 16. Sprint / Milestone View
Group tickets into time-boxed sprints. Show burndown-style progress (tickets completed vs. remaining) as a simple chart overlay.

### 17. Dependency Arrows
Draw "blocked by" relationships between kanban cards. Visualize critical path.

---

## Overlay & UX

### 18. Workspace Profiles
Save/restore entire window layouts (positions, sizes, which notes/sessions are open). Switch between "coding" (sessions + kanban), "writing" (notes focused), "minimal" (collapsed) profiles with a hotkey.

### 19. Picture-in-Picture Session
A tiny always-visible widget showing the latest event from the most active session. Like a mini session window that takes almost no space but keeps you informed.

### 20. Pomodoro / Focus Timer
Overlay timer widget. When active, auto-hide non-essential windows. On break, show notes. Integrates with time tracking on tickets.

### 21. Command Palette
`Ctrl+P` fuzzy search across everything: notes, tickets, sessions, actions. Type "open note about auth" or "show active sessions" and jump directly there.

### 22. Multi-Monitor Awareness
Remember which monitor each window was on. Snap-to-edge behavior. "Send all windows to monitor 2" command.

---

## Integration & Data

### 23. Git Integration
Show git branch/status for each project in the session list. Link commits made during a session to the session timeline. "What did Claude commit?"

### 24. GitHub Issues Sync
Two-way sync between kanban tickets and GitHub issues. Create a ticket from an issue, or push a ticket to GitHub. Status mapping (column → label).

### 25. Daily Digest / Summary
Auto-generated end-of-day summary: sessions run, tickets moved, notes created/edited, estimated tokens used. Saved as a note or shown as a dashboard widget.

### 26. Export & Reporting
Export session timelines as markdown/HTML reports. Export kanban board as CSV. Generate "what I did this week" reports from session + ticket activity.

### 27. Clipboard History Overlay
Since it's already an overlay app, add a clipboard history panel. Especially useful when copying between Claude sessions and your editor.

---

## Advanced / Exploratory

### 28. Local LLM Summarization
Run a small local model to auto-summarize long sessions into 2-3 bullet points. Show summaries in the session list instead of "last user message."

### 29. Voice Notes
Record quick audio memos, auto-transcribe to markdown notes. Useful when hands are busy with code.

### 30. Shared Sessions (Team)
Optional network sync so a team can see each other's Claude sessions and notes. Pair programming overlay.

---

## Recommended Starting Points

Highest-impact, lowest-effort picks that build naturally on the existing multi-window + SQLite + hotkey infrastructure:

| # | Feature | Why |
|---|---------|-----|
| 2 | Session Search | SQLite already stores events; add FTS5 index |
| 6 | Session Notifications | Tauri has native notification support |
| 11 | Quick Capture | Small new window type, reuses note service |
| 21 | Command Palette | Queries existing stores, high UX payoff |
| 18 | Workspace Profiles | Serialize/restore window state already works |
