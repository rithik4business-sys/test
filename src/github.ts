import * as https from 'https';
import { saveToken, loadToken, clearToken, setGitHubUsername, getGitHubUsername } from './utils';
export { loadToken };

interface GitHubUser {
  login: string;
  id: number;
  avatar_url: string;
  name?: string | null;
}

export interface GitHubRepo {
  name: string;
  full_name: string;
  html_url: string;
  private: boolean;
  description?: string | null;
  default_branch?: string;
  updated_at?: string;
}

export interface GitHubRepoFull extends GitHubRepo {
  homepage?: string | null;
  has_issues?: boolean;
  has_projects?: boolean;
  has_wiki?: boolean;
  allow_squash_merge?: boolean;
  allow_merge_commit?: boolean;
  allow_rebase_merge?: boolean;
  delete_branch_on_merge?: boolean;
  archived?: boolean;
  default_branch: string;
  open_issues_count?: number;
  stargazers_count?: number;
  forks_count?: number;
}

export interface GitHubBranch {
  name: string;
  commit: { sha: string; url?: string };
}

export const REPO_NAME_RE = /^[A-Za-z0-9._-]{1,100}$/;

export function isValidRepoName(name: string): boolean {
  return REPO_NAME_RE.test(name || '');
}

/** owner/repo parser — returns null on bad shape. */
export function parseRepoFull(full: string): { owner: string; repo: string } | null {
  if (typeof full !== 'string') return null;
  const parts = full.split('/');
  if (parts.length !== 2) return null;
  const [owner, repo] = parts.map((s) => s.trim());
  if (!owner || !repo) return null;
  if (owner.length > 39 || repo.length > 100) return null;
  if (!/^[A-Za-z0-9]([A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/.test(owner)) return null;
  if (!isValidRepoName(repo)) return null;
  return { owner, repo };
}

export const ALLOWED_REPO_PATCH = new Set([
  'name', 'description', 'homepage', 'private',
  'has_issues', 'has_projects', 'has_wiki',
  'default_branch', 'allow_squash_merge', 'allow_merge_commit',
  'allow_rebase_merge', 'delete_branch_on_merge', 'archived',
]);

/** Strip unknown keys + coerce types for PATCH /repos/{owner}/{repo}. */
export function sanitizeRepoPatch(input: any): Record<string, any> {
  const out: Record<string, any> = {};
  if (!input || typeof input !== 'object') return out;
  for (const k of ALLOWED_REPO_PATCH) {
    if (!(k in input)) continue;
    const v = (input as any)[k];
    if (k === 'name') {
      if (typeof v === 'string' && isValidRepoName(v)) out[k] = v;
    } else if (k === 'description' || k === 'homepage' || k === 'default_branch') {
      if (v === null) out[k] = null;
      // Empty strings are dropped, not sent: GitHub 422s on
      // description:"" and default_branch:"" (the latter is what an empty
      // repo's branch-less select produces). Absent = leave unchanged.
      else if (typeof v === 'string' && v !== '' && v.length <= 350) out[k] = v;
    } else if (typeof v === 'boolean') {
      out[k] = v;
    }
  }
  return out;
}

export function sanitizeTopics(input: any): string[] | null {
  if (!Array.isArray(input)) return null;
  const out: string[] = [];
  for (const t of input) {
    if (typeof t !== 'string') return null;
    const s = t.trim().toLowerCase();
    if (!/^[a-z0-9-]{1,50}$/.test(s)) return null;
    if (!out.includes(s)) out.push(s);
    if (out.length > 20) return null;
  }
  return out;
}

/** Build the message for a failed GitHub API call, including the first
 * validation detail GitHub returns (errors[0]) — otherwise every 422 shows
 * up as a bare "Validation Failed" with no hint what to fix. Pure (tested). */
export function gitHubErrorMessage(code: number, json: any, raw: string): string {
  const base = (json && json.message) || String(raw || '').slice(0, 200) || `HTTP ${code}`;
  const errs = json && Array.isArray(json.errors) ? json.errors : [];
  const first = errs.length ? errs[0] : null;
  const detail = first ? String(first.message || first.code || '') : '';
  const msg = detail && detail !== base ? `${base}: ${detail}` : String(base);
  return msg.slice(0, 300);
}

export class GitHubError extends Error {
  statusCode: number;
  constructor(message: string, statusCode: number) {
    super(message);
    this.statusCode = statusCode;
  }
}

const CLIENT_ID = process.env.TYPEWRITER_CLIENT_ID || 'Iv1.b507a08c87ecfe98';

function requestOnce(options: https.RequestOptions, body?: string): Promise<{ json: any; retryAfter: number }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => { if (!settled) { settled = true; reject(e); } };
    const ok = (v: { json: any; retryAfter: number }) => { if (!settled) { settled = true; resolve(v); } };
    if (body && !options.headers) options.headers = {};
    const headers = (options.headers || {}) as Record<string, string>;
    options.headers = headers;
    if (body) {
      headers['Content-Length'] = String(Buffer.byteLength(body));
    }
    if (!headers['User-Agent']) headers['User-Agent'] = 'TypeWriter-Editor';
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        const code = res.statusCode || 0;
        let json: any = {};
        if (data) {
          try {
            json = JSON.parse(data);
          } catch {
            if (code >= 200 && code < 300) return ok({ json: {}, retryAfter: 0 });
            return fail(new GitHubError(`GitHub API error: ${code} - ${data.slice(0, 200)}`, code));
          }
        }
        if (code >= 200 && code < 300) {
          // Device-flow polls return 200 with { error } — let caller decide
          ok({ json, retryAfter: 0 });
        } else if (code === 429 || code >= 500) {
          const ra = parseInt(String(res.headers['retry-after'] || '0'), 10);
          fail(Object.assign(
            new GitHubError(gitHubErrorMessage(code, json, data), code),
            { retryable: true, retryAfter: Number.isFinite(ra) ? ra : 0 }
          ));
        } else {
          fail(new GitHubError(gitHubErrorMessage(code, json, data), code));
        }
      });
    });
    req.on('error', (e) => fail(e as Error));
    req.setTimeout(15000, () => {
      fail(Object.assign(new GitHubError('Request timed out', 0), { retryable: true, retryAfter: 0 }));
      try { req.destroy(); } catch { /* noop */ }
    });
    if (body) req.write(body);
    req.end();
  });
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function request(options: https.RequestOptions, body?: string): Promise<any> {
  let lastErr: any = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const { json } = await requestOnce(options, body);
      return json;
    } catch (e) {
      lastErr = e;
      const retryable = (e as any)?.retryable === true;
      if (!retryable || attempt === 2) throw e;
      const hinted = (e as any)?.retryAfter || 0;
      const waitMs = hinted > 0 && hinted <= 60 ? hinted * 1000 : (attempt + 1) * 1000;
      await sleep(waitMs);
    }
  }
  throw lastErr;
}

