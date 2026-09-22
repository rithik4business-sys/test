"use strict";
/**
 * Free, offline, any-language line completion.
 *
 * No network, no API keys, no dependencies: suggestions come from the
 * current buffer itself (recent lines + token co-occurrence) with tiny
 * per-language snippet tables as a fallback. Both the TUI and the web
 * editor render the result as ghost text accepted with Tab.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.tokenizeWords = tokenizeWords;
exports.suggestCompletion = suggestCompletion;
const MAX_SCAN_LINES = 400;
const MAX_SUGGEST_LEN = 100;
function tokenizeWords(s) {
    const m = String(s).match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
    return m || [];
}
/** Most recent earlier line that starts with `prefix`, minus the prefix. */
function recentSuffix(prefix, lines) {
    if (!prefix || !/\S/.test(prefix) || prefix.trim().length < 2)
        return null;
    if (prefix.length > 200)
        prefix = prefix.slice(-200);
    for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (l.length > prefix.length && l.startsWith(prefix)) {
            const suf = l.slice(prefix.length);
            if (suf && /\S/.test(suf))
                return suf.slice(0, MAX_SUGGEST_LEN);
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
const SNIPPETS = {
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
function snippetFor(trigger, lang) {
    const v = SNIPPETS[trigger];
    if (!v)
        return null;
    const fam = C_LIKE.has(lang) ? 'c' : PY_LIKE.has(lang) ? 'py' : 'any';
    const out = (fam === 'c' ? v.c ?? v.any : fam === 'py' ? v.py ?? v.any : v.any) ?? '';
    return out ? out : null;
}
/** Snippet trigger = last word of the prefix, caret glued to its end. */
function snippetSuffix(prefix, lang) {
    const m = prefix.match(/([A-Za-z_$][A-Za-z0-9_$]*)$/);
    if (!m)
        return null;
    return snippetFor(m[1], lang || 'text');
}
/** Token co-occurrence: most recent line containing the trailing word
 * pair in order — return everything after the pair, punctuation intact. */
function ngramSuffix(prefix, lines) {
    const toks = tokenizeWords(prefix).slice(-2);
    if (toks.length < 2)
        return null;
    const [a, b] = toks;
    for (let i = lines.length - 1; i >= 0; i--) {
        const l = lines[i];
        if (l === prefix || l.length > 300)
            continue;
        const ia = l.indexOf(a);
        if (ia === -1)
            continue;
        const ib = l.indexOf(b, ia + a.length);
        if (ib === -1)
            continue;
        const suf = l.slice(ib + b.length);
        if (suf && /\S/.test(suf))
            return suf.slice(0, MAX_SUGGEST_LEN);
    }
    return null;
}
const CLOSERS = { '{': '}', '[': ']', '(': ')' };
/** Unclosed opener as the last typed char with nothing after the caret. */
function bracketSuffix(prefix, after) {
    if (after.trim())
        return null;
    const m = prefix.match(/\s*([{[(])\s*$/);
    if (!m)
        return null;
    return CLOSERS[m[1]] || null;
}
/**
 * Suggest a single-line completion suffix for the caret.
 * Order: recent identical-prefix line → snippet → token co-occurrence → bracket.
 * Returns null when nothing useful exists (never invent from thin air).
 */
function suggestCompletion(input) {
    const prefix = String(input.prefix || '');
    const after = String(input.after || '');
    const lang = String(input.lang || 'text');
    const lines = (input.lines || []).slice(-MAX_SCAN_LINES);
    const recent = recentSuffix(prefix, lines);
    if (recent)
        return { text: recent, source: 'recent' };
    const snip = snippetSuffix(prefix, lang);
    if (snip)
        return { text: snip, source: 'snippet' };
    const ng = ngramSuffix(prefix, lines);
    if (ng)
        return { text: ng, source: 'ngram' };
    const br = bracketSuffix(prefix, after);
    if (br)
        return { text: br, source: 'bracket' };
    return null;
}
