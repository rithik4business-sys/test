import * as http from 'http';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as crypto from 'crypto';
import { spawn, spawnSync } from 'child_process';
import { safePath, getVersion, isHiddenRel, loadToken, saveToken, clearToken, loadConfig, getSelectedRepo, setSelectedRepo, setGitHubUsername, clearGitHubUser } from './utils';
import * as gh from './github';
import { collectProjectFiles } from './collect';
import { CappedBuffer } from './structures';
import { psCommandArgs } from './winsh';
export { collectProjectFiles };

const ROOT = path.resolve(process.cwd());
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.vscode', '.idea']);

const MIME_MAP: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
  gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  ico: 'image/x-icon', svg: 'image/svg+xml',
};

const AUTH_TOKEN = process.env.TYPEWRITER_TOKEN || '';
// Optional native/realtime deps (production terminal). Absent = exec-only fallback.
const ptyMod: any = (() => { try { return require('node-pty'); } catch { return null; } })();
const WsMod: any = (() => { try { return require('ws'); } catch { return null; } })();
function authed(req: http.IncomingMessage, url: URL): boolean {
  if (!AUTH_TOKEN) return true;
  const h = req.headers.authorization || '';
  if (h === `Bearer ${AUTH_TOKEN}`) return true;
  try { return url.searchParams.get('token') === AUTH_TOKEN; } catch { return false; }
}
function needAuth(req: http.IncomingMessage, url: URL, res: http.ServerResponse): boolean {
  if (authed(req, url)) return true;
  res.writeHead(401, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'unauthorized' }));
  return false;
}

// ---- AI coding agents (claude / opencode / codex): detect, launch, install ----
interface AgentSpec { name: string; bin: string; extraPaths: string[]; versionArgs: string[]; run: string; installCmd: string; installArgs: string[]; installLabel: string }
const AGENTS: Record<string, AgentSpec> = {
  claude: {
    name: 'Claude Code', bin: 'claude', extraPaths: ['.local/bin/claude', '.npm-global/bin/claude'],
    versionArgs: ['--version'], run: 'claude',
    installCmd: 'npm', installArgs: ['i', '-g', '@anthropic-ai/claude-code'],
    installLabel: 'npm i -g @anthropic-ai/claude-code',
  },
  opencode: {
    name: 'OpenCode', bin: 'opencode', extraPaths: ['.opencode/bin/opencode', '.local/bin/opencode'],
    versionArgs: ['--version'], run: 'opencode',
    installCmd: 'sh', installArgs: ['-c', 'curl -fsSL https://opencode.ai/install | bash'],
    installLabel: 'curl -fsSL https://opencode.ai/install | bash',
  },
  codex: {
    name: 'Codex', bin: 'codex', extraPaths: ['.local/bin/codex', '.npm-global/bin/codex'],
    versionArgs: ['--version'], run: 'codex',
    installCmd: 'npm', installArgs: ['i', '-g', '@openai/codex'],
    installLabel: 'npm i -g @openai/codex',
  },
};
export function findAgentBin(id: string): string | null {
  // Own-property guard: prototype members ('constructor', '__proto__', ...) are
  // truthy on a plain object and used to crash below — AGENTS[id].extraPaths is
  // undefined there, so `for (const rel of spec.extraPaths)` threw a TypeError
  // out of this exported function instead of returning null.
  const spec = Object.prototype.hasOwnProperty.call(AGENTS, id) ? AGENTS[id] : undefined;
  if (!spec) return null;
  try {
    const r = spawnSync('sh', ['-c', `command -v ${spec.bin}`], { timeout: 5000, encoding: 'utf-8' });
    const hit = (r.stdout || '').split('\n')[0].trim();
    if (r.status === 0 && hit) return hit;
  } catch { /* fall through to known paths */ }
  const home = os.homedir();
  for (const rel of spec.extraPaths) {
    const full = path.join(home, rel);
    try {
      fs.accessSync(full, fs.constants.X_OK);
      return full;
    } catch { /* next */ }
  }
  return null;
}
export interface AgentStatus { id: string; name: string; installed: boolean; bin?: string; version?: string; run: string; installLabel: string }
/** Fresh scans run up to six spawnSync probes (command -v + --version per
 *  agent) with 5s/10s timeouts — blocking the event loop inside the HTTP
 *  handler on every request. Memoize so a polling UI pays it at most once
 *  per window. */
const AGENT_STATUS_TTL = 5000;
let _agentCache: { at: number; list: AgentStatus[] } | null = null;
export function agentStatus(): AgentStatus[] {
  const now = Date.now();
  if (_agentCache && now - _agentCache.at < AGENT_STATUS_TTL) return _agentCache.list;
  const list = Object.keys(AGENTS).map((id) => {
    const spec = AGENTS[id];
    const bin = findAgentBin(id);
    const st: AgentStatus = { id, name: spec.name, installed: bin !== null, run: spec.run, installLabel: spec.installLabel };
    if (bin) {
      st.bin = bin;
      try {
        const r = spawnSync(bin, spec.versionArgs, { timeout: 10000, encoding: 'utf-8' });
        const v = ((r.stdout || '') + ' ' + (r.stderr || '')).trim().split('\n')[0].trim();
        if (v) st.version = v.slice(0, 80);
      } catch { /* version optional */ }
    }
    return st;
  });
  _agentCache = { at: now, list };
  return list;
}
interface InstallJob { id: string; running: boolean; exitCode: number | null; log: CappedBuffer }
let installJob: InstallJob | null = null;
function startInstall(id: string): { started: boolean; error?: string } {
  // Same own-property guard as findAgentBin: POST /api/agents/install with
  // id='constructor'/'__proto__' used to pass `!spec` and surface as a 500
  // (TypeError inside findAgentBin) instead of the intended 400.
  const spec = Object.prototype.hasOwnProperty.call(AGENTS, id) ? AGENTS[id] : undefined;
  if (!spec) return { started: false, error: 'unknown agent' };
  if (findAgentBin(id)) return { started: false, error: 'already installed' };
  if (installJob && installJob.running) return { started: false, error: 'another install is already running' };
  const job: InstallJob = { id, running: true, exitCode: null, log: new CappedBuffer(60000) };
  installJob = job;
  let child: any;
  try {
    child = spawn(spec.installCmd, spec.installArgs, { cwd: os.homedir(), windowsHide: true });
  } catch {
    job.running = false;
    return { started: false, error: 'failed to spawn installer' };
  }
  const push = (d: any) => {
    job.log.push(String(d).replace(/\r/g, ''));
  };
  push(`$ ${spec.installLabel}\n`);
  child.stdout?.on('data', push);
  child.stderr?.on('data', push);
  child.on('error', (e: any) => { push(`\n[spawn error: ${e.message}]\n`); job.running = false; job.exitCode = 1; });
  child.on('exit', (code: number | null) => { job.running = false; job.exitCode = code ?? 1; push(`\n[exit ${job.exitCode}]\n`); });
  const kill = setTimeout(() => { try { child.kill('SIGTERM'); } catch {} }, 10 * 60 * 1000);
  child.on('exit', () => clearTimeout(kill));
  return { started: true };
}

interface TreeNode { name: string; path: string; type: 'file' | 'dir'; children?: TreeNode[] }

// ---- static vendor assets (xterm terminal emulator, served offline) ----
const VENDOR: Record<string, { file: string; type: string }> = {
  'xterm.js': { file: 'xterm/lib/xterm.js', type: 'text/javascript; charset=utf-8' },
  'xterm.css': { file: 'xterm/css/xterm.css', type: 'text/css; charset=utf-8' },
  'fit.js': { file: 'xterm-addon-fit/lib/xterm-addon-fit.js', type: 'text/javascript; charset=utf-8' },
};
function vendorRoot(): string {
  return path.join(__dirname, '..', 'node_modules');
}

