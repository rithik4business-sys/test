import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

export const HOME = os.homedir();
export const CONFIG_DIR = path.join(HOME, '.typewriter');
export const CONFIG_FILE = path.join(CONFIG_DIR, 'config.json');
export const TOKEN_FILE = path.join(CONFIG_DIR, 'token');
export const SESSION_FILE = path.join(CONFIG_DIR, 'session.json');

export interface Config {
  lastProject?: string;
  theme?: string;
  fontSize?: number;
  mouse?: boolean;
  githubUsername?: string;
  githubRepo?: string;
}

/** UI/session state preserved across restarts (cached in memory, atomic on disk). */
export interface SessionState {
  theme?: string;
  termHeight?: number;
  termMaxed?: boolean;
  treeVisible?: boolean;
  lastFile?: string | null;
  lastProject?: string;
  updatedAt?: number;
}

export function ensureConfigDir(): void {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    return;
  }
  // Repair permissions on an existing dir (may have been created by an old version).
  try {
    const st = fs.statSync(CONFIG_DIR);
    if ((st.mode & 0o777) !== 0o700) fs.chmodSync(CONFIG_DIR, 0o700);
  } catch { /* non-fatal */ }
}

/**
 * Atomic write: tmp file in the same directory + fsync + rename.
 * Readers never see a half-written config/token, even on crash/power loss.
 */
function atomicWriteFileSync(file: string, data: string | Buffer, mode: number): void {
  ensureConfigDir();
  const dir = path.dirname(file);
  const tmp = path.join(dir, `.tmp-${process.pid}-${crypto.randomBytes(4).toString('hex')}`);
  const fd = fs.openSync(tmp, 'w', mode);
  try {
    const buf = typeof data === 'string' ? Buffer.from(data, 'utf-8') : data;
    fs.writeSync(fd, buf, 0, buf.length, null);
    try { fs.fsyncSync(fd); } catch { /* fsync best-effort on odd FS */ }
  } finally {
    try { fs.closeSync(fd); } catch { /* noop */ }
  }
  try { fs.chmodSync(tmp, mode); } catch { /* non-fatal */ }
  fs.renameSync(tmp, file);
  try { fs.chmodSync(file, mode); } catch { /* non-fatal */ }
}

// ---- config: in-memory cache + mtime validation (avoids re-parse per call) ----
let _cfgCache: Config | null = null;
let _cfgMtime = -1;

function readConfigFile(): { cfg: Config; mtime: number } {
  ensureConfigDir();
  if (!fs.existsSync(CONFIG_FILE)) return { cfg: {}, mtime: -1 };
  try {
    const st = fs.statSync(CONFIG_FILE);
    const raw = fs.readFileSync(CONFIG_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    const cfg: Config = parsed && typeof parsed === 'object' ? parsed : {};
    return { cfg, mtime: st.mtimeMs };
  } catch {
    return { cfg: {}, mtime: -1 };
  }
}

export function loadConfig(): Config {
  try {
    const mtime = fs.existsSync(CONFIG_FILE) ? fs.statSync(CONFIG_FILE).mtimeMs : -1;
    if (_cfgCache !== null && mtime === _cfgMtime) return { ..._cfgCache };
  } catch { /* fall through to read */ }
  const { cfg, mtime } = readConfigFile();
  _cfgCache = cfg;
  _cfgMtime = mtime;
  return { ...cfg };
}

export function saveConfig(config: Config): void {
  const clean: Config = {};
  if (typeof config.lastProject === 'string') clean.lastProject = config.lastProject.slice(0, 500);
  if (typeof config.theme === 'string') clean.theme = config.theme.slice(0, 50);
  if (Number.isFinite(config.fontSize)) clean.fontSize = config.fontSize;
  if (typeof config.mouse === 'boolean') clean.mouse = config.mouse;
  if (typeof config.githubUsername === 'string') clean.githubUsername = config.githubUsername.slice(0, 100);
  if (typeof config.githubRepo === 'string') clean.githubRepo = config.githubRepo.slice(0, 200);
  atomicWriteFileSync(CONFIG_FILE, JSON.stringify(clean, null, 2), 0o600);
  try {
    _cfgMtime = fs.statSync(CONFIG_FILE).mtimeMs;
  } catch { _cfgMtime = Date.now(); }
  _cfgCache = { ...clean };
}

// ---- token: cached, permission-repaired, never logged ----
let _tokenCache: { value: string | null; mtime: number; missing: boolean } | null = null;

function tokenStat(): { mtime: number; missing: boolean } {
  try {
    const st = fs.statSync(TOKEN_FILE);
    return { mtime: st.mtimeMs, missing: false };
  } catch {
    return { mtime: -1, missing: true };
  }
}

export function saveToken(token: string): void {
  const t = String(token || '').trim();
  if (!t) throw new Error('refusing to save empty token');
  if (t.length > 500) throw new Error('token too long');
  atomicWriteFileSync(TOKEN_FILE, t, 0o600);
  const { mtime } = tokenStat();
  _tokenCache = { value: t, mtime, missing: false };
}

export function loadToken(): string | null {
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
    const mode = fs.statSync(TOKEN_FILE).mode & 0o777;
    if (mode !== 0o600) fs.chmodSync(TOKEN_FILE, 0o600);
  } catch { /* non-fatal */ }
  let t = '';
  try {
    t = fs.readFileSync(TOKEN_FILE, 'utf-8').trim();
  } catch {
    _tokenCache = { value: null, mtime, missing: false };
    return null;
  }
  const value = t ? t : null;
  _tokenCache = { value, mtime, missing: false };
  return value;
}

