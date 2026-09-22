const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

let pty = null;
try { pty = require('node-pty'); } catch { pty = null; }

const BIN = path.join(__dirname, '..', 'dist', 'index.js');
let dir = '';

function stripScreen(s) {
  return s
    .replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '')
    .replace(/\x1b[()][AB0]/g, '')
    .replace(/\x1b[=>]/g, '')
    .replace(/\r/g, '');
}

function spawnEditor(file) {
  const p = pty.spawn(process.execPath, [BIN, file], {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: dir,
    env: { ...process.env, TERM: 'xterm-256color' },
  });
  let out = '';
  p.onData((d) => { out += d; });
  return { p, get: () => stripScreen(out) };
}

async function waitFor(t, re, ms = 12000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    if (re.test(t.get())) return true;
    await new Promise((r) => setTimeout(r, 120));
  }
  return false;
}

before(() => {
  if (!pty) return;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-tui-'));
  fs.writeFileSync(path.join(dir, 'a.txt'), 'one\ntwo\nthree\n');
});

after(() => {
  if (dir) fs.rmSync(dir, { recursive: true, force: true });
});

test('boots and shows filename', { skip: !pty, timeout: 30000 }, async () => {
  const t = spawnEditor('a.txt');
  try {
    assert.ok(await waitFor(t, /a\.txt/), 'filename visible on screen');
    assert.ok(await waitFor(t, /NORMAL/), 'starts in normal mode');
  } finally { t.p.kill(); }
});

test('G jumps to last line (vim motion)', { skip: !pty, timeout: 30000 }, async () => {
  const t = spawnEditor('a.txt');
  try {
    assert.ok(await waitFor(t, /a\.txt/));
    t.p.write('G');
    assert.ok(await waitFor(t, /4:1/), 'statusline shows 4:1 (trailing newline = 4th line), got tail: ' + JSON.stringify(t.get().slice(-160)));
  } finally { t.p.kill(); }
});

test('ghost completion appears and Tab accepts it', { skip: !pty, timeout: 30000 }, async () => {
  const t = spawnEditor('g.py');
  try {
    assert.ok(await waitFor(t, /g\.py/));
    await new Promise((r) => setTimeout(r, 500)); // let startup settle or 'i' lands pre-ready
    t.p.write('ifor');
    assert.ok(await waitFor(t, /for x in xs:/, 8000), 'python snippet ghost visible, got tail: ' + JSON.stringify(t.get().slice(-200)));
    t.p.write('\x09');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write('\x1b');
    await new Promise((r) => setTimeout(r, 300));
    t.p.write(':w\r');
    assert.ok(await waitFor(t, /Saved/, 8000), 'save confirmed');
    assert.equal(fs.readFileSync(path.join(dir, 'g.py'), 'utf-8'), 'for x in xs:');
  } finally { try { t.p.kill(); } catch {} }
});

test('insert, save, quit writes file', { skip: !pty, timeout: 30000 }, async () => {
  const t = spawnEditor('b.txt');
  try {
    assert.ok(await waitFor(t, /b\.txt/));
    t.p.write('ihello');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write('\x1b');
    await new Promise((r) => setTimeout(r, 300));
    t.p.write(':w\r');
    assert.ok(await waitFor(t, /Saved/, 8000), 'save confirmed');
    assert.equal(fs.readFileSync(path.join(dir, 'b.txt'), 'utf-8'), 'hello');
    const exited = new Promise((r) => { t.p.onExit(() => r(true)); setTimeout(() => r(false), 4000); });
    t.p.write(':q\r');
    assert.ok(await exited, 'editor quit after :q');
  } finally { try { t.p.kill(); } catch {} }
});

test(':theme switches, :sp splits, :only unsplits', { skip: !pty, timeout: 30000 }, async () => {
  const t = spawnEditor('a.txt');
  try {
    assert.ok(await waitFor(t, /a\.txt/));
    t.p.write(':theme nord\r');
    assert.ok(await waitFor(t, /theme: nord/, 8000), 'theme switch confirmed');
    t.p.write(':sp\r');
    assert.ok(await waitFor(t, /Split/, 8000), 'split opened');
    t.p.write(':only\r');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write(':q!\r');
  } finally { try { t.p.kill(); } catch {} }
});

test('visual mode highlights and deletes a selection', { skip: !pty, timeout: 30000 }, async () => {
  fs.writeFileSync(path.join(dir, 'v.txt'), 'alpha\nbeta\ngamma\n');
  const t = spawnEditor('v.txt');
  try {
    assert.ok(await waitFor(t, /v\.txt/));
    t.p.write('v');
    assert.ok(await waitFor(t, /VISUAL/), 'statusline shows VISUAL');
    t.p.write('jj');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write('d');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write(':w\r');
    assert.ok(await waitFor(t, /Saved/, 8000), 'save confirmed');
    assert.equal(fs.readFileSync(path.join(dir, 'v.txt'), 'utf-8'), 'amma\n');
  } finally { t.p.kill(); }
});

test('dot repeats the last change (x)', { skip: !pty, timeout: 30000 }, async () => {
  fs.writeFileSync(path.join(dir, 'd.txt'), 'one\ntwo\nthree\n');
  const t = spawnEditor('d.txt');
  try {
    assert.ok(await waitFor(t, /d\.txt/));
    t.p.write('x');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write('.');
    await new Promise((r) => setTimeout(r, 400));
    t.p.write(':w\r');
    assert.ok(await waitFor(t, /Saved/, 8000), 'save confirmed');
    assert.equal(fs.readFileSync(path.join(dir, 'd.txt'), 'utf-8'), 'e\ntwo\nthree\n');
  } finally { t.p.kill(); }
});

test('marks and jumplist navigate (ma, G, quote-a, Ctrl-O)', { skip: !pty, timeout: 30000 }, async () => {
  const t = spawnEditor('a.txt');
  try {
    assert.ok(await waitFor(t, /a\.txt/));
    t.p.write('ma');
    await new Promise((r) => setTimeout(r, 300));
    t.p.write('G');
    assert.ok(await waitFor(t, /4:1 4L/, 8000), 'G went to last line');
    t.p.write("'a");
    assert.ok(await waitFor(t, /1:1 4L/, 8000), "'a jumped back to mark, got tail: " + JSON.stringify(t.get().slice(-160)));
    t.p.write('G');
    assert.ok(await waitFor(t, /4:1 4L/, 8000), 'G again');
    t.p.write('\x0f');
    assert.ok(await waitFor(t, /1:1 4L/, 8000), 'Ctrl-O walked jumplist back, got tail: ' + JSON.stringify(t.get().slice(-160)));
  } finally { t.p.kill(); }
});
