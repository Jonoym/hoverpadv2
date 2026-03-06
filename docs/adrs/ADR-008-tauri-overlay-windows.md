# ADR-008: Tauri v2 Overlay Window Implementation

## Status
**Accepted**

## Context
All Hoverpad windows are transparent, always-on-top overlays with adjustable opacity and click-through behaviour. Must work on both macOS and Windows. See full research in [`docs/research/tauri-v2-overlay-windows.md`](../research/tauri-v2-overlay-windows.md).

## Key Decisions

### Frameless Transparent Windows
- Set `transparent: true`, `decorations: false`, `shadow: false` in `tauri.conf.json`
- HTML/body must also have `background: transparent` in CSS
- Custom drag region via `data-tauri-drag-region` attribute on the custom title bar
- **Windows 10 caveat:** CSS `border-radius` on root container works visually, but the hit-test area remains rectangular (transparent corners are still clickable). Windows 11 and macOS handle this natively. Accept this as a known limitation.
- `shadow: false` required on Windows 10 — `shadow: true` + `transparent: true` causes a visible rectangular border artefact

### Opacity Control
- `window.setOpacity(value)` — float 0.0 to 1.0, works identically on macOS and Windows
- Window-level opacity multiplies with CSS background alpha (50% window × 50% CSS = 25% effective)
- Set a **minimum opacity floor of 15%** to maintain text readability
- Store opacity in `window_state` JSON in SQLite per window

### Click-Through
- `set_ignore_cursor_events(true/false)` — binary toggle, independent of opacity
- Application logic must link them: below opacity threshold (e.g. 20%) → enable click-through
- **macOS:** Maps to `NSWindow.ignoresMouseEvents`
- **Windows:** Maps to `WS_EX_TRANSPARENT` window style
- **Critical UX:** A click-through window cannot be clicked to re-enable. Use `Ctrl+H` global hotkey to toggle all windows back to interactive state.

### Always-on-Top
- `alwaysOnTop: true` in config or `setAlwaysOnTop(true)` at runtime
- **macOS fullscreen apps:** Always-on-top windows do NOT appear over native fullscreen unless `NSWindow.collectionBehavior` is set to `.canJoinAllSpaces | .fullScreenAuxiliary` via Rust code using `cocoa` and `objc` crates. **Must implement this for macOS.**
- **Windows fullscreen:** Visible over borderless fullscreen (VS Code, browsers in F11) but not true DirectX exclusive fullscreen. Acceptable.

### Global Hotkeys
- Use `tauri-plugin-global-shortcut` with `CommandOrControl` modifier (maps to Cmd on macOS, Ctrl on Windows)
- **Conflict warning:** `Ctrl+,` conflicts with VS Code Settings, `Ctrl+N` conflicts with browser new-window. Consider making hotkeys user-configurable in a future phase.

### Multi-Window Architecture
- Create windows dynamically with `WebviewWindow` (JS) or `WebviewWindowBuilder` (Rust), each with a unique label
- Cross-window communication via `emit()`/`listen()` events
- **Single SPA approach:** All windows load the same `index.html` with different URL paths for route-based rendering
- Practical limit of ~20 simultaneous windows (each spawns a separate renderer process)

### Window State Persistence
- **Do NOT use `tauri-plugin-window-state`** — stores state in its own file, doesn't support custom fields (opacity), conflicts with manual management
- Use the existing `window_state JSON` column in SQLite
- Save position/size/opacity on `onMoved`, `onResized`, `onCloseRequested` events (debounced)
- Restore on window creation

## Plugin & Crate Requirements

### Tauri Plugins (required)
- `tauri-plugin-global-shortcut` — system-wide hotkeys
- `tauri-plugin-sql` (sqlite feature) — database
- `tauri-plugin-fs` — note file read/write
- `tauri-plugin-process` — process management

### Tauri Plugins (recommended)
- `tauri-plugin-notification` — session completion alerts
- `tauri-plugin-dialog` — confirmation dialogs
- `tauri-plugin-os` — platform detection for conditional logic
- `tauri-plugin-store` — simple key-value preferences

### Tauri Plugins (not recommended)
- `tauri-plugin-window-state` — conflicts with custom SQLite persistence

### Rust Crates (not Tauri plugins)
- `notify` — file system watching (for note file changes and Claude log tailing)
- `sysinfo` — process detection (for Claude CLI sessions)
- `serde` + `serde_json` — serialization
- `uuid` — ID generation
- `tokio` — async runtime
- `cocoa` + `objc` — macOS-only, for fullscreen overlay behaviour

## Platform-Specific Gotchas

| Issue | macOS | Windows |
|-------|-------|---------|
| Rounded corners | Native support | Win 11 native, Win 10 visual-only (rectangular hit test) |
| Shadow + transparency | Works | **Artefact on Win 10** — must disable shadow |
| Click-through forwarding | mouseEnter/Exit still delivered | Fully click-through, no forwarding |
| Fullscreen overlay | Requires `collectionBehavior` Rust code | Works over borderless, not DirectX exclusive |
| `backdrop-filter` blur | Works (WebKit) | Works (WebView2 93+) |
| Frosted glass (OS-level) | Possible via vibrancy API | Requires platform-specific Rust (acrylic/mica) |

## Additional Notes

- Tauri v2 capabilities/permissions must be explicitly declared for every API used — missing permissions cause silent failures
- Enable SQLite WAL mode (`PRAGMA journal_mode=WAL`) for concurrent window access
- At low opacity, use high-contrast text (white on transparent) to maintain readability

## Consequences
- Must implement platform-specific Rust code for macOS fullscreen overlay behaviour
- Windows 10 users get slightly degraded experience (rectangular hit test, no shadow)
- Hotkey conflicts with other apps are a known issue — user-configurable hotkeys should be a future feature
- ~20 window practical limit is well within expected usage
