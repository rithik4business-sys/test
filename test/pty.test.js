const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const PORT = 34988;
const SERVER = path.join(__dirname, '..', 'dist', 'server.js');
let child = null;
let fixture = '';

before(async () => {
  fixture = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-pty-'));
  child = spawn(process.execPath, [SERVER, `--port=${PORT}`], {
    cwd: fixture,
    env: { ...process.env },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${PORT}/api/tree`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('pty test server did not boot');
});

after(() => {
  if (child) child.kill();
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
});

test('vendor serves xterm assets offline', async () => {
  for (const f of ['xterm.js', 'xterm.css', 'fit.js']) {
    const r = await fetch(`http://127.0.0.1:${PORT}/vendor/${f}`);
    assert.equal(r.status, 200, f);
    assert.ok((await r.text()).length > 1000, f + ' non-empty');
  }
  const bad = await fetch(`http://127.0.0.1:${PORT}/vendor/../../package.json`);
  assert.equal(bad.status, 404);
});

test('pty websocket runs a real shell', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/pty?cols=80&rows=24`);
  const seen = [];
  const ready = new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('no pty ready in time')), 15000);
    ws.onmessage = (ev) => {
      let m = null;
      try { m = JSON.parse(ev.data); } catch { return; }
      seen.push(m);
      if (m.t === 'ready') { clearTimeout(to); resolve(); }
    };
    ws.onerror = () => reject(new Error('ws error'));
  });
  await ready;
  ws.send(JSON.stringify({ t: 'in', d: 'echo pty-web-ok\r' }));
  const t0 = Date.now();
  let found = false;
  while (Date.now() - t0 < 15000) {
    if (seen.some((m) => m.t === 'out' && /pty-web-ok/.test(m.d))) { found = true; break; }
    await new Promise((r) => setTimeout(r, 150));
  }
  ws.close();
  assert.ok(found, 'shell echoed command output through pty');
});

test('lsp without installed server fails gracefully', async () => {
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/lsp?lang=brainfuck`);
  const msg = await new Promise((resolve, reject) => {
    const to = setTimeout(() => reject(new Error('no lsp reply')), 10000);
    ws.onmessage = (ev) => { clearTimeout(to); resolve(JSON.parse(ev.data)); };
    ws.onerror = () => reject(new Error('ws error'));
  });
  ws.close();
  assert.equal(msg.t, 'error');
});

test('terminal owns its keys + resizes without stealing focus', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  // keystrokes inside the xterm pane must reach the shell, not editor bindings
  assert.ok(html.includes("closest('#ptybox')"), 'pty key guard present');
  // window resize / drag refit must not yank focus out of the editor
  assert.ok(html.includes('fitPty(false)'), 'passive refit skips focus');
  assert.ok(html.includes('function fitPty(focus)'), 'fit focus flag present');
  // resize grip is a visible handle, not an invisible strip
  assert.ok(html.includes('#termgrip:after'), 'grip handle styled');
  assert.ok(html.includes('dragterm'), 'drag selection lock present');
});
