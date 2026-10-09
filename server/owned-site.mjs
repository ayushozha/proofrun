import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const exec = promisify(execFile);
const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const siteOrigin = 'https://ayushojha.com';
const collectionPath = 'apps/web/src/collections';

function exactSite(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter the configured owned-site URL.'); }
  if (url.origin !== siteOrigin || url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('Only the configured owned-site root URL is supported.');
  }
  return url.href;
}

async function sourceCheckout() {
  const configured = process.env.OWNED_SITE_REPO_DIR;
  if (!configured || !path.isAbsolute(configured)) throw new Error('Set OWNED_SITE_REPO_DIR to an absolute private checkout path.');
  let repoDir;
  try {
    repoDir = await realpath(configured);
    if (!(await stat(path.join(repoDir, collectionPath))).isDirectory()) throw new Error('Missing collections directory.');
    if (!(await stat(path.join(repoDir, collectionPath, 'Products.ts'))).isFile()) throw new Error('Missing Products collection.');
  } catch { throw new Error('The configured owned-site source checkout is unavailable.'); }
  const { stdout: head } = await exec('git', ['rev-parse', 'HEAD'], {
    cwd: repoDir, timeout: 10000, maxBuffer: 1024,
  }).catch(() => { throw new Error('Could not identify the owned-site source commit.'); });
  const gitHead = head.trim();
  if (!/^[a-f0-9]{40}$/i.test(gitHead)) throw new Error('Owned-site source commit is invalid.');
  const { stdout: remote } = await exec('git', ['remote', 'get-url', 'origin'], {
    cwd: repoDir, timeout: 10000, maxBuffer: 2048,
  }).catch(() => { throw new Error('Owned-site source remote is unavailable.'); });
  if (!/github\.com[:/]ayushozha\/ayush-portfolio(?:\.git)?\s*$/i.test(remote)) {
    throw new Error('The configured checkout is not the owned-site source repository.');
  }
  return { repoDir, gitHead };
}

async function semgrepFindings(repoDir) {
  const rules = path.join(projectRoot, 'semgrep', 'payload-authorization.yml');
  try {
    if (!(await stat(rules)).isFile()) throw new Error('Missing rule file.');
  } catch { throw new Error('The pinned Semgrep rule file is unavailable.'); }
  let stdout;
  try {
    ({ stdout } = await exec('uvx', [
      '--python', '3.12', 'semgrep', 'scan', '--metrics=off', '--json', '--config', rules,
      path.join(repoDir, collectionPath),
    ], { cwd: repoDir, timeout: 180000, maxBuffer: 8 * 1024 * 1024, windowsHide: true }));
  } catch (error) {
    throw new Error(error?.killed ? 'Semgrep scan timed out.' : 'Semgrep scan failed.');
  }
  let result;
  try { result = JSON.parse(stdout); } catch { throw new Error('Semgrep returned invalid JSON.'); }
  if (!Array.isArray(result?.results) || (Array.isArray(result.errors) && result.errors.length)) {
    throw new Error('Semgrep returned an incomplete scan.');
  }
  return result.results.map((finding) => {
    const rawPath = String(finding?.path || '').replace(/\\/g, '/');
    const start = rawPath.toLowerCase().indexOf(`${collectionPath}/`);
    const relative = start < 0 ? '' : rawPath.slice(start);
    const line = Number(finding?.start?.line);
    if (!/^apps\/web\/src\/collections\/[A-Za-z0-9_-]+\.ts$/.test(relative) ||
      !Number.isInteger(line) || line < 1 || typeof finding?.check_id !== 'string') {
      throw new Error('Semgrep returned an unexpected finding location.');
    }
    const ruleId = finding.check_id.split(/[.\\/]/).at(-1);
    if (ruleId !== 'payload-access-authenticated-user-only') {
      throw new Error('Semgrep returned an unexpected rule ID.');
    }
    return {
      ruleId,
      path: relative,
      line,
      message: String(finding?.extra?.message || '').replace(/[\r\n\t\x00-\x1f]+/g, ' ').slice(0, 300),
    };
  });
}

async function anonymousAccess(url) {
  let response;
  try {
    response = await fetch(new URL('/api/access', url), {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'application/json' },
    });
  } catch {
    return { path: '/api/access', status: 0, collectionNames: [], responseCapped: false, parsed: false };
  }
  const chunks = [];
  let size = 0;
  let capped = false;
  const reader = response.body?.getReader();
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = 64 * 1024 - size;
        if (value.length > remaining) {
          if (remaining) chunks.push(value.subarray(0, remaining));
          capped = true;
          break;
        }
        chunks.push(value);
        size += value.length;
      }
    } finally {
      if (capped) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  let body;
  if (!capped) {
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* Response was not access JSON. */ }
  }
  const collections = body?.collections;
  const collectionNames = collections && typeof collections === 'object' && !Array.isArray(collections)
    ? Object.keys(collections).filter((name) => /^[a-z0-9-]{1,80}$/.test(name)).sort().slice(0, 100) : [];
  return { path: '/api/access', status: response.status, collectionNames,
    responseCapped: capped, parsed: Boolean(collections) };
}

/** Source finding plus one anonymous live observation; neither proves a live exploit. */
export async function auditOwnedSite(requestedUrl) {
  const configuredUrl = exactSite(process.env.OWNED_SITE_URL);
  const siteUrl = exactSite(requestedUrl);
  if (siteUrl !== configuredUrl) throw new Error('The requested site differs from OWNED_SITE_URL.');
  const { repoDir, gitHead } = await sourceCheckout();
  const findings = await semgrepFindings(repoDir);
  const live = await anonymousAccess(siteUrl);
  return {
    siteUrl, source: { gitHead, scanner: 'Semgrep CE', findings }, live,
    confidence: 'source-only',
    conclusion: 'Source authorization patterns require review; the anonymous access check does not prove a live exploit.',
  };
}
