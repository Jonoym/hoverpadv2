# P4-03: Session List in Control Panel

## Objective
Add a session list view to the Control Panel showing all discovered Claude Code sessions, grouped by project, with quick actions to open session windows.

## Scope

### Session List Component
- New `SessionList` component in `src/components/SessionList.tsx`
- Displays sessions grouped by project (working_dir)
- Each session row: status badge, session ID (short), start time, working dir
- Actions: "Open" (spawn session window + start tailing), "Close" (stop tailing)

### View Integration
- Add "Sessions" tab to the ControlPanel view switcher (Notes | Board | Sessions)
- Sessions tab shows the SessionList component
- Auto-refresh when sessions are discovered or status changes

### Project Grouping
- Group sessions by decoded working directory
- Collapsible project sections
- Show project name (last segment of path) as the group header
- Count of active/total sessions per project

## Out of Scope
- Manual session groups (future enhancement)
- Session search/filter

## Acceptance Criteria
1. Sessions tab appears in the Control Panel view switcher
2. Sessions are listed grouped by project
3. Each session shows status, ID, and start time
4. "Open" button opens a session window
5. Session status updates in real-time

## Status
done

## Review
[P4-02-03-session-ui](../reviews/P4-02-03-session-ui.md) — PASS
