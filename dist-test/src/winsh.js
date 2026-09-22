"use strict";
/**
 * Windows/PowerShell hosting helpers (pure — safe to unit test on any OS).
 *
 * The TUI and the /api/exec endpoint both spawn `powershell.exe -Command`
 * on win32. Stock Windows breaks naive spawning three ways, all fixed here:
 *  1. ExecutionPolicy Restricted blocks .ps1 files → -ExecutionPolicy Bypass.
 *  2. PowerShell 5.1 pipes text in the legacy console code page, so UTF-8
 *     output mojibakes → force [Console]::OutputEncoding to UTF-8 up front.
 *  3. sh-style quoting is wrong for PowerShell (backslash is literal, $
 *     needs a backtick, not a backslash) → single-quote literals instead.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.isWindows = isWindows;
exports.psCommandArgs = psCommandArgs;
exports.shellFor = shellFor;
exports.shellQuote = shellQuote;
exports.runnerFor = runnerFor;
exports.taskkillArgs = taskkillArgs;
function isWindows(platform = process.platform) {
    return platform === 'win32';
}
/** argv for `powershell.exe` running one command string. */
function psCommandArgs(cmd) {
    return [
        '-NoProfile',
        '-NonInteractive',
        '-ExecutionPolicy',
        'Bypass',
        '-Command',
        '[Console]::OutputEncoding=[System.Text.UTF8Encoding]::new(); ' + cmd,
    ];
}
/** { cmd, args } pair for spawn(), platform-appropriate. */
function shellFor(platform = process.platform) {
    if (isWindows(platform)) {
        return { cmd: 'powershell.exe', args: (c) => psCommandArgs(c) };
    }
    return { cmd: 'sh', args: (c) => ['-c', c] };
}
/** Quote one argument for the target shell. PowerShell single-quoted
 * strings are literal (only '' escapes) — backslashes, $, backticks
 * and double quotes all pass through untouched. */
function shellQuote(s, platform = process.platform) {
    if (isWindows(platform)) {
        return "'" + String(s).replace(/'/g, "''") + "'";
    }
    return ('"' +
        String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`') +
        '"');
}
const POSIX_RUNNERS = {
    js: 'node', mjs: 'node', cjs: 'node',
    py: 'python3', sh: 'bash', bash: 'bash',
    ps1: 'pwsh', go: 'go run', rb: 'ruby', php: 'php',
};
/** Stock Windows has neither `python3`/`bash` nor (usually) `pwsh`:
 *  `py -3` is the launcher present with every python.org install,
 *  `powershell.exe` (5.1) ships with the OS, and `& 'file.ps1'`
 *  invokes a script path under Bypass policy. */
const WINDOWS_RUNNERS = {
    js: 'node', mjs: 'node', cjs: 'node',
    py: 'py -3', sh: 'bash', bash: 'bash',
    ps1: '&', go: 'go run', rb: 'ruby', php: 'php',
};
/** Runner command prefix for `:run` by file extension. */
function runnerFor(ext, platform = process.platform) {
    const map = isWindows(platform) ? WINDOWS_RUNNERS : POSIX_RUNNERS;
    return map[String(ext || '').toLowerCase()];
}
/** taskkill argv that takes down a whole process tree (Node's signals
 * only reach the direct child on Windows, stranding grandchildren). */
function taskkillArgs(pid) {
    return ['/pid', String(pid), '/T', '/F'];
}
