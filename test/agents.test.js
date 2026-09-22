const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { findAgentBin, agentStatus } = require('../dist/server.js');

test('findAgentBin resolves opencode, rejects unknown ids', () => {
  const hit = findAgentBin('opencode');
  assert.ok(typeof hit === 'string' && hit.length > 0, 'opencode found on this machine');
  assert.ok(fs.existsSync(hit), 'resolved bin exists: ' + hit);
  assert.equal(findAgentBin('nope'), null);
  assert.equal(findAgentBin(''), null);
});

test('agentStatus reports all three agents with boolean flags', () => {
  const all = agentStatus();
  assert.deepEqual(all.map((a) => a.id), ['claude', 'opencode', 'codex']);
  for (const a of all) {
    assert.equal(typeof a.installed, 'boolean', a.id);
    assert.ok(a.name && a.run && a.installLabel, a.id);
  }
  assert.equal(all.find((a) => a.id === 'opencode').installed, true);
});

// --- live API tests: authed server ---
const PORT = 34986;
const TOKEN = 'test-token-agents';
const SERVER = path.join(__dirname, '..', 'dist', 'server.js');
let child = null;
let fixture = '';
let isoHome = '';

function api(p, opts = {}) {
  return fetch(`http://127.0.0.1:${PORT}${p}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${TOKEN}` },
  });
}

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-agents-'));
  isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-agents-home-'));
  child = spawn(process.execPath, [SERVER, `--port=${PORT}`], {
    cwd: fixture,
    env: { ...process.env, TYPEWRITER_TOKEN: TOKEN, HOME: isoHome },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await api('/api/tree');
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('agents test server did not boot');
});

after(() => {
  if (child) child.kill();
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
  if (isoHome) fs.rmSync(isoHome, { recursive: true, force: true });
});

test('GET /api/agents lists install state (authed)', async () => {
  const r = await api('/api/agents');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.agents.length, 3);
  const oc = j.agents.find((a) => a.id === 'opencode');
  assert.equal(oc.installed, true);
  assert.ok(/opencode/i.test(oc.version || ''), 'version detected: ' + oc.version);
});

test('served IDE embeds official agent marks and editor-tab host', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('/icons/claude.svg'), 'claude icon referenced');
  assert.ok(html.includes('/icons/opencode.png'), 'opencode icon referenced');
  assert.ok(html.includes('/icons/codex.svg'), 'codex icon referenced');
  for (const f of [['/icons/claude.svg', 'image/svg+xml', 'Claude'],
                   ['/icons/opencode.png', 'image/png', 'PNG'],
                   ['/icons/codex.svg', 'image/svg+xml', 'Square']]) {
    const r = await fetch(`http://127.0.0.1:${PORT}${f[0]}`);
    assert.equal(r.status, 200, f[0]);
    assert.ok(String(r.headers.get('content-type')).includes(f[1]), f[0] + ' mime');
    const buf = Buffer.from(await r.arrayBuffer());
    assert.ok(buf.length > 200, f[0] + ' non-empty');
    if (f[2] === 'Claude') assert.ok(buf.includes('m4.7144 15.9555'), 'official Claude starburst bytes');
    if (f[2] === 'PNG') assert.deepEqual([buf[0], buf[1]], [0x89, 0x50], 'png magic');
    if (f[2] === 'Square') assert.ok(buf.includes('<rect'), 'codex square mark');
  }
  const trav = await fetch(`http://127.0.0.1:${PORT}/icons/../package.json`);
  assert.equal(trav.status, 404, 'icon traversal blocked');
  assert.ok(html.includes('id="agentwrap"'), 'agent overlay pane present');
  assert.ok(html.includes('function openAgentTab'), 'editor-tab launcher present');
  assert.ok(!html.includes('toggleTerm(true);\n newTermPty({label'), 'agents no longer launch in bottom terminal');
  assert.ok(html.includes('hideEdLayers()'), 'editor layers hidden under agent overlay');
  assert.ok(html.includes("className='agentpane on'"), 'xterm opens in a visible pane');
  assert.ok(html.includes('#agentwrap.on'), 'agent overlay style present');
  assert.ok(html.includes('t.agent)?t.name'), 'agent tabs labeled by agent name');
});

