# P2-01: MDXEditor Integration in Note Windows

## Objective
Install and configure MDXEditor in note windows with appropriate plugins for a markdown note-taking app. Replace the placeholder content in NoteWindow with a working rich markdown editor.

## Scope
- Install MDXEditor and configure with note-taking plugins
- Replace placeholder content in NoteWindow with MDXEditor
- Support loading markdown content and getting it back as raw markdown
- Dark mode theming for the editor
- Handle Tailwind preflight CSS conflict with editor content area
- Basic toolbar with essential formatting actions

## Plugins to Enable (from ADR-007)
- headingsPlugin, listsPlugin, quotePlugin
- markdownShortcutPlugin (type `#`, `- `, `> ` to auto-format)
- thematicBreakPlugin, linkPlugin, linkDialogPlugin
- tablePlugin, codeBlockPlugin (without codeMirrorPlugin)
- toolbarPlugin, frontmatterPlugin
- diffSourcePlugin (raw markdown toggle)

## Plugins to Exclude
- sandpackPlugin, jsxPlugin, codeMirrorPlugin (saves ~100-150KB)

## Out of Scope
- File I/O (loading/saving .md files) — that's P2-02
- Auto-save — that's P2-03
- Note listing in Control Panel — that's P2-04

## Acceptance Criteria
1. MDXEditor renders in note windows
2. Typing markdown shortcuts (e.g. `# ` for heading) works
3. Toolbar shows basic formatting options
4. Can call `getMarkdown()` to retrieve raw markdown string
5. Editor has dark mode styling that matches the app
6. No CSS conflicts between Tailwind preflight and editor content
7. Frontmatter plugin handles YAML metadata

## Status
complete

## Review
[P2-01-mdxeditor review](../reviews/P2-01-mdxeditor.md) -- **PASS** (2026-03-07)
