# P6-01: Control Panel Cleanup

## Objective
Remove dev-only UI elements and non-functional buttons from the Control Panel to create a cleaner user-facing experience.

## Scope

### Removed Elements
- **"New Session" button**: Created test sessions with `test-{timestamp}` IDs that had no backing log file. Sessions are auto-discovered from Claude Code logs — manual creation is not needed.
- **DB status display**: Showed "DB OK — 6 tables (...), 4 kanban columns" — useful during development but not for end users. Removed the `<div>`, `dbStatus` state, and `getDatabaseStatus` import.
- **"Control Panel" badge**: Blue badge next to "Hoverpad" title was unnecessary clutter. Removed the `badge` prop from `<WindowChrome>`.

## Files Modified
| File | Changes |
|------|---------|
| `src/pages/ControlPanel.tsx` | Removed `createSessionWindow` import, `dbStatus` state, `getDatabaseStatus` import, `handleNewSession` handler, DB status `<div>`, session button, and `badge` prop |

## Acceptance Criteria
1. ~~"New Session" button~~ — removed
2. ~~DB status display~~ — removed
3. ~~"Control Panel" badge~~ — removed
4. "New Note" button still works
5. TypeScript compiles clean

## Status
complete
