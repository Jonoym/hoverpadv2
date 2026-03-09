# P5-01: Global Opacity Controls + Click-Through

## Objective
Implement the opacity control system: Ctrl+, decreases opacity, Ctrl+. increases opacity, and windows become click-through below a configurable threshold. Plus the existing Ctrl+H show/hide toggle already works.

## Scope

### Opacity State
- Global opacity value stored in Zustand global store (0.0 to 1.0, default 1.0)
- Ctrl+, decreases by 10%, Ctrl+. increases by 10% (minimum 20%)
- Opacity applies to all windows simultaneously
- Sync across windows via tauriSync middleware

### Apply Opacity to Windows
- On opacity change, apply CSS opacity on the document root element
- The hotkey events (`hotkey:opacity-decrease` and `hotkey:opacity-increase`) are already emitted from Rust (P1-03)
- Wire up the event listeners in App.tsx to update the store

### Click-Through at Low Opacity
- When opacity drops below 20% (0.2), enable click-through via `appWindow.setIgnoreCursorEvents(true)`
- When opacity rises above 20%, disable click-through via `appWindow.setIgnoreCursorEvents(false)`
- Need `core:window:allow-set-ignore-cursor-events` capability

### Ctrl+H Toggle Visibility (updated post-feedback)
- Ctrl+H toggles between current opacity and fully transparent (opacity 0) + click-through
- Windows remain open at the OS level — they are NOT hidden via `window.hide()`
- Rust emits `hotkey:toggle-visibility` event; frontend handles the opacity toggle
- Store tracks `isHidden` flag and `preHideOpacity` to restore on un-hide
- Opacity indicator shows "Hidden" when in hidden state

### Opacity Indicator
- Brief floating indicator when opacity changes: "Opacity: 70%" that fades after 1s
- Shows "Hidden" when toggled invisible via Ctrl+H
- Render as an overlay in each window

## Out of Scope
- Per-window opacity (all windows share the same opacity)
- Opacity slider in title bar (nice-to-have for future)

## Acceptance Criteria
1. Ctrl+, decreases opacity by 10% (minimum 20%)
2. Ctrl+. increases opacity by 10%
3. Opacity change is visible on all windows
4. Windows become click-through below 20% opacity
5. Click-through is disabled when opacity rises above 20%
6. Opacity value syncs across all windows
7. Ctrl+H makes windows fully transparent + click-through (not hidden)
8. Ctrl+H again restores previous opacity

## Status
done

## Review
PASS — [review](../reviews/P5-01-02-opacity-and-persistence.md)
