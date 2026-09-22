"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const complete_1 = require("../src/complete");
(0, node_test_1.test)('tokenizeWords splits identifiers', () => {
    strict_1.default.deepEqual((0, complete_1.tokenizeWords)('foo bar$2 baz_qux'), ['foo', 'bar$2', 'baz_qux']);
    strict_1.default.deepEqual((0, complete_1.tokenizeWords)('((()))'), []);
});
(0, node_test_1.test)('recent identical-prefix line wins', () => {
    const c = (0, complete_1.suggestCompletion)({
        prefix: '  console',
        after: '',
        lines: ['const x = 1;', '  console.log("hi");', '  console'],
        lang: 'typescript',
    });
    strict_1.default.ok(c, 'expected a suggestion');
    strict_1.default.equal(c.source, 'recent');
    strict_1.default.equal(c.text, '.log("hi");');
});
(0, node_test_1.test)('never echoes the prefix itself or blank suffixes', () => {
    strict_1.default.equal((0, complete_1.suggestCompletion)({ prefix: '  x', after: '', lines: ['  x'], lang: 'text' }), null);
    strict_1.default.equal((0, complete_1.suggestCompletion)({ prefix: '  ', after: '', lines: ['  y'], lang: 'text' }), null);
    strict_1.default.equal((0, complete_1.suggestCompletion)({ prefix: '', after: '', lines: ['abc'], lang: 'text' }), null);
});
(0, node_test_1.test)('snippet triggers per language family', () => {
    const c = (0, complete_1.suggestCompletion)({ prefix: '  if', after: '', lines: [], lang: 'typescript' });
    strict_1.default.ok(c && c.source === 'snippet' && c.text === ' (cond) {', JSON.stringify(c));
    const py = (0, complete_1.suggestCompletion)({ prefix: '  for', after: '', lines: [], lang: 'python' });
    strict_1.default.ok(py && py.source === 'snippet' && py.text === ' x in xs:', JSON.stringify(py));
    const ps = (0, complete_1.suggestCompletion)({ prefix: '  while', after: '', lines: [], lang: 'powershell' });
    strict_1.default.ok(ps && ps.source === 'snippet' && ps.text === ' (cond) {', JSON.stringify(ps));
});
(0, node_test_1.test)('token co-occurrence continues from earlier lines', () => {
    const c = (0, complete_1.suggestCompletion)({
        prefix: 'hello wor',
        after: '',
        // 'hello wor' is not a prefix of any line: falls through to ngram on (hello, wor)
        lines: ['say hello world today', 'hello wor'],
        lang: 'text',
    });
    // 'hello wor' IS a prefix of nothing; trailing pair is ('hello','wor')? 'wor' is a
    // word char run, so tokens are ['hello','wor'] — line 0 contains both in order.
    strict_1.default.ok(c, 'expected ngram suggestion');
    strict_1.default.equal(c.source, 'ngram');
    strict_1.default.ok(c.text.includes('ld today'), 'got: ' + c.text);
});
(0, node_test_1.test)('unclosed bracket suggests its closer only with empty after', () => {
    const open = (0, complete_1.suggestCompletion)({ prefix: 'function f() {', after: '', lines: [], lang: 'text' });
    strict_1.default.ok(open && open.source === 'bracket' && open.text === '}', JSON.stringify(open));
    strict_1.default.equal((0, complete_1.suggestCompletion)({ prefix: 'function f() {', after: ' }', lines: [], lang: 'text' }), null);
});
(0, node_test_1.test)('suggestions are single-line and capped', () => {
    const c = (0, complete_1.suggestCompletion)({
        prefix: '  const myLongVariableNa',
        after: '',
        lines: ['  const myLongVariableName = compute(' + 'x'.repeat(200) + ');'],
        lang: 'typescript',
    });
    strict_1.default.ok(c && !c.text.includes('\n') && c.text.length <= 100, JSON.stringify(c)?.slice(0, 120));
});
