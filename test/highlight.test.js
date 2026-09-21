const { test } = require('node:test');
const assert = require('node:assert/strict');
const { highlightLine, highlightCode, stripAnsi, ANSI } = require('../dist/highlight.js');

test('text language passes through untouched', () => {
  assert.equal(highlightLine('hello world', 'text'), 'hello world');
});

test('empty line returns as-is', () => {
  assert.equal(highlightLine('', 'typescript'), '');
});

test('keyword gets colorized', () => {
  const out = highlightLine('const x = 1', 'typescript');
  assert.ok(out.includes(ANSI.magenta + 'const' + ANSI.reset), 'const should be magenta');
});

test('string gets colorized', () => {
  const out = highlightLine('let s = "hi"', 'javascript');
  assert.ok(out.includes(ANSI.green + '"hi"' + ANSI.reset), 'string should be green');
});

test('line comment swallows rest of line', () => {
  const out = highlightLine('let x = 1 // done', 'typescript');
  assert.ok(out.includes(ANSI.brightBlack + '// done' + ANSI.reset));
});

test('python hash comment', () => {
  const out = highlightLine('x = 1 # note', 'python');
  assert.ok(out.includes('# note'));
  assert.ok(out.includes(ANSI.brightBlack));
});

test('function call detected', () => {
  const out = highlightLine('foo(1)', 'typescript');
  assert.ok(out.includes(ANSI.yellow + 'foo' + ANSI.reset));
});

test('number colorized', () => {
  const out = highlightLine('x = 42', 'typescript');
  assert.ok(out.includes(ANSI.cyan + '42' + ANSI.reset));
});

test('unknown language never crashes', () => {
  assert.doesNotThrow(() => highlightLine('const x = <>&"\'', 'klingon'));
});

test('html in source is preserved through escaping path', () => {
  const out = highlightLine('<div>', 'text');
  assert.equal(out, '<div>');
});

test('stripAnsi removes escape codes', () => {
  assert.equal(stripAnsi(ANSI.red + 'hi' + ANSI.reset), 'hi');
  assert.equal(stripAnsi('plain'), 'plain');
});

test('powershell variable colorized', () => {
  const out = highlightLine('$home', 'powershell');
  assert.ok(out.includes(ANSI.brightRed + '$home' + ANSI.reset));
});

test('functions detected before parens', () => {
  const out = highlightLine('greet()', 'javascript');
  assert.ok(out.includes(ANSI.yellow + 'greet' + ANSI.reset));
});

test('highlightCode joins per-line output', () => {
  const out = highlightCode('const a = 1\nlet b = 2', 'typescript');
  assert.equal(out.split('\n').length, 2);
  assert.ok(out.includes('const'));
});
