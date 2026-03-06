# Review: P1-05 -- Basic Frameless Window Chrome with Drag + Close

**Reviewer:** code-reviewer agent
**Date:** 2026-03-07
**Verdict:** fail

---

## Build Status

| Step | Result |
|------|--------|
| `npm run build` (`tsc -b && vite build`) | PASS -- 62 modules, 2.05s, no errors or warnings |
| `cargo check` (src-tauri) | PASS -- clean compilation, no warnings |
| `npx tsc --noEmit` | PASS -- no type errors |

---

## Acceptance Criteria

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | All windows have a consistent custom title bar at the top | PASS | `WindowChrome` wraps all three pages (ControlPanel, NoteWindow, SessionWindow) with identical title bar layout |
| 2 | Windows can be dragged by the title bar | PASS | `data-tauri-drag-region` applied to title bar div and nested children (title text, badge). Per ADR-008 this is the correct mechanism. |
| 3 | Close button closes the window | PASS | Calls `getCurrentWebviewWindow().close()`. `core:window:allow-close` is declared in capabilities. Also emits `window:closed` event for note/session windows. |
| 4 | Minimize button minimizes the window | **FAIL** | Calls `appWindow.minimize()` but `core:window:allow-minimize` is **missing** from `src-tauri/capabilities/default.json`. The `core:window:default` permission set only includes read-only queries (e.g. `allow-is-minimized`) but not `allow-minimize`. This means the minimize call will silently fail at runtime. |
| 5 | Windows have rounded corners and subtle border | PASS | Outer container uses `rounded-2xl border border-neutral-700/50`. Title bar uses `rounded-t-2xl` to match. |
| 6 | Window background is semi-transparent with backdrop blur | PASS | `bg-neutral-900/90 backdrop-blur-sm` on main panel, `bg-neutral-800/50` on title bar. `html, body { background: transparent }` in globals.css. Tauri config has `transparent: true`. |
| 7 | Styling matches ADR-001 (Tailwind) and ADR-008 (overlay) conventions | PASS (with note) | See ADR Compliance section below. |

---

## Blocking Issue

### 1. Missing `core:window:allow-minimize` capability

**File:** `src-tauri/capabilities/default.json`

**Problem:** The minimize button calls `getCurrentWebviewWindow().minimize()` in `WindowChrome.tsx` (line 28), but the Tauri capability `core:window:allow-minimize` is not declared in `default.json`. The `core:window:default` permission set (which is included via `core:default`) only grants read-only window queries like `allow-is-minimized`, `allow-is-maximized`, etc. It does not grant `allow-minimize`.

Per ADR-008: "Tauri v2 capabilities/permissions must be explicitly declared for every API used -- missing permissions cause silent failures."

**Fix:** Add `"core:window:allow-minimize"` to the permissions array in `src-tauri/capabilities/default.json`, next to the existing `"core:window:allow-close"`.

---

## Non-Blocking Observations

### 2. `backdrop-blur-sm` vs `backdrop-blur-md`

The progress file scope specifies `backdrop-blur-md`, but the implementation uses `backdrop-blur-sm`. The visual difference is subtle (4px vs 12px blur radius). ADR-001 mentions `backdrop-blur-md` as one of the "built-in utilities" that map to the macOS-inspired aesthetic. This is minor -- `backdrop-blur-sm` may have been a deliberate choice for performance or visual preference -- but it deviates from what the progress file documented as the design intent.

**Recommendation:** Either update the code to `backdrop-blur-md` to match the spec, or update the progress file to reflect the intentional choice of `backdrop-blur-sm`. Consistency between docs and code matters.

### 3. `getCurrentWebviewWindow()` called at render time

In `WindowChrome.tsx` line 25:
```typescript
const appWindow = getCurrentWebviewWindow();
```

This is called on every render of the component. In Tauri v2, `getCurrentWebviewWindow()` is synchronous and lightweight (reads from a global), so this is not a performance problem. However, it would be marginally cleaner to move this into a `useMemo` or a module-level constant, or extract a small `useTauriWindow()` hook. This is purely a style observation and does not affect correctness.

### 4. Badge color palette is hardcoded

The `badgeColorMap` in `WindowChrome.tsx` defines four colors (blue, emerald, amber, purple). This is fine for Phase 1, but future phases may want more flexibility. No action needed now.

### 5. SVG icons are inline

The minimize and close icons are inline SVGs. This works correctly and avoids icon library dependencies. If the app grows to need many icons, consider extracting them into a shared icon component or adopting an icon library (e.g. `lucide-react`, which shadcn/ui commonly uses). No action needed now.

