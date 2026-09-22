import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as readline from 'readline';
import { spawn, spawnSync } from 'child_process';
import { shellFor, shellQuote, runnerFor, taskkillArgs } from './winsh';
import { highlightLine, stripAnsi, HighlightPalette } from './highlight';
import { suggestCompletion } from './complete';
import { getLanguageFromExt, getFileExtension, readFileSync, writeFileSync, fileExists, loadConfig, saveConfig, isBinaryFile, loadSession, saveSession, scheduleSessionSave, flushSession } from './utils';
import { THEME_NAMES, getTheme, DEFAULT_THEME, isThemeName } from './themes';
import { RingBuffer, LinkedStack } from './structures';

/* Theme set copied from opencode (packages/tui/src/theme/assets/*.json, dark variant).
 * Active theme is `T`; switch with `:theme <name>` (persisted to ~/.typewriter/config.json). */
let themeName: string = DEFAULT_THEME;
try {
  const cfgTheme = loadConfig().theme;
  if (cfgTheme && isThemeName(cfgTheme)) themeName = cfgTheme;
} catch { /* keep default */ }
let T = getTheme(themeName);
let cachedPal: HighlightPalette = {};
function rebuildPal(): void {
  cachedPal = {
    keyword: T.synK, string: T.synS, number: T.synN, function: T.synF,
    variable: T.synV, type: T.synT, operator: T.synO, comment: T.synC,
    punctuation: T.synP,
  };
}
rebuildPal();

/** Highlighted-row cache: identical lines share one highlight pass + width walk.
 * Nested per-language maps avoid the `lang + '\n' + raw` concat (an O(len)
 * alloc per row per frame even on a cache hit). Values carry the visible
 * width so paint skips stripAnsi + re-walk on hits. */
interface HlEntry { h: string; w: number }
const hlCache = new Map<string, Map<string, HlEntry>>();
let hlCacheSize = 0;
function hlEntry(raw: string, lang: string): HlEntry {
  let perLang = hlCache.get(lang);
  if (perLang) {
    const hit = perLang.get(raw);
    if (hit) return hit;
  } else {
    perLang = new Map<string, HlEntry>();
    hlCache.set(lang, perLang);
  }
  const h = highlightLine(raw, lang, cachedPal);
  const entry: HlEntry = { h, w: strWidth(h) };
  if (hlCacheSize > 2000) {
    hlCache.clear();
    hlCacheSize = 0;
    perLang = new Map<string, HlEntry>();
    hlCache.set(lang, perLang);
  }
  perLang.set(raw, entry);
  hlCacheSize++;
  return entry;
}
function highlightCached(raw: string, lang: string): string {
  return hlEntry(raw, lang).h;
}

export function getThemeName(): string { return themeName; }
export function listThemeNames(): string[] { return [...THEME_NAMES]; }
export function setTheme(name: string): boolean {
  if (!isThemeName(name)) return false;
  themeName = name;
  T = getTheme(name);
  rebuildPal();
  hlCache.clear();
  hlCacheSize = 0;
  try {
    const cfg = loadConfig();
    cfg.theme = name;
    saveConfig(cfg);
  } catch { /* non-fatal */ }
  try { scheduleSessionSave({ theme: name }); } catch { /* non-fatal */ }
  return true;
}

/* Theme ANSI sequences, memoized: fg()/bg() run dozens of times per frame and
 * used to pay a RegExp test + 3x parseInt on every call. The palette is a
 * small fixed set, so cache each resolved sequence (cap 64, theme switches
 * repopulate lazily). */
const _ansiSeq = new Map<string, string>();
function _seq(kind: 38 | 48, h: string): string {
  const key = kind + h;
  const hit = _ansiSeq.get(key);
  if (hit !== undefined) return hit;
  let seq: string;
  if (/^#[0-9a-fA-F]{6}$/.test(h)) {
    seq = `\x1b[${kind};2;${parseInt(h.slice(1, 3), 16)};${parseInt(h.slice(3, 5), 16)};${parseInt(h.slice(5, 7), 16)}m`;
  } else {
    seq = kind === 38 ? '\x1b[38;2;255;255;255m' : '\x1b[48;2;255;255;255m';
  }
  if (_ansiSeq.size > 64) _ansiSeq.clear();
  _ansiSeq.set(key, seq);
  return seq;
}
const fg = (h: string) => _seq(38, h);
const bg = (h: string) => _seq(48, h);
const RESET = '\x1b[0m';
const REV = '\x1b[7m';
const BOLD = '\x1b[1m';
/** Display width: CJK/emoji count 2, combining marks 0, everything else 1. */
function strWidth(s: string): number {
  const t = stripAnsi(s);
  let w = 0;
  for (const ch of t) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0) continue;
    if (
      (cp >= 0x0300 && cp <= 0x036f) || (cp >= 0x1ab0 && cp <= 0x1aff) ||
      (cp >= 0x1dc0 && cp <= 0x1dff) || (cp >= 0x20d0 && cp <= 0x20ff) ||
      (cp >= 0xfe20 && cp <= 0xfe2f)
    ) continue;
    if (
      (cp >= 0x1100 && cp <= 0x115f) || cp === 0x2329 || cp === 0x232a ||
      (cp >= 0x2e80 && cp <= 0xa4cf && cp !== 0x303f) ||
      (cp >= 0xac00 && cp <= 0xd7a3) || (cp >= 0xf900 && cp <= 0xfaff) ||
      (cp >= 0xfe30 && cp <= 0xfe4f) || (cp >= 0xff00 && cp <= 0xff60) ||
      (cp >= 0xffe0 && cp <= 0xffe6) || cp > 0xffff
    ) w += 2;
    else w += 1;
  }
  return w;
}
const visLen = (s: string) => strWidth(s);
const padVis = (s: string, w: number) => {
  const len = visLen(s);
  return len >= w ? s : s + ' '.repeat(w - len);
};
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
/** Files larger than this are refused in the TUI (use the web editor instead). */
const MAX_OPEN_BYTES = 5 * 1024 * 1024;
function isWordChar(c: string): boolean {
  const code = c.charCodeAt(0);
  return (code >= 48 && code <= 57) || (code >= 65 && code <= 90) ||
    (code >= 97 && code <= 122) || code === 95;
}

type VimMode = 'normal' | 'insert' | 'command' | 'search';
type Focus = 'tree' | 'edit' | 'term';

interface Buf {
  filePath: string | null;
  lines: string[];
  lang: string;
  modified: boolean;
  cx: number; cy: number; sx: number; sy: number;
}

interface TreeEntry { rel: string; full: string; name: string; depth: number; isDir: boolean }

const SKIP = new Set(['node_modules', '.git', 'dist', 'build', '.vscode', '.idea']);

let buf: Buf = { filePath: null, lines: [''], lang: 'text', modified: false, cx: 0, cy: 0, sx: 0, sy: 0 };
let vim: VimMode = 'normal';
let focus: Focus = 'edit';
let cmdBuf = '';
let searchBuf = '';
let matches: { line: number; col: number }[] = [];
let matchIdx = -1;
let matchCapped = false;
let msg = '';
let msgTimer: NodeJS.Timeout | null = null;
let started = false;

let tree: TreeEntry[] = [];
let treeSel = 0;
let treeScroll = 0;
let treeVisible = true;

let termOpen = false;
/** Scrollback ring: O(1) push, overwrites oldest past 500 — no slice copies. */
const termLines = new RingBuffer<string>(500);
let termInput = '';
let termCursor = 0;
let termHist: string[] = [];
let termHistIdx = -1;
let termDraft = '';
let termBusy = false;
let termCwd = process.cwd();
let termPrevCwd = process.cwd();
let termHeight = 10;
let termMaxed = false;
let termScroll = 0; // 0 = follow tail; >0 = lines scrolled up
let termChild: any = null;
let termStartedAt = 0;
let leader = false;
let leaderTimer: NodeJS.Timeout | null = null;

interface Snap { lines: string[]; cx: number; cy: number }
/** Undo/redo as capped linked-list stacks: O(1) push/pop/evict, no shift(). */
let undoStack = new LinkedStack<Snap>(100);
let redoStack = new LinkedStack<Snap>(100);
let lastInsertSnapshot = 0;

function say(m: string, sticky = false): void {
  msg = m;
  if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
  if (!sticky && m) {
    msgTimer = setTimeout(() => { msg = ''; msgTimer = null; paint(); }, 4000);
    if (msgTimer.unref) msgTimer.unref();
  }
}

function armLeader(): void {
  leader = true;
  if (leaderTimer) clearTimeout(leaderTimer);
  leaderTimer = setTimeout(() => { leader = false; leaderTimer = null; }, 1200);
  if (leaderTimer.unref) leaderTimer.unref();
}
function clearLeader(): void {
  leader = false;
  if (leaderTimer) { clearTimeout(leaderTimer); leaderTimer = null; }
}

function snapshotCoalesced(forInsert: boolean): void {
  const now = Date.now();
  if (forInsert && now - lastInsertSnapshot < 1500 && undoStack.length > 0) {
    redoStack.clear();
    return;
  }
  undoStack.push({ lines: [...buf.lines], cx: buf.cx, cy: buf.cy });
  redoStack.clear();
  if (forInsert) lastInsertSnapshot = now;
  maybePersistUndo();
}

function snapshot(): void {
  snapshotCoalesced(false);
}

function undo(): void {
  visualExit();
  const s = undoStack.pop();
  if (!s) return say('Nothing to undo', true);
  redoStack.push({ lines: [...buf.lines], cx: buf.cx, cy: buf.cy });
  buf.lines = s.lines; buf.cx = s.cx; buf.cy = s.cy;
  buf.modified = true;
  say('Undo');
}

function redo(): void {
  visualExit();
  const s = redoStack.pop();
  if (!s) return say('Nothing to redo', true);
  undoStack.push({ lines: [...buf.lines], cx: buf.cx, cy: buf.cy });
  buf.lines = s.lines; buf.cx = s.cx; buf.cy = s.cy;
  buf.modified = true;
  say('Redo');
}

const curLine = () => buf.lines[buf.cy] ?? '';
const clampCur = () => { buf.cx = clamp(buf.cx, 0, curLine().length); };

const cmpStr = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

