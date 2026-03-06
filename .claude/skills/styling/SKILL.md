# Styling

Tailwind CSS v4 + shadcn/ui conventions for Hoverpad. See [ADR-001](../../docs/adrs/ADR-001-css-framework.md).

## Framework

- **Tailwind CSS v4** with CSS-first configuration (`@theme` blocks in CSS, no JS config)
- **shadcn/ui** components as the base — installed via CLI, code lives in project
- **Radix UI** primitives underneath shadcn (don't use Radix directly unless shadcn doesn't cover it)

## Design Language

- Dark mode by default — use Tailwind's dark theme as the base
- macOS-inspired: rounded corners (`rounded-2xl`), subtle borders (`border border-white/10`), frosted glass (`backdrop-blur-md bg-black/50`)
- Frameless windows with custom title bar using `data-tauri-drag-region`
- Status colours: green (active), amber (idle), red (errored), blue (completed)
- Consistent card-based UI for note windows and session windows (same outer shell, different inner content)

## Rules

- Use Tailwind utility classes in JSX — avoid custom CSS files except for MDXEditor overrides
- Use the `cn()` utility (clsx + tailwind-merge) for conditional classes
- Design tokens go in the `@theme` block as CSS custom properties
- shadcn components are the source of truth for base styling — customise them, don't create parallel components
- No CSS-in-JS, no styled-components, no inline style objects

## MDXEditor Styling (ADR-007)

- MDXEditor ships its own CSS (`@mdxeditor/editor/style.css`) — import it alongside Tailwind
- Tailwind preflight strips default element styles inside the editor's contenteditable area
- Apply `@tailwindcss/typography` (`prose` class) to the editor content wrapper to restore heading/list/blockquote styles
- Custom MDXEditor theme overrides go in a dedicated CSS file (e.g. `src/styles/mdxeditor-overrides.css`)
- Target MDXEditor's CSS custom properties for colour adjustments

## Cross-Window Theming

- All windows load the same CSS file — theming is automatic, no sync needed
- Opacity is controlled at the Tauri window level (`window.setOpacity()`), not CSS
- Minimum opacity floor: 15% for text readability

## Platform Considerations (ADR-008)

- `shadow: false` on Windows 10 to avoid rectangular border artefacts with transparency
- CSS `border-radius` works visually on Windows 10 but hit-test area remains rectangular
- `backdrop-filter: blur()` works on both WebKit (macOS) and WebView2 (Windows)
- True OS-level frosted glass (vibrancy/acrylic) requires platform-specific Rust — use CSS `backdrop-blur` as the cross-platform default
