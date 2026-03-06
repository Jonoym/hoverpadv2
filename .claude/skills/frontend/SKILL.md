# Frontend Development

React + TypeScript conventions for Hoverpad.

## Component Structure

- Functional components only, no class components
- Named exports (not default exports) for all components
- Co-locate component, types, and hooks in the same directory when component-specific
- Shared hooks in `src/hooks/`, shared types in `src/types/`

## TypeScript

- Strict mode enabled — no `any` types, no `@ts-ignore`
- Use `interface` for object shapes that may be extended, `type` for unions, intersections, and primitives
- Props interfaces named `ComponentNameProps`
- Prefer `const` assertions and discriminated unions over enums
- Use Tauri's generated TypeScript bindings for IPC command types

## State Management (Zustand — ADR-002)

- **`globalStore`** — synced across all windows via `tauriSync` middleware. Contains: opacity, session statuses, note metadata, tickets, window visibility.
- **`localStore`** — per-window, no sync. Contains: editor content, scroll position, window geometry.
- Use selectors to subscribe to specific slices — avoid subscribing to the entire store
- Never mutate state directly; use Zustand's `set` function
- Cross-window events use Tauri `emit`/`listen` with `sourceWindowLabel` to prevent echo loops

## Multi-Window

- All windows load the same SPA, routed by URL path
- Use Tauri's `WebviewWindow` label to identify each window
- Cross-window communication via Tauri events, never `window.postMessage`
- Each window has its own React root and store instances

## File Conventions

- `.tsx` for components, `.ts` for non-JSX logic
- `PascalCase` for component files and directories
- `camelCase` for utility files and hooks
- `kebab-case` for route paths and CSS-related files

## Patterns

- Debounce auto-save with ~1s delay (note editor `onChange`)
- Lazy-load heavy components (MDXEditor) via `React.lazy` + `Suspense`
- Use `useCallback` and `useMemo` only when there's a measurable performance need, not by default
- Error boundaries around each major section (editor, session timeline, kanban)
- Use Tauri commands (invoke) for all filesystem and database operations — never access directly from frontend
