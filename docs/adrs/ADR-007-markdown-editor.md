# ADR-007: Markdown Editor

## Status
**Accepted**

## Context
Hoverpad notes are stored as `.md` files on disk. The editor must support WYSIWYG markdown editing with live rendering, load/save raw markdown strings, and work within Tauri webview windows. Each note opens in its own OS-level window, so bundle size per window matters.

## Options Considered

| Criterion | MDXEditor | Milkdown | Tiptap | BlockNote |
|---|---|---|---|---|
| Markdown round-trip fidelity | Very good (remark-based) | Excellent (remark-based) | **Moderate** (ProseMirror JSON → MD) | **Poor** (block model → MD) |
| Bundle size (gzipped) | ~80-130 KB | ~70-100 KB | ~60-100 KB + MD ext | ~120-180 KB |
| React/TypeScript | Good | Good | Excellent | Excellent |
| Plugin ecosystem | Good (10-15 official) | Good (growing) | Excellent (largest) | Moderate |
| Theming/dark mode | CSS variables, dark class | Headless (full control) | Headless (full control) | Built-in light/dark |
| Out-of-box UX | Good (toolbar included) | Moderate (needs styling) | Low (headless, DIY) | Excellent (Notion-like) |
| Markdown-first design | Yes (MDX-first) | **Yes** | No (rich text first) | No (block editor first) |

## Decision
**MDXEditor**

Milkdown is the fallback if MDXEditor proves limiting.

## Rationale

### Why MDXEditor
1. **Fastest time-to-working-prototype.** Pre-built toolbar, clear plugin API, and straightforward `markdown` prop / `getMarkdown()` method. Functional editor in a Tauri window within hours, not days.
2. **Strong markdown fidelity.** The remark/unified pipeline handles CommonMark and GFM reliably. The "MDX overhead" is minimal if JSX-related plugins aren't loaded.
3. **Imperative ref API is ideal for Tauri.** `getMarkdown()` on Ctrl+S → Tauri command → Rust file write. Cleaner than managing `onChange` subscriptions.
4. **`diffSourcePlugin` for free.** Gives a "view raw markdown" toggle — valuable for power users.

### Why not Tiptap or BlockNote
Both eliminated due to markdown round-trip fidelity. Tiptap's internal model is ProseMirror JSON (not markdown AST) — round-tripping is not guaranteed. BlockNote's block model is even worse for `.md` interoperability. For an app that stores notes as `.md` files for external tool access (VS Code, Obsidian), this is a disqualifier.

### Why Milkdown is the fallback
- Same remark/unified parsing pipeline → equal markdown fidelity
- Purpose-built for markdown (not MDX) → no unnecessary overhead
- Headless → full styling control for macOS-inspired dark mode
- **However:** More work for toolbar/UI (headless = DIY), documentation has historically lagged, and the community is smaller

## Plugin Configuration

### Recommended plugins for note-taking
- `headingsPlugin` — H1-H6
- `listsPlugin` — ordered, unordered, task/check lists
- `quotePlugin` — blockquotes
- `markdownShortcutPlugin` — type `#`, `- `, `> ` to auto-convert (critical for writing UX)
- `thematicBreakPlugin` — horizontal rules
- `linkPlugin` + `linkDialogPlugin` — inline links
- `imagePlugin` — with custom upload handler for Tauri filesystem
- `tablePlugin` — GFM tables
- `codeBlockPlugin` — fenced code blocks (**skip `codeMirrorPlugin`** to save ~100-150 KB)
- `toolbarPlugin` — configurable toolbar
- `diffSourcePlugin` — raw markdown source toggle
- `frontmatterPlugin` — YAML frontmatter for note metadata

### Explicitly excluded
- `sandpackPlugin` — live code sandboxes (not useful for notes)
- `jsxPlugin` — JSX rendering (MDX-specific, not needed for plain markdown)
- `codeMirrorPlugin` — saves ~100-150 KB; basic code blocks are sufficient

## Integration Details

### Load/Save workflow
1. Read `.md` file from disk via Tauri `fs` API → string
2. Pass to MDXEditor via `setMarkdown()` or `markdown` prop
3. User edits
4. On save (Ctrl+S or debounced auto-save): `getMarkdown()` → string → write to disk via Tauri `fs` API

### Auto-save
Use `onChange` with ~1s debounce for auto-save. Use `getMarkdown()` for explicit Ctrl+S saves.

### Tailwind CSS interaction
MDXEditor's contenteditable area renders real `<h1>`, `<ul>`, `<blockquote>` elements. Tailwind's preflight reset strips their default styles. Solutions:
- Apply `@tailwindcss/typography` (`prose` class) to the editor content area
- Ensure MDXEditor's CSS (`@mdxeditor/editor/style.css`) loads with sufficient specificity
- Scope Tailwind preflight to exclude the editor container if needed

### Bundle size mitigation
- ~80-130 KB gzipped without CodeMirror (acceptable for per-window loading)
- Tauri webviews share the same browser engine — static assets cached across windows
- Lazy-load the editor component via dynamic imports so window shell renders fast

## Consequences
- Carrying some MDX machinery even though we only use plain markdown (minor overhead)
- Single primary maintainer (though built on Meta's Lexical which is well-maintained)
- Tailwind preflight needs careful handling around editor content area
- If MDXEditor proves limiting, Milkdown migration is moderate cost (same remark ecosystem, rebuild toolbar UI)
