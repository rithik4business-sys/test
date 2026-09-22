#!/usr/bin/env node

import * as readline from 'readline';
import * as fs from 'fs';
import * as path from 'path';
import { startEditor } from './editor';
import { collectProjectFiles } from './collect';
import { authenticate, createRepo, getRepo, pushFiles, isLoggedIn, logout, getUsername, loadToken } from './github';
import { ensureConfigDir, getVersion, isBinaryFile } from './utils';

function ask(question: string): Promise<string> {
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

function printBanner(): void {
  const version = getVersion();
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

function printHelp(): void {
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

function sanitizeRepoName(name: string): string {
  const clean = name.replace(/[^a-zA-Z0-9._-]+/g, '-').replace(/^[-.]+|[-.]+$/g, '').slice(0, 100);
  return clean || 'typewriter-project';
}

async function loginToGitHub(): Promise<void> {
  try {
    console.log('\n\x1b[36mGitHub Authentication\x1b[0m\n');
    await authenticate();
    console.log(`\n\x1b[32mSuccessfully logged in as ${getUsername()}\x1b[0m\n`);
  } catch (err) {
    console.error(`\n\x1b[31mLogin failed: ${(err as Error).message}\x1b[0m\n`);
  }
}

async function pushToGitHub(): Promise<void> {
  if (!isLoggedIn()) {
    console.log('\n\x1b[33mNot logged in. Run: typewriter --login\x1b[0m\n');
    return;
  }
  const token = loadToken();
  const username = getUsername();
  if (!token || !username) {
    console.log('\n\x1b[31mAuth error. Run --logout then --login.\x1b[0m\n');
    return;
  }
  const projectDir = process.cwd();
  const projectName = sanitizeRepoName(path.basename(projectDir));
  console.log(`\n\x1b[36mPushing project to GitHub...\x1b[0m`);
  console.log(`   Project: ${projectName}\n`);
  try {
    const files = collectProjectFiles(projectDir);
    if (files.size === 0) {
      console.log('\x1b[33mNo files found to push\x1b[0m\n');
      return;
    }
    console.log(`   Found ${files.size} files`);
    let repo = await getRepo(token, username, projectName);
    if (!repo) {
      console.log('   Creating new repository...');
      let ans: string;
      try {
        ans = await ask('   Make repository private? (y/N): ');
      } catch {
        console.log('\n\x1b[33mAborted — no repository created.\x1b[0m\n');
        process.exitCode = 130;
        return;
      }
      repo = await createRepo(token, projectName, 'Created with TypeWriter', ans.toLowerCase() === 'y');
      console.log(`   Created: ${repo.html_url}`);
    }
    const branch = await pushFiles(token, username, projectName, files, 'Update from TypeWriter');
    console.log(`\n\x1b[32mPushed to ${repo.html_url}/tree/${branch}\x1b[0m\n`);
  } catch (err) {
    console.error(`\n\x1b[31mPush failed: ${(err instanceof Error ? err.message : String(err))}\x1b[0m\n`);
    process.exitCode = 1;
  }
}

async function showStatus(): Promise<void> {
  console.log(isLoggedIn() ? `\n\x1b[32mLogged in as ${getUsername()}\x1b[0m\n` : '\n\x1b[33mNot logged in\x1b[0m\n');
}

async function main(): Promise<void> {
  ensureConfigDir();
  const args = process.argv.slice(2);

  if (args.includes('--help') || args.includes('-h')) {
    printBanner();
    printHelp();
    return;
  }
  if (args.includes('--version') || args.includes('-v')) {
    console.log(`typewriter v${getVersion()}`);
    return;
  }
  if (args.includes('--login')) {
    printBanner();
    await loginToGitHub();
    return;
  }
  if (args.includes('--logout')) {
    printBanner();
    logout();
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
    const { startServer } = await import('./server');
    const portArg = args.find(a => a.startsWith('--port='));
    const hostArg = args.find(a => a.startsWith('--host='));
    const port = portArg ? parseInt(portArg.split('=')[1], 10) : 3000;
    const host = hostArg ? hostArg.split('=')[1] : (process.env.HOST || '127.0.0.1');
    await startServer(Number.isFinite(port) ? port : 3000, host);
    return;
  }
  if (args.includes('--themes') || args.includes('--list-themes')) {
    const { THEME_NAMES } = await import('./themes');
    console.log('\nAvailable themes (opencode set):\n');
    console.log('  ' + THEME_NAMES.join(', ') + '\n');
    return;
  }
  const themeIdx = args.findIndex(a => a === '--theme' || a.startsWith('--theme='));
  if (themeIdx >= 0) {
    const raw = args[themeIdx];
    const name = raw.includes('=') ? raw.split('=').slice(1).join('=') : args[themeIdx + 1];
    const { isThemeName, THEME_NAMES } = await import('./themes');
    const { loadConfig, saveConfig } = await import('./utils');
    if (!name || name.startsWith('-') || !isThemeName(name)) {
      console.error(name ? `\nUnknown theme: ${name}\n` : '\nMissing value: --theme <name>\n');
      console.log('Available themes:\n  ' + THEME_NAMES.join(', ') + '\n');
      process.exit(1);
    }
    const cfg = loadConfig();
    cfg.theme = name;
    saveConfig(cfg);
    try {
      const { setTheme } = await import('./editor');
      setTheme(name);
    } catch { /* config persisted anyway */ }
    const rest = args.filter((_, i) => i !== themeIdx && !(raw === '--theme' && i === themeIdx + 1));
    const fileArgAfter = rest.find(arg => !arg.startsWith('-') && arg !== '--serve' && arg !== '--themes');
    if (fileArgAfter) {
      console.log(`Theme set to ${name} — opening ${fileArgAfter}\n`);
      startEditor(fileArgAfter);
    } else {
      console.log(`Theme set to ${name} (persisted)\n`);
    }
    return;
  }

  const fileArg = args.find(arg => !arg.startsWith('-'));
  startEditor(fileArg);
}

main().catch((e) => { console.error(e); process.exit(1); });