// ---- true PTY sessions (node-pty) ----
interface PtySession { id: number; pty: any; ws: any; shell: string }
let ptySeq = 0;
const ptySessions = new Map<number, PtySession>();
const MAX_PTY = 8;
function clampInt(v: number, lo: number, hi: number, fb: number): number {
  return Number.isFinite(v) ? Math.max(lo, Math.min(hi, Math.floor(v))) : fb;
}
function wsAuthed(req: http.IncomingMessage, url: URL): boolean {
  if (!AUTH_TOKEN) return true;
  try {
    if (url.searchParams.get('token') === AUTH_TOKEN) return true;
  } catch { /* noop */ }
  const h = (req.headers.authorization || '') as string;
  return h === `Bearer ${AUTH_TOKEN}`;
}
function ptyAccept(ws: any, url: URL): void {
  if (!ptyMod) { try { ws.close(1011, 'no pty'); } catch {} return; }
  if (ptySessions.size >= MAX_PTY) { try { ws.close(1013, 'busy'); } catch {} return; }
  const cols = clampInt(parseInt(url.searchParams.get('cols') || '', 10), 20, 300, 80);
  const rows = clampInt(parseInt(url.searchParams.get('rows') || '', 10), 5, 100, 24);
  const shell = process.platform === 'win32' ? 'powershell.exe' : (process.env.SHELL || 'bash');
  const shellName = process.platform === 'win32' ? 'powershell' : shell.split('/').pop() || 'sh';
  let term: any;
  try {
    term = ptyMod.spawn(shell, [], { name: 'xterm-256color', cols, rows, cwd: ROOT, env: process.env as any });
  } catch {
    try { ws.close(1011, 'spawn failed'); } catch {}
    return;
  }
  const id = ++ptySeq;
  const sess: PtySession = { id, pty: term, ws, shell: shellName };
  ptySessions.set(id, sess);
  const send = (o: any) => { try { ws.send(JSON.stringify(o)); } catch {} };
  send({ t: 'ready', shell: shellName });
  term.onData((d: string) => send({ t: 'out', d }));
  term.onExit(({ exitCode }: any) => { send({ t: 'exit', code: exitCode ?? 0 }); try { ws.close(); } catch {} });
  ws.on('message', (raw: any) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'in' && typeof m.d === 'string') { try { term.write(m.d.slice(0, 65536)); } catch {} }
    else if (m.t === 'resize') {
      try { term.resize(clampInt(parseInt(m.cols, 10), 20, 300, cols), clampInt(parseInt(m.rows, 10), 5, 100, rows)); } catch {}
    }
  });
  const dead = () => { ptySessions.delete(id); try { term.kill(); } catch {} };
  ws.on('close', dead);
  ws.on('error', dead);
}

// ---- LSP bridge (spawns real language servers over stdio) ----
const LSP_SERVERS: Record<string, { cmd: string; args: string[]; id: string }> = {
  typescript: { cmd: 'typescript-language-server', args: ['--stdio'], id: 'typescript' },
  javascript: { cmd: 'typescript-language-server', args: ['--stdio'], id: 'javascript' },
  python: { cmd: 'pyright-langserver', args: ['--stdio'], id: 'python' },
  go: { cmd: 'gopls', args: [], id: 'go' },
  rust: { cmd: 'rust-analyzer', args: [], id: 'rust' },
};
const LSP_INSTALL_HINT: Record<string, string> = {
  typescript: 'npm i -g typescript-language-server',
  javascript: 'npm i -g typescript-language-server',
  python: 'pip install pyright  (or: npm i -g pyright)',
  go: 'go install golang.org/x/tools/gopls@latest',
  rust: 'rustup component add rust-analyzer',
};
interface LspSession { proc: any; buf: Buffer; pending: Map<number, any>; seq: number; open: Map<string, number>; inited: boolean; ws: any }
function lspSend(s: LspSession, msg: any): void {
  const body = Buffer.from(JSON.stringify(msg), 'utf-8');
  try { s.proc.stdin.write(Buffer.concat([Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, 'utf-8'), body])); } catch {}
}
function fileUri(p: string): string {
  return 'file://' + path.join(ROOT, p).replace(/\\/g, '/');
}
const MAX_LSP = 4;
let activeLsp = 0;
function lspAccept(ws: any, url: URL): void {
  const lang = (url.searchParams.get('lang') || '').toLowerCase();
  // Own-property guard: `lang` is attacker-controlled query input, and
  // `LSP_SERVERS['constructor']` (etc.) is truthy on a plain object — the old
  // lookup skipped the `unsupported language` rejection below and fell into
  // spawn(undefined, …), answering a misleading `no-server` (plus an
  // undefined install hint) instead of the real400-style error.
  const spec = Object.prototype.hasOwnProperty.call(LSP_SERVERS, lang) ? LSP_SERVERS[lang] : undefined;
  const send = (o: any) => { try { ws.send(JSON.stringify(o)); } catch {} };
  if (!spec) { send({ t: 'error', error: 'unsupported language: ' + lang }); try { ws.close(); } catch {} return; }
  if (activeLsp >= MAX_LSP) { try { ws.close(1013, 'busy'); } catch {} return; }
  activeLsp++;
  let released = false;
  const release = () => { if (!released) { released = true; activeLsp = Math.max(0, activeLsp - 1); } };
  let proc: any;
  try {
    proc = spawn(spec.cmd, spec.args, { cwd: ROOT, windowsHide: true });
  } catch {
    release();
    send({ t: 'error', error: 'no-server', hint: LSP_INSTALL_HINT[lang] });
    try { ws.close(); } catch {}
    return;
  }
  const sess: LspSession = { proc, buf: Buffer.alloc(0), pending: new Map(), seq: 0, open: new Map(), inited: false, ws };
  let exited = false;
  const fail = () => {
    if (exited) return; exited = true;
    send({ t: 'error', error: 'no-server', hint: LSP_INSTALL_HINT[lang] });
    try { ws.close(); } catch {}
  };
  proc.on('error', fail);
  proc.on('exit', () => { if (!exited) { exited = true; try { ws.close(); } catch {} } });
  proc.stdout?.on('data', (d: any) => {
    // LSP base protocol counts Content-Length in BYTES and permits a second
    // header (Content-Type) after it. The old decoded-string buffer violated
    // both: String(chunk) mangles multi-byte chars split across chunks,
    // string.length (UTF-16 units) < byte length mis-frames any message with
    // non-ASCII text, and the `Content-Length...\r\n\r\n` pattern never
    // matched when Content-Type followed (parser stalled until the 1MB trim).
    const chunk = Buffer.isBuffer(d) ? d : Buffer.from(String(d), 'utf-8');
    sess.buf = sess.buf.length === 0 ? chunk : Buffer.concat([sess.buf, chunk]);
    if (sess.buf.length > 1048576) sess.buf = sess.buf.slice(-524288);
    for (;;) {
      const he = sess.buf.indexOf('\r\n\r\n');
      if (he < 0) break;
      const hm = /Content-Length:\s*(\d+)/.exec(sess.buf.toString('ascii', 0, he));
      if (!hm) { sess.buf = sess.buf.slice(he + 4); continue; } // skip junk header block
      const len = parseInt(hm[1], 10);
      const start = he + 4;
      if (sess.buf.length < start + len) break;
      let msg: any = null;
      try { msg = JSON.parse(sess.buf.slice(start, start + len).toString('utf-8')); } catch { /* fall through */ }
      sess.buf = sess.buf.slice(start + len);
      if (!msg) continue;
      if (msg.id !== undefined && sess.pending.has(msg.id)) {
        const cb = sess.pending.get(msg.id);
        sess.pending.delete(msg.id);
        let result: any = msg.result ?? null;
        if (cb.tag === 'definition' && result) {
          const one = (l: any) => {
            if (l && typeof l.uri === 'string' && l.uri.startsWith('file://')) {
              const rel = path.relative(ROOT, l.uri.slice('file://'.length)).replace(/\\/g, '/');
              if (rel && !rel.startsWith('..')) l.uri = 'tw://' + rel;
            }
            return l;
          };
          result = Array.isArray(result) ? result.map(one) : one(result);
        }
        send({ t: 'result', id: msg.id, tag: cb.tag, result, error: msg.error ?? null });
      }
    }
  });
  proc.stderr?.on('data', () => { /* server chatter goes nowhere */ });
  const initId = ++sess.seq;
  sess.pending.set(initId, { tag: 'init' });
  lspSend(sess, {
    jsonrpc: '2.0', id: initId, method: 'initialize',
    params: {
      processId: process.pid,
      rootUri: 'file://' + ROOT.replace(/\\/g, '/'),
      capabilities: { textDocument: { completion: { completionItem: {} }, hover: { contentFormat: ['plaintext'] }, definition: {} } },
    },
  });
  const ensureInit = () => {
    if (sess.inited) return;
    sess.inited = true;
    lspSend(sess, { jsonrpc: '2.0', method: 'initialized', params: {} });
  };
  ws.on('message', (raw: any) => {
    let m: any;
    try { m = JSON.parse(String(raw)); } catch { return; }
    if (m.t === 'open' && typeof m.path === 'string' && typeof m.content === 'string') {
      ensureInit();
      const uri = fileUri(m.path);
      const v = (sess.open.get(uri) ?? 0) + 1;
      sess.open.set(uri, v);
      if (v === 1) {
        lspSend(sess, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: spec.id, version: v, text: String(m.content).slice(0, 500000) } } });
      } else {
        lspSend(sess, { jsonrpc: '2.0', method: 'textDocument/didChange', params: { textDocument: { uri, version: v }, contentChanges: [{ text: String(m.content).slice(0, 500000) }] } });
      }
      send({ t: 'opened', path: m.path });
    } else if ((m.t === 'complete' || m.t === 'hover' || m.t === 'definition') && typeof m.path === 'string') {
      ensureInit();
      const uri = fileUri(m.path);
      if (!sess.open.has(uri)) {
        sess.open.set(uri, 1);
        lspSend(sess, { jsonrpc: '2.0', method: 'textDocument/didOpen', params: { textDocument: { uri, languageId: spec.id, version: 1, text: '' } } });
      }
      const id = ++sess.seq;
      if (sess.pending.size > 64) sess.pending.clear();
      sess.pending.set(id, { tag: m.t });
      const method = m.t === 'complete' ? 'textDocument/completion' : m.t === 'hover' ? 'textDocument/hover' : 'textDocument/definition';
      lspSend(sess, { jsonrpc: '2.0', id, method, params: { textDocument: { uri }, position: { line: Math.max(0, m.line | 0), character: Math.max(0, m.col | 0) } } });
    }
  });
  const dead = () => { release(); try { proc.kill(); } catch {} };
  ws.on('close', dead);
  ws.on('error', dead);
}

