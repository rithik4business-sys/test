import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  isWindows,
  psCommandArgs,
  shellFor,
  shellQuote,
  runnerFor,
  taskkillArgs,
} from '../src/winsh';

test('platform detection', () => {
  assert.equal(isWindows('win32'), true);
  assert.equal(isWindows('linux'), false);
  assert.equal(isWindows('darwin'), false);
});

test('powershell argv: Bypass policy + UTF-8 output + command', () => {
  const a = psCommandArgs('Get-ChildItem');
  assert.ok(a.includes('powershell.exe') === false, 'no exe in argv');
  assert.ok(a.includes('Bypass'), 'Restricted policy bypassed for scripts');
  const cmd = a[a.length - 1];
  assert.ok(cmd.includes('OutputEncoding'), 'UTF-8 output forced (no mojibake)');
  assert.ok(cmd.endsWith('Get-ChildItem'), 'user command appended, got: ' + cmd);
});

test('shellFor picks powershell on win32, sh elsewhere', () => {
  const w = shellFor('win32');
  assert.equal(w.cmd, 'powershell.exe');
  assert.ok(w.args('echo hi').includes('Bypass'));
  const p = shellFor('linux');
  assert.equal(p.cmd, 'sh');
  assert.deepEqual(p.args('echo hi'), ['-c', 'echo hi']);
});

test('shellQuote: PowerShell single-quote literals', () => {
  assert.equal(shellQuote('hello world', 'win32'), "'hello world'");
  // backslashes, $, backticks, double quotes pass through untouched
  assert.equal(shellQuote('C:\\proj\\my $file`v".ps1', 'win32'), "'C:\\proj\\my $file`v\".ps1'");
  assert.equal(shellQuote("it's", 'win32'), "'it''s'");
});

test('shellQuote: sh double-quote escaping preserved', () => {
  assert.equal(shellQuote('a"b$c`d\\e', 'linux'), '"a\\"b\\$c\\`d\\\\e"');
});

test('runnerFor: stock-Windows binaries', () => {
  assert.equal(runnerFor('py', 'win32'), 'py -3');
  assert.equal(runnerFor('ps1', 'win32'), '&');
  assert.equal(runnerFor('js', 'win32'), 'node');
  assert.equal(runnerFor('py', 'linux'), 'python3');
  assert.equal(runnerFor('ps1', 'linux'), 'pwsh');
  assert.equal(runnerFor('xyz', 'win32'), undefined);
  assert.equal(runnerFor('PY', 'win32'), 'py -3');
});

test('taskkill takes the whole tree by pid', () => {
  assert.deepEqual(taskkillArgs(1234), ['/pid', '1234', '/T', '/F']);
});