function buildTree(): void {
  const out: TreeEntry[] = [];
  const walk = (dir: string, depth: number) => {
    if (depth > 5 || out.length > 1000) return;
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    const dirs: fs.Dirent[] = [];
    const files: fs.Dirent[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue;
      if (e.isDirectory()) dirs.push(e);
      else files.push(e);
    }
    dirs.sort((a, b) => cmpStr(a.name, b.name));
    files.sort((a, b) => cmpStr(a.name, b.name));
    const pushList = (list: fs.Dirent[], isDir: boolean) => {
      for (const e of list) {
        if (out.length > 1000) return;
        if (e.name.startsWith('.') && e.name !== '.gitignore') continue;
        if (isDir && SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        const rel = path.relative(process.cwd(), full).replace(/\\/g, '/');
        out.push({ rel, full: path.resolve(full), name: e.name, depth, isDir });
        if (isDir) walk(full, depth + 1);
      }
    };
    pushList(dirs, true);
    pushList(files, false);
  };
  walk(process.cwd(), 0);
  tree = out;
  if (out.length > 1000) say(`File tree truncated at 1000 entries`, true);
  treeSel = clamp(treeSel, 0, Math.max(0, tree.length - 1));
  treeScroll = clamp(treeScroll, 0, Math.max(0, tree.length - 1));
}

function setLangFor(p: string): void {
  const base = path.basename(p).toLowerCase();
  buf.lang = base === 'dockerfile' ? 'dockerfile' : getLanguageFromExt(getFileExtension(p));
}

function resetBufState(): void {
  buf.cx = 0; buf.cy = 0; buf.sx = 0; buf.sy = 0;
  buf.modified = false;
  undoStack.clear();
  redoStack.clear();
  matches = [];
  matchIdx = -1;
  matchCapped = false;
}

function openFile(filePath: string): boolean {
  if (buf.modified) {
    say('Unsaved changes — :w first or :q!', true);
    return false;
  }
  try {
    const resolved = path.resolve(filePath);
    if (fileExists(resolved)) {
      if (isBinaryFile(resolved)) {
        say(`Binary file — cannot edit ${path.basename(resolved)}`, true);
        return false;
      }
      const data = fs.readFileSync(resolved);
      if (data.length > MAX_OPEN_BYTES) {
        say(`${path.basename(resolved)} is too large to open (${(data.length / 1048576).toFixed(1)}MB) — use the web editor`, true);
        return false;
      }
      buf.lines = data.toString('utf-8').split(/\r?\n/);
    } else {
      buf.lines = [''];
    }
    if (!buf.lines.length) buf.lines = [''];
    buf.filePath = resolved;
    setLangFor(resolved);
    resetBufState();
    restoreUndo();
    syncEntry();
    say(fileExists(resolved) ? `Opened ${path.basename(resolved)}` : `New file ${path.basename(resolved)}`);
    return true;
  } catch (err) {
    say(`Error: ${(err as Error).message}`, true);
    return false;
  }
}

function saveFile(): boolean {
  if (!buf.filePath) { say('No file name — use :w <filename>', true); return false; }
  try {
    writeFileSync(buf.filePath, buf.lines.join('\n'));
    buf.modified = false;
    persistUndo();
    say(`Saved ${path.basename(buf.filePath)}`);
    return true;
  } catch (err) {
    say(`Save failed: ${(err as Error).message}`, true);
    return false;
  }
}

function size(): { w: number; h: number } {
  return { w: process.stdout.columns || 80, h: process.stdout.rows || 24 };
}

/* ---------- rendering ---------- */

function paintHeader(row: string[], w: number): void {
  const name = buf.filePath ? path.basename(buf.filePath) : 'untitled';
  const t = `${fg(T.primary)}${BOLD}TYPE${fg(T.muted)}WRITER${RESET}  ${fg(T.muted)}${name}${buf.modified ? fg(T.yellow) + ' [+]' : ''}${RESET}`;
  row.push(padVis(t, w));
}

function syncTreeScroll(vis: number): void {
  if (treeScroll > treeSel) treeScroll = treeSel;
  if (treeSel >= treeScroll + vis) treeScroll = treeSel - vis + 1;
}

function syncCodeScroll(vis: number, ew: number, B: Buf = buf): void {
  if (B.cy < B.sy) B.sy = B.cy;
  if (B.cy >= B.sy + vis) B.sy = B.cy - vis + 1;
  if (B.cx < B.sx) B.sx = B.cx;
  if (B.cx >= B.sx + ew) B.sx = B.cx - ew + 1;
}

function paintTreeRow(y: number, tw: number): string {
  const idx = treeScroll + (y - 1);
  const e = tree[idx];
  if (!e) return ' '.repeat(tw);
  const label = `${'  '.repeat(e.depth)}${e.isDir ? '▸ ' : ''}${e.name}`.slice(0, tw);
  if (idx === treeSel && focus === 'tree') {
    return bg(T.primary) + fg(T.primaryText) + BOLD + padVis(label, tw) + RESET;
  } else if (buf.filePath && !e.isDir && e.full === buf.filePath) {
    return padVis(fg(T.primary) + label + RESET, tw);
  } else if (e.isDir) {
    return padVis(fg(T.secondary) + label + RESET, tw);
  }
  return padVis(fg(T.muted) + label + RESET, tw);
}

let ghostText = '';
let ghostKey = '';
/** Ghost suffix for the active cursor row (empty unless caret sits at end of line). */
function ghostFor(B: Buf, isActive: boolean): string {
  if (!isActive || focus !== 'edit') { return ''; }
  const line = B.lines[B.cy] ?? '';
  if (B.cx !== line.length) return '';
  const key = B.lang + '\n' + B.cy + '\n' + line;
  if (key === ghostKey) return ghostText;
  ghostKey = key;
  const c = suggestCompletion({ prefix: line, after: '', lines: B.lines, lang: B.lang });
  ghostText = c ? c.text : '';
  return ghostText;
}
/** Append as many ghost chars as fit in the remaining width (width-safe). */
function fitGhost(ghost: string, used: number, ew: number): { s: string; w: number } {
  let w = 0;
  let out = '';
  for (const ch of ghost) {
    const cw = strWidth(ch);
    if (used + w + cw > ew) break;
    out += ch;
    w += cw;
  }
  return { s: out, w };
}
function paintCodeRow(y: number, sy: number, digits: number, ew: number, cw: number, B: Buf = buf, isActive = false, liveSel = true): string {
  const idx = sy + (y - 1);
  if (idx >= B.lines.length) return ' '.repeat(cw);
  const n = String(idx + 1).padStart(digits, ' ');
  const num = idx === B.cy ? fg(T.primary) + BOLD + n + RESET : fg(T.muted) + n + RESET;
  const lineFull = B.lines[idx] ?? '';
  const raw = lineFull.substring(B.sx, B.sx + ew);
  let h: string;
  let hLen: number;
  const span = liveSel ? visRowSpan(idx, lineFull.length) : null;
  const selShown = !!span && Math.min(span[1], B.sx + ew) > Math.max(span[0], B.sx);
  if (selShown) {
    // Selected rows drop syntax colors (and ghost text) for reverse video —
    // vim's Visual group overrides highlighting too. Built from raw text, so
    // no ANSI remapping is needed.
    const rs = Math.max(span[0], B.sx);
    const re = Math.min(span[1], B.sx + ew);
    h = lineFull.substring(B.sx, rs) + REV + lineFull.substring(rs, re) + RESET + lineFull.substring(re, B.sx + ew);
    hLen = visLen(h);
  } else {
    const e = hlEntry(raw, B.lang);
    h = e.h;
    hLen = e.w;
  }
  if (idx === B.cy && !selShown) {
    const g = ghostFor(B, isActive);
    if (g && hLen < ew) {
      const f = fitGhost(g, hLen, ew);
      if (f.s) { h += fg(T.muted) + f.s + RESET; hLen += f.w; }
    }
  }
  const padded = hLen >= ew ? h : h + ' '.repeat(ew - hLen);
  const full = `${num} ${padded}`;
  const fullLen = digits + 1 + Math.max(hLen, ew);
  return fullLen >= cw ? full : full + ' '.repeat(cw - fullLen);
}

function shortCwd(p: string): string {
  const home = os.homedir();
  let s = p.startsWith(home) ? '~' + p.slice(home.length) : p;
  const parts = s.split(path.sep).filter(Boolean);
  if (parts.length > 2) return '…/' + parts.slice(-2).join('/');
  return s || '.';
}

function paintTerm(row: string[], termH: number, w: number): void {
  row.push(fg(T.borderSubtle) + '─'.repeat(w) + RESET);
  const bodyH = Math.max(0, termH - 2);
  const total = termLines.length;
  const maxScroll = Math.max(0, total - bodyH);
  termScroll = clamp(termScroll, 0, maxScroll);
  const end = total - termScroll;
  const start = Math.max(0, end - bodyH);
  // header: cwd + shell + scroll/resize hints, all theme-driven
  const shellName = process.platform === 'win32' ? 'powershell' : 'sh';
  const scrollTag = termScroll > 0 ? fg(T.yellow) + ` ▲${termScroll}` + RESET : '';
  const head = `${fg(T.muted)}TERMINAL ${fg(T.primary)}${shortCwd(termCwd)}${RESET} ${fg(T.muted)}${shellName} · PgUp/PgDn scroll · :term +/- resize${RESET}${scrollTag}`;
  row.push(padVis(head.slice(0, w), w));
  for (let i = 0; i < bodyH - 1; i++) {
    const l = (start + i) < end ? (termLines.at(start + i) ?? '') : '';
    row.push(padVis(l ? fg(T.muted) + '│ ' + RESET + l : '', w));
  }
  const prompt = termBusy
    ? `${fg(T.yellow)}… running (Ctrl+C kills)${RESET}`
    : `${fg(T.primary)}${shortCwd(termCwd)} ❯${RESET} ${termInput}`;
  row.push(padVis(prompt, w));
}

function paintStatus(row: string[], w: number): void {
  const vmode = visual ? (visual.kind === 'line' ? 'VISUAL LINE' : 'VISUAL') : null;
  const modeName = vmode ?? (vim === 'normal' ? 'NORMAL' : vim === 'insert' ? 'INSERT' : vim === 'command' ? 'COMMAND' : 'SEARCH');
  const modeBg = visual ? bg(T.accent) : vim === 'insert' ? bg(T.green) : vim === 'normal' ? bg(T.primary) : bg(T.accent);
  const mode = `${modeBg}${fg(T.primaryText)}${BOLD} ${modeName} ${RESET}`;
  const name = buf.filePath ? path.basename(buf.filePath) : 'untitled';
  const mid = msg
    ? fg(T.yellow) + msg.slice(0, Math.max(0, w - 40)) + RESET
    : `${fg(T.text)}${BOLD}${name}${RESET}${buf.modified ? fg(T.yellow) + ' [+]' : ''} ${fg(T.muted)}[${buf.lang}]${RESET}`;
  const right = fg(T.muted) + `${buf.cy + 1}:${buf.cx + 1} ${buf.lines.length}L buf ${buffers.length ? curIdx() + 1 : 1}/${Math.max(1, buffers.length)}${splitOn ? (activePane ? ' BOT' : ' TOP') : ''}` + RESET;
  const modeLen = visLen(mode);
  const midLen = visLen(mid);
  const rightLen = visLen(right);
  const gap = Math.max(1, w - modeLen - midLen - rightLen);
  row.push(mode + ' ' + mid + ' '.repeat(gap) + right);
}

interface Region { y0: number; y1: number; bi: number; active: boolean }
/** Screen regions of the code panes (0-based row window [y0, y1), header is row 0). Shared by paint + mouse. */
function layoutRegions(h: number, termH: number): Region[] {
  const mainEnd = h - 1 - termH;
  if (splitOn && panes.length > 1) {
    return [
      { y0: 1, y1: Math.floor((1 + mainEnd) / 2), bi: panes[0] ?? 0, active: activePane === 0 },
      { y0: Math.floor((1 + mainEnd) / 2), y1: mainEnd, bi: panes[1] ?? 0, active: activePane === 1 },
    ];
  }
  return [{ y0: 1, y1: mainEnd, bi: curIdx(), active: true }];
}

function paint(): void {
  const { w, h } = size();
  syncVisual();
  const rows: string[] = [];
  paintHeader(rows, w);
  const termH = termOpen ? termHeightFor(h) : 0;
  const mainEnd = h - 1 - termH;
  const tw = treeVisible ? 26 : 0;
  const mainVis = Math.max(1, mainEnd - 1);
  const cw = Math.max(10, w - (tw + 1));
  syncTreeScroll(mainVis);
  const regions = layoutRegions(h, termH);
  let curDigits = 1, curEw = 10, curY0 = 1;
  for (const rg of regions) {
    // Active pane always renders the live buffer: entry copies only refresh
    // on stash (buffer/pane switches), so rendering them shows a stale snapshot.
    const B = rg.active ? buf : (buffers[rg.bi]?.b ?? buf);
    const digits = String(B.lines.length).length;
    const ew = Math.max(10, cw - digits - 2);
    syncCodeScroll(rg.y1 - rg.y0, ew, B);
    for (let y = rg.y0; y < rg.y1; y++) {
      const line: string[] = [];
      if (treeVisible) {
        line.push(paintTreeRow(y, tw - 1) + fg(T.borderSubtle) + '┃' + RESET);
      }
      if (splitOn) {
        const tag = rg.active ? fg(T.primary) + '▌' + RESET : fg(T.borderSubtle) + '▌' + RESET;
        line.push(tag);
      }
      line.push(paintCodeRow(y, B.sy, digits, ew, splitOn ? cw - 1 : cw, B, rg.active, rg.bi === curIdx()));
      rows.push(padVis(line.join(''), w));
    }
    if (rg.active) { curDigits = digits; curEw = ew; curY0 = rg.y0; }
  }
  if (termOpen) paintTerm(rows, termH, w);
  if (vim === 'command') {
    rows.push(padVis(`${fg(T.primary)}${BOLD}:${RESET}${cmdBuf}`, w));
  } else if (vim === 'search') {
    const info = matches.length
      ? ` ${fg(T.muted)}[${matchIdx + 1}/${matches.length}${matchCapped ? '+' : ''}]${RESET}`
      : '';
    rows.push(padVis(`${fg(T.primary)}${BOLD}/${RESET}${searchBuf}${info}`, w));
  } else {
    const s: string[] = [];
    paintStatus(s, w);
    rows.push(padVis(s[0], w));
  }
  process.stdout.write('\x1b[H' + rows.slice(0, h).join('\n'));
  // place cursor
  if (vim === 'command') {
    process.stdout.write(`\x1b[${h};${2 + visLen(cmdBuf)}H`);
  } else if (vim === 'search') {
    process.stdout.write(`\x1b[${h};${2 + visLen(searchBuf)}H`);
  } else if (focus === 'term' && termOpen) {
    const prefix = visLen(`${shortCwd(termCwd)} ❯ `);
    process.stdout.write(`\x1b[${h - 1};${clamp(1 + prefix + termCursor, 1, w)}H`);
  } else if (focus === 'edit') {
    const cx = tw + 1 + (splitOn ? 1 : 0) + curDigits + 1 + strWidth(curLine().slice(buf.sx, buf.cx));
    const cy = curY0 + (buf.cy - buf.sy) + 1;
    process.stdout.write(`\x1b[${clamp(cy, 2, h - 1)};${clamp(cx, 1, w)}H`);
  }
}

/* ---------- shell (integrated terminal panel) ---------- */
/* Spawn target comes from winsh: powershell.exe with Bypass policy +
 * UTF-8 output on win32, sh -c elsewhere. */

function termPrint(s: string): void {
  termLines.push(s); // ring overwrites oldest past capacity — O(1), no copy
  if (termScroll > 0) termScroll = Math.min(termScroll + 1, Math.max(0, termLines.length - 1));
}

function termResolveCd(arg: string): string | null {
  const a = arg.trim().replace(/^["']+|["']+$/g, '');
  if (!a || a === '~') return os.homedir();
  if (a === '-') return termPrevCwd;
  const p = path.isAbsolute(a) ? path.normalize(a) : path.resolve(termCwd, a);
  try {
    if (fs.statSync(p).isDirectory()) return p;
  } catch { /* not a dir */ }
  return null;
}

function runShell(cmd: string, cwd?: string): void {
  const clean = cmd.trim();
  if (!clean) return;
  termOpen = true;
  focus = 'term';
  termScroll = 0;
  // local builtins — instant, no spawn, cwd persists
  const mCd = clean.match(/^cd(?:\s+(.*))?$/);
  if (mCd) {
    const dest = termResolveCd(mCd[1] ?? '');
    termHist.unshift(clean); if (termHist.length > 50) termHist.pop(); termHistIdx = -1;
    if (dest) { termPrevCwd = termCwd; termCwd = dest; termPrint(`${fg(T.primary)}${shortCwd(termCwd)} ❯${RESET} cd ${mCd[1] ?? ''}`); }
    else termPrint(fg(T.red) + `cd: no such directory: ${mCd[1] ?? ''}` + RESET);
    paint();
    return;
  }
  if (clean === 'clear' || clean === 'cls') {
    termHist.unshift(clean); if (termHist.length > 50) termHist.pop(); termHistIdx = -1;
    termLines.clear(); termScroll = 0;
    paint();
    return;
  }
  if (clean === 'exit' || clean === 'quit') {
    termOpen = false; focus = 'edit'; termChild = null;
    say('Terminal closed');
    paint();
    return;
  }
  if (clean === 'help') {
    termHist.unshift(clean); if (termHist.length > 50) termHist.pop(); termHistIdx = -1;
    termPrint(`${fg(T.primary)}❯${RESET} help`);
    termPrint(`${fg(T.muted)}every shell command works (sh/powershell) · builtins: cd · clear · exit · history · pwd${RESET}`);
    termPrint(`${fg(T.muted)}keys: ↑↓ history · ←→/Home/End edit · Ctrl+A/E/U/K/W · PgUp/PgDn scroll · :term +/-/max resize · Ctrl+C kills running cmd · Esc leaves${RESET}`);
    paint();
    return;
  }
  if (clean === 'history') {
    termHist.unshift(clean); if (termHist.length > 50) termHist.pop(); termHistIdx = -1;
    termHist.slice().reverse().forEach((h, i) => termPrint(`${fg(T.muted)}${String(i + 1).padStart(3)}  ${h}${RESET}`));
    paint();
    return;
  }
  if (clean === 'pwd') {
    termHist.unshift(clean); if (termHist.length > 50) termHist.pop(); termHistIdx = -1;
    termPrint(`${fg(T.primary)}❯${RESET} pwd`);
    termPrint(termCwd);
    paint();
    return;
  }
  termBusy = true;
  termStartedAt = Date.now();
  termHist.unshift(clean);
  if (termHist.length > 50) termHist.pop();
  termHistIdx = -1;
  termPrint(`${fg(T.primary)}${shortCwd(termCwd)} ❯${RESET} ${clean}`);
  paint();
  const { cmd: sh, args } = shellFor();
  const workdir = cwd ?? termCwd;
  let p: any;
  try {
    p = spawn(sh, args(clean), { cwd: workdir, windowsHide: true });
  } catch (e) {
    termBusy = false;
    termPrint(fg(T.red) + `spawn failed: ${(e as Error).message}` + RESET);
    paint();
    return;
  }
  termChild = p;
  const onData = (d: any, err: boolean) => {
    String(d).split(/\r?\n/).forEach((l) => {
      if (!l) return;
      const cleanL = l.length > 500 ? l.slice(0, 500) + '…' : l;
      termPrint(err ? fg(T.red) + cleanL + RESET : cleanL);
    });
    paint();
  };
  p.stdout?.on('data', (d: any) => onData(d, false));
  p.stderr?.on('data', (d: any) => onData(d, true));
  const done = (code: number | null) => {
    if (termChild === p) termChild = null;
    termBusy = false;
    const ms = ((Date.now() - termStartedAt) / 1000).toFixed(1);
    const ok = (code ?? 1) === 0;
    termPrint((ok ? fg(T.green) : fg(T.red)) + `exit ${code ?? '?'} · ${ms}s` + RESET);
    paint();
  };
  p.on('close', done);
  p.on('error', (e: any) => {
    if (termChild === p) termChild = null;
    termBusy = false;
    termPrint(fg(T.red) + `spawn failed: ${(e as Error).message}` + RESET);
    paint();
  });
}

/* ---------- editing ops ---------- */

function insertText(s: string): void {
  snapshotCoalesced(true);
  const l = curLine();
  buf.lines[buf.cy] = l.slice(0, buf.cx) + s + l.slice(buf.cx);
  buf.cx += s.length;
  buf.modified = true;
}

function newline(): void {
  snapshot();
  const l = curLine();
  buf.lines[buf.cy] = l.slice(0, buf.cx);
  buf.lines.splice(buf.cy + 1, 0, l.slice(buf.cx));
  buf.cy++; buf.cx = 0;
  buf.modified = true;
}

function backspace(): void {
  if (buf.cx > 0) {
    snapshot();
    // Delete by code POINT, not code unit: a surrogate pair (emoji, CJK ext)
    // split by unit-wise slicing leaves a lone half, which encodes to U+FFFD
    // and corrupts the buffer/file.
    const l = curLine();
    let start = buf.cx - 1;
    const c = l.charCodeAt(start);
    if (c >= 0xdc00 && c <= 0xdfff && start > 0) {
      start--; // caret after a pair — remove both units
    } else if (c >= 0xd800 && c <= 0xdbff && buf.cx < l.length) {
      const c2 = l.charCodeAt(buf.cx);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) buf.cx++; // caret inside a pair — remove it whole
    }
    buf.lines[buf.cy] = l.slice(0, start) + l.slice(buf.cx);
    buf.cx = start;
    buf.modified = true;
  } else if (buf.cy > 0) {
    snapshot();
    const cur = curLine();
    buf.cy--;
    buf.cx = buf.lines[buf.cy].length;
    buf.lines[buf.cy] += cur;
    buf.lines.splice(buf.cy + 1, 1);
    buf.modified = true;
  }
}

function deleteLine(): void {
  snapshot();
  if (buf.lines.length <= 1) buf.lines = [''];
  else {
    buf.lines.splice(buf.cy, 1);
    if (buf.cy >= buf.lines.length) buf.cy = buf.lines.length - 1;
  }
  buf.cx = 0;
  buf.modified = true;
}

let yank = '';
let yankMode: 'line' | 'char' = 'line';
let yankStr = '';

/* ---------- vim grammar: counts, operators, text objects, macros ---------- */
let vCount = 0;
let vOp: { op: 'd' | 'y' | 'c'; n: number } | null = null;
let vObj: { op: 'd' | 'y' | 'c'; n: number; around: boolean } | null = null;
let vG = false;
let recReg: string | null = null;
let recWait = false;
let atWait = false;
let lastReg = '';
let playing = false;
const regs: Record<string, string> = {};

/* ---------- visual mode (v char-wise, V line-wise) ---------- */
type VisKind = 'char' | 'line';
let visual: { kind: VisKind; ay: number; ax: number } | null = null;
/** Selection bounds in line/col space, recomputed once per paint (O(1) per
 * row afterwards — never per-row offset math). */
let visHL: { y1: number; x1: number; y2: number; x2: number; line: boolean } | null = null;
function visualExit(): void { visual = null; visHL = null; }
function syncVisual(): void {
  visHL = null;
  if (!visual) return;
  const n = buf.lines.length;
  const ay = clamp(visual.ay, 0, n - 1);
  const ax = clamp(visual.ax, 0, (buf.lines[ay] ?? '').length);
  const cy = clamp(buf.cy, 0, n - 1);
  const cx = clamp(buf.cx, 0, (buf.lines[cy] ?? '').length);
  if (visual.kind === 'line') {
    visHL = { y1: Math.min(ay, cy), x1: 0, y2: Math.max(ay, cy), x2: -1, line: true };
    return;
  }
  const adv = (y: number, x: number): [number, number] => {
    const len = (buf.lines[y] ?? '').length;
    if (x < len) return [y, x + 1];
    if (y + 1 < n) return [y + 1, 0];
    return [y, x];
  };
  const aFirst = ay < cy || (ay === cy && ax <= cx);
  const s: [number, number] = aFirst ? [ay, ax] : [cy, cx];
  const hp: [number, number] = aFirst ? [cy, cx] : [ay, ax];
  const e = adv(hp[0], hp[1]);
  visHL = { y1: s[0], x1: s[1], y2: e[0], x2: e[1], line: false };
}
/** Selected span of row idx as [startCol, endCol) in line coords, or null. */
function visRowSpan(idx: number, len: number): [number, number] | null {
  const h = visHL;
  if (!h || idx < h.y1 || idx > h.y2) return null;
  if (h.line) return len > 0 ? [0, len] : null;
  const s = idx === h.y1 ? Math.min(h.x1, len) : 0;
  const e = idx === h.y2 ? Math.min(h.x2, len) : len;
  return e > s ? [s, e] : null;
}
/** Selection as ordered text offsets (end exclusive). */
function visOffsets(): [number, number] {
  if (!visual) return [0, 0];
  if (visual.kind === 'line') {
    const y1 = Math.min(visual.ay, buf.cy);
    const y2 = Math.max(visual.ay, buf.cy);
    return [offOf(y1, 0), y2 + 1 < buf.lines.length ? offOf(y2 + 1, 0) : offOf(y2, (buf.lines[y2] ?? '').length)];
  }
  syncVisual();
  const h = visHL!;
  return [offOf(h.y1, h.x1), offOf(h.y2, h.x2)];
}

/* ---------- dot-repeat: keystroke recording of the last change ---------- */
let dotKeys: string[] | null = null;
let replayingDot = false;
let insEntry: string[] | null = null;
let insChars: string[] = [];
function setDot(keys: string[]): void {
  if (!replayingDot && keys.length) dotKeys = [...keys];
}
function insBegin(keys: string[]): void {
  if (!replayingDot) { insEntry = [...keys]; insChars = []; }
}
function insPush(key: string): void {
  if (insEntry && !replayingDot) insChars.push(key);
}
function insEnd(): void {
  if (insEntry && !replayingDot) setDot([...insEntry, ...insChars]);
  insEntry = null; insChars = [];
}

/* ---------- marks (a-z per file, A-Z global) + jumplist ---------- */
interface JumpPos { file: string | null; y: number; x: number }
const localMarks = new Map<string, Map<string, { y: number; x: number }>>();
const globalMarks = new Map<string, JumpPos>();
let markWait = false;
let tickWait: null | 'line' | 'exact' = null;
let jumps: JumpPos[] = [];
let jumpIdx = -1;
let lastJump: JumpPos | null = null;
function markFileKey(): string | null { return buf.filePath ?? null; }
function curPos(): JumpPos { return { file: markFileKey(), y: buf.cy, x: buf.cx }; }
function getMark(name: string): JumpPos | null {
  if (name >= 'a' && name <= 'z') {
    const m = localMarks.get(markFileKey() ?? 'untitled')?.get(name);
    return m ? { file: markFileKey(), y: m.y, x: m.x } : null;
  }
  if (name >= 'A' && name <= 'Z') return globalMarks.get(name) ?? null;
  return null;
}
/** Record the pre-jump position (cap 100). Explicit jumps only — never
 * per-keystroke search typing or visual drags. */
function pushJump(): void {
  const p = curPos();
  lastJump = p;
  jumps = jumps.slice(0, jumpIdx + 1);
  jumps.push(p);
  if (jumps.length > 100) jumps.shift();
  jumpIdx = jumps.length - 1;
}
function gotoPos(p: JumpPos): boolean {
  const here = markFileKey();
  if (p.file !== here) {
    if (buf.modified) { say('Unsaved changes — :w first', true); return false; }
    const idx = buffers.findIndex((e) => (e.b.filePath ?? null) === p.file);
    if (idx >= 0 && idx !== curIdx()) { stashBuf(); loadBuf(idx); panes[activePane] = idx; }
    else if (idx < 0) {
      if (!p.file || !fileExists(p.file)) { say('Jump target gone', true); return false; }
      if (!openFile(p.file)) return false;
    }
  }
  buf.cy = clamp(p.y, 0, buf.lines.length - 1);
  buf.cx = clamp(p.x, 0, (buf.lines[buf.cy] ?? '').length);
  return true;
}
function jumpBack(): void {
  if (jumpIdx <= 0) { say('At oldest jump', true); return; }
  lastJump = curPos();
  jumpIdx--;
  if (!gotoPos(jumps[jumpIdx])) { jumpIdx++; return; }
  say(`Jump ${jumpIdx + 1}/${jumps.length}`);
}
function jumpFwd(): void {
  if (jumpIdx >= jumps.length - 1) { say('At newest jump', true); return; }
  lastJump = curPos();
  jumpIdx++;
  if (!gotoPos(jumps[jumpIdx])) { jumpIdx--; return; }
  say(`Jump ${jumpIdx + 1}/${jumps.length}`);
}

function bufText(): string { return buf.lines.join('\n'); }
function offOf(y: number, x: number): number {
  let o = 0;
  for (let i = 0; i < y && i < buf.lines.length; i++) o += buf.lines[i].length + 1;
  return o + clamp(x, 0, (buf.lines[y] ?? '').length);
}
function posOf(off: number): { y: number; x: number } {
  return posOfIn(bufText(), off);
}
/** Same as posOf but reuses the caller's snapshot: motionTarget/delRange used
 * to join the whole buffer 2-4x per keypress (once here, once per helper). */
function posOfIn(t: string, off: number): { y: number; x: number } {
  off = clamp(off, 0, t.length);
  for (let y = 0; y < buf.lines.length; y++) {
    if (off <= buf.lines[y].length) return { y, x: off };
    off -= buf.lines[y].length + 1;
  }
  const ly = buf.lines.length - 1;
  return { y: ly, x: buf.lines[ly].length };
}
function gotoOff(o: number): void {
  const p = posOf(o);
  buf.cy = p.y; buf.cx = p.x; clampCur();
}
function lineEndExcl(o: number): number {
  const p = posOf(o);
  return offOf(p.y, buf.lines[p.y].length);
}
function motionTarget(kind: string, from: number, n: number): number {
  const t = bufText();
  const isW = (c: string) => /[A-Za-z0-9_]/.test(c || '');
  const fwd = (o: number) => { while (o < t.length && isW(t[o])) o++; while (o < t.length && /\s/.test(t[o])) o++; return o; };
  const back = (o: number) => { while (o > 0 && /\s/.test(t[o - 1])) o--; while (o > 0 && isW(t[o - 1])) o--; return o; };
  const ls = (o: number) => offOf(posOfIn(t, o).y, 0);
  const le = (o: number) => { const p = posOfIn(t, o); return offOf(p.y, buf.lines[p.y].length); };
  const o = clamp(from, 0, t.length);
  switch (kind) {
    case 'h': return Math.max(ls(o), o - n);
    case 'l': return Math.min(le(o), o + n);
    case 'j': case 'k': {
      const p = posOfIn(t, o);
      const ny = clamp(p.y + (kind === 'j' ? n : -n), 0, buf.lines.length - 1);
      return offOf(ny, Math.min(p.x, buf.lines[ny].length));
    }
    case 'w': { let q = o; for (let i = 0; i < n; i++) q = fwd(q); return q; }
    case 'b': { let q = o; for (let i = 0; i < n; i++) q = back(q); return q; }
    case 'e': {
      let q = o;
      for (let i = 0; i < n; i++) {
        if (q < t.length) q++;
        while (q < t.length && /\s/.test(t[q])) q++;
        while (q + 1 < t.length && isW(t[q + 1])) q++;
      }
      return q;
    }
    case '0': return ls(o);
    case '$': { const e = le(o), s = ls(o); return e > s ? e - 1 : s; }
    case 'gg': return 0;
    case 'G': return offOf(buf.lines.length - 1, 0);
  }
  return o;
}
function delRange(a: number, b: number): void {
  if (a > b) { const t = a; a = b; b = t; }
  if (a === b) return;
  snapshot();
  const t = bufText();
  buf.lines = (t.slice(0, a) + t.slice(b)).split('\n');
  if (!buf.lines.length) buf.lines = [''];
  // Cursor lands before the deletion point, whose offsets are unchanged —
  // reuse t instead of gotoOff(), which would re-join the whole buffer.
  const p = posOfIn(t, a);
  buf.cy = p.y; buf.cx = p.x; clampCur();
  buf.modified = true;
}
function yankRange(a: number, b: number): void {
  if (a > b) { const t = a; a = b; b = t; }
  yankStr = bufText().slice(a, b);
  yankMode = 'char';
  yank = yankStr;
  osc52Copy(yankStr);
}
/** Push yanked text to the system clipboard (works over SSH in most terminals). */
function osc52Copy(text: string): void {
  try {
    if (!text || !process.stdout.isTTY) return;
    const b64 = Buffer.from(text.slice(0, 100000), 'utf-8').toString('base64');
    process.stdout.write(`\x1b]52;c;${b64}\x07`);
  } catch { /* clipboard is best-effort */ }
}
function objRange(text: string, o: number, ch: string, around: boolean): [number, number] | null {
  o = clamp(o, 0, text.length);
  if (ch === '"' || ch === "'" || ch === '`') {
    let l = o - 1; while (l >= 0 && text[l] !== ch) l--;
    let r = o; while (r < text.length && text[r] !== ch) r++;
    if (l < 0 || r >= text.length) return null;
    return around ? [l, r + 1] : [l + 1, r];
  }
  if (ch === 'w' || ch === 'W') {
    const isW = (c: string) => /[A-Za-z0-9_]/.test(c || '');
    if (!isW(text[o]) && !around) return null;
    let a = o, b = o;
    while (a > 0 && isW(text[a - 1])) a--;
    while (b < text.length && isW(text[b])) b++;
    if (around) while (b < text.length && /\s/.test(text[b])) b++;
    return [a, b];
  }
  const pairs: Record<string, string> = { '(': ')', ')': ')', '[': ']', ']': ']', '{': '}', '}': '}' };
  const close = pairs[ch];
  if (!close) return null;
  const open = ch === ')' ? '(' : ch === ']' ? '[' : ch === '}' ? '{' : ch;
  let l: number;
  if (text[o] === open) l = o;
  else {
    let d = 0; l = o - 1;
    while (l >= 0) { if (text[l] === close) d++; else if (text[l] === open) { if (d === 0) break; d--; } l--; }
    if (l < 0) return null;
  }
  let r: number;
  if (text[o] === close) r = o;
  else {
    let d = 0; r = o;
    while (r < text.length) { if (text[r] === open) d++; else if (text[r] === close) { if (d === 0) break; d--; } r++; }
    if (r >= text.length) return null;
  }
  return around ? [l, r + 1] : [l + 1, r];
}
function recordKey(k: string): void {
  if (!recReg || playing || replayingDot) return;
  regs[recReg] = (regs[recReg] ?? '') + k;
  if (regs[recReg].length > 500) { recReg = null; say('Macro too long — stopped', true); }
}
function playReg(name: string, n: number): void {
  const r = regs[name];
  if (r == null) { say(`Empty register ${name}`, true); return; }
  lastReg = name;
  playing = true;
  try {
    for (let k = 0; k < n; k++) for (const ch of r) onKey(ch === '\n' ? '\r' : ch === '\b' ? '\x7f' : ch);
  } finally { playing = false; }
}
const VIM_MOTIONS = ['h', 'j', 'k', 'l', 'w', 'b', 'e', '0', '$'];
/** Normal-mode keys recorded into macros under their replay-safe equivalent.
 * Registers are a flat string replayed code-point by code-point (playReg), so
 * a named key like 'DOWN' would replay as literal D,O,W,N — D = delete-to-EOL,
 * O = open line — corrupting the buffer on @-replay. */
const REC_KEY: Record<string, string> = { UP: 'k', DOWN: 'j', LEFT: 'h', RIGHT: 'l', DEL: 'x' };
function vimKey(key: string): boolean {
  if (recWait) {
    recWait = false;
    if (/^[a-z]$/.test(key)) { recReg = key; regs[key] = ''; say(`recording @${key} — q stops`); }
    return true;
  }
  if (atWait) {
    atWait = false;
    const nn = vCount || 1; vCount = 0;
    if (key === '@') playReg(lastReg, nn);
    else if (/^[a-z]$/.test(key)) playReg(key, nn);
    return true;
  }
  if (markWait) {
    markWait = false;
    if (/^[a-z]$/.test(key)) {
      const fk = markFileKey() ?? 'untitled';
      let m = localMarks.get(fk);
      if (!m) { m = new Map(); localMarks.set(fk, m); }
      m.set(key, { y: buf.cy, x: buf.cx });
      say(`Mark ${key}`);
      return true;
    }
    if (/^[A-Z]$/.test(key)) {
      globalMarks.set(key, curPos());
      say(`Mark ${key}`);
      return true;
    }
    // Not a mark name — fall through and handle the key normally.
  }
  if (tickWait) {
    const t = tickWait; tickWait = null;
    const isTick = key === "'" || key === '`';
    const isName = /^[a-zA-Z]$/.test(key);
    if (isTick || isName) {
      const target = isTick ? lastJump : getMark(key);
      if (!target) { say(isTick ? 'No previous jump' : `Mark ${key} not set`, true); return true; }
      lastJump = curPos();
      if (gotoPos(target) && t === 'line') {
        const l = curLine();
        const m = l.search(/\S|$/);
        buf.cx = m < 0 ? 0 : m;
      }
      clampCur();
      return true;
    }
    // else: fall through and handle the key normally.
  }
  if (visual) {
    if (key === '\x1b') { visualExit(); return true; }
    if (key === 'v') {
      if (visual.kind === 'char') visualExit();
      else visual = { kind: 'char', ay: visual.ay, ax: visual.ax };
      return true;
    }
    if (key === 'V') { visual = { kind: 'line', ay: visual.ay, ax: visual.ax }; return true; }
    if (key === 'o') {
      const ty = visual.ay, tx = visual.ax;
      visual.ay = buf.cy; visual.ax = buf.cx; buf.cy = ty; buf.cx = tx; clampCur();
      return true;
    }
    if (key === 'd' || key === 'x') { const r = visOffsets(); visualExit(); delRange(r[0], r[1]); return true; }
    if (key === 'y') {
      if (visual.kind === 'line') {
        const y1 = Math.min(visual.ay, buf.cy), y2 = Math.max(visual.ay, buf.cy);
        yank = buf.lines.slice(y1, y2 + 1).join('\n'); yankStr = yank; yankMode = 'line';
        osc52Copy(yankStr); say(`Yanked ${y2 - y1 + 1} line(s)`);
      } else { const r = visOffsets(); yankRange(r[0], r[1]); }
      visualExit(); return true;
    }
    if (key === 'c') { const r = visOffsets(); visualExit(); delRange(r[0], r[1]); vim = 'insert'; insBegin([]); return true; }
    if (key === 'p') {
      if (!yankStr && !yank) { say('Nothing yanked', true); return true; }
      const r = visOffsets(); visualExit(); delRange(r[0], r[1]); doPaste(); return true;
    }
    if (key === '.') return true; // repeat-over-selection is not recorded; ignore
    // Motions, marks, jumps and G fall through and stretch the selection.
  }
  if (vObj) {
    const o = vObj; vObj = null; vCount = 0;
    const cur = offOf(buf.cy, buf.cx);
    let range: [number, number] | null = null;
    if (key === 'w' || key === 'W') range = objRange(bufText(), cur, 'w', o.around);
    else if (key.length === 1) range = objRange(bufText(), cur, key, o.around);
    if (!range) return true;
    setDot([o.op, o.around ? 'a' : 'i', key]);
    if (o.op === 'y') yankRange(range[0], range[1]);
    else { delRange(range[0], range[1]); if (o.op === 'c') { vim = 'insert'; insBegin([o.op, o.around ? 'a' : 'i', key]); } }
    return true;
  }
  if (key === 'q') {
    if (recReg) { recReg = null; say('recorded'); }
    else recWait = true;
    return true;
  }
  if (key === '@') { atWait = true; return true; }
  recordKey(REC_KEY[key] ?? (key.length === 1 ? key : ''));
  if (/^[1-9]$/.test(key) || (key === '0' && vCount > 0)) { vCount = vCount * 10 + parseInt(key, 10); return true; }
  if (key === 'g') {
    if (vG) {
      vG = false;
      vCount = 0;
      const op = vOp; vOp = null;
      if (op) {
        // dgg/ygg/cgg: this handler runs BEFORE the operator block below, so
        // it used to execute the BOF jump while the operator stayed armed —
        // the next unrelated key then triggered the delete from line 0
        // (d,g,g,l deleted the file's first character).
        const from = offOf(buf.cy, buf.cx);
        setDot([op.op, 'g', 'g']);
        if (op.op === 'y') yankRange(0, from);
        else {
          delRange(from, 0);
          if (op.op === 'c') { vim = 'insert'; insBegin([op.op, 'g', 'g']); }
        }
      } else {
        if (!visual && buf.cy !== 0) pushJump();
        gotoOff(0);
      }
    } else vG = true;
    return true;
  }
  vG = false;
  const hadCount = vCount > 0;
  const n = vCount || 1; vCount = 0;
  if (vOp) {
    const op = vOp; vOp = null;
    if ((key === 'd' && op.op === 'd') || (key === 'y' && op.op === 'y') || (key === 'c' && op.op === 'c')) {
      const total = op.n * n;
      setDot(total > 1 ? [op.op, String(total), key] : [op.op, key]);
      if (op.op === 'y') {
        const lines = buf.lines.slice(buf.cy, buf.cy + total);
        yank = lines.join('\n'); yankStr = yank; yankMode = 'line';
        osc52Copy(yankStr);
        say(`Yanked ${lines.length} line(s)`);
      } else if (op.op === 'c') {
        snapshot();
        buf.lines.splice(buf.cy, total, '');
        if (!buf.lines.length) buf.lines = [''];
        buf.cy = clamp(buf.cy, 0, buf.lines.length - 1);
        buf.cx = 0; buf.modified = true;
        vim = 'insert';
      } else {
        snapshot();
        buf.lines.splice(buf.cy, total);
        if (!buf.lines.length) buf.lines = [''];
        buf.cy = clamp(buf.cy, 0, buf.lines.length - 1);
        buf.cx = 0; buf.modified = true;
      }
      return true;
    }
    if (key === 'i' || key === 'a') { vObj = { op: op.op, n: op.n, around: key === 'a' }; return true; }
    // 'G' is not in VIM_MOTIONS, yet the branch below special-cases it — the
    // includes() gate made dG/yG/cG fall through to the bare `return true`
    // and silently discard the pending operator (and the motion).
    if (VIM_MOTIONS.includes(key) || key === 'G') {
      const from = offOf(buf.cy, buf.cx);
      // Run through EOF: the old target was the last line's column 0, which
      // left the final line undeleted and yanked the wrong span for yG.
      const to = key === 'G' ? bufText().length
        : key === '$' ? lineEndExcl(from)
        : motionTarget(key, from, op.n * n);
      const mult = op.n * n;
      const entry = mult > 1 ? [op.op, String(mult), key] : [op.op, key];
      setDot(entry);
      if (op.op === 'y') yankRange(from, to);
      else { delRange(from, to); if (op.op === 'c') { vim = 'insert'; insBegin(entry); } }
      return true;
    }
    return true;
  }
  if (key === 'v' || key === 'V') {
    vOp = null; vObj = null; vCount = 0; vG = false; markWait = false; tickWait = null;
    visual = { kind: key === 'v' ? 'char' : 'line', ay: buf.cy, ax: buf.cx };
    return true;
  }
  if (key === '.') {
    if (!dotKeys) { say('Nothing to repeat', true); return true; }
    const nn = vCount || 1; vCount = 0;
    replayingDot = true;
    try { for (let k = 0; k < nn; k++) for (const dk of dotKeys) onKey(dk); }
    finally { replayingDot = false; }
    if (vim === 'insert') { vim = 'normal'; clampCur(); }
    return true;
  }
  if (key === 'm') { markWait = true; vCount = 0; return true; }
  if (key === "'" || key === '`') { tickWait = key === "'" ? 'line' : 'exact'; vCount = 0; return true; }
  if (key === '\x0f') { visualExit(); jumpBack(); return true; } // Ctrl+O — jumplist back
  if (key === 'd' || key === 'y' || key === 'c') { vOp = { op: key, n }; return true; }
  if (key === 'x') {
    if (buf.cx < curLine().length) {
      setDot(n > 1 ? [String(n), 'x'] : ['x']);
      snapshot();
      // Delete n code POINTS: unit-wise slicing split surrogate pairs and
      // left a lone half (U+FFFD on save) — e.g. 'x' on an emoji at the caret.
      const l = curLine();
      let s0 = buf.cx;
      const cs = l.charCodeAt(s0);
      if (cs >= 0xdc00 && cs <= 0xdfff && s0 > 0) s0--;
      let e = s0;
      for (let k = 0; k < n && e < l.length; k++) {
        e++;
        while (e < l.length && l.charCodeAt(e) >= 0xdc00 && l.charCodeAt(e) <= 0xdfff) e++;
      }
      buf.lines[buf.cy] = l.slice(0, s0) + l.slice(e);
      buf.cx = clamp(s0, 0, buf.lines[buf.cy].length);
      buf.modified = true;
    }
    return true;
  }
  if (key === 'p') { setDot(['p']); doPaste(); return true; }
function doPaste(): void {
  if (!yankStr && !yank) { say('Nothing yanked', true); return; }
  snapshot();
  if (yankMode === 'line' || !yankStr) {
    buf.lines.splice(buf.cy + 1, 0, ...(yank || yankStr).split('\n'));
    buf.cy = Math.min(buf.cy + 1, buf.lines.length - 1);
  } else {
    buf.lines[buf.cy] = curLine().slice(0, buf.cx) + yankStr + curLine().slice(buf.cx);
    buf.cx += yankStr.length;
  }
  clampCur(); buf.modified = true;
}
  if (VIM_MOTIONS.includes(key)) { gotoOff(motionTarget(key, offOf(buf.cy, buf.cx), n)); return true; }
  if (key === 'G') {
    const ty = hadCount ? clamp(n - 1, 0, buf.lines.length - 1) : buf.lines.length - 1;
    if (!visual && ty !== buf.cy) pushJump();
    gotoOff(offOf(ty, 0));
    return true;
  }
  return false;
}

/* ---------- buffers + split panes ---------- */
interface BufEntry { b: Buf; u: LinkedStack<Snap>; r: LinkedStack<Snap> }
let buffers: BufEntry[] = [];
let panes: number[] = [0];
let activePane = 0;
let splitOn = false;

function curIdx(): number { return panes[activePane] ?? 0; }
function stashBuf(): void {
  const e = buffers[curIdx()];
  if (e) { e.b = { ...buf, lines: [...buf.lines] }; e.u = undoStack; e.r = redoStack; }
}
function loadBuf(i: number): void {
  const e = buffers[i];
  if (!e) return;
  buf = { ...e.b, lines: [...e.b.lines] };
  undoStack = e.u; redoStack = e.r;
}
function syncEntry(): void { stashBuf(); }
function switchBuf(i: number, force: boolean): void {
  if (i < 0 || i >= buffers.length) { say('No such buffer', true); return; }
  if (i === curIdx()) return;
  if (buf.modified && !force) { say('Unsaved changes — :w or use ! to force', true); return; }
  stashBuf();
  persistUndo();
  panes[activePane] = i;
  loadBuf(i);
}
function closeBufEntry(i: number, force: boolean): void {
  if (i < 0 || i >= buffers.length) return;
  stashBuf();
  if (buffers[i].b.modified && !force) { say('Unsaved changes — :bd! to force', true); return; }
  buffers.splice(i, 1);
  if (!buffers.length) buffers.push(blankEntry());
  fixPanes(i);
  loadBuf(curIdx());
}
function blankEntry(): BufEntry {
  return { b: { filePath: null, lines: [''], lang: 'text', modified: false, cx: 0, cy: 0, sx: 0, sy: 0 }, u: new LinkedStack<Snap>(100), r: new LinkedStack<Snap>(100) };
}
function entryLang(resolved: string): string {
  const base = path.basename(resolved).toLowerCase();
  return base === 'dockerfile' ? 'dockerfile' : getLanguageFromExt(getFileExtension(resolved));
}
function readInto(e: BufEntry, filePath: string): boolean {
  try {
    const resolved = path.resolve(filePath);
    if (fileExists(resolved)) {
      if (isBinaryFile(resolved)) { say(`Binary file — cannot edit ${path.basename(resolved)}`, true); return false; }
      const data = fs.readFileSync(resolved);
      if (data.length > MAX_OPEN_BYTES) { say(`${path.basename(resolved)} is too large to open (${(data.length / 1048576).toFixed(1)}MB)`, true); return false; }
      e.b = { filePath: resolved, lines: data.toString('utf-8').split(/\r?\n/), lang: entryLang(resolved), modified: false, cx: 0, cy: 0, sx: 0, sy: 0 };
      if (!e.b.lines.length) e.b.lines = [''];
    } else {
      e.b = { filePath: resolved, lines: [''], lang: entryLang(resolved), modified: false, cx: 0, cy: 0, sx: 0, sy: 0 };
    }
    e.u = restoreUndoFor(e.b.filePath); e.r.clear();
    return true;
  } catch {
    say('Open failed', true);
    return false;
  }
}
function fixPanes(removed: number): void {
  panes = panes.map((p) => (p > removed ? p - 1 : p === removed ? -1 : p));
  for (let i = 0; i < panes.length; i++) if (panes[i] < 0 || panes[i] >= buffers.length) panes[i] = 0;
  if (!panes.length) panes = [0];
  activePane = clamp(activePane, 0, panes.length - 1);
}
function bufLabel(i: number): string {
  const e = buffers[i];
  if (!e) return '';
  const n = e.b.filePath ? path.basename(e.b.filePath) : 'untitled';
  return `${i + 1}:${n}${e.b.modified ? ' [+]' : ''}`;
}

/* ---------- word completion (Ctrl+N / Ctrl+P) ---------- */
let cmpState: { prefix: string; list: string[]; i: number } | null = null;
function completeWord(dir: 1 | -1): void {
  const line = curLine();
  const m = line.slice(0, buf.cx).match(/[A-Za-z0-9_$]+$/);
  const prefix = m ? m[0] : '';
  // Empty prefix used to regex-scan the whole buffer and build a list of
  // EVERY word (O(total chars) + O(unique words) per press) for a result the
  // user can't use. Same toast, none of the work.
  if (!prefix) { say('No completion', true); cmpState = null; return; }
  if (!cmpState || cmpState.prefix !== prefix) {
    const words = new Set<string>();
    buf.lines.forEach((l) => {
      const mm = l.match(/[A-Za-z_$][A-Za-z0-9_$]+/g);
      if (mm) mm.forEach((w) => words.add(w));
    });
    const list = [...words].filter((w) => w !== prefix && w.startsWith(prefix));
    if (!list.length) { say('No completion', true); cmpState = null; return; }
    cmpState = { prefix, list, i: -1 };
  }
  const st = cmpState;
  st.i = (st.i + dir + st.list.length) % st.list.length;
  const w = st.list[st.i];
  snapshot();
  buf.lines[buf.cy] = line.slice(0, buf.cx - prefix.length) + w + line.slice(buf.cx);
  buf.cx = buf.cx - prefix.length + w.length;
  buf.modified = true;
}

/* ---------- persistent undo (capped, file-backed) ---------- */
function undoKeyFor(p: string | null): string {
  const s = p ?? 'untitled';
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return h.toString(36);
}
function undoFilePathFor(filePath: string | null): string {
  try {
    const d = path.join(os.homedir(), '.typewriter', 'undo');
    fs.mkdirSync(d, { recursive: true });
    return path.join(d, undoKeyFor(filePath) + '.json');
  } catch { return ''; }
}
function undoFilePath(): string {
  return undoFilePathFor(buf.filePath);
}
let lastPersist = 0;
function persistUndoFor(filePath: string | null, stack: LinkedStack<Snap>): void {
  try {
    if (!filePath) return;
    const p = undoFilePathFor(filePath);
    if (!p) return;
    fs.writeFileSync(p, JSON.stringify(stack.takeLast(20)));
  } catch { /* noop */ }
}
function persistUndo(): void {
  try {
    if (!buf.filePath) return;
    if (buf.lines.join('\n').length > 50000) return;
    persistUndoFor(buf.filePath, undoStack);
  } catch { /* noop */ }
}
function persistUndoAll(): void {
  try {
    stashBuf();
    for (const e of buffers) {
      if (!e.b.filePath) continue;
      if (e.b.lines.join('\n').length > 50000) continue;
      persistUndoFor(e.b.filePath, e.u);
    }
    lastPersist = Date.now();
  } catch { /* noop */ }
}
function maybePersistUndo(): void {
  const now = Date.now();
  if (now - lastPersist > 2000) { lastPersist = now; persistUndo(); }
}
function restoreUndoFor(filePath: string | null): LinkedStack<Snap> {
  const stack = new LinkedStack<Snap>(100);
  try {
    if (!filePath) return stack;
    const p = undoFilePathFor(filePath);
    if (!p || !fs.existsSync(p)) return stack;
    const u = JSON.parse(fs.readFileSync(p, 'utf-8'));
    if (Array.isArray(u)) {
      for (const e of u.filter((e) => e && Array.isArray(e.lines)).slice(-20)) stack.push(e);
    }
  } catch { /* empty stack */ }
  return stack;
}
function restoreUndo(): void {
  undoStack = restoreUndoFor(buf.filePath);
}

/* ---------- code runner (prefixes from winsh.ts, platform-aware) ---------- */

const MAX_MATCHES = 5000;
function doSearch(q: string): void {
  matches = [];
  matchIdx = -1;
  matchCapped = false;
  if (!q) return;
  const needle = q.toLowerCase();
  for (let i = 0; i < buf.lines.length; i++) {
    const low = buf.lines[i].toLowerCase();
    let c = 0;
    while ((c = low.indexOf(needle, c)) !== -1) {
      matches.push({ line: i, col: c });
      if (matches.length >= MAX_MATCHES) {
        matchCapped = true;
        matchIdx = 0;
        jumpMatch();
        return;
      }
      c += needle.length || 1;
    }
  }
  if (matches.length) { matchIdx = 0; jumpMatch(); }
}

function jumpMatch(): void {
  const m = matches[matchIdx];
  if (!m) return;
  buf.cy = m.line; buf.cx = m.col;
  clampCur();
}

/* ---------- commands ---------- */

function quit(): void {
  cleanup();
  process.stdout.write('\x1b[?1049l');
  process.exit(0);
}

function runCmd(raw: string): void {
  const trimmed = raw.trim();
  if (trimmed.startsWith('!')) { runShell(trimmed.slice(1)); return; }
  const parts = trimmed.split(/\s+/);
  const c = parts[0] || '';
  switch (c) {
    case 'w': {
      let target: string | null = null;
      if (parts[1]) {
        target = path.resolve(parts[1]);
      }
      if (target) {
        const prev = buf.filePath;
        const prevLang = buf.lang;
        buf.filePath = target;
        setLangFor(parts[1]);
        if (!saveFile()) {
          buf.filePath = prev;
          buf.lang = prevLang;
        } else buildTree();
      } else {
        if (saveFile()) buildTree();
      }
      break;
    }
    case 'q':
      stashBuf();
      if (buffers.some((e) => e.b.modified)) say('Unsaved changes — :w or :q! to force', true);
      else quit();
      break;
    case 'q!': quit(); break;
    case 'wq': case 'x': if (saveFile()) quit(); break;
    case 'e': if (parts[1]) { openFile(parts.slice(1).join(' ')); buildTree(); } else say('Usage: :e <file>', true); break;
    case 'new':
      stashBuf();
      if (buf.modified) { say('Unsaved changes — :w first', true); break; }
      buffers.push(blankEntry());
      panes[activePane] = buffers.length - 1;
      loadBuf(panes[activePane]);
      matches = [];
      matchIdx = -1;
      matchCapped = false;
      buildTree();
      break;
    case 'ls': {
      stashBuf();
      say(buffers.map((e, i) => `${i === curIdx() ? '>' : ' '} ${bufLabel(i)}`).join(' · ') || 'no buffers', true);
      break;
    }
    case 'bn': case 'bp': {
      const d = c === 'bn' ? 1 : -1;
      switchBuf((curIdx() + d + buffers.length) % buffers.length, false);
      break;
    }
    case 'b': {
      if (!parts[1]) { say('Usage: :b <n|name>', true); break; }
      const arg = parts.slice(1).join(' ');
      const force = arg.endsWith('!');
      const key = force ? arg.slice(0, -1) : arg;
      let idx = /^\d+$/.test(key) ? parseInt(key, 10) - 1 : buffers.findIndex((e) => e.b.filePath && path.basename(e.b.filePath) === key);
      if (idx < 0 || idx >= buffers.length) { say('No such buffer', true); break; }
      switchBuf(idx, force);
      break;
    }
    case 'bd': case 'bd!': closeBufEntry(panes[activePane], c === 'bd!'); break;
    case 'sp': {
      stashBuf();
      const e = blankEntry();
      buffers.push(e);
      const ni = buffers.length - 1;
      if (parts[1] && !readInto(e, parts.slice(1).join(' '))) { buffers.pop(); break; }
      splitOn = true;
      panes = [curIdx(), ni];
      activePane = 1;
      loadBuf(ni);
      say('Split — Ctrl+W switches pane · :only closes');
      break;
    }
    case 'only': stashBuf(); splitOn = false; panes = [curIdx()]; activePane = 0; break;
    case 's': {
      const m = /^s\/([\s\S]*)\/([\s\S]*)\/(g?)$/.exec(trimmed.slice(1).trim());
      if (!m) { say('Usage: :s/old/new/g', true); break; }
      if (!m[1]) { say('Nothing to replace', true); break; }
      snapshot();
      let n = 0;
      try {
        const re = new RegExp(m[1], m[3] ? 'g' : '');
        buf.lines = buf.lines.map((l) => l.replace(re, () => { n++; return m[2]; }));
      } catch { say('Bad pattern', true); undoStack.pop(); break; }
      if (!n) { undoStack.pop(); say('No match', true); break; }
      buf.modified = true;
      say(`Replaced ${n}`);
      break;
    }
    case 'rm': case 'rm!': {
      const target = parts.slice(1).join(' ');
      if (!target) { say('Usage: :rm[!] <path>', true); break; }
      const fp = path.resolve(target);
      try {
        const st = fs.statSync(fp);
        if (st.isDirectory() && c !== 'rm!') { say('Directory — use :rm! to recurse', true); break; }
        if (st.isDirectory()) fs.rmSync(fp, { recursive: true, force: true });
        else fs.unlinkSync(fp);
        say(`Deleted ${target}`);
        buildTree();
        if (buf.filePath === fp) say('Deleted open file — :w recreates it', true);
      } catch { say('Delete failed — no such file', true); }
      break;
    }
    case 'mv': {
      if (parts.length < 3) { say('Usage: :mv <old> <new>', true); break; }
      try {
        const to = path.resolve(parts.slice(2).join(' '));
        if (fs.existsSync(to)) { say('Rename failed — destination already exists', true); break; }
        fs.mkdirSync(path.dirname(to), { recursive: true });
        const fromFp = path.resolve(parts[1]);
        fs.renameSync(fromFp, to);
        if (buf.filePath === fromFp) { buf.filePath = to; setLangFor(to); }
        buffers.forEach((e) => { if (e.b.filePath === fromFp) { e.b.filePath = to; e.b.lang = entryLang(to); } });
        say(`Renamed to ${parts.slice(2).join(' ')}`);
        buildTree();
      } catch { say('Rename failed', true); }
      break;
    }
    case 'run': {
      if (!buf.filePath) { say('Open a file first', true); break; }
      if (buf.modified && !saveFile()) break;
      const ext = getFileExtension(buf.filePath);
      const runner = runnerFor(ext);
      if (!runner) { say(`No runner for .${ext || '?'}`, true); break; }
      const dir = path.dirname(buf.filePath);
      runShell(`${runner} ${shellQuote(path.basename(buf.filePath))}`, dir === '' ? process.cwd() : dir);
      break;
    }
    case 'term': {
      const arg = (parts[1] || '').toLowerCase();
      if (arg === '+' || arg === 'bigger') { termMaxed = false; termHeight = clamp(termHeight + 2, 6, 30); }
      else if (arg === '-' || arg === 'smaller') { termMaxed = false; termHeight = clamp(termHeight - 2, 6, 30); }
      else if (arg === 'max') { termMaxed = !termMaxed; }
      else if (/^\d+$/.test(arg)) { termMaxed = false; termHeight = clamp(parseInt(arg, 10), 6, 30); }
      else if (arg === 'clear' || arg === 'cls') { termLines.clear(); termScroll = 0; }
      termOpen = true; focus = 'term'; termScroll = 0;
      try { scheduleSessionSave({ termHeight, termMaxed }); } catch { /* noop */ }
      say(termMaxed ? 'Terminal max — :term max to restore' : `Terminal — ${termHeight} rows · :term +/- resize · PgUp/PgDn scroll`);
      break;
    }
    case 'tree': treeVisible = !treeVisible; try { scheduleSessionSave({ treeVisible }); } catch { /* noop */ } say(treeVisible ? 'Explorer shown' : 'Explorer hidden'); break;
    case 'set': {
      const key = (parts[1] || '').toLowerCase();
      if (key === 'mouse') {
        const val = (parts[2] || '').toLowerCase();
        setMouse(val ? val !== 'off' && val !== '0' : !mouseOn);
      } else say('Usage: :set mouse [on|off]', true);
      break;
    }
    case 'theme':
      if (!parts[1]) { say(`theme: ${themeName} — :theme <name> · available: ${THEME_NAMES.join(', ')}`, true); }
      else {
        const want = parts.slice(1).join(' ').trim().toLowerCase();
        if (setTheme(want)) { say(`theme: ${want}`); }
        else { say(`Unknown theme: ${parts[1]} — available: ${THEME_NAMES.join(', ')}`, true); }
      }
      break;
    case 'themes': say(`themes: ${THEME_NAMES.join(', ')}`, true); break;
    case 'commands': say(`themes: ${THEME_NAMES.join(', ')} — :theme <name>`, true); break;
    case 'help': say(':w :q :e :new :bn/:bp/:ls/:bd · :sp/:only Ctrl+W · :s :rm :mv :run · :theme · :set mouse · :!cmd :term[+/- /max] · term: cd/clear/exit/history/pwd · vim: counts d/c/y/i-a q/@ Ctrl+N · v/V visual o d/y/c · . repeat · ma \'a mA Ctrl+O Tab jumps', true); break;
    case '':
      break;
    default:
      if (/^\d+$/.test(c)) {
        buf.cy = clamp(parseInt(c, 10) - 1, 0, buf.lines.length - 1);
        buf.cx = 0; clampCur();
      } else say(`Unknown: ${c}`, true);
  }
}

/* ---------- input ---------- */

function visibleMainHeight(): number {
  const { h } = size();
  const termH = termOpen ? termHeightFor(h) : 0;
  return Math.max(1, h - 1 - termH - 1);
}

function termHeightFor(h: number): number {
  if (termMaxed) return clamp(h - 8, 6, h - 4);
  return clamp(termHeight, 6, Math.max(6, h - 8));
}

function cycleFocus(): void {
  focus = focus === 'edit' ? (treeVisible ? 'tree' : termOpen ? 'term' : 'edit')
    : focus === 'tree' ? (termOpen ? 'term' : 'edit')
    : 'edit';
  if (focus !== 'edit' && vim === 'insert') vim = 'normal';
}

function treeActivate(): void {
  const e = tree[treeSel];
  if (!e) return;
  if (e.isDir) { say(e.rel + '/', true); return; }
  openFile(e.rel);
}

function wordForward(): void {
  const l = curLine();
  let x = buf.cx;
  while (x < l.length && isWordChar(l[x])) x++;
  while (x < l.length && !isWordChar(l[x])) x++;
  buf.cx = clamp(x, 0, l.length);
}

function wordBack(): void {
  const l = curLine();
  let x = buf.cx;
  while (x > 0 && !isWordChar(l[x - 1])) x--;
  while (x > 0 && isWordChar(l[x - 1])) x--;
  buf.cx = x;
}

const CSI_MAP: Record<string, string> = { A: 'UP', B: 'DOWN', C: 'RIGHT', D: 'LEFT', H: 'HOME', F: 'END' };

function editNormal(key: string): void {
  switch (key) {
    case 'i': vim = 'insert'; insBegin(['i']); break;
    case 'I': buf.cx = 0; vim = 'insert'; insBegin(['I']); break;
    case 'a': buf.cx = Math.min(buf.cx + 1, curLine().length); vim = 'insert'; insBegin(['a']); break;
    case 'A': buf.cx = curLine().length; vim = 'insert'; insBegin(['A']); break;
    case 'o': buf.cx = curLine().length; newline(); vim = 'insert'; insBegin(['o']); break;
    case 'O': snapshot(); buf.lines.splice(buf.cy, 0, ''); buf.cx = 0; buf.modified = true; vim = 'insert'; insBegin(['O']); break;
    case ':': visualExit(); vim = 'command'; cmdBuf = ''; break;
    case '/': visualExit(); vim = 'search'; searchBuf = ''; matches = []; matchIdx = -1; matchCapped = false; break;
    case 'n': if (matches.length) { if (!visual) pushJump(); matchIdx = (matchIdx + 1) % matches.length; jumpMatch(); } break;
    case 'N': if (matches.length) { if (!visual) pushJump(); matchIdx = (matchIdx - 1 + matches.length) % matches.length; jumpMatch(); } break;
    case '0': buf.cx = 0; break;
    case '$': buf.cx = curLine().length; break;
    case 'D':
      setDot(['D']);
      snapshot();
      buf.lines[buf.cy] = curLine().slice(0, buf.cx);
      buf.modified = true;
      break;
    case 'DEL': { // Delete key
      if (buf.cx < curLine().length) {
        setDot(['DEL']);
        snapshot();
        // Remove a whole surrogate pair when one straddles the cursor —
        // deleting a single unit orphans the other (renders as U+FFFD).
        const l = curLine();
        let s0 = buf.cx;
        const cs = l.charCodeAt(s0);
        if (cs >= 0xdc00 && cs <= 0xdfff && s0 > 0) s0--;
        const c = l.charCodeAt(s0);
        const pair = c >= 0xd800 && c <= 0xdbff && s0 + 1 < l.length &&
          l.charCodeAt(s0 + 1) >= 0xdc00 && l.charCodeAt(s0 + 1) <= 0xdfff;
        buf.lines[buf.cy] = l.slice(0, s0) + l.slice(s0 + (pair ? 2 : 1));
        buf.cx = clamp(s0, 0, buf.lines[buf.cy].length);
        buf.modified = true;
      }
      break;
    }
    case 'u': undo(); break;
    case 'r': redo(); break;
    case '\x13': saveFile(); break; // Ctrl+S
    case '\x04': // Ctrl+D — half page down
      buf.cy = Math.min(buf.lines.length - 1, buf.cy + Math.max(1, Math.floor(visibleMainHeight() / 2)));
      clampCur();
      break;
    case '\x15': // Ctrl+U — half page up
      buf.cy = Math.max(0, buf.cy - Math.max(1, Math.floor(visibleMainHeight() / 2)));
      clampCur();
      break;
    case 'UP': buf.cy = Math.max(0, buf.cy - 1); clampCur(); break;
    case 'DOWN': buf.cy = Math.min(buf.lines.length - 1, buf.cy + 1); clampCur(); break;
    case 'LEFT': buf.cx = Math.max(0, buf.cx - 1); break;
    case 'RIGHT': buf.cx = Math.min(curLine().length, buf.cx + 1); break;
    case 'HOME': buf.cy = 0; buf.cx = 0; break;
    case 'END': buf.cy = buf.lines.length - 1; buf.cx = curLine().length; break;
    case 'PGUP': buf.cy = Math.max(0, buf.cy - visibleMainHeight()); clampCur(); break;
    case 'PGDN': buf.cy = Math.min(buf.lines.length - 1, buf.cy + visibleMainHeight()); clampCur(); break;
  }
}

function killTree(p: any): void {
  if (!p) return;
  try {
    if (process.platform === 'win32') {
      spawnSync('taskkill', taskkillArgs(p.pid), { windowsHide: true, timeout: 5000 });
      return;
    }
    p.kill('SIGTERM');
  } catch { /* noop */ }
}

function onKey(key: string): void {
  if (key === '\x03') { // Ctrl+C — kills running term cmd first, never strands output
    if (focus === 'term' && termChild) {
      killTree(termChild);
      setTimeout(() => { try { const c = termChild; if (c && process.platform !== 'win32') c.kill('SIGKILL'); } catch { /* noop */ } }, 2000);
      termPrint(fg(T.yellow) + '^C' + RESET);
      paint();
      return;
    }
    if (focus === 'term' && termInput) { termInput = ''; termCursor = 0; paint(); return; }
    if (buf.modified) { say('Unsaved changes — :q! to quit', true); paint(); return; }
    quit();
  }
  if (key === '\x09') {
    if (leader) {
      clearLeader();
      if (vim === 'insert' && focus === 'edit' && buf.cx > 0 && curLine()[buf.cx - 1] === ' ') {
        buf.lines[buf.cy] = curLine().slice(0, buf.cx - 1) + curLine().slice(buf.cx);
        buf.cx--;
        buf.modified = true;
      }
      termOpen = !termOpen;
      focus = termOpen ? 'term' : 'edit';
    } else if (vim === 'insert' && focus === 'edit') {
      const g = ghostFor(buf, true);
      if (g && buf.cx === curLine().length) {
        recordKey(g);
        insertText(g);
      } else {
        recordKey('  ');
        insPush('\x09');
        insertText('  ');
      }
    } else if (focus === 'term') {
      termOpen = false;
      focus = 'edit';
    } else if (vim === 'normal' && focus === 'edit') { jumpFwd(); } // Tab == Ctrl+I (vim conflation)
    else cycleFocus();
    paint();
    return;
  } // Tab (Space+Tab toggles terminal; Tab indents in insert; Tab in terminal closes it)
  if (key === ' ' && focus === 'edit' && vim === 'normal') {
    armLeader();
    say('SPC — Tab: terminal');
    paint();
    return;
  } else clearLeader();
  if (key === '\x07') { cycleFocus(); paint(); return; } // Ctrl+G — cycle tree/edit/term focus
  if (key === '\x14') { // Ctrl+T
    termOpen = !termOpen;
    focus = termOpen ? 'term' : 'edit';
    paint();
    return;
  }
  if (key === '\x17' && splitOn) { // Ctrl+W — switch split pane
    stashBuf();
    activePane = activePane ? 0 : 1;
    loadBuf(curIdx());
    paint();
    return;
  }

  if (vim === 'command') {
    if (key === '\x1b') vim = 'normal';
    else if (key === '\r') { const c = cmdBuf; vim = 'normal'; runCmd(c); }
    else if (key === '\x7f' || key === '\x08') cmdBuf = cmdBuf.slice(0, -1);
    else if (key.length === 1 && key >= ' ') cmdBuf += key;
    paint();
    return;
  }
  if (vim === 'search') {
    if (key === '\x1b') vim = 'normal';
    else if (key === '\r') { vim = 'normal'; if (matches.length) { if (!visual) pushJump(); jumpMatch(); } }
    else if (key === '\x7f' || key === '\x08') { searchBuf = searchBuf.slice(0, -1); doSearch(searchBuf); }
    else if (key.length === 1 && key >= ' ') { searchBuf += key; doSearch(searchBuf); }
    paint();
    return;
  }

  if (focus === 'tree') {
    switch (key) {
      case '\x1b': case 'q': focus = 'edit'; break;
      case 'j': case 'DOWN': treeSel = Math.min(tree.length - 1, treeSel + 1); break;
      case 'k': case 'UP': treeSel = Math.max(0, treeSel - 1); break;
      case '\r': treeActivate(); focus = 'edit'; break;
      case 'R': buildTree(); say('Explorer refreshed'); break;
    }
    paint();
    return;
  }

  if (focus === 'term') {
    if (key === '\x1b') { focus = 'edit'; paint(); return; }
    if (key === '\r') { const c = termInput; termInput = ''; termCursor = 0; termHistIdx = -1; termScroll = 0; runShell(c); return; }
    if (key === '\x7f' || key === '\x08') { // backspace at cursor
      if (termCursor > 0) { termInput = termInput.slice(0, termCursor - 1) + termInput.slice(termCursor); termCursor--; }
      paint(); return;
    }
    if (key === 'DEL') { // delete at cursor
      if (termCursor < termInput.length) termInput = termInput.slice(0, termCursor) + termInput.slice(termCursor + 1);
      paint(); return;
    }
    if (key === 'LEFT') { termCursor = Math.max(0, termCursor - 1); paint(); return; }
    if (key === 'RIGHT') { termCursor = Math.min(termInput.length, termCursor + 1); paint(); return; }
    if (key === 'HOME' || key === '\x01') { termCursor = 0; paint(); return; } // Ctrl+A
    if (key === 'END' || key === '\x05') { termCursor = termInput.length; paint(); return; } // Ctrl+E
    if (key === '\x15') { termInput = termInput.slice(termCursor); termCursor = 0; paint(); return; } // Ctrl+U
    if (key === '\x0b') { termInput = termInput.slice(0, termCursor); paint(); return; } // Ctrl+K
    if (key === '\x17') { // Ctrl+W — delete word back
      let i = termCursor;
      while (i > 0 && termInput[i - 1] === ' ') i--;
      while (i > 0 && termInput[i - 1] !== ' ') i--;
      termInput = termInput.slice(0, i) + termInput.slice(termCursor);
      termCursor = i;
      paint(); return;
    }
    if (key === '\x0c') { termLines.clear(); termScroll = 0; paint(); return; } // Ctrl+L clear
    if (key === 'UP') {
      if (termHist.length) {
        if (termHistIdx === -1) termDraft = termInput;
        termHistIdx = clamp(termHistIdx + 1, 0, termHist.length - 1);
        termInput = termHist[termHistIdx];
        termCursor = termInput.length;
      }
      paint();
      return;
    }
    if (key === 'DOWN') {
      termHistIdx = termHistIdx <= 0 ? -1 : termHistIdx - 1;
      termInput = termHistIdx < 0 ? termDraft : termHist[termHistIdx];
      termCursor = termInput.length;
      paint();
      return;
    }
    if (key === 'PGUP') { termScroll = clamp(termScroll + Math.max(1, termHeightFor(size().h) - 3), 0, Math.max(0, termLines.length - 1)); paint(); return; }
    if (key === 'PGDN') { termScroll = clamp(termScroll - Math.max(1, termHeightFor(size().h) - 3), 0, Math.max(0, termLines.length - 1)); paint(); return; }
    if (key.length === 1 && key >= ' ') {
      termInput = termInput.slice(0, termCursor) + key + termInput.slice(termCursor);
      termCursor += key.length;
      termScroll = 0;
      paint();
    }
    return;
  }

  // focus === 'edit'
  if (vim === 'insert') {
    cmpState = (key === '\x0e' || key === '\x10') ? cmpState : null;
    if (key === '\x1b') { recordKey('\x1b'); vim = 'normal'; clampCur(); insEnd(); }
    else if (key === '\x0e' || key === '\x10') completeWord(key === '\x0e' ? 1 : -1);
    else if (key === '\r') { recordKey('\n'); insPush('\r'); newline(); }
    else if (key === '\x7f' || key === '\x08') { recordKey('\b'); insPush('\x7f'); backspace(); }
    else if (key === '\x13') saveFile();
    else if (key === 'UP') { insPush(key); buf.cy = Math.max(0, buf.cy - 1); clampCur(); }
    else if (key === 'DOWN') { insPush(key); buf.cy = Math.min(buf.lines.length - 1, buf.cy + 1); clampCur(); }
    else if (key === 'LEFT') { insPush(key); buf.cx = Math.max(0, buf.cx - 1); }
    else if (key === 'RIGHT') { insPush(key); buf.cx = Math.min(curLine().length, buf.cx + 1); }
    else if (key.length === 1 && key >= ' ') { insPush(key); insertText(key); }
    paint();
    return;
  }
  if (vim === 'normal' && focus === 'edit' && vimKey(key)) { paint(); return; }
  editNormal(key);
  paint();
}

/* Parse raw stdin chunks into keys */
const CSI_RE = /^\x1b\[([0-9;?<>=!]*)([A-Za-z~])/;
let feedPartial = '';
let mouseOn = false;
try { mouseOn = loadConfig().mouse === true; } catch { /* keep off */ }
function setMouse(on: boolean): void {
  mouseOn = on;
  try {
    const cfg = loadConfig();
    cfg.mouse = on;
    saveConfig(cfg);
  } catch { /* non-fatal */ }
  try { process.stdout.write(on ? '\x1b[?1000h' : '\x1b[?1000l'); } catch { /* noop */ }
  say(on ? 'Mouse on — click to move, wheel scrolls' : 'Mouse off');
}
/** X10 mouse report: left-click positions the cursor, wheel scrolls. */
function handleMouse(cb: number, col1: number, row1: number): void {
  const { w, h } = size();
  const cx = col1 - 1, cy = row1 - 1;
  if (cx < 0 || cy < 0 || cx >= w || cy >= h) return;
  const termH = termOpen ? termHeightFor(h) : 0;
  const mainEnd = h - 1 - termH;
  if (cb & 64) {
    const d = (cb & 1) ? 3 : -3;
    if (cy >= 1 && cy < mainEnd) {
      if (treeVisible && cx < 26) {
        treeScroll = Math.max(0, treeScroll + d);
      } else {
        for (const rg of layoutRegions(h, termH)) {
          if (cy >= rg.y0 && cy < rg.y1) {
            // buffers[i].b is only a stash — the ACTIVE pane must scroll the
            // live buf (same rule paint() uses), otherwise wheel-scrolling the
            // active pane mutates a stale snapshot that paint never reads.
            const B = rg.active ? buf : buffers[rg.bi]?.b;
            if (B) B.sy = Math.max(0, B.sy + d);
            break;
          }
        }
      }
      paint();
    } else if (termOpen && cy >= mainEnd) {
      termScroll = clamp(termScroll + d, 0, Math.max(0, termLines.length - 1));
      paint();
    }
    return;
  }
  if ((cb & 3) !== 0) return;
  if (cy < 1 || cy >= mainEnd) {
    if (termOpen && cy >= mainEnd && cy < h - 1) { focus = 'term'; paint(); }
    return;
  }
  const tw = treeVisible ? 26 : 0;
  if (treeVisible && cx < tw) {
    const idx = treeScroll + (cy - 1);
    if (idx >= 0 && idx < tree.length) { treeSel = idx; focus = 'tree'; paint(); }
    return;
  }
  for (const rg of layoutRegions(h, termH)) {
    if (cy < rg.y0 || cy >= rg.y1) continue;
    stashBuf();
    if (rg.bi !== curIdx()) {
      if (buf.modified) { say('Unsaved changes — :w first', true); loadBuf(curIdx()); return; }
      panes[activePane] = rg.bi;
      loadBuf(rg.bi);
    }
    if (!buffers[rg.bi]) continue;
    focus = 'edit';
    // Resolve line/col from the LIVE buffer: buffers[rg.bi].b captured before
    // the stash/load above is a stale snapshot (sy/sx/lines from the last
    // stashBuf), so clicks landed on the wrong line after any keyboard
    // scrolling or edits since that stash.
    const digits = String(buf.lines.length).length;
    const codeX = tw + 1 + (splitOn ? 1 : 0) + digits + 1;
    const lineIdx = clamp(buf.sy + (cy - rg.y0), 0, buf.lines.length - 1);
    buf.cy = lineIdx;
    const line = curLine();
    buf.cx = cx <= codeX ? 0 : clamp(cx - codeX + buf.sx, 0, line.length);
    clampCur();
    paint();
    return;
  }
}
function feed(data: Buffer): void {
  const s = feedPartial + data.toString('utf-8');
  feedPartial = '';
  // Batch consecutive printable chars into fewer paints
  let pendingInsert = '';
  const flushInsert = () => {
    if (pendingInsert) {
      recordKey(pendingInsert);
      if (insEntry && !replayingDot) for (const ch of pendingInsert) insChars.push(ch);
      for (const ch of pendingInsert) insertText(ch);
      pendingInsert = '';
      paint();
    }
  };
  let i = 0;
  while (i < s.length) {
    if (s[i] === '\x1b' && s[i + 1] === '[' && s[i + 2] === 'M') {
      if (i + 5 >= s.length) { feedPartial = s.slice(i); break; }
      flushInsert();
      if (mouseOn) handleMouse(s.charCodeAt(i + 3) - 32, s.charCodeAt(i + 4) - 32, s.charCodeAt(i + 5) - 32);
      i += 6;
    } else if (s[i] === '\x1b' && s[i + 1] === '[') {
      const m = s.slice(i).match(CSI_RE);
      if (!m) {
        // Only hold a partial CSI while it could still become one (params are
        // 0x20-0x3F, and the prefix stays short). Holding anything else made
        // feedPartial swallow every future keystroke forever — and grow
        // without bound — e.g. after '\x1b[[' or an unknown sequence.
        const rest = s.slice(i + 2);
        if (rest.length <= 16 && /^[\x20-\x3f]*$/.test(rest)) { feedPartial = s.slice(i); break; }
        flushInsert();
        onKey('\x1b');
        i += 1;
        continue;
      }
      flushInsert();
      const code = m[2];
      const nums = m[1];
      const base = nums.split(';')[0];
      let key: string;
      if (CSI_MAP[code]) key = CSI_MAP[code];
      else if (code === '~') {
        key = base === '5' ? 'PGUP' : base === '6' ? 'PGDN' : base === '1' ? 'HOME' :
          base === '4' ? 'END' : base === '3' ? 'DEL' : '\x1b';
      } else key = '\x1b';
      onKey(key);
      i += m[0].length;
    } else if (s[i] === '\x1b' && s[i + 1] === 'O') {
      if (i + 2 >= s.length) { feedPartial = s.slice(i); break; }
      flushInsert();
      const c = s[i + 2];
      onKey(c === 'H' ? 'HOME' : c === 'F' ? 'END' : '\x1b');
      i += 3;
    } else if (s[i] === '\x1b' && i + 1 >= s.length) {
      // Lone ESC at the end of this chunk: deliver it NOW. Holding it until
      // the next read meant a bare Esc keystroke never took effect — the
      // pending ESC was only flushed right before the *following* key, so
      // INSERT/VISUAL never left on Esc alone.
      flushInsert();
      onKey('\x1b');
      i++;
    } else {
      const ch = s[i];
      if (vim === 'insert' && focus === 'edit' && ch.length === 1 && ch >= ' ' && ch !== '\x7f') {
        pendingInsert += ch;
        // Flush on newline-ish or large batch to keep latency low
        if (pendingInsert.length >= 64) flushInsert();
        i++;
      } else {
        flushInsert();
        onKey(ch);
        i++;
      }
    }
  }
  flushInsert();
}

function cleanup(): void {
  try { persistUndoAll(); } catch { /* noop */ }
  try {
    saveSession({
      theme: themeName,
      termHeight,
      termMaxed,
      treeVisible,
      lastFile: buf.filePath,
      lastProject: process.cwd(),
    });
  } catch { /* noop */ }
  try { flushSession(); } catch { /* noop */ }
  try {
    if (termChild) {
      if (process.platform === 'win32') killTree(termChild);
      else termChild.kill('SIGKILL');
    }
  } catch { /* noop */ }
  termChild = null;
  if (msgTimer) { clearTimeout(msgTimer); msgTimer = null; }
  if (leaderTimer) { clearTimeout(leaderTimer); leaderTimer = null; }
  feedPartial = '';
  process.stdout.write('\x1b[?25h\x1b[?1000l');
  if (process.stdin.isTTY) {
    try { process.stdin.setRawMode(false); } catch { /* noop */ }
  }
  process.stdin.removeAllListeners('data');
  process.stdout.removeListener('resize', paint);
  process.stdin.pause();
}

function anyModified(): boolean {
  try { stashBuf(); } catch { /* noop */ }
  return buffers.some((e) => e.b.modified);
}
function enterScreen(): void {
  feedPartial = '';
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  if (mouseOn) { try { process.stdout.write('\x1b[?1000h'); } catch { /* noop */ } }
  try { process.stdin.setRawMode(true); } catch { /* noop */ }
  process.stdin.resume();
  process.stdin.on('data', feed);
  process.stdout.on('resize', paint);
  paint();
}
function leaveScreen(): void {
  process.stdout.write('\x1b[?1049l\x1b[?25h\x1b[?1000l');
  try { if (process.stdin.isTTY) process.stdin.setRawMode(false); } catch { /* noop */ }
  process.stdin.removeAllListeners('data');
  process.stdout.removeListener('resize', paint);
}
let confirmingQuit = false;
async function confirmQuit(): Promise<void> {
  if (confirmingQuit) {
    cleanup();
    process.stdout.write('\x1b[?1049l');
    process.exit(0);
    return;
  }
  confirmingQuit = true;
  try {
    stashBuf();
    const dirty = buffers
      .map((e, i) => (e.b.modified ? (e.b.filePath ? path.basename(e.b.filePath) : `buffer ${i + 1}`) : ''))
      .filter(Boolean);
    if (!dirty.length) {
      cleanup();
      process.stdout.write('\x1b[?1049l');
      process.exit(0);
      return;
    }
    leaveScreen();
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
    let ans = '';
    try {
      ans = (await new Promise<string>((res) => {
        rl.question(`Unsaved changes in: ${dirty.join(', ')} — quit anyway? (y/N) `, res);
        // stdin EOF closes the interface without ever invoking the question
        // callback (Node readline docs: 'close' fires on end-of-input) —
        // without this the promise never settles, confirmingQuit stays true,
        // and the editor hangs. Same bug class as the fixed one in index.ts.
        rl.once('close', () => res(''));
      })).trim().toLowerCase();
    } catch { ans = ''; }
    try { rl.close(); } catch { /* noop */ }
    if (ans === 'y' || ans === 'yes') {
      cleanup();
      process.stdout.write('\x1b[?1049l');
      process.exit(0);
      return;
    }
    enterScreen();
  } finally {
    confirmingQuit = false;
  }
}

export function startEditor(filePath?: string): void {
  if (started) return;
  started = true;
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    console.log('\nTypeWriter terminal editor needs an interactive terminal (TTY).');
    console.log('Use the web editor instead:  npm run serve  -> open Web Preview (port 3000).\n');
    started = false;
    return;
  }
  try {
    try {
      const sess = loadSession();
      if (Number.isFinite(sess.termHeight)) termHeight = Math.max(4, Math.min(60, sess.termHeight as number));
      if (typeof sess.termMaxed === 'boolean') termMaxed = sess.termMaxed;
      if (typeof sess.treeVisible === 'boolean') treeVisible = sess.treeVisible;
    } catch { /* defaults stand */ }
    buildTree();
    if (!buffers.length) buffers.push({ b: { ...buf, lines: [...buf.lines] }, u: undoStack, r: redoStack });
    panes = [0];
    activePane = 0;
    splitOn = false;
    if (filePath) {
      const resolved = path.resolve(filePath);
      if (fileExists(resolved)) {
        if (isBinaryFile(resolved)) {
          console.log(`\nBinary file — cannot edit ${path.basename(resolved)}\n`);
          started = false;
          return;
        }
        const raw = readFileSync(resolved);
        if (Buffer.byteLength(raw) > MAX_OPEN_BYTES) {
          console.log(`\n${path.basename(resolved)} is too large to open in the terminal editor — use the web editor.\n`);
          started = false;
          return;
        }
        buf.lines = raw.split(/\r?\n/);
        if (!buf.lines.length) buf.lines = [''];
        buf.filePath = resolved;
        setLangFor(resolved);
      } else {
        buf.filePath = resolved;
        setLangFor(resolved);
        buf.modified = false;
        say(`New file ${path.basename(resolved)}`);
      }
    } else {
      say('Tab jump forward · Ctrl+G panes · :term shell · :help keys · :q quit');
    }
    resetBufStateKeepFile();
  } catch (e) {
    console.error(`Failed to start editor: ${(e as Error).message}`);
    started = false;
    return;
  }
  process.stdout.write('\x1b[?1049h\x1b[?25l');
  try {
    process.stdin.setRawMode(true);
  } catch {
    started = false;
    return;
  }
  if (mouseOn) { try { process.stdout.write('\x1b[?1000h'); } catch { /* noop */ } }
  process.stdin.resume();
  paint();
  process.stdin.on('data', feed);
  process.stdout.on('resize', paint);
  process.on('exit', cleanup);
  process.on('SIGINT', () => { void confirmQuit(); });
  // Signal termination does NOT emit 'exit' (Node docs: 'exit' fires only for
  // explicit process.exit() or a drained event loop), so without these
  // handlers `kill <pid>` skipped cleanup() and left raw mode + the alt
  // screen enabled on the terminal.
  process.on('SIGTERM', () => quit());
  process.on('SIGHUP', () => quit());
}

function resetBufStateKeepFile(): void {
  buf.cx = 0; buf.cy = 0; buf.sx = 0; buf.sy = 0;
  buf.modified = false;
  undoStack.clear();
  redoStack.clear();
  matches = [];
  matchIdx = -1;
  matchCapped = false;
}

export function getState() {
  return { filePath: buf.filePath, content: [...buf.lines], mode: vim, modified: buf.modified };
}
export function getEditorContent(): string { return buf.lines.join('\n'); }
export function setEditorContent(content: string): void {
  buf.lines = content.split(/\r?\n/);
  if (!buf.lines.length) buf.lines = [''];
  buf.cy = clamp(buf.cy, 0, buf.lines.length - 1);
  buf.cx = clamp(buf.cx, 0, curLine().length);
  buf.sx = 0; buf.sy = 0;
  undoStack.clear();
  redoStack.clear();
  matches = [];
  matchIdx = -1;
  matchCapped = false;
  buf.modified = true;
}
export function getCurrentFilePath(): string | null { return buf.filePath; }
