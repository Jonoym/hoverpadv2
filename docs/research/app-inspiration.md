# App Inspiration Research

Research into existing applications for inspiration on Hoverpad's design as a desktop overlay combining markdown notes with AI coding session tracking.

---

## 1. Innovative Note-Taking Apps

### Heptabase - Visual Thinking Canvas
- **What it does:** Combines long-form writing, database organization, and visual thinking on interactive canvases (whiteboards). Users create mind maps, diagrams, and link notes spatially.
- **What's unique:** The spatial canvas is the primary interface, not a sidebar feature. Notes live *on* a canvas and can be rearranged, grouped, and connected visually. Tags integrate into databases for to-do management.
- **Ideas for Hoverpad:** Spatial arrangement of overlay windows *is* Hoverpad's canvas -- the desktop itself. Could add visual connection lines between related note windows or session windows. Window arrangement presets ("layouts") could act like saved canvases.

### Tana - Structured Outliner with AI
- **What it does:** Supertag-based outliner where everything is a node. Strong AI integration (GPT-5 available in AI Chat, custom agents, AI-enhanced fields, command nodes).
- **What's unique:** The "supertag" system lets you define schemas for different types of content. AI agents can be custom-built within the tool. Command nodes automate workflows.
- **Ideas for Hoverpad:** Typed notes (session note, scratch note, journal entry, task) with different schemas/templates. AI-powered fields that auto-populate (e.g., session summary generated from JSONL logs).

### Capacities - Object-Based Notes
- **What it does:** Everything is a typed "object" (meeting, person, book, project). Label properties for categorization. Funnel quick-capture on iOS. Fast graph view.
- **What's unique:** Object-oriented approach to notes. You don't create "notes" -- you create typed objects with properties. Queries let you filter and find objects by any property combination.
- **Ideas for Hoverpad:** Session objects with structured properties (tokens used, duration, model, project). Quick-capture that creates the right "type" automatically. Query/filter views across sessions and notes.

### SiYuan - Local-First Block Editor
- **What it does:** Open-source, block-level editing with database backing. Started as Obsidian-like markdown but migrated to SQLite for better block support. Whiteboard on roadmap.
- **What's unique:** Local-first with database storage (not flat files). Block-level referencing and transclusion. Open source.
- **Ideas for Hoverpad:** Already using SQLite + markdown files, which is similar. Block-level references between notes and sessions could be powerful (e.g., embed a session summary block inside a note).

### Reflect - Frictionless Capture
- **What it does:** Networked note-taking with backlinks, end-to-end encryption, web clipper, Kindle highlight sync. Focus on speed and privacy.
- **What's unique:** Extreme focus on capture speed -- "frictionless thought capture." Everything syncs instantly. Clean, minimal interface that gets out of the way.
- **Ideas for Hoverpad:** The overlay format is inherently frictionless -- notes are always visible. Could add global hotkey for instant text capture into a floating scratch window. Clipboard integration for quick paste-and-save.

### Mem.ai - AI-First Knowledge Engine
- **What it does:** Combines voice capture, web clipper, AI-powered organization, semantic search ("Deep Search"), and AI Chat that can reference your notes.
- **What's unique:** Voice Mode that transcribes and *structures* notes automatically. AI doesn't just search -- it organizes and surfaces relevant context proactively. "Copilot" surfaces related notes while you type.
- **Ideas for Hoverpad:** Auto-summarize Claude Code sessions into structured notes. Surface related notes when viewing a session (e.g., "you wrote about this topic 3 days ago"). Voice-to-note capture via overlay.

### Obsidian Hover Editor Plugin
- **What it does:** Transforms Obsidian's page preview hover into a full floating editor. Pin popups to keep them open. Resize and reposition.
- **What's unique:** Floating editor windows *within* an app -- mini multi-window. Shows how useful it is to have multiple notes visible simultaneously without full window management.
- **Ideas for Hoverpad:** Already doing this at the OS level, which is more powerful. Could support "peek" mode where hovering over a link in a note briefly shows the target in a small overlay.

---

## 2. AI Coding Session Trackers & Dashboards

