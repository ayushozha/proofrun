const HACKERONE_API = 'https://api.hackerone.com/v1/hackers';
const VERCEL_API = 'https://api.vercel.com';

export function parseProgramUrl(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Enter a HackerOne program URL.'); }
  if (url.protocol !== 'https:' || url.hostname !== 'hackerone.com' || !/^\/vercel\/?$/.test(url.pathname)) {
    throw new Error('This prototype supports only the Vercel HackerOne program.');
  }
  return 'https://hackerone.com/vercel';
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
  const attributes = program?.data?.attributes || {};
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

function token(name) {
  const value = process.env[name];
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

export async function probeProject(mode, port) {
  const live = mode === 'live';
  if (!live && mode !== 'lab') throw new Error('Choose lab or live mode.');
  const projectId = live ? token('VERCEL_PROJECT_ID') : 'prj_proofrun_lab';
  if (live && !/^prj_[A-Za-z0-9]+$/.test(projectId)) throw new Error('VERCEL_PROJECT_ID must be a project ID beginning with prj_.');
  const teamId = live ? process.env.VERCEL_TEAM_ID : '';
  if (teamId && !/^team_[A-Za-z0-9]+$/.test(teamId)) throw new Error('VERCEL_TEAM_ID must be a team ID beginning with team_.');
  const baseUrl = live ? VERCEL_API : `http://127.0.0.1:${port}/lab`;
  const owner = await projectRead({ baseUrl, projectId, actor: 'owner', bearer: live ? token('VERCEL_OWNER_TOKEN') : 'lab-owner', teamId });
  if (owner.status !== 200 || !owner.ownerMarkerPresent) {
    return [owner, { actor: 'other', status: 0, ownerMarkerPresent: false, detail: 'Skipped because the owner control failed.' }];
  }
  if (live) await new Promise((resolve) => setTimeout(resolve, 300));
  const other = await projectRead({ baseUrl, projectId, actor: 'other', bearer: live ? token('VERCEL_OTHER_TOKEN') : 'lab-other', teamId });
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
