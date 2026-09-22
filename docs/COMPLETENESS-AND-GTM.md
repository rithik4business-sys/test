# TypeWriter — Completeness Audit & GTM Product Sheet

> **Status:** v1.0 draft, grounded in a full-source read of `src/` (6,778 LOC), `public/index.html` (2,738 LOC), tests (133/133 green at baseline), and docs.
> **Evidence rule:** every "missing" claim below cites the file/line proof, or an explicit absence check (grep pattern + result: NONE). Line numbers refer to the pre-review snapshot; they may shift after bug-fix work lands.
> **Date:** 2026-09-22

---

## PART 1 — WHAT THIS PRODUCT IS TODAY (verified, not aspirational)

Marketing docs (SUMMARY.md, CHANGELOG.md) are significantly stale. This is what the **code** actually does:

### 1.1 Terminal TUI (`npm start`) — `src/editor.ts` (2,222 lines)
- Vim grammar: motions `hjkl w b e 0 $ gg G`, counts, operators `d/c/y` + motions, text objects `ci" di( daw`, visual `v/V`, macros `qa…q @a @@`, marks `ma 'a`, jumplist `Ctrl+O/Ctrl+I`, dot-repeat `.`, search `/ n N`, `:s/old/new/g` (regex)
- Buffers + splits: `:ls :bn :bp :bd :sp :only`, `Ctrl+W`/`Tab` pane nav
- File ops `:e :w :new :rm :mv`, code runner `:run`, terminal panel (`:term`, pipes via local shell with Windows-safe quoting — `src/winsh.ts`)
- Themes `:theme` (34 themes), persistent undo in `~/.typewriter/undo/` (capped, throttled)
- Tree sidebar with keyboard nav, mouse support (X10 report)

### 1.2 Web IDE (`npm run serve`) — `public/index.html` (2,738 lines) + `src/server.ts` (1,575 lines)
- Tabs, breadcrumbs, fuzzy `Ctrl+P`, file tree (full keyboard: `E` mode), replace bar, per-tab undo (localStorage, capped)
- **True PTY** terminal (xterm.js + node-pty, multi-tab, resize sync) + exec fallback
- **LSP bridge** over WS: hover (`K`), go-to-def (`gd`), completion merge (`Ctrl+Space`) — servers: tsserver, pyright, gopls, rust-analyzer (`src/server.ts:213-312`)
- **Git status/diff** in push review (`public/index.html:915-933`), **GitHub** device-flow login, PAT with scope validation, repo create/settings/push — browser never sees the token (`/api/github/*` proxy)
- **AI agent tabs**: Claude Code / OpenCode / Codex detection + install + launch (`src/server.ts:62-81`)
- Auth: `TYPEWRITER_TOKEN` Bearer on every `/api/*` + WS upgrade; traversal-safe paths; 30s exec cap; 2MB file cap
- Image/binary preview (`public/index.html:1620`), 34 themes, font-size + tab-limit settings

### 1.3 Infrastructure that exists but is **orphaned** (built, never wired to a UI)
| Capability | Server proof | UI proof |
|---|---|---|
| Project-wide search | `POST /api/search` — `src/server.ts:1034` | **NONE** — no `api/search` call in `public/index.html` |
| Local git commit | `POST /api/git/commit` — `src/server.ts:1124` | **NONE** — never called from UI |
| Local git pull | `POST /api/git/pull` — `src/server.ts:1137` | **NONE** |
| Local git init | `POST /api/git/init` — `src/server.ts:1130` | **NONE** |

These are **dead endpoints from the user's perspective** — work already paid for, not shipped.

---

## PART 2 — WHAT'S MISSING (the honest list)

Severity = impact on "is this a complete editor?". Every item is proof-backed.

### P0 — A vim user will hit these in the first hour

