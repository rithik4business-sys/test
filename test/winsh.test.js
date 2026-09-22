const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const winsh = require('../dist/winsh.js');

test('shellFor picks powershell on win32, sh elsewhere', () => {
  assert.equal(winsh.shellFor('win32').cmd, 'powershell.exe');
  assert.equal(winsh.shellFor('linux').cmd, 'sh');
  assert.deepEqual(winsh.shellFor('linux').args('echo hi'), ['-c', 'echo hi']);
});

test('psCommandArgs bypasses policy and forces UTF-8', () => {
  const a = winsh.psCommandArgs('echo hi');
  assert.ok(a.includes('-ExecutionPolicy') && a.includes('Bypass'), 'policy bypass: ' + a.join(' '));
  assert.ok(a.includes('-NoProfile') && a.includes('-NonInteractive'), 'unattended flags');
  assert.ok(a.some((x) => x.includes('OutputEncoding') && x.includes('UTF8')), 'UTF-8 guard');
  assert.ok(a[a.length - 1].endsWith('echo hi'), 'command last');
});

test('shellQuote is literal-safe per platform', () => {
  assert.equal(winsh.shellQuote("it's $HOME `x` \\", 'win32'), "'it''s $HOME `x` \\'");
  assert.equal(winsh.shellQuote('a"b$c`d\\e', 'linux'), '"a\\"b\\$c\\`d\\\\e"');
});

test('runnerFor uses Windows-safe runners on win32', () => {
  assert.equal(winsh.runnerFor('py', 'win32'), 'py -3');
  assert.equal(winsh.runnerFor('py', 'linux'), 'python3');
  assert.equal(winsh.runnerFor('ps1', 'win32'), '&');
  assert.equal(winsh.runnerFor('ps1', 'linux'), 'pwsh');
  assert.equal(winsh.runnerFor('js', 'win32'), 'node');
  assert.equal(winsh.runnerFor('unknown-ext', 'win32'), undefined);
});

test('taskkillArgs kills the whole tree', () => {
  assert.deepEqual(winsh.taskkillArgs(1234), ['/pid', '1234', '/T', '/F']);
});

test('npm build is Windows-safe (no Unix-only shell commands)', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
  assert.ok(!/(^|[;&|]\s*|\s)cp\s+-r/.test(pkg.scripts.build), 'no cp -r in build: ' + pkg.scripts.build);
  assert.ok(pkg.scripts.build.includes('tsc'), 'still compiles TypeScript');
});
