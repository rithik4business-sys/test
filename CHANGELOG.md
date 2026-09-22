# Changelog

All notable changes to TypeWriter will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.0.0] - 2024-01-01

### Added

- Initial release of TypeWriter
- Full-screen terminal editor interface
- Syntax highlighting for 20+ programming languages
- Vim-like keybindings for efficient editing
- File operations (open, save, save as)
- Command mode with familiar commands
- Search and replace functionality
- Line numbers display
- Status bar with current mode and file info
- GitHub integration for project synchronization
- Device authentication flow for GitHub OAuth
- Auto-push projects to GitHub repositories
- Support for creating new repositories
- Configurable settings stored in ~/.typewriter
- PowerShell and batch wrappers for Windows
- Cross-platform support (Windows, macOS, Linux)

### Features

#### Editor Core

- **Modes**: Normal, Insert, Command, Search
- **Navigation**: Character, word, line, file movement
- **Editing**: Insert, delete, yank, paste operations
- **Commands**: Save, quit, open, new file, help
- **Search**: Forward search with match highlighting
- **Line Numbers**: Automatic line number display
- **Scrolling**: Horizontal and vertical scrolling
- **Status Bar**: Current mode, file, position, language

#### Syntax Highlighting

- **Languages**: TypeScript, JavaScript, Python, Go, Rust, Java, C, C++, HTML, CSS, Bash, PowerShell, SQL, GraphQL, and more
- **Tokens**: Keywords, strings, numbers, comments, functions, variables, operators
- **Colors**: Customizable color scheme for each token type

#### GitHub Integration

- **Authentication**: Device authorization flow
- **Repository Management**: Create new repositories
- **File Sync**: Push all project files to GitHub
- **Auto-Ignore**: Skip node_modules, .git, and other common directories

#### File Operations

- **Open Files**: Open existing files from command line or within editor
- **Save Files**: Save current file with :w command
- **Save As**: Save file with new name using :w filename
- **New Files**: Create new empty files with :new command

#### Configuration

- **Config Directory**: ~/.typewriter
- **Settings File**: config.json for editor preferences
- **Token Storage**: Secure storage for GitHub authentication

### Technical Details

- **Language**: TypeScript
- **Runtime**: Node.js (v14+)
- **Dependencies**: Zero runtime dependencies
- **Build**: TypeScript compiler
- **Architecture**: Modular design with separate components

### Supported Platforms

- Windows (PowerShell, Command Prompt)
- macOS (Terminal, iTerm2)
- Linux (Bash, Zsh, and other terminals)

### Keyboard Shortcuts

#### Normal Mode

- `i`, `a`, `I`, `A`: Enter insert mode
- `o`, `O`: Open new lines
- `:`: Command mode
- `/`: Search mode
- `h`, `j`, `k`, `l`: Navigation
- `w`, `b`: Word movement
- `0`, `$`: Line start/end
- `g`, `G`: File start/end
- `x`, `d`: Delete operations
- `y`, `p`: Yank and paste
- `u`, `r`: Undo and redo

#### Insert Mode

- `Escape`: Return to normal mode
- `Enter`: New line
- `Backspace`: Delete character
- `Tab`: Insert spaces
- Any character: Insert character

#### Command Mode

- `:w`: Save file
- `:q`: Quit editor
- `:wq`: Save and quit
- `:e filename`: Open file
- `:new`: New file
- `:help`: Show commands

## [1.3.0]

> Dates for 1.1.0–1.3.0 were not recorded at release time; the repository gained
> version control after these releases. Content below is derived from the shipped
> feature documentation in docs/USAGE.md.

### Added

- **True PTY terminals (web)**: xterm.js + node-pty over WebSocket — fullscreen
  apps, 256 colors, resize sync, per-tab scrollback; graceful exec fallback
- **LSP bridge**: hover (`K`), go-to-definition (`gd`), completion merge
  (`Ctrl+Space`) via typescript-language-server, pyright, gopls, rust-analyzer
- **AI agent tabs**: Claude Code / OpenCode / Codex detection, one-click install
  with streamed log, launch as named PTY tabs (token-gated install endpoint)
- GitHub **Settings → Account** in the web UI: device flow with code + timer +
  backoff, PAT validation with scope enforcement, repo list/create/settings,
  push review with per-file diffs, 401 auto-logout
- Windows-safe exec layer (`winsh.sh` quoting, `taskkill` tree kill, PS runners)
- TS test suite (36 tests) alongside the JS suite (97 tests)

## [1.2.0]

### Added

- Vim grammar parity across both UIs: counts, operators, text objects,
  visual mode, macros, marks, jumplist, dot-repeat
- TUI buffers + splits (`:ls :bn :bp :bd :sp :only`)
- Code runner (`:run`, ▶, `Ctrl+Enter`) for node/python3/bash/go/ruby/php/pwsh
- Persistent undo (web: localStorage per file, capped; TUI: `~/.typewriter/undo/`)

## [1.1.0]

### Added

- Web tabs (`:bn :bp :bd`, `Ctrl+PgUp/PgDn`), per-tab undo/redo, replace bar +
  `:s/old/new/g`, keyboard file tree, quick-open fuzzy finder (`Ctrl+P`),
  terminal conveniences (aliases, `tree`, ghost hints, sticky `cd`),
  `TYPEWRITER_TOKEN` Bearer auth on all `/api/*` routes

## [Unreleased]

### Planned

- File explorer sidebar
- Multiple file tabs
- Git integration
- Extensions/plugins system
- Custom themes
- Auto-complete
- Code folding
- Split views
- Remote file editing
- Container support

---

For more details, see the [README](README.md) and [USAGE](docs/USAGE.md) documentation.
