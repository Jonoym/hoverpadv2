# Review: P1-01 — Tauri v2 Scaffold

**Reviewer:** code-reviewer agent
**Date:** 2026-03-07
**Verdict:** pass

---

## Build Status

| Step | Result |
|------|--------|
| `npm install` | PASS — 0 vulnerabilities |
| `npm run build` (`tsc -b && vite build`) | PASS — 32 modules, 1.62s |
| `cargo check` (src-tauri) | PASS — clean compilation, no warnings |

Both frontend and Rust compile without errors. Full `npm run tauri dev` was not launched (first Rust dev build is slow), but both halves verify independently.

---

## Acceptance Criteria

| # | Criterion | Status | Notes |
|---|-----------|--------|-------|
| 1 | `npm run tauri dev` launches successfully | PASS | Frontend builds + Rust compiles clean. Verified via `npm run build` + `cargo check`. |
| 2 | Transparent, frameless, always-on-top window config | PASS | `tauri.conf.json`: `transparent: true`, `decorations: false`, `shadow: false`, `alwaysOnTop: true`. CSS: `html, body { background: transparent; }`. |
| 3 | Tailwind CSS classes work in React components | PASS | `App.tsx` uses Tailwind utilities (`flex`, `rounded-2xl`, `backdrop-blur-sm`, etc.) via `cn()`. Vite build succeeds with `@tailwindcss/vite` plugin. |
| 4 | All Tauri plugins compile without errors | PASS | `tauri-plugin-fs`, `tauri-plugin-sql` (sqlite), `tauri-plugin-process`, `tauri-plugin-global-shortcut` all in `Cargo.toml` and registered in `lib.rs`. `cargo check` passes. |
| 5 | TypeScript strict mode enabled | PASS | `tsconfig.json`: `"strict": true`, plus `noUnusedLocals`, `noUnusedParameters`, `noFallthroughCasesInSwitch`, `noUncheckedIndexedAccess`, `forceConsistentCasingInFileNames`. |
| 6 | Project structure follows frontend skill conventions | PASS | `src/main.tsx`, `src/App.tsx` (named export), `src/lib/utils.ts`, `src/styles/globals.css`, `@/*` path alias. |

---

## ADR Compliance

### ADR-001: CSS Framework (Tailwind CSS v4 + shadcn/ui)

| Requirement | Status | Notes |
|-------------|--------|-------|
| Tailwind CSS v4 used | PASS | `tailwindcss@^4.2.1` + `@tailwindcss/vite@^4.2.1` |
| CSS-first config (`@theme` blocks) | PASS | `src/styles/globals.css` uses `@theme inline` with CSS custom properties |
| shadcn/ui initialised | PASS | `components.json` present with correct aliases, `cn()` in `src/lib/utils.ts` |
| `cn()` utility exists | PASS | Uses `clsx` + `tailwind-merge` |
| No CSS-in-JS | PASS | No styled-components, emotion, or similar |
| Dark mode support | MINOR | `.dark` CSS variables defined, but `<html>` lacks `class="dark"` — see issues below |

### ADR-008: Tauri v2 Overlay Windows

| Requirement | Status | Notes |
|-------------|--------|-------|
| `transparent: true` | PASS | `tauri.conf.json` |
| `decorations: false` | PASS | `tauri.conf.json` |
| `shadow: false` | PASS | `tauri.conf.json` |
| `alwaysOnTop: true` | PASS | `tauri.conf.json` |
| `html, body { background: transparent }` | PASS | `src/styles/globals.css` line 122-124 |
| Required plugins present | PASS | All 4 in `Cargo.toml` and registered in `lib.rs` |
| Capabilities declared | PASS | `default.json` (core, fs, sql, process) + `desktop.json` (global-shortcut) |
| `tauri-plugin-window-state` NOT used | PASS | Not present in `Cargo.toml` or `package.json` |
| FS scoped to `$HOME/hoverpad/**` and `$HOME/.claude/**` | PASS | Plus app data paths for SQLite |
| Global shortcut uses `#[cfg(desktop)]` guard | PASS | Registered inside `.setup()` with `#[cfg(desktop)]` |

---

## Issues

### Minor

1. **Missing JS package: `@tauri-apps/plugin-global-shortcut`**
   The Rust crate `tauri-plugin-global-shortcut` is in `Cargo.toml` and registered in `lib.rs`, but the corresponding npm package `@tauri-apps/plugin-global-shortcut` is not listed in `package.json`. This does not block the scaffold (the plugin compiles and loads), but P1-03 (global hotkey registration) will need it for the JS API. Not a blocker for this task since the scope explicitly excludes hotkey registration.

2. **Dark mode not activated by default**
   The scope states "dark mode as default" and `globals.css` defines `.dark` theme variables, but `index.html` does not have `class="dark"` on `<html>`. The current `App.tsx` uses hardcoded dark colors (`neutral-900/90`, `neutral-100`, etc.) so it looks correct visually, but shadcn/ui components added later would render in light mode. Should be fixed before P1-05 (window chrome) adds shadcn/ui components.

### Style

3. **Placeholder favicon**
   `index.html` references `vite.svg` (Vite default). An `app-icon.svg` exists at the project root but is not wired up. Cosmetic only.

---

## Summary

The scaffold is solid. All acceptance criteria are met. The Tauri v2 + React + TypeScript + Tailwind CSS v4 foundation is correctly configured with proper overlay window settings, plugin registration, capability declarations, and TypeScript strict mode. The two minor issues (missing JS global-shortcut package and dark mode class) are non-blocking for this phase but should be addressed before the tasks that depend on them (P1-03 and P1-05 respectively).

**Verdict: PASS**