### Agentlytics - Unified AI Coding Analytics
- **Website:** https://agentlytics.io
- **What it does:** Reads local chat history from Cursor, Windsurf, Claude Code, VS Code Copilot, Zed, and more. Presents a unified analytics dashboard. Nothing leaves your machine.
- **Key features:**
  - KPI dashboard with activity heatmaps
  - Coding streaks and velocity metrics
  - Token economy breakdown (input vs output)
  - Peak hours analysis
  - Per-project analytics (sessions, messages, tokens, models)
  - Tool frequency heatmaps
  - Side-by-side editor comparison with efficiency ratios
  - Cost estimation by model, editor, project, and month
- **Ideas for Hoverpad:** Activity heatmap widget showing coding intensity over time. Token economy visualization (input vs output ratio). Per-project session grouping with aggregate stats. Coding streak tracking as a motivational widget.

### OpenUsage - Menu Bar AI Limits Tracker
- **Website:** https://www.openusage.ai
- **What it does:** Menu bar app showing AI coding subscription usage across Cursor, Claude Code, Codex, Copilot, Windsurf, and more. Built with **Tauri + React + TypeScript** (same stack as Hoverpad!).
- **Key features:**
  - Progress bars showing subscription usage percentage
  - Auto-discovers local accounts
  - Global keyboard shortcut to toggle panel
  - Plugin architecture (each provider is a plugin)
  - Background refresh on configurable schedule
  - Open source
- **Ideas for Hoverpad:** Usage progress bars in the overlay. Plugin architecture for different AI tool integrations. The "global shortcut to toggle" pattern validates Hoverpad's Ctrl+H approach. Could show rate limit warnings proactively.

### SigNoz Claude Code Dashboard
- **Website:** https://signoz.io/docs/dashboards/dashboard-templates/claude-code-dashboard/
- **What it does:** OpenTelemetry-based monitoring dashboard for Claude Code with pre-built chart templates.
- **Key features:**
  - Token usage split (input vs output)
  - Session and conversation counts
  - Cost monitoring (tokens to dollars)
  - Command duration P95 charts
  - Request success rate pie charts
  - Team adoption metrics
- **Ideas for Hoverpad:** P95 response time tracking per session. Success/failure rate visualization. Cost-per-session calculation. These are enterprise-grade metrics that could be simplified for individual developer use.

### Claude Code Usage Monitor
- **GitHub:** github.com/Maciek-roboblog/Claude-Code-Usage-Monitor
- **What it does:** Real-time terminal monitoring tool with ML-based predictions for token usage.
- **Key features:** Token consumption tracking, burn rate calculation, cost analysis, predictive warnings.
- **Ideas for Hoverpad:** Burn rate indicator showing how fast you're consuming tokens. Predicted time until rate limit. Warning overlay when approaching limits.

### Trackr - AI Coding Tool Analytics
- **What it does:** Tracks token usage, costs, and AI-assisted commits across Claude Code, Cursor, and GitHub Copilot.
- **Ideas for Hoverpad:** Tie session tracking to git commits -- show which commits were AI-assisted and their token cost.

### ClaudeUsageBar / ClaudeMeter / CodexBar
- **What they do:** Various macOS menu bar apps for tracking Claude usage at a glance.
- **Ideas for Hoverpad:** Validates the "glanceable usage info" pattern. A small always-visible token counter in the overlay chrome would be useful.

### CLI Continues
- **GitHub:** github.com/yigitkonur/cli-continues
- **What it does:** Resume any AI coding session across 14 tools by reading native formats and generating structured context for handoff.
- **Ideas for Hoverpad:** Session context export/import. "Continue this session" button that generates a context summary for starting a new Claude Code session.

---

## 3. Desktop Overlay & Widget Apps

### Seelen UI - Web-Based Desktop Environment
- **Website:** https://seelen.io
- **What it does:** Full desktop environment overlay for Windows 10/11. Tiling window manager, status bar, floating dock, custom flyouts, widgets. Built on WebView2.
- **Key features:**
  - Top status bar with system info
  - Tiling window manager
  - Custom widget system (weather, media, system monitors)
  - Theme system (CSS/HTML/JS based)
  - Plugin architecture
