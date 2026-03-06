# Tauri v2 Overlay/Transparent Windows — Research

Research into implementing overlay/transparent windows in Tauri v2, targeting both macOS and Windows.

---

## 1. Frameless Transparent Windows

### Configuration (`tauri.conf.json`)

The window configuration in `tauri.conf.json` under `app.windows[]` accepts these relevant fields:

```jsonc
{
  "app": {
    "windows": [
      {
        "label": "main",
        "transparent": true,       // Enable window transparency
        "decorations": false,      // Remove native title bar and frame
        "shadow": false,           // Disable window shadow (required on some platforms for clean transparency)
        "alwaysOnTop": true,       // Float above other windows
        "titleBarStyle": "overlay" // macOS only: overlay, transparent, visible (irrelevant if decorations=false)
      }
    ]
  }
}
```

### Key Configuration Fields

| Field | Type | Purpose |
|-------|------|---------|
| `transparent` | bool | Makes the webview background transparent. The HTML/CSS body must also have `background: transparent` or a semi-transparent colour. |
| `decorations` | bool | When `false`, removes the native title bar and window frame entirely. |
| `shadow` | bool | Controls the native window shadow. On Windows, `shadow: true` with `decorations: false` and `transparent: true` can cause visual artefacts on Windows 10. Set to `false` for clean transparency. |
| `titleBarStyle` | string | macOS only. `"overlay"` makes content render under the title bar. Only relevant when `decorations: true`. |
| `dragDropEnabled` | bool | Enable/disable file drag-and-drop on the window. Default `true`. |

### HTML/CSS Requirements for Transparency

Setting `transparent: true` in Tauri config alone is not sufficient. The webview itself must also be transparent:

```css
html, body {
  background: transparent;
  /* Or a semi-transparent colour: */
  /* background: rgba(30, 30, 30, 0.85); */
}
```

If the body has an opaque background colour, the window will appear opaque despite the Tauri configuration.

### Custom Title Bar with Drag Region

With `decorations: false`, you must implement your own title bar in HTML/CSS. Tauri uses the `data-tauri-drag-region` attribute to designate draggable areas:

```html
<div data-tauri-drag-region class="titlebar">
  <span>Hoverpad</span>
  <div class="titlebar-buttons">
    <!-- Custom close/minimize/maximize buttons -->
  </div>
</div>
```

Any element with `data-tauri-drag-region` becomes a drag handle — clicking and dragging it moves the window. Child elements (buttons, inputs) inside the drag region remain interactive and do not trigger dragging.

**Platform note:** On macOS, `data-tauri-drag-region` works seamlessly. On Windows, there is a known issue in some Tauri versions where double-clicking the drag region may not trigger maximize/restore as users expect from native title bars. This needs to be handled manually if desired.

### Rounded Corners

**macOS:** Frameless windows naturally have rounded corners on macOS. The OS compositor handles corner rounding. With `decorations: false` and `transparent: true`, applying `border-radius` on the root container in CSS produces clean rounded corners because the transparent webview lets the rounded edges show through.

**Windows 11:** Windows 11 natively rounds corners on all top-level windows (8px radius), including frameless ones. The DWM (Desktop Window Manager) applies this automatically. With `transparent: true` and `decorations: false`, CSS `border-radius` works as expected because the transparent areas of the webview are truly transparent.

**Windows 10:** This is the problem platform. Windows 10 does NOT natively round window corners. The DWM renders all windows with sharp rectangular edges. Achieving rounded corners on Windows 10 requires:

1. Set `transparent: true` and `decorations: false` in Tauri config
2. Set `shadow: false` (important -- shadow with transparency on Windows 10 can cause a visible rectangular border)
3. Apply `border-radius` via CSS on the root container element
4. Ensure `html, body { background: transparent; }` so the corners outside the border-radius are truly transparent
5. **Gotcha:** On Windows 10, even with the above, the window hit-test area remains rectangular. This means the transparent corners of the rounded window ARE STILL CLICKABLE — mouse events in the transparent corner areas will hit the Hoverpad window rather than passing through. This is a WebView2/WinAPI limitation. For an overlay app this is a minor issue since most windows will be small, but it is worth noting.

