# Review: P2-01 -- MDXEditor Integration in Note Windows

**Reviewer:** code-reviewer agent
**Date:** 2026-03-07
**Verdict:** pass (with observations)

---

## Build Status

| Step | Result |
|------|--------|
| `npm run build` (`tsc -b && vite build`) | PASS -- 764 modules, 7.92s, no type errors |
| `npx tsc --noEmit` | PASS -- no type errors |
| Chunk size warning | NOTE -- NoteEditor chunk is 1,345 KB (447 KB gzip). Vite warns about >500 KB chunks. See observation 1. |

---

## Acceptance Criteria

| # | Criterion | Result | Notes |
|---|-----------|--------|-------|
| 1 | MDXEditor renders in note windows | PASS | `NoteEditor` component wraps MDXEditor with full plugin configuration. `NoteWindow` renders it inside `WindowChrome` with a `Suspense` boundary. |
| 2 | Typing markdown shortcuts (e.g. `# ` for heading) works | PASS | `markdownShortcutPlugin()` is included in the plugin array. |
| 3 | Toolbar shows basic formatting options | PASS | `toolbarPlugin` configured with UndoRedo, BoldItalicUnderlineToggles, BlockTypeSelect, ListsToggle, CreateLink, InsertTable, CodeToggle, all wrapped in `DiffSourceToggleWrapper`. |
| 4 | Can call `getMarkdown()` to retrieve raw markdown string | PASS | `NoteEditor` uses `forwardRef` + `useImperativeHandle` to expose `getMarkdown()`, `setMarkdown()`, `insertMarkdown()`, `focus()`, `getContentEditableHTML()`, and `getSelectionMarkdown()`. The ref is created and passed in `NoteWindow`. |
| 5 | Editor has dark mode styling that matches the app | PASS | `dark-theme` class applied to MDXEditor root. `mdxeditor-overrides.css` provides comprehensive dark mode CSS variables, toolbar styling, content area element styles, dialog styling, CodeMirror (diff source) styling, and scrollbar theming. Colour palette uses oklch values that match the neutral dark tones in `globals.css`. |
| 6 | No CSS conflicts between Tailwind preflight and editor content | PASS | Addressed via two layers: (a) `contentEditableClassName="prose prose-invert max-w-none"` applies `@tailwindcss/typography` to restore base element styles, (b) `mdxeditor-overrides.css` provides explicit element styles scoped to `.dark-theme [role="textbox"]` that override both preflight and prose defaults. The `@tailwindcss/typography` plugin is declared in `globals.css` via `@plugin`. The `user-select: text` override on `[role="textbox"]` correctly counteracts `select-none` set on the WindowChrome container. |
| 7 | Frontmatter plugin handles YAML metadata | PASS | `frontmatterPlugin()` is included in the plugin array. The placeholder markdown in `NoteWindow` includes a YAML frontmatter block (`title: Untitled Note`) demonstrating that it parses without error. |

---

## ADR Compliance

### ADR-007: Markdown Editor

| Requirement | Status | Notes |
|-------------|--------|-------|
| MDXEditor selected as the editor | PASS | `@mdxeditor/editor` ^3.52.4 installed. |
| Required plugins enabled | PASS | All 12 plugins from the ADR "Recommended plugins" list are present, minus `imagePlugin`. See observation 2. |
| Excluded plugins not imported | PASS | `sandpackPlugin`, `jsxPlugin`, `codeMirrorPlugin` are not imported anywhere in the codebase. |
| `getMarkdown()` imperative API exposed | PASS | Via `forwardRef` + `useImperativeHandle` in `NoteEditor.tsx`. |
| `diffSourcePlugin` for raw markdown toggle | PASS | Included with `viewMode: "rich-text"` as default. `DiffSourceToggleWrapper` wraps toolbar contents. |
| `frontmatterPlugin` for YAML metadata | PASS | Included. |
| Lazy-load the editor component | PASS | `NoteWindow.tsx` uses `lazy(() => import("@/components/NoteEditor"))` with `Suspense` fallback. |
| `@tailwindcss/typography` for content area | PASS | `prose prose-invert` on `contentEditableClassName`. Typography plugin loaded in `globals.css`. |
| MDXEditor CSS loaded | PASS | `@mdxeditor/editor/style.css` imported in `NoteEditor.tsx` before the overrides file. |

