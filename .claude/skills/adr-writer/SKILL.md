# ADR Writer

Write Architecture Decision Records for the Hoverpad project.

## Template

```markdown
# ADR-NNN: Title

## Status
**Proposed** | **Accepted** | **Superseded by ADR-NNN**

## Context
What is the problem or decision that needs to be made? Include constraints, requirements, and relevant project context.

## Options Considered

Brief comparison table or list of alternatives evaluated.

## Decision
**The chosen option.** One sentence.

## Rationale
Why this option was chosen over the others. Include specific reasoning relevant to Hoverpad's architecture (multi-window Tauri, overlay behaviour, cross-platform macOS/Windows, bundle size per window, etc.).

## Implementation Details
Schema changes, package names, configuration, phasing — concrete details for developers.

## Related ADRs
- [ADR-NNN](ADR-NNN-name.md) — how this decision relates

## Consequences
What trade-offs, limitations, or follow-up work result from this decision.
```

## Rules

- File naming: `ADR-NNN-kebab-case-title.md` in `docs/adrs/`
- Number sequentially — check existing ADRs for the next available number
- Link to related ADRs in the "Related ADRs" section
- After creating a new ADR, update `CLAUDE.md` tech stack table if the ADR changes a technology choice
- Keep the Rationale section focused on Hoverpad-specific reasoning, not generic pros/cons
- If an ADR supersedes an existing one, update the old ADR's status to "Superseded by ADR-NNN"

## Existing ADRs

- ADR-001: CSS Framework (Tailwind CSS v4 + shadcn/ui)
- ADR-002: State Management (Zustand)
- ADR-004: Kanban Columns (Configurable with defaults)
- ADR-005: Kanban DnD + Calendar (Pragmatic Drag and Drop + custom month view)
- ADR-006: Note Filename Strategy (Date + UUID short)
- ADR-007: Markdown Editor (MDXEditor)
- ADR-008: Tauri Overlay Windows (Frameless transparent + platform-specific Rust)
