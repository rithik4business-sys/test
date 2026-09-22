# TypeWriter — Code Review Ledger

Every fix: file:line, proof, improvement. Compiled from background review agents; verification status tracked. Baseline: **133/133 tests green** (97 JS + 36 TS) captured before any edits. Git snapshot: `b5059fd`.

Status legend: ✅ agent-verified (runtime repro cited) · 🔍 pending my verification pass · 🏗️ built (feature work, not bug review)

---

## Review 1/6 — `src/utils.ts`, `src/structures.ts`, `src/complete.ts`, `src/highlight.ts` ✅

Agent verified every claim by executing the failing pattern in isolation before fixing.

### Fixes applied
| # | Sev | Where | Bug | Proof | Fix | Improvement |
|---|-----|-------|-----|-------|-----|-------------|
| 1 | HIGH | `highlight.ts:129` | `^` + sticky `y` flag: CSS property regex only matched at column 0 — every property after index 0 emitted as `text` | exec'd: `lastIndex=2` → `null` with `^`, match without; `highlightLine('  gap: 10px;','css')` miscolored; MDN `y`/`^` semantics | removed `^` (sticky alone anchors) | CSS/SCSS/LESS property highlighting works at any indentation |
| 2 | HIGH | `highlight.ts:96` | `LANG_KW_SETS[language]` walked `Object.prototype` → language `'constructor'` resolved to a function → `kwSet.has` TypeError crash | `typeof ({}).constructor === 'function'`; violates test contract "unknown language never crashes" (`test/highlight.test.js:44`) | null-prototype map (`Object.create(null)`) | eliminates whole prototype-key crash class |
| 3 | HIGH | `utils.ts:314` | `EXT_MAP[ext]` same prototype leak: file `report.constructor` → returns `Object` (a function) as language, violating `: string`; corrupts `buf.lang` downstream (`editor.ts:298,1277`) | `typeof EXT_MAP['constructor'] === 'function'` | own-property check via `hasOwnProperty.call` | return type honored for all inputs; all 22 tested exts byte-identical |
| 4 | MED | `complete.ts:40→48` | >200-char prefix truncated, then used as both match key and slice length → ghost suggestion duplicated chars | prefix `'a'×250`, line `'a'×201+'!'` → returned `"a!"` though line doesn't start with full prefix (contract `complete.ts:47`) | removed unsound truncation | correct completions on long/minified lines |
| 5 | MED | `complete.ts:106-139` | ngram pair matched substrings: `foo bar` suggested from line `myfoobar bar()` — violated own "word pair" contract | ran old logic: `ia=2` inside `myfoobar` → false `' bar()'` ghost | `indexOfWord` with word-boundary checks both sides | no more mid-word ghost suggestions; traced existing test still passes; loop provably advances |
| 6 | MED | `complete.ts` (5 sites) | ~5-10 RegExp literal allocations per keystroke in hot path (+1 per scanned line) — pure GC churn | ECMA-262: each literal eval creates new RegExp; call path `editor.ts:409` per edit | hoisted `RE_WORD` etc. to module constants | zero RegExp allocation per keystroke; matches `highlight.ts` convention |
| 7 | MED | `structures.ts:208` | `CappedBuffer(NaN/Infinity)` → eviction guard always false → unbounded growth, violating "never holds more than maxBytes" contract | ran: NaN budget, 1000 pushes → 10000 bytes, no trim; siblings already validate | validate finite ≥1 at construction (throws) | memory contract holds for all inputs; fails fast |

### Open questions (deliberately NOT changed — agent lacked certainty)
1. **`utils.ts:346 safePath` symlink escape** — `path.resolve` doesn't follow symlinks; link inside base pointing out passes validation. Needs `fs.realpath` on parent (ENOENT semantics for new files = intent unclear). ⚠️ security-relevant — **queued for my pass**.
2. `complete.ts` suggestions can come from lines *below* caret (API carries no caret-line index) — needs API change.
3. `highlight.ts` no multi-line state: `/* */` block comments colorize as code; `#` for dockerfile/graphql ungated — design change needed.
4. `structures.ts` single chunk > maxBytes dropped entirely (`toString()` → `''`) vs. keeping newest bytes — intent uncertain.
5. `slice(0,100)` can split surrogate pair in ghost text (edge-cosmetic; must keep `length<=100` test).
6. `getVersion` caches `'0.0.0'` forever on first transient FS error — appears intentional.
7. `SNIPPETS['constructor']` prototype read — verified benign (resolves `''→null`, no crash).
8. `punctuation`/`type` token types declared but never produced — dead palette entries, cosmetic.
9. `scheduleSessionSave`: explicit `patch.lastFile === undefined` drops field on write — no caller does this today.

