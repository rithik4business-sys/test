const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { getFileExtension, getLanguageFromExt, fileExists, dirExists } = require('../dist/utils.js');

test('getFileExtension handles common names', () => {
  assert.equal(getFileExtension('app.ts'), 'ts');
  assert.equal(getFileExtension('ARCHIVE.TAR.GZ'), 'gz');
  assert.equal(getFileExtension('Dockerfile'), 'dockerfile');
  assert.equal(getFileExtension('Makefile'), '');
  assert.equal(getFileExtension('.gitignore'), '');
});

test('getLanguageFromExt maps known extensions', () => {
  assert.equal(getLanguageFromExt('ts'), 'typescript');
  assert.equal(getLanguageFromExt('tsx'), 'typescript');
  assert.equal(getLanguageFromExt('py'), 'python');
  assert.equal(getLanguageFromExt('ps1'), 'powershell');
  assert.equal(getLanguageFromExt('sh'), 'bash');
  assert.equal(getLanguageFromExt('md'), 'markdown');
  assert.equal(getLanguageFromExt('xyz'), 'text');
  assert.equal(getLanguageFromExt(''), 'text');
});

test('fileExists / dirExists against tmp fixture', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tw-'));
  const f = path.join(dir, 'a.txt');
  fs.writeFileSync(f, 'x');
  try {
    assert.equal(fileExists(f), true);
    assert.equal(fileExists(path.join(dir, 'nope.txt')), false);
    assert.equal(fileExists(dir), false);
    assert.equal(dirExists(dir), true);
    assert.equal(dirExists(f), false);
    assert.equal(dirExists(path.join(dir, 'nope')), false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
