const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const gh = require('../dist/github.js');
const { collectProjectFiles } = require('../dist/collect.js');

test('isValidRepoName accepts sane names, rejects junk', () => {
  assert.equal(gh.isValidRepoName('my-repo_1.2'), true);
  assert.equal(gh.isValidRepoName(''), false);
  assert.equal(gh.isValidRepoName('a/b'), false);
  assert.equal(gh.isValidRepoName('x'.repeat(101)), false);
});

test('parseRepoFull parses owner/name, rejects bad shapes', () => {
  assert.deepEqual(gh.parseRepoFull('octo/hello'), { owner: 'octo', repo: 'hello' });
  assert.equal(gh.parseRepoFull('nope'), null);
  assert.equal(gh.parseRepoFull('a/b/c'), null);
  assert.equal(gh.parseRepoFull(''), null);
  assert.equal(gh.parseRepoFull('../evil'), null);
});

test('sanitizeRepoPatch keeps only allowed keys with right types', () => {
  const out = gh.sanitizeRepoPatch({
    name: 'good-name',
    description: 'hi',
    homepage: 'https://x.example',
    private: true,
    has_issues: false,
    evil: 'drop me',
    name2: 1,
  });
  assert.deepEqual(Object.keys(out).sort(), ['description', 'has_issues', 'homepage', 'name', 'private']);
  assert.equal(gh.sanitizeRepoPatch({ name: 'bad/name' }).name, undefined);
  assert.deepEqual(gh.sanitizeRepoPatch(null), {});
});

test('parseOAuthScopes splits header values, lowercases', () => {
  assert.deepEqual(gh.parseOAuthScopes('repo, workflow'), ['repo', 'workflow']);
  assert.deepEqual(gh.parseOAuthScopes('Repo,  User'), ['repo', 'user']);
  assert.deepEqual(gh.parseOAuthScopes(null), []);
  assert.deepEqual(gh.parseOAuthScopes(['repo', 'gist']), ['repo', 'gist']);
});

test('hasRepoScope requires the repo scope for push', () => {
  assert.equal(gh.hasRepoScope(['repo', 'workflow']), true);
  assert.equal(gh.hasRepoScope('repo, workflow'), true);
  assert.equal(gh.hasRepoScope(['public_repo']), false);
  assert.equal(gh.hasRepoScope('public_repo, user'), false);
  assert.equal(gh.hasRepoScope([]), false);
  assert.equal(gh.hasRepoScope(null), false);
});

test('classifyTokenKind separates full / limited / fine-grained logins', () => {
  assert.equal(gh.classifyTokenKind(['repo', 'workflow']), 'full');
  assert.equal(gh.classifyTokenKind(['public_repo']), 'limited');
  assert.equal(gh.classifyTokenKind([]), 'limited');
  assert.equal(gh.classifyTokenKind(null), 'fine-grained');
});

test('friendlyActionError translates integration 403s', () => {
  const mk = (code, msg) => { const e = new Error(msg); e.statusCode = code; return e; };
  const m1 = gh.friendlyActionError(mk(403, 'Resource not accessible by integration'), 'create repositories');
  assert.ok(m1 && m1.includes('create repositories') && m1.includes('Login with GitHub'), 'create guidance: ' + m1);
  const m2 = gh.friendlyActionError(mk(403, 'RESOURCE NOT ACCESSIBLE BY INTEGRATION'), 'push to this repository');
  assert.ok(m2 && m2.includes('push to this repository'), 'case-insensitive + verb: ' + m2);
  assert.equal(gh.friendlyActionError(mk(403, 'rate limited'), 'create repositories'), null);
  assert.equal(gh.friendlyActionError(mk(404, 'Resource not accessible by integration'), 'create repositories'), null);
  assert.equal(gh.friendlyActionError(new Error('boom'), 'create repositories'), null);
  assert.equal(gh.friendlyActionError(null, 'create repositories'), null);
});

