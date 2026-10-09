import { createHash, randomBytes } from 'node:crypto';

const HACKERONE_API = 'https://api.hackerone.com/v1/hackers';
const VERCEL_API = 'https://api.vercel.com';
const ACRONIS_PROGRAM_URL = 'https://hackerone.com/acronis';
const ACRONIS_SEARCH_URL = 'https://www.acronis.com/en/search/';
let lastAcronisProbeAt = 0;

export function parseProgramUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a HackerOne program URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'hackerone.com') {
    throw new Error('Enter a supported HackerOne program URL.');
  }
  if (/^\/vercel\/?$/.test(url.pathname)) return 'https://hackerone.com/vercel';
  if (/^\/acronis\/?$/.test(url.pathname)) return ACRONIS_PROGRAM_URL;
  throw new Error('This prototype supports the Vercel and Acronis HackerOne programs.');
}

export function captureIsUsable(capture) {
  const age = Date.now() - Date.parse(capture?.capturedAt);
  if (!capture || !Number.isFinite(age) || age < -5 * 60 * 1000 || age > 2 * 60 * 60 * 1000) return false;
  const text = capture.visibleText.toLowerCase();
  return text.includes('vercel rest api') && text.includes('cross-tenant testing') &&
    text.includes('two accounts you own') && (text.includes('5 qps') || text.includes('5 queries per second'));
}

function h1Auth() {
  const username = process.env.HACKERONE_API_USERNAME;
  const token = process.env.HACKERONE_API_TOKEN;
  if (!username || !token) throw new Error('Configure HACKERONE_API_USERNAME and HACKERONE_API_TOKEN.');
  return `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`;
}

