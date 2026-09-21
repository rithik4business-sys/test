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
exports.SESSION_FILE = exports.TOKEN_FILE = exports.CONFIG_FILE = exports.CONFIG_DIR = exports.HOME = void 0;
exports.ensureConfigDir = ensureConfigDir;
exports.loadConfig = loadConfig;
exports.saveConfig = saveConfig;
exports.saveToken = saveToken;
exports.loadToken = loadToken;
exports.clearToken = clearToken;
exports.loadSession = loadSession;
exports.saveSession = saveSession;
exports.scheduleSessionSave = scheduleSessionSave;
exports.flushSession = flushSession;
exports.fileExists = fileExists;
exports.dirExists = dirExists;
exports.readFileSync = readFileSync;
exports.writeFileSync = writeFileSync;
exports.getFileExtension = getFileExtension;
exports.isBinaryFile = isBinaryFile;
exports.getLanguageFromExt = getLanguageFromExt;
exports.getGitHubUsername = getGitHubUsername;
exports.setGitHubUsername = setGitHubUsername;
exports.getSelectedRepo = getSelectedRepo;
exports.setSelectedRepo = setSelectedRepo;
exports.clearGitHubUser = clearGitHubUser;
exports.safePath = safePath;
exports.isHiddenRel = isHiddenRel;
exports.getVersion = getVersion;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const os = __importStar(require("os"));
const crypto = __importStar(require("crypto"));
exports.HOME = os.homedir();
exports.CONFIG_DIR = path.join(exports.HOME, '.typewriter');
exports.CONFIG_FILE = path.join(exports.CONFIG_DIR, 'config.json');
exports.TOKEN_FILE = path.join(exports.CONFIG_DIR, 'token');
exports.SESSION_FILE = path.join(exports.CONFIG_DIR, 'session.json');
function ensureConfigDir() {
    if (!fs.existsSync(exports.CONFIG_DIR)) {
        fs.mkdirSync(exports.CONFIG_DIR, { recursive: true, mode: 0o700 });
        return;
    }
    // Repair permissions on an existing dir (may have been created by an old version).
    try {
        const st = fs.statSync(exports.CONFIG_DIR);
        if ((st.mode & 0o777) !== 0o700)
            fs.chmodSync(exports.CONFIG_DIR, 0o700);
    }
    catch { /* non-fatal */ }
}
/**
 * Atomic write: tmp file in the same directory + fsync + rename.
 * Readers never see a half-written config/token, even on crash/power loss.
 */
