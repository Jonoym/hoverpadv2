# ADR-002: React State Management

## Status
**Accepted**

## Context
Hoverpad uses Tauri v2 multi-window architecture where each window is a separate OS-level webview with its own isolated JavaScript runtime. There is no shared memory between windows. State synchronization must happen over Tauri's IPC event system (`emit`/`listen`).

**Two distinct state categories exist:**
- **Global synced state:** opacity level, session statuses, note metadata, ticket/kanban state, window visibility
- **Window-local state:** MDXEditor content, scroll position, window size/position

## Options Considered

| Criterion | Zustand | Jotai | Redux Toolkit | Context + Events |
|---|---|---|---|---|
| Cross-window sync fit | Good (state patches) | Poor (atom granularity = friction) | Best (action replay) | Adequate (hand-rolled) |
| Memory per window | ~1KB + state | ~3KB + atoms + tracking | ~11KB + state + middleware | ~0KB + state |
| TypeScript | Excellent | Excellent | Excellent | Good (manual) |
| IPC wiring complexity | Low-moderate | Moderate-high | Low-moderate | Moderate-high (grows) |
| DevTools | Good (via Redux DevTools) | Adequate | Best | Minimal |
| Boilerplate | Low | Low | Moderate | Low initially, grows |
| Re-render efficiency | Excellent (selectors) | Excellent (atomic) | Excellent (selectors) | Poor (context-wide) |

## Decision
**Zustand**

## Rationale

### Why Zustand wins for multi-window Tauri

1. **Best weight-to-power ratio.** With N windows each instantiating their own JS runtime, per-window overhead matters. Zustand at ~1KB with near-zero runtime overhead is ideal. Selectors prevent unnecessary re-renders, middleware enables IPC sync, and the API is minimal.

2. **Natural synced/local split.** Two stores per window: a `globalStore` (with Tauri sync middleware) and a `localStore` (no sync). Just two `create()` calls. Components subscribe to whichever they need — no ambiguity about what syncs.

3. **Middleware makes IPC clean.** A single `tauriSync` middleware wraps the global store, intercepts `setState` calls, serializes the delta, and emits via Tauri. On the receiving side, a single `listen()` handler calls `setState()`. ~30-50 lines of middleware, applied once.

4. **Simple mental model.** In a multi-window app already managing window lifecycle, IPC channels, hotkey routing, and Rust backend state — the React state layer should be the simplest part. "Store is an object, mutations are functions."

### Why not the others

- **Jotai:** Atomic model creates friction at the IPC boundary. Broadcasting individual atom updates, handling batching, managing per-atom subscriptions — the granularity that makes Jotai great for single-window apps becomes a liability for cross-window sync.
- **Redux Toolkit:** Close second. Action-replay pattern is architecturally the cleanest for cross-window sync and DevTools are unmatched. If the app grows very large or debugging multi-window state becomes painful, consider migrating to RTK. For current scope, the extra weight and boilerplate aren't justified.
- **Context + Events:** Fine for prototyping, won't scale. Context's re-render problem is well-documented, and you'll gradually re-invent what Zustand provides. No DevTools for debugging IPC state sync.

## Implementation Pattern

### Store architecture (per window)
- **`globalStore`** — Zustand with `tauriSync` middleware: opacity, session status, note metadata, tickets, visibility
- **`localStore`** — Zustand, no sync: editor content, scroll position, window geometry

### Cross-window sync
- Tauri event channels: `state:sync` (full state), `state:patch` (partial updates)
- Include `sourceWindowLabel` field in every event to prevent echo loops
- **Late-join hydration:** New window emits `state:request-sync`, control panel responds with full current global state

### DevTools
- Zustand's `devtools` middleware connects to Redux DevTools browser extension for per-window state inspection

## Consequences
- Each window has ~1KB library overhead + state object size
- Cross-window sync middleware must be built (~30-50 lines) — not provided out of the box
- Echo loop prevention (source tagging) is a critical implementation detail
- If debugging becomes painful at scale, RTK migration is a viable fallback path