export function clearToken(): void {
  _tokenCache = { value: null, mtime: -1, missing: true };
  if (!fs.existsSync(TOKEN_FILE)) return;
  // Overwrite before unlink so the secret isn't left in freed blocks.
  try {
    const st = fs.statSync(TOKEN_FILE);
    const fd = fs.openSync(TOKEN_FILE, 'r+');
    try {
      const zeros = Buffer.alloc(Math.min(st.size, 4096), 0);
      let off = 0;
      while (off < st.size) {
        const n = Math.min(zeros.length, st.size - off);
        fs.writeSync(fd, zeros, 0, n, off);
        off += n;
      }
      try { fs.fsyncSync(fd); } catch { /* noop */ }
    } finally {
      try { fs.closeSync(fd); } catch { /* noop */ }
    }
  } catch { /* fall through to unlink */ }
  try { fs.unlinkSync(TOKEN_FILE); } catch { /* noop */ }
}

// ---- session state: preserved UI prefs, debounced + atomic ----
let _sessionCache: SessionState | null = null;
let _sessionMtime = -1;
let _sessionTimer: NodeJS.Timeout | null = null;

export function loadSession(): SessionState {
  try {
    const mtime = fs.existsSync(SESSION_FILE) ? fs.statSync(SESSION_FILE).mtimeMs : -1;
    if (_sessionCache !== null && mtime === _sessionMtime) return { ..._sessionCache };
  } catch { /* fall through */ }
  let s: SessionState = {};
  let mtime = -1;
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const st = fs.statSync(SESSION_FILE);
      mtime = st.mtimeMs;
      const parsed = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf-8'));
      if (parsed && typeof parsed === 'object') s = parsed;
    }
  } catch { s = {}; }
  _sessionCache = { ...s };
  _sessionMtime = mtime;
  return { ...s };
}

function writeSessionNow(s: SessionState): void {
  const clean: SessionState = {};
  if (typeof s.theme === 'string') clean.theme = s.theme.slice(0, 50);
  if (Number.isFinite(s.termHeight)) clean.termHeight = Math.max(4, Math.min(60, s.termHeight as number));
  if (typeof s.termMaxed === 'boolean') clean.termMaxed = s.termMaxed;
  if (typeof s.treeVisible === 'boolean') clean.treeVisible = s.treeVisible;
  if (typeof s.lastFile === 'string') clean.lastFile = (s.lastFile as string).slice(0, 1000);
  else if (s.lastFile === null) clean.lastFile = null;
  if (typeof s.lastProject === 'string') clean.lastProject = s.lastProject.slice(0, 500);
  clean.updatedAt = Date.now();
  atomicWriteFileSync(SESSION_FILE, JSON.stringify(clean), 0o600);
  try {
    _sessionMtime = fs.statSync(SESSION_FILE).mtimeMs;
  } catch { _sessionMtime = Date.now(); }
  _sessionCache = { ...clean };
}

export function saveSession(s: SessionState): void {
  writeSessionNow(s);
}

