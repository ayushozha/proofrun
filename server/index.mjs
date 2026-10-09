import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { sponsorStatus, contextFromSenso, planWithAkash, planWatchWithAkash, planAcronisWithAkash, explainWithAkash, explainWatchWithAkash, explainAcronisWithAkash, prepareClickHouse, prepareAcronisClickHouse, recordWithClickHouse, recordAcronisWithClickHouse, compareWatchWithClickHouse, storeWatchWithClickHouse, runOnGuild, notifyGuild } from './sponsors.mjs';
import { parseProgramUrl, captureIsUsable, fetchProgramScope, fetchProgramScopeSnapshot, fetchAcronisScope, probeProject, probeTrainingCase, probeAcronisSearch, draftReport, validateSubmission, submitToHackerOne } from './core.mjs';
import { createTrainingCase, disposeTrainingCase, handleTrainingRequest } from './training-target.mjs';

const root = new URL('../', import.meta.url);
const envPath = fileURLToPath(new URL('.env', root));
if (process.env.PROOFRUN_SKIP_ENV_FILE !== '1' && existsSync(envPath)) process.loadEnvFile(envPath);
const port = Number(process.env.PORT || 8787);
const origin = `http://127.0.0.1:${port}`;
const runs = new Map();
let capture = null;
let intake = null;
let watchRunning = false;
let runRunning = false;

function browserCaptureReady() {
  return capture?.source === 'browser' && captureIsUsable(capture);
}

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
    sponsors: { guild: sponsors.guild, akash: sponsors.akashml, clickhouse: sponsors.clickhouse, senso: sponsors.senso },
    hackerone: {
      apiConfigured: Boolean(process.env.HACKERONE_API_USERNAME && process.env.HACKERONE_API_TOKEN),
      idVerified: process.env.HACKERONE_ID_VERIFIED === 'true',
    },
    vercel: { configured: Boolean(process.env.VERCEL_PROJECT_ID && process.env.VERCEL_OWNER_TOKEN && process.env.VERCEL_OTHER_TOKEN) },
    captureReady: browserCaptureReady(),
    captureSource: captureIsUsable(capture) ? capture.source : null,
  };
}

async function handleIntake(body) {
  const programUrl = parseProgramUrl(body.url);
  if (programUrl === 'https://hackerone.com/acronis') {
    if (body.sampleLab === true) throw new Error('Acronis has no local sample. Use the current HackerOne API scope for a bounded live check.');
    if (!status().hackerone.apiConfigured) throw new Error('Configure the HackerOne researcher API to confirm current Acronis scope.');
    const scope = await fetchAcronisScope();
    intake = { programHandle: 'acronis', programUrl, scope, createdAt: Date.now() };
    return {
      program: { handle: 'acronis', name: 'Acronis' }, check: 'search_reflection',
      policy: {
        asset: 'www.acronis.com public search',
        rules: [
          'One GET to the fixed /en/search/ path with an inert alphanumeric query marker.',
          'Use the researcher’s HackerOne email alias in the User-Agent and stay below five requests per second.',
          'Reflection alone is not a vulnerability or a reportable finding.',
        ],
      },
      scope: [{ asset_identifier: scope.identifier, eligible_for_submission: true }],
      source: 'hackerone_api', labOnly: false,
      limitations: ['A real target observation can be inconclusive; it does not establish an exploit or justify a report.'],
    };
  }
  if (body.sampleLab === true) {
    intake = { programUrl, browserReady: false, scope: null, labOnly: true, createdAt: Date.now() };
    return {
      program: { handle: 'vercel', name: 'Owned authorization training target' },
      policy: {
        asset: 'Local training service only',
        rules: [
          'Two isolated local identities test a server-held private value.',
          'The exposed case must reveal the value to the other identity; the protected case must deny it.',
          'This controlled validation is not a HackerOne or Vercel finding.',
        ],
      },
      scope: ['Owned loopback training target; exposed and protected cases'],
      source: 'local_sample',
      labOnly: true,
      limitations: ['Live mode requires a fresh signed-in browser capture and HackerOne API scope.', 'This sample can run only against the local lab.'],
    };
  }
  const captureMatches = capture?.programUrl === programUrl && captureIsUsable(capture);
  const browserReady = captureMatches && browserCaptureReady();
  const manualReady = captureMatches && capture.source === 'manual';
  const apiReady = status().hackerone.apiConfigured;
  if (!browserReady && !manualReady && !apiReady) {
    throw new Error('Open the Vercel HackerOne page in your signed-in browser, use the ProofRun extension, then capture the program here.');
  }
  let scope = null;
  let apiError = null;
  if (apiReady) {
    try { scope = await fetchProgramScope(); }
    catch (error) { apiError = error.message; }
  }
  if (!browserReady && !manualReady && !scope) throw new Error(apiError || 'HackerOne scope lookup failed.');
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
    source: browserReady ? 'browser' : manualReady ? 'manual' : 'hackerone_api',
    limitations: [
      ...(!browserReady ? [manualReady
        ? 'Manual policy text is for review only. A signed-in extension capture is required for live mode.'
        : 'The signed-in browser policy has not been captured. Live mode is blocked.'] : []),
      ...(!scope ? ['The structured scope is not confirmed through HackerOne API. Live mode is blocked.'] : []),
      ...(apiError ? [apiError] : []),
    ],
  };
}