test('device poll loop only stops on fatal errors', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert.ok(html.includes('j.error&&j.fatal'), 'poll loop fatal-gated');
  assert.ok(html.includes('retrying…'), 'transient poll errors retry visibly');
  assert.ok(html.includes("/unauthorized/.test(String((e&&e.message)||''))"), 'app-auth failure stops poll loop');
});

test('header has push-to-GitHub button (no Save button)', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert.ok(html.includes('id="pushBtn"'), 'push button present');
  assert.ok(html.includes('Push workspace to GitHub'), 'push tooltip present');
  assert.ok(!html.includes('id="saveBtn"'), 'Save button replaced');
});

test('repo create has visible error slot + subtle selection styles', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert.ok(html.includes('id="ghCreateErr"'), 'visible create-error slot present');
  assert.ok(html.includes('function ghCreateErr'), 'create-error helper present');
  assert.ok(html.includes('box-shadow:inset 2px 0 0 var(--primary)'), 'selection is accent bar, not full fill');
  assert.ok(!html.includes('#ghRepoList a.sel{background:var(--primary)'), 'loud selection fill removed');
  assert.ok(html.includes('#ghRepoCard .gh-row{flex-wrap:nowrap}'), 'create row never wraps');
  assert.ok(html.includes('#ghSelName{text-transform:none'), 'repo name not caps-locked');
  assert.ok(html.includes("(m[0]==null?'—':m[0])"), 'meta never renders undefined');
  assert.ok(html.includes('M5 20a7 7 0 0 1 14 0'), 'logged-out avatar is a user mark, not empty');
});

test('push review modal has target, files, git diff and confirm hooks', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert.ok(html.includes('id="pushModal"'), 'modal present');
  assert.ok(html.includes('id="pushTarget"'), 'repo+branch target line');
  assert.ok(html.includes('id="pushFiles"'), 'file list');
  assert.ok(html.includes('id="pushGit"') && html.includes('id="pushDiff"'), 'git changes + diff viewer');
  assert.ok(html.includes('id="pushMsg"'), 'commit message input');
  assert.ok(html.includes('id="pushGo"'), 'confirm push button');
  assert.ok(html.includes('openPushReview'), 'review entry point');
  assert.ok(!html.includes("await ghPush();"), 'header no longer pushes blind');
});

test('POST /api/github/push is 409 when github not connected', async () => {
  const r = await api('/api/github/push', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 409);
  assert.match((await r.json()).error, /not connected/);
});

test('GET /api/agents requires token', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/agents`);
  assert.equal(r.status, 401);
});

test('POST /api/agents/install rejects unknown agent', async () => {
  const r = await api('/api/agents/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'clippy' }),
  });
  assert.equal(r.status, 400);
});

test('POST /api/agents/install refuses already-installed agent (no spawn)', async () => {
  const r = await api('/api/agents/install', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'opencode' }),
  });
  assert.equal(r.status, 400);
  assert.match((await r.json()).error, /already installed/);
});

test('POST /api/agents/install requires token', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/agents/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'codex' }),
  });
  assert.equal(r.status, 401);
});

// --- live API test: server WITHOUT token → installs disabled entirely ---
const PORT2 = 34985;
let child2 = null;

before(async () => {
  child2 = spawn(process.execPath, [SERVER, `--port=${PORT2}`], {
    cwd: fixture || os.tmpdir(),
    env: { ...process.env, TYPEWRITER_TOKEN: '', HOME: isoHome || os.tmpdir() },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT2}/api/tree`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('no-token test server did not boot');
});

after(() => {
  if (child2) child2.kill();
});