### ADR-001: Tailwind CSS / shadcn/ui

| Requirement | Status | Notes |
|-------------|--------|-------|
| Tailwind utility classes for styling | PASS | Editor wrapper and content area use Tailwind utilities. Layout uses flex utilities. |
| MDXEditor overrides in dedicated CSS file | PASS | All custom CSS lives in `src/styles/mdxeditor-overrides.css`, imported only by `NoteEditor.tsx`. No custom CSS leaked into `globals.css`. |
| `@tailwindcss/typography` for editor content | PASS | Plugin declared, `prose prose-invert` applied. |
| No CSS-in-JS runtime | PASS | All styling is static CSS. |

---

## Non-Blocking Observations

### 1. NoteEditor chunk is 1,345 KB (447 KB gzip)

The Vite build produces a `NoteEditor` chunk of 1,345 KB uncompressed (447 KB gzipped). This triggers Vite's >500 KB warning. The chunk includes MDXEditor + Lexical + remark ecosystem.

ADR-007 estimated ~80-130 KB gzipped for the editor without CodeMirror. The actual 447 KB gzip is significantly larger. Part of this is because `diffSourcePlugin` pulls in CodeMirror for the source view mode, even though `codeMirrorPlugin` (for code block syntax highlighting) was deliberately excluded. These are separate CodeMirror integrations.

**Recommendation:** This is acceptable for Phase 2. The lazy loading via `React.lazy` ensures the heavy chunk only loads in note windows, not in the Control Panel. Tauri webviews share a browser engine so the chunk is cached across note windows after the first load. If bundle size becomes a concern later, consider:
- Setting `build.chunkSizeWarningLimit` in vite.config.ts to suppress the warning
- Splitting the remark/unified pipeline into a separate chunk via `manualChunks`
- Evaluating whether `diffSourcePlugin` can be lazy-loaded separately

### 2. `imagePlugin` not included

ADR-007's recommended plugin list includes `imagePlugin` -- "with custom upload handler for Tauri filesystem." The current implementation does not include it. This is reasonable: the progress file scope says "basic toolbar with essential formatting actions" and file I/O is explicitly out of scope for P2-01. Image handling requires Tauri filesystem integration which belongs in a later phase.

**Recommendation:** No action needed now. Track as a follow-up when file I/O is implemented (P2-02 or later).

### 3. Redundancy between `prose prose-invert` and manual CSS overrides

The `contentEditableClassName` applies Tailwind's `prose prose-invert` which provides element styles for headings, lists, blockquotes, etc. Meanwhile, `mdxeditor-overrides.css` manually defines styles for all the same elements (h1-h6, ul, ol, li, blockquote, table, etc.) scoped to `.dark-theme [role="textbox"]`.

This means every element has two competing style sources. The manual overrides in the CSS file have higher specificity (`.dark-theme [role="textbox"] h1` vs `.prose h1`) so they win, making the `prose prose-invert` classes partially redundant for dark mode.

**Recommendation:** This is not a bug -- the manual overrides take precedence and produce the desired look. The `prose` base serves as a fallback if the `.dark-theme` class is ever absent. However, if maintenance becomes a concern, consider either:
- Removing the manual element overrides and relying purely on `prose prose-invert` with targeted adjustments
- Removing `prose prose-invert` and relying purely on the manual CSS (which is already comprehensive)
- Adding a comment in `NoteEditor.tsx` explaining the layered strategy

### 4. Placeholder markdown is hardcoded

