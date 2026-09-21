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
exports.collectProjectFiles = collectProjectFiles;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const IGNORE_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.vscode', '.idea', '.typewriter']);
const IGNORE_EXACT = new Set(['.DS_Store', 'Thumbs.db']);
const SECRET_FILES = new Set(['.env', '.npmrc']);
const SECRET_EXTS = new Set(['.pem', '.key']);
const MAX_FILE_BYTES = 900 * 1024;
function parseGitignore(dir) {
    const rules = [];
    let raw = '';
    try {
        raw = fs.readFileSync(path.join(dir, '.gitignore'), 'utf-8');
    }
    catch {
        return rules;
    }
    for (const ln of raw.split(/\r?\n/).slice(0, 500)) {
        let line = ln.trim();
        if (!line || line.startsWith('#'))
            continue;
        let neg = false;
        if (line.startsWith('!')) {
            neg = true;
            line = line.slice(1).trim();
        }
        if (!line)
            continue;
        if (line.startsWith('/'))
            line = line.slice(1);
        let dirOnly = false;
        if (line.endsWith('/')) {
            dirOnly = true;
            line = line.slice(0, -1);
        }
        if (!line || line.includes('**'))
            continue;
        rules.push({ neg, dirOnly, base: line });
    }
    return rules;
}
function ruleHits(rule, rel, isDir) {
    const base = rule.base;
    if (base.includes('/')) {
        return rel === base || rel.startsWith(base + '/');
    }
    const parts = rel.split('/');
    const name = parts[parts.length - 1];
    if (base.startsWith('*.') && base.indexOf('*', 1) === -1) {
        const suf = base.slice(1);
        if (!name.endsWith(suf) || name === suf.slice(1))
            return false;
        return true;
    }
    if (rule.dirOnly)
        return isDir && (name === base || parts.includes(base));
    return name === base;
}
function gitIgnored(rules, rel, isDir) {
    let hit = false;
    for (const r of rules) {
        if (ruleHits(r, rel, isDir))
            hit = !r.neg;
    }
    return hit;
}
/**
 * Collect text files for GitHub push. Skips vendored dirs, secrets,
 * binaries, oversize files, and anything matched by .gitignore.
 * Shared by the CLI push and the web push endpoint.
 */
function collectProjectFiles(dir, baseDir, depth = 0) {
    const files = new Map();
    if (depth > 12)
        return files;
    const base = baseDir || dir;
    const rules = depth === 0 ? parseGitignore(base) : [];
    const collected = [];
    const walk = (d, dep) => {
        if (dep > 12)
            return;
        let entries;
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        }
        catch {
            return;
        }
        for (const entry of entries) {
            if (entry.isSymbolicLink())
                continue;
            const fullPath = path.join(d, entry.name);
            const rel = path.relative(base, fullPath).replace(/\\/g, '/');
            if (!rel)
                continue;
            const isDot = entry.name.startsWith('.');
            if (entry.isDirectory()) {
                if (gitIgnored(rules, rel, true))
                    continue;
                if (isDot) {
                    if (entry.name !== '.github')
                        continue;
                }
                else if (IGNORE_DIRS.has(entry.name))
                    continue;
                walk(fullPath, dep + 1);
            }
            else {
                if (IGNORE_EXACT.has(entry.name) || entry.name.toLowerCase().endsWith('.log'))
                    continue;
                if (SECRET_FILES.has(entry.name))
                    continue;
                if (entry.name === '.env.example') { /* allowed */ }
                else if (isDot && entry.name !== '.gitignore')
                    continue;
                const low = entry.name.toLowerCase();
                const dot = low.lastIndexOf('.');
                if (dot >= 0 && SECRET_EXTS.has(low.slice(dot)))
                    continue;
                if (gitIgnored(rules, rel, false))
                    continue;
                try {
                    const raw = fs.readFileSync(fullPath);
                    if (raw.length > MAX_FILE_BYTES)
                        continue;
                    if (raw.slice(0, 8192).includes(0))
                        continue;
                    collected.push({ rel, content: raw.toString('utf-8') });
                }
                catch { /* skip unreadable */ }
            }
        }
    };
    walk(dir, depth);
    collected.sort((a, b) => (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0));
    for (const c of collected)
        files.set(c.rel, c.content);
    return files;
}