const cmpName = (a: fs.Dirent, b: fs.Dirent) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0);

export function tree(dir: string, base: string, depth = 0): TreeNode[] {
  if (depth > 6) return [];
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return []; }
  const dirs: fs.Dirent[] = [];
  const files: fs.Dirent[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) continue;
    if (e.isDirectory()) dirs.push(e);
    else files.push(e);
  }
  dirs.sort(cmpName);
  files.sort(cmpName);
  const out: TreeNode[] = [];
  for (let k = 0; k < 2; k++) {
    const list = k === 0 ? dirs : files;
    for (const e of list) {
      if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
      if (k === 0 && SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      const rel = path.relative(base, full).replace(/\\/g, '/');
      if (k === 0) out.push({ name: e.name, path: rel, type: 'dir', children: tree(full, base, depth + 1) });
      else out.push({ name: e.name, path: rel, type: 'file' });
    }
  }
  return out;
}

const MAX_BODY = 5 * 1024 * 1024;
function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let bytes = 0;
    let done = false;
    // Do NOT destroy the request here: every route that overflows MAX_BODY
    // answers with an explicit 413, and killing the socket first discards
    // that response — the client sees a connection reset instead (verified:
    // respond-after-destroy delivers nothing). With the socket kept alive the
    // 413 is delivered; further chunks are ignored by the `done` guard and
    // Node discards the remainder once the response is written.
    const fail = (e: Error) => { if (!done) { done = true; reject(e); } };
    req.on('data', (c) => {
      if (done) return;
      const buf = Buffer.isBuffer(c) ? c : Buffer.from(String(c), 'utf-8');
      bytes += buf.length;
      if (bytes > MAX_BODY) { fail(new Error('too large')); return; }
      parts.push(buf);
    });
    req.on('end', () => { if (!done) { done = true; resolve(Buffer.concat(parts).toString('utf-8')); } });
    req.on('error', (e) => fail(e as Error));
    req.on('close', () => { if (!done) { done = true; reject(new Error('closed')); } });
  });
}

/** Per-IP sliding-window throttle for sensitive routes. True = allowed. */
const rateBuckets = new Map<string, number[]>();
function throttle(req: http.IncomingMessage, scope: string, perMinute: number): boolean {
  let ip = 'local';
  try {
    const remote = (req.socket && req.socket.remoteAddress) || '';
    const fwd = req.headers['x-forwarded-for'];
    const xff = (Array.isArray(fwd) ? fwd[0] : (fwd || '')).split(',')[0].trim();
    // Only trust X-Forwarded-For when the direct peer is loopback (a reverse
    // proxy on this machine). The header is client-settable on a direct
    // connection, and `ip` keys the bucket below — an untrusted value let any
    // client mint unlimited distinct buckets.
    const trustFwd = remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
    ip = (trustFwd && xff) || remote || 'local';
  } catch { /* keep default */ }
  const key = ip + '|' + scope;
  const now = Date.now();
  const windowStart = now - 60000;
  // Hits are appended in time order, so expired entries drain from the front
  // in place — the old `filter()` allocated a fresh array on every request.
  let hits = rateBuckets.get(key);
  if (!hits) { hits = []; rateBuckets.set(key, hits); }
  while (hits.length > 0 && hits[0] <= windowStart) hits.shift();
  if (hits.length >= perMinute) {
    rateBuckets.set(key, hits);
    return false;
  }
  hits.push(now);
  if (rateBuckets.size > 5000) {
    // Evict only windows that have fully expired. The old blanket clear()
    // reset every client's live window, silently letting them exceed
    // perMinute for the rest of the hour.
    for (const [k, hs] of rateBuckets) {
      while (hs.length > 0 && hs[0] <= windowStart) hs.shift();
      if (hs.length === 0) rateBuckets.delete(k);
    }
    if (rateBuckets.size > 5000) rateBuckets.clear(); // last-resort memory bound
  }
  rateBuckets.set(key, hits);
  return true;
}

/** Last server-side device-flow poll per device_code (enforces GitHub's interval). */
const devicePolls = new Map<string, number>();

// ---- GitHub account unit (server-side proxy — token never leaves the server) ----
function sendJson(res: http.ServerResponse, code: number, obj: any): void {
  res.writeHead(code, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(obj));
}

async function parseJsonBody(req: http.IncomingMessage): Promise<any> {
  // An unreadable body (oversize / client abort) must surface as `null` so the
  // caller answers 400 — letting readBody's rejection reach the outer catch
  // turned every oversized upload to these routes into a 500 'Server error'.
  let raw: string;
  try { raw = await readBody(req); } catch { return null; }
  try { return JSON.parse(raw || '{}'); } catch { return null; }
}

/** Token stored via CLI --login or web connect. Null = not connected. */
function ghToken(): string | null {
  try { return loadToken(); } catch { return null; }
}

/** Token-kind memo: one /user call covers at most 5 minutes per token.
 *  Keyed by sha256 so raw tokens never sit in a loggable map key. */
const tokenKindCache = new Map<string, { at: number; kind: gh.TokenKind; login: string; name: string | null; avatar: string | null }>();
const TOKEN_KIND_TTL = 5 * 60 * 1000;
function tokenKindKey(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
async function cachedTokenInfo(token: string): Promise<{ kind: gh.TokenKind; login: string; name: string | null; avatar: string | null }> {
  const key = tokenKindKey(token);
  const hit = tokenKindCache.get(key);
  if (hit && Date.now() - hit.at < TOKEN_KIND_TTL) {
    return { kind: hit.kind, login: hit.login, name: hit.name, avatar: hit.avatar };
  }
  const checked = await gh.getTokenScopes(token);
  const kind = gh.classifyTokenKind(checked.scopes);
  if (tokenKindCache.size > 500) tokenKindCache.clear();
  tokenKindCache.set(key, { at: Date.now(), kind, login: checked.login, name: checked.name, avatar: checked.avatar_url });
  return { kind, login: checked.login, name: checked.name, avatar: checked.avatar_url };
}

/** Drop memoized token-kind entries: all on logout, one on token replace. */
function invalidateTokenKind(token?: string): void {
  if (!token) { tokenKindCache.clear(); return; }
  try { tokenKindCache.delete(tokenKindKey(token)); } catch { /* noop */ }
}

function ghError(res: http.ServerResponse, e: any): void {
  const msg = e instanceof Error ? e.message : String(e);
  const status = (e as any)?.statusCode;
  if (status === 404) { sendJson(res, 404, { error: 'not found' }); return; }
  if (status === 401) {
    // Expired/revoked GitHub token: drop it server-side so the next status
    // call reports logged-out, and tell the client to reset its UI.
    try { clearToken(); } catch { /* noop */ }
    try { clearGitHubUser(); } catch { /* noop */ }
    sendJson(res, 401, { error: 'Session expired — please log in again', expired: true });
    return;
  }
  if (status === 403) { sendJson(res, 502, { error: msg }); return; }
  sendJson(res, 502, { error: msg.slice(0, 300) });
}

function sanitizePushMessage(m: any): string {
  const s = typeof m === 'string' ? m.trim() : '';
  return (s || 'Update from TypeWriter').slice(0, 200);
}

/** Run a git subcommand in ROOT without a shell. Capped output, hard timeout. */
function runGit(args: string[], timeoutMs: number): Promise<{ output: string; exit: number }> {
  return new Promise((resolve) => {
    const acc = new CappedBuffer(131072);
    let settled = false;
    const done = (output: string, exit: number) => {
      if (settled) return;
      settled = true;
      resolve({ output, exit });
    };
    let p: any;
    try {
      p = spawn('git', args, { cwd: ROOT, windowsHide: true });
    } catch (e) {
      done(`spawn failed: ${(e as Error).message}`, 127);
      return;
    }
    runningExecs.add(p);
    const kill = setTimeout(() => {
      try { p.kill('SIGTERM'); } catch { /* noop */ }
      setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } }, 5000);
    }, timeoutMs);
    p.stdout?.on('data', (d: any) => { acc.push(String(d)); });
    p.stderr?.on('data', (d: any) => { acc.push(String(d)); });
    p.on('error', (e: any) => { runningExecs.delete(p); clearTimeout(kill); done(`spawn failed: ${(e as Error).message}`, 127); });
    p.on('close', (code: number) => {
      runningExecs.delete(p);
      clearTimeout(kill);
      done(acc.toString(), code ?? 0);
    });
  });
}

