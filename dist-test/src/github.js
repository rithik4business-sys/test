"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.ALLOWED_REPO_PATCH = exports.REPO_NAME_RE = exports.loadToken = void 0;
exports.isValidRepoName = isValidRepoName;
exports.parseRepoFull = parseRepoFull;
exports.sanitizeRepoPatch = sanitizeRepoPatch;
exports.sanitizeTopics = sanitizeTopics;
exports.authenticate = authenticate;
exports.getUser = getUser;
exports.getAuthenticatedUser = getAuthenticatedUser;
exports.parseOAuthScopes = parseOAuthScopes;
exports.hasRepoScope = hasRepoScope;
exports.classifyTokenKind = classifyTokenKind;
exports.isGitHubAppToken = isGitHubAppToken;
exports.parseGitCredentialOutput = parseGitCredentialOutput;
exports.saveGuard = saveGuard;
exports.createBlockedMessage = createBlockedMessage;
exports.createRepoBlockedError = createRepoBlockedError;
exports.getTokenScopes = getTokenScopes;
exports.startDeviceFlow = startDeviceFlow;
exports.pollDeviceOnce = pollDeviceOnce;
exports.createRepo = createRepo;
exports.getRepo = getRepo;
exports.pushFiles = pushFiles;
exports.getRepos = getRepos;
exports.getRepoFull = getRepoFull;
exports.updateRepo = updateRepo;
exports.listBranches = listBranches;
exports.getTopics = getTopics;
exports.setTopics = setTopics;
exports.friendlyActionError = friendlyActionError;
exports.logout = logout;
exports.isLoggedIn = isLoggedIn;
exports.getUsername = getUsername;
const https = __importStar(require("https"));
const utils_1 = require("./utils");
Object.defineProperty(exports, "loadToken", { enumerable: true, get: function () { return utils_1.loadToken; } });
exports.REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;
function isValidRepoName(name) {
    return exports.REPO_NAME_RE.test(name || '');
}
/** owner/repo parser — returns null on bad shape. */
function parseRepoFull(full) {
    if (typeof full !== 'string')
        return null;
    const parts = full.split('/');
    if (parts.length !== 2)
        return null;
    const [owner, repo] = parts.map((s) => s.trim());
    if (!owner || !repo)
        return null;
    if (owner.length > 39 || repo.length > 100)
        return null;
    if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner))
        return null;
    if (!isValidRepoName(repo))
        return null;
    return { owner, repo };
}
exports.ALLOWED_REPO_PATCH = new Set([
    'name', 'description', 'homepage', 'private',
    'has_issues', 'has_projects', 'has_wiki',
    'default_branch', 'allow_squash_merge', 'allow_merge_commit',
    'allow_rebase_merge', 'delete_branch_on_merge', 'archived',
]);
/** Strip unknown keys + coerce types for PATCH /repos/{owner}/{repo}. */
function sanitizeRepoPatch(input) {
    const out = {};
    if (!input || typeof input !== 'object')
        return out;
    for (const k of exports.ALLOWED_REPO_PATCH) {
        if (!(k in input))
            continue;
        const v = input[k];
        if (k === 'name') {
            if (typeof v === 'string' && isValidRepoName(v))
                out[k] = v;
        }
        else if (k === 'description' || k === 'homepage' || k === 'default_branch') {
            if (v === null)
                out[k] = null;
            else if (typeof v === 'string' && v.length <= 350)
                out[k] = v;
        }
        else if (typeof v === 'boolean') {
            out[k] = v;
        }
    }
    return out;
}
function sanitizeTopics(input) {
    if (!Array.isArray(input))
        return null;
    const out = [];
    for (const t of input) {
        if (typeof t !== 'string')
            return null;
        const s = t.trim().toLowerCase();
        if (!/^[a-z0-9-]{1,50}$/.test(s))
            return null;
        if (!out.includes(s))
            out.push(s);
        if (out.length > 20)
            return null;
    }
    return out;
}
class GitHubError extends Error {
    constructor(message, statusCode) {
        super(message);
        this.statusCode = statusCode;
    }
}
const CLIENT_ID = process.env.TYPEWRITER_CLIENT_ID || 'Iv1.b507a08c87ecfe98';
function requestOnce(options, body) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (e) => { if (!settled) {
            settled = true;
            reject(e);
        } };
        const ok = (v) => { if (!settled) {
            settled = true;
            resolve(v);
        } };
        if (body && !options.headers)
            options.headers = {};
        const headers = (options.headers || {});
        options.headers = headers;
        if (body) {
            headers['Content-Length'] = String(Buffer.byteLength(body));
        }
        if (!headers['User-Agent'])
            headers['User-Agent'] = 'TypeWriter-Editor';
        const req = https.request(options, (res) => {
            let data = '';
            res.on('data', (chunk) => data += chunk);
            res.on('end', () => {
                const code = res.statusCode || 0;
                let json = {};
                if (data) {
                    try {
                        json = JSON.parse(data);
                    }
                    catch {
                        if (code >= 200 && code < 300)
                            return ok({ json: {}, retryAfter: 0 });
                        return fail(new GitHubError(`GitHub API error: ${code} - ${data.slice(0, 200)}`, code));
                    }
                }
                if (code >= 200 && code < 300) {
                    // Device-flow polls return 200 with { error } — let caller decide
                    ok({ json, retryAfter: 0 });
                }
                else if (code === 429 || code >= 500) {
                    const ra = parseInt(String(res.headers['retry-after'] || '0'), 10);
                    fail(Object.assign(new GitHubError(`GitHub API error: ${code} - ${(json && json.message) || data.slice(0, 200)}`, code), { retryable: true, retryAfter: Number.isFinite(ra) ? ra : 0 }));
                }
                else {
                    fail(new GitHubError(`GitHub API error: ${code} - ${(json && json.message) || data.slice(0, 200)}`, code));
                }
            });
        });
        req.on('error', (e) => fail(e));
        req.setTimeout(15000, () => {
            fail(Object.assign(new GitHubError('Request timed out', 0), { retryable: true, retryAfter: 0 }));
            try {
                req.destroy();
            }
            catch { /* noop */ }
        });
        if (body)
            req.write(body);
        req.end();
    });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function request(options, body) {
    let lastErr = null;
    for (let attempt = 0; attempt < 3; attempt++) {
        try {
            const { json } = await requestOnce(options, body);
            return json;
        }
        catch (e) {
            lastErr = e;
            const retryable = e?.retryable === true;
            if (!retryable || attempt === 2)
                throw e;
            const hinted = e?.retryAfter || 0;
            const waitMs = hinted > 0 && hinted <= 60 ? hinted * 1000 : (attempt + 1) * 1000;
            await sleep(waitMs);
        }
    }
    throw lastErr;
}
function isNotFound(e) {
    return e instanceof GitHubError && e.statusCode === 404;
}
async function authenticate() {
    const existingToken = (0, utils_1.loadToken)();
    if (existingToken) {
        try {
            const user = await getUser(existingToken);
            (0, utils_1.setGitHubUsername)(user.login);
            return existingToken;
        }
        catch {
            (0, utils_1.clearToken)();
        }
    }
    const deviceResponse = await request({
        hostname: 'github.com',
        path: '/login/device/code',
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'TypeWriter-Editor',
        },
    }, JSON.stringify({
        client_id: CLIENT_ID,
        scope: 'repo',
    }));
    if (!deviceResponse.user_code || !deviceResponse.device_code) {
        throw new Error('GitHub device flow failed. Check network / client_id.');
    }
    console.log(`\n🔐 GitHub Login Required`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`1. Go to: ${deviceResponse.verification_uri}`);
    console.log(`2. Enter code: ${deviceResponse.user_code}`);
    console.log(`3. Authorize TypeWriter`);
    console.log(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n`);
    console.log(`Waiting for authorization...`);
    const token = await pollForToken(deviceResponse.device_code, deviceResponse.interval);
    (0, utils_1.saveToken)(token);
    const user = await getUser(token);
    (0, utils_1.setGitHubUsername)(user.login);
    return token;
}
async function pollForToken(deviceCode, interval, expiresIn = 900) {
    const delay = (ms) => new Promise(r => setTimeout(r, ms));
    const deadline = Date.now() + expiresIn * 1000;
    let wait = Math.max(5, interval || 5);
    while (Date.now() < deadline) {
        await delay(wait * 1000);
        const response = await request({
            hostname: 'github.com',
            path: '/login/oauth/access_token',
            method: 'POST',
            headers: {
                'Accept': 'application/json',
                'Content-Type': 'application/json',
                'User-Agent': 'TypeWriter-Editor',
            },
        }, JSON.stringify({
            client_id: CLIENT_ID,
            device_code: deviceCode,
            grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        }));
        if (response.access_token)
            return response.access_token;
        if (response.error === 'authorization_pending')
            continue;
        if (response.error === 'slow_down') {
            wait = response.interval || wait + 5;
            continue;
        }
        if (response.error === 'expired_token')
            throw new Error('Code expired. Run --login again.');
        if (response.error === 'access_denied')
            throw new Error('Authorization denied.');
        throw new Error(response.error_description || response.error || 'Auth failed');
    }
    throw new Error('Timed out waiting for authorization.');
}
async function getUser(token) {
    return request({
        hostname: 'api.github.com',
        path: '/user',
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'TypeWriter-Editor',
        },
    });
}
/** Validate a token for the web UI: returns { login, avatar_url }. Throws on invalid. */
async function getAuthenticatedUser(token) {
    const user = await getUser(token);
    if (!user || !user.login)
        throw new Error('Invalid GitHub token');
    return user;
}
/** Split an X-OAuth-Scopes header value into lowercase scope names. */
function parseOAuthScopes(header) {
    const raw = Array.isArray(header) ? header.join(',') : (header || '');
    return String(raw).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}
/** True when the scope list grants push access (classic `repo` scope). */
function hasRepoScope(scopes) {
    const list = typeof scopes === 'string' ? parseOAuthScopes(scopes) : (scopes || []).map((x) => String(x).trim().toLowerCase());
    return list.includes('repo');
}
function classifyTokenKind(scopes) {
    if (scopes === null)
        return 'fine-grained';
    return hasRepoScope(scopes) ? 'full' : 'limited';
}
/** True for GitHub App user/server tokens (ghu_/ghs_). These carry the app's
 * permissions instead of OAuth scopes (hence the empty scope header) and —
 * critically — GitHub blocks them from POST /user/repos no matter what.
 * Detecting the prefix lets the UI say so instead of blaming scopes. */
function isGitHubAppToken(token) {
    return typeof token === 'string' && /^(ghu_|ghs_)/.test(token);
}
/** Parse `git credential fill` stdout into its username/password pair.
 * Pure helper (tested): returns null when no password line is present. */
function parseGitCredentialOutput(text) {
    let username = '';
    let password = '';
    for (const ln of String(text || '').split('\n')) {
        const m = /^([^=\s]+)=(.*)$/.exec(ln.trim());
        if (!m)
            continue;
        if (m[1] === 'username' && !username)
            username = m[2];
        else if (m[1] === 'password' && !password)
            password = m[2];
    }
    if (!password)
        return null;
    return { username, password };
}
/** Save-time gate for pasted tokens: only tokens proven able to create
 * repositories are stored, so a saved login can never hit the create-time
 * 403 ("Resource not accessible by integration"). Fine-grained PATs are
 * rejected outright — GitHub blocks POST /user/repos for them no matter
 * which permissions they carry — as are classic tokens without `repo`.
 * GitHub App user tokens (ghu_) are rejected too: the repo-creation endpoint
 * does not accept them at all, so pasting one for creation is hopeless.
 * Returns the rejection message, or null when the token may be saved. */
function saveGuard(scopes, token) {
    if (isGitHubAppToken(token)) {
        return 'This token cannot create repositories — it belongs to a GitHub App, and GitHub does not allow app tokens to create repositories. Paste a classic token with the `repo` scope instead.';
    }
    if (scopes === null) {
        return 'This token cannot create repositories — it is fine-grained, and GitHub blocks repo creation for fine-grained tokens. Use Login with GitHub, or paste a classic token with the `repo` scope.';
    }
    if (!hasRepoScope(scopes)) {
        return 'This token cannot create repositories or push — grant it the `repo` scope and try again.';
    }
    return null;
}
/** Creation-block message aware of GitHub App tokens: for ghu_/ghs_ the
 * endpoint itself refuses, so the message must not blame scopes. Falls back
 * to the kind-based pre-check for everything else. */
function createBlockedMessage(token, kind) {
    if (isGitHubAppToken(token)) {
        return 'This login uses the TypeWriter GitHub App, which GitHub does not allow to create repositories — list, push and settings all work. To create repos, logout and paste a classic token with the `repo` scope.';
    }
    return createRepoBlockedError(kind);
}
/** Pre-check for POST /user/repos: fine-grained PATs are blocked by GitHub
 *  itself from creating repositories, so the server can fail fast without
 *  spending an API call. Returns the error message, or null when creation
 *  may proceed (the API call still decides `limited` tokens). */
function createRepoBlockedError(kind) {
    if (kind === 'fine-grained') {
        return 'This login cannot create repositories - use Login with GitHub or a classic token with the `repo` scope';
    }
    return null;
}
/**
 * Validate a token like getAuthenticatedUser, but also capture the OAuth scope
 * header. Returns scopes=null when GitHub sends no scope header (fine-grained
 * PATs carry no scopes — those are accepted when GET /user succeeds).
 * Rejects with a 401 GitHubError when the token is expired/revoked.
 */
async function getTokenScopes(token) {
    return new Promise((resolve, reject) => {
        let settled = false;
        const fail = (e) => { if (!settled) {
            settled = true;
            reject(e);
        } };
        const req = https.request({
            hostname: 'api.github.com',
            path: '/user',
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'TypeWriter-Editor',
            },
        }, (res) => {
            let data = '';
            res.on('data', (c) => data += c);
            res.on('end', () => {
                if (settled)
                    return;
                settled = true;
                const code = res.statusCode || 0;
                if (code === 401) {
                    reject(new GitHubError('Session expired — please log in again', 401));
                    return;
                }
                if (code < 200 || code >= 300) {
                    let msg = data.slice(0, 200);
                    try {
                        const j = JSON.parse(data);
                        if (j && j.message)
                            msg = j.message;
                    }
                    catch { /* keep slice */ }
                    reject(new GitHubError(`GitHub API error: ${code} - ${msg}`, code));
                    return;
                }
                let user = {};
                try {
                    user = JSON.parse(data || '{}');
                }
                catch {
                    user = {};
                }
                if (!user || !user.login) {
                    reject(new Error('Invalid GitHub token'));
                    return;
                }
                const h = res.headers['x-oauth-scopes'];
                resolve({
                    login: user.login,
                    name: user.name || null,
                    avatar_url: user.avatar_url || null,
                    scopes: typeof h === 'undefined' ? null : parseOAuthScopes(h),
                });
            });
        });
        req.on('error', (e) => fail(e));
        req.setTimeout(15000, () => {
            fail(new GitHubError('Request timed out', 0));
            try {
                req.destroy();
            }
            catch { /* noop */ }
        });
        req.end();
    });
}
/** Start a device-flow login for the web UI (no console output, no polling). */
async function startDeviceFlow() {
    const r = await request({
        hostname: 'github.com',
        path: '/login/device/code',
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'TypeWriter-Editor',
        },
    }, JSON.stringify({ client_id: CLIENT_ID, scope: 'repo' }));
    if (!r.device_code || !r.user_code) {
        throw new Error('GitHub device flow failed. Check network / client_id.');
    }
    return {
        device_code: r.device_code,
        user_code: r.user_code,
        verification_uri: r.verification_uri || 'https://github.com/login/device',
        expires_in: r.expires_in || 900,
        interval: r.interval || 5,
    };
}
/** Single device-flow poll (web UI calls this on an interval). */
async function pollDeviceOnce(deviceCode) {
    const r = await request({
        hostname: 'github.com',
        path: '/login/oauth/access_token',
        method: 'POST',
        headers: {
            'Accept': 'application/json',
            'Content-Type': 'application/json',
            'User-Agent': 'TypeWriter-Editor',
        },
    }, JSON.stringify({
        client_id: CLIENT_ID,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
    }));
    if (r.access_token)
        return { status: 'authorized', token: r.access_token };
    if (r.error === 'authorization_pending')
        return { status: 'pending' };
    if (r.error === 'slow_down') {
        return { status: 'slow_down', interval: r.interval || 10 };
    }
    if (r.error === 'expired_token')
        return { status: 'error', error: 'Code expired — start over', fatal: true };
    if (r.error === 'access_denied')
        return { status: 'error', error: 'Authorization denied.', fatal: true };
    if (r.error === 'incorrect_device_code' || r.error === 'incorrect_client_credentials') {
        return { status: 'error', error: (r.error_description || r.error), fatal: true };
    }
    return { status: 'error', error: (r.error_description || r.error || 'Auth failed'), fatal: false };
}
async function createRepo(token, name, description, isPrivate = false) {
    return request({
        hostname: 'api.github.com',
        path: '/user/repos',
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'TypeWriter-Editor',
            'Content-Type': 'application/json',
        },
    }, JSON.stringify({
        name,
        description,
        private: isPrivate,
        auto_init: false,
    }));
}
async function getRepo(token, owner, repo) {
    try {
        return await request({
            hostname: 'api.github.com',
            path: `/repos/${owner}/${repo}`,
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'TypeWriter-Editor',
            },
        });
    }
    catch (e) {
        if (isNotFound(e))
            return null;
        throw e;
    }
}
const apiGetHeaders = (token) => ({
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TypeWriter-Editor',
});
const apiHeaders = (token) => ({
    'Authorization': `Bearer ${token}`,
    'Accept': 'application/vnd.github.v3+json',
    'User-Agent': 'TypeWriter-Editor',
    'Content-Type': 'application/json',
});
async function getBranch(token, owner, repo) {
    for (const branch of ['main', 'master']) {
        try {
            const ref = await request({
                hostname: 'api.github.com',
                path: `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
                method: 'GET',
                headers: apiGetHeaders(token),
            });
            if (ref?.object?.sha)
                return { branch, commitSha: ref.object.sha };
        }
        catch (e) {
            if (!isNotFound(e))
                throw e;
        }
    }
    return null;
}
async function getTreeSha(token, owner, repo, commitSha) {
    try {
        const c = await request({
            hostname: 'api.github.com',
            path: `/repos/${owner}/${repo}/git/commits/${commitSha}`,
            method: 'GET',
            headers: apiGetHeaders(token),
        });
        return c?.tree?.sha || null;
    }
    catch (e) {
        if (isNotFound(e))
            return null;
        throw e;
    }
}
async function pushFiles(token, owner, repo, files, message = 'Update from TypeWriter') {
    if (files.size === 0)
        throw new Error('No files to push');
    if (files.size > 500)
        throw new Error(`Too many files (${files.size}, max 500)`);
    let totalBytes = 0;
    for (const c of files.values())
        totalBytes += Buffer.byteLength(c);
    if (totalBytes > 5 * 1024 * 1024)
        throw new Error(`Payload too large (${(totalBytes / 1048576).toFixed(1)}MB, max 5MB)`);
    const tree = Array.from(files.entries()).map(([path, content]) => ({
        path, mode: '100644', type: 'blob', content,
    }));
    const branchInfo = await getBranch(token, owner, repo);
    let treeSha;
    if (branchInfo) {
        const baseTree = await getTreeSha(token, owner, repo, branchInfo.commitSha);
        const treeRes = await request({
            hostname: 'api.github.com', path: `/repos/${owner}/${repo}/git/trees`,
            method: 'POST', headers: apiHeaders(token),
        }, JSON.stringify(baseTree ? { base_tree: baseTree, tree } : { tree }));
        treeSha = treeRes.sha;
        const commitRes = await request({
            hostname: 'api.github.com', path: `/repos/${owner}/${repo}/git/commits`,
            method: 'POST', headers: apiHeaders(token),
        }, JSON.stringify({ message, tree: treeSha, parents: [branchInfo.commitSha] }));
        await request({
            hostname: 'api.github.com', path: `/repos/${owner}/${repo}/git/refs/heads/${branchInfo.branch}`,
            method: 'PATCH', headers: apiHeaders(token),
        }, JSON.stringify({ sha: commitRes.sha }));
        return branchInfo.branch;
    }
    // Empty repo: create tree + root commit + new ref
    const treeRes = await request({
        hostname: 'api.github.com', path: `/repos/${owner}/${repo}/git/trees`,
        method: 'POST', headers: apiHeaders(token),
    }, JSON.stringify({ tree }));
    const commitRes = await request({
        hostname: 'api.github.com', path: `/repos/${owner}/${repo}/git/commits`,
        method: 'POST', headers: apiHeaders(token),
    }, JSON.stringify({ message, tree: treeRes.sha, parents: [] }));
    await request({
        hostname: 'api.github.com', path: `/repos/${owner}/${repo}/git/refs`,
        method: 'POST', headers: apiHeaders(token),
    }, JSON.stringify({ ref: 'refs/heads/main', sha: commitRes.sha }));
    return 'main';
}
async function getRepos(token, opts) {
    const per = Math.max(1, Math.min(100, opts?.per_page ?? 30));
    const page = Math.max(1, opts?.page ?? 1);
    const sort = ['created', 'updated', 'pushed', 'full_name'].includes(opts?.sort || '') ? opts.sort : 'updated';
    return request({
        hostname: 'api.github.com',
        path: `/user/repos?sort=${sort}&per_page=${per}&page=${page}`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'User-Agent': 'TypeWriter-Editor',
        },
    });
}
async function getRepoFull(token, owner, repo) {
    return request({
        hostname: 'api.github.com',
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        method: 'GET',
        headers: apiGetHeaders(token),
    });
}
async function updateRepo(token, owner, repo, patch) {
    const clean = sanitizeRepoPatch(patch);
    if (Object.keys(clean).length === 0)
        throw new Error('No valid fields to update');
    return request({
        hostname: 'api.github.com',
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
        method: 'PATCH',
        headers: apiHeaders(token),
    }, JSON.stringify(clean));
}
async function listBranches(token, owner, repo) {
    return request({
        hostname: 'api.github.com',
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
        method: 'GET',
        headers: apiGetHeaders(token),
    });
}
async function getTopics(token, owner, repo) {
    const r = await request({
        hostname: 'api.github.com',
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`,
        method: 'GET',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'TypeWriter-Editor',
        },
    });
    return Array.isArray(r?.names) ? r.names : [];
}
async function setTopics(token, owner, repo, names) {
    const clean = sanitizeTopics(names);
    if (clean === null)
        throw new Error('Invalid topics (lowercase, a-z 0-9 -, max 20)');
    const r = await request({
        hostname: 'api.github.com',
        path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/topics`,
        method: 'PUT',
        headers: {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github+json',
            'User-Agent': 'TypeWriter-Editor',
            'Content-Type': 'application/json',
        },
    }, JSON.stringify({ names: clean }));
    return Array.isArray(r?.names) ? r.names : clean;
}
/** Actionable message when a token is valid but not permitted to do the action.
 * Fine-grained PATs pass read validation (no scope header) yet GitHub rejects
 * writes with 403 "Resource not accessible by integration". Returns null when
 * the error is anything else so callers fall through to the generic handler. */
function friendlyActionError(e, verb) {
    const msg = String(e?.message || '');
    if (e?.statusCode === 403 && /resource not accessible by integration/i.test(msg)) {
        return `This login cannot ${verb} - use Login with GitHub or a classic token with the \`repo\` scope`;
    }
    return null;
}
function logout() {
    (0, utils_1.clearToken)();
}
function isLoggedIn() {
    return (0, utils_1.loadToken)() !== null;
}
function getUsername() {
    return (0, utils_1.getGitHubUsername)();
}
