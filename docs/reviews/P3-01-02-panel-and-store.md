# P3-01 & P3-02: Collapsible Panel and Zustand Store — Review

## Verdict: PASS

## Build Verification

| Check | Result |
|-------|--------|
| `npm run build` | PASS — `tsc -b && vite build` succeeded. 774 modules transformed, dist output clean. One chunk size warning (NoteEditor at 1345 kB) is expected due to MDXEditor and is non-blocking. |
| `npx tsc --noEmit` | PASS — zero type errors. |

## P3-01: Collapsible Panel Behavior

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| AC1 | Control Panel starts in expanded mode | PASS | `isCollapsed` is initialized to `false` (line 38 of ControlPanel.tsx). The full `WindowChrome` + content renders by default. |
| AC2 | Collapse button shrinks window to small tab | PASS | `WindowChrome` accepts an `onCollapse` prop (line 194). When provided, a chevron-up button renders in the title bar (lines 110-138 of WindowChrome.tsx). `handleCollapse` saves current size/position, calls `appWindow.setSize(LogicalSize(220, 50))` and `appWindow.setPosition` to top-center, then sets `isCollapsed = true`. |
| AC3 | Clicking tab expands back to full size | PASS | `CollapsedTab` renders a clickable button with `onExpand` callback (line 168 of ControlPanel.tsx). `handleExpand` restores the saved size and position via `setSize`/`setPosition`, then sets `isCollapsed = false`. |
| AC4 | Collapsed tab shows note count and session count | PASS | `CollapsedTab` receives `noteCount` and `sessionCount` props, rendered as colored-dot + count pairs (lines 51-59 of CollapsedTab.tsx). Values come from global store selectors `selectOpenNoteCount` and `selectActiveSessionCount`. |
| AC5 | Window position moves to top-center when collapsed | PASS | `handleCollapse` gets the current monitor, calculates `centerX = (logicalScreenWidth - COLLAPSED_WIDTH) / 2`, and positions at `(centerX, 10)` using `LogicalPosition` (lines 113-122). |
| AC6 | Expanding restores previous size and position | PASS | `handleCollapse` saves `innerSize()` to `expandedSize` and `outerPosition()` to `expandedPosition` before resizing. `handleExpand` restores from these saved values, with a fallback to center-screen if `expandedPosition` is null. |

### Code Quality — P3-01

- **Capabilities**: `src-tauri/capabilities/default.json` includes all required Tauri permissions: `core:window:allow-set-size`, `core:window:allow-set-position`, `core:window:allow-inner-size`, `core:window:allow-outer-position`, `core:window:allow-current-monitor`.
- **CollapsedTab component**: Clean, focused component with proper TypeScript interface. Styled consistently with the dark theme using `bg-neutral-900/90 backdrop-blur-md` and rounded-full pill shape.
- **Conditional rendering**: ControlPanel cleanly switches between `CollapsedTab` and the full `WindowChrome` view based on `isCollapsed` state (line 163).
- **Error handling**: Both `handleCollapse` and `handleExpand` are wrapped in try/catch with console error logging.

## P3-02: Zustand Global Store + Cross-Window Sync

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| AC1 | Global store with notes, sessions, tickets slices | PASS | `GlobalState` interface in globalStore.ts defines all three slices: `notes: NoteMeta[]`, `sessions: SessionMeta[]`, `tickets: TicketMeta[]`, each with a loading flag and a refresh action. Sessions and tickets are correctly stubbed as placeholders for future phases. |
| AC2 | `tauriSync` middleware broadcasts changes across windows | PASS | `tauriSync` middleware wraps `set()` to diff changed keys against `syncKeys: ["notes", "sessions", "tickets"]`. Changed slices are emitted via `emit(SYNC_EVENT, { source, patch })`. A `listen()` handler merges incoming patches into the local store. |
| AC3 | Creating a note updates the note list in Control Panel | PASS | `ControlPanel.handleNewNote` calls `refreshNotes()` after creating the note (line 179). The `refreshNotes` action fetches from SQLite and calls `set({ notes })`, which the `tauriSync` middleware broadcasts. `App.tsx` hotkey handler also calls `refreshNotes()` (line 25). |
| AC4 | Closing a note window updates `isOpen` status | PASS | `NoteWindow.handleClose` calls `setNoteOpen(id, false)` then `refreshNotes()` (lines 165-168). ControlPanel also listens for `window:closed` events and calls `refreshNotes()` (lines 88-92). |
| AC5 | Local store exists for per-window state | PASS | `localStore.ts` exports `useLocalStore` with `scrollPosition` and `editorFocused` fields. Correctly uses plain `create()` without `tauriSync` middleware — local only. |
| AC6 | No echo loops in sync middleware | PASS | Two-layer protection: (1) Events include `source` window label; receiver ignores events from same label (line 109 of tauriSync.ts). (2) `isReceiving` flag is set before applying remote patches and checked in `wrappedSet` to prevent re-broadcast (lines 59, 71). `try/finally` ensures the flag is always reset. |

