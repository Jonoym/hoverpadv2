# ADR-001: CSS Framework / Styling Approach

## Status
**Accepted**

## Context
Hoverpad is a Tauri v2 + React + TypeScript desktop overlay app with multiple OS-level webview windows. All windows must share consistent theming (dark mode, macOS-inspired design with rounded corners, frosted glass effects). The app integrates MDXEditor which ships its own CSS.

## Options Considered

| Criterion | Tailwind CSS | CSS Modules | Styled Components/Emotion | Vanilla Extract |
|---|---|---|---|---|
| Runtime JS overhead | None | None | 7-16 KB **per window** | None |
| Dark mode | First-class (`dark:` variant) | Manual (CSS vars) | ThemeProvider (complex cross-window) | createTheme (typed) |
| Cross-window theming | Trivial (shared CSS file) | Trivial (shared CSS vars) | **Complex** (separate React trees) | Trivial (shared CSS file) |
| MDXEditor compatibility | Excellent (no conflict) | Good | Risky (specificity issues) | Good |
| Component ecosystem | **shadcn/ui, Radix** | None significant | Chakra UI, MUI (heavy) | None significant |
| Development velocity | Fastest | Slowest | Moderate | Moderate |
| TypeScript type safety | IDE extension (not compiled) | Optional .d.ts | Typed themes + props | **Full compile-time** |

## Decision
**Tailwind CSS v4**

## Rationale

### 1. Multi-window architecture fit
Tailwind outputs a single static CSS file loaded by each webview. No JavaScript runtime, no ThemeProvider to sync across windows, no React context boundaries. Every window gets identical design tokens via CSS custom properties automatically. This eliminates an entire class of cross-window theming bugs.

### 2. Bundle size
With potentially 10-15 simultaneous webview windows, per-window overhead matters. Tailwind adds zero JS runtime. CSS-in-JS solutions (Styled Components/Emotion) would add 7-16 KB of runtime per window — wasteful for a desktop app.

### 3. Frosted glass and macOS aesthetics
Built-in utilities map directly to requirements: `backdrop-blur-md`, `bg-black/50`, `rounded-2xl`, `border border-white/10`. The macOS-inspired aesthetic can be expressed concisely without custom CSS.

### 4. MDXEditor coexistence
Tailwind utility classes have no naming collisions with MDXEditor's internal classes. Import both CSS files and they coexist cleanly. Override MDXEditor appearance via `@layer` or target its CSS variables.

**Important caveat:** Tailwind's `preflight` (base reset) strips default styles from `<h1>`, `<ul>`, `<blockquote>` etc. inside MDXEditor's contenteditable area. Solve by either:
- Scoping preflight to exclude the editor container
- Applying `@tailwindcss/typography` (`prose` class) to the editor content area
- Ensuring MDXEditor's CSS loads after Tailwind's base with sufficient specificity

### 5. shadcn/ui ecosystem (decisive accelerator)
shadcn/ui provides production-quality accessible components built on Radix UI + Tailwind: Card, Badge, Button, Dialog, DropdownMenu, Tooltip, ScrollArea, Tabs, etc. Components are copy-pasted into the project (not an npm dependency) — fully owned and customisable. For the kanban board, shadcn/ui Card + Pragmatic Drag and Drop is a proven pattern.

With CSS Modules or Vanilla Extract, all UI components would need to be built from scratch.

### 6. Why not Vanilla Extract?
Vanilla Extract has superior compile-time type safety for styles — the one area where Tailwind is weaker. However, the practical impact is small: Tailwind's VS Code extension catches invalid classes in real time. The massive ecosystem advantage (shadcn/ui, community patterns) outweighs type safety.

## Implementation

- **Tailwind CSS v4** with CSS-first configuration (`@theme` blocks)
- **shadcn/ui** installed via CLI — components live in project source
- **Radix UI** as underlying headless primitives (shadcn dependency)
- **Single `globals.css`** — Tailwind directives + MDXEditor CSS import + custom overrides
- **CSS custom properties** in `@theme` block for Hoverpad-specific tokens (status colours, window chrome dimensions)
- **`@tailwindcss/typography`** for MDXEditor content area styling

## Consequences
- HTML can become verbose with many utility classes (mitigated by extracting React components)
- No compile-time type-checking for class strings (mitigated by VS Code extension)
- Tailwind preflight requires careful handling around MDXEditor
- `backdrop-filter: blur()` for true frosted glass depends on Tauri/OS compositor support, not the CSS framework