test('sanitizeTopics lowercases/dedupes, rejects junk', () => {

  assert.deepEqual(gh.sanitizeTopics(['Editor', 'editor', 'term-2']), ['editor', 'term-2']);
  assert.equal(gh.sanitizeTopics(['BAD NAME']), null);
  assert.equal(gh.sanitizeTopics('nope'), null);
  assert.equal(gh.sanitizeTopics(Array.from({ length: 21 }, (_, i) => 't' + i)), null);
});

test('collectProjectFiles skips secrets, binaries, vendored dirs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-gh-collect-'));
  try {
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'hi');
    fs.writeFileSync(path.join(dir, '.env'), 'SECRET=1');
    fs.writeFileSync(path.join(dir, 'k.pem'), 'priv');
    fs.writeFileSync(path.join(dir, 'b.bin'), Buffer.from([0x00, 0x01, 0x02]));
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'node_modules', 'x.js'), 'x');
    const files = collectProjectFiles(dir);
    assert.ok(files.has('ok.txt'));
    assert.ok(!files.has('.env'), '.env skipped');
    assert.ok(!files.has('k.pem'), '.pem skipped');
    assert.ok(!files.has('b.bin'), 'binary skipped');
    assert.ok(![...files.keys()].some((k) => k.startsWith('node_modules')), 'vendored skipped');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- live server tests with isolated HOME (no GitHub token) ---
