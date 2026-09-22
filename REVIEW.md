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

*(Further agent reports appended below as they land.)*
