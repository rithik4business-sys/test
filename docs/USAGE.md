# TypeWriter Usage Guide

## Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/yourusername/typewriter.git
cd typewriter

# Install dependencies
npm install

# Build the project
npm run build

# Link globally (optional)
npm link
```

### Basic Usage

```bash
# Start the editor
typewriter

# Open a specific file
typewriter myfile.ts

# Get help
typewriter --help
```

## Editor Modes

### Normal Mode
The default mode for navigation and commands.

| Key | Action |
|-----|--------|
| `i` | Enter insert mode |
| `a` | Append after cursor |
| `I` | Insert at start of line |
| `A` | Append at end of line |
| `o` | Open new line below |
| `O` | Open new line above |
| `:` | Enter command mode |
| `/` | Search forward |
| `n` | Next search match |
| `N` | Previous search match |
| `h` | Move left |
| `j` | Move down |
| `k` | Move up |
| `l` | Move right |
| `w` | Move to next word |
| `b` | Move to previous word |
| `0` | Move to start of line |
| `$` | Move to end of line |
| `g` | Move to start of file |
| `G` | Move to end of file |
| `x` | Delete character |
| `d` | Delete line |
| `y` | Yank (copy) line |
| `p` | Paste line |
| `u` | Undo |
| `r` | Redo |
| `Escape` | Return to normal mode |

### Insert Mode
Mode for typing and editing content.

| Key | Action |
|-----|--------|
| `Escape` | Return to normal mode |
| `Enter` | New line |
| `Backspace` | Delete character before cursor |
| `Tab` | Insert 2 spaces |
| Any character | Insert character |

### Command Mode
Mode for executing commands.

| Command | Action |
|---------|--------|
| `:w` | Save file |
| `:w filename` | Save as new filename |
| `:q` | Quit (if no changes) |
| `:q!` | Quit without saving |
| `:wq` | Save and quit |
| `:x` | Save and quit |
| `:e filename` | Open file |
| `:new` | New empty file |
| `:theme <name>` | Switch theme (opencode set, persisted) |
| `:themes` | List available themes |
| `:help` | Show available commands |

### Search Mode
Mode for searching text.

| Key | Action |
|-----|--------|
| `Escape` | Cancel search |
| `Enter` | Execute search |
| `Backspace` | Delete character |
| Any character | Add to search query |

## GitHub Integration

### First Time Setup

```bash
# Login to GitHub
typewriter --login

# Follow the device authorization flow:
# 1. Visit the URL shown
# 2. Enter the code
# 3. Authorize TypeWriter
```

> Which login can create repositories? The shipped device flow signs you in
> through the TypeWriter **GitHub App**, and GitHub does not allow app logins
> (`ghu_` tokens) to call the create-repository endpoint — no scope or
> re-login changes that. To create repos, either paste a **classic** personal
> access token with the **`repo`** scope (Settings → Developer settings →
> Personal access tokens → Tokens (classic)), or register your own **OAuth
> App** and point the server at it with `TYPEWRITER_CLIENT_ID=<id>` — device
> flow through an OAuth App yields `gho_` tokens that can create repos.

### Pushing Projects

```bash
# Push current directory to GitHub
typewriter --push

# The tool will:
# 1. Create a new repository if needed
# 2. Add all project files
# 3. Push to GitHub
```

### Managing Authentication

```bash
# Check login status
typewriter --status

