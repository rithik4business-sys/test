/**
 * Free, offline, any-language line completion.
 *
 * No network, no API keys, no dependencies: suggestions come from the
 * current buffer itself (recent lines + token co-occurrence) with tiny
 * per-language snippet tables as a fallback. Both the TUI and the web
 * editor render the result as ghost text accepted with Tab.
 */

export type CompletionSource = 'recent' | 'snippet' | 'ngram' | 'bracket';

export interface CompletionInput {
  /** Current line text up to the caret. */
  prefix: string;
  /** Current line text after the caret. */
  after: string;
  /** Buffer lines (oldest → newest); callee scans the tail only. */
  lines: string[];
  /** Language id, e.g. 'typescript' | 'python' | 'powershell'. */
  lang?: string;
}

export interface Completion {
  /** Suffix to insert at the caret (single line). */
  text: string;
  source: CompletionSource;
}

const MAX_SCAN_LINES = 400;
const MAX_SUGGEST_LEN = 100;

// Hoisted patterns: these run on every keystroke; a regex literal allocates a
// fresh RegExp object on each evaluation (same convention as highlight.ts).
const RE_WORD = /[A-Za-z_$][A-Za-z0-9_$]*/g;
const RE_WORD_CH = /[A-Za-z0-9_$]/;
const RE_NONSPACE = /\S/;
const RE_LAST_WORD = /([A-Za-z_$][A-Za-z0-9_$]*)$/;
const RE_TRAILING_OPENER = /\s*([{[(])\s*$/;

export function tokenizeWords(s: string): string[] {
  // RE_WORD is /g, and String.prototype.match resets a global regex's
  // lastIndex before collecting, so hoisting is stateless here.
  const m = String(s).match(RE_WORD);
  return m || [];
}

/** Most recent earlier line that starts with `prefix`, minus the prefix. */
function recentSuffix(prefix: string, lines: string[]): string | null {
  if (!prefix || !RE_NONSPACE.test(prefix) || prefix.trim().length < 2) return null;
  // Match against the FULL prefix: truncating it makes startsWith() and
  // slice() disagree — a line matching only the tail would yield a suffix
  // that duplicates characters when appended after the full prefix.
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l.length > prefix.length && l.startsWith(prefix)) {
      const suf = l.slice(prefix.length);
      if (suf && RE_NONSPACE.test(suf)) return suf.slice(0, MAX_SUGGEST_LEN);
    }
  }
  return null;
}

/** C-family brace languages vs indentation/`:` languages for snippets. */
const C_LIKE = new Set([
  'javascript', 'typescript', 'jsx', 'tsx', 'java', 'c', 'cpp', 'csharp',
  'go', 'rust', 'php', 'powershell', 'css', 'scss', 'less',
]);
const PY_LIKE = new Set(['python', 'ruby', 'bash', 'yaml']);

type SnipVariant = { c?: string; py?: string; any?: string };
const SNIPPETS: Record<string, SnipVariant> = {
  if: { c: ' (cond) {', py: ' cond:', any: ' ' },
  else: { c: ' {', py: ':', any: ' ' },
  for: { c: ' (let i = 0; i < n; i++) {', py: ' x in xs:', any: ' ' },
  while: { c: ' (cond) {', py: ' cond:', any: ' ' },
  function: { c: ' name() {', any: ' ' },
  func: { c: ' name() {', any: ' ' },
  fn: { c: ' name() {', any: ' ' },
  def: { py: ' name():', any: ' name():' },
  class: { c: ' Name {', py: ' Name:', any: ' ' },
  return: { any: ' value' },
  import: { any: ' module' },
  from: { any: ' module import name' },
  try: { c: ' {', py: ':', any: ' ' },
  switch: { c: ' (x) {', any: ' ' },
  case: { c: ' x:', any: ' x:' },
  print: { c: '()', py: '()', any: '()' },
  console: { c: '.log()', any: '' },
};

function snippetFor(trigger: string, lang: string): string | null {
  const v = SNIPPETS[trigger];
  if (!v) return null;
  const fam = C_LIKE.has(lang) ? 'c' : PY_LIKE.has(lang) ? 'py' : 'any';
  const out = (fam === 'c' ? v.c ?? v.any : fam === 'py' ? v.py ?? v.any : v.any) ?? '';
  return out ? out : null;
}

/** Snippet trigger = last word of the prefix, caret glued to its end. */
function snippetSuffix(prefix: string, lang: string): string | null {
  const m = prefix.match(RE_LAST_WORD);
  if (!m) return null;
  return snippetFor(m[1], lang || 'text');
}

/** First index of `w` in `s` at a word boundary at or after `from`.
 *  `whole` additionally requires a boundary after the match, so complete
 *  tokens can't match inside a longer word ('foo' in 'foobar'). */
function indexOfWord(s: string, w: string, from: number, whole: boolean): number {
  let i = s.indexOf(w, from);
  while (i !== -1) {
    const before = i === 0 || !RE_WORD_CH.test(s[i - 1]);
    const after = !whole || i + w.length === s.length || !RE_WORD_CH.test(s[i + w.length]);
    if (before && after) return i;
    i = s.indexOf(w, i + 1);
  }
  return -1;
}

/** Token co-occurrence: most recent line containing the trailing word
 * pair in order — return everything after the pair, punctuation intact. */
function ngramSuffix(prefix: string, lines: string[]): string | null {
  const toks = tokenizeWords(prefix).slice(-2);
  if (toks.length < 2) return null;
  const [a, b] = toks;
  for (let i = lines.length - 1; i >= 0; i--) {
    const l = lines[i];
    if (l === prefix || l.length > 300) continue;
    // `a` is a complete token (both boundaries); `b` may be a partial word
    // still being typed, so only its start must sit on a boundary.
    const ia = indexOfWord(l, a, 0, true);
    if (ia === -1) continue;
    const ib = indexOfWord(l, b, ia + a.length, false);
    if (ib === -1) continue;
    const suf = l.slice(ib + b.length);
    if (suf && RE_NONSPACE.test(suf)) return suf.slice(0, MAX_SUGGEST_LEN);
  }
  return null;
}

const CLOSERS: Record<string, string> = { '{': '}', '[': ']', '(': ')' };

/** Unclosed opener as the last typed char with nothing after the caret. */
function bracketSuffix(prefix: string, after: string): string | null {
  if (after.trim()) return null;
  const m = prefix.match(RE_TRAILING_OPENER);
  if (!m) return null;
  return CLOSERS[m[1]] || null;
}

/**
 * Suggest a single-line completion suffix for the caret.
 * Order: recent identical-prefix line → snippet → token co-occurrence → bracket.
 * Returns null when nothing useful exists (never invent from thin air).
 */
export function suggestCompletion(input: CompletionInput): Completion | null {
  const prefix = String(input.prefix || '');
  const after = String(input.after || '');
  const lang = String(input.lang || 'text');
  const lines = (input.lines || []).slice(-MAX_SCAN_LINES);

  const recent = recentSuffix(prefix, lines);
  if (recent) return { text: recent, source: 'recent' };

  const snip = snippetSuffix(prefix, lang);
  if (snip) return { text: snip, source: 'snippet' };

  const ng = ngramSuffix(prefix, lines);
  if (ng) return { text: ng, source: 'ngram' };

  const br = bracketSuffix(prefix, after);
  if (br) return { text: br, source: 'bracket' };

  return null;
}