| # | Gap | Proof |
|---|---|---|
| 1 | **No `f/F/t/T` char-search motions** — the most-used vim motions after `w/b` | `grep "key === 'f'\|findChar" src/editor.ts` → only unrelated hit at :1169. Absent in web too. |
| 2 | **No `*`/`#` (word-under-cursor search) or `%` (bracket match)** | same grep family → NONE in `src/editor.ts`, NONE in `public/index.html` |
| 3 | **No find-in-files UI** despite working backend | endpoint `src/server.ts:1034`; `grep "api/search" public/index.html` → NONE |
| 4 | **No multi-cursor / multi-selection** | `grep "multicursor\|multi-cursor" src/ public/` → NONE |
| 5 | **No auto-closing brackets/quotes** | `grep "autoClose\|pairOpen" src/ public/` → NONE (completion adds `bracket` suffixes only — `src/complete.ts:116`) |
| 6 | **No code folding** | `grep "fold" src/editor.ts public/index.html` → NONE (only `folder` tree nodes) |
| 7 | **No LSP diagnostics** — no squiggles, no Problems panel, no `publishDiagnostics` subscription | `src/server.ts:279` requests only `completion/hover/definition` capabilities; grep `diagnostic` → NONE anywhere |
| 8 | **LSP missing rename, format, find-references, document-symbols, signature-help** | `src/server.ts:311` — only 3 methods exist: `completion`, `hover`, `definition` |
| 9 | **No git UI beyond read-only status/diff** — cannot commit, pull, init, switch branch, or view log from either UI | endpoints exist (`src/server.ts:1124-1155`) but `grep "api/git/commit\|pull\|init" public/index.html` → NONE; branch `<select>` (`index.html:793`) is repo *settings*, not workspace checkout; `grep "git" src/editor.ts` → only skip-lists, **TUI has zero git** |
| 10 | **Ex-command gaps vs vim**: no ranges (`:10,20d`), no `:g/pattern/cmd`, no `:normal`, no `:sort` | command dispatch has no range parser (no `[,-]` handling found in dispatch paths); USAGE.md command tables list none |
| 11 | **No system-clipboard integration** (yank/paste are internal registers only) | no `clipboard`/`OSC 52`/`pbcopy` references in `src/editor.ts` |

### P1 — Blocks "complete product" status

| # | Gap | Proof |
|---|---|---|
| 12 | **No rendered Markdown/HTML preview** — `#preview` handles only images/binary | `showPreview(p,isImg,size)` `public/index.html:1620`; no `renderMd`/`mdToHtml` → NONE |
| 13 | **No editor preferences**: no word-wrap toggle, no tab-size/expandtab setting, no ruler, no line-number toggle | `grep "tabSize\|expandtab\|wordWrap" public/index.html` → NONE; settings are only theme/font-size/max-tabs/term-height (`index.html:2338`) |
| 14 | **No session restore in web** — reopen browser, tabs are gone (TUI has `session.json` via `src/utils.ts:184`, web has no equivalent call) | no `session` usage in `public/index.html` |
| 15 | **No keybinding customization**; web and TUI keymaps are hard-coded and partially divergent (`Tab` = indent in web, jump in TUI — documented `USAGE.md:275` but still a coherence bug) | dispatch tables inline in both files |
| 16 | **Undo is linear, not vim's undo tree** (`g-`/`g+`, branches after redo) | capped stacks only — `src/editor.ts:194` comment states linear stacks |
| 17 | **No dot-repeat for visual ops** — self-documented gap | `USAGE.md:275`: "Visual ops and completion ghosts are not dot-recorded" |
| 18 | **No CI, no linter, no formatter config, no `.editorconfig`** | `ls -a \| grep -iE "github\|eslint\|prettier\|editorconfig"` → **NONE** |
| 19 | **This repo is not a git repository** (!) | `git rev-parse` → not a git repo. For a GitHub-connected editor this is both a risk (no history/recovery) and a GTM blocker (no public repo to star/clone) |
| 20 | **`package.json` unpublishable-quality**: no `repository`, `homepage`, `bugs` fields; `engines >=18` but SUMMARY.md/CHANGELOG.md claim v14+ | grep → NONE; `package.json:30` vs `SUMMARY.md:119` |

### P2 — Differentiation & scale (the "why not Neovim/Helix/VS Code" answers)

| # | Gap | Notes |
|---|---|---|
| 21 | **No extension/plugin system** | listed as "Future Plans" `SUMMARY.md:170` — the single biggest lock-in risk against VS Code |
| 22 | **No debugger (DAP)** | no `debug\|breakpoint` hits in `src/` (grep verified) |
| 23 | **No test runner panel** | `:run` runs one file only (`src/winsh.ts:67` runner map) |
| 24 | **No remote/SSH story packaging** | The web IDE *is* a remote editor (server in cwd, browser anywhere) but: binds `127.0.0.1` default, no TLS, no tunnel helper (`--tunnel`), so the killer feature is undiscoverable and unsafe-by-default is instead *safe-by-default* |
| 25 | **No collaboration/live-share**, no devcontainers | honest: heavy, defer |
| 26 | **Single-file frontend at 2,738 lines** with mixed concerns | maintainability cliff before any plugin system |
| 27 | **Docs are stale/misleading** (see §3.1) | the cheapest fix with highest trust ROI |