### Verified clean (attested line-by-line)
RingBuffer O(1) wrap math & test re-derivation · LinkedStack eviction/takeLast order · CappedBuffer byte accounting + 2× compaction bound · `tokenizeLine` index math (round-trip `stripAnsi(out)===line` holds; all branches advance exactly) · `scanNumber` hex/binary/octal boundaries · `stripAnsi` regexes (no catastrophic backtracking, disjoint classes) · full EXT_MAP × 22-case test matrix · no unbounded caches in all 4 files · empty-input safety of all completion paths.

---

---

## Review 2/6 — `src/github.ts`, `src/collect.ts` ✅

Agent verified empirical claims via standalone `node -e` snippets; post-edit re-read + grep for dangling refs + confirmed no test mocks `https.request`.

### Fixes applied
| # | Sev | Where | Bug | Proof | Fix | Improvement |
|---|-----|-------|-----|-------|-----|-------------|
| 1 | HIGH | `github.ts:220-227` | `authenticate()` **wiped the stored token on ANY validation failure** — offline timeout, 5xx exhaustion, or 403 rate-limit all destroyed `~/.typewriter/token` | contract `GITHUB-LOGIN-PLAN.md:19,27` = only **401** kills session; server path already did this correctly (`server.ts:446`), CLI didn't; offline `--login` = permanent logout from a transient hiccup | rethrow everything except `GitHubError.statusCode===401` | saved credentials survive network failures; real error surfaces |
| 2 | MED | `github.ts:139-144, 425-431` | Response bodies decoded **per TCP chunk** → multi-byte UTF-8 split across chunks → U+FFFD corruption | empirically: split `Buffer.from('é')` halves concatenated via `+=` → `"��"`; `GET /user/repos` easily exceeds 16KB highWaterMark → non-ASCII repo names/descriptions mangled | accumulate `Buffer[]`, decode once on `'end'` | byte-exact responses incl. emoji/accents |
| 3 | MED | `github.ts:158-162` | GitHub **secondary rate limit (403 + `Retry-After`)** never retried — code parsed the header then discarded it for the 403 form | GitHub REST docs: secondary limit answers "403 **or** 429", "make use of `retry-after`" | retry on `403 && retry-after` (existing bounded backoff reused) | transient limit blips self-heal; permission 403s (no header) stay terminal |
| 4 | HIGH | `github.ts:572-598, 645` | Push targeted only `main`/`master` — repo with default `develop`: `getBranch`→null→misread as *empty repo* on a non-empty repo → bogus seed PUT with wrong branch; or push lands on `main` while default branch never updates | GitHub docs: `default_branch` is canonical; both failure paths traced | resolve repo first, probe `default_branch` then fall back; segment-encode ref paths (pattern already used at :659) | pushes land on the real default branch for any branch name; +1 cheap `GET /repos`/push (stated honestly) |
| 5 | HIGH | `collect.ts:116-126` | Size gate ran **after** `readFileSync` — 300MB file fully allocated, *then* discarded | empirically: 300MB read = 203ms + 300MB heap before check; Node docs: reads "entire contents"; no ext filter catches `.mp4` | `statSync().size` gate **before** read; post-read check kept as TOCTOU defense | push memory bounded ≤900KB/file; one cheap stat for giants |
| 6 | MED | `collect.ts:104-108` | Non-regular files (FIFOs) read → `readFileSync` on writer-less FIFO **blocks forever = whole editor freezes** | empirically: blocked past 2s timeout (POSIX `open(O_RDONLY)` semantics); git only tracks regular files | `if (!entry.isFile()) continue` | walk can't hang on FIFO/socket/device; matches git semantics |
| 7 | MED | `collect.ts:10,26-53` | Root-anchored `.gitignore` patterns (`/dist/`) matched at **every depth**; anchored dir rules ignored `dirOnly` → **silent partial pushes** (git-tracked files under nested `dist/` never reached GitHub, push reported success) | gitignore(5): leading `/` = relative to `.gitignore` dir; failing scenario `packages/app/dist/bundle.js` traced | `anchored` flag on `GitRule`; root-only matching honors `dirOnly`; root `/*.log` glob case added | push contents now match git both directions |