- **Ideas for Hoverpad:** Status bar concept for showing active session info. Widget-style panels that can be individually toggled. Theme system for customizing overlay appearance.

### Rainmeter (Windows)
- **What it does:** Classic Windows desktop customization with skins/widgets. Community-driven with thousands of skins.
- **What's unique:** Extremely lightweight. Skins can show system stats, RSS feeds, media controls, weather, clocks. Modular -- each widget is independent.
- **Ideas for Hoverpad:** Modular widget approach where each overlay element is independent. Resource-efficient rendering. Community skin/theme potential.

### Ubersicht (macOS)
- **What it does:** Runs system commands and displays output as desktop widgets using HTML5.
- **What's unique:** Widgets are just HTML/CSS/JS that can execute shell commands. Dead simple mental model.
- **Ideas for Hoverpad:** The "widget as HTML rendering shell command output" pattern is powerful. Could let users create custom overlay widgets that show arbitrary command output.

### tauri-plugin-wallpaper
- **What it does:** Tauri plugin for advanced window positioning on Windows. Windows survive Win+D (Show Desktop).
- **Ideas for Hoverpad:** Surviving Show Desktop is important for an overlay app. This plugin could solve that specific UX problem.

### Scratchpad (Sindre Sorhus)
- **What it does:** Menu bar app for instant thought capture. Single always-accessible note. iCloud sync.
- **What's unique:** Radical simplicity -- one note, always available. No folders, no organization, just capture.
- **Ideas for Hoverpad:** A "scratch" overlay window that's always one hotkey away. No need to create a note first -- just type. Can be filed/organized later.

### Snipaste - Screenshot Pin Tool
- **What it does:** Screenshot tool that can pin captures as floating windows on the desktop.
- **What's unique:** The "pin to desktop" metaphor -- take something transient (screenshot) and make it persistent and always-visible.
- **Ideas for Hoverpad:** Pin any content as a floating overlay -- not just notes but also screenshots, code snippets, terminal output. "Pin this session output" feature.

---

## 4. Synthesized Ideas for Hoverpad

### High-Value Feature Ideas

| Idea | Inspired By | Description |
|------|------------|-------------|
| **Activity Heatmap Widget** | Agentlytics | Small overlay showing coding activity intensity over past 7/30 days |
| **Token Burn Rate Indicator** | Claude Code Usage Monitor | Real-time indicator showing token consumption speed with ETA to limit |
| **Usage Progress Bar** | OpenUsage | Compact bar showing subscription usage percentage, always visible |
| **Scratch Capture Window** | Scratchpad, Reflect | Global hotkey opens a minimal floating text input -- press Enter to save as note |
| **Session-to-Commit Linking** | Trackr | Auto-detect git commits made during a Claude Code session, show in session view |
| **Spatial Window Layouts** | Heptabase | Save/restore arrangements of overlay windows as named layouts |
| **Auto-Summary Notes** | Mem.ai | Generate structured summaries from Claude Code JSONL session logs |
| **Related Content Surfacing** | Mem.ai | When viewing a session, show related notes/sessions in a sidebar |
| **Pin Anything** | Snipaste | Pin code snippets, terminal output, or screenshots as small overlay windows |
| **Provider Plugin System** | OpenUsage | Extensible plugins for tracking different AI tools beyond Claude Code |
| **Coding Streak Counter** | Agentlytics | Gamification -- show consecutive days with AI coding sessions |
| **Session Cost Calculator** | SigNoz | Estimate dollar cost per session based on token usage and model pricing |
| **Peek Preview** | Obsidian Hover Editor | Hover over a link in a note to see a mini-preview overlay |
| **Typed Notes** | Tana, Capacities | Different note types (session note, scratch, journal, task) with schemas |
| **Win+D Survival** | tauri-plugin-wallpaper | Overlay windows persist through Show Desktop on Windows |
| **Status Bar Mode** | Seelen UI | Collapse overlay into a thin top/bottom status bar showing key metrics |

### UX Patterns Worth Adopting

