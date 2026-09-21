const { test } = require('node:test');
const assert = require('node:assert/strict');
const { RingBuffer, LinkedStack, CappedBuffer } = require('../dist/structures.js');

test('RingBuffer keeps last N with O(1) push', () => {
  const r = new RingBuffer(3);
  r.push('a'); r.push('b'); r.push('c'); r.push('d');
  assert.equal(r.length, 3);
  assert.deepEqual(r.toArray(), ['b', 'c', 'd']);
  assert.equal(r.at(0), 'b');
  assert.deepEqual(r.sliceLast(2), ['c', 'd']);
  r.clear();
  assert.equal(r.length, 0);
});

test('LinkedStack caps with O(1) eviction, LIFO order', () => {
  const s = new LinkedStack(3);
  s.push(1); s.push(2); s.push(3); s.push(4);
  assert.equal(s.length, 3);
  assert.equal(s.pop(), 4);
  assert.equal(s.pop(), 3);
  assert.equal(s.pop(), 2);
  assert.equal(s.pop(), undefined);
  s.push('x');
  assert.equal(s.peek(), 'x');
  s.clear();
  assert.equal(s.length, 0);
});

test('CappedBuffer drops oldest past byte budget', () => {
  const b = new CappedBuffer(1200);
  b.push('x'.repeat(600));
  b.push('y'.repeat(600));
  b.push('z'.repeat(600));
  assert.ok(b.length <= 1200);
  assert.ok(b.wasTrimmed);
  const s = b.toString('');
  assert.ok(s.endsWith('z'.repeat(10)));
});
