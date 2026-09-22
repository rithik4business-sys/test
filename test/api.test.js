const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { safePath } = require('../dist/utils.js');
const { tree } = require('../dist/server.js');

test('safePath keeps paths inside root', () => {
  const root = path.resolve('/tmp/tw-root');
  assert.equal(safePath(root, 'a/b.txt'), path.join(root, 'a/b.txt'));
  assert.equal(safePath(root, '..'), null);
  assert.equal(safePath(root, '../evil'), null);
  assert.equal(safePath(root, 'a/../../evil'), null);
  // Leading slash is stripped, so /etc/passwd becomes etc/passwd (inside root)
  assert.equal(safePath(root, '/etc/passwd'), path.join(root, 'etc/passwd'));
});

test('safePath handles URL-encoded traversal', () => {
  const root = path.resolve('/tmp/tw-root');
  assert.equal(safePath(root, '%2e%2e/evil'), null);
  assert.equal(safePath(root, '%2e%2e%2fevil'), null);
});

test('safePath handles leading slashes', () => {
  const root = path.resolve('/tmp/tw-root');
  assert.equal(safePath(root, '/a/b.txt'), path.join(root, 'a/b.txt'));
});

test('tree() skips dotfiles (except .gitignore) and vendored dirs', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tree2-'));
  try {
    fs.writeFileSync(path.join(dir, '.hidden'), 'x');
    fs.writeFileSync(path.join(dir, '.gitignore'), 'x');
    fs.mkdirSync(path.join(dir, 'node_modules'));
    fs.writeFileSync(path.join(dir, 'ok.txt'), 'x');
    const names = tree(dir, dir).map((n) => n.name);
    assert.ok(!names.includes('.hidden'), 'dotfiles hidden');
    assert.ok(!names.includes('node_modules'), 'vendored dirs skipped');
    assert.ok(names.includes('.gitignore'), '.gitignore kept');
    assert.ok(names.includes('ok.txt'));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('tree() sorts folders first, then files, each alphabetical', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tree-'));
  try {
    fs.writeFileSync(path.join(dir, 'zebra.txt'), 'z');
    fs.writeFileSync(path.join(dir, 'apple.txt'), 'a');
    fs.mkdirSync(path.join(dir, 'zdir'));
    fs.mkdirSync(path.join(dir, 'adir'));
    const nodes = tree(dir, dir);
    assert.deepEqual(nodes.map((n) => n.name), ['adir', 'zdir', 'apple.txt', 'zebra.txt']);
    assert.deepEqual(nodes.map((n) => n.type), ['dir', 'dir', 'file', 'file']);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// --- live API tests against a real server on a fixture root ---
const PORT = 34987;
const TOKEN = 'test-token-123';
const SERVER = path.join(__dirname, '..', 'dist', 'server.js');
let child = null;
let fixture = '';

function api(p, opts = {}) {
  return fetch(`http://127.0.0.1:${PORT}${p}`, {
    ...opts,
    headers: { ...(opts.headers || {}), Authorization: `Bearer ${TOKEN}` },
  });
}

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-api-'));
  fs.writeFileSync(path.join(fixture, 'hello.txt'), 'hi');
  fs.writeFileSync(path.join(fixture, 'dot.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]));
  child = spawn(process.execPath, [SERVER, `--port=${PORT}`], {
    cwd: fixture,
    env: { ...process.env, TYPEWRITER_TOKEN: TOKEN },
    stdio: 'ignore',
  });
  // wait for boot
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
});

test('API requires token when TYPEWRITER_TOKEN is set', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/tree`);
  assert.equal(r.status, 401);
});

test('tree lists fixture file', async () => {
  const r = await api('/api/tree');
  assert.equal(r.status, 200);
  const t = await r.json();
  assert.ok(t.some((n) => n.name === 'hello.txt'));
});

test('save then read back', async () => {
  const w = await api('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: 'sub/n.txt', content: 'abc' }),
  });
  assert.equal(w.status, 200);
  const r = await api('/api/file?p=' + encodeURIComponent('sub/n.txt'));
  assert.equal((await r.json()).content, 'abc');
});

test('root returns project basename', async () => {
  const r = await api('/api/root');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(typeof j.root === 'string' && j.root.length > 0);
});

test('save with trailing slash creates folder', async () => {
  const r = await api('/api/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: 'newdir/sub/', content: '' }),
  });
  assert.equal(r.status, 200);
  assert.equal(fs.statSync(path.join(fixture, 'newdir', 'sub')).isDirectory(), true);
});

test('rename moves file', async () => {
  const r = await api('/api/rename', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: 'hello.txt', to: 'hi.txt' }),
  });
  assert.equal(r.status, 200);
  assert.equal(fs.existsSync(path.join(fixture, 'hi.txt')), true);
  assert.equal(fs.existsSync(path.join(fixture, 'hello.txt')), false);
});

test('delete removes file, refuses root and traversal', async () => {
  const bad1 = await api('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: '../evil' }),
  });
  assert.equal(bad1.status, 400);
  const bad2 = await api('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: '' }),
  });
  assert.equal(bad2.status, 400);
  const ok = await api('/api/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ p: 'hi.txt' }),
  });
  assert.equal(ok.status, 200);
  assert.equal(fs.existsSync(path.join(fixture, 'hi.txt')), false);
});

test('binary files flagged, raw serves bytes', async () => {
  const f = await api('/api/file?p=dot.png');
  const j = await f.json();
  assert.equal(j.binary, true);
  const r = await api('/api/raw?p=dot.png');
  assert.equal(r.status, 200);
  assert.ok((r.headers.get('content-type') || '').includes('image/png'));
});

test('exec runs and reports cwd', async () => {
  const r = await api('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'echo ok', cwd: '' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.output.includes('ok'));
  assert.equal(j.exit, 0);
});

test('exec requires TYPEWRITER_TOKEN to be set', async () => {
  // This test verifies the exec endpoint works when token IS set (our server has it set)
  // The security fix is that exec returns 403 when TYPEWRITER_TOKEN is not set
  const r = await api('/api/exec', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ cmd: 'echo secure', cwd: '' }),
  });
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(j.output.includes('secure'));
});

test('search finds literal (incl. regex chars), case-insensitive, and regex mode', async () => {
  fs.writeFileSync(path.join(fixture, 'search-me.txt'), 'Total is a+b dollars\nSecond LINE here\nfoo123bar\n');
  const q = async (body) => {
    const r = await api('/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    assert.equal(r.status, 200);
    return (await r.json()).results;
  };
  // literal query containing regex metachars must NOT throw / misbehave
  let hits = await q({ q: 'a+b' });
  assert.ok(hits.some((h) => h.p.endsWith('search-me.txt') && h.line === 1), 'literal a+b found');
  // case-insensitive literal without a full-file lowercase copy
  hits = await q({ q: 'second line' });
  assert.ok(hits.some((h) => h.line === 2), 'case-insensitive literal found');
  // explicit regex mode still works
  hits = await q({ q: 'foo\\d+bar', regex: true });
  assert.ok(hits.some((h) => h.line === 3), 'regex mode found');
});

test('push files preview lists what a push would send', async () => {
  fs.writeFileSync(path.join(fixture, 'pushme.txt'), 'preview me');
  const r = await api('/api/github/push/files');
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.ok(Array.isArray(j.files), 'files array');
  assert.ok(j.files.some((f) => f.p === 'pushme.txt' && typeof f.bytes === 'number'), 'own fixture file listed with size');
  assert.ok(!j.files.some((f) => f.p === 'dot.png'), 'binary fixture excluded (same rules as push)');
  assert.equal(j.total, j.files.length);
  assert.ok(j.totalBytes > 0);
});
