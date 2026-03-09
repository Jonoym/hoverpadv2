# P6-04: Window Minimum Size

## Objective
Prevent note and session windows from being resized to unusably small dimensions.

## Scope

### WindowManager Changes
- Added optional `minWidth` and `minHeight` to `WindowConfig` interface
- Passed `minWidth`/`minHeight` to `WebviewWindow` constructor options
- Note windows: `minWidth: 300, minHeight: 250`
- Session windows: `minWidth: 350, minHeight: 300`

## Files Modified
| File | Changes |
|------|---------|
| `src/lib/windowManager.ts` | Added `minWidth`/`minHeight` to `WindowConfig`, passed to `WebviewWindow`, set values for note and session windows |

## Acceptance Criteria
1. Note windows cannot be resized below 300x250
2. Session windows cannot be resized below 350x300
3. Saved window states still restore correctly (saved sizes may be larger than minimums)
4. TypeScript compiles clean

## Status
complete
