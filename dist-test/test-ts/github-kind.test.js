"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = require("node:test");
const strict_1 = __importDefault(require("node:assert/strict"));
const github_1 = require("../src/github");
(0, node_test_1.test)('classifyTokenKind: full / limited / fine-grained', () => {
    strict_1.default.equal((0, github_1.classifyTokenKind)(['repo', 'workflow']), 'full');
    strict_1.default.equal((0, github_1.classifyTokenKind)(['public_repo']), 'limited');
    strict_1.default.equal((0, github_1.classifyTokenKind)([]), 'limited');
    strict_1.default.equal((0, github_1.classifyTokenKind)(null), 'fine-grained');
});
(0, node_test_1.test)('hasRepoScope: classic repo scope gates push', () => {
    strict_1.default.equal((0, github_1.hasRepoScope)(['repo', 'workflow']), true);
    strict_1.default.equal((0, github_1.hasRepoScope)('repo, workflow'), true);
    strict_1.default.equal((0, github_1.hasRepoScope)(['public_repo']), false);
    strict_1.default.equal((0, github_1.hasRepoScope)([]), false);
    strict_1.default.equal((0, github_1.hasRepoScope)(null), false);
});
(0, node_test_1.test)('parseOAuthScopes: splits and lowercases header', () => {
    strict_1.default.deepEqual((0, github_1.parseOAuthScopes)('repo, workflow'), ['repo', 'workflow']);
    strict_1.default.deepEqual((0, github_1.parseOAuthScopes)('Repo,  User'), ['repo', 'user']);
    strict_1.default.deepEqual((0, github_1.parseOAuthScopes)(null), []);
});
(0, node_test_1.test)('createRepoBlockedError: fail-fast pre-check for repo creation', () => {
    const msg = (0, github_1.createRepoBlockedError)('fine-grained');
    strict_1.default.ok(msg && msg.includes('create repositories'), 'got: ' + msg);
    strict_1.default.equal((0, github_1.createRepoBlockedError)('full'), null);
    strict_1.default.equal((0, github_1.createRepoBlockedError)('limited'), null);
});
(0, node_test_1.test)('friendlyActionError: maps GitHub 403 integration errors', () => {
    const mk = (code, message) => {
        const e = new Error(message);
        e.statusCode = code;
        return e;
    };
    const m1 = (0, github_1.friendlyActionError)(mk(403, 'Resource not accessible by integration'), 'create repositories');
    strict_1.default.ok(m1 && m1.includes('create repositories') && m1.includes('Login with GitHub'), 'create: ' + m1);
    const m2 = (0, github_1.friendlyActionError)(mk(403, 'RESOURCE NOT ACCESSIBLE BY INTEGRATION'), 'push to this repository');
    strict_1.default.ok(m2 && m2.includes('push to this repository'), 'push: ' + m2);
    strict_1.default.equal((0, github_1.friendlyActionError)(mk(403, 'rate limited'), 'create repositories'), null);
    strict_1.default.equal((0, github_1.friendlyActionError)(mk(404, 'Resource not accessible by integration'), 'create repositories'), null);
    strict_1.default.equal((0, github_1.friendlyActionError)(new Error('boom'), 'create repositories'), null);
});
