# P7-01: MDXEditor Toolbar Fix

## Status: Complete

## Problem
MDXEditor toolbar rendered vertically (buttons stacked) instead of as a horizontal row.

## Root Cause
The CSS rule `.dark-theme.mdxeditor > div` was matching the toolbar element (a direct child of the MDXEditor root), overriding its `flex-direction` to `column`.

## Fix
- Changed selector to `.dark-theme.mdxeditor > div:not(.mdxeditor-toolbar)` to exclude the toolbar
- Added explicit `display: flex; flex-direction: row; align-items: center` to `.dark-theme .mdxeditor-toolbar`

## Files Modified
- `src/styles/mdxeditor-overrides.css`
