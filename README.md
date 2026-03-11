# Hoverpad

Desktop overlay app for managing markdown notes and tracking Claude Code CLI sessions. Built with Tauri v2 + React + TypeScript.

## Windows Installation

### Prerequisites

- [Node.js](https://nodejs.org/) v18+
- [Rust](https://rustup.rs/) (stable toolchain)
- [Visual Studio Build Tools](https://visualstudio.microsoft.com/visual-cpp-build-tools/) with the "Desktop development with C++" workload
- [WebView2 Runtime](https://developer.microsoft.com/en-us/microsoft-edge/webview2/) (pre-installed on Windows 10 21H2+ and Windows 11)

### Building from Source

1. Clone the repository:
   ```bash
   git clone https://github.com/your-org/hoverpad.git
   cd hoverpad
   ```

2. Install frontend dependencies:
   ```bash
   npm install
   ```

3. Build the application:
   ```bash
   npm run tauri build
   ```

4. The built artifacts are in `src-tauri/target/release/bundle/`:
   - `msi/Hoverpad_0.1.0_x64_en-US.msi` — Windows Installer package
   - `nsis/Hoverpad_0.1.0_x64-setup.exe` — NSIS installer

### Installing

**Option A — MSI Installer (recommended):**
Double-click the `.msi` file. It installs to `Program Files` and adds an entry to Add/Remove Programs for clean uninstallation.

**Option B — NSIS Installer:**
Double-click the `-setup.exe` file. It provides a guided install wizard with options for install location and desktop shortcut.

### Notes

- Windows SmartScreen may warn about an unrecognized app since the binary is not code-signed. Click "More info" → "Run anyway" to proceed.
- Hoverpad runs as a frameless overlay window. Use `Ctrl+H` to toggle visibility of all Hoverpad windows.
- Notes are stored in `~/hoverpad/notes/`.

## macOS Installation

### From GitHub Releases

1. Go to the [Releases](https://github.com/your-org/hoverpad/releases) page
2. Download the `.dmg` for your architecture:
   - `Hoverpad_*_aarch64.dmg` — Apple Silicon (M1/M2/M3/M4)
   - `Hoverpad_*_x64.dmg` — Intel
3. Open the `.dmg` and drag Hoverpad to your Applications folder
4. On first launch, macOS may block the app. Go to **System Settings → Privacy & Security** and click "Open Anyway".

### Building from Source

1. Install prerequisites:
   - [Xcode Command Line Tools](https://developer.apple.com/xcode/): `xcode-select --install`
   - [Node.js](https://nodejs.org/) v18+
   - [Rust](https://rustup.rs/) (stable toolchain)

2. Clone and build:
   ```bash
   git clone https://github.com/your-org/hoverpad.git
   cd hoverpad
   npm install
   npm run tauri build
   ```

3. The `.dmg` is in `src-tauri/target/release/bundle/dmg/`.

### Notes

- Hoverpad runs as a frameless overlay window. Use `Cmd+H` to toggle visibility of all Hoverpad windows.
- Notes are stored in `~/hoverpad/notes/`.

## Development

```bash
npm install
npm run tauri dev
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Tauri v2 |
| Frontend | React + TypeScript |
| Styling | Tailwind CSS v4 + shadcn/ui |
| State | Zustand |
| Editor | MDXEditor |
| Database | SQLite |