**Recommendation for Hoverpad:** Use CSS `border-radius` on the outermost container div. Accept that on Windows 10 the hit-test region will be slightly larger than the visible area. This is a cosmetic trade-off and acceptable for an overlay utility.

---

## 2. Adjustable Opacity

### Tauri API

Tauri v2 provides `set_opacity()` on the `Window` / `WebviewWindow` object.

**Rust API:**
```rust
window.set_opacity(0.8)?; // f64 from 0.0 (fully transparent) to 1.0 (fully opaque)
```

**JavaScript API:**
```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';
await getCurrentWindow().setOpacity(0.75);
```

**Alternatively from another window:**
```typescript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';
const noteWindow = await WebviewWindow.getByLabel('note-abc123');
await noteWindow?.setOpacity(0.5);
```

### Platform Behaviour

**macOS:** `setOpacity()` maps to `NSWindow.alphaValue`. This controls the entire window's opacity including the title bar (if present) and all content. Works smoothly from 0.0 to 1.0. At 0.0 the window is completely invisible but still exists and can receive events.

**Windows:** `setOpacity()` maps to the `WS_EX_LAYERED` window style with `SetLayeredWindowAttributes(LWA_ALPHA)`. This works on both Windows 10 and 11. The entire window (including WebView2 content) becomes uniformly transparent. Range is 0-255 internally but Tauri normalises this to 0.0-1.0.

**Important distinction:** `set_opacity()` controls *window-level* opacity. This is different from CSS opacity or background alpha. For Hoverpad's use case:
- The window-level opacity (`set_opacity`) should be the primary mechanism. It fades the entire window uniformly.
- CSS background alpha (e.g. `rgba(30,30,30,0.85)`) controls the base translucency of the window chrome even at 100% window opacity, which is useful for the "frosted glass" aesthetic.
- These two multiply together. A window at 50% opacity showing content with a 50% alpha background will appear at 25% effective alpha for the background.

### Opacity Hotkey Implementation

For the `Ctrl+,` / `Ctrl+.` hotkeys that adjust all windows by 10%:

1. The global shortcut handler (Rust side) receives the hotkey event
2. It iterates all managed windows via `app.webview_windows()` (returns a `HashMap<String, WebviewWindow>`)
3. For each window, read current opacity, adjust by +/-0.1, clamp to [0.0, 1.0], and call `set_opacity()`
4. Emit a Tauri event so each window's frontend can update its opacity slider UI
5. Persist the new opacity values to SQLite

---

## 3. Click-Through (`set_ignore_cursor_events`)

### API

**Rust:**
```rust
window.set_ignore_cursor_events(true)?;  // Window becomes click-through
window.set_ignore_cursor_events(false)?; // Window captures mouse events again
```

**JavaScript:**
```typescript
await getCurrentWindow().setIgnoreCursorEvents(true);
```

### How It Works

When `set_ignore_cursor_events(true)` is called, the window still renders visually but all mouse events (click, hover, scroll, drag) pass through it to whatever window is underneath. The window becomes a pure visual overlay.

### Platform Implementation Details

