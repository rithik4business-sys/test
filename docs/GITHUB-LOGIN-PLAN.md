# GitHub Login — Premium Production Plan

Goal: turn Settings → Account into a login experience that feels like Linear/Vercule-tier
craft, not a settings form. Ship in 3 phases; every phase is independently releasable
and covered by the existing `node:test` suite patterns (served-HTML assertions + endpoint
status codes, no network in tests).

Design currency: restraint. No gradients, no emojis in chrome, no greeting walls,
no fake data. System stack, sentence case, 6px radii, 120ms motion (tokens already exist).

---

## 1. State machine (the whole feature in one diagram)

```
LOGGED_OUT ──Login──▶ CONNECTING ──approved──▶ LOGGED_IN ──select──▶ REPO_ACTIVE
    ▲                     │  (device poll,    │ (profile + repos,       │ (push enabled,
    │                     │   cancel/timeout) │  create unlocked)       │  header context)
    └────── logout / token-expired (401) ─────┴────────────────────────┘
```

Rules:
- `REPOSITORIES` and `REPO SETTINGS` sections render **only** in `LOGGED_IN` / `REPO_ACTIVE`.
- `LOGGED_OUT` shows exactly one card: the login card. Nothing dead, nothing greyed-out.
- Push header button behavior per state: `LOGGED_OUT` → opens Account + "Log in to push";
  `LOGGED_IN` (no repo) → opens Account + "Select a repository to push to"; `REPO_ACTIVE` → pushes.
- Any API 401 on an authenticated call → transition to `LOGGED_OUT`, toast "Session expired —
  please log in again", clear stored token. Never leave the UI in a half-authed state.

## 2. Information architecture (Account tab, top to bottom)

### LOGGED_OUT — one card
- Title: "GitHub" / sub: "Push your workspace, manage repositories."
- Primary button: **"Login with GitHub"** (full width). Wording decision: user-facing
  copy standardizes on **Login / Logout** across the app (button, toasts, docs).
- Secondary collapsed link: "Use a personal access token instead" → expands PAT input.
  PAT path validates via `GET /user` before storing; rejects tokens without `repo` scope
  with "This token can't push — grant it the `repo` scope and try again."
- Device flow (after click): replace card body with code-first layout —
  8-char code in large mono (`letter-spacing: 4px`), Copy button, "Open github.com/login/device"
  link, live "Waiting for approval…" with elapsed timer, Cancel. Poll with backoff
  (5s → 10s), hard stop at GitHub's 15-min code expiry with "Code expired — start over."

### LOGGED_IN — profile header + repos
- Profile header card: 34px avatar **image** (no "?" placeholder; skeleton shimmer while
  loading), display name bold + `@handle` muted on one line, right-aligned icon-only
  **Logout** button (door icon, `title="Logout"`, confirm inline: turns into "Confirm?"
  for 4s — no modal for a reversible action).
- REPOSITORIES card: search filter, list rows (name bold, private/public pill,
  updated-relative time, click = select with check state), Refresh icon-button.
  Empty: "No repositories yet — create your first below." (only after successful fetch;
  fetch failure gets "Couldn't load repositories — Retry".)
- Create row appears **only here**: name + description + Private toggle + Create.
  Success → selects the new repo, toast "Created `<name>`", list refreshes.
- REPO SETTINGS card appears **only in REPO_ACTIVE**: repo name context in header,
  description/homepage/topics editors, danger-free Save settings, Push row with message
  input + Push workspace + "open on GitHub ↗".

## 3. Copy deck (final strings — no placeholders, no exclamations)

| Surface | String |
|---|---|
| Header button tooltip | `Push workspace to GitHub` |
| Login button | `Login with GitHub` |
| Logout | icon-only, `title="Logout"`, confirm `Confirm?` |
| Need login | `Log in to push` |
| Need repo | `Select a repository to push to` |
| Pushed | `Pushed to <branch>` |
| Session dead | `Session expired — please log in again` |
| Scope error | `This token can't push — grant it the \`repo\` scope and try again` |
| Code expired | `Code expired — start over` |
| No repos | `No repositories yet — create your first below` |
| Load fail | `Couldn't load repositories — Retry` |