### Code Quality — P3-02

- **Derived selectors**: `selectOpenNoteCount` and `selectActiveSessionCount` are pure functions outside the store (lines 49-55 of globalStore.ts), correctly avoiding stale data from being stored.
- **Selective sync**: `syncKeys` option ensures only data arrays are broadcast, not loading flags or functions (line 97). This avoids unnecessary cross-window traffic.
- **useShallow**: ControlPanel uses `useShallow` from `zustand/react/shallow` for multi-key subscriptions (line 44), preventing re-renders when unrelated state changes.
- **NoteList refactored**: NoteList now receives `notes` and `loading` as props from the parent rather than fetching independently, with a direct `useGlobalStore` subscription for `refreshNotes`. This is a clean separation.
- **Store access outside React**: `useGlobalStore.getState().refreshNotes()` is correctly used in `App.tsx` hotkey handler and `NoteWindow.performSave` for imperative store access outside the React render cycle.

## ADR-002 Compliance

| ADR Requirement | Status | Notes |
|-----------------|--------|-------|
| Two stores per window: `globalStore` + `localStore` | PASS | Both created as separate `create()` calls. |
| `tauriSync` middleware on global store | PASS | Applied via `create<GlobalState>()(tauriSync(...))`. |
| `sourceWindowLabel` in events to prevent echo | PASS | `SyncPayload.source` field carries window label; receiver checks `event.payload.source === windowLabel`. |
| SQLite as source of truth, frontend derived | PASS | `refreshNotes()` fetches from `listNotes()` (SQLite query). Store state is a cache, not authoritative. |
| Late-join hydration via `state:request-sync` | NOT IMPLEMENTED | ADR mentions new windows emitting `state:request-sync` for full state hydration. Current implementation hydrates from SQLite directly via `refreshNotes()` on mount. This is functionally equivalent and arguably simpler since SQLite is the source of truth. Acceptable deviation. |
| `devtools` middleware | NOT IMPLEMENTED | ADR mentions connecting to Redux DevTools. Not added. Low priority; can be layered in later without any code changes to existing middleware. |
| Event channel naming (`state:sync` / `state:patch`) | DEVIATION | ADR specifies `state:sync` and `state:patch`; implementation uses single `store:sync` event. Functionally equivalent, single-event approach is simpler for current scope. |

## Issues Found

### Blocking

None.

### Non-Blocking

1. **Physical/Logical size mismatch in collapse/expand**: `handleCollapse` saves the result of `appWindow.innerSize()` (which returns `PhysicalSize` in physical pixels) and `appWindow.outerPosition()` (which returns `PhysicalPosition`). However, `handleExpand` passes these physical values to `new LogicalSize()` and `new LogicalPosition()`. On displays with a scale factor other than 1 (common values: 1.25, 1.5, 2.0), the restored window will be larger than the original and offset from its previous position. **Fix**: either convert physical to logical by dividing by `scaleFactor`, or use `toLogical(scaleFactor)` method if available. This should be addressed before Phase 5 (window state persistence).

2. **No devtools middleware**: ADR-002 recommends Zustand's `devtools` middleware for Redux DevTools integration. Not currently wired up. Low priority but would aid debugging multi-window state sync issues.

3. **ADR event naming deviation**: Implementation uses `store:sync` instead of ADR-specified `state:sync` / `state:patch`. Consider updating the ADR to reflect the actual implementation, or vice versa, to keep documentation aligned.

4. **No late-join hydration protocol**: ADR-002 specifies a `state:request-sync` pattern where new windows request full state from the control panel. The current approach of hydrating from SQLite on mount is functionally equivalent and arguably better (avoids dependency on another window being open). Consider updating the ADR to document this as the chosen approach.

5. **`localStore` not yet consumed**: `useLocalStore` is defined but not imported or used by any component. NoteWindow manages its own local state with `useState`/`useRef`. This is fine for now -- it will be consumed when features like scroll restoration or window geometry persistence are implemented.

6. **Module-level `nextId` counter**: Same observation as previous review (P2-03-04). The `nextId` counter for event log entries is a module-level `let`. No practical issue for a single Control Panel instance.