test('account login UX phase 1: gating hooks + copy deck', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('Login with GitHub'), 'login button copy');
  assert.ok(html.includes('id="ghLoginCard"'), 'login card hook');
  assert.ok(html.includes('id="ghRepoCard"'), 'repo card hook');
  assert.ok(html.includes('id="ghSetCard"'), 'settings card hook');
  assert.ok(html.includes('ghApplyState'), 'section gating hook');
  assert.ok(html.includes('ghStateName'), 'state machine hook');
  assert.ok(html.includes('Log in to push'), 'need-login copy');
  assert.ok(html.includes('Select a repository to push to'), 'need-repo copy');
  assert.ok(html.includes('title="Logout"'), 'logout icon title');
  assert.ok(html.includes('Confirm?'), 'logout confirm copy');
  assert.ok(html.includes('Logged out'), 'logout toast copy');
  assert.ok(html.includes('Logged in as'), 'login toast copy');
  assert.ok(html.includes('Push workspace to GitHub'), 'header tooltip copy');
  assert.ok(html.includes("showSetPanel('account')"), 'push routes to Account panel');
});

test('account login UX phase 2: profile + polish hooks, no emojis', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert.ok(html.includes('gh-pill'), 'private/public pills');
  assert.ok(html.includes('ghRelTime'), 'relative-time hook');
  assert.ok(html.includes('Waiting for approval'), 'device waiting copy');
  assert.ok(html.includes('ghElapsed'), 'device elapsed-timer hook');
  assert.ok(html.includes('No repositories yet — create your first below'), 'empty-repos copy');
  assert.ok(html.includes("Couldn't load repositories"), 'load-fail copy');
  assert.ok(html.includes('ghRetry'), 'retry hook');
  assert.ok(html.includes('Paste a classic token — enables repo creation'), 'PAT toggle names the capable path');
  assert.ok(html.includes("App logins can't create repos."), 'pre-login app-limit honesty note');
  assert.ok(html.includes('Tokens (classic)'), 'classic-token recipe hook');
  assert.ok(html.includes('ghPatRow'), 'PAT row hook');
  assert.ok(html.includes('aria-label="Logout"'), 'logout screen-reader label');
  assert.ok(html.includes('Refresh repositories'), 'refresh icon-button label');
  assert.ok(html.includes('Created '), 'create toast copy');
  assert.ok(html.includes('ghAvatar'), 'avatar hook');
  assert.ok(html.includes('connected'), 'avatar ring hook');
  assert.ok(!html.includes('🔒') && !html.includes('🌐'), 'no emoji lock/globe in repo rows');
  assert.ok(!html.includes('Connect with GitHub'), 'old connect copy gone');
  assert.ok(!html.includes('>Disconnect<'), 'old disconnect copy gone');
  assert.ok(!html.includes('waiting for authorization'), 'old device copy gone');
});

test('GET /api/github/status reports shape', async () => {
  const r = await api('/api/github/status');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(typeof j.connected, 'boolean');
});

test('account login UX phase 3: hardening hooks + copy deck', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  const html = await r.text();
  assert.ok(html.includes('ghApi'), 'authed github fetch wrapper');
  assert.ok(html.includes('ghOnSessionExpired'), 'session-expiry reset hook');
  assert.ok(html.includes('Session expired — please log in again'), 'session toast copy');
  assert.ok(html.includes('Code expired — start over'), 'device expiry copy');
  assert.ok(html.includes('expiresIn'), 'device expiry-budget hook');
  assert.ok(html.includes('pollWait'), 'poll backoff hook');
  assert.ok(html.includes('aria-selected'), 'repo check-state hook');
  assert.ok(html.includes('expiredFlash'), 'session-toast guard hook');
  assert.ok(html.includes("@'+(ghState.username"), 'profile @handle hook');
  assert.ok(html.includes('if(b)b.focus()'), 'login autofocus hook');
});

test('POST /api/github/token is 400 without a token (no network)', async () => {
  const r = await api('/api/github/token', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
});

test('POST /api/github/device/poll is 400 without device_code', async () => {


  const r = await api('/api/github/device/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
});

test('POST /api/agents/install is 403 when TYPEWRITER_TOKEN is not set', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT2}/api/agents/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'codex' }),
  });
  assert.equal(r.status, 403);
});