## 4. Visual spec (tokens only, zero new colors)

- Cards: `var(--panel)` bg, `var(--border-subtle)` 1px, 6px radius, 16–20px padding.
- Avatar: 34px circle, 2px ring in `var(--green)` when connected.
- Pills (Private/Public): 10.5px, uppercase, letter-spacing 1px, muted border — no fills.
- Code block: `var(--mono)`, 20px, `letter-spacing: 4px`, `var(--bg)` well.
- Motion: existing `--dur-fast`/`--ease-out` only. Skeleton: existing `.skel` shimmer.
- Focus: visible `:focus-visible` outline in `var(--border-active)` on every control.
- Density: 12.5–13px body, section titles 11px caps `letter-spacing: 1.5px` (matches EXPLORER).

## 5. No-AI-fingerprints checklist (review gate before merge)

- [ ] Zero emojis in chrome/copy (✓/✗ glyphs only where they already exist in-app)
- [ ] Zero purple/blue gradients, zero glow shadows, zero glassmorphism
- [ ] No "Welcome", no "Supercharge", no "Delve", no exclamation-led copy
- [ ] Every button does something in every state (nothing decorative-disabled)
- [ ] Empty states name the next action; errors name the fix
- [ ] No new font, no new color, no new radius, no new timing token
- [ ] Tab order sane, Esc closes, Enter submits, screen-reader labels on icon buttons

## 6. Robustness (invisible, but this is what makes it premium)

- Token storage stays server-side, file mode 0600; never echoes token to client
  (status endpoint returns boolean + username only — already the case, keep it).
- Device poll: backoff 5s→10s, stop on cancel/unmount/settings-close, stop at 15 min.
- Push: disable button while in flight (already), then re-enable; surface server message
  verbatim on failure (scope/validation errors already structured).
- Repo list: paginate at 100 (already), preserve selection + filter text across refreshes.
- Offline/proxy failure: loader error with Retry (same pattern as the file-tree loader).

## 7. Acceptance criteria (must all pass before calling it done)

1. Logged out → Account tab shows login card only; no repo UI in DOM.
2. Login → profile header with real avatar image, name, handle; logout icon visible.
3. Logout → back to single login card; push button routes to login.
4. Device flow: code displayed, copy works, cancel stops polling (assert no timers leak),
   expiry path shows "Code expired".
5. PAT without `repo` scope rejected with scope message; valid PAT logs in.
6. Expired/revoked token (forced 401) → logged-out state + session toast, no stuck UI.
7. Push from header with no repo → account panel + guidance toast, zero network push.
8. Keyboard-only: Tab to login, Enter activates, Esc closes settings from anywhere.
9. Suite: `npm test` green; new tests follow existing patterns only
   (served-HTML contains `Login with GitHub` / omits `ghRepoCard` when logged out is
   client-state — assert static gating hooks + endpoint codes, never live GitHub).

## 8. Phased rollout

- **Phase 1 — Gating + copy.** State machine, section gating, Login/Logout strings,
  logout confirm. Tests: section presence per state hooks, push-button routing.
- **Phase 2 — Profile + polish.** Avatar image + skeleton, pills, relative times,
  device-code timer UI, focus/keyboard pass, fingerprints checklist.
- **Phase 3 — Hardening.** Backoff/timeout, 401 auto-logout, PAT scope validation,
  selection persistence, full acceptance run.

## 9. Open questions (need your call before Phase 1)

1. Keep push-button-before-login routing to Account, or a dedicated login modal? (Plan: Account.)
2. Show token expiry/last-used anywhere? (Plan: no — invisible security.)
3. Should creating a repo also push the workspace immediately? (Plan: no — select only.)