**macOS:** Maps to `NSWindow.ignoresMouseEvents = true`. This is a clean, well-supported API. When enabled:
- All mouse events pass through to the window below
- The window cannot be interacted with at all (no clicking, no dragging, no resizing)
- Keyboard events are unaffected IF the window has focus (but you can't click to focus it)
- The window can still be programmatically manipulated (moved, resized, closed) via the Tauri API

**Windows:** Maps to the `WS_EX_TRANSPARENT` extended window style (added via `SetWindowLong`). Combined with `WS_EX_LAYERED`, this makes the window click-through. Behaviour:
- Mouse events pass through to underlying windows
- Same keyboard caveat as macOS
- Works on both Windows 10 and Windows 11

### Platform-Specific Gotchas

1. **Re-enabling interaction:** The biggest challenge is: how does the user re-enable mouse events on a click-through window? Since the window ignores all mouse events, the user cannot click on it to toggle click-through off. Solutions:
   - **Global hotkey** (recommended for Hoverpad): Use `Ctrl+H` or another hotkey to toggle all windows back to interactive mode
   - **Tauri event from another window:** The Control Panel can emit an event that disables click-through on all note windows
   - **System tray:** A tray icon menu item that toggles click-through

2. **macOS: ignoresMouseEvents with forwarding.** On macOS, there is an additional option: `set_ignore_cursor_events(true)` with a "forwarding" parameter. Tauri v2's implementation on macOS supports a second parameter for "forwarding" — `window.set_ignore_cursor_events_with_forward(ignore, forward)` — where `forward: true` means the window will still receive `mouseEntered` and `mouseExited` events while forwarding clicks through. This is NOT exposed in the stable JS API as of Tauri v2 stable; it may require a custom Rust command. **Check the latest API before relying on this.**

3. **Windows: WS_EX_TRANSPARENT limitations.** On Windows, the `WS_EX_TRANSPARENT` style means the window is truly invisible to the mouse. There is no equivalent of macOS's "forward" option built into the platform API. The window is either fully click-through or not.

4. **Interaction with opacity:** Click-through is binary (on/off) and independent of opacity. A window at 80% opacity with `ignore_cursor_events(true)` is still click-through. The plan to auto-enable click-through below 20% opacity is application logic, not a platform feature.

### Recommended Approach for Hoverpad

- Track each window's opacity in state
- When opacity drops below threshold (e.g., 20%), call `set_ignore_cursor_events(true)`
- When opacity rises above threshold, call `set_ignore_cursor_events(false)`
- The `Ctrl+H` hide/show toggle should also reset click-through state
- The Control Panel should NEVER be click-through (always remain interactive even at low opacity), or at minimum always have a way to restore interactivity

---

## 4. Always-on-Top

### Configuration

**Static (tauri.conf.json):**
```json
{ "alwaysOnTop": true }
```

**Dynamic (runtime):**
```typescript
await getCurrentWindow().setAlwaysOnTop(true);
```

### Platform Behaviour

**macOS:** Maps to `NSWindow.level = .floating` (or similar `NSWindowLevel`). The window floats above normal windows. Multiple always-on-top windows stack in their creation order.

**Windows:** Maps to `SetWindowPos` with `HWND_TOPMOST`. Works consistently on both Windows 10 and 11.

### Interaction with Fullscreen Apps

**macOS:**
- A fullscreen app (green button / `Ctrl+Cmd+F`) enters its own Space. Always-on-top windows in other Spaces are NOT visible in the fullscreen Space by default.
- To make an always-on-top window appear over fullscreen apps on macOS, the window must be assigned to all Spaces. Tauri does not expose this directly, but it can be done via a custom Rust command using `NSWindow.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]`.
- **This is a critical feature for Hoverpad** (overlay over fullscreen IDE). Requires Rust-side configuration of `NSWindow.collectionBehavior`.

**Windows:**
- Fullscreen apps (true exclusive fullscreen, e.g., games using `DXGI_SWAP_EFFECT_FLIP_DISCARD`) can cover TOPMOST windows. This is a DirectX/Vulkan exclusive fullscreen behaviour and cannot be overridden without hooking into the graphics pipeline.
- "Fullscreen" apps that are actually maximised borderless windows (which includes most modern apps, VS Code, browsers in F11 mode) do NOT cover TOPMOST windows. Hoverpad will remain visible over these.
- For practical purposes, Hoverpad will be visible over VS Code, terminals, and browsers in fullscreen mode. It will NOT be visible over true exclusive fullscreen games, which is acceptable.

### Recommendation

- Set `alwaysOnTop: true` in the default window configuration
- On macOS, set `NSWindow.collectionBehavior` via a Rust setup hook to ensure visibility across Spaces and over fullscreen apps. Example:

```rust
// In setup or window creation
#[cfg(target_os = "macos")]
{
    use cocoa::appkit::NSWindowCollectionBehavior;
    let ns_window = window.ns_window().unwrap() as cocoa::base::id;
    unsafe {
        let _: () = msg_send![ns_window, setCollectionBehavior:
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorCanJoinAllSpaces |
            NSWindowCollectionBehavior::NSWindowCollectionBehaviorFullScreenAuxiliary
        ];
    }
}
```

This requires the `cocoa` and `objc` crates on macOS.

---

## 5. Global Hotkeys — `tauri-plugin-global-shortcut`

### Plugin Setup

**Cargo.toml:**
```toml
[dependencies]
tauri-plugin-global-shortcut = "2"
```

**Capabilities (in `src-tauri/capabilities/default.json`):**
```json
{
  "permissions": [
    "global-shortcut:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "global-shortcut:allow-is-registered"
  ]
}
```

**Rust setup:**
```rust
tauri::Builder::default()
    .plugin(tauri_plugin_global_shortcut::Builder::new().build())
    // ...
```

### Registering Shortcuts

**From Rust (recommended for Hoverpad since hotkey actions are backend operations):**

```rust
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut};

app.handle().plugin(
    tauri_plugin_global_shortcut::Builder::new()
        .with_handler(|app, shortcut, event| {
            if event.state == ShortcutState::Pressed {
                if shortcut == &Shortcut::new(Some(Modifiers::CONTROL), Code::KeyN) {
                    // Create new note
                }
                if shortcut == &Shortcut::new(Some(Modifiers::CONTROL), Code::KeyH) {
                    // Toggle visibility
                }
                if shortcut == &Shortcut::new(Some(Modifiers::CONTROL), Code::Comma) {
                    // Decrease opacity
                }
                if shortcut == &Shortcut::new(Some(Modifiers::CONTROL), Code::Period) {
                    // Increase opacity
                }
            }
        })
        .build(),
)?;

// Register the shortcuts
app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL), Code::KeyN))?;
app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL), Code::KeyH))?;
app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL), Code::Comma))?;
app.global_shortcut().register(Shortcut::new(Some(Modifiers::CONTROL), Code::Period))?;
```

**From JavaScript:**
```typescript
import { register } from '@tauri-apps/plugin-global-shortcut';

await register('CommandOrControl+N', (event) => {
  if (event.state === 'Pressed') {
    // Create new note
  }
});
```

### Platform-Specific Notes

| Concern | macOS | Windows |
|---------|-------|---------|
| Modifier key | `Cmd` is the primary modifier. `CommandOrControl` maps to `Cmd` on macOS. | `Ctrl` is the primary modifier. `CommandOrControl` maps to `Ctrl` on Windows. |
| Conflicts | `Cmd+N` is used by many macOS apps (new window/document). A global shortcut will intercept it system-wide, which could annoy users. Consider using `Cmd+Shift+N` or making shortcuts configurable. | `Ctrl+N` is less universally used outside browsers. Still potentially conflicts with some apps. |
| `Ctrl+,` / `Ctrl+.` | On macOS, `Cmd+,` opens Preferences in many apps. `Ctrl+,` (not Cmd) is less commonly used and should be safe. | `Ctrl+,` opens Settings in VS Code. This is a significant conflict for the target audience. Consider making these configurable. |
| Registration failure | If another app has already registered the same global shortcut, registration will silently succeed on some platforms but the shortcut won't fire. On others it may return an error. | Same concern. |

### Hotkey Conflict Recommendations

- Use `CommandOrControl` prefix so `Cmd` is used on macOS and `Ctrl` on Windows
- **Make all hotkeys user-configurable** and store in SQLite or a config file
- Default suggestions that minimise conflicts:
  - `Ctrl+Shift+N` for new note (avoids browser/app `Ctrl+N`)
  - `Ctrl+Shift+H` for toggle visibility
  - `Ctrl+[` / `Ctrl+]` as alternatives to `Ctrl+,` / `Ctrl+.` for opacity

---

## 6. Multi-Window Management

### Creating Windows Dynamically

**From Rust:**
```rust
use tauri::WebviewWindowBuilder;
use tauri::WebviewUrl;

let note_window = WebviewWindowBuilder::new(
    &app,
    "note-abc123",                        // unique label
    WebviewUrl::App("index.html".into()), // URL to load
)
.title("My Note")
.transparent(true)
.decorations(false)
.shadow(false)
.always_on_top(true)
.inner_size(400.0, 300.0)
.position(100.0, 100.0)
.build()?;
```

**From JavaScript:**
```typescript
import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const noteWindow = new WebviewWindow('note-abc123', {
  url: '/notes/abc123',   // route in your SPA
  transparent: true,
  decorations: false,
  shadow: false,
  alwaysOnTop: true,
  width: 400,
  height: 300,
  x: 100,
  y: 100,
});

noteWindow.once('tauri://created', () => {
  console.log('Window created');
});

noteWindow.once('tauri://error', (e) => {
  console.error('Window creation failed', e);
});
```

### Window Labels

Every Tauri window must have a unique string label. For Hoverpad:
- Control Panel: `"control-panel"`
- Note windows: `"note-{uuid}"` (e.g., `"note-550e8400-e29b-41d4-a716-446655440000"`)
- Session windows: `"session-{uuid}"`

Labels are used to reference windows from any context: `WebviewWindow.getByLabel("note-abc123")`.

### Destroying Windows

```typescript
const win = await WebviewWindow.getByLabel('note-abc123');
await win?.destroy(); // or win?.close()
```

`close()` triggers the close event (which can be intercepted), while `destroy()` immediately destroys the window.

### Cross-Window Communication via Tauri Events

**Emitting from one window (JS):**
```typescript
import { emit } from '@tauri-apps/api/event';

// Emit to all windows
await emit('opacity-changed', { opacity: 0.7, windowLabel: 'note-abc123' });

// Emit to a specific window
import { emitTo } from '@tauri-apps/api/event';
await emitTo('control-panel', 'note-saved', { noteId: 'abc123', title: 'Updated Title' });
```

**Listening in another window (JS):**
```typescript
import { listen } from '@tauri-apps/api/event';

const unlisten = await listen('opacity-changed', (event) => {
  console.log('New opacity:', event.payload.opacity);
});
```

**Emitting from Rust:**
```rust
app.emit("session-update", payload)?;           // to all windows
app.emit_to("session-abc", "data", payload)?;   // to specific window
```

### Important Multi-Window Considerations

1. **Shared state:** Each window runs its own webview with its own JavaScript context. There is NO shared memory between windows. All state synchronisation must go through:
   - Tauri events (best for real-time updates)
   - Tauri commands that read/write to SQLite (best for persistent state)
   - Tauri's `app.state()` managed state on the Rust side (shared across all windows but requires Mutex/RwLock)

2. **Window enumeration:** `app.webview_windows()` returns all windows. Useful for broadcast operations (e.g., adjust all opacities).

3. **Window lifecycle events:** Listen for `tauri://close-requested` to intercept window closing and perform cleanup (save state, update SQLite).

4. **Single-page routing vs separate HTML files:** For Hoverpad, the recommended approach is a single SPA with route-based rendering. All windows load the same `index.html` but with different URL paths/query params. The React app inspects the route to decide what to render (Control Panel, Note Editor, Session Monitor). This simplifies the build process and allows shared component libraries.

---

## 7. Window State Persistence

### Manual Approach (Recommended for Hoverpad)

Since Hoverpad already uses SQLite for metadata and stores `window_state JSON` on notes and sessions, manual persistence is straightforward:

**Saving state (on window move/resize/opacity change):**
```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();
const position = await win.outerPosition();
const size = await win.outerSize();

// Save to SQLite via Tauri command
await invoke('save_window_state', {
  windowLabel: win.label,
  state: {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    opacity: currentOpacity, // tracked in app state
  }
});
```

**Restoring state (on window creation):**
```typescript
const state = await invoke('get_window_state', { windowLabel: 'note-abc123' });
if (state) {
  const win = getCurrentWindow();
  await win.setPosition(new LogicalPosition(state.x, state.y));
  await win.setSize(new LogicalSize(state.width, state.height));
  await win.setOpacity(state.opacity);
}
```

**Listen for move/resize events to auto-persist:**
```typescript
import { getCurrentWindow } from '@tauri-apps/api/window';

const win = getCurrentWindow();

// Debounce these since they fire frequently during drag/resize
win.onMoved(({ payload: position }) => {
  debouncedSavePosition(position);
});

win.onResized(({ payload: size }) => {
  debouncedSaveSize(size);
});

win.onCloseRequested(async () => {
  await saveWindowState(); // Final save before close
});
```

### `tauri-plugin-window-state`

There is also `tauri-plugin-window-state` which automatically saves and restores window position, size, and other state.

**Pros:**
- Zero-effort window position/size restoration
- Works automatically on all windows

**Cons:**
- Saves to a plugin-managed file, NOT to your SQLite database
- Less control over what is saved (e.g., custom fields like opacity are not supported)
- May conflict with manual state management
- Stores state keyed by window label, which may not map cleanly to note/session UUIDs if labels change

**Recommendation for Hoverpad:** Do NOT use `tauri-plugin-window-state`. Use the manual SQLite approach described above. Hoverpad needs to persist custom fields (opacity, click-through state, linked note/session ID) alongside position/size, and the `window_state JSON` column in the existing schema is the right place for this.

---

## 8. Platform-Specific Differences Summary

### Transparent Windows

| Aspect | macOS | Windows 10 | Windows 11 |
|--------|-------|------------|------------|
| `transparent: true` | Works. Must also set CSS `background: transparent`. | Works. Must also set CSS `background: transparent`. | Works. Must also set CSS `background: transparent`. |
| `decorations: false` | Clean frameless window | Clean frameless window | Clean frameless window |
| `shadow: false` | Removes macOS shadow. May want to keep shadow for aesthetics. | **Required** for clean transparency. Shadow + transparency causes rectangular border artefact. | Shadow works better than Windows 10 but still safer to disable. |
| Rounded corners (CSS) | Clean rendering, transparent corners pass through correctly | Corners are transparent visually but **hit-test area remains rectangular** | Corners work well; DWM applies its own 8px rounding too |
| Performance | Excellent. Core Animation handles transparency efficiently. | Good on modern hardware. Older GPUs may see slight rendering overhead with layered windows. | Excellent. WinUI 3 compositor handles it natively. |

### `set_ignore_cursor_events`

| Aspect | macOS | Windows |
|--------|-------|---------|
| API mapping | `NSWindow.ignoresMouseEvents` | `WS_EX_TRANSPARENT` window style |
| Mouse event forwarding option | Available via `setIgnoresMouseEvents:` with forwarding (partial, receives enter/exit) | Not available. Fully click-through or not. |
| Keyboard events when click-through | Still received if window had focus | Still received if window had focus |
| Re-enabling interaction | Must use hotkey, tray, or IPC from another window | Same |
| Reliability | Highly reliable | Reliable, but toggling the extended style requires `SetWindowLong` + `SetWindowPos` refresh |

### `always_on_top`

| Aspect | macOS | Windows |
|--------|-------|---------|
| Over normal windows | Yes | Yes |
| Over fullscreen apps (native) | **No**, unless `collectionBehavior` is set (see section 4) | Visible over "borderless fullscreen" apps, NOT over exclusive fullscreen |
| Over other always-on-top windows | Stacks by creation order / last-focused | Stacks by creation order / last-focused |
| Multiple displays | Works across displays | Works across displays |

### `set_opacity`

| Aspect | macOS | Windows |
|--------|-------|---------|
| API mapping | `NSWindow.alphaValue` | `SetLayeredWindowAttributes(LWA_ALPHA)` |
| Range | 0.0 to 1.0 (float) | 0.0 to 1.0 (Tauri normalises; internally 0-255) |
| Affects title bar | Yes (entire window) | Yes (entire window) |
| Performance impact | Negligible | Negligible on modern Windows. Layered windows have minimal overhead. |
| Opacity + click-through interaction | Independent. Must set both separately. | Independent. Must set both separately. |

---

## 9. Relevant Tauri v2 Plugins

### Required Plugins

| Plugin | Crate | Purpose | Notes |
|--------|-------|---------|-------|
| `tauri-plugin-global-shortcut` | `tauri-plugin-global-shortcut = "2"` | System-wide hotkey registration | Required for Ctrl+N, Ctrl+H, Ctrl+,/. |
| `tauri-plugin-sql` | `tauri-plugin-sql = { version = "2", features = ["sqlite"] }` | SQLite database access | Already planned. Provides `Database` class in JS. |
| `tauri-plugin-fs` | `tauri-plugin-fs = "2"` | File system access from JS | Needed for reading/writing .md note files from frontend. Alternative: use custom Tauri commands. |
| `tauri-plugin-process` | `tauri-plugin-process = "2"` | Process information (exit, restart) | Useful for graceful shutdown. |
| `tauri-plugin-shell` | `tauri-plugin-shell = "2"` | Shell command execution | May be needed for process detection (listing running Claude CLI instances). Alternative: use `sysinfo` crate directly in Rust. |

### Optional / Recommended Plugins

| Plugin | Crate | Purpose | Notes |
|--------|-------|---------|-------|
| `tauri-plugin-notification` | `tauri-plugin-notification = "2"` | System notifications | For session completion alerts ("Claude session finished"). |
| `tauri-plugin-dialog` | `tauri-plugin-dialog = "2"` | Native file/message dialogs | For "Open note folder", "Confirm delete" dialogs. |
| `tauri-plugin-os` | `tauri-plugin-os = "2"` | OS information (platform, version, arch) | Useful for platform-conditional logic (Windows 10 vs 11 rounded corners, macOS collection behaviour). |
| `tauri-plugin-autostart` | `tauri-plugin-autostart = "2"` | Launch on system startup | Nice-to-have for an overlay app. |
| `tauri-plugin-updater` | `tauri-plugin-updater = "2"` | Auto-update support | For distributing updates. |
| `tauri-plugin-store` | `tauri-plugin-store = "2"` | Simple key-value storage | Could store app preferences (default opacity, hotkey config). Lighter than SQLite for simple settings. |

### Not Recommended

| Plugin | Reason |
|--------|--------|
| `tauri-plugin-window-state` | Conflicts with Hoverpad's custom SQLite-based window state persistence. Does not support custom fields like opacity. |
| `tauri-plugin-clipboard-manager` | Not needed for MVP. Can add later if copy-paste features are desired. |

### Rust Crates (not Tauri plugins) Also Needed

| Crate | Purpose |
|-------|---------|
| `notify` | File system watcher for detecting new Claude session logs and external note edits. |
| `sysinfo` | Process enumeration to detect running Claude CLI instances (cross-platform). |
| `serde` + `serde_json` | JSON serialisation/deserialisation for JSONL parsing and IPC payloads. |
| `uuid` | UUID generation for note/session/ticket IDs. |
| `tokio` | Async runtime for file watching and log tailing (Tauri v2 uses tokio internally). |
| `cocoa` + `objc` | macOS only. Needed for `NSWindow.collectionBehavior` configuration to show windows over fullscreen apps. |

---

## 10. Known Gotchas and Edge Cases

### Transparency

1. **WebView2 on Windows:** The `transparent: true` config in Tauri v2 on Windows uses `COREWEBVIEW2_COLOR` with alpha=0 for the WebView2 background. This requires WebView2 Runtime version 93+. All modern Windows 10/11 systems have this, but it is worth noting.

2. **macOS vibrancy/blur:** For a "frosted glass" effect on macOS, Tauri does not expose `NSVisualEffectView` directly. A Rust-side setup hook using the `cocoa` crate is needed to add vibrancy. On Windows, `SetWindowCompositionAttribute` with `ACCENT_ENABLE_ACRYLICBLENDBEHINDS` provides a similar effect but is undocumented/unsupported API and may break across Windows updates.

3. **GPU acceleration:** Transparent windows require GPU compositing. On systems with disabled GPU acceleration (e.g., some VMs, remote desktop), transparency may not work or may fall back to opaque rendering.

4. **Content readability:** At low opacity, text and UI elements in the overlay become hard to read. Consider:
   - Minimum opacity floor (e.g., 15%) to keep windows barely visible
   - High-contrast text colours that remain readable at low opacity
   - Outline/shadow on text to improve contrast against varying backgrounds

### Click-Through

5. **Hover states:** When click-through is enabled, CSS `:hover` states will not trigger since mouse events are ignored. Any hover-based UI (tooltips, dropdown menus) will not work. This is expected behaviour.

6. **Focus management:** A click-through window cannot receive focus via mouse click. If the user has been typing in the window (which had focus), then click-through is enabled, the window retains keyboard focus until the user clicks elsewhere. This can lead to confusing behaviour where keystrokes go to a "transparent" window.

### Multi-Window

7. **Window ordering:** Multiple always-on-top windows share the same z-order level. When the user clicks on one Hoverpad window, it comes to the top of the always-on-top stack but other Hoverpad windows may go behind non-Hoverpad always-on-top windows (e.g., other overlay apps). This is normal OS behaviour.

8. **Main window closing:** In Tauri v2, closing the last window exits the application by default. Since Hoverpad's Control Panel is the "primary" window, closing it should close all child windows. This can be handled by listening for the close event on the Control Panel and calling `destroy()` on all other windows, then calling `app.exit()`.

9. **Memory usage:** Each WebviewWindow spawns a separate renderer process (WebView2 on Windows, WKWebView on macOS). With many note windows open, memory usage can be significant. A practical limit of ~20 simultaneous windows is recommended.

### Hotkeys

10. **Conflict detection:** `tauri-plugin-global-shortcut` does not provide a way to detect if a shortcut is already registered by another app before registering. Registration may succeed but the shortcut may not fire. Test thoroughly on target machines.

11. **macOS accessibility permissions:** On macOS, global shortcuts may require accessibility permissions (System Settings > Privacy & Security > Accessibility). Tauri apps generally do not need this for keyboard shortcuts, but if issues arise, this is the first thing to check.

### SQLite

12. **Concurrent access:** If the Rust backend and multiple windows are all accessing SQLite (via `tauri-plugin-sql`), ensure WAL mode is enabled for concurrent read access. `tauri-plugin-sql` uses `sqlx` under the hood, which handles connection pooling, but WAL mode should be explicitly set:
    ```sql
    PRAGMA journal_mode=WAL;
    ```

---

## 11. Capability / Permission Configuration (Tauri v2)

Tauri v2 uses a capabilities system for security. All window and plugin operations require explicit permissions. The main capability file is at `src-tauri/capabilities/default.json`:

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Default capability for Hoverpad",
  "windows": ["*"],
  "permissions": [
    "core:default",
    "core:window:default",
    "core:window:allow-create",
    "core:window:allow-close",
    "core:window:allow-destroy",
    "core:window:allow-set-always-on-top",
    "core:window:allow-set-decorations",
    "core:window:allow-set-ignore-cursor-events",
    "core:window:allow-set-position",
    "core:window:allow-set-size",
    "core:window:allow-set-title",
    "core:window:allow-outer-position",
    "core:window:allow-outer-size",
    "core:window:allow-inner-position",
    "core:window:allow-inner-size",
    "core:webview:default",
    "core:event:default",
    "core:event:allow-emit",
    "core:event:allow-emit-to",
    "core:event:allow-listen",
    "global-shortcut:default",
    "global-shortcut:allow-register",
    "global-shortcut:allow-unregister",
    "sql:default",
    "fs:default",
    "notification:default",
    "dialog:default",
    "process:default",
    "os:default"
  ]
}
```

The `"windows": ["*"]` grants these permissions to all windows. For tighter security, you can scope permissions to specific window labels.

**Important:** Without the correct permissions, JS API calls will fail silently or throw errors. If a feature "doesn't work" during development, check capabilities first.

---

## 12. Summary of Recommendations

| Feature | Approach | Platform Caveats |
|---------|----------|-----------------|
| Frameless window | `decorations: false` in config | None significant |
| Transparency | `transparent: true` + CSS `background: transparent` | Windows 10: set `shadow: false` to avoid rectangular border |
| Rounded corners | CSS `border-radius` on root container | Windows 10: hit-test remains rectangular (minor) |
| Opacity | `window.setOpacity()` API, 0.0-1.0 | Works identically on both platforms |
| Click-through | `set_ignore_cursor_events(true)` below opacity threshold | Windows lacks macOS's "forwarding" option; re-enable via hotkey |
| Always-on-top | `alwaysOnTop: true` config + runtime toggle | macOS: needs `collectionBehavior` for fullscreen visibility |
| Hotkeys | `tauri-plugin-global-shortcut`, register in Rust | Make configurable; `Ctrl+,` conflicts with VS Code |
| Multi-window | `WebviewWindow` with unique labels, events for IPC | Each window is separate process; monitor memory |
| State persistence | Manual SQLite with `window_state JSON` column | Do not use `tauri-plugin-window-state` |
| Frosted glass | Platform-specific Rust code (`cocoa` on macOS) | No clean cross-platform API; CSS backdrop-filter as fallback |