async function executeAcronisRun(body) {
  if (body.mode !== 'live') throw new Error('The Acronis public-search check runs only as a bounded live observation.');
  if (!sponsorStatus().ready) throw new Error('Guild, AkashML, ClickHouse, and Senso must all be configured before a run.');
  const scope = await fetchAcronisScope();
  if (JSON.stringify(scope) !== JSON.stringify(intake.scope)) {
    throw new Error('Acronis scope or policy changed since intake. Review the program again.');
  }
  const id = randomUUID();
  const sponsorTrace = [];
  const policyContext = await contextFromSenso('acronis_search');
  sponsorTrace.push({ tool: 'Senso', status: 'retrieved', detail: `Policy source ${policyContext.contentId}, version ${policyContext.versionId}` });
  const guild = await runOnGuild('start', { id, programHandle: 'acronis', mode: 'live', scopeApproved: true, check: 'search_reflection' });
  sponsorTrace.push({ tool: 'Guild', status: guild.allow ? 'approved' : 'stopped', detail: `Public-search gate session ${guild.sessionId}` });
  if (!guild.allow) throw new Error('Guild declined the Acronis public-search check.');
  const plan = await planAcronisWithAkash({ policyContext, scopeApproved: true });
  sponsorTrace.push({ tool: 'AkashML', status: plan.check === 'search_reflection' ? 'selected' : 'stopped', detail: plan.rationale });
  if (plan.check !== 'search_reflection') throw new Error('AkashML did not select the approved public-search check.');
  await prepareAcronisClickHouse();
  const currentScope = await fetchAcronisScope();
  if (JSON.stringify(currentScope) !== JSON.stringify(scope)) {
    throw new Error('Acronis scope or policy changed before the target request. No probe was sent.');
  }
  const observation = await probeAcronisSearch();
  const analysis = await recordAcronisWithClickHouse({ id, evidence: observation });
  if (analysis.verdict !== 'inconclusive') throw new Error('A search-marker observation cannot establish a vulnerability.');
  sponsorTrace.push({ tool: 'ClickHouse', status: 'queried', detail: `${analysis.recorded} normalized observation; verdict inconclusive; query ${analysis.queryLatencyMs} ms` });
  const reviewNote = await explainAcronisWithAkash({ evidence: observation, verdict: 'inconclusive' });
  sponsorTrace.push({ tool: 'AkashML', status: 'explained', detail: 'Produced a bounded observation note; no vulnerability claim.' });
  await notifyGuild({ id, programHandle: 'acronis', mode: 'live', verdict: 'inconclusive' });
  sponsorTrace.push({ tool: 'Guild', status: 'acknowledged', detail: 'Read-only run recorded by the agent.' });
  const run = { id, programHandle: 'acronis', mode: 'live', verdict: 'inconclusive', evidence: [observation],
    sponsorTrace, reportDraft: null, reviewNote, queryLatencyMs: analysis.queryLatencyMs,
    submissionEligible: false, submitted: false };
  runs.set(id, run);
  return run;
}