// Binary asset memo (vendor xterm + brand icons): read once, serve many.
const _binCache = new Map<string, Buffer>();
function binCache(key: string, load: () => Buffer): Buffer {
  const hit = _binCache.get(key);
  if (hit) return hit;
  const data = load();
  if (_binCache.size > 32) _binCache.clear();
  _binCache.set(key, data);
  return data;
}

// Cache the HTML page in memory, reloaded when the file changes on disk
// (so UI edits show up without restarting the server).
let _cachedPage: string | null = null;
let _cachedPagePath: string | null = null;
let _cachedPageMtime = -1;
function idePage(): string {
  const candidates = [
    // Bundled page first: process.cwd() is the user's opened project (see
    // index.ts), so the old cwd-first order served an arbitrary project's
    // public/index.html as the editor UI (a planted page would run at the
    // editor's origin). cwd remains the fallback when the bundled file is
    // missing — when developing from the repo root both paths are the same file.
    path.join(__dirname, '..', 'public', 'index.html'),
    path.join(process.cwd(), 'public', 'index.html'),
  ];
  for (const p of candidates) {
    try {
      const mtime = fs.statSync(p).mtimeMs;
      if (_cachedPage !== null && _cachedPagePath === p && mtime === _cachedPageMtime) return _cachedPage;
      _cachedPage = fs.readFileSync(p, 'utf-8');
      _cachedPagePath = p;
      _cachedPageMtime = mtime;
      return _cachedPage;
    } catch { /* next */ }
  }
  _cachedPage = '<!doctype html><html><body>TypeWriter — public/index.html missing. Run from repo root.</body></html>';
  _cachedPagePath = null;
  _cachedPageMtime = -1;
  return _cachedPage;
}

// Cached file tree with TTL + cached serialized JSON
let _treeCache: { data: TreeNode[]; json: string; ts: number } | null = null;
const TREE_CACHE_TTL = 2000; // 2 seconds
function cachedTreeJSON(): string {
  const now = Date.now();
  if (_treeCache && (now - _treeCache.ts) < TREE_CACHE_TTL) return _treeCache.json;
  const data = tree(ROOT, ROOT);
  const json = JSON.stringify(data);
  _treeCache = { data, json, ts: now };
  return json;
}
function invalidateTreeCache(): void { _treeCache = null; }

/** Single stat call — returns file info or null. Rejects symlinks. */
function statSafe(fp: string): fs.Stats | null {
  try {
    const lst = fs.lstatSync(fp);
    if (lst.isSymbolicLink()) return null;
    return fs.statSync(fp);
  } catch {
    return null;
  }
}

function relPosix(fp: string): string {
  return path.relative(ROOT, fp).replace(/\\/g, '/');
}

let activeExecs = 0;
const MAX_EXECS = 4;
/** Live exec children, so shutdown can terminate them. */
const runningExecs = new Set<any>();

/** Run a binary with argv (no shell), piped stdin, hard timeout. Used for
 * local-credential probes (gh / git) — never logs or returns secrets to
 * callers beyond the resolved stdout. */
function execFileTimeout(cmd: string, args: string[], opts: { input?: string; timeoutMs?: number; env?: NodeJS.ProcessEnv } = {}): Promise<{ stdout: string; stderr: string; exit: number }> {
  return new Promise((resolve) => {
    let p: any;
    try {
      p = spawn(cmd, args, { windowsHide: true, env: { ...process.env, ...(opts.env || {}) } });
    } catch (e) {
      resolve({ stdout: '', stderr: String((e as Error).message), exit: 127 });
      return;
    }
    runningExecs.add(p);
    let out = '';
    let err = '';
    const to = setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } }, opts.timeoutMs || 10000);
    p.stdout?.on('data', (d: any) => { out += String(d); if (out.length > 65536) out = out.slice(-65536); });
    p.stderr?.on('data', (d: any) => { err += String(d); if (err.length > 8192) err = err.slice(-8192); });
    try {
      if (opts.input !== undefined && p.stdin) p.stdin.write(opts.input);
      if (p.stdin) p.stdin.end();
    } catch { /* noop */ }
    p.on('error', (e: any) => { runningExecs.delete(p); clearTimeout(to); resolve({ stdout: out, stderr: String((e as Error).message), exit: 127 }); });
    p.on('close', (code: number) => { runningExecs.delete(p); clearTimeout(to); resolve({ stdout: out, stderr: err, exit: code ?? 0 }); });
  });
}