async function jsonFetch(url, options = {}, label = 'Request') {
  let response;
  try { response = await fetch(url, { ...options, signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error(`${label} could not connect.`); }
  if (!response.ok) throw new Error(`${label} returned HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error(`${label} returned invalid JSON.`); }
}

export async function fetchProgramScope() {
  const headers = { Authorization: h1Auth(), Accept: 'application/json' };
  const [program, scopes] = await Promise.all([
    jsonFetch(`${HACKERONE_API}/programs/vercel`, { headers }, 'HackerOne program lookup'),
    jsonFetch(`${HACKERONE_API}/programs/vercel/structured_scopes?page%5Bsize%5D=100`, { headers }, 'HackerOne scope lookup'),
  ]);
  // HackerOne returns this single-resource endpoint without a `data` wrapper.
  const attributes = program?.attributes || program?.data?.attributes || {};
  if (attributes.handle !== 'vercel' || attributes.submission_state !== 'open') {
    throw new Error('Vercel program is not open for submissions in the HackerOne API.');
  }
  const eligible = (scopes?.data || []).filter((item) => item.attributes?.eligible_for_submission === true);
  const apiScope = eligible.find(({ attributes }) => attributes?.asset_identifier === 'api.vercel.com') ||
    eligible.find(({ attributes }) => /api\.vercel\.com|\*\.vercel\.com|vercel rest api/i.test(attributes?.asset_identifier || ''));
  if (!apiScope) throw new Error('HackerOne did not return an eligible Vercel API scope. Review the current scope before testing.');
  return {
    id: apiScope.id,
    identifier: apiScope.attributes.asset_identifier,
    instruction: apiScope.attributes.instruction || '',
    updatedAt: apiScope.attributes.updated_at,
    policyChecks: {
      ownsAssets: /test only what you own/i.test(attributes.policy || ''),
      twoAccounts: /two accounts you own/i.test(attributes.policy || ''),
      platformApi: /vercel rest api/i.test(attributes.policy || ''),
    },
  };
}

/** Confirm the one public Acronis host from the current HackerOne program and structured scope. */
export async function fetchAcronisScope() {
  const headers = { Authorization: h1Auth(), Accept: 'application/json' };
  const [program, scopes] = await Promise.all([
    jsonFetch(`${HACKERONE_API}/programs/acronis`, { headers }, 'HackerOne Acronis program lookup'),
    jsonFetch(`${HACKERONE_API}/programs/acronis/structured_scopes?page%5Bsize%5D=100`, { headers }, 'HackerOne Acronis scope lookup'),
  ]);
  const attributes = program?.attributes || program?.data?.attributes || {};
  if (attributes.handle !== 'acronis' || attributes.submission_state !== 'open') {
    throw new Error('Acronis program is not open for submissions in the HackerOne API.');
  }
  if (!Array.isArray(scopes?.data)) throw new Error('HackerOne returned incomplete Acronis structured scope.');
  const matching = scopes.data.filter((item) => item?.attributes?.asset_identifier === '*.acronis.com');
  const wildcard = matching.find((item) => item.attributes.eligible_for_submission === true);
  const excludedHost = scopes.data.some((item) => item?.attributes?.asset_identifier === 'www.acronis.com'
    && item.attributes.eligible_for_submission === false);
  if (!wildcard || excludedHost) {
    throw new Error('HackerOne did not confirm www.acronis.com in eligible Acronis scope.');
  }
  const policy = String(attributes.policy || '');
  const policyChecks = {
    automatedScanning: /automated scanning against web resources and api/i.test(policy),
    aliasUserAgent: /@wearehackerone.{0,100}user-agent|user-agent.{0,100}@wearehackerone/is.test(policy),
    rateLimit: /5 requests per second/i.test(policy),
  };
  if (!Object.values(policyChecks).every(Boolean)) {
    throw new Error('Current Acronis policy did not confirm every automated-test boundary.');
  }
  return {
    id: wildcard.id,
    identifier: wildcard.attributes.asset_identifier,
    updatedAt: wildcard.attributes.updated_at,
    policyHash: createHash('sha256').update(policy).digest('hex'),
    policyChecks,
  };
}

/** One inert, rate-limited public search GET. Reflection alone is never a finding. */
export async function probeAcronisSearch() {
  const handle = process.env.HACKERONE_API_USERNAME?.trim();
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(handle || '')) throw new Error('A valid HackerOne username is required for the Acronis User-Agent.');
  const waitMs = 1000 - (Date.now() - lastAcronisProbeAt);
  if (waitMs > 0) await new Promise((resolve) => setTimeout(resolve, waitMs));
  lastAcronisProbeAt = Date.now();
  const marker = `proofrun${randomBytes(8).toString('hex')}`;
  const url = new URL(ACRONIS_SEARCH_URL);
  url.searchParams.set('query', marker);
  let response;
  try {
    response = await fetch(url, {
      method: 'GET', redirect: 'error', signal: AbortSignal.timeout(10000),
      headers: { Accept: 'text/html', 'User-Agent': `ProofRun/0.1 (${handle}@wearehackerone.com)` },
    });
  } catch {
    return { actor: 'public_search', status: 0, markerReflected: false, responseCapped: false, detail: 'The bounded GET failed or redirected; no further target request was made.' };
  }
  const reader = response.body?.getReader();
  const chunks = [];
  let total = 0;
  let capped = false;
  if (reader) {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const remaining = 256 * 1024 - total;
        if (value.length > remaining) {
          if (remaining) chunks.push(value.subarray(0, remaining));
          capped = true;
          break;
        }
        chunks.push(value);
        total += value.length;
      }
    } finally {
      if (capped) await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  }
  const markerReflected = Buffer.concat(chunks).includes(Buffer.from(marker));
  const detail = capped ? 'Response exceeded the 256 KiB observation cap; no finding can be inferred.'
    : markerReflected ? 'The inert query marker appeared in the response; reflection alone is not a vulnerability.'
      : 'The inert query marker was not observed in the bounded response; no vulnerability was established.';
  return { actor: 'public_search', status: response.status, markerReflected, responseCapped: capped, detail };
}

/** Read every structured-scope page for a read-only program-policy snapshot. */
export async function fetchProgramScopeSnapshot() {
  const headers = { Authorization: h1Auth(), Accept: 'application/json' };
  const program = await jsonFetch(`${HACKERONE_API}/programs/vercel`, { headers }, 'HackerOne program lookup');
  const attributes = program?.attributes || program?.data?.attributes || {};
  if (attributes.handle !== 'vercel') throw new Error('HackerOne did not return the Vercel program.');

  const scopes = [];
  const ids = new Set();
  const seenPages = new Set();
  const pageBase = `${HACKERONE_API}/programs/vercel/structured_scopes`;
  let next = null;
  let linkedPages = false;
  let complete = false;
  for (let page = 1; page <= 100; page++) {
    const url = next || new URL(pageBase);
    if (!next) {
      url.searchParams.set('page[size]', '100');
      url.searchParams.set('page[number]', String(page));
    }
    if (seenPages.has(url.href)) throw new Error('HackerOne scope pagination repeated a page.');
    seenPages.add(url.href);
    const body = await jsonFetch(url, { headers }, 'HackerOne scope lookup');
    if (!Array.isArray(body?.data) || !body?.links || typeof body.links !== 'object') {
      throw new Error('HackerOne returned an incomplete structured-scope page.');
    }
    const link = body.links.next?.href ?? body.links.next;
    if (body.data.length === 0) {
      if (link) throw new Error('HackerOne returned an incomplete structured-scope page.');
      complete = true;
      break;
    }
    for (const item of body.data) {
      const attrs = item?.attributes;
      if (!item?.id || ids.has(item.id) || typeof attrs?.asset_type !== 'string'
        || typeof attrs?.asset_identifier !== 'string'
        || typeof attrs?.eligible_for_submission !== 'boolean'
        || typeof attrs?.eligible_for_bounty !== 'boolean') {
        throw new Error('HackerOne returned a duplicate or incomplete structured scope.');
      }
      ids.add(item.id);
      const type = attrs.asset_type.trim().toLowerCase();
      const identifier = attrs.asset_identifier.trim().replace(/\s+/g, ' ');
      if (!type || !identifier || identifier.length > 500) throw new Error('HackerOne returned an invalid scope identifier.');
      scopes.push(`${type} | ${identifier} | submission:${attrs.eligible_for_submission} | bounty:${attrs.eligible_for_bounty}`);
    }
    if (link) {
      if (typeof link !== 'string') throw new Error('HackerOne returned an invalid scope-pagination link.');
      next = new URL(link, url);
      if (next.origin !== new URL(HACKERONE_API).origin || next.pathname !== new URL(pageBase).pathname) {
        throw new Error('HackerOne scope pagination left the program API.');
      }
      linkedPages = true;
    } else if (linkedPages) {
      complete = true;
      break;
    } else {
      next = null;
    }
  }
  if (!complete) throw new Error('HackerOne scope pagination did not finish.');
  return { url: 'https://hackerone.com/vercel', fetchedAt: new Date().toISOString(), scopes: [...new Set(scopes)].sort() };
}

function token(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for the live check.`);
  return value;
}

async function projectRead({ baseUrl, projectId, actor, bearer, teamId }) {
  const headers = { Accept: 'application/json' };
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  const url = new URL(`${baseUrl}/v9/projects/${encodeURIComponent(projectId)}`);
  if (teamId) url.searchParams.set('teamId', teamId);
  let response;
  try { response = await fetch(url, { method: 'GET', headers, redirect: 'error', signal: AbortSignal.timeout(10000) }); }
  catch { return { actor, status: 0, ownerMarkerPresent: false, detail: 'Request failed before an HTTP response.' }; }
  let body = {};
  try { body = await response.json(); } catch { /* A denial may have no JSON body. */ }
  const ownerMarkerPresent = body?.id === projectId;
  return {
    actor, status: response.status, ownerMarkerPresent,
    detail: ownerMarkerPresent ? 'The response contained the owner project ID.' : 'The owner project ID was absent.',
  };
}

async function verifyLiveAccounts(ownerToken, otherToken) {
  const identity = (bearer, label) => jsonFetch(`${VERCEL_API}/v2/user`, {
    headers: { Authorization: `Bearer ${bearer}`, Accept: 'application/json' }, redirect: 'error',
  }, label);
  const [owner, other] = await Promise.all([
    identity(ownerToken, 'Vercel owner identity'), identity(otherToken, 'Vercel other-account identity'),
  ]);
  const ownerUser = owner?.user;
  const otherUser = other?.user;
  if (![ownerUser, otherUser].every((user) => typeof user?.id === 'string' && user.id && typeof user.email === 'string')) {
    throw new Error('Vercel identity lookup must return a user ID and email for both accounts.');
  }
  if (ownerUser.id === otherUser.id) throw new Error('The Vercel tokens must belong to two different user accounts.');

  const handle = token('HACKERONE_API_USERNAME').toLowerCase();
  const isHackerAlias = (email) => {
    const parts = email.toLowerCase().split('@');
    const local = parts[0];
    return parts.length === 2 && parts[1] === 'wearehackerone.com' &&
      (local === handle || (local.startsWith(`${handle}+`) && local.length > handle.length + 1));
  };
  if (![ownerUser, otherUser].every((user) => isHackerAlias(user.email))) {
    throw new Error('Both Vercel test accounts must show this researcher’s HackerOne email alias.');
  }
}

export async function probeProject(mode, port) {
  const live = mode === 'live';
  if (!live && mode !== 'lab') throw new Error('Choose lab or live mode.');
  const projectId = live ? token('VERCEL_PROJECT_ID') : 'prj_proofrun_lab';
  if (live && !/^prj_[A-Za-z0-9]+$/.test(projectId)) throw new Error('VERCEL_PROJECT_ID must be a project ID beginning with prj_.');
  const ownerToken = live ? token('VERCEL_OWNER_TOKEN') : 'lab-owner';
  const otherToken = live ? token('VERCEL_OTHER_TOKEN') : 'lab-other';
  if (live && ownerToken === otherToken) throw new Error('The owner and other-account Vercel tokens must be different.');
  const teamId = live ? process.env.VERCEL_TEAM_ID : '';
  if (teamId && !/^team_[A-Za-z0-9]+$/.test(teamId)) throw new Error('VERCEL_TEAM_ID must be a team ID beginning with team_.');
  const baseUrl = live ? VERCEL_API : `http://127.0.0.1:${port}/lab`;
  if (live) await verifyLiveAccounts(ownerToken, otherToken);
  const owner = await projectRead({ baseUrl, projectId, actor: 'owner', bearer: ownerToken, teamId });
  if (owner.status !== 200 || !owner.ownerMarkerPresent) {
    return [owner, { actor: 'other', status: 0, ownerMarkerPresent: false, detail: 'Skipped because the owner control failed.' }];
  }
  if (live) await new Promise((resolve) => setTimeout(resolve, 300));
  const other = await projectRead({ baseUrl, projectId, actor: 'other', bearer: otherToken, teamId });
  if (other.ownerMarkerPresent) return [owner, other]; // One confirmation is enough.
  if (live) await new Promise((resolve) => setTimeout(resolve, 300));
  const anonymous = await projectRead({ baseUrl, projectId, actor: 'anonymous', teamId });
  return [owner, other, anonymous];
}

export function draftReport({ mode, verdict, checks }) {
  if (verdict !== 'candidate') return null;
  const owner = checks.find((item) => item.actor === 'owner');
  const other = checks.find((item) => item.actor === 'other');
  const lab = mode === 'lab';
  return {
    title: lab ? '[LAB ONLY] Cross-account project read in training service' : 'Potential cross-account access to a private Vercel project',
    vulnerability_information: [
      lab ? 'This is a local training service. Do not submit this text to HackerOne.' : 'Researcher-owned Vercel accounts A and B were used for this check.',
      '1. Account A creates a private project and records its project ID.',
      `2. A GET /v9/projects/{idOrName} request with account A returned HTTP ${owner?.status}; the project ID matched: ${owner?.ownerMarkerPresent}.`,
      `3. The same request with account B returned HTTP ${other?.status}; the project ID matched: ${other?.ownerMarkerPresent}.`,
      'Human verification still required: repeat the observation, confirm account B is not a member of account A’s team, identify private fields and real impact, and attach an unedited screenshot or video of the full reproduction path.',
    ].join('\n'),
    impact: lab ? 'Local lab exercise only; no live impact.' : 'Potential unauthorized access to private project metadata. Specify the exact private fields and real impact after manual validation.',
    severity_rating: '',
  };
}

export function validateSubmission({ run, humanValidated, validationNote, reportDraft, idVerified }) {
  if (!run || run.mode !== 'live' || run.verdict !== 'candidate') throw new Error('Only a live candidate can be submitted.');
  if (!idVerified) throw new Error('HackerOne ID verification must be confirmed before submission.');
  if (humanValidated !== true || typeof validationNote !== 'string' || validationNote.trim().length < 40) {
    throw new Error('Describe your independent reproduction before submission.');
  }
  const { title, vulnerability_information: info, impact, severity_rating: severity } = reportDraft || {};
  if (![title, info, impact].every((value) => typeof value === 'string' && value.trim().length >= 20)) {
    throw new Error('Complete the report title, proof of concept, and impact.');
  }
  if (!['low', 'medium', 'high', 'critical'].includes(severity)) throw new Error('Choose a justified severity.');
  if (/human verification still required|potential unauthorized access|local lab exercise|do not submit/i.test(`${title}\n${info}\n${impact}`)) {
    throw new Error('Replace provisional language with the personally verified finding and impact.');
  }
  return { title: title.trim(), vulnerability_information: info.trim(), impact: impact.trim(), severity_rating: severity };
}

export async function submitToHackerOne() {
  throw new Error('ProofRun cannot attach Vercel’s required screenshot or video through the documented direct HackerOne report API. Complete the reviewed draft and attach the media in HackerOne.');
}
