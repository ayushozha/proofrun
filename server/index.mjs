import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sponsorStatus, planWithAkash, explainWithAkash, recordWithClickHouse, runOnGuild, notifyGuild } from './sponsors.mjs';
import { parseProgramUrl, captureIsUsable, fetchProgramScope, probeProject, draftReport, validateSubmission, submitToHackerOne } from './core.mjs';

const root = new URL('../', import.meta.url);
const envPath = fileURLToPath(new URL('.env', root));
if (process.env.PROOFRUN_SKIP_ENV_FILE !== '1' && existsSync(envPath)) process.loadEnvFile(envPath);
const port = Number(process.env.PORT || 8787);
const origin = `http://127.0.0.1:${port}`;
const runs = new Map();
let capture = null;
let intake = null;

function json(response, status, body, extra = {}) {
  response.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...extra });
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  let raw = '';
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 100000) throw new Error('Request body is too large.');
  }
  try { return JSON.parse(raw || '{}'); }
  catch { throw new Error('Request body must be valid JSON.'); }
}

function postOriginAllowed(request, path) {
  const incoming = request.headers.origin;
  if (!incoming) return true;
  if (incoming === origin) return true;
  return path === '/api/capture' && /^chrome-extension:\/\/[a-z]{32}$/.test(incoming);
}