1. **Glanceable metrics** (OpenUsage, ClaudeUsageBar): Small, always-visible indicators that answer "how am I doing?" without requiring interaction.
2. **Progressive disclosure** (Agentlytics): Overview dashboard that drills down into per-project, per-session, per-model detail.
3. **Frictionless capture** (Reflect, Scratchpad): Minimize steps between thought and saved note. One hotkey, type, done.
4. **Spatial organization** (Heptabase): Position and arrangement carry meaning. Let users organize by placing things where they make sense.
5. **Auto-enrichment** (Mem.ai, Tana): AI that adds structure and context automatically, rather than requiring manual organization.

### Architecture Validation

- **OpenUsage** uses the exact same stack (Tauri + React + TypeScript) and validates the menu bar / overlay pattern.
- **Seelen UI** proves that web-based desktop overlays on Windows are viable and performant.
- **Agentlytics** shows that reading local AI tool chat history files is a proven approach (same as Hoverpad's JSONL parsing).
- **Multiple menu bar apps** confirm that developers want glanceable AI usage info.

---

## Sources

- [Agentlytics - GitHub](https://github.com/f/agentlytics)
- [Agentlytics](https://agentlytics.io/)
- [OpenUsage - AI Limits Tracker](https://www.openusage.ai/)
- [OpenUsage - GitHub](https://github.com/robinebers/openusage)
- [SigNoz Claude Code Dashboard](https://signoz.io/docs/dashboards/dashboard-templates/claude-code-dashboard/)
- [SigNoz - Claude Code Monitoring with OpenTelemetry](https://signoz.io/blog/claude-code-monitoring-with-opentelemetry/)
- [Claude Code Usage Monitor - GitHub](https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor)
- [Trackr - AI Coding Tool Analytics](https://trackr-bay.vercel.app/welcome)
- [CLI Continues - GitHub](https://github.com/yigitkonur/cli-continues)
- [ClaudeUsageBar](https://www.claudeusagebar.com/)
- [CodexBar - GitHub](https://github.com/steipete/CodexBar)
- [ClaudeMeter](https://eddmann.com/ClaudeMeter/)
- [Heptabase - Product Hunt](https://www.producthunt.com/products/heptabase)
- [Tana vs Heptabase Comparison](https://paperlessmovement.com/videos/heptabase-vs-tana-which-is-the-best-note-taking-and-pkm-app-of-2025/)
- [Capacities vs Tana vs Heptabase Comparison](https://noteapps.info/apps/compare?note_app=capacities+heptabase+tana)
- [SiYuan Alternatives - Medium](https://medium.com/@theo-james/siyuan-alternatives-personal-knowledge-management-tools-in-2025-f85be7351f45)
- [Reflect Notes](https://reflect.app)
- [Mem.ai - Best AI Note-Taking Apps](https://get.mem.ai/blog/best-ai-note-taking-apps-2025)
- [Mem vs Reflect Comparison](https://aloa.co/ai/comparisons/ai-note-taker-comparison/mem-vs-reflect)
- [Obsidian Hover Editor - GitHub](https://github.com/nothingislost/obsidian-hover-editor)
- [Seelen UI - GitHub](https://github.com/eythaann/Seelen-UI)
- [Seelen UI](https://seelen.io/)
- [Seelen UI - XDA Developers](https://www.xda-developers.com/seelen-ui-closest-have-to-custom-desktop-environment-windows-its-incredible/)
- [tauri-plugin-wallpaper - GitHub](https://github.com/meslzy/tauri-plugin-wallpaper)
- [Tauri v2 Window Customization](https://v2.tauri.app/learn/window-customization/)
- [Scratchpad by Sindre Sorhus](https://sindresorhus.com/scratchpad)
- [Scratch Pad for Developers - GitHub](https://github.com/pbean/scratch-pad)
- [Rainmeter Alternatives - XDA](https://www.xda-developers.com/best-rainmeter-alternatives/)
- [Best Note Taking Apps 2026 - noteapps.info](https://noteapps.info/best_note_taking_apps_2026)
- [Best Note Taking Apps - Zapier](https://zapier.com/blog/best-note-taking-apps/)
