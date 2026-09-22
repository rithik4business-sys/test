"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const winsh_1 = require("../src/winsh");
(0, node_test_1.test)('platform detection', () => {
    strict_1.default.equal((0, winsh_1.isWindows)('win32'), true);
    strict_1.default.equal((0, winsh_1.isWindows)('linux'), false);
    strict_1.default.equal((0, winsh_1.isWindows)('darwin'), false);
});
(0, node_test_1.test)('powershell argv: Bypass policy + UTF-8 output + command', () => {
    const a = (0, winsh_1.psCommandArgs)('Get-ChildItem');
    strict_1.default.ok(a.includes('powershell.exe') === false, 'no exe in argv');
    strict_1.default.ok(a.includes('Bypass'), 'Restricted policy bypassed for scripts');
    const cmd = a[a.length - 1];
    strict_1.default.ok(cmd.includes('OutputEncoding'), 'UTF-8 output forced (no mojibake)');
    strict_1.default.ok(cmd.endsWith('Get-ChildItem'), 'user command appended, got: ' + cmd);
});
(0, node_test_1.test)('shellFor picks powershell on win32, sh elsewhere', () => {
    const w = (0, winsh_1.shellFor)('win32');
    strict_1.default.equal(w.cmd, 'powershell.exe');
    strict_1.default.ok(w.args('echo hi').includes('Bypass'));
    const p = (0, winsh_1.shellFor)('linux');
    strict_1.default.equal(p.cmd, 'sh');
    strict_1.default.deepEqual(p.args('echo hi'), ['-c', 'echo hi']);
});
(0, node_test_1.test)('shellQuote: PowerShell single-quote literals', () => {
    strict_1.default.equal((0, winsh_1.shellQuote)('hello world', 'win32'), "'hello world'");
    // backslashes, $, backticks, double quotes pass through untouched
    strict_1.default.equal((0, winsh_1.shellQuote)('C:\\proj\\my $file`v".ps1', 'win32'), "'C:\\proj\\my $file`v\".ps1'");
    strict_1.default.equal((0, winsh_1.shellQuote)("it's", 'win32'), "'it''s'");
});
(0, node_test_1.test)('shellQuote: sh double-quote escaping preserved', () => {
    strict_1.default.equal((0, winsh_1.shellQuote)('a"b$c`d\\e', 'linux'), '"a\\"b\\$c\\`d\\\\e"');
});
(0, node_test_1.test)('runnerFor: stock-Windows binaries', () => {
    strict_1.default.equal((0, winsh_1.runnerFor)('py', 'win32'), 'py -3');
    strict_1.default.equal((0, winsh_1.runnerFor)('ps1', 'win32'), '&');
    strict_1.default.equal((0, winsh_1.runnerFor)('js', 'win32'), 'node');
    strict_1.default.equal((0, winsh_1.runnerFor)('py', 'linux'), 'python3');
    strict_1.default.equal((0, winsh_1.runnerFor)('ps1', 'linux'), 'pwsh');
    strict_1.default.equal((0, winsh_1.runnerFor)('xyz', 'win32'), undefined);
    strict_1.default.equal((0, winsh_1.runnerFor)('PY', 'win32'), 'py -3');
});
(0, node_test_1.test)('taskkill takes the whole tree by pid', () => {
    strict_1.default.deepEqual((0, winsh_1.taskkillArgs)(1234), ['/pid', '1234', '/T', '/F']);
});
