#!/usr/bin/env node
/**
 * Benchmark: startup, syntax highlighting, completion, capped structures.
 * Run: npm run bench   (builds first)
 * Output is plain text, one metric per line, for pasting into docs/issues.
 * No dependencies beyond the built dist/ — must never fail the build.
 */
'use strict';

const { spawnSync } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '..');
let failures = 0;

function safe(label, fn) {
  try {
    const v = fn();
    console.log(`${label} ${typeof v === 'number' ? v.toFixed(2) : v}`);
    return v;
  } catch (e) {
    failures++;
    console.log(`${label} ERROR ${e && e.message}`);
    return null;
  }
}

function median(xs) {
  const s = xs.slice().sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
}

// --- 1. CLI startup (spawn node dist/index.js --version) ---
function benchStartup() {
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const t0 = process.hrtime.bigint();
    const r = spawnSync(process.execPath, [path.join(ROOT, 'dist', 'index.js'), '--version'], {
      encoding: 'utf8',
      timeout: 10000,
    });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    if (r.status !== 0) throw new Error(`--version exit ${r.status}: ${r.stderr}`);
    runs.push(ms);
  }
  return median(runs);
}

// --- 2. Highlighting throughput ---
function benchHighlight() {
  const { highlightCode } = require(path.join(ROOT, 'dist', 'highlight.js'));
  // ~200 lines of representative mixed code (keywords, strings, numbers, comments)
  const unit = [
    '// sample line with 123 numbers and "double" plus \'single\' strings',
    'function computeValue(input, fallback) {',
    '  if (input == null) return fallback; // guard',
    '  const total = input * 42 + 7;',
    '  return total > 100 ? "big" : `small:${total}`;',
    '}',
    'class Runner extends Base { async run(items) { for (const it of items) await it(); } }',
    'const msg = `template ${expr} end`; /* block comment */ let x = 0xff;',
  ].join('\n');
  const code = Array(25).fill(unit).join('\n'); // ~200 lines
  const bytes = Buffer.byteLength(code);

  // warmup
  highlightCode(code, 'javascript');
  const N = 20;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) highlightCode(code, 'javascript');
  const secs = Number(process.hrtime.bigint() - t0) / 1e9;
  const kbPerSec = (bytes / 1024) * (N / secs);
  console.log(`highlight.mediantime_ms ${(secs * 1000 / N).toFixed(2)}`);
  return kbPerSec;
}

// --- 3. Completion suggestion latency ---
function benchComplete() {
  const { suggestCompletion } = require(path.join(ROOT, 'dist', 'complete.js'));
  const lines = [];
  for (let i = 0; i < 500; i++) lines.push(`const value${i} = compute(value${i - 1 || 0});`);
  const input = { prefix: 'const value4', after: '', lines, lang: 'javascript' };
  suggestCompletion(input); // warmup
  const N = 1000;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) suggestCompletion(input);
  const us = Number(process.hrtime.bigint() - t0) / 1000 / N;
  console.log(`complete.avg_us ${us.toFixed(1)}`);
  return us;
}

// --- 4. Ring buffer push throughput (memory-safe structure) ---
function benchRing() {
  const { RingBuffer } = require(path.join(ROOT, 'dist', 'structures.js'));
  const rb = new RingBuffer(1000);
  const N = 1e6;
  const t0 = process.hrtime.bigint();
  for (let i = 0; i < N; i++) rb.push(i);
  const ops = N / (Number(process.hrtime.bigint() - t0) / 1e9);
  console.log(`ring.ops_per_sec ${Math.round(ops).toLocaleString('en-US')}`);
  return ops;
}

console.log(`node ${process.version} · ${process.platform}/${process.arch}`);
safe('startup.median_ms', benchStartup);
safe('highlight.kb_per_sec', benchHighlight);
safe('complete.avg_us', benchComplete);
safe('ring.ops_per_sec', benchRing);

process.exit(failures ? 1 : 0);