### Open questions (not changed — uncertainty or non-surgical)
1. Unencoded `owner`/`repo` in 5 URL paths — **proved unreachable** (both callers validate to `[A-Za-z0-9._-]`), defense-in-depth only → correctly left
2. `**` gitignore patterns **dropped entirely** → under-ignore (secrets under `**/secrets/` WOULD push) — needs real glob engine ⚠️ **flagged for product backlog**
3. Nested `.gitignore` files not honored (root only) — feature change
4. `.gitignore` truncated at 500 lines → silent under-ignore
5. Empty-repo seed hardcodes `branch:'main'` — offline-verifiable behavior unknown, pre-existing, untouched
6. `listBranches` first 100 only (no Link pagination) — contract silent
7. Primary-rate-limit 403 (no `Retry-After`) fails fast — honoring `reset` could block UI up to 1h; fail-fast kept
8. 2xx + unparseable body → `{}` theoretically reaches `.map` — unreachable behind TLS GitHub JSON
9. `expires_in` not passed to poll loop — self-correcting via GitHub's `expired_token`
10. Redirects not followed → 301 surfaces as opaque error — contract silent

### Verified clean (attested)
Token appears **only** in `Authorization` header — never path/query/logs/errors (device-flow prints only `user_code`/`verification_uri`, non-secret per OAuth spec) · auth header on all 14 authenticated call sites, device endpoints correctly unauthenticated · 15s socket timeout + `req.destroy()` on both request paths, poll loop deadline-bounded — **no request can hang** · 3-attempt backoff with `Retry-After` ≤60s · every JSON parse guarded · zero `child_process` in both files (**no shell surface**), no disk writes (**no traversal write surface**) · no module-level caches; push bounded ≤500 files/≤5MB/depth≤1; walker bounded depth≤12 · `settled` guards per-call; ref update without `force` → concurrent push fails loudly (422) instead of clobbering · every promise awaited by its single caller — no fire-and-forget.

---

---

## Review 3/6 — `src/index.ts`, `src/themes.ts`, `src/winsh.ts` ✅

Agent verified via standalone `node -e` repros + fetched upstream `sst/opencode` theme source for provenance; post-edit re-read only.

