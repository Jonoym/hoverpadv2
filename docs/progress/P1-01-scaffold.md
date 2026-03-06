# P1-01: Tauri v2 Scaffold with React + TypeScript

## Objective
Create the initial Tauri v2 project with React + TypeScript frontend, Tailwind CSS v4, and all required plugins/crates configured. This is the foundation every other task builds on.

## Scope
- Tauri v2 project initialisation using `create-tauri-app` or equivalent
- React + TypeScript frontend with Vite
- Tailwind CSS v4 setup with dark mode as default
- shadcn/ui initialisation
- Required Tauri plugins added to `Cargo.toml` and `tauri.conf.json`:
  - `tauri-plugin-global-shortcut`
  - `tauri-plugin-sql` (sqlite feature)
  - `tauri-plugin-fs`
  - `tauri-plugin-process`
- Required Rust crates in `Cargo.toml`:
  - `serde`, `serde_json`
  - `uuid` (v7 feature)
  - `tokio`
- Tauri window config: `transparent: true`, `decorations: false`, `shadow: false`, `alwaysOnTop: true`
- CSS: `html, body { background: transparent; }` for transparency
- Tauri v2 capability declarations for all plugins used
- App builds and launches showing a basic transparent window

## Out of Scope
- Multi-window creation (P1-02)
- Global hotkey registration (P1-03)
- SQLite schema creation (P1-04)
- Custom window chrome UI (P1-05)

## Acceptance Criteria
1. `npm run tauri dev` launches successfully
2. A transparent, frameless, always-on-top window appears
3. Tailwind CSS classes work in React components
4. All Tauri plugins compile without errors
5. TypeScript strict mode is enabled
6. Project structure follows frontend skill conventions

## Implementation Notes
- Scaffolded manually (not via `create-tauri-app`) to fit existing directory structure
- Tailwind CSS v4 with CSS-first config in `src/styles/globals.css`
- shadcn/ui initialised with `components.json`, `cn()` utility in `src/lib/utils.ts`
- All 4 Tauri plugins registered in `lib.rs` — global-shortcut uses `#[cfg(desktop)]` guard
- Capabilities split into `default.json` (core, fs, sql, process) and `desktop.json` (global-shortcut)
- FS permissions scoped to `$HOME/hoverpad/**` and `$HOME/.claude/**`
- TypeScript strict mode enabled with path alias `@/*` → `./src/*`

## Files Created
- `package.json` — npm dependencies and scripts
- `tsconfig.json`, `tsconfig.node.json` — TypeScript strict config
- `vite.config.ts` — Vite + React + Tailwind v4 + Tauri
- `index.html` — Vite entry point
- `components.json` — shadcn/ui configuration
- `src/main.tsx` — React entry point
- `src/App.tsx` — Main component (named export, Tailwind classes)
- `src/styles/globals.css` — Tailwind v4 CSS-first config + transparent bg
- `src/lib/utils.ts` — `cn()` utility
- `src-tauri/Cargo.toml` — All plugins and crates
- `src-tauri/tauri.conf.json` — Transparent, frameless, always-on-top config
- `src-tauri/src/main.rs`, `src-tauri/src/lib.rs` — Plugin registration
- `src-tauri/capabilities/default.json`, `desktop.json` — Permission grants
- `src-tauri/build.rs` — Tauri build script

## Status
complete — pending review

## Review
[P1-01 review](../reviews/P1-01-scaffold.md) — **PASS** (2026-03-07)