const PORT = 34984;
const TOKEN = 'test-token-123';
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
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-gh-api-'));
  isoHome = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-gh-home-'));
  fs.writeFileSync(path.join(fixture, 'hello.txt'), 'hi');
  child = spawn(process.execPath, [SERVER, `--port=${PORT}`], {
    cwd: fixture,
    env: { ...process.env, TYPEWRITER_TOKEN: TOKEN, HOME: isoHome },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/tree`, {
        headers: { Authorization: `Bearer ${TOKEN}` },
      });
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('test server did not boot');
});

after(() => {
  if (child) child.kill();
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
  if (isoHome) fs.rmSync(isoHome, { recursive: true, force: true });
});

test('github status reports disconnected with isolated home', async () => {
  const r = await api('/api/github/status');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.connected, false);
});

test('github repos/select/push require connection (409)', async () => {
  const g = await api('/api/github/repos');
  assert.equal(g.status, 409);
  const s = await api('/api/github/select', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ full: 'octo/hello' }),
  });
  assert.equal(s.status, 409);
  const p = await api('/api/github/push', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(p.status, 409);
});

test('device poll validates body (400 without device_code)', async () => {
  const r = await api('/api/github/device/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 400);
});

test('device poll validation error is retryable (no fatal flag)', async () => {
  // The client only stops polling on fatal errors; validation hiccups must not kill the loop.
  const r = await api('/api/github/device/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const j = await r.json();
  assert.equal(j.fatal || false, false);
});

test('device poll rejects malformed json without fatal flag', async () => {
  const r = await api('/api/github/device/poll', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: '{oops',
  });
  assert.equal(r.status, 400);
  assert.equal((await r.json()).fatal || false, false);
});

test('saveGuard only accepts tokens that can create repositories', () => {
  // fine-grained PATs: GitHub blocks POST /user/repos for them entirely
  const fg = gh.saveGuard(null);
  assert.ok(typeof fg === 'string' && fg.includes('fine-grained'), 'fine-grained rejected: ' + fg);
  // classic PAT without repo scope
  for (const scopes of [[], ['read:user'], ['gist']]) {
    const m = gh.saveGuard(scopes);
    assert.ok(typeof m === 'string' && m.includes('`repo`'), `no-repo ${JSON.stringify(scopes)} rejected: ` + m);
  }
  // classic PAT with repo scope (case-insensitive, extra scopes fine)
  assert.equal(gh.saveGuard(['repo']), null);
  assert.equal(gh.saveGuard(['REPO', 'gist', 'read:user']), null);
  // string form also accepted
  assert.equal(gh.saveGuard('repo, gist'), null);
});

test('isGitHubAppToken detects app user/server tokens by prefix', () => {
  assert.equal(gh.isGitHubAppToken('ghu_abc123'), true);
  assert.equal(gh.isGitHubAppToken('ghs_abc123'), true);
  assert.equal(gh.isGitHubAppToken('ghp_abc123'), false);
  assert.equal(gh.isGitHubAppToken('github_pat_abc123'), false);
  assert.equal(gh.isGitHubAppToken('gho_abc123'), false);
  assert.equal(gh.isGitHubAppToken(''), false);
  assert.equal(gh.isGitHubAppToken(null), false);
  assert.equal(gh.isGitHubAppToken(undefined), false);
});

test('saveGuard rejects GitHub App tokens even with no scope info', () => {
  const m = gh.saveGuard(null, 'ghu_abc123');
  assert.ok(typeof m === 'string' && m.includes('GitHub App'), 'app token rejected: ' + m);
  // classic with repo scope still passes, with or without token arg
  assert.equal(gh.saveGuard(['repo'], 'ghp_abc123'), null);
});

test('createBlockedMessage blames the app, not scopes, for app tokens', () => {
  const m = gh.createBlockedMessage('ghu_abc123', 'limited');
  assert.ok(typeof m === 'string' && m.includes('GitHub App'), 'app message: ' + m);
  assert.ok(gh.createBlockedMessage('ghp_x', 'full') === null, 'full classic passes');
  assert.ok(typeof gh.createBlockedMessage('ghp_x', 'fine-grained') === 'string', 'fine-grained still blocked');
});

test('parseGitCredentialOutput extracts username/password, null without password', () => {
  assert.deepEqual(gh.parseGitCredentialOutput('protocol=https\nhost=github.com\nusername=octo\npassword=ghp_secret123\n'), { username: 'octo', password: 'ghp_secret123' });
  assert.deepEqual(gh.parseGitCredentialOutput('password=x\n'), { username: '', password: 'x' });
  assert.equal(gh.parseGitCredentialOutput('protocol=https\nhost=github.com\n'), null);
  assert.equal(gh.parseGitCredentialOutput(''), null);
  assert.equal(gh.parseGitCredentialOutput('garbage\nno-equals\n'), null);
});

test('sanitizeRepoPatch drops empty strings (GitHub 422s on them)', () => {
  assert.deepEqual(gh.sanitizeRepoPatch({ description: '', homepage: '', default_branch: '' }), {});
  assert.deepEqual(gh.sanitizeRepoPatch({ homepage: null }), { homepage: null });
  assert.deepEqual(gh.sanitizeRepoPatch({ description: 'hi', default_branch: 'main' }), { description: 'hi', default_branch: 'main' });
});

test('gitHubErrorMessage includes GitHub validation detail', () => {
  const m = gh.gitHubErrorMessage(422, { message: 'Validation Failed', errors: [{ resource: 'Repository', code: 'custom', field: 'name', message: 'name already exists on this account' }] }, '');
  assert.ok(m.includes('Validation Failed') && m.includes('name already exists'), 'detailed: ' + m);
  assert.equal(gh.gitHubErrorMessage(422, { message: 'Validation Failed', errors: [] }, ''), 'Validation Failed');
  assert.equal(gh.gitHubErrorMessage(422, { message: 'Validation Failed' }, ''), 'Validation Failed');
  const long = gh.gitHubErrorMessage(500, null, 'x'.repeat(500));
  assert.ok(long.length <= 300, 'capped at 300, got ' + long.length);
});

test('isEmptyRepo recognizes GitHub empty-repo 409 only', () => {
  const empty = new gh.GitHubError('GitHub API error: 409 - Git Repository is empty.', 409);
  assert.equal(gh.isEmptyRepo(empty), true);
  assert.equal(gh.isEmptyRepo(new gh.GitHubError('GitHub API error: 404 - Not Found', 404)), false);
  assert.equal(gh.isEmptyRepo(new gh.GitHubError('GitHub API error: 409 - something else', 409)), false);
  assert.equal(gh.isEmptyRepo(new Error('boom')), false);
  assert.equal(gh.isEmptyRepo(null), false);
});
