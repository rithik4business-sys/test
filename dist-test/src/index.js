#!/usr/bin/env node
"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const readline = __importStar(require("readline"));
const path = __importStar(require("path"));
const editor_1 = require("./editor");
const collect_1 = require("./collect");
const github_1 = require("./github");
const utils_1 = require("./utils");
function ask(question) {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    return new Promise((resolve, reject) => {
        const onSigint = () => {
            rl.close();
            reject(new Error('aborted'));
        };
        process.once('SIGINT', onSigint);
        rl.question(question, (answer) => {
            process.removeListener('SIGINT', onSigint);
            rl.close();
            resolve(answer.trim());
        });
    });
}
function printBanner() {
    const version = (0, utils_1.getVersion)();
    console.log(`
\x1b[36m╔══════════════════════════════════════════════════════════════╗
║                                                              ║
║   ████████╗██╗   ██╗██████╗ ███████╗                          ║
║   ╚══██╔══╝╚██╗ ██╔╝██╔══██╗██╔════╝                          ║
║      ██║    ╚████╔╝ ██████╔╝█████╗                            ║
║      ██║     ╚██╔╝  ██╔═══╝ ██╔══╝                            ║
║      ██║      ██║   ██║     ███████╗                          ║
║      ╚═╝      ╚═╝   ╚═╝     ╚══════╝                          ║
║                                                              ║
║   A GitHub-Connected Terminal Code Editor                    ║
║   Version ${version.padEnd(30)}                      ║
║                                                              ║
╚══════════════════════════════════════════════════════════════╝\x1b[0m
`);
}
function printHelp() {
    console.log(`
\x1b[33mUsage:\x1b[0m
  typewriter [options] [file]

\x1b[33mOptions:\x1b[0m
  --login       Login to GitHub
  --logout      Logout from GitHub
  --status      Show login status
  --push        Push current project to GitHub
  --serve       Start local web preview (port 3000)
  --port=N      Web preview port (with --serve, default 3000)
  --host=ADDR   Web preview bind address (default 127.0.0.1)
  --theme <name>  Set editor theme (opencode theme set)
  --themes        List available themes
  --help        Show this help message
  --version     Show version

\x1b[33mExamples:\x1b[0m
  typewriter                    Start with empty editor
  typewriter file.ts            Open file.ts
  typewriter --login            Login to GitHub
  typewriter --push             Push project to GitHub
  typewriter --serve             Web preview on http://127.0.0.1:3000
  typewriter --serve --port=8080 Web preview on a custom port
  typewriter --themes           List themes
  typewriter --theme nord       Set default theme
`);
}
function sanitizeRepoName(name) {
    const clean = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
    return clean || 'typewriter-project';
}
async function loginToGitHub() {
    try {
        console.log('\n\x1b[36mGitHub Authentication\x1b[0m\n');
        await (0, github_1.authenticate)();
        console.log(`\n\x1b[32mSuccessfully logged in as ${(0, github_1.getUsername)()}\x1b[0m\n`);
    }
    catch (err) {
        console.error(`\n\x1b[31mLogin failed: ${err.message}\x1b[0m\n`);
    }
}
async function pushToGitHub() {
    if (!(0, github_1.isLoggedIn)()) {
        console.log('\n\x1b[33mNot logged in. Run: typewriter --login\x1b[0m\n');
        return;
    }
    const token = (0, github_1.loadToken)();
    const username = (0, github_1.getUsername)();
    if (!token || !username) {
        console.log('\n\x1b[31mAuth error. Run --logout then --login.\x1b[0m\n');
        return;
    }
    const projectDir = process.cwd();
    const projectName = sanitizeRepoName(path.basename(projectDir));
    console.log(`\n\x1b[36mPushing project to GitHub...\x1b[0m`);
    console.log(`   Project: ${projectName}\n`);
    try {
        const files = (0, collect_1.collectProjectFiles)(projectDir);
        if (files.size === 0) {
            console.log('\x1b[33mNo files found to push\x1b[0m\n');
            return;
        }
        console.log(`   Found ${files.size} files`);
        let repo = await (0, github_1.getRepo)(token, username, projectName);
        if (!repo) {
            console.log('   Creating new repository...');
            let ans;
            try {
                ans = await ask('   Make repository private? (y/N): ');
            }
            catch {
                console.log('\n\x1b[33mAborted — no repository created.\x1b[0m\n');
                process.exitCode = 130;
                return;
            }
            repo = await (0, github_1.createRepo)(token, projectName, 'Created with TypeWriter', ans.toLowerCase() === 'y');
            console.log(`   Created: ${repo.html_url}`);
        }
        const branch = await (0, github_1.pushFiles)(token, username, projectName, files, 'Update from TypeWriter');
        console.log(`\n\x1b[32mPushed to ${repo.html_url}/tree/${branch}\x1b[0m\n`);
    }
    catch (err) {
        console.error(`\n\x1b[31mPush failed: ${(err instanceof Error ? err.message : String(err))}\x1b[0m\n`);
        process.exitCode = 1;
    }
}
async function showStatus() {
    console.log((0, github_1.isLoggedIn)() ? `\n\x1b[32mLogged in as ${(0, github_1.getUsername)()}\x1b[0m\n` : '\n\x1b[33mNot logged in\x1b[0m\n');
}
async function main() {
    (0, utils_1.ensureConfigDir)();
    const args = process.argv.slice(2);
    if (args.includes('--help') || args.includes('-h')) {
        printBanner();
        printHelp();
        return;
    }
    if (args.includes('--version') || args.includes('-v')) {
        console.log(`typewriter v${(0, utils_1.getVersion)()}`);
        return;
    }
    if (args.includes('--login')) {
        printBanner();
        await loginToGitHub();
        return;
    }
    if (args.includes('--logout')) {
        printBanner();
        (0, github_1.logout)();
        console.log('\n\x1b[32mLogged out successfully\x1b[0m\n');
        return;
    }
    if (args.includes('--status')) {
        printBanner();
        await showStatus();
        return;
    }
    if (args.includes('--push')) {
        printBanner();
        await pushToGitHub();
        return;
    }
    if (args.includes('--serve')) {
        const { startServer } = await Promise.resolve().then(() => __importStar(require('./server')));
        const portArg = args.find(a => a.startsWith('--port='));
        const hostArg = args.find(a => a.startsWith('--host='));
        const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
        const host = hostArg ? hostArg.split('=')[1] : (process.env.HOST || '127.0.0.1');
        await startServer(Number.isFinite(port) ? port : 3000, host);
        return;
    }
    if (args.includes('--themes') || args.includes('--list-themes')) {
        const { THEME_NAMES } = await Promise.resolve().then(() => __importStar(require('./themes')));
        console.log('\nAvailable themes (opencode set):\n');
        console.log('  ' + THEME_NAMES.join(', ') + '\n');
        return;
    }
    const themeIdx = args.findIndex(a => a === '--theme' || a.startsWith('--theme='));
    if (themeIdx >= 0) {
        const raw = args[themeIdx];
        const name = raw.includes('=') ? raw.split('=').slice(1).join('=') : args[themeIdx + 1];
        const { isThemeName, THEME_NAMES } = await Promise.resolve().then(() => __importStar(require('./themes')));
        const { loadConfig, saveConfig } = await Promise.resolve().then(() => __importStar(require('./utils')));
        if (!name || name.startsWith('-') || !isThemeName(name)) {
            console.error(name ? `\nUnknown theme: ${name}\n` : '\nMissing value: --theme <name>\n');
            console.log('Available themes:\n  ' + THEME_NAMES.join(', ') + '\n');
            process.exit(1);
        }
        const cfg = loadConfig();
        cfg.theme = name;
        saveConfig(cfg);
        try {
            const { setTheme } = await Promise.resolve().then(() => __importStar(require('./editor')));
            setTheme(name);
        }
        catch { /* config persisted anyway */ }
        const rest = args.filter((_, i) => i !== themeIdx && !(raw === '--theme' && i === themeIdx + 1));
        const fileArgAfter = rest.find(arg => !arg.startsWith('-') && arg !== '--serve' && arg !== '--themes');
        if (fileArgAfter) {
            console.log(`Theme set to ${name} — opening ${fileArgAfter}\n`);
            (0, editor_1.startEditor)(fileArgAfter);
        }
        else {
            console.log(`Theme set to ${name} (persisted)\n`);
        }
        return;
    }
    const fileArg = args.find(arg => !arg.startsWith('-'));
    (0, editor_1.startEditor)(fileArg);
}
main().catch((e) => { console.error(e); process.exit(1); });