function isNotFound(e: unknown): boolean {
  return e instanceof GitHubError && e.statusCode === 404;
}

/** GitHub answers ref/branch reads on an empty repo with 409
 * "Git Repository is empty." — that means "no branch yet", not failure.
 * Callers that can initialize (push) or list (branches) handle it as empty. */
export function isEmptyRepo(e: unknown): boolean {
  return e instanceof GitHubError && e.statusCode === 409 && /repository is empty/i.test((e as Error).message || '');
}

export async function authenticate(): Promise<string> {
  const existingToken = loadToken();
  if (existingToken) {
    try {
      const user = await getUser(existingToken);
      setGitHubUsername(user.login);
      return existingToken;
    } catch {
      clearToken();
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
  saveToken(token);

  const user = await getUser(token);
  setGitHubUsername(user.login);

  return token;
}

async function pollForToken(deviceCode: string, interval: number, expiresIn = 900): Promise<string> {
  const delay = (ms: number) => new Promise(r => setTimeout(r, ms));
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

    if (response.access_token) return response.access_token as string;
    if (response.error === 'authorization_pending') continue;
    if (response.error === 'slow_down') {
      wait = (response.interval as number) || wait + 5;
      continue;
    }
    if (response.error === 'expired_token') throw new Error('Code expired. Run --login again.');
    if (response.error === 'access_denied') throw new Error('Authorization denied.');
    throw new Error(response.error_description || response.error || 'Auth failed');
  }
  throw new Error('Timed out waiting for authorization.');
}

export async function getUser(token: string): Promise<GitHubUser> {
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
export async function getAuthenticatedUser(token: string): Promise<GitHubUser> {
  const user = await getUser(token);
  if (!user || !user.login) throw new Error('Invalid GitHub token');
  return user;
}

/** Split an X-OAuth-Scopes header value into lowercase scope names. */
export function parseOAuthScopes(header: string | string[] | null | undefined): string[] {
  const raw = Array.isArray(header) ? header.join(',') : (header || '');
  return String(raw).split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
}

/** True when the scope list grants push access (classic `repo` scope). */
export function hasRepoScope(scopes: string[] | string | null | undefined): boolean {
  const list = typeof scopes === 'string' ? parseOAuthScopes(scopes) : (scopes || []).map((x) => String(x).trim().toLowerCase());
  return list.includes('repo');
}

/** Coarse login capability derived from the OAuth scope header.
 *  `null` scopes = fine-grained PAT (no header sent) — GitHub blocks
 *  repo creation for these, so the UI can say so before trying. */
export type TokenKind = 'full' | 'limited' | 'fine-grained';
export function classifyTokenKind(scopes: string[] | null): TokenKind {
  if (scopes === null) return 'fine-grained';
  return hasRepoScope(scopes) ? 'full' : 'limited';
}

/** True for GitHub App user/server tokens (ghu_/ghs_). These carry the app's
 * permissions instead of OAuth scopes (hence the empty scope header) and —
 * critically — GitHub blocks them from POST /user/repos no matter what.
 * Detecting the prefix lets the UI say so instead of blaming scopes. */
export function isGitHubAppToken(token: string | null | undefined): boolean {
  return typeof token === 'string' && /^(ghu_|ghs_)/.test(token);
}

/** Parse `git credential fill` stdout into its username/password pair.
 * Pure helper (tested): returns null when no password line is present. */
export function parseGitCredentialOutput(text: string): { username: string; password: string } | null {
  let username = '';
  let password = '';
  for (const ln of String(text || '').split('\n')) {
    const m = /^([^=\s]+)=(.*)$/.exec(ln.trim());
    if (!m) continue;
    if (m[1] === 'username' && !username) username = m[2];
    else if (m[1] === 'password' && !password) password = m[2];
  }
  if (!password) return null;
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
export function saveGuard(scopes: string[] | string | null, token?: string): string | null {
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
export function createBlockedMessage(token: string | null, kind: TokenKind): string | null {
  if (isGitHubAppToken(token)) {
    return 'This login uses the TypeWriter GitHub App, which GitHub does not allow to create repositories — list, push and settings all work. To create repos, logout and paste a classic token with the `repo` scope.';
  }
  return createRepoBlockedError(kind);
}

/** Pre-check for POST /user/repos: fine-grained PATs are blocked by GitHub
 *  itself from creating repositories, so the server can fail fast without
 *  spending an API call. Returns the error message, or null when creation
 *  may proceed (the API call still decides `limited` tokens). */
export function createRepoBlockedError(kind: TokenKind): string | null {
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
export async function getTokenScopes(token: string): Promise<{ login: string; name: string | null; avatar_url: string | null; scopes: string[] | null }> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const fail = (e: Error) => { if (!settled) { settled = true; reject(e); } };
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
        if (settled) return; settled = true;
        const code = res.statusCode || 0;
        if (code === 401) { reject(new GitHubError('Session expired — please log in again', 401)); return; }
        if (code < 200 || code >= 300) {
          let msg = data.slice(0, 200);
          try { const j = JSON.parse(data); if (j && j.message) msg = j.message; } catch { /* keep slice */ }
          reject(new GitHubError(`GitHub API error: ${code} - ${msg}`, code)); return;
        }
        let user: any = {};
        try { user = JSON.parse(data || '{}'); } catch { user = {}; }
        if (!user || !user.login) { reject(new Error('Invalid GitHub token')); return; }
        const h = res.headers['x-oauth-scopes'];
        resolve({
          login: user.login,
          name: user.name || null,
          avatar_url: user.avatar_url || null,
          scopes: typeof h === 'undefined' ? null : parseOAuthScopes(h as any),
        });
      });
    });
    req.on('error', (e) => fail(e as Error));
    req.setTimeout(15000, () => {
      fail(new GitHubError('Request timed out', 0));
      try { req.destroy(); } catch { /* noop */ }
    });
    req.end();
  });
}