### Fixes applied
| # | Sev | Where | Bug | Proof | Fix | Improvement |
|---|-----|-------|-----|-------|-----|-------------|
| 1 | HIGH | `index.ts:11-37` | `ask()` promise **never settles on stdin EOF** → `typewriter --push < /dev/null` exited 0 *silently* (fake success) instead of aborting 130; SIGINT listener leaked | ran repro: `< /dev/null` → `settled=false` after close; Node readline docs: question callback only fires on input | `done` latch + `rl.on('close')` reject; all 3 paths single-settle | prompts abort cleanly (exit 130), no listener leak |
| 2 | MED | `index.ts:164-177` | Unknown flags **silently ignored**: `--poert=8080` opened empty editor, exit 0 | traced fall-through → `startEditor(undefined)`; `test/tui.test.js:22` passes only plain filename (zero test impact) | known-option allow-list after `--help`/`--version` short-circuits → `Unknown option` + exit 1 | typos fail fast with actionable message |
| 3 | MED | `index.ts:172-177` | `--port`/`--host` without `--serve` silently discarded (help says "with --serve") | traced: no branch reads them → editor opens, exit 0 | require `--serve` else error + exit 1 | every documented flag form now diagnosable |
| 4 | MED | `index.ts:203-210` | `--port=abc` → **silent 3000 fallback**; `--port=99999` → raw `RangeError` stack | ran: `parseInt('99999')` finite, range never checked; Node `ERR_SOCKET_BAD_PORT` docs | `Number.isInteger && 0-65535` else one-line error + exit 1; NaN fallback removed | `startServer` only ever gets a legal port |
| 5 | LOW | `index.ts:225-230` | `process.exit(1)` can truncate piped output (inconsistent with file's own `exitCode` pattern) | Node docs: `process.exit` may exit before stdout flushes; sibling paths already safe | `process.exitCode=1; return` | full diagnostics guaranteed on pipes |
| 6 | LOW | `index.ts:226` | `--theme --serve` reported "Unknown theme: --serve" instead of "Missing value" | ternary chose on `name?` truthiness; dash-value is truthy | condition `name && !name.startsWith('-')` | correct diagnosis |
| 7 | HIGH | `themes.ts:34` | **`lucent-orng` theme unreadable: 1.16:1 contrast** — light backgrounds half-swapped into an all-dark palette (white bg + `#eeeeee` text); primary button 3.44:1 | executed WCAG luminance math; fetched upstream `sst/opencode` `lucent-orng.json` — dark defs match the entry's foregrounds exactly, light defs never applied | restored dark `bg/panel/element` (**17.06:1**) + `primaryText #0a0a0a` (**5.75:1** AA) | theme readable + provenance-consistent; no test asserts these colors |

### Open questions (not changed)
1. ⚠️ **`public/index.html:607` mirrors the same broken `lucent-orng`** — out of scope for this agent → **my queue after agent 6 lands**
2. Flag-precedence: `--login --logout` resolves by fixed order silently (no test, designed behavior)
3. Multiple positionals: `a.ts b.ts` opens only `a.ts` — intent unclear
4. ⚠️ **`server.ts:1568-1574`** standalone `--port` parse duplicates the same missing range check → **my queue after agent 1 lands**
5. `--theme=a=b` recombination verified harmless · 6. Banner `padEnd(30)` cosmetic overflow if version >30 chars

### Verified clean (attested)
**`winsh.ts` entire file** matches both contract tests: POSIX escaping of all 4 metacharacters `\ " $ \``, PowerShell `''` doubling (per `about_Quoting_Rules`), `psCommandArgs` order, runner/taskkill maps, `isWindows`='win32' only, pure functions · `ask()` answer path can't double-settle · unknown-option guard provably touches zero test surfaces · `THEME_NAMES` all own-keys (no prototype-leak class from Review 1) · post-fix: every `index.ts` error path uses `exitCode`+`return`, sole `process.exit(1)` is the correct top-level catch.

---

---

## Review 4/6 — `src/server.ts` ✅ (recovered — report never delivered, agent killed mid-run)

**Recovery method:** the agent applied its edits (12:04) but was interrupted before writing its report. Recovered by diffing the session-start baseline compile (`/tmp/dist-orig-baseline/server.js`, preserved from the pre-edit build) against a fresh build of the current source. Proofs are embedded in the agent's own code comments; **verification level = full test suite green (97/97 + 36/36)** — tests directly exercise routes touched by #5, #8, #10, #12; LSP (#4), throttle (#6/#7), and git-status (#13) fixes are code-traced but not covered by tests (noted honestly).

### Fixes applied
| # | Sev | Where | Bug | Proof | Fix | Improvement |
|---|-----|-------|-----|-------|-----|-------------|
| 1 | HIGH | `findAgentBin` | `AGENTS[id]` prototype-chain read: id `'constructor'` → truthy function → `spec.extraPaths` TypeError thrown from exported fn | same bug class proven in Review 1; comment traces exact throw site | own-property guard | prototype ids return null instead of crashing |
| 2 | MED | `agentStatus()` | **6 blocking `spawnSync` probes (5s/10s timeouts) inside HTTP handler on every request** | comment documents probe count + timeouts | 5s TTL memo cache | polling UI pays blocking scan at most once/window |
| 3 | MED | `startInstall` | id `'constructor'` → 500 (TypeError) instead of intended 400 | traced: `!spec` passed for truthy function, crash later in findAgentBin | own-property guard | correct 400 'unknown agent' |
| 4 | HIGH | `lspAccept` stdout parser | **LSP framing ran on a decoded string**: `Content-Length` is BYTES (UTF-16 `.length` under-counts → mis-frames any non-ASCII message); `String(chunk)` corrupts split multi-byte chars; regex `Content-Length...\r\n\r\n` never matched when `Content-Type` header followed → parser stalled until 1MB trim | LSP base-protocol spec (byte count, optional second header); comment traces all three failure modes | `Buffer` accumulation, header-block scan via `\r\n\r\n` + ASCII header parse, junk-block skip, UTF-8 decode of slice | protocol-correct framing; no more stalls/corruption |
| 5 | MED | `readBody` overflow | `req.destroy()` before 413 response → client saw connection reset, never the 413 | comment: respond-after-destroy delivers nothing | don't destroy; `done` guard ignores rest | clients actually receive 413 |
| 6 | HIGH | `throttle()` | **X-Forwarded-For trusted from any peer** → client-settable header keyed the rate bucket → unlimited distinct buckets = rate-limit bypass | XFF is client-settable on direct connections; `ip` keys bucket below | trust XFF only when direct peer is loopback | rate limits hold against forged headers |
| 7 | MED | `rateBuckets` >5000 | blanket `clear()` **reset every client's live window** → all clients could exceed `perMinute` for rest of hour | comment traces: clear drops live `hits` arrays | prune expired windows first; clear only as last-resort bound | rate limiting survives memory pressure |
| 8 | MED | `parseJsonBody` | unreadable body (oversize/abort) rejection → outer catch → **500 instead of 400** | traced rejection path | try/catch → `null` → caller's 400 | correct client-error status |
| 9 | HIGH | `idePage()` | **cwd-first resolution served the opened project's own `public/index.html` as the editor UI** — a planted page runs at the editor's origin | `process.cwd()` is the user's opened project; comment states attack | bundled `__dirname`-relative page first, cwd as fallback | arbitrary projects can't inject the editor shell |
| 10 | HIGH | `/api/raw` + `/icons` | project bytes served without sandbox: **SVG opened directly executes script at editor origin** (could read `localStorage 'tw-token'`, call API); also `ext='constructor'` → MIME_MAP prototype fn → `ERR_HTTP_INVALID_HEADER_VALUE` 500 | comment: CSP not applied to `<img>`, but raw navigation executes; MIME bug = Review-1 class | `Content-Security-Policy: sandbox` on both routes + own-property MIME lookup | script-bearing files can't run at origin; `.constructor` filenames serve (octet-stream) |
| 11 | MED | `/api/exec` | **`activeExecs` slot leaked** on 400/403 early exits → concurrent-exec capacity permanently shrank until restart | each early return skipped the decrement | `activeExecs--` on every exit path | exec slots can't leak |
| 12 | LOW | `/api/rename` | missing source → `renameSync` ENOENT → 500 | delete route already answered 404 for same case | `lstatSync` precheck → 404 | consistent with delete |
| 13 | MED | `/api/git/status` | **branch/ahead/behind always empty/0**: regex required `^## ` but ran against `ln.slice(3)` — the already-stripped prefix → never matched | comment traces double error; branch names with dots also broke pattern | split on `...` upstream marker + separate `[ahead N]` probe; `HEAD` detection for detached | push review shows real branch/divergence |
| 14 | HIGH | device poll | `device_code` unbounded (readBody allows 5MB) → **200 oversized codes pin ~1GB** as map keys | 200 × 5MB arithmetic in comment; real codes ~40 chars | reject `dc.length > 256` → 400 | memory-pinning DoS closed |
| 15 | HIGH | standalone `--host=` | empty value → `listen(port,'')` binds **`::` all interfaces**, skipping the loopback warning | Node `listen` semantics; comment traces silent skip | `\|\| '127.0.0.1'` fallback chain | never silently public |

### Open questions
1. ⚠️ **Still open from Review 3:** standalone port parse (`server.ts` argv block) lacks 0-65535 range check — this agent fixed the `--host=` half but not `--port=`. **My queue.**
2. Not test-covered: LSP framing, throttle trust rules, git-status parsing — recommend targeted tests in a later pass.

### Verified clean
Route dispatch chain, auth gating on `/api/*`, `safePath` traversal checks exercised by `test/api.test.js` (8 live-server tests incl. auth + traversal + binary) — all green post-change.

---

## Review status after subagent shutdown (user-ordered)

| Review | Scope | State |
|---|---|---|
| 1/6 utils+structures+complete+highlight | 7 fixes | ✅ delivered + merged |
| 2/6 github+collect | 7 fixes | ✅ delivered + merged |
| 3/6 index+themes+winsh | 7 fixes | ✅ delivered + merged |
| 4/6 server.ts | 15 fixes | ✅ recovered from baseline-diff, merged (this entry) |
| 5/6 editor.ts | — | ❌ agent killed mid-run; **file never touched** (mtime unchanged, zero diff) — review still owed |
| 6/6 public/index.html | partial | ⚠️ agent killed; applied 2 correct fixes before death (`lucent-orng` contrast mirror, literal `\u2014` → em-dash) — remainder of review still owed |

*(Further entries appended as remaining reviews are completed.)*
