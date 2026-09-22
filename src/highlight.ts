const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  italic: '\x1b[3m',
  underline: '\x1b[4m',

  black: '\x1b[30m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',

  brightBlack: '\x1b[90m',
  brightRed: '\x1b[91m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightBlue: '\x1b[94m',
  brightMagenta: '\x1b[95m',
  brightCyan: '\x1b[96m',
  brightWhite: '\x1b[97m',

  bgBlack: '\x1b[40m',
  bgRed: '\x1b[41m',
  bgGreen: '\x1b[42m',
  bgYellow: '\x1b[43m',
  bgBlue: '\x1b[44m',
  bgMagenta: '\x1b[45m',
  bgCyan: '\x1b[46m',
  bgWhite: '\x1b[47m',
};

interface Token {
  type: 'keyword' | 'string' | 'number' | 'comment' | 'function' | 'variable' | 'type' | 'operator' | 'punctuation' | 'text';
  value: string;
}

const KEYWORDS: Record<string, string[]> = {
  javascript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield', 'true', 'false', 'null', 'undefined', 'NaN', 'Infinity'],
  typescript: ['const', 'let', 'var', 'function', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'class', 'extends', 'new', 'this', 'import', 'export', 'default', 'from', 'async', 'await', 'try', 'catch', 'finally', 'throw', 'typeof', 'instanceof', 'in', 'of', 'void', 'delete', 'yield', 'true', 'false', 'null', 'undefined', 'type', 'interface', 'enum', 'implements', 'abstract', 'private', 'protected', 'public', 'readonly', 'as', 'is', 'keyof', 'infer', 'never', 'unknown', 'any', 'string', 'number', 'boolean', 'object', 'symbol', 'bigint'],
  python: ['def', 'class', 'return', 'if', 'elif', 'else', 'for', 'while', 'break', 'continue', 'import', 'from', 'as', 'try', 'except', 'finally', 'raise', 'with', 'yield', 'lambda', 'pass', 'True', 'False', 'None', 'and', 'or', 'not', 'in', 'is', 'del', 'global', 'nonlocal', 'assert', 'async', 'await'],
  ruby: ['def', 'class', 'module', 'end', 'return', 'if', 'elsif', 'else', 'unless', 'for', 'while', 'until', 'break', 'next', 'redo', 'retry', 'in', 'do', 'yield', 'lambda', 'proc', 'require', 'include', 'extend', 'attr_reader', 'attr_writer', 'self', 'super', 'nil', 'true', 'false', 'and', 'or', 'not', 'begin', 'rescue', 'ensure', 'raise', 'then', 'when', 'case'],
  go: ['func', 'return', 'if', 'else', 'for', 'range', 'switch', 'case', 'default', 'break', 'continue', 'go', 'chan', 'select', 'defer', 'map', 'struct', 'interface', 'type', 'var', 'const', 'package', 'import', 'true', 'false', 'nil', 'make', 'new', 'len', 'cap', 'append', 'copy', 'delete', 'close', 'panic', 'recover', 'error'],
  rust: ['fn', 'let', 'mut', 'return', 'if', 'else', 'for', 'while', 'loop', 'break', 'continue', 'match', 'struct', 'enum', 'impl', 'trait', 'pub', 'use', 'mod', 'crate', 'self', 'super', 'as', 'in', 'ref', 'move', 'async', 'await', 'where', 'type', 'const', 'static', 'true', 'false', 'Some', 'None', 'Ok', 'Err', 'Self'],
  java: ['public', 'private', 'protected', 'class', 'interface', 'extends', 'implements', 'new', 'this', 'super', 'return', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'throws', 'void', 'int', 'long', 'double', 'float', 'boolean', 'char', 'byte', 'short', 'String', 'true', 'false', 'null', 'static', 'final', 'abstract', 'synchronized', 'volatile', 'transient', 'native', 'import', 'package'],
  csharp: ['public', 'private', 'protected', 'internal', 'class', 'interface', 'struct', 'enum', 'namespace', 'using', 'new', 'this', 'base', 'return', 'if', 'else', 'for', 'foreach', 'while', 'do', 'switch', 'case', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'void', 'int', 'long', 'double', 'float', 'bool', 'char', 'byte', 'short', 'string', 'object', 'var', 'true', 'false', 'null', 'static', 'readonly', 'sealed', 'abstract', 'virtual', 'override', 'async', 'await'],
  c: ['int', 'long', 'double', 'float', 'char', 'void', 'short', 'unsigned', 'signed', 'const', 'static', 'extern', 'register', 'volatile', 'struct', 'union', 'enum', 'typedef', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'sizeof', 'NULL', 'true', 'false', 'include', 'define', 'ifdef', 'ifndef', 'endif', 'pragma'],
  cpp: ['int', 'long', 'double', 'float', 'char', 'void', 'short', 'unsigned', 'signed', 'const', 'static', 'extern', 'register', 'volatile', 'struct', 'class', 'enum', 'typedef', 'if', 'else', 'for', 'while', 'do', 'switch', 'case', 'break', 'continue', 'return', 'sizeof', 'NULL', 'true', 'false', 'new', 'delete', 'this', 'public', 'private', 'protected', 'virtual', 'override', 'final', 'namespace', 'using', 'template', 'typename', 'auto', 'nullptr', 'constexpr', 'noexcept', 'include', 'define'],
  html: ['html', 'head', 'body', 'div', 'span', 'p', 'a', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'table', 'tr', 'td', 'th', 'form', 'input', 'button', 'select', 'option', 'textarea', 'img', 'script', 'style', 'link', 'meta', 'title', 'header', 'footer', 'nav', 'main', 'section', 'article', 'aside'],
  css: ['color', 'background', 'margin', 'padding', 'border', 'display', 'position', 'width', 'height', 'font', 'text', 'align', 'flex', 'grid', 'animation', 'transition', 'transform', 'box', 'shadow', 'opacity', 'overflow', 'z', 'index', 'top', 'left', 'right', 'bottom', 'float', 'clear', 'cursor', 'content'],
  bash: ['if', 'then', 'else', 'elif', 'fi', 'for', 'while', 'do', 'done', 'case', 'esac', 'function', 'return', 'exit', 'echo', 'read', 'export', 'source', 'alias', 'unalias', 'cd', 'ls', 'pwd', 'mkdir', 'rmdir', 'rm', 'cp', 'mv', 'chmod', 'chown', 'grep', 'sed', 'awk', 'find', 'sort', 'uniq', 'wc', 'cat', 'head', 'tail', 'touch', 'true', 'false', 'in'],
  /* PowerShell is case-insensitive — all entries lowercase, matched via lowercased word.
   * (Dashed cmdlet names can never match a whole word: the tokenizer splits on '-',
   * so only the base verbs/nouns are listed here.) */
  powershell: ['function', 'filter', 'param', 'begin', 'process', 'end', 'return', 'if', 'else', 'elseif', 'switch', 'default', 'for', 'foreach', 'while', 'do', 'until', 'break', 'continue', 'try', 'catch', 'finally', 'throw', 'trap', 'in', 'hidden', 'static', 'write', 'host', 'output', 'get', 'set', 'new', 'remove', 'import', 'export', 'select', 'where', 'sort', 'group', 'measure', 'read', 'out', 'invoke', 'start', 'stop', 'test', 'open', 'close', 'add', 'clear', 'copy', 'move', 'rename', 'join', 'split', 'compare', 'convert', 'format', 'object', 'true', 'false', 'null', 'args', 'input', 'error'],
  dockerfile: ['FROM', 'RUN', 'COPY', 'ADD', 'WORKDIR', 'EXPOSE', 'ENV', 'ARG', 'CMD', 'ENTRYPOINT', 'LABEL', 'MAINTAINER', 'VOLUME', 'USER', 'ONBUILD', 'STOPSIGNAL', 'HEALTHCHECK', 'SHELL'],
  /* SQL is case-insensitive — uppercase entries, matched via uppercased word. */
  sql: ['SELECT', 'FROM', 'WHERE', 'INSERT', 'INTO', 'VALUES', 'UPDATE', 'SET', 'DELETE', 'CREATE', 'TABLE', 'ALTER', 'DROP', 'JOIN', 'LEFT', 'RIGHT', 'INNER', 'OUTER', 'FULL', 'ON', 'GROUP', 'BY', 'ORDER', 'HAVING', 'LIMIT', 'OFFSET', 'UNION', 'ALL', 'DISTINCT', 'AS', 'AND', 'OR', 'NOT', 'NULL', 'LIKE', 'IN', 'IS', 'BETWEEN', 'EXISTS', 'CASE', 'WHEN', 'THEN', 'ELSE', 'END', 'PRIMARY', 'KEY', 'FOREIGN', 'REFERENCES', 'INDEX', 'VIEW', 'TRIGGER', 'PROCEDURE', 'FUNCTION', 'RETURN', 'BEGIN', 'COMMIT', 'ROLLBACK', 'TRANSACTION', 'TRUE', 'FALSE'],
  graphql: ['query', 'mutation', 'subscription', 'fragment', 'type', 'interface', 'union', 'enum', 'input', 'scalar', 'directive', 'extend', 'schema', 'on', 'true', 'false', 'null'],
};