async function executeRun(body) {
  if (!intake) throw new Error('Capture and review the program first.');
  if (Date.now() - intake.createdAt > 30 * 60 * 1000) throw new Error('Program intake expired. Capture the current scope again.');
  if (intake.programHandle === 'acronis') return executeAcronisRun(body);
  const mode = body.mode;
  if (!['lab', 'live'].includes(mode)) throw new Error('Choose lab or live mode.');
  if (mode === 'live' && intake.labOnly) throw new Error('The local sample is lab-only. Capture the current program and HackerOne API scope before a live run.');
  if (!sponsorStatus().ready) throw new Error('Guild, AkashML, ClickHouse, and Senso must all be configured before a run.');
  if (mode === 'live') {
    if (!intake.browserReady || !intake.scope || capture?.programUrl !== intake.programUrl || !browserCaptureReady()) {
      throw new Error('A live run requires a current signed-in browser capture and HackerOne structured scope.');
    }
    if (!status().vercel.configured) throw new Error('Configure both researcher-owned Vercel accounts and a project ID.');
    const currentScope = await fetchProgramScope();
    if (JSON.stringify(currentScope) !== JSON.stringify(intake.scope)) {
      throw new Error('HackerOne scope or policy changed since intake. Capture and review the program again.');
    }
    if (!Object.values(currentScope.policyChecks).every(Boolean)) throw new Error('Current HackerOne policy did not confirm every live-test boundary.');
  }

  const id = randomUUID();
  const sponsorTrace = [];
  const scopeApproved = mode === 'live' && Boolean(intake.browserReady && intake.scope);
  const policyContext = await contextFromSenso();
  sponsorTrace.push({ tool: 'Senso', status: 'retrieved', detail: `Policy source ${policyContext.contentId}, version ${policyContext.versionId}` });
  const guild = await runOnGuild('start', { id, programHandle: 'vercel', mode, scopeApproved });
  sponsorTrace.push({ tool: 'Guild', status: guild.allow ? 'approved' : 'stopped', detail: `Policy gate session ${guild.sessionId}` });
  if (!guild.allow) throw new Error('Guild declined this bounded check.');

  const plan = await planWithAkash({ programHandle: 'vercel', mode, scopeApproved, policyContext });
  sponsorTrace.push({ tool: 'AkashML', status: plan.check === 'project_access' ? 'selected' : 'stopped', detail: plan.rationale });
  if (plan.check !== 'project_access') throw new Error('AkashML did not select the approved project-access check.');

  await prepareClickHouse();
  let checks;
  let analysis;
  let validation = null;
  if (mode === 'lab') {
    const exposed = createTrainingCase('exposed');
    const patched = createTrainingCase('patched');
    try {
      const exposedChecks = await probeTrainingCase(exposed, port);
      const patchedChecks = await probeTrainingCase(patched, port);
      const exposedAnalysis = await recordWithClickHouse({ id, programHandle: 'vercel', mode, checks: exposedChecks });
      const patchedAnalysis = await recordWithClickHouse({ id: randomUUID(), programHandle: 'vercel', mode, checks: patchedChecks });
      checks = exposedChecks;
      analysis = exposedAnalysis;
      validation = {
        exposed: { verdict: exposedAnalysis.verdict, evidence: exposedChecks },
        patched: { verdict: patchedAnalysis.verdict, evidence: patchedChecks },
        passed: exposedAnalysis.verdict === 'candidate' && patchedAnalysis.verdict === 'expected',
      };
      sponsorTrace.push({ tool: 'ClickHouse', status: 'queried', detail: `Exposed ${exposedAnalysis.verdict}; protected ${patchedAnalysis.verdict}; ${exposedAnalysis.recorded + patchedAnalysis.recorded} normalized observations.` });
    } finally {
      disposeTrainingCase(exposed.id);
      disposeTrainingCase(patched.id);
    }
  } else {
    checks = await probeProject(mode, port);
    analysis = await recordWithClickHouse({ id, programHandle: 'vercel', mode, checks });
    sponsorTrace.push({ tool: 'ClickHouse', status: 'queried', detail: `${analysis.recorded} normalized observations; verdict ${analysis.verdict}; query ${analysis.queryLatencyMs} ms` });
  }
  const verdict = validation && !validation.passed ? 'inconclusive' : analysis.verdict;
  const reviewNote = await explainWithAkash({ verdict, checks });
  sponsorTrace.push({ tool: 'AkashML', status: 'explained', detail: 'Produced bounded questions for human review.' });
  await notifyGuild({ id, programHandle: 'vercel', verdict });
  sponsorTrace.push({ tool: 'Guild', status: 'acknowledged', detail: 'Completed run recorded by the agent.' });

  const reportDraft = mode === 'lab' ? null : draftReport({ mode, verdict, checks });
  const run = {
    id, mode, verdict, evidence: checks, validation, sponsorTrace, reportDraft, reviewNote, queryLatencyMs: analysis.queryLatencyMs,
    submissionEligible: false, // Vercel requires in-report media; direct HackerOne API upload is unverified.
    scopeId: intake.scope?.id, submitted: false,
  };
  runs.set(id, run);
  return { id, mode, verdict: run.verdict, evidence: checks, validation, sponsorTrace, reportDraft, reviewNote, queryLatencyMs: run.queryLatencyMs, submissionEligible: run.submissionEligible };
}