function atomicWriteFileSync(file, data, mode) {
    ensureConfigDir();
    const dir = path.dirname(file);
    const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
    const fd = fs.openSync(tmp, 'w', mode);
    try {
        const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
        fs.writeSync(fd, buf, 0, buf.length, null);
        try {
            fs.fsyncSync(fd);
        }
        catch { /* fsync best-effort on odd FS */ }
    }
    finally {
        try {
            fs.closeSync(fd);
        }
        catch { /* noop */ }
    }
    try {
        fs.chmodSync(tmp, mode);
    }
    catch { /* non-fatal */ }
    fs.renameSync(tmp, file);
    try {
        fs.chmodSync(file, mode);
    }
    catch { /* non-fatal */ }
}
// ---- config: in-memory cache + mtime validation (avoids re-parse per call) ----
let _cfgCache = null;
let _cfgMtime = -1;
function readConfigFile() {
    ensureConfigDir();
    if (!fs.existsSync(exports.CONFIG_FILE))
        return { cfg: {}, mtime: -1 };
    try {
        const st = fs.statSync(exports.CONFIG_FILE);
        const raw = fs.readFileSync(exports.CONFIG_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const cfg = parsed && typeof parsed === 'object' ? parsed : {};
        return { cfg, mtime: st.mtimeMs };
    }
    catch {
        return { cfg: {}, mtime: -1 };
    }
}
function loadConfig() {
    try {
        const mtime = fs.existsSync(exports.CONFIG_FILE) ? fs.statSync(exports.CONFIG_FILE).mtimeMs : -1;
        if (_cfgCache !== null && mtime === _cfgMtime)
            return { ..._cfgCache };
    }
    catch { /* fall through to read */ }
    const { cfg, mtime } = readConfigFile();
    _cfgCache = cfg;
    _cfgMtime = mtime;
    return { ...cfg };
}
function saveConfig(config) {
    const clean = {};
    if (typeof config.lastProject === 'string')
        clean.lastProject = config.lastProject.slice(0, 500);
    if (typeof config.theme === 'string')
        clean.theme = config.theme.slice(0, 50);
    if (Number.isFinite(config.fontSize))
        clean.fontSize = config.fontSize;
    if (typeof config.mouse === 'boolean')
        clean.mouse = config.mouse;
    if (typeof config.githubUsername === 'string')
        clean.githubUsername = config.githubUsername.slice(0, 100);
    if (typeof config.githubRepo === 'string')
        clean.githubRepo = config.githubRepo.slice(0, 200);
    atomicWriteFileSync(exports.CONFIG_FILE, JSON.stringify(clean, null, 2), 0o600);
    try {
        _cfgMtime = fs.statSync(exports.CONFIG_FILE).mtimeMs;
    }
    catch {
        _cfgMtime = Date.now();
    }
    _cfgCache = { ...clean };
}
// ---- token: cached, permission-repaired, never logged ----
let _tokenCache = null;
function tokenStat() {
    try {
        const st = fs.statSync(exports.TOKEN_FILE);
        return { mtime: st.mtimeMs, missing: false };
    }
    catch {
        return { mtime: -1, missing: true };
    }
}
function saveToken(token) {
    const t = String(token || '').trim();
    if (!t)
        throw new Error('refusing to save empty token');
    if (t.length > 500)
        throw new Error('token too long');
    atomicWriteFileSync(exports.TOKEN_FILE, t, 0o600);
    const { mtime } = tokenStat();
    _tokenCache = { value: t, mtime, missing: false };
}
function loadToken() {
    const { mtime, missing } = tokenStat();
    if (_tokenCache && _tokenCache.mtime === mtime && _tokenCache.missing === missing) {
        return _tokenCache.value;
    }
    if (missing) {
        _tokenCache = { value: null, mtime, missing: true };
        return null;
    }
    // Repair world/group-readable token files left by older versions.
    try {
        const mode = fs.statSync(exports.TOKEN_FILE).mode & 0o777;
        if (mode !== 0o600)
            fs.chmodSync(exports.TOKEN_FILE, 0o600);
    }
    catch { /* non-fatal */ }
    let t = '';
    try {
        t = fs.readFileSync(exports.TOKEN_FILE, 'utf-8').trim();
    }
    catch {
        _tokenCache = { value: null, mtime, missing: false };
        return null;
    }
    const value = t ? t : null;
    _tokenCache = { value, mtime, missing: false };
    return value;
}
function clearToken() {
    _tokenCache = { value: null, mtime: -1, missing: true };
    if (!fs.existsSync(exports.TOKEN_FILE))
        return;
    // Overwrite before unlink so the secret isn't left in freed blocks.
    try {
        const st = fs.statSync(exports.TOKEN_FILE);
        const fd = fs.openSync(exports.TOKEN_FILE, 'r+');
        try {
            const zeros = Buffer.alloc(Math.min(st.size, 4096), 0);
            let off = 0;
            while (off < st.size) {
                const n = Math.min(zeros.length, st.size - off);
                fs.writeSync(fd, zeros, 0, n, off);
                off += n;
            }
            try {
                fs.fsyncSync(fd);
            }
            catch { /* noop */ }
        }
        finally {
            try {
                fs.closeSync(fd);
            }
            catch { /* noop */ }
        }
    }
    catch { /* fall through to unlink */ }
    try {
        fs.unlinkSync(exports.TOKEN_FILE);
    }
    catch { /* noop */ }
}
// ---- session state: preserved UI prefs, debounced + atomic ----
let _sessionCache = null;
let _sessionMtime = -1;
let _sessionTimer = null;
function loadSession() {
    try {
        const mtime = fs.existsSync(exports.SESSION_FILE) ? fs.statSync(exports.SESSION_FILE).mtimeMs : -1;
        if (_sessionCache !== null && mtime === _sessionMtime)
            return { ..._sessionCache };
    }
    catch { /* fall through */ }
    let s = {};
    let mtime = -1;
    try {
        if (fs.existsSync(exports.SESSION_FILE)) {
            const st = fs.statSync(exports.SESSION_FILE);
            mtime = st.mtimeMs;
            const parsed = JSON.parse(fs.readFileSync(exports.SESSION_FILE, 'utf-8'));
            if (parsed && typeof parsed === 'object')
                s = parsed;
        }
    }
    catch {
        s = {};
    }
    _sessionCache = { ...s };
    _sessionMtime = mtime;
    return { ...s };
}
function writeSessionNow(s) {
    const clean = {};
    if (typeof s.theme === 'string')
        clean.theme = s.theme.slice(0, 50);
    if (Number.isFinite(s.termHeight))
        clean.termHeight = Math.max(4, Math.min(60, s.termHeight));
    if (typeof s.termMaxed === 'boolean')
        clean.termMaxed = s.termMaxed;
    if (typeof s.treeVisible === 'boolean')
        clean.treeVisible = s.treeVisible;
    if (typeof s.lastFile === 'string')
        clean.lastFile = s.lastFile.slice(0, 1000);
    else if (s.lastFile === null)
        clean.lastFile = null;
    if (typeof s.lastProject === 'string')
        clean.lastProject = s.lastProject.slice(0, 500);
    clean.updatedAt = Date.now();
    atomicWriteFileSync(exports.SESSION_FILE, JSON.stringify(clean), 0o600);
    try {
        _sessionMtime = fs.statSync(exports.SESSION_FILE).mtimeMs;
    }
    catch {
        _sessionMtime = Date.now();
    }
    _sessionCache = { ...clean };
}
function saveSession(s) {
    writeSessionNow(s);
}
/** Merge partial state and persist (debounced to coalesce rapid UI changes). */
function scheduleSessionSave(patch, delayMs = 500) {
    const cur = loadSession();
    _sessionCache = { ...cur, ...patch };
    if (_sessionTimer)
        clearTimeout(_sessionTimer);
    _sessionTimer = setTimeout(() => {
        _sessionTimer = null;
        try {
            writeSessionNow(_sessionCache || {});
        }
        catch { /* non-fatal */ }
    }, Math.max(0, delayMs));
    if (_sessionTimer.unref)
        _sessionTimer.unref();
}
/** Flush any pending debounced session write (call on quit). */
function flushSession() {
    if (_sessionTimer) {
        clearTimeout(_sessionTimer);
        _sessionTimer = null;
        try {
            writeSessionNow(_sessionCache || loadSession());
        }
        catch { /* noop */ }
    }
}
function fileExists(filePath) {
    try {
        return fs.statSync(filePath).isFile();
    }
    catch {
        return false;
    }
}
function dirExists(dirPath) {
    try {
        return fs.statSync(dirPath).isDirectory();
    }
    catch {
        return false;
    }
}
function readFileSync(filePath) {
    return fs.readFileSync(filePath, 'utf-8');
}
function writeFileSync(filePath, content) {
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(filePath, content, 'utf-8');
}
function getFileExtension(filename) {
    const base = path.basename(filename).toLowerCase();
    if (base === 'dockerfile' || base.startsWith('dockerfile.'))
        return 'dockerfile';
    const ext = path.extname(base).toLowerCase();
    return ext.startsWith('.') ? ext.slice(1) : '';
}
/** Check if a file is likely binary by reading the first 8KB and looking for null bytes. */
function isBinaryFile(filePath) {
    let fd = -1;
    try {
        fd = fs.openSync(filePath, 'r');
        const buf = Buffer.alloc(8192);
        const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
        for (let i = 0; i < bytesRead; i++) {
            if (buf[i] === 0)
                return true;
        }
        return false;
    }
    catch {
        return true; // treat unreadable as binary
    }
    finally {
        if (fd >= 0) {
            try {
                fs.closeSync(fd);
            }
            catch { /* noop */ }
        }
    }
}
const EXT_MAP = {
    ts: 'typescript', tsx: 'typescript', js: 'javascript', jsx: 'javascript',
    py: 'python', rb: 'ruby', go: 'go', rs: 'rust', java: 'java',
    c: 'c', cpp: 'cpp', h: 'c', hpp: 'cpp', cs: 'csharp',
    html: 'html', htm: 'html', css: 'css', scss: 'scss', less: 'less',
    json: 'json', yaml: 'yaml', yml: 'yaml', xml: 'xml',
    md: 'markdown', txt: 'text', sh: 'bash', bash: 'bash',
    ps1: 'powershell', psd1: 'powershell', psm1: 'powershell',
    sql: 'sql', graphql: 'graphql', gql: 'graphql',
    dockerfile: 'dockerfile', toml: 'toml', ini: 'ini',
};
function getLanguageFromExt(ext) {
    return EXT_MAP[ext] || 'text';
}
function getGitHubUsername() {
    return loadConfig().githubUsername || null;
}
function setGitHubUsername(username) {
    const config = loadConfig();
    config.githubUsername = username;
    saveConfig(config);
}
function getSelectedRepo() {
    return loadConfig().githubRepo || null;
}
function setSelectedRepo(fullName) {
    const config = loadConfig();
    if (fullName)
        config.githubRepo = fullName;
    else
        delete config.githubRepo;
    saveConfig(config);
}
function clearGitHubUser() {
    const config = loadConfig();
    delete config.githubUsername;
    saveConfig(config);
}
/**
 * Sanitize and validate a user-supplied path against a base directory.
 * Returns the resolved absolute path if safe, or null if it escapes the base.
 */
function safePath(base, target) {
    if (target.includes('\0'))
        return null;
    const cleaned = target.replace(/^\/+/, '');
    let decoded;
    try {
        decoded = decodeURIComponent(cleaned);
    }
    catch {
        return null;
    }
    if (decoded.includes('\0'))
        return null;
    const p = path.resolve(base, decoded);
    const baseResolved = path.resolve(base);
    if (p === baseResolved || p.startsWith(baseResolved + path.sep)) {
        return p;
    }
    return null;
}
/** True if a ROOT-relative posix path touches a hidden file/dir, except allowlisted names. */
function isHiddenRel(relPosix) {
    if (!relPosix)
        return false;
    return relPosix.split('/').some((p) => {
        if (!p.startsWith('.'))
            return false;
        return p !== '.gitignore' && p !== '.env.example';
    });
}
let _verCache = null;
/** Get the current package version from package.json (cached). */
function getVersion() {
    if (_verCache !== null)
        return _verCache;
    try {
        const pkgPath = path.join(__dirname, '..', 'package.json');
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        _verCache = pkg.version || '0.0.0';
    }
    catch {
        _verCache = '0.0.0';
    }
    return _verCache || '0.0.0';
}
