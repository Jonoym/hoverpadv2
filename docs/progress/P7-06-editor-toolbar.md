# P7-06: Editor Toolbar Simplification + Scroll Fix

## Status: Complete

## Changes
- Removed UndoRedo, BlockTypeSelect, DiffSourceToggleWrapper from toolbar
- Removed diffSourcePlugin (no longer needed without DiffSourceToggleWrapper)
- Toolbar now single line: BoldItalicUnderlineToggles | ListsToggle | CreateLink InsertTable | CodeToggle
- CSS: `flex-wrap: nowrap; flex-shrink: 0` ensures toolbar stays on one line

## Files Modified
- `src/components/NoteEditor.tsx`
- `src/styles/mdxeditor-overrides.css`
