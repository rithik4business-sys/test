import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import * as path from 'node:path';

// Regression guards for the plain-transcript terminal (no card UI, free resize).
const html = fs.readFileSync(
  path.join(__dirname, '..', '..', 'public', 'index.html'),
  'utf-8',
);

test('exec terminal renders no command cards or buttons', () => {
  assert.ok(!html.includes('tblk-head'), 'no card headers');
  assert.ok(!html.includes('tblk-body'), 'no card bodies');
  assert.ok(!html.includes("contains('tblk')"), 'no card host logic in termPrint');
  assert.ok(!html.includes('data-a="copy"'), 'no copy buttons');
  assert.ok(!html.includes('runSeq'), 'no dead block id counter');
});

test('empty command output prints nothing (bash-like)', () => {
  assert.ok(!html.includes("'(no output)'"), 'no (no output) placeholder');
});

test('commands echo as plain prompt lines', () => {
  assert.ok(
    html.includes('function termBlock(cmd)'),
    'termBlock entry kept for call sites',
  );
  assert.ok(html.includes('\\u276f'), 'prompt separator echoed');
  assert.ok(html.includes('exit '), 'nonzero exits leave a plain marker');
});

test('resize sets explicit height (grows and shrinks)', () => {
  assert.ok(html.includes("el.style.height=h+'px'"), 'drag sets height');
  assert.ok(html.includes("el.style.maxHeight=h+'px'"), 'drag sets maxHeight');
  assert.ok(html.includes('__termClamp'), 'stale heights clamped on open');
  assert.ok(html.includes('#termgrip:after'), 'grip handle styled');
});

test('exec failures print the server error, not a bare exit code', () => {
  assert.ok(
    html.includes("if(!r.ok){termPrint(escQ(j.error||('exec failed: HTTP '+r.status)))"),
    'non-OK /api/exec responses surface j.error as plain text',
  );
});

test('pty can never trap input: connect timeout + remembered fallback', () => {
  assert.ok(html.includes('if(!t.ready)fail()'), '3s connect timeout falls back');
  assert.ok(html.includes('var ptyKnownBad=false'), 'availability flag declared');
  assert.ok(
    html.includes('if(activeTerm<0){if(ptyKnownBad)newTerm();else newTermPty();}'),
    'known-bad pty opens exec instantly',
  );
  assert.ok(
    html.includes('ptyKnownBad=false;try{clearTimeout(to);}'),
    'successful ready clears the flag',
  );
});

test('vendor scripts deferred for fast first paint', () => {
  assert.ok(html.includes('<script src="/vendor/xterm.js" defer>'), 'xterm deferred');
  assert.ok(html.includes('<script src="/vendor/fit.js" defer>'), 'fit addon deferred');
});

test('single-tab strip hidden (decluttered header)', () => {
  assert.ok(
    html.includes("el.style.display=terms.length>1?'':'none'"),
    'tab strip only for 2+ terminals',
  );
});

test('github panel states the app-login limit in one line', () => {
  assert.ok(
    html.includes("App logins can't create repos."),
    'condensed app-login note present',
  );
  assert.ok(!html.includes('App login limits.'), 'verbose note retired');
});
