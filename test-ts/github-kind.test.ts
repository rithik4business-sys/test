import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  classifyTokenKind,
  createRepoBlockedError,
  friendlyActionError,
  hasRepoScope,
  parseOAuthScopes,
} from '../src/github';

test('classifyTokenKind: full / limited / fine-grained', () => {
  assert.equal(classifyTokenKind(['repo', 'workflow']), 'full');
  assert.equal(classifyTokenKind(['public_repo']), 'limited');
  assert.equal(classifyTokenKind([]), 'limited');
  assert.equal(classifyTokenKind(null), 'fine-grained');
});

test('hasRepoScope: classic repo scope gates push', () => {
  assert.equal(hasRepoScope(['repo', 'workflow']), true);
  assert.equal(hasRepoScope('repo, workflow'), true);
  assert.equal(hasRepoScope(['public_repo']), false);
  assert.equal(hasRepoScope([]), false);
  assert.equal(hasRepoScope(null), false);
});

test('parseOAuthScopes: splits and lowercases header', () => {
  assert.deepEqual(parseOAuthScopes('repo, workflow'), ['repo', 'workflow']);
  assert.deepEqual(parseOAuthScopes('Repo,  User'), ['repo', 'user']);
  assert.deepEqual(parseOAuthScopes(null), []);
});

test('createRepoBlockedError: fail-fast pre-check for repo creation', () => {
  const msg = createRepoBlockedError('fine-grained');
  assert.ok(msg && msg.includes('create repositories'), 'got: ' + msg);
  assert.equal(createRepoBlockedError('full'), null);
  assert.equal(createRepoBlockedError('limited'), null);
});

test('friendlyActionError: maps GitHub 403 integration errors', () => {
  const mk = (code: number, message: string): Error => {
    const e = new Error(message) as Error & { statusCode: number };
    e.statusCode = code;
    return e;
  };
  const m1 = friendlyActionError(mk(403, 'Resource not accessible by integration'), 'create repositories');
  assert.ok(m1 && m1.includes('create repositories') && m1.includes('Login with GitHub'), 'create: ' + m1);
  const m2 = friendlyActionError(mk(403, 'RESOURCE NOT ACCESSIBLE BY INTEGRATION'), 'push to this repository');
  assert.ok(m2 && m2.includes('push to this repository'), 'push: ' + m2);
  assert.equal(friendlyActionError(mk(403, 'rate limited'), 'create repositories'), null);
  assert.equal(friendlyActionError(mk(404, 'Resource not accessible by integration'), 'create repositories'), null);
  assert.equal(friendlyActionError(new Error('boom'), 'create repositories'), null);
});
