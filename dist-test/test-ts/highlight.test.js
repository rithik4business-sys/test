"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const highlight_1 = require("../src/highlight");
const utils_1 = require("../src/utils");
(0, node_test_1.test)('every backend language maps from its extensions', () => {
    const cases = [
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
        strict_1.default.equal((0, utils_1.getLanguageFromExt)(ext), lang, file);
    }
});
(0, node_test_1.test)('html comments highlight, tags highlight', () => {
    const out = (0, highlight_1.highlightLine)('<!-- note -->', 'html');
    strict_1.default.ok(out.includes(highlight_1.ANSI.brightBlack + '<!-- note -->' + highlight_1.ANSI.reset), 'got: ' + out);
    const tag = (0, highlight_1.highlightLine)('<div>', 'html');
    strict_1.default.ok(tag.includes(highlight_1.ANSI.magenta + '<div' + highlight_1.ANSI.reset), 'got: ' + tag);
});
(0, node_test_1.test)('powershell is case-insensitive + block comments + variables', () => {
    for (const kw of ['Function', 'function', 'FOREACH', 'If']) {
        const out = (0, highlight_1.highlightLine)(`${kw} x`, 'powershell');
        strict_1.default.ok(out.includes(highlight_1.ANSI.magenta + kw + highlight_1.ANSI.reset), `${kw} got: ` + out);
    }
    const blk = (0, highlight_1.highlightLine)('<# block #>', 'powershell');
    strict_1.default.ok(blk.includes(highlight_1.ANSI.brightBlack + '<# block #>' + highlight_1.ANSI.reset), 'got: ' + blk);
    const v = (0, highlight_1.highlightLine)('$home', 'powershell');
    strict_1.default.ok(v.includes(highlight_1.ANSI.brightRed + '$home' + highlight_1.ANSI.reset), 'got: ' + v);
});
(0, node_test_1.test)('sql keywords case-insensitive + double-dash comments', () => {
    for (const kw of ['SELECT', 'select']) {
        const out = (0, highlight_1.highlightLine)(`${kw} * FROM t`, 'sql');
        strict_1.default.ok(out.includes(highlight_1.ANSI.magenta + kw + highlight_1.ANSI.reset), `${kw} got: ` + out);
    }
    const c = (0, highlight_1.highlightLine)('SELECT 1 -- trailing', 'sql');
    strict_1.default.ok(c.includes(highlight_1.ANSI.brightBlack + '-- trailing' + highlight_1.ANSI.reset), 'got: ' + c);
});
(0, node_test_1.test)('tsx/jsx // comments still work', () => {
    for (const lang of ['tsx', 'jsx']) {
        const out = (0, highlight_1.highlightLine)('const x = 1 // done', lang);
        strict_1.default.ok(out.includes(highlight_1.ANSI.brightBlack + '// done' + highlight_1.ANSI.reset), `${lang} got: ` + out);
    }
});
(0, node_test_1.test)('yaml # comments highlight', () => {
    const out = (0, highlight_1.highlightLine)('key: v # note', 'yaml');
    strict_1.default.ok(out.includes(highlight_1.ANSI.brightBlack + '# note' + highlight_1.ANSI.reset), 'got: ' + out);
});
(0, node_test_1.test)('graphql keywords highlight', () => {
    const out = (0, highlight_1.highlightLine)('query Foo {', 'graphql');
    strict_1.default.ok(out.includes(highlight_1.ANSI.magenta + 'query' + highlight_1.ANSI.reset), 'got: ' + out);
});
(0, node_test_1.test)('java/c/cpp/csharp/ruby keywords highlight', () => {
    const rows = [
        ['public class A {', 'java'],
        ['#include <x>', 'c'],
        ['namespace n {', 'cpp'],
        ['namespace N {', 'csharp'],
        ['def foo', 'ruby'],
    ];
    for (const [line, lang] of rows) {
        const out = (0, highlight_1.highlightLine)(line, lang);
        strict_1.default.ok((0, highlight_1.stripAnsi)(out) === line, `${lang} round-trips: ` + out);
        strict_1.default.ok(out !== line, `${lang} adds color: ` + out);
    }
});