function captureHeaders(request, path) {
  const incoming = request.headers.origin;
  return path === '/api/capture' && incoming && postOriginAllowed(request, path)
    ? { 'Access-Control-Allow-Origin': incoming, 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type', Vary: 'Origin' }
    : {};
}

function status() {
  const sponsors = sponsorStatus();
  return {
    sponsors: { guild: sponsors.guild, akash: sponsors.akashml, clickhouse: sponsors.clickhouse },
    hackerone: {
      apiConfigured: Boolean(process.env.HACKERONE_API_USERNAME && process.env.HACKERONE_API_TOKEN),
      idVerified: process.env.HACKERONE_ID_VERIFIED === 'true',
    },
    vercel: { configured: Boolean(process.env.VERCEL_PROJECT_ID && process.env.VERCEL_OWNER_TOKEN && process.env.VERCEL_OTHER_TOKEN) },
    captureReady: captureIsUsable(capture),
  };
}

async function handleIntake(body) {
  const programUrl = parseProgramUrl(body.url);
  const browserReady = capture?.programUrl === programUrl && captureIsUsable(capture);
  const apiReady = status().hackerone.apiConfigured;
  if (!browserReady && !apiReady) {
    throw new Error('Open the Vercel HackerOne page in your signed-in browser, use the ProofRun extension, then capture the program here.');
  }
  let scope = null;
  let apiError = null;
  if (apiReady) {
    try { scope = await fetchProgramScope(); }
    catch (error) { apiError = error.message; }
  }
  if (!browserReady && !scope) throw new Error(apiError || 'HackerOne scope lookup failed.');
  intake = { programUrl, browserReady, scope, createdAt: Date.now() };
  return {
    program: { handle: 'vercel', name: 'Vercel' },
    policy: {
      asset: 'Vercel REST API — researcher-owned projects only',
      rules: [
        'Use two accounts you own for cross-account tests.',
        'Only the project-read check is enabled.',
        'At most 5 requests per second; stop after one confirmation.',
        ...(scope?.instruction ? [`Selected asset instruction: ${scope.instruction}`] : []),
        'Report only a personally verified finding with real impact.',
      ],
    },
    scope: scope ? [{ asset_identifier: scope.identifier, eligible_for_submission: true }] : ['Vercel REST API (browser policy; API scope not confirmed)'],
    source: browserReady ? 'browser' : 'hackerone_api',
    limitations: [
      ...(!browserReady ? ['The signed-in browser policy has not been captured. Live mode is blocked.'] : []),
      ...(!scope ? ['The structured scope is not confirmed through HackerOne API. Live mode is blocked.'] : []),
      ...(apiError ? [apiError] : []),
    ],
  };
}

async function handleRun(body) {
  if (!intake) throw new Error('Capture and review the program first.');
  if (Date.now() - intake.createdAt > 30 * 60 * 1000) throw new Error('Program intake expired. Capture the current scope again.');
  const mode = body.mode;
  if (!['lab', 'live'].includes(mode)) throw new Error('Choose lab or live mode.');
  if (!sponsorStatus().ready) throw new Error('Guild, AkashML, and ClickHouse must all be configured before a run.');
  if (mode === 'live') {
    if (!intake.browserReady || !intake.scope) throw new Error('A live run requires signed-in browser capture and HackerOne structured scope.');
    if (!Object.values(intake.scope.policyChecks).every(Boolean)) throw new Error('Current HackerOne policy did not confirm every live-test boundary.');
    if (!status().vercel.configured) throw new Error('Configure both researcher-owned Vercel accounts and a project ID.');
  }

  const id = randomUUID();
  const sponsorTrace = [];
  const scopeApproved = mode === 'lab' || Boolean(intake.browserReady && intake.scope);
  const guild = await runOnGuild('start', { id, programHandle: 'vercel', scopeApproved });
  sponsorTrace.push({ tool: 'Guild', status: guild.allow ? 'approved' : 'stopped', detail: `Policy gate session ${guild.sessionId}` });
  if (!guild.allow) throw new Error('Guild declined this bounded check.');

  const plan = await planWithAkash({ programHandle: 'vercel', scopeApproved });
  sponsorTrace.push({ tool: 'AkashML', status: plan.check === 'project_access' ? 'selected' : 'stopped', detail: plan.rationale });
  if (plan.check !== 'project_access') throw new Error('AkashML did not select the approved project-access check.');

  const checks = await probeProject(mode, port);
  const analysis = await recordWithClickHouse({ id, programHandle: 'vercel', checks });
  sponsorTrace.push({ tool: 'ClickHouse', status: 'queried', detail: `${analysis.recorded} normalized observations; verdict ${analysis.verdict}; query ${analysis.queryLatencyMs} ms` });
  const reviewNote = await explainWithAkash({ verdict: analysis.verdict, checks });
  sponsorTrace.push({ tool: 'AkashML', status: 'explained', detail: 'Produced bounded questions for human review.' });
  await notifyGuild({ id, programHandle: 'vercel', verdict: analysis.verdict });
  sponsorTrace.push({ tool: 'Guild', status: 'acknowledged', detail: 'Completed run recorded by the agent.' });

  const reportDraft = draftReport({ mode, verdict: analysis.verdict, checks });
  const run = {
    id, mode, verdict: analysis.verdict, evidence: checks, sponsorTrace, reportDraft, reviewNote, queryLatencyMs: analysis.queryLatencyMs,
    submissionEligible: false, // Vercel requires in-report media; direct HackerOne API upload is unverified.
    scopeId: intake.scope?.id, submitted: false,
  };
  runs.set(id, run);
  return { id, mode, verdict: run.verdict, evidence: checks, sponsorTrace, reportDraft, reviewNote, queryLatencyMs: run.queryLatencyMs, submissionEligible: run.submissionEligible };
}

async function handleSubmit(body) {
  const run = runs.get(body.runId);
  if (!run || run.submitted) throw new Error('This run is unavailable or already submitted.');
  const report = validateSubmission({ ...body, run, idVerified: status().hackerone.idVerified });
  if (!run.scopeId) throw new Error('No confirmed HackerOne structured scope is available.');
  const submitted = await submitToHackerOne(report, run.scopeId);
  run.submitted = true;
  return submitted;
}

const staticFiles = {
  '/': ['index.html', 'text/html; charset=utf-8'],
  '/app.js': ['app.js', 'text/javascript; charset=utf-8'],
  '/styles.css': ['styles.css', 'text/css; charset=utf-8'],
};

const server = http.createServer(async (request, response) => {
  const path = new URL(request.url, origin).pathname;
  const cors = captureHeaders(request, path);
  if (request.method === 'OPTIONS' && path === '/api/capture') {
    response.writeHead(postOriginAllowed(request, path) ? 204 : 403, cors);
    return response.end();
  }
  if (request.method === 'POST' && !postOriginAllowed(request, path)) return json(response, 403, { error: 'This origin is not allowed.' });
  try {
    if (request.method === 'GET' && path === '/api/status') return json(response, 200, status());
    if (request.method === 'POST' && path === '/api/capture') {
      const body = await readJson(request);
      const programUrl = parseProgramUrl(body.programUrl);
      const incoming = { programUrl, visibleText: body.visibleText, capturedAt: body.capturedAt };
      if (typeof incoming.visibleText !== 'string' || incoming.visibleText.length > 40000 || !captureIsUsable(incoming)) {
        throw new Error('The captured page is incomplete or does not show the required Vercel testing rules.');
      }
      capture = incoming; // Kept in memory; never sent to sponsor services.
      return json(response, 200, { captured: true, programUrl }, cors);
    }
    if (request.method === 'POST' && path === '/api/intake') return json(response, 200, await handleIntake(await readJson(request)));
    if (request.method === 'POST' && path === '/api/run') return json(response, 200, await handleRun(await readJson(request)));
    if (request.method === 'POST' && path === '/api/submit') return json(response, 200, await handleSubmit(await readJson(request)));
    if (request.method === 'GET' && path === '/lab/v9/projects/prj_proofrun_lab') {
      return json(response, 200, { id: 'prj_proofrun_lab', name: 'proofrun-local-lab', lab: true });
    }
    if (request.method === 'GET' && staticFiles[path]) {
      const [filename, type] = staticFiles[path];
      const file = await readFile(new URL(`../public/${filename}`, import.meta.url));
      response.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      return response.end(file);
    }
    return json(response, 404, { error: 'Not found.' });
  } catch (error) {
    return json(response, 400, { error: error.message || 'Request failed.' }, cors);
  }
});

server.listen(port, '127.0.0.1', () => console.log(`ProofRun at ${origin}`));