export function startServer(port = 3000, host = '127.0.0.1'): Promise<void> {
  return new Promise((resolve, rejectPromise) => {
    const server = http.createServer(async (req, res) => {
      try {
        res.setHeader('Cache-Control', 'no-store');
        const url = new URL(req.url || '/', 'http://x');
        if (url.pathname !== '/api/tree' || req.method !== 'GET') {
          console.log(`${new Date().toISOString()} ${req.method} ${url.pathname}`);
        }
        // health probe (no auth — safe, reveals only version)
        if (url.pathname === '/healthz' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, version: getVersion() }));
          return;
        }
        // favicon: tiny inline SVG mark (kills the /favicon.ico 404 in console)
        if (url.pathname === '/favicon.ico' && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'public, max-age=86400' });
          res.end('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="#1e1e1e"/><text x="16" y="22" font-family="monospace" font-size="14" font-weight="bold" text-anchor="middle" fill="#e8e8e8">TW</text></svg>');
          return;
        }
        // IDE page
        if ((url.pathname === '/' || url.pathname === '/index.html') && req.method === 'GET') {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
          res.end(idePage());
          return;
        }
        // offline vendor assets (xterm terminal emulator, prefetched at boot)
        if (url.pathname.startsWith('/vendor/') && req.method === 'GET') {
          const name = url.pathname.slice('/vendor/'.length);
          const v = VENDOR[name];
          if (!v || name.includes('..') || name.includes('/')) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }
          try {
            const data = binCache('vendor:' + name, () => fs.readFileSync(path.join(vendorRoot(), v.file)));
            res.writeHead(200, { 'Content-Type': v.type });
            res.end(data);
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
          }
          return;
        }
        // official agent brand marks (vendored from each vendor's own extension/site files)
        if (url.pathname.startsWith('/icons/') && req.method === 'GET') {
          const name = url.pathname.slice('/icons/'.length);
          const ICONS: Record<string, string> = {
            'opencode.png': 'image/png',
            'codex.svg': 'image/svg+xml',
            'claude.svg': 'image/svg+xml',
          };
          // Own-property guard: a project file named `assets/icons/constructor`
          // (bases include ROOT/assets/icons — the opened project) makes
          // `ICONS['constructor']` return the Object constructor, and that
          // Function reaching writeHead throws ERR_HTTP_INVALID_HEADER_VALUE
          // → the route's catch answers 404 for a file that exists. Same bug
          // class as MIME_MAP below (see its comment).
          const type = Object.prototype.hasOwnProperty.call(ICONS, name) ? ICONS[name] : undefined;
          if (!type || name.includes('..') || name.includes('/')) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }
          try {
            const data = binCache('icon:' + name, () => {
              const bases = [
                path.join(__dirname, '..', 'assets', 'icons'),
                path.join(ROOT, 'assets', 'icons'),
                path.join(__dirname, '..', 'public', 'vendor'),
              ];
              for (const base of bases) {
                try { return fs.readFileSync(path.join(base, name)); } catch { /* next */ }
              }
              throw new Error('missing');
            });
            // Project-controlled bytes: sandbox the context so a planted SVG
            // cannot run script at the editor's origin when opened directly
            // (Content-Security-Policy is not applied to <img> loads).
            res.writeHead(200, { 'Content-Type': type, 'Content-Security-Policy': 'sandbox' });
            res.end(data);
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
          }
          return;
        }
        if (url.pathname === '/api/tree' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(cachedTreeJSON());
          return;
        }
        if (url.pathname === '/api/root' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ root: path.basename(ROOT) }));
          return;
        }
        if (url.pathname === '/api/agents' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ agents: agentStatus() }));
          return;
        }
        if (url.pathname === '/api/agents/install' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          if (!AUTH_TOKEN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'installs disabled — set TYPEWRITER_TOKEN to enable agent installs' }));
            return;
          }
          if (!throttle(req, 'agents-install', 10)) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'rate limited, try again shortly' }));
            return;
          }
          let body: string;
          try {
            body = await readBody(req);
          } catch {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too large' }));
            return;
          }
          let parsed: any;
          try { parsed = JSON.parse(body || '{}'); } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid json' }));
            return;
          }
          const id = String(parsed.id || '');
          if (!AGENTS[id]) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'unknown agent' }));
            return;
          }
          const r = startInstall(id);
          if (!r.started) {
            const code = r.error === 'another install is already running' ? 409 : 400;
            res.writeHead(code, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: r.error }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ started: true, id }));
          return;
        }
        if (url.pathname === '/api/agents/install/log' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify(installJob
            ? { id: installJob.id, running: installJob.running, exitCode: installJob.exitCode, log: installJob.log.toString() }
            : { running: false, exitCode: null, log: '' }));
          return;
        }
        if (url.pathname === '/api/file' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const rel = url.searchParams.get('p') || '';
          const fp = safePath(ROOT, rel);
          if (!fp || isHiddenRel(relPosix(fp))) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'forbidden' }));
            return;
          }
          const st = statSafe(fp);
          if (!st || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          if (st.size > 2 * 1024 * 1024) {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too large' }));
            return;
          }
          let raw: Buffer;
          try {
            raw = fs.readFileSync(fp);
          } catch {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          if (raw.slice(0, 8192).includes(0)) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ binary: true, size: st.size }));
            return;
          }
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ content: raw.toString('utf-8'), size: st.size }));
          return;
        }
        if (url.pathname === '/api/raw' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const rel = url.searchParams.get('p') || '';
          const fp = safePath(ROOT, rel);
          if (!fp || isHiddenRel(relPosix(fp))) {
            res.writeHead(403, { 'Content-Type': 'text/plain' });
            res.end('Forbidden');
            return;
          }
          const st = statSafe(fp);
          if (!st || !st.isFile()) {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }
          if (st.size > 10 * 1024 * 1024) {
            res.writeHead(413, { 'Content-Type': 'text/plain' });
            res.end('File too large');
            return;
          }
          const ext = path.extname(fp).slice(1).toLowerCase();
          let data: Buffer;
          try {
            data = fs.readFileSync(fp);
          } catch {
            res.writeHead(404, { 'Content-Type': 'text/plain' });
            res.end('Not found');
            return;
          }
          // Own-property lookup: a file named `x.constructor` gives
          // ext='constructor', and the prototype member (a function) reaching
          // writeHead throws ERR_HTTP_INVALID_HEADER_VALUE -> 500 instead of
          // serving the file. CSP sandbox: this is arbitrary project content —
          // an SVG opened directly must not execute script at the editor's
          // origin (it could read localStorage 'tw-token' and call the API).
          const mime = Object.prototype.hasOwnProperty.call(MIME_MAP, ext) ? MIME_MAP[ext] : '';
          res.writeHead(200, {
            'Content-Type': mime || 'application/octet-stream',
            'Content-Security-Policy': 'sandbox',
          });
          res.end(data);
          return;
        }
        if (url.pathname === '/api/save' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          let body: string;
          try {
            body = await readBody(req);
          } catch {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too large' }));
            return;
          }
          let parsed: any;
          try { parsed = JSON.parse(body || '{}'); } catch {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'invalid json' }));
            return;
          }
          const { p, content } = parsed;
          const wantDir = typeof p === 'string' && p.endsWith('/');
          if (!p || (!wantDir && typeof content !== 'string')) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad request' }));
            return;
          }
          const fp = safePath(ROOT, String(p));
          if (!fp || isHiddenRel(relPosix(fp))) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'forbidden' }));
            return;
          }
          try {
            if (String(p).endsWith('/')) {
              fs.mkdirSync(fp, { recursive: true });
            } else {
              try {
                if (fs.lstatSync(fp).isSymbolicLink()) {
                  res.writeHead(403, { 'Content-Type': 'application/json' });
                  res.end(JSON.stringify({ error: 'forbidden' }));
                  return;
                }
              } catch { /* missing — safe to create */ }
              fs.mkdirSync(path.dirname(fp), { recursive: true });
              fs.writeFileSync(fp, content, 'utf-8');
            }
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'write failed' }));
            return;
          }
          invalidateTreeCache();
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
          return;
        }
        if (url.pathname === '/api/exec' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          if (!AUTH_TOKEN) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'exec disabled — set TYPEWRITER_TOKEN to enable shell execution' }));
            return;
          }
          if (!throttle(req, 'exec', 120)) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'rate limited, try again shortly' }));
            return;
          }
          if (activeExecs >= MAX_EXECS) {
            res.writeHead(429, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too many concurrent execs' }));
            return;
          }
          activeExecs++;
          let body: string;
          try {
            body = await readBody(req);
          } catch {
            activeExecs--;
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too large' }));
            return;
          }
          let cmd = '', cwd = '';
          try {
            const j = JSON.parse(body || '{}');
            cmd = String(j.cmd || '');
            cwd = String(j.cwd || '');
          } catch { /* bad json */ }
          if (!cmd.trim() || cmd.length > 2000) {
            activeExecs--; // release the slot taken above — every exit path must
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad request' }));
            return;
          }
          let workdir = ROOT;
          if (cwd) {
            const dir = safePath(ROOT, cwd);
            if (!dir) {
              activeExecs--; // release the slot taken above
              res.writeHead(403, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'forbidden' }));
              return;
            }
            const st = statSafe(dir);
            workdir = st && st.isDirectory() ? dir : ROOT;
          }
          const shell = process.platform === 'win32' ? 'powershell.exe' : 'sh';
          const args = process.platform === 'win32'
            ? psCommandArgs(cmd)
            : ['-c', cmd];
          const shellName = process.platform === 'win32' ? 'powershell' : 'sh';
          try {
            const result = await new Promise<{ output: string; exit: number }>((resolvePromise) => {
              const acc = new CappedBuffer(65536);
              const push = (d: any) => { acc.push(String(d).replace(/\r/g, '')); };
              const p = spawn(shell, args, { cwd: workdir, windowsHide: true });
              runningExecs.add(p);
              const drop = () => { runningExecs.delete(p); };
              p.on('error', (e) => { drop(); clearTimeout(kill); resolvePromise({ output: `spawn failed: ${(e as Error).message}`, exit: 127 }); });
              const kill = setTimeout(() => {
                try { p.kill('SIGTERM'); } catch { /* noop */ }
                setTimeout(() => { try { p.kill('SIGKILL'); } catch { /* noop */ } }, 5000);
              }, 30000);
              p.stdout?.on('data', push);
              p.stderr?.on('data', push);
              p.on('close', (code) => {
                drop();
                clearTimeout(kill);
                resolvePromise({ output: acc.toString(), exit: code ?? 0 });
              });
            });
            invalidateTreeCache();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({
              output: result.output,
              exit: result.exit,
              shell: shellName,
              cwd: path.relative(ROOT, workdir).replace(/\\/g, '/'),
            }));
          } finally {
            activeExecs--;
          }
          return;
        }
        if (url.pathname === '/api/delete' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          let body: string;
          try {
            body = await readBody(req);
          } catch {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too large' }));
            return;
          }
          let p = '';
          try { p = String(JSON.parse(body || '{}').p || ''); } catch { /* bad json */ }
          const fp = p ? safePath(ROOT, p) : null;
          if (!fp || fp === ROOT || isHiddenRel(relPosix(fp))) {
            res.writeHead(!fp || fp === ROOT ? 400 : 403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: !fp || fp === ROOT ? 'bad request' : 'forbidden' }));
            return;
          }
          const st = statSafe(fp);
          if (!st) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          try {
            if (st.isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
            else fs.unlinkSync(fp);
            invalidateTreeCache();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'delete failed' }));
          }
          return;
        }
        if (url.pathname === '/api/rename' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          let body: string;
          try {
            body = await readBody(req);
          } catch {
            res.writeHead(413, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'too large' }));
            return;
          }
          let from = '', to = '';
          try {
            const j = JSON.parse(body || '{}');
            from = String(j.from || '');
            to = String(j.to || '');
          } catch { /* bad json */ }
          const fromFp = from ? safePath(ROOT, from) : null;
          const toFp = to ? safePath(ROOT, to) : null;
          if (!fromFp || !toFp || fromFp === ROOT || toFp === ROOT) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'bad request' }));
            return;
          }
          if (isHiddenRel(relPosix(fromFp)) || isHiddenRel(relPosix(toFp))) {
            res.writeHead(403, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'forbidden' }));
            return;
          }
          try { fs.lstatSync(fromFp); } catch {
            // Missing source is a client error, not a server fault: without
            // this check renameSync throws ENOENT and the caller got 500
            // 'rename failed' (delete already answers 404 for the same case).
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'not found' }));
            return;
          }
          try {
            if (fs.existsSync(toFp)) {
              res.writeHead(409, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ error: 'destination already exists' }));
              return;
            }
            fs.mkdirSync(path.dirname(toFp), { recursive: true });
            fs.renameSync(fromFp, toFp);
            invalidateTreeCache();
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true }));
          } catch {
            res.writeHead(500, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'rename failed' }));
          }
          return;
        }
        // ---- project search (respects hidden rules + size caps) ----
        if (url.pathname === '/api/search' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          // Every other expensive route is throttled (exec:941, git-write:1215,
          // agents-install:757); search alone did a synchronous walk of up to
          // 2000 files per request with no limit — 1000 parallel POSTs stall
          // the event loop for seconds each.
          if (!throttle(req, 'search', 60)) { sendJson(res, 429, { error: 'rate limited, try again shortly' }); return; }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const q = typeof body.q === 'string' ? body.q : '';
          const useRegex = body.regex === true;
          if (!q || q.length > 200) { sendJson(res, 400, { error: 'query required (max 200 chars)' }); return; }
          let re: RegExp | null = null;
          try {
            re = useRegex ? new RegExp(q, 'i') : null;
          } catch {
            sendJson(res, 400, { error: 'bad pattern' });
            return;
          }
          // Literal path uses one precompiled case-insensitive regex: the old
          // `lines[i].toLowerCase().includes(...)` allocated a full copy of
          // every scanned line (O(line) garbage per line, ~2x total bytes).
          const litRe = re ?? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
          const out: Array<{ p: string; line: number; text: string }> = [];
          let filesSeen = 0;
          const walk = (dir: string, depth: number): void => {
            if (out.length >= 100 || filesSeen >= 2000 || depth > 8) return;
            let entries: fs.Dirent[];
            try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
            for (const e of entries) {
              if (out.length >= 100 || filesSeen >= 2000) return;
              if (e.isSymbolicLink()) continue;
              const full = path.join(dir, e.name);
              const rel = path.relative(ROOT, full).replace(/\\/g, '/');
              if (e.isDirectory()) {
                if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
                walk(full, depth + 1);
              } else {
                if (isHiddenRel(rel)) continue;
                if (e.name === '.gitignore') continue;
                filesSeen++;
                let st: fs.Stats;
                try { st = fs.statSync(full); } catch { continue; }
                if (!st.isFile() || st.size > 256 * 1024) continue;
                let raw: Buffer;
                try { raw = fs.readFileSync(full); } catch { continue; }
                if (raw.slice(0, 8192).includes(0)) continue;
                const lines = raw.toString('utf-8').split('\n');
                for (let i = 0; i < lines.length && out.length < 100; i++) {
                  const hit = re ? re.test(lines[i]) : litRe.test(lines[i]);
                  if (hit) out.push({ p: rel, line: i + 1, text: lines[i].slice(0, 200) });
                }
              }
            }
          };
          walk(ROOT, 0);
          sendJson(res, 200, { results: out, files: filesSeen, capped: out.length >= 100 });
          return;
        }
        // ---- local git (status / diff / commit / pull / init) ----
        if ((url.pathname === '/api/git/status' || url.pathname === '/api/git/diff') && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          // Unlike exec (MAX_EXECS=4 at :946) and git-write (:1215), this route
          // spawned one `git` child per request with no cap or throttle — a
          // request flood pinned up to N concurrent git processes for the full
          // 20s runGit timeout each.
          if (!throttle(req, 'git-read', 120)) { sendJson(res, 429, { error: 'rate limited, try again shortly' }); return; }
          const isDiff = url.pathname === '/api/git/diff';
          const rel = url.searchParams.get('p') || '';
          const args = isDiff
            ? ['diff', '--no-color', '--', ...(rel ? [rel] : [])]
            : ['status', '--porcelain=v1', '-b', '--untracked-files=normal'];
          const r = await runGit(args, 20000);
          if (r.exit !== 0 && /not a git repository/i.test(r.output)) {
            sendJson(res, 404, { error: 'not a git repo' });
            return;
          }
          if (r.exit !== 0) { sendJson(res, 502, { error: 'git failed' }); return; }
          if (!isDiff) {
            const lines = r.output.split('\n');
            let branch = '', ahead = 0, behind = 0;
            const files: Array<{ p: string; x: string; y: string }> = [];
            for (const ln of lines) {
              if (ln.startsWith('## ')) {
                // `## <branch>[...<upstream>][ [ahead N, behind M]]`. The old
                // anchored `^## ` regex was run against ln.slice(3) — the very
                // prefix it required had already been stripped — so it never
                // matched and branch/ahead/behind were always empty/0. Branch
                // names may contain dots, so split on the `...` upstream marker
                // instead of pattern-matching the name. Git never puts spaces
                // in refnames, so 'HEAD ' reliably identifies a detached HEAD.
                const rest = ln.slice(3);
                const up = rest.indexOf('...');
                const raw = up >= 0 ? rest.slice(0, up) : rest.split(' [')[0];
                branch = raw === 'HEAD' || raw.startsWith('HEAD ') ? '(detached)' : raw;
                const info = /\[ahead (\d+)(?:, behind (\d+))?\]|\[behind (\d+)\]/.exec(rest);
                if (info) {
                  ahead = parseInt(info[1] || '0', 10) || 0;
                  behind = parseInt(info[2] || info[3] || '0', 10) || 0;
                }
                continue;
              }
              if (ln.length > 3) files.push({ x: ln[0], y: ln[1], p: ln.slice(3).replace(/^"(.+)"$/, '$1') });
            }
            sendJson(res, 200, { branch, ahead, behind, files: files.slice(0, 500) });
          } else {
            sendJson(res, 200, { diff: r.output.slice(0, 100000), capped: r.output.length > 100000 });
          }
          return;
        }
        if ((url.pathname === '/api/git/commit' || url.pathname === '/api/git/pull' || url.pathname === '/api/git/init') && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          if (!throttle(req, 'git-write', 30)) {
            sendJson(res, 429, { error: 'rate limited, try again shortly' });
            return;
          }
          if (url.pathname === '/api/git/init') {
            const r = await runGit(['init'], 20000);
            if (r.exit !== 0) { sendJson(res, 502, { error: 'git init failed' }); return; }
            invalidateTreeCache();
            sendJson(res, 200, { ok: true });
            return;
          }
          if (url.pathname === '/api/git/pull') {
            const r = await runGit(['pull', '--ff-only'], 60000);
            if (r.exit !== 0) { sendJson(res, 502, { error: r.output.slice(-300) || 'git pull failed' }); return; }
            invalidateTreeCache();
            sendJson(res, 200, { ok: true, output: r.output.slice(-2000) });
            return;
          }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const message = typeof body.message === 'string' ? body.message.trim().slice(0, 500) : '';
          if (!message) { sendJson(res, 400, { error: 'commit message required' }); return; }
          const add = await runGit(['add', '-A'], 30000);
          if (add.exit !== 0) { sendJson(res, 502, { error: 'git add failed' }); return; }
          const commit = await runGit(['commit', '-m', message], 30000);
          if (commit.exit !== 0) { sendJson(res, 502, { error: commit.output.slice(-300) || 'git commit failed' }); return; }
          invalidateTreeCache();
          sendJson(res, 200, { ok: true, output: commit.output.slice(-2000) });
          return;
        }
        // ---- GitHub account unit ----
        if (url.pathname === '/api/github/status' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 200, { connected: false, username: null, selectedRepo: getSelectedRepo() }); return; }
          try {
            const info = await cachedTokenInfo(token);
            if (info.login && info.login !== loadConfig().githubUsername) {
              try { setGitHubUsername(info.login); } catch { /* noop */ }
            }
            sendJson(res, 200, { connected: true, username: info.login, name: info.name || null, avatar: info.avatar || null, selectedRepo: getSelectedRepo(), tokenKind: info.kind, appLogin: gh.isGitHubAppToken(token) });
          } catch (e) {
            if ((e as any)?.statusCode === 401) {
              try { clearToken(); } catch { /* noop */ }
              try { clearGitHubUser(); } catch { /* noop */ }
              sendJson(res, 401, { error: 'Session expired — please log in again', expired: true });
              return;
            }
            sendJson(res, 200, { connected: false, username: null, selectedRepo: getSelectedRepo(), stale: true });
          }
          return;
        }
        if (url.pathname === '/api/github/device/start' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          try {
            const flow = await gh.startDeviceFlow();
            sendJson(res, 200, flow);
          } catch (e) { ghError(res, e); }
          return;
        }
        if (url.pathname === '/api/github/device/poll' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          if (!throttle(req, 'device-poll', 30)) {
            sendJson(res, 429, { authorized: false, status: 'slow_down', interval: 5 });
            return;
          }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const dc = typeof body.device_code === 'string' ? body.device_code : '';
          if (!dc) { sendJson(res, 400, { error: 'device_code required' }); return; }
          // Real GitHub device codes are ~40 chars, but readBody accepts bodies
          // up to 5MB — and dc becomes a devicePolls map key below, so 200
          // oversized codes would pin ~1GB in the map until the clear().
          if (dc.length > 256) { sendJson(res, 400, { error: 'bad device_code' }); return; }
          const now = Date.now();
          const last = devicePolls.get(dc) || 0;
          if (now - last < 4000) {
            sendJson(res, 429, { authorized: false, status: 'slow_down', interval: 5 });
            return;
          }
          devicePolls.set(dc, now);
          if (devicePolls.size > 200) devicePolls.clear();
          try {
            const r = await gh.pollDeviceOnce(dc);
            if (r.status === 'authorized') {
              invalidateTokenKind();
              saveToken(r.token);
              // Verify the granted scopes instead of assuming `repo`: the
              // device request asks for it, but the stored kind must reflect
              // what GitHub actually granted.
              const checked = await gh.getTokenScopes(r.token);
              const kind = gh.classifyTokenKind(checked.scopes);
              setGitHubUsername(checked.login);
              tokenKindCache.set(tokenKindKey(r.token), { at: Date.now(), kind, login: checked.login, name: checked.name, avatar: checked.avatar_url });
              sendJson(res, 200, { authorized: true, username: checked.login, name: checked.name || null, avatar: checked.avatar_url || null, tokenKind: kind, appLogin: true });
            } else if (r.status === 'error') {
              sendJson(res, 400, { authorized: false, error: r.error, fatal: r.fatal });
            } else {
              sendJson(res, 200, { authorized: false, status: r.status, ...(r.status === 'slow_down' ? { interval: r.interval } : {}) });
            }
          } catch (e) {
            const sc = (e as any)?.statusCode;
            if (sc === 401 || sc === 403) { ghError(res, e); return; }
            sendJson(res, 503, { authorized: false, status: 'retry' });
          }
          return;
        }
        if (url.pathname === '/api/github/token' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          if (!throttle(req, 'github-token', 20)) {
            sendJson(res, 429, { error: 'rate limited, try again shortly' });
            return;
          }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const t = typeof body.token === 'string' ? body.token.trim() : '';
          if (!t || t.length > 500) { sendJson(res, 400, { error: 'token required' }); return; }
          try {
            const checked = await gh.getTokenScopes(t);
            // Fail fast: never store a token that cannot create repositories.
            // A saved login must be able to use every GitHub feature in settings.
            const guard = gh.saveGuard(checked.scopes, t);
            if (guard) { sendJson(res, 403, { error: guard }); return; }
            saveToken(t);
            setGitHubUsername(checked.login);
            tokenKindCache.set(tokenKindKey(t), { at: Date.now(), kind: gh.classifyTokenKind(checked.scopes), login: checked.login, name: checked.name, avatar: checked.avatar_url });
            sendJson(res, 200, { username: checked.login, name: checked.name || null, avatar: checked.avatar_url || null, tokenKind: gh.classifyTokenKind(checked.scopes), appLogin: false });
          } catch (e) {
            if ((e as any)?.statusCode === 401) {
              sendJson(res, 401, { error: 'Session expired — please log in again', expired: true });
            } else {
              sendJson(res, 401, { error: 'invalid token' });
            }
          }
          return;
        }
        if (url.pathname === '/api/github/cli' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          if (!throttle(req, 'github-cli', 10)) {
            sendJson(res, 429, { error: 'rate limited, try again shortly' });
            return;
          }
          // Import this device's existing GitHub login: GitHub CLI first,
          // then the stored git credential (covers GitHub Desktop sessions,
          // which register with the platform credential helper). The first
          // token that passes the creation-capability gate wins; nothing
          // incapable is ever stored.
          const candidates: Array<{ source: string; token: string }> = [];
          let ghMissing = false;
          try {
            const g = await execFileTimeout('gh', ['auth', 'token'], { timeoutMs: 10000 });
            if (g.exit === 127 && /ENOENT|not found/i.test(g.stderr)) ghMissing = true;
            const tok = (g.stdout || '').trim();
            if (g.exit === 0 && tok.length >= 10 && tok.length <= 500) {
              candidates.push({ source: 'GitHub CLI', token: tok });
            }
          } catch { /* treat as unavailable below */ }
          try {
            const c = await execFileTimeout('git', ['credential', 'fill'], {
              input: 'protocol=https\nhost=github.com\n\n', timeoutMs: 8000, env: { GIT_TERMINAL_PROMPT: '0' },
            });
            const parsed = gh.parseGitCredentialOutput(c.stdout || '');
            if (c.exit === 0 && parsed && parsed.password.length >= 10 && parsed.password.length <= 500) {
              candidates.push({ source: 'git credential store', token: parsed.password });
            }
          } catch { /* no stored credential */ }
          let lastErr = '';
          for (const cand of candidates) {
            try {
              const checked = await gh.getTokenScopes(cand.token);
              const guard = gh.saveGuard(checked.scopes, cand.token);
              if (guard) { lastErr = cand.source + ': ' + guard; continue; }
              saveToken(cand.token);
              setGitHubUsername(checked.login);
              const kind = gh.classifyTokenKind(checked.scopes);
              tokenKindCache.set(tokenKindKey(cand.token), { at: Date.now(), kind, login: checked.login, name: checked.name, avatar: checked.avatar_url });
              sendJson(res, 200, { username: checked.login, name: checked.name || null, avatar: checked.avatar_url || null, tokenKind: kind, appLogin: false, source: cand.source });
              return;
            } catch (e) {
              lastErr = cand.source + ': ' + (((e as any)?.statusCode === 401) ? 'stored login expired' : 'validation failed');
            }
          }
          if (!candidates.length) {
            sendJson(res, 404, {
              error: ghMissing
                ? 'No GitHub login found on this device — install GitHub CLI and run `gh auth login`, sign in once with git, then retry.'
                : 'GitHub CLI is present but not logged in — run `gh auth login`, then retry. (A stored git credential for github.com works too.)',
            });
            return;
          }
          sendJson(res, 403, { error: lastErr || 'stored logins cannot create repositories' });
          return;
        }
        if (url.pathname === '/api/github/logout' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          try { invalidateTokenKind(ghToken() || undefined); } catch { /* noop */ }
          try { clearToken(); } catch { /* noop */ }
          try { clearGitHubUser(); } catch { /* noop */ }
          sendJson(res, 200, { ok: true });
          return;
        }
        if (url.pathname === '/api/github/repos' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          try {
            const per = Math.max(1, Math.min(100, parseInt(url.searchParams.get('per_page') || '50', 10) || 50));
            const page = Math.max(1, parseInt(url.searchParams.get('page') || '1', 10) || 1);
            const sort = url.searchParams.get('sort') || 'updated';
            const repos = await gh.getRepos(token, { per_page: per, page, sort });
            sendJson(res, 200, (repos || []).map((r: any) => ({
              name: r.name, full_name: r.full_name, html_url: r.html_url, private: !!r.private,
              description: r.description ?? null, default_branch: r.default_branch || 'main',
              updated_at: r.updated_at || null,
            })));
          } catch (e) { ghError(res, e); }
          return;
        }
        if (url.pathname === '/api/github/repos' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const name = typeof body.name === 'string' ? body.name.trim() : '';
          const description = typeof body.description === 'string' ? body.description.slice(0, 350) : '';
          const isPrivate = body.private === true;
          if (!gh.isValidRepoName(name)) { sendJson(res, 400, { error: 'invalid repo name (A-Z a-z 0-9 . _ -)' }); return; }
          try {
            // Fail fast: fine-grained PATs can never create repos (GitHub platform
            // limit) — no point burning a doomed API call; stale logins re-hit this
            // after logout/login with the same token type.
            try {
              const kind = (await cachedTokenInfo(token)).kind;
              const blocked = gh.createBlockedMessage(token, kind);
              if (blocked) { sendJson(res, 403, { error: blocked, tokenKind: kind, appLogin: gh.isGitHubAppToken(token) }); return; }
            } catch { /* scope probe failed — fall through to the real call */ }
            const repo: any = await gh.createRepo(token, name, description, isPrivate);
            try { setSelectedRepo(repo.full_name); } catch { /* noop */ }
            sendJson(res, 200, { name: repo.name, full_name: repo.full_name, html_url: repo.html_url, private: !!repo.private });
          } catch (e) {
            const friendly = gh.friendlyActionError(e, 'create repositories');
            if (friendly) { sendJson(res, 403, { error: friendly }); return; }
            ghError(res, e);
          }
          return;
        }
        if (url.pathname === '/api/github/repo' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const parsed = gh.parseRepoFull(url.searchParams.get('full') || '');
          if (!parsed) { sendJson(res, 400, { error: 'bad repo (owner/name)' }); return; }
          try {
            const [r, topics] = await Promise.all([
              gh.getRepoFull(token, parsed.owner, parsed.repo) as Promise<any>,
              gh.getTopics(token, parsed.owner, parsed.repo).catch((): string[] => []),
            ]);
            sendJson(res, 200, {
              name: r.name, full_name: r.full_name, html_url: r.html_url, private: !!r.private,
              description: r.description ?? null, homepage: r.homepage ?? null,
              default_branch: r.default_branch || 'main',
              has_issues: !!r.has_issues, has_projects: !!r.has_projects, has_wiki: !!r.has_wiki,
              allow_squash_merge: !!r.allow_squash_merge, allow_merge_commit: !!r.allow_merge_commit,
              allow_rebase_merge: !!r.allow_rebase_merge, delete_branch_on_merge: !!r.delete_branch_on_merge,
              archived: !!r.archived, topics,
              stargazers_count: r.stargazers_count || 0, forks_count: r.forks_count || 0,
              open_issues_count: r.open_issues_count || 0, updated_at: r.updated_at || null,
            });
          } catch (e) { ghError(res, e); }
          return;
        }
        if (url.pathname === '/api/github/repo' && req.method === 'PATCH') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const parsed = gh.parseRepoFull(typeof body.full === 'string' ? body.full : '');
          if (!parsed) { sendJson(res, 400, { error: 'bad repo (owner/name)' }); return; }
          const patch = gh.sanitizeRepoPatch(body.patch);
          const topicsRaw = body.topics;
          if (Object.keys(patch).length === 0 && topicsRaw === undefined) {
            sendJson(res, 400, { error: 'no valid fields to update' }); return;
          }
          try {
            let r: any = null;
            if (Object.keys(patch).length) r = await gh.updateRepo(token, parsed.owner, parsed.repo, patch);
            let topics: string[] | null = null;
            if (topicsRaw !== undefined) {
              const clean = gh.sanitizeTopics(topicsRaw);
              if (clean === null) { sendJson(res, 400, { error: 'invalid topics' }); return; }
              topics = await gh.setTopics(token, parsed.owner, parsed.repo, clean);
            }
            if (!r) r = await gh.getRepoFull(token, parsed.owner, parsed.repo);
            if (patch.name && r.full_name) { try { setSelectedRepo(r.full_name); } catch { /* noop */ } }
            sendJson(res, 200, {
              name: r.name, full_name: r.full_name, html_url: r.html_url, private: !!r.private,
              description: r.description ?? null, homepage: r.homepage ?? null,
              default_branch: r.default_branch || 'main',
              has_issues: !!r.has_issues, has_projects: !!r.has_projects, has_wiki: !!r.has_wiki,
              allow_squash_merge: !!r.allow_squash_merge, allow_merge_commit: !!r.allow_merge_commit,
              allow_rebase_merge: !!r.allow_rebase_merge, delete_branch_on_merge: !!r.delete_branch_on_merge,
              archived: !!r.archived, topics: topics ?? undefined,
            });
          } catch (e) { ghError(res, e); }
          return;
        }
        if (url.pathname === '/api/github/branches' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const parsed = gh.parseRepoFull(url.searchParams.get('full') || '');
          if (!parsed) { sendJson(res, 400, { error: 'bad repo (owner/name)' }); return; }
          try {
            const list = await gh.listBranches(token, parsed.owner, parsed.repo);
            sendJson(res, 200, (list || []).map((b: any) => ({ name: b.name, sha: b.commit?.sha?.slice(0, 7) || '' })));
          } catch (e) {
            // Empty repo: branch listing is legitimately empty, not an error.
            if (gh.isEmptyRepo(e)) { sendJson(res, 200, []); return; }
            ghError(res, e);
          }
          return;
        }
        if (url.pathname === '/api/github/select' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const full = typeof body.full === 'string' ? body.full.trim() : '';
          const parsed = gh.parseRepoFull(full);
          if (!parsed) { sendJson(res, 400, { error: 'bad repo (owner/name)' }); return; }
          try {
            await gh.getRepo(token, parsed.owner, parsed.repo);
            setSelectedRepo(`${parsed.owner}/${parsed.repo}`);
            sendJson(res, 200, { selectedRepo: `${parsed.owner}/${parsed.repo}` });
          } catch (e) { ghError(res, e); }
          return;
        }
        // ---- push file preview (what a push would send — same collector) ----
        if (url.pathname === '/api/github/push/files' && req.method === 'GET') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const files = collectProjectFiles(ROOT);
          const list: Array<{ p: string; bytes: number }> = [];
          let totalBytes = 0;
          for (const [rel, content] of files) {
            const b = Buffer.byteLength(content);
            totalBytes += b;
            if (list.length < 500) list.push({ p: rel, bytes: b });
          }
          sendJson(res, 200, { files: list, total: files.size, totalBytes, capped: files.size > 500 });
          return;
        }
        if (url.pathname === '/api/github/push' && req.method === 'POST') {
          if (!needAuth(req, url, res)) return;
          const token = ghToken();
          if (!token) { sendJson(res, 409, { error: 'github not connected' }); return; }
          const body = await parseJsonBody(req);
          if (!body) { sendJson(res, 400, { error: 'invalid json' }); return; }
          const fullRaw = typeof body.full === 'string' && body.full.trim() ? body.full.trim() : (getSelectedRepo() || '');
          const parsed = gh.parseRepoFull(fullRaw);
          if (!parsed) { sendJson(res, 400, { error: 'no repo selected' }); return; }
          try {
            const files = collectProjectFiles(ROOT);
            if (files.size === 0) { sendJson(res, 400, { error: 'no files to push' }); return; }
            const branch = await gh.pushFiles(token, parsed.owner, parsed.repo, files, sanitizePushMessage(body && body.message));
            invalidateTreeCache();
            sendJson(res, 200, { branch, url: `https://github.com/${parsed.owner}/${parsed.repo}/tree/${branch}`, files: files.size });
          } catch (e) {
            const friendly = gh.friendlyActionError(e, 'push to this repository');
            if (friendly) { sendJson(res, 403, { error: friendly }); return; }
            ghError(res, e);
          }
          return;
        }
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Not found');
      } catch (e) {
        try {
          if (!res.headersSent) {
            res.writeHead(500, { 'Content-Type': 'text/plain' });
          }
          if (!res.writableEnded) res.end('Server error');
        } catch { /* already sent */ }
      }
    });
    if (WsMod && ptyMod) {
      const WSS = WsMod.Server;
      const wssPty = new WSS({ noServer: true });
      const wssLsp = new WSS({ noServer: true });
      server.on('upgrade', (req: any, socket: any, head: any) => {
        let url: URL;
        try { url = new URL(req.url || '/', 'http://x'); } catch { try { socket.destroy(); } catch {} return; }
        const ok = wsAuthed(req, url);
        const deny = () => { try { socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n'); socket.destroy(); } catch {} };
        if (url.pathname === '/api/pty') {
          if (!ok) { deny(); return; }
          wssPty.handleUpgrade(req, socket, head, (ws: any) => ptyAccept(ws, url));
        } else if (url.pathname === '/api/lsp') {
          if (!ok) { deny(); return; }
          wssLsp.handleUpgrade(req, socket, head, (ws: any) => lspAccept(ws, url));
        } else { try { socket.destroy(); } catch {} }
      });
    }
    server.on('error', (e: any) => {
      if (e.code === 'EADDRINUSE') {
        console.error(`Port ${port} in use. Try: node dist/server.js --port=3001 (or PORT=3001 npm run serve)`);
        process.exit(1);
      }
      if (e.code === 'EACCES') {
        // Binding a privileged port (<1024, non-root) used to fall through to
        // rejectPromise → .catch(console.error): raw stack, exit code 0 —
        // scripts/CI saw a successful start. Mirror the EADDRINUSE branch.
        console.error(`Permission denied binding port ${port} (ports <1024 need elevated privileges). Try --port=3001.`);
        process.exit(1);
      }
      rejectPromise(e);
    });
    let shuttingDown = false;
    const shutdown = (sig: string) => {
      if (shuttingDown) return;
      shuttingDown = true;
      console.log(`\nReceived ${sig} — shutting down…`);
      try {
        for (const [, s] of ptySessions) { try { s.ws.close(); } catch {} try { s.pty.kill(); } catch {} }
        ptySessions.clear();
      } catch { /* noop */ }
      try {
        for (const p of runningExecs) { try { p.kill('SIGTERM'); } catch {} }
        runningExecs.clear();
      } catch { /* noop */ }
      activeExecs = 0;
      server.close(() => process.exit(0));
      setTimeout(() => process.exit(0), 5000).unref?.();
    };
    process.once('SIGTERM', () => shutdown('SIGTERM'));
    process.once('SIGINT', () => shutdown('SIGINT'));
    server.listen(port, host, () => {
      const version = getVersion();
      console.log(`\nTypeWriter web editor v${version}:`);
      console.log(`  Local: http://${host}:${port}`);
      console.log(`  Auth: ${AUTH_TOKEN ? 'ON (TYPEWRITER_TOKEN set)' : 'OFF — set TYPEWRITER_TOKEN to require a token'}`);
      if (!AUTH_TOKEN) console.log(`  ⚠  exec endpoint disabled without TYPEWRITER_TOKEN`);
      if (host === '0.0.0.0') console.log(`  ⚠  listening on all interfaces — set TYPEWRITER_TOKEN`);
      console.log('');
      resolve();
    });
  });
}

if (require.main === module) {
  const portArg = process.argv.find(a => a.startsWith('--port='));
  const hostArg = process.argv.find(a => a.startsWith('--host='));
  const rawPort = portArg ? portArg.split('=')[1] : (process.env.PORT || '');
  // Mirror the identical guard in src/index.ts (--serve path): unvalidated
  // parseInt let `--port=99999` reach server.listen and die with a raw
  // ERR_SOCKET_BAD_PORT stack through the .catch() below, while `--port=abc`
  // silently bound 3000 instead of reporting the typo. Must be 0-65535.
  const port = rawPort === '' && !portArg ? 3000 : parseInt(rawPort, 10);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    console.error(`Invalid port: ${rawPort} (expected 0-65535)`);
    process.exit(1);
  }
  // `--host=` (empty value) must not bind every interface: listen(port, '')
  // resolves to '::' — all interfaces — silently skipping the 0.0.0.0 warning
  // below. Fall back through HOST to the loopback default instead.
  const host = (hostArg ? hostArg.split('=')[1] : process.env.HOST) || '127.0.0.1';
  startServer(port, host).catch(console.error);
}