`NoteWindow.tsx` has a `PLACEHOLDER_MARKDOWN` constant with sample content. This is fine for P2-01 since file I/O is explicitly out of scope (P2-02). The `initialMarkdown` prop on `NoteEditor` is the correct pattern for later passing real note content.

### 5. `_markdown` state is unused beyond the setter

In `NoteWindow.tsx` line 37:
```typescript
const [_markdown, setMarkdown] = useState(PLACEHOLDER_MARKDOWN);
```

The leading underscore signals an intentionally unused variable, and the `handleChange` callback stores editor changes in state via `setMarkdown`. This is correct scaffolding for P2-02/P2-03 where the state will be read for auto-save. No issue here, just noting it for completeness.

### 6. `onChange` fires on every keystroke

The `onChange` callback from MDXEditor fires on every content change. Currently this updates React state via `setMarkdown`. For P2-03 (auto-save with debounce), the debounce should be applied before triggering file writes, not on the `onChange` handler itself, since `getMarkdown()` will be used for explicit saves per ADR-007. This is already correctly anticipated in the architecture.

---

## Code Quality

### Positives

1. **Clean ref forwarding pattern:** `NoteEditor` uses `forwardRef` + `useImperativeHandle` to expose a complete set of MDXEditor methods (`getMarkdown`, `setMarkdown`, `insertMarkdown`, `focus`, `getContentEditableHTML`, `getSelectionMarkdown`). This is more thorough than the minimum requirement and provides a good foundation for future features.

2. **Correct lazy loading:** `NoteWindow.tsx` uses `React.lazy` with a proper named export transformation (`mod => ({ default: mod.NoteEditor })`). The `Suspense` boundary wraps only the editor, not the entire window, so the window chrome renders immediately while the heavy editor chunk loads.

3. **CSS architecture is well-structured:** MDXEditor's own CSS loads first (`@mdxeditor/editor/style.css`), then the project overrides (`mdxeditor-overrides.css`). The overrides file is well-organised with clear section comments (dark theme variables, toolbar, content area elements, diff/source view, scrollbars).

4. **Text selection fix:** The `user-select: text` override on `[role="textbox"]` and `.cm-editor` is a subtle but important fix. `WindowChrome` sets `select-none` on its root to prevent text selection during window dragging, but the editor content must remain selectable.

5. **Transparent background:** The editor root has `background: transparent` so the `WindowChrome` backdrop-blur glass effect shows through. This maintains visual consistency.

6. **Complete toolbar:** The toolbar includes all the commonly needed formatting actions with logical grouping via `Separator` components. The `DiffSourceToggleWrapper` gives power users a raw markdown view.

### Structure

```
NoteWindow
  +-- WindowChrome (title bar, drag, close)
      +-- Suspense (fallback: "Loading editor...")
          +-- NoteEditor (lazy loaded)
              +-- div (flex container)
                  +-- MDXEditor
                      +-- toolbarPlugin (formatting toolbar)
                      +-- [12 content plugins]
                      +-- contentEditable (prose prose-invert)
```

This hierarchy correctly separates concerns: `NoteWindow` owns the data/state, `WindowChrome` provides the window frame, `Suspense` handles async loading, and `NoteEditor` encapsulates all editor configuration.

---

## Summary

The MDXEditor integration is well-implemented. All seven acceptance criteria pass. The plugin configuration matches ADR-007 (with the intentional omission of `imagePlugin` which requires file I/O not yet available). The CSS architecture follows ADR-001 with Tailwind utilities for layout and a dedicated override file for MDXEditor dark mode theming. Lazy loading is correctly configured to keep the heavy editor bundle out of the initial page load. The `forwardRef` API exposes `getMarkdown()` and other methods that future phases (file I/O, auto-save) will need.

The editor chunk is larger than ADR-007's estimate (447 KB gzip vs 80-130 KB estimated), primarily because `diffSourcePlugin` brings in CodeMirror. This is acceptable given the lazy loading strategy and Tauri's shared webview cache.

**Verdict: PASS**