const LANG_KEYWORDS: Record<string, string[]> = {
  javascript: KEYWORDS.javascript,
  typescript: KEYWORDS.typescript,
  jsx: KEYWORDS.javascript,
  tsx: KEYWORDS.typescript,
  python: KEYWORDS.python,
  ruby: KEYWORDS.ruby,
  go: KEYWORDS.go,
  rust: KEYWORDS.rust,
  java: KEYWORDS.java,
  c: KEYWORDS.c,
  cpp: KEYWORDS.cpp,
  csharp: KEYWORDS.csharp,
  html: KEYWORDS.html,
  css: KEYWORDS.css,
  scss: KEYWORDS.css,
  less: KEYWORDS.css,
  bash: KEYWORDS.bash,
  powershell: KEYWORDS.powershell,
  dockerfile: KEYWORDS.dockerfile,
  sql: KEYWORDS.sql,
  graphql: KEYWORDS.graphql,
  json: [],
  yaml: [],
  markdown: [],
};

// Pre-built keyword Sets per language for O(1) lookup.
// Null prototype: a plain `{}` would leak Object.prototype members, so an
// unknown language like 'constructor'/'toString' resolved to a truthy
// function and crashed the `.has` lookup below.
const LANG_KW_SETS = Object.create(null) as Record<string, Set<string>>;
for (const lang of Object.keys(LANG_KEYWORDS)) {
  LANG_KW_SETS[lang] = new Set(LANG_KEYWORDS[lang]);
}
const EMPTY_SET: Set<string> = new Set();

