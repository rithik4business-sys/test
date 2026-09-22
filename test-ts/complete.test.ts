import { test } from 'node:test';
import assert from 'node:assert/strict';
import { suggestCompletion, tokenizeWords } from '../src/complete';

test('tokenizeWords splits identifiers', () => {
  assert.deepEqual(tokenizeWords('foo bar$2 baz_qux'), ['foo', 'bar$2', 'baz_qux']);
  assert.deepEqual(tokenizeWords('((()))'), []);
});

test('recent identical-prefix line wins', () => {
  const c = suggestCompletion({
    prefix: '  console',
    after: '',
    lines: ['const x = 1;', '  console.log("hi");', '  console'],
    lang: 'typescript',
  });
  assert.ok(c, 'expected a suggestion');
  assert.equal(c!.source, 'recent');
  assert.equal(c!.text, '.log("hi");');
});

test('never echoes the prefix itself or blank suffixes', () => {
  assert.equal(
    suggestCompletion({ prefix: '  x', after: '', lines: ['  x'], lang: 'text' }),
    null,
  );
  assert.equal(suggestCompletion({ prefix: '  ', after: '', lines: ['  y'], lang: 'text' }), null);
  assert.equal(suggestCompletion({ prefix: '', after: '', lines: ['abc'], lang: 'text' }), null);
});

test('snippet triggers per language family', () => {
  const c = suggestCompletion({ prefix: '  if', after: '', lines: [], lang: 'typescript' });
  assert.ok(c && c.source === 'snippet' && c.text === ' (cond) {', JSON.stringify(c));
  const py = suggestCompletion({ prefix: '  for', after: '', lines: [], lang: 'python' });
  assert.ok(py && py.source === 'snippet' && py.text === ' x in xs:', JSON.stringify(py));
  const ps = suggestCompletion({ prefix: '  while', after: '', lines: [], lang: 'powershell' });
  assert.ok(ps && ps.source === 'snippet' && ps.text === ' (cond) {', JSON.stringify(ps));
});

test('token co-occurrence continues from earlier lines', () => {
  const c = suggestCompletion({
    prefix: 'hello wor',
    after: '',
    // 'hello wor' is not a prefix of any line: falls through to ngram on (hello, wor)
    lines: ['say hello world today', 'hello wor'],
    lang: 'text',
  });
  // 'hello wor' IS a prefix of nothing; trailing pair is ('hello','wor')? 'wor' is a
  // word char run, so tokens are ['hello','wor'] — line 0 contains both in order.
  assert.ok(c, 'expected ngram suggestion');
  assert.equal(c!.source, 'ngram');
  assert.ok(c!.text.includes('ld today'), 'got: ' + c!.text);
});

test('unclosed bracket suggests its closer only with empty after', () => {
  const open = suggestCompletion({ prefix: 'function f() {', after: '', lines: [], lang: 'text' });
  assert.ok(open && open.source === 'bracket' && open.text === '}', JSON.stringify(open));
  assert.equal(
    suggestCompletion({ prefix: 'function f() {', after: ' }', lines: [], lang: 'text' }),
    null,
  );
});

test('suggestions are single-line and capped', () => {
  const c = suggestCompletion({
    prefix: '  const myLongVariableNa',
    after: '',
    lines: ['  const myLongVariableName = compute(' + 'x'.repeat(200) + ');'],
    lang: 'typescript',
  });
  assert.ok(c && !c.text.includes('\n') && c.text.length <= 100, JSON.stringify(c)?.slice(0, 120));
});