---

## PART 3 — DOC & TRUST DEBT (fix before any GTM spend)

### 3.1 Claims vs. reality (all verified)
| Doc says | Reality | Proof |
|---|---|---|
| "Zero runtime dependencies" (`SUMMARY.md:66`, `CHANGELOG.md:73`) | 4 deps: `node-pty ws xterm xterm-addon-fit` | `package.json:40-45` |
| "~50KB total code, <100ms startup, ~10MB RAM" (`SUMMARY.md:70-72`) | source alone is ~6.8k TS + 2.7k HTML; **no benchmark exists in repo** | `wc -l src/*` |
| "93 tests" (`README.md:20`) | 133 (97 JS + 36 TS) | baseline run 2026-09-22 |
| CHANGELOG latest = 1.0.0 (2024-01-01) | version 1.3.0 | `package.json:3` |
| SUMMARY structure lists `example.ts/js/py/html/css` | files don't exist; real files (`server.ts`, `structures.ts`, `winsh.ts`, `complete.ts`, `collect.ts`, `themes.ts`) unlisted | directory listing |
| "Future Plans" lists explorer/tabs/themes/autocomplete/splits (`SUMMARY.md:167-176`) | **all shipped** | README feature tables |
| Node "v14+" (`SUMMARY.md:119`) | requires v18+ (`fetch`, test runner) | `package.json:31` |
| Empty `## Support` heading followed by login content; `yourusername` placeholder links | broken docs structure | `USAGE.md:337-373` |

**Honest framing:** the product is *ahead* of its own documentation in features and *behind* it in accuracy. That's a good GTM problem to have — but a stranger landing on the repo today would under-estimate the product and over-trust wrong numbers.

---

## PART 4 — GTM PRODUCT SHEET

### 4.1 Positioning statement
> **TypeWriter: the vim-native code editor that lives where you work — terminal or browser — with zero Electron, zero telemetry, and your AI agent built in.**
> One engine, two surfaces: a PowerShell-safe TUI for the box you're SSH'd into, and a browser IDE for the same directory — no port-forward ceremony, no extension marketplace lottery.

### 4.2 Target customer (in order of fit)
1. **PowerShell/Windows shop devs & DevOps** — underserved: every serious editor is POSIX-first; TypeWriter ships `winsh.ts` (quoting, `taskkill` tree-kill, PS runners), `.ps1`/`.bat` wrappers, and PS-aware terminal aliases (`public/index.html:2221`)
2. **Server/homelab operators** — run `typewriter --serve` on the machine with the files; edit from any browser on the LAN (feature exists today, see §P2-24)
3. **Vim muscle-memory developers who also need a GUI** for demos/pairing — same key grammar in both surfaces
4. **Privacy/lean-tooling people** — no telemetry (verified: no analytics/trackers in `public/index.html`), no account, MIT