/** Start a device-flow login for the web UI (no console output, no polling). */
export async function startDeviceFlow(): Promise<{
  device_code: string; user_code: string; verification_uri: string;
  expires_in: number; interval: number;
}> {
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

export type DevicePollResult =
  | { status: 'pending' }
  | { status: 'slow_down'; interval: number }
  | { status: 'authorized'; token: string }
  | { status: 'error'; error: string; fatal: boolean };

/** Single device-flow poll (web UI calls this on an interval). */
export async function pollDeviceOnce(deviceCode: string): Promise<DevicePollResult> {
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
  if (r.access_token) return { status: 'authorized', token: r.access_token as string };
  if (r.error === 'authorization_pending') return { status: 'pending' };
  if (r.error === 'slow_down') {
    return { status: 'slow_down', interval: (r.interval as number) || 10 };
  }
  if (r.error === 'expired_token') return { status: 'error', error: 'Code expired — start over', fatal: true };
  if (r.error === 'access_denied') return { status: 'error', error: 'Authorization denied.', fatal: true };
  if (r.error === 'incorrect_device_code' || r.error === 'incorrect_client_credentials') {
    return { status: 'error', error: (r.error_description || r.error) as string, fatal: true };
  }
  return { status: 'error', error: (r.error_description || r.error || 'Auth failed') as string, fatal: false };
}

export async function createRepo(token: string, name: string, description: string, isPrivate: boolean = false): Promise<GitHubRepo> {
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

export async function getRepo(token: string, owner: string, repo: string): Promise<GitHubRepo | null> {
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
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

const apiGetHeaders = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'TypeWriter-Editor',
});

const apiHeaders = (token: string) => ({
  'Authorization': `Bearer ${token}`,
  'Accept': 'application/vnd.github.v3+json',
  'User-Agent': 'TypeWriter-Editor',
  'Content-Type': 'application/json',
});

async function getBranch(token: string, owner: string, repo: string): Promise<{ branch: string; commitSha: string } | null> {
  for (const branch of ['main', 'master']) {
    try {
      const ref = await request({
        hostname: 'api.github.com',
        path: `/repos/${owner}/${repo}/git/refs/heads/${branch}`,
        method: 'GET',
        headers: apiGetHeaders(token),
      });
      if (ref?.object?.sha) return { branch, commitSha: ref.object.sha };
    } catch (e) {
      if (!isNotFound(e) && !isEmptyRepo(e)) throw e;
    }
  }
  return null;
}

async function getTreeSha(token: string, owner: string, repo: string, commitSha: string): Promise<string | null> {
  try {
    const c = await request({
      hostname: 'api.github.com',
      path: `/repos/${owner}/${repo}/git/commits/${commitSha}`,
      method: 'GET',
      headers: apiGetHeaders(token),
    });
    return c?.tree?.sha || null;
  } catch (e) {
    if (isNotFound(e)) return null;
    throw e;
  }
}

export async function pushFiles(
  token: string,
  owner: string,
  repo: string,
  files: Map<string, string>,
  message: string = 'Update from TypeWriter'
): Promise<string> {
  if (files.size === 0) throw new Error('No files to push');
  if (files.size > 500) throw new Error(`Too many files (${files.size}, max 500)`);
  let totalBytes = 0;
  for (const c of files.values()) totalBytes += Buffer.byteLength(c);
  if (totalBytes > 5 * 1024 * 1024) throw new Error(`Payload too large (${(totalBytes / 1048576).toFixed(1)}MB, max 5MB)`);
  const tree = Array.from(files.entries()).map(([path, content]) => ({
    path, mode: '100644', type: 'blob', content,
  }));
  const branchInfo = await getBranch(token, owner, repo);

  let treeSha: string;
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

  // Empty repo: the git-database API refuses EVERYTHING (409 "Git Repository
  // is empty.") until a commit exists — trees included. Seed the first file
  // via the contents API (creates `main`), then take the normal path once
  // for the rest. Bounded to one recursion: the repo is non-empty after.
  const entries = Array.from(files.entries());
  const [firstPath, firstContent] = entries[0] as [string, string];
  await request({
    hostname: 'api.github.com',
    path: `/repos/${owner}/${repo}/contents/${firstPath.split('/').map(encodeURIComponent).join('/')}`,
    method: 'PUT', headers: apiHeaders(token),
  }, JSON.stringify({
    message, branch: 'main',
    content: Buffer.from(firstContent, 'utf-8').toString('base64'),
  }));
  if (entries.length === 1) return 'main';
  return pushFiles(token, owner, repo, new Map(entries.slice(1)), message);
}

export async function getRepos(token: string, opts?: { per_page?: number; page?: number; sort?: string }): Promise<GitHubRepo[]> {
  const per = Math.max(1, Math.min(100, opts?.per_page ?? 30));
  const page = Math.max(1, opts?.page ?? 1);
  const sort = ['created', 'updated', 'pushed', 'full_name'].includes(opts?.sort || '') ? opts!.sort : 'updated';
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

export async function getRepoFull(token: string, owner: string, repo: string): Promise<GitHubRepoFull> {
  return request({
    hostname: 'api.github.com',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    method: 'GET',
    headers: apiGetHeaders(token),
  });
}

export async function updateRepo(
  token: string, owner: string, repo: string, patch: Record<string, any>
): Promise<GitHubRepoFull> {
  const clean = sanitizeRepoPatch(patch);
  if (Object.keys(clean).length === 0) throw new Error('No valid fields to update');
  return request({
    hostname: 'api.github.com',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`,
    method: 'PATCH',
    headers: apiHeaders(token),
  }, JSON.stringify(clean));
}

export async function listBranches(token: string, owner: string, repo: string): Promise<GitHubBranch[]> {
  return request({
    hostname: 'api.github.com',
    path: `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/branches?per_page=100`,
    method: 'GET',
    headers: apiGetHeaders(token),
  });
}

export async function getTopics(token: string, owner: string, repo: string): Promise<string[]> {
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

export async function setTopics(token: string, owner: string, repo: string, names: string[]): Promise<string[]> {
  const clean = sanitizeTopics(names);
  if (clean === null) throw new Error('Invalid topics (lowercase, a-z 0-9 -, max 20)');
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
export function friendlyActionError(e: any, verb: 'create repositories' | 'push to this repository'): string | null {
  const msg = String((e as any)?.message || '');
  if ((e as any)?.statusCode === 403 && /resource not accessible by integration/i.test(msg)) {
    return `This login cannot ${verb} - use Login with GitHub or a classic token with the \`repo\` scope`;
  }
  return null;
}

export function logout(): void {
  clearToken();
}

export function isLoggedIn(): boolean {
  return loadToken() !== null;
}

export function getUsername(): string | null {
  return getGitHubUsername();
}