### 6. Duplicate `getCurrentWebviewWindow` in page components

Both `NoteWindow.tsx` and `SessionWindow.tsx` call `getCurrentWebviewWindow()` for their `handleSendEvent` functions, while `WindowChrome` also calls it internally for close/minimize. This is fine -- they're accessing the same singleton for different purposes. If a shared hook is introduced (observation 3), both uses could be consolidated.

---

## ADR Compliance

### ADR-001: Tailwind CSS / shadcn/ui

| Requirement | Status | Notes |
|-------------|--------|-------|
| Tailwind utility classes for styling | PASS | All styling uses Tailwind utilities exclusively. No custom CSS files added. |
| `cn()` helper for conditional classes | PASS | Imported from `@/lib/utils` (clsx + tailwind-merge). Used throughout. |
| Dark translucent aesthetic (`backdrop-blur`, `bg-*/alpha`) | PASS | `bg-neutral-900/90`, `backdrop-blur-sm`, `bg-neutral-800/50` create the frosted glass look. |
| No CSS-in-JS runtime | PASS | Zero runtime overhead per window. |
| shadcn/ui conventions (copy-paste components) | PASS | `WindowChrome` follows the shadcn pattern of a self-contained component with typed props, using `cn()` and Tailwind. |

### ADR-008: Tauri v2 Overlay Windows

| Requirement | Status | Notes |
|-------------|--------|-------|
| `transparent: true`, `decorations: false`, `shadow: false` | PASS | Set in `tauri.conf.json` for main window, and in `windowManager.ts` for dynamic windows. |
| HTML/body `background: transparent` | PASS | `globals.css` lines 121-124. |
| Custom drag region via `data-tauri-drag-region` | PASS | Applied to title bar div and all nested elements (title text, badge span). This ensures drag works even when clicking on text. |
| Capabilities declared for APIs used | **FAIL** | `core:window:allow-close` present. `core:window:allow-minimize` **missing**. |
| `shadow: false` on Windows 10 | PASS | Both `tauri.conf.json` and `windowManager.ts` set `shadow: false`. |

---

## Code Quality

### Positives

1. **Clean component API:** `WindowChrome` accepts `title`, `badge`, `children`, and `showMinimize` as props. The interface is simple, well-typed, and flexible.

2. **Consistent usage across all windows:** All three page components (ControlPanel, NoteWindow, SessionWindow) use `WindowChrome` as their root wrapper with appropriate title/badge values.

3. **Accessible controls:** Both minimize and close buttons have `aria-label` attributes and `type="button"` to prevent form submission. Hover states provide clear visual feedback (amber for minimize, red for close).

4. **Event emission on close:** The close handler intelligently checks the window label prefix to determine window type and emits a typed `window:closed` event before closing. This integrates cleanly with the event system from P1-02.

5. **Drag region coverage:** `data-tauri-drag-region` is applied not just to the title bar container but also to child elements (title span, badge span), preventing dead zones where clicking on text wouldn't initiate a drag.

6. **Overflow handling:** The outer container uses `overflow-hidden`, the content area uses `overflow-hidden`, and the title text uses `truncate` to handle long titles gracefully.

### Structure

The component hierarchy is:
```
WindowChrome (h-screen w-screen flex-col)
  +-- Main panel (rounded-2xl, border, bg, backdrop-blur)
      +-- Title bar (h-9, bg-neutral-800/50, data-tauri-drag-region)
      |   +-- Left: title + optional badge
      |   +-- Right: minimize + close buttons
      +-- Content area (flex-1, p-5, overflow-hidden)
          +-- {children}
```

This is a clean separation. The inner rounded panel sits within the transparent full-screen container, which is necessary because the Tauri window itself is a transparent rectangle -- the visual "window" is the rounded inner panel.

---

## Summary

The `WindowChrome` component is well-implemented with clean code, proper Tailwind usage, accessible controls, and correct integration with the Tauri drag region API and cross-window event system. All three page components use it consistently. The implementation matches the ADR-001 and ADR-008 patterns for styling and overlay windows respectively.

However, **one blocking issue prevents a pass:** the `core:window:allow-minimize` Tauri capability is missing from `default.json`, which means the minimize button will silently fail at runtime. This directly violates acceptance criterion 4 ("Minimize button minimizes the window") and ADR-008's explicit warning about missing permissions causing silent failures.

The fix is a one-line addition to `src-tauri/capabilities/default.json`.

**Verdict: FAIL** -- re-submit after adding the missing minimize capability.