### 4.3 VS Code pain points → TypeWriter answers (honest scorecard)
| VS Code pain (widely reported) | TypeWriter answer | Credibility today |
|---|---|---|
| Electron RAM hog (hundreds of MB idle) | Node TUI ~tens of MB; browser client uses the browser you already have | ⚠️ **must benchmark & publish numbers** (current claims unproven, §3.1) |
| Slow cold start | no extension host to wait on; `npm start` is immediate | ⚠️ same — measure |
| Extension supply-chain & 10k-extension choice paralysis | curated: LSP by language, runners, agents as *subprocess tabs* not in-process extensions | ✅ working (`src/server.ts:62-81`) |
| Settings/keybinding JSON sprawl, 2 UIs for everything | small preference set, vim commands as the config language | ✅ by omission — but see gap #13 |
| Remote-SSH/WSL complexity for "edit files on a server" | `--serve` + browser = the remote story, token-gated | ⚠️ feature exists, **undiscoverable + no TLS/tunnel** (gap #24) |
| AI tooling locked to one vendor | BYO agent: Claude Code, OpenCode, Codex as first-class tabs | ✅ shipping |
| Telemetry/updates intrusiveness | zero telemetry, no auto-updater | ✅ verified |
| Not really vim (vscodevim is emulation, input-lag quirks) | vim grammar is the *primary* input model in both surfaces | ✅ core of `editor.ts` — but P0 motion gaps (#1,2,10) |

### 4.4 Competitive line (one-liners for the site)
- **vs VS Code:** "Editors shouldn't need 1GB to open a 4KB file."
- **vs Neovim/Helix:** "Your vim grammar, no config distro, plus a browser IDE and AI agents for free."
- **vs code-server:** "Not VS Code in a tab — a purpose-built terminal-native editor with a 6.8k-line engine."
- **vs Zed:** "Collaboration-less, Windows/PowerShell-first, works over plain HTTP on your LAN."

### 4.5 Roadmap to "complete" (sequenced by dependency)
**Sprint A — Close the P0 vim gaps (weeks 1-2)**
`f/F/t/T`, `*`/`#`, `%`, ranges + `:g` + `:sort`, system clipboard (OSC 52 for TUI), dot-repeat for visual ops. *All in `editor.ts` + mirror in web keymap — one shared grammar doc to stop TUI/web divergence.*

**Sprint B — Turn on what already exists (week 2, cheapest ROI in the product)**
Wire `POST /api/search` → `Ctrl+Shift+F` project-search UI with results panel; wire `git commit/pull/init` → Source Control sidebar (VS Code's most-used panel); add `:git` family to TUI. **Zero new backend.**

**Sprint C — LSP depth (weeks 3-4)**
Subscribe `publishDiagnostics` → squiggles + Problems panel (kills gap #7); add `textDocument/rename`, `formatting`, `references`, `documentSymbol` to the bridge (`src/server.ts:311` pattern already generalizes).

**Sprint D — Product hygiene (parallel, week 1)**
`git init` + first commit; CI (build + 133 tests on push); `npm pkg` metadata (`repository/homepage/bugs`); rewrite SUMMARY.md/CHANGELOG to reality; benchmark script → replace every unproven number in docs with measured output.

**Sprint E — Editor completeness (weeks 5-6)**
Auto-pairs, multi-cursor (web first, TUI harder — `Ctrl+V` block mode as interim), folding (indent-based for PS/py/js), tab-size/wrap/number settings, web session restore, rendered Markdown preview (panels API: raw already served by `/api/raw`).

**Sprint F — Remote packaging (weeks 7-8)**
`typewriter --serve --tunnel` (HTTPS via self-signed or `cloudflared`/`ngrok` exec-if-present), `--tunnel` docs, one-line install for Windows (`winget`/`scoop` formula) — this converts the buried killer feature into the headline.

**Before v1.4 GA (weeks 9-10)**
Extension feasibility spike (injectable command registry + JS sandbox vs. "contrib" folder with copyable functions — decide with data, don't promise marketplace parity).

### 4.6 Distribution & channels
1. **npm** (`npx typewriter-editor`) + **winget/scoop/choco** (Windows-first positioning demands it) + homebrew
2. **GitHub repo public + demo GIF** of dual TUI/web + agent tabs (the three things nobody else has together)
3. Content GTM aimed at real search intent: *"edit files on server without vscode remote"*, *"vim in browser"*, *"powershell code editor"*, *"edit via browser no install server"*
4. Show HN / r/commandline / PowerShell Discord — lead with benchmarks (only after Sprint D measures them)
5. Free core (MIT) forever; if monetization desired later: support contracts/managed tunnel — **not** paywalling editing

### 4.7 Metrics that matter
- Activation: `npx` → file saved in <60s; `--serve` → browser edit in <2 min
- Retention proxy: weekly commits pushed via TypeWriter (feature exists: `/api/github/push`)
- Trust: docs-vs-reality discrepancy count = **0** (audit §3.1 quarterly)
- Quality: test count trending up, CI green rate, time-to-fix for P0 editor bugs

### 4.8 Honest top risks
1. **Not a git repo, no public repo yet** (gap #19) — everything else is theater until history + public presence exist
2. **Docs lie by staleness** (§3.1) — kills first impressions faster than missing features
3. **Performance claims unmeasured** — the anti-Electron pitch requires numbers; publish or stop claiming
4. **Single-maintainer breadth** (TUI + web + server + LSP + GitHub + agents) — sequence ruthlessly: Sprint B (ship orphaned endpoints) beats any new feature
5. **Extension gap vs VS Code** — answer with narrow, honest scope (LSP + agents + runners cover 90% of what people install extensions for) rather than marketplace parity promises
6. **Web keymap divergence** (Tab behavior) — documented but erodes the "one grammar" promise; unify before marketing "vim everywhere"

---

*Produced by code review session `ses_f37169c9bffeHyAojj5pEXs3mL`. Bug-fix sub-reviews running in parallel will update line numbers; claims here were verified against the pre-fix snapshot.*
