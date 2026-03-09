# P6-08: Session Project Accordion

## Objective
Enhance the SessionList project grouping with proper accordion behavior, "Open All" functionality, and better visual hierarchy.

## Scope

### Accordion Animation
- Replaced simple show/hide with CSS `max-h` + `opacity` transition for smooth expand/collapse
- `max-h-0 opacity-0` when collapsed, `max-h-[2000px] opacity-100` when expanded
- 200ms ease-in-out transition

### "Open All" Button
- Added "Open All" button in each project group header
- Iterates through group sessions and opens each one via `createSessionWindow()`
- Styled as subtle blue text, always visible in the header row

### Visual Hierarchy
- Active sessions have a left border accent (`border-l-emerald-500/60`)
- Inactive sessions have a transparent left border
- Project group headers have a subtle background (`bg-neutral-800/30`)
- Improved header layout with button and "Open All" side by side

## Files Modified
| File | Changes |
|------|---------|
| `src/components/SessionList.tsx` | Added CSS accordion animation, "Open All" button, left-border accent for active sessions, improved header layout |

## Acceptance Criteria
1. Accordion expand/collapse animates smoothly
2. "Open All" button opens every session in the group
3. Active sessions have visual distinction (green left border)
4. TypeScript compiles clean

## Status
complete