// Languages where // starts a comment (C-like + JS/TS family, incl. JSX/TSX)
const SLASH_COMMENT = new Set([
  'javascript', 'typescript', 'jsx', 'tsx', 'go', 'rust', 'java', 'c', 'cpp', 'csharp',
]);
const HASH_COMMENT = new Set(['python', 'bash', 'ruby', 'powershell', 'yaml']);
// Case-insensitive keyword matching (SQL and PowerShell ignore case)
const CI_KEYWORDS = new Set(['powershell', 'sql']);

function isDigitCode(c: number): boolean { return c >= 48 && c <= 57; }
function isWordStartCode(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95 || c === 36 || c === 64;
}
function isWordMidCode(c: number): boolean {
  return isWordStartCode(c) || isDigitCode(c);
}
function isOperatorCode(c: number): boolean {
  return c === 43 || c === 45 || c === 42 || c === 47 || c === 37 || c === 61 ||
    c === 60 || c === 62 || c === 33 || c === 38 || c === 124 || c === 94 ||
    c === 126 || c === 63 || c === 58;
}
function isHexCode(c: number): boolean {
  return isDigitCode(c) || (c >= 97 && c <= 102) || (c >= 65 && c <= 70);
}
function isWordCharCode(c: number): boolean {
  return (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 45;
}

// Sticky CSS property regex — no per-char slice. `y` already anchors the match
// at lastIndex; a leading `^` would additionally require index 0, so property
// detection only ever worked in column 0.
const RE_CSS_PROP_Y = /([a-z-]+)(?=\s*:)/y;

function scanNumber(line: string, i: number): number {
  const n = line.length;
  // 0x / 0b / 0o prefixes
  if (line[i] === '0' && i + 1 < n) {
    const p = line[i + 1];
    if (p === 'x' || p === 'X') {
      let j = i + 2;
      while (j < n && isHexCode(line.charCodeAt(j))) j++;
      return j > i + 2 ? j : i + 1;
    }
    if (p === 'b' || p === 'B') {
      let j = i + 2;
      while (j < n && (line[j] === '0' || line[j] === '1')) j++;
      return j > i + 2 ? j : i + 1;
    }
    if (p === 'o' || p === 'O') {
      let j = i + 2;
      while (j < n && line.charCodeAt(j) >= 48 && line.charCodeAt(j) <= 55) j++;
      return j > i + 2 ? j : i + 1;
    }
  }
  let j = i;
  while (j < n && isDigitCode(line.charCodeAt(j))) j++;
  if (j < n && line[j] === '.' && j + 1 < n && isDigitCode(line.charCodeAt(j + 1))) {
    j += 2;
    while (j < n && isDigitCode(line.charCodeAt(j))) j++;
  }
  if (j < n && (line[j] === 'e' || line[j] === 'E')) {
    let k = j + 1;
    if (k < n && (line[k] === '+' || line[k] === '-')) k++;
    if (k < n && isDigitCode(line.charCodeAt(k))) {
      k++;
      while (k < n && isDigitCode(line.charCodeAt(k))) k++;
      j = k;
    }
  }
  return j;
}

function tokenizeLine(line: string, language: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const n = line.length;
  const kwSet = LANG_KW_SETS[language] || EMPTY_SET;
  const useSlash = SLASH_COMMENT.has(language);
  const useHash = HASH_COMMENT.has(language);
  const ciKw = CI_KEYWORDS.has(language);
  const isHtml = language === 'html';
  const isPs = language === 'powershell';
  const isCss = language === 'css' || language === 'scss' || language === 'less';

  while (i < n) {
    const c = line.charCodeAt(i);
    // HTML comments <!-- ... --> (to --> or end of line)
    if (isHtml && line[i] === '<' && line[i + 1] === '!' && line[i + 2] === '-' && line[i + 3] === '-') {
      const end = line.indexOf('-->', i + 4);
      const stop = end === -1 ? n : end + 3;
      tokens.push({ type: 'comment', value: line.slice(i, stop) });
      i = stop;
      continue;
    }
    // PowerShell block comments <# ... #> (to #> or end of line)
    if (isPs && line[i] === '<' && line[i + 1] === '#') {
      const end = line.indexOf('#>', i + 2);
      const stop = end === -1 ? n : end + 2;
      tokens.push({ type: 'comment', value: line.slice(i, stop) });
      i = stop;
      continue;
    }
    // Comments (gated per language)
    if (useSlash && line[i] === '/' && line[i + 1] === '/') {
      tokens.push({ type: 'comment', value: line.slice(i) });
      break;
    }
    if (useHash && line[i] === '#') {
      tokens.push({ type: 'comment', value: line.slice(i) });
      break;
    }
    if (language === 'sql' && line[i] === '-' && line[i + 1] === '-') {
      tokens.push({ type: 'comment', value: line.slice(i) });
      break;
    }

    // Strings
    if (c === 34 || c === 39 || c === 96) {
      const quote = line[i];
      let j = i + 1;
      while (j < n && line[j] !== quote) {
        if (line[j] === '\\') j++;
        j++;
      }
      tokens.push({ type: 'string', value: line.slice(i, j + 1) });
      i = j + 1;
      continue;
    }

    // HTML tags
    if (isHtml && line[i] === '<') {
      let j = i + 1;
      if (line[j] === '/') j++;
      while (j < n && line[j] !== '>' && line[j] !== ' ') j++;
      tokens.push({ type: 'keyword', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // CSS property: only attempt on word-start, sticky, no slice
    if (isCss && isWordCharCode(c)) {
      RE_CSS_PROP_Y.lastIndex = i;
      const m = RE_CSS_PROP_Y.exec(line);
      if (m) {
        tokens.push({ type: 'keyword', value: m[1] });
        i += m[1].length;
        continue;
      }
    }

    // Numbers
    if (isDigitCode(c)) {
      const j = scanNumber(line, i);
      tokens.push({ type: 'number', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Words (keywords, functions, variables)
    if (isWordStartCode(c)) {
      let j = i + 1;
      while (j < n && isWordMidCode(line.charCodeAt(j))) j++;
      const word = line.slice(i, j);
      const key = ciKw ? (language === 'sql' ? word.toUpperCase() : word.toLowerCase()) : word;
      if (kwSet.has(key)) {
        tokens.push({ type: 'keyword', value: word });
      } else if (j < n && line[j] === '(') {
        tokens.push({ type: 'function', value: word });
      } else if (word.charCodeAt(0) === 36 || word.charCodeAt(0) === 64) {
        tokens.push({ type: 'variable', value: word });
      } else {
        tokens.push({ type: 'text', value: word });
      }
      i = j;
      continue;
    }

    // Operators
    if (isOperatorCode(c)) {
      let j = i + 1;
      while (j < n && isOperatorCode(line.charCodeAt(j))) j++;
      tokens.push({ type: 'operator', value: line.slice(i, j) });
      i = j;
      continue;
    }

    // Brackets and other characters
    tokens.push({ type: 'text', value: line[i] });
    i++;
  }

  return tokens;
}

export interface HighlightPalette {
  keyword?: string; string?: string; number?: string; comment?: string;
  function?: string; variable?: string; operator?: string; type?: string;
  punctuation?: string;
}

const _trueFgCache = new Map<string, string>();
function trueFg(hexColor: string): string {
  const hit = _trueFgCache.get(hexColor);
  if (hit !== undefined) return hit;
  const h = hexColor.replace('#', '');
  let out = '';
  if (h.length === 6) {
    const r = parseInt(h.slice(0, 2), 16);
    const g = parseInt(h.slice(2, 4), 16);
    const b = parseInt(h.slice(4, 6), 16);
    if (!Number.isNaN(r) && !Number.isNaN(g) && !Number.isNaN(b)) {
      out = `\x1b[38;2;${r};${g};${b}m`;
    }
  }
  if (_trueFgCache.size > 64) _trueFgCache.clear();
  _trueFgCache.set(hexColor, out);
  return out;
}

function colorizeToken(token: Token, palette?: HighlightPalette): string {
  if (palette) {
    const hex =
      token.type === 'keyword' ? palette.keyword :
      token.type === 'string' ? palette.string :
      token.type === 'number' ? palette.number :
      token.type === 'comment' ? palette.comment :
      token.type === 'function' ? palette.function :
      token.type === 'variable' ? palette.variable :
      token.type === 'type' ? palette.type :
      token.type === 'punctuation' ? palette.punctuation :
      token.type === 'operator' ? palette.operator : undefined;
    if (hex) {
      const seq = trueFg(hex);
      if (seq) return `${seq}${token.value}${ANSI.reset}`;
    }
    if (token.type === 'text') return token.value;
  }
  switch (token.type) {
    case 'keyword':
      return `${ANSI.magenta}${token.value}${ANSI.reset}`;
    case 'string':
      return `${ANSI.green}${token.value}${ANSI.reset}`;
    case 'number':
      return `${ANSI.cyan}${token.value}${ANSI.reset}`;
    case 'comment':
      return `${ANSI.brightBlack}${token.value}${ANSI.reset}`;
    case 'function':
      return `${ANSI.yellow}${token.value}${ANSI.reset}`;
    case 'variable':
      return `${ANSI.brightRed}${token.value}${ANSI.reset}`;
    case 'type':
      return `${ANSI.yellow}${token.value}${ANSI.reset}`;
    case 'operator':
      return `${ANSI.brightCyan}${token.value}${ANSI.reset}`;
    default:
      return token.value;
  }
}

const ANSI_REGEX = /\x1b\[[0-9;?]*[A-Za-z]/g;
const OSC_REGEX = /\x1b\][^\x07]*(?:\x07|\x1b\\)/g;
export function stripAnsi(s: string): string {
  return s.replace(OSC_REGEX, '').replace(ANSI_REGEX, '');
}

export function highlightLine(line: string, language: string, palette?: HighlightPalette): string {
  if (!line || language === 'text') return line;
  const tokens = tokenizeLine(line, language);
  let out = '';
  for (const t of tokens) out += colorizeToken(t, palette);
  return out;
}

export function highlightCode(code: string, language: string, palette?: HighlightPalette): string {
  return code.split('\n').map(line => highlightLine(line, language, palette)).join('\n');
}

export { ANSI };