/** Merge partial state and persist (debounced to coalesce rapid UI changes). */
export function scheduleSessionSave(patch: Partial<SessionState>, delayMs = 500): void {
  const cur = loadSession();
  _sessionCache = { ...cur, ...patch };
  if (_sessionTimer) clearTimeout(_sessionTimer);
  _sessionTimer = setTimeout(() => {
    _sessionTimer = null;
    try { writeSessionNow(_sessionCache || {}); } catch { /* non-fatal */ }
  }, Math.max(0, delayMs));
  if (_sessionTimer.unref) _sessionTimer.unref();
}

/** Flush any pending debounced session write (call on quit). */
export function flushSession(): void {
  if (_sessionTimer) {
    clearTimeout(_sessionTimer);
    _sessionTimer = null;
    try { writeSessionNow(_sessionCache || loadSession()); } catch { /* noop */ }
  }
}

export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

export function dirExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

export function readFileSync(filePath: string): string {
  return fs.readFileSync(filePath, 'utf-8');
}

export function writeFileSync(filePath: string, content: string): void {
  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(filePath, content, 'utf-8');
}

export function getFileExtension(filename: string): string {
  const base = path.basename(filename).toLowerCase();
  if (base === 'dockerfile' || base.startsWith('dockerfile.')) return 'dockerfile';
  const ext = path.extname(base).toLowerCase();
  return ext.startsWith('.') ? ext.slice(1) : '';
}

/** Check if a file is likely binary by reading the first 8KB and looking for null bytes. */
export function isBinaryFile(filePath: string): boolean {
  let fd = -1;
  try {
    fd = fs.openSync(filePath, 'r');
    const buf = Buffer.alloc(8192);
    const bytesRead = fs.readSync(fd, buf, 0, 8192, 0);
    for (let i = 0; i < bytesRead; i++) {
      if (buf[i] === 0) return true;
    }
    return false;
  } catch {
    return true; // treat unreadable as binary
  } finally {
    if (fd >= 0) { try { fs.closeSync(fd); } catch { /* noop */ } }
  }
}

const EXT_MAP: Record<string, string> = {
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

export function getLanguageFromExt(ext: string): string {
  // Own-property check: `EXT_MAP['constructor']`/`['toString']` would otherwise
  // return inherited Object.prototype functions instead of a language string.
  return Object.prototype.hasOwnProperty.call(EXT_MAP, ext) ? EXT_MAP[ext] : 'text';
}

export function getGitHubUsername(): string | null {
  return loadConfig().githubUsername || null;
}

export function setGitHubUsername(username: string): void {
  const config = loadConfig();
  config.githubUsername = username;
  saveConfig(config);
}

export function getSelectedRepo(): string | null {
  return loadConfig().githubRepo || null;
}

export function setSelectedRepo(fullName: string | null): void {
  const config = loadConfig();
  if (fullName) config.githubRepo = fullName;
  else delete config.githubRepo;
  saveConfig(config);
}

export function clearGitHubUser(): void {
  const config = loadConfig();
  delete config.githubUsername;
  saveConfig(config);
}

/**
 * Sanitize and validate a user-supplied path against a base directory.
 * Returns the resolved absolute path if safe, or null if it escapes the base.
 */
export function safePath(base: string, target: string): string | null {
  if (target.includes('\0')) return null;
  const cleaned = target.replace(/^\/+/, '');
  let decoded: string;
  try {
    decoded = decodeURIComponent(cleaned);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const p = path.resolve(base, decoded);
  const baseResolved = path.resolve(base);
  if (p === baseResolved || p.startsWith(baseResolved + path.sep)) {
    return p;
  }
  return null;
}

/** True if a ROOT-relative posix path touches a hidden file/dir, except allowlisted names. */
export function isHiddenRel(relPosix: string): boolean {
  if (!relPosix) return false;
  return relPosix.split('/').some((p) => {
    if (!p.startsWith('.')) return false;
    return p !== '.gitignore' && p !== '.env.example';
  });
}

let _verCache: string | null = null;
/** Get the current package version from package.json (cached). */
export function getVersion(): string {
  if (_verCache !== null) return _verCache;
  try {
    const pkgPath = path.join(__dirname, '..', 'package.json');
    const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
    _verCache = pkg.version || '0.0.0';
  } catch {
    _verCache = '0.0.0';
  }
  return _verCache || '0.0.0';
}
