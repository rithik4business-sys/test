import { test } from 'node:test';
import assert from 'node:assert/strict';
import { highlightLine, stripAnsi, ANSI } from '../src/highlight';
import { getLanguageFromExt } from '../src/utils';

test('every backend language maps from its extensions', () => {
  const cases: Array<[string, string]> = [
    ['x.html', 'html'], ['x.htm', 'html'],
    ['x.ps1', 'powershell'], ['x.psm1', 'powershell'], ['x.psd1', 'powershell'],
    ['x.sql', 'sql'], ['x.graphql', 'graphql'], ['x.gql', 'graphql'],
    ['x.java', 'java'], ['x.c', 'c'], ['x.cpp', 'cpp'], ['x.cs', 'csharp'],
    ['x.rb', 'ruby'], ['x.yml', 'yaml'], ['x.yaml', 'yaml'],
    ['x.tsx', 'typescript'], ['x.jsx', 'javascript'],
    ['x.scss', 'scss'], ['x.less', 'less'], ['x.xml', 'xml'],
    ['x.toml', 'toml'], ['x.ini', 'ini'], ['x.md', 'markdown'],
    ['Dockerfile', 'dockerfile'],
  ];
  for (const [file, lang] of cases) {
    const base = file.toLowerCase();
    const ext = base === 'dockerfile' ? 'dockerfile' : base.split('.').pop() || '';
    assert.equal(getLanguageFromExt(ext), lang, file);
  }
});

test('html comments highlight, tags highlight', () => {
  const out = highlightLine('<!-- note -->', 'html');
  assert.ok(out.includes(ANSI.brightBlack + '<!-- note -->' + ANSI.reset), 'got: ' + out);
  const tag = highlightLine('<div>', 'html');
  assert.ok(tag.includes(ANSI.magenta + '<div' + ANSI.reset), 'got: ' + tag);
});

test('powershell is case-insensitive + block comments + variables', () => {
  for (const kw of ['Function', 'function', 'FOREACH', 'If']) {
    const out = highlightLine(`${kw} x`, 'powershell');
    assert.ok(out.includes(ANSI.magenta + kw + ANSI.reset), `${kw} got: ` + out);
  }
  const blk = highlightLine('<# block #>', 'powershell');
  assert.ok(blk.includes(ANSI.brightBlack + '<# block #>' + ANSI.reset), 'got: ' + blk);
  const v = highlightLine('$home', 'powershell');
  assert.ok(v.includes(ANSI.brightRed + '$home' + ANSI.reset), 'got: ' + v);
});

test('sql keywords case-insensitive + double-dash comments', () => {
  for (const kw of ['SELECT', 'select']) {
    const out = highlightLine(`${kw} * FROM t`, 'sql');
    assert.ok(out.includes(ANSI.magenta + kw + ANSI.reset), `${kw} got: ` + out);
  }
  const c = highlightLine('SELECT 1 -- trailing', 'sql');
  assert.ok(c.includes(ANSI.brightBlack + '-- trailing' + ANSI.reset), 'got: ' + c);
});

test('tsx/jsx // comments still work', () => {
  for (const lang of ['tsx', 'jsx']) {
    const out = highlightLine('const x = 1 // done', lang);
    assert.ok(out.includes(ANSI.brightBlack + '// done' + ANSI.reset), `${lang} got: ` + out);
  }
});

test('yaml # comments highlight', () => {
  const out = highlightLine('key: v # note', 'yaml');
  assert.ok(out.includes(ANSI.brightBlack + '# note' + ANSI.reset), 'got: ' + out);
});

test('graphql keywords highlight', () => {
  const out = highlightLine('query Foo {', 'graphql');
  assert.ok(out.includes(ANSI.magenta + 'query' + ANSI.reset), 'got: ' + out);
});

test('java/c/cpp/csharp/ruby keywords highlight', () => {
  const rows: Array<[string, string]> = [
    ['public class A {', 'java'],
    ['#include <x>', 'c'],
    ['namespace n {', 'cpp'],
    ['namespace N {', 'csharp'],
    ['def foo', 'ruby'],
  ];
  for (const [line, lang] of rows) {
    const out = highlightLine(line, lang);
    assert.ok(stripAnsi(out) === line, `${lang} round-trips: ` + out);
    assert.ok(out !== line, `${lang} adds color: ` + out);
  }
});
