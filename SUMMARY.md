# TypeWriter - Project Summary

## Overview

TypeWriter is a lightweight terminal **and** web code editor built with TypeScript — one engine, two surfaces (TUI + browser IDE). Four runtime dependencies are used only where stdlib can't reach (`node-pty` for kernel PTYs, `ws` for WebSocket framing, `xterm` + `xterm-addon-fit` for terminal emulation in the browser); everything else is Node stdlib.

## Project Structure

```
typewriter/
├── src/
│   ├── index.ts          # CLI entry (--help --serve --login --push --theme …)
│   ├── editor.ts         # TUI editor core (vim grammar, buffers, splits, undo)
│   ├── server.ts         # HTTP API + WebSocket bridge (PTY, LSP, auth)
│   ├── github.ts         # GitHub API: device flow, repos, push, scope guards
│   ├── collect.ts        # Project file collection for push (ignore rules)
│   ├── complete.ts       # Line/ghost completion (recent, snippet, ngram, bracket)
│   ├── highlight.ts      # Token-based syntax highlighting (20+ languages)
│   ├── structures.ts     # RingBuffer / LinkedStack / CappedBuffer (O(1), capped)
│   ├── themes.ts         # Theme definitions (34 themes)
│   ├── utils.ts          # Config/token/session, atomic writes, safePath
│   └── winsh.ts          # Windows-safe shell quoting, runners, taskkill
├── public/index.html     # Web IDE (single-file frontend)
├── test/                 # JS suite (node:test) incl. live-API + PTY-driven TUI
├── test-ts/              # TS suite
├── scripts/bench.js      # Benchmarks (npm run bench)
├── dist/                 # Compiled JavaScript (gitignored)
├── docs/
│   ├── USAGE.md          # Usage documentation
│   └── GITHUB-LOGIN-PLAN.md
├── assets/               # Icons
├── package.json          # Project configuration
├── tsconfig.json         # TypeScript configuration
├── README.md · CHANGELOG.md · CONTRIBUTING.md · LICENSE
├── typewriter.ps1        # PowerShell wrapper
└── typewriter.bat        # Windows batch wrapper
```

## Features

### Core Editor
- **Full-screen terminal interface** with line numbers
- **Vim-like keybindings** for efficient editing
- **Multiple modes**: Normal, Insert, Command, Search
- **File operations**: Open, Save, Save As, New
- **Search and replace** with match highlighting
- **Horizontal and vertical scrolling**

### Syntax Highlighting
- **20+ programming languages** supported
- **Token-based highlighting** for keywords, strings, numbers, comments
- **Language detection** from file extensions

### GitHub Integration
- **Device authentication flow** for secure login
- **Auto-push projects** to GitHub repositories
- **Create new repositories** automatically
- **Smart file filtering** (skips node_modules, .git, etc.)

### Cross-Platform
- **Windows**: PowerShell and Command Prompt support
- **macOS**: Terminal and iTerm2 support
- **Linux**: Bash, Zsh, and other terminals

## Technical Details

### Architecture
- **Modular design** with separate components
- **TypeScript** for type safety
- **Zero runtime dependencies** for fast startup
- **Event-driven** editor core

### Performance
- **Lightweight**: no Electron — the TUI runs on plain Node, the web IDE reuses your browser
- **Measured, not guessed**: run `npm run bench` for startup, highlighting throughput,
  completion latency, and ring-buffer throughput on your machine. Numbers go into
  docs only when they come from that run.

Reference run (2026-09-22, linux/x64, Node v24.20.0 — reproduce with `npm run bench`):

| Metric | Result |
|---|---|
| CLI startup (`--version`, median of 10) | 91.6 ms |
| Highlight throughput (200-line JS buffer) | 8,646 KB/s (1.12 ms median) |
| Completion suggestion latency | 2.5 µs |
| RingBuffer push throughput | 71.6 M ops/sec |

### Security
- **Local token storage** only
- **OAuth 2.0** device flow
- **No telemetry** or data collection
- **HTTPS** for all GitHub API calls

## Installation

```bash
# Clone repository
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Install dev dependencies
npm install

# Build project
npm run build

# Link globally (optional)
npm link
```

## Usage

```bash
# Start editor
typewriter

# Open file
typewriter myfile.ts

# Login to GitHub
typewriter --login

# Push to GitHub
typewriter --push

# Get help
typewriter --help
```

## Development

### Prerequisites
- Node.js v18 or higher (uses `fetch` and the built-in test runner)
- npm

### Commands
```bash
npm install      # Install dependencies
npm run build    # Build TypeScript
npm run dev      # Build and run
npm start        # Run compiled version
```

### Code Structure
- **editor.ts**: Core editor logic and state management
- **highlight.ts**: Syntax highlighting engine
- **github.ts**: GitHub API integration
- **utils.ts**: Utility functions and configuration
- **index.ts**: Main entry point and CLI

## Testing

```bash
npm test        # build + JS suite (97 tests, node:test)
npm run test:ts # TS suite (36 tests) — 133 total
npm run bench   # startup / highlight / completion benchmarks
```

## Documentation

- **README.md**: Main documentation
- **docs/USAGE.md**: Detailed usage guide
- **CHANGELOG.md**: Version history
- **CONTRIBUTING.md**: Contribution guidelines

## License

MIT License - see LICENSE file for details.

## Support

- **GitHub Issues**: Report bugs and request features
- **Documentation**: Comprehensive usage guides
- **Community**: Welcome contributions and feedback

## Roadmap

### Shipped (previously listed here as plans)
- File explorer sidebar · multiple file tabs · split views · themes (34) ·
  auto-complete (buffer words + LSP) · git status/diff in the push review ·
  true PTY terminals · LSP hover/definition/completion · AI agent tabs

### Planned
- In-editor git commit/branch/log UI (server endpoints exist, UI pending)
- Project-wide search UI (server endpoint exists, UI pending)
- LSP diagnostics (squiggles + Problems panel), rename, format
- Code folding · multi-cursor · auto-pairing · vim `f/F/t/T`, `*`/`#`, `%`, ranges, `:g`
- Extensions/plugins system · packaged remote/tunnel editing · container support

---

**TypeWriter** - Code in your terminal. Push to GitHub. Ship faster.