async function handleRun(body) {
  if (runRunning) throw new Error('A bounded check is already in progress.');
  runRunning = true;
  try { return await executeRun(body); }
  finally { runRunning = false; }
}

async function handleWatch(body) {
  if (parseProgramUrl(body.url) !== 'https://hackerone.com/vercel') throw new Error('Policy watch currently supports only Vercel.');
  if (!sponsorStatus().ready || !status().hackerone.apiConfigured) {
    throw new Error('Guild, AkashML, ClickHouse, Senso, and HackerOne API must be configured for policy watch.');
  }
  if (watchRunning) throw new Error('A policy-watch run is already in progress.');
  watchRunning = true;
  try {
    const id = randomUUID();
    const sponsorTrace = [];
    const policyContext = await contextFromSenso('policy_watch');
    sponsorTrace.push({ tool: 'Senso', status: 'retrieved', detail: `Policy source ${policyContext.contentId}, version ${policyContext.versionId}` });
    const guild = await runOnGuild('start', { id, programHandle: 'vercel', mode: 'watch' });
    sponsorTrace.push({ tool: 'Guild', status: guild.allow ? 'approved' : 'stopped', detail: `Read-only gate session ${guild.sessionId}` });
    if (!guild.allow) throw new Error('Guild declined the policy watch.');
    const plan = await planWatchWithAkash(policyContext);
    sponsorTrace.push({ tool: 'AkashML', status: plan.check === 'policy_watch' ? 'selected' : 'stopped', detail: plan.rationale });
    if (plan.check !== 'policy_watch') throw new Error('AkashML did not select the policy watch.');

    const { scopes, ...source } = await fetchProgramScopeSnapshot();
    sponsorTrace.push({ tool: 'HackerOne', status: 'fetched', detail: `${scopes.length} structured scopes fetched from the program API.` });
    const comparison = await compareWatchWithClickHouse({ id, source, scopes });
    sponsorTrace.push({ tool: 'ClickHouse', status: 'queried', detail: `${comparison.status} against stored history; query ${comparison.queryLatencyMs} ms.` });
    const summary = await explainWatchWithAkash({ source, ...comparison });
    sponsorTrace.push({ tool: 'AkashML', status: 'explained', detail: 'Produced a bounded, sourced scope-change alert.' });
    await notifyGuild({ id, programHandle: 'vercel', mode: 'watch', verdict: comparison.status });
    sponsorTrace.push({ tool: 'Guild', status: 'acknowledged', detail: 'Policy-watch outcome recorded by the agent.' });
    await storeWatchWithClickHouse({ id, source, scopes });
    sponsorTrace.push({ tool: 'ClickHouse', status: 'stored', detail: `${scopes.length} normalized scope entries persisted for the next watch.` });
    return { id, mode: 'watch', source, status: comparison.status, scopeCount: comparison.scopeCount,
      added: comparison.added, removed: comparison.removed, summary, sponsorTrace,
      queryLatencyMs: comparison.queryLatencyMs };
  } finally {
    watchRunning = false;
  }
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
      if (programUrl !== 'https://hackerone.com/vercel') throw new Error('Browser capture currently supports only Vercel.');
      const source = /^chrome-extension:\/\/[a-z]{32}$/.test(request.headers.origin || '') ? 'browser' : 'manual';
      const incoming = { programUrl, visibleText: body.visibleText, capturedAt: body.capturedAt, source };
      if (typeof incoming.visibleText !== 'string' || incoming.visibleText.length > 40000 || !captureIsUsable(incoming)) {
        throw new Error('The captured page is incomplete or does not show the required Vercel testing rules.');
      }
      capture = incoming; // Kept in memory; never sent to sponsor services.
      return json(response, 200, { captured: true, programUrl, source, liveEligible: source === 'browser' }, cors);
    }
    if (request.method === 'POST' && path === '/api/intake') return json(response, 200, await handleIntake(await readJson(request)));
    if (request.method === 'POST' && path === '/api/watch') return json(response, 200, await handleWatch(await readJson(request)));
    if (request.method === 'POST' && path === '/api/run') return json(response, 200, await handleRun(await readJson(request)));
    if (request.method === 'POST' && path === '/api/submit') return json(response, 200, await handleSubmit(await readJson(request)));
    if (request.method === 'GET' && handleTrainingRequest(request, response, path)) return;
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