# Logout
typewriter --logout
```

### Web Settings → Account

The web UI (`npm run serve`) has a Settings → **Account** section (left bar)
that covers the same ground without the terminal:

- **Connection** — connect via GitHub device flow (code + link, polled until
  authorized) or paste a personal access token (`repo` scope); disconnect any time.
- **Repositories** — filter, refresh, switch between repos (selection persists
  to `~/.typewriter/config.json` as `githubRepo`), and create new repos
  (name, description, private flag — auto-selected on success).
- **Repo settings** — edit name, description, homepage, topics, visibility,
  default branch (picked from live branch list), issues/projects/wiki, squash /
  merge / rebase options, delete-head-branches, archived flag; push the current
  workspace to the selected repo; open the repo on GitHub.

The browser never sees the GitHub token — all calls go through the
`/api/github/*` server proxy, which reuses the CLI's token file and push rules
(secrets, binaries, and oversize files are skipped).

## Supported Languages

TypeWriter supports syntax highlighting for:

- **Web**: HTML, CSS, JavaScript, TypeScript, JSX, TSX
- **Systems**: C, C++, Rust, Go
- **Scripting**: Python, Ruby, Bash, PowerShell
- **Data**: JSON, YAML, XML, SQL, GraphQL
- **Other**: Markdown, Dockerfile, TOML, INI

## Configuration

Configuration is stored in `~/.typewriter/`:

- `config.json` - Editor settings (`theme` key persists the active opencode theme)
- `token` - GitHub authentication token

### Themes

TypeWriter ships the full opencode theme set (same names as
`sst/opencode/packages/tui/src/theme/assets/*.json`, dark variant):

`opencode, aura, ayu, carbonfox, catppuccin, catppuccin-frappe,
catppuccin-macchiato, cobalt2, cursor, dracula, everforest, flexoki, github,
gruvbox, kanagawa, lucent-orng, material, matrix, mercury, monokai, nightowl,
nord, one-dark, orng, osaka-jade, palenight, rosepine, solarized, synthwave84,
tokyonight, vercel, vesper, zenburn`

```bash
typewriter --themes            # list themes
typewriter --theme nord        # set default theme
```

TUI: `:theme <name>` / `:themes` · Web: `/commands` settings dialog.

## Keyboard Shortcuts Reference

### Navigation
```
h j k l     - Left, Down, Up, Right
w b         - Word forward, backward
0 $         - Start, End of line
g G         - Top, Bottom of file
Ctrl+D Ctrl+U - Half page down, up
```

### Editing
```
i a I A     - Enter insert mode
o O         - Open new line
x d         - Delete character, line
y p         - Yank, Paste
u r         - Undo, Redo
```

### Commands
```
:           - Enter command mode
/           - Search
n N         - Next, Previous match
```

### File Operations
```
:w          - Save
:q          - Quit
:wq         - Save and quit
:e file     - Open file
:new        - New file
:theme name - Switch theme (opencode set)
:themes     - List themes
```

## Tips and Tricks

1. **Quick Save**: Press `:w` then `Enter` to save
2. **Fast Navigation**: Use `w` and `b` to move by words
3. **Search**: Press `/` then type to search, `n` for next match
4. **Multiple Files**: Use `:e filename` to open another file
5. **Line Numbers**: The editor shows line numbers automatically

## v1.3.0 — production: true PTY, LSP, full tests

### True terminal (web)
New terminal tabs are real PTYs (xterm.js frontend, node-pty backend, WebSocket transport): fullscreen apps (`vim`, `top`, `ssh`), 256 colors, resize sync, per-tab scrollback. `+` creates PTY tabs; `:run` still uses a fast exec tab. Without `node-pty`, tabs degrade to the exec engine with a warning.

### LSP (hover · completion · go-to-definition)
`K` hover docs · `gd` jump to definition · `Ctrl+Space` merges server completions above word matches. Bridge spawns real servers per language (`typescript-language-server`, `pyright`, `gopls`, `rust-analyzer`) over stdio JSON-RPC. Missing server → one-time install hint, everything else keeps working.

Install servers: `npm i -g typescript-language-server` · `pip install pyright` · `go install golang.org/x/tools/gopls@latest` · `rustup component add rust-analyzer`

### Tests — 37 green
`test/highlight` (14) · `test/utils` (3) · live API incl. auth/traversal/binary (8+) · **TUI driven through a real PTY** (boot, `G` motion, insert-save-quit roundtrip, `:theme`/`:sp`) · **PTY WebSocket** (vendor assets, shell echo, LSP graceful error) · **agents** (detect `claude`/`opencode`/`codex`, install guards).

### AI agents (header buttons)
Claude Code · OpenCode · Codex buttons sit in the top bar with a status dot (green = installed). Clicking an installed agent opens it as a named PTY tab running in the project root. Clicking a missing one opens a permission dialog showing the exact install command (`npm i -g …` / official opencode script); on confirm, the server runs it as a tracked background job with live log streaming, then auto-launches. Install endpoint requires `TYPEWRITER_TOKEN` to be set (same hardening as `/api/exec`). Detection checks `PATH` plus known homes (`~/.opencode/bin`, `~/.local/bin`).

### Deps (only what code can't do)
`node-pty` (kernel PTYs need native code) · `ws` (safe WebSocket framing) · `xterm` + `xterm-addon-fit` (terminal emulation). No frameworks, no build step for the frontend.

## v1.2.0 additions

### Vim grammar (both UIs)
Counts (`3j d2w`), operators (`d/c/y` + motions, `dd yy cc`), text objects (`ci" di( daw`), macros (`qa…q @a @@`). TUI also: `e` motion, `G` with count.

### TUI buffers + splits
`:ls :bn :bp :b :bd` with dirty guards · `:sp [file]` horizontal split (independent scroll, `▌` marks active pane) · `:only` · `Ctrl+W` switches pane.

### Completion
Web `Ctrl+Space` (buffer words + keywords, palette UI) · TUI insert `Ctrl+N` / `Ctrl+P` cycling.

### Code runner
`:run`, ▶ button, `Ctrl+Enter` — auto-saves, runs in the file's directory (node, python3, bash, go run, ruby, php, pwsh).

### Persistent undo
Web: per-file stacks in localStorage (capped). TUI: `~/.typewriter/undo/` (capped, throttled, saved on exit).

### Token hygiene
Client auth uses headers only; images carry `?token=` in `src` (unavoidable for `<img>`), never in the address bar. Don't share `?token=` URLs.

## v1.1.0 additions

### Tabs (web)
Click, `:bn` / `:bp`, `Ctrl+PgUp` / `Ctrl+PgDn`, `:bd` (dirty tabs need `:bd!`). `:e` switches if already open.

### Undo / redo (web, per tab)
`Ctrl+Z` / `Ctrl+Y` (or `Ctrl+Shift+Z`). Debounced snapshots, 100 steps.

### Replace
`Ctrl+H` replace bar (Enter = replace all) or `:s/old/new/g` (literal, counted). TUI: `:s/old/new/g` (regex).

### File tree without a mouse (web)
`E` focuses the tree: arrows/`hjkl` move, `Enter`/`→` opens, `←` collapses, `a` new file here, `d` delete (press twice), `r` rename, `Esc` back. Breadcrumb segments reveal files in the tree.

### Quick-open
`Ctrl+P` or `:o` — fuzzy subsequence match, `↑↓` + `Enter`.

### Terminal (web)
`dir type cls del md move copy` auto-translate on `sh`; `tree [dir]` builtin; ghost hint (`→`/`Tab` accepts); `cd` sticks; `clear` clears.

### TUI file ops
`:rm[!] <path>`, `:mv <old> <new>`, tree `d` (press twice to confirm files).

### API auth
`TYPEWRITER_TOKEN=secret npm run serve` — every `/api/*` then needs `Authorization: Bearer secret` (or `?token=`). The web UI prompts and remembers it per browser.

### Tests
`npm test` — builds, then runs `node:test` suites: highlight (12), utils (3), live API incl. auth + traversal guards (8).

## Troubleshooting

### Editor won't start
- Ensure Node.js is installed (v18+)
- Run `npm run build` to compile TypeScript

### GitHub login fails
- Check your internet connection
- Ensure you have a GitHub account
- Try logging out and back in: `typewriter --logout && typewriter --login`

### Files not saving
- Check file permissions
- Ensure you're in the correct directory
- Use `:w filename` to save as a new file

## Support

## GitHub login UX (web: Settings → Account)

Logged out, Account shows a single login card — repository UI appears only
once you are logged in, and repo settings only once a repository is selected.
Copy throughout uses Login / Logout wording.

- **Login with GitHub** — device flow: a large code, a Copy button, an
  `Open github.com/login/device` link, and a live `Waiting for approval…`
  elapsed timer with Cancel. Polling backs off (5s → 10s) and stops at the
  15-minute code expiry with `Code expired — start over`.
- **Paste a classic token — enables repo creation** — collapsed link that
  reveals the token input plus the 3-step recipe for minting one. Tokens are
  validated via `GET /user` (+ scope header) before storing: only tokens
  proven able to create repositories are saved. Fine-grained tokens, app
  tokens, and classic tokens without `repo` are rejected at save time with
  the reason spelled out (e.g. incapable pastes are refused before storing).
- **Profile header** — avatar image, display name + `@handle`; Logout is an
  icon-only button that asks `Confirm?` for 4s (no modal).
- **Repositories** — search filter (kept across refreshes), Private/Public
  pills, relative updated times, click to select; Refresh re-fetches.
  Creating a repo selects it (no auto-push).
- **Session expiry** — any expired/revoked token (GitHub 401) drops the
  stored token and returns the UI to the login card with
  `Session expired — please log in again`. Nothing stays half-authed.
- **Header push button** (`Push workspace to GitHub`) — logged out it opens
  Account with `Log in to push`; logged in without a repo it opens Account
  with `Select a repository to push to`; otherwise it opens a **push review**
  (repo + branch target, commit message, exact file list with sizes, local
  git changes with per-file diffs when the workspace is a git checkout) with
  Cancel / Push confirmation — nothing pushes blind.
- **Keyboard** — opening Account focuses Login; Enter activates; Esc closes
  Settings from anywhere.

- GitHub Issues: https://github.com/yourusername/typewriter/issues
- Documentation: https://github.com/yourusername/typewriter/blob/main/README.md
