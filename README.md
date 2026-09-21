# TypeWriter v1.3.0

A GitHub-connected code editor in TypeScript — a terminal TUI **and** a web IDE sharing one engine. Three optional production deps (`node-pty`, `ws`, `xterm`); everything else is stdlib.

## Two editors, one project

| | Terminal TUI (`npm start`) | Web IDE (`npm run serve` → :3000) |
|---|---|---|
| Layout | header · explorer · code · term panel · statusline | same + tabs · breadcrumbs |
| Modes | normal / insert / command / search | same (editor) |
| Terminal | pipes via local shell (`:!`, `:term`, SPC+Tab) | **true PTY** (xterm.js + node-pty, multi-tab) + exec fallback: sticky cwd, ANSI colors, aliases, `tree` builtin, ghost hints |
| Themes | `:theme` (opencode set) | `/commands` dialog, persisted |

## Quick start

```bash
npm install && npm run build
npm start            # terminal editor
npm run serve        # web IDE on :3000
npm test             # build + 86 tests (node:test, no extra deps)
```

## Web IDE keys (no mouse needed)

| Key | Action |
|-----|--------|
| `:` | command (`:w :q :e :o :new :bn :bp :bd :term :run :s/old/new/g :123 :help`) |
| `hjkl w b e 0 $ gg G` + counts | motions (`3j d2w ci" qa…q @a`) |
| `/` | search · `n` next · `Shift+Enter` prev |
| `Ctrl+P` / `:o` | quick-open fuzzy finder |
| `E` | file-tree keys: arrows/`hjkl`, `Enter` open, `a` new, `d` delete (×2), `r` rename, `Esc` back |
| `Space` then `Tab` | terminal toggle (works while typing) |
| `Ctrl+Z` / `Ctrl+Y` | undo / redo (per tab) |
| `Ctrl+H` | replace bar · `:s/old/new/g` |
| `Ctrl+PgUp/PgDn` | switch tabs |
| Terminal `Tab` | accept hint → path-complete → empty closes |
| `→` | accept ghost hint |

## Terminal TUI keys

`i a o : / hjkl w b e 0 $ g G counts d/c/y+i/a q/@ Ctrl+N` · `:w :q :e :new :ls/:bn/:bp/:bd :sp/:only :s :rm[!] :mv :run` · `Tab` panes · `SPC+Tab` terminal · tree `d` deletes (×2 confirms).

## Server API + auth

`GET /api/tree /api/file?p= /api/raw?p=` · `POST /api/save /api/delete /api/rename /api/exec`

```bash
TYPEWRITER_TOKEN=secret npm run serve   # all /api/* need Bearer token (or ?token=)
```

Traversal-safe (`safeJoin`), root-delete refused, 30s exec cap, 2MB file cap.

## GitHub

`typewriter --login` (device flow) → `typewriter --push` (creates repo, pushes tree).

## Tests

`test/highlight.test.js` · `test/utils.test.js` · `test/api.test.js` (live server incl. auth + traversal) · `test/github.test.js` (validators + live 409 guards) · `test/agents.test.js` · `test/pty.test.js` · `test/tui.test.js`.

## License

MIT
