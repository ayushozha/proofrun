import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { probeProject } from '../server/core.mjs';

const stubs = { guildStarts: 0, guildCompletes: 0, akash: 0, clickhouse: 0, senso: 0 };
let returnedPolicyId = 'stub-policy';
const sessions = new Map();
const insertedChecks = [];
const stub = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const body = await new Promise((resolve) => { let value = ''; request.on('data', (part) => value += part); request.on('end', () => resolve(value)); });
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname.endsWith('/chat/completions')) {
    stubs.akash++;
    const explanation = JSON.parse(body).messages[0].content.includes('Explain an owned-account');
    const planInput = explanation ? null : JSON.parse(JSON.parse(body).messages[1].content);
    if (planInput) {
      assert.equal(planInput.mode, 'lab');
      assert.equal(planInput.scopeApproved, false, 'lab must not claim HackerOne scope approval');
    }
    const content = explanation
      ? { summary: 'Owner and other account both returned HTTP 200 with the owner marker.', validationQuestions: ['Which fields are private in the other-account response?'] }
      : { check: planInput.mode === 'lab' && planInput.policySource?.passage ? 'project_access' : 'stop', rationale: 'Approved bounded check.', sourceContentId: planInput.policySource?.contentId };
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  } else if (url.pathname.endsWith('/org/search/context')) {
    stubs.senso++;
    const search = JSON.parse(body);
    assert.deepEqual(search.content_ids, ['stub-policy']);
    assert.equal(search.require_scoped_ids, true);
    assert.equal(request.headers['x-api-key'], 'stub');
    response.end(JSON.stringify({ results: [{
      content_id: returnedPolicyId, version_id: 'stub-version', kb_node_id: 'stub-node',
      title: 'ProofRun bounded verification policy',
      chunk_text: 'Only GET /v9/projects/{idOrName} on researcher-owned Vercel accounts is approved. Respect 5 requests per second.',
    }] }));
  } else if (url.pathname.endsWith('/sessions') && request.method === 'POST') {
    const payload = JSON.parse(JSON.parse(body).initial_prompt);
    const id = randomUUID();
    sessions.set(id, payload);
    if (payload.phase === 'start') {
      assert.equal(payload.mode, 'lab');
      assert.equal(payload.scopeApproved, false, 'lab must not claim HackerOne scope approval');
      stubs.guildStarts++;
    }
    else stubs.guildCompletes++;
    response.end(JSON.stringify({ id }));
  } else if (url.pathname.includes('/sessions/') && url.pathname.endsWith('/events')) {
    assert.equal(url.searchParams.get('types'), 'runtime_done');
    assert.equal(url.searchParams.get('limit'), '1');
    const id = url.pathname.split('/')[3];
    const payload = sessions.get(id);
    const decision = payload?.phase === 'start'
      ? { allow: true, decision: 'project_access' }
      : { allow: true, decision: 'recorded', verdict: payload?.verdict };
    response.end(JSON.stringify({ items: [{ type: 'runtime_done', content: { text: JSON.stringify(decision) } }] }));
  } else if (url.pathname === '/') {
    stubs.clickhouse++;
    if (url.searchParams.get('query')?.startsWith('INSERT INTO')) {
      insertedChecks.push(...body.trim().split('\n').map((row) => JSON.parse(row)));
    }
    response.setHeader('Content-Type', 'text/plain');
    response.end(body.includes('SELECT') ? JSON.stringify({ owner_read: 1, other_read: 1, other_denied: 0, anonymous_denied: 0 }) : '');
  } else {
    response.statusCode = 404;
    response.end('{}');
  }
});
stub.listen(0, '127.0.0.1');
await once(stub, 'listening');
const stubPort = stub.address().port;
const appPort = stubPort + 1;
const app = spawn(process.execPath, ['server/index.mjs'], {
  cwd: new URL('../', import.meta.url),
  env: {
    ...process.env,
    PROOFRUN_SKIP_ENV_FILE: '1', PORT: String(appPort),
    GUILD_API_KEY: 'stub', GUILD_WORKSPACE: 'stub', GUILD_AGENT_ID: 'stub', GUILD_API_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
    AKASHML_API_KEY: 'stub', AKASHML_MODEL: 'configured-by-test', AKASHML_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
    CLICKHOUSE_URL: `http://127.0.0.1:${stubPort}/`, CLICKHOUSE_USER: 'stub', CLICKHOUSE_PASSWORD: 'stub',
    SENSO_API_KEY: 'stub', SENSO_POLICY_CONTENT_ID: 'stub-policy', SENSO_API_BASE_URL: `http://127.0.0.1:${stubPort}/v1`,
    HACKERONE_API_USERNAME: '', HACKERONE_API_TOKEN: '', HACKERONE_ID_VERIFIED: 'false',
    VERCEL_OWNER_TOKEN: '', VERCEL_OTHER_TOKEN: '', VERCEL_PROJECT_ID: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

const base = `http://127.0.0.1:${appPort}`;
async function post(path, data) {
  const response = await fetch(`${base}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(data) });
  return { status: response.status, body: await response.json() };
}

try {
  let ready = false;
  for (let attempt = 0; attempt < 60; attempt++) {
    try { ready = (await fetch(`${base}/api/status`)).ok; if (ready) break; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  assert(ready, 'app server started');
  const previous = ['VERCEL_PROJECT_ID', 'VERCEL_OWNER_TOKEN', 'VERCEL_OTHER_TOKEN', 'HACKERONE_API_USERNAME']
    .map((name) => [name, process.env[name]]);
  const fetchBeforeTokenCheck = globalThis.fetch;
  try {
    process.env.VERCEL_PROJECT_ID = 'prj_sameaccount';
    process.env.HACKERONE_API_USERNAME = 'ayushojha';
    process.env.VERCEL_OWNER_TOKEN = 'same-token';
    process.env.VERCEL_OTHER_TOKEN = 'same-token';
    globalThis.fetch = () => { throw new Error('A duplicate-token check must not make a Vercel request.'); };
    await assert.rejects(probeProject('live', appPort), /tokens must be different/);

    process.env.VERCEL_OWNER_TOKEN = 'owner-token';
    process.env.VERCEL_OTHER_TOKEN = 'other-token';
    let projectReads = 0;
    let otherId = 'owner-id';
    let ownerEmail = 'ayushojha+owner@wearehackerone.com';
    globalThis.fetch = (url, options) => {
      if (String(url).endsWith('/v2/user')) {
        const owner = options.headers.Authorization === 'Bearer owner-token';
        return Promise.resolve(Response.json({ user: {
          id: owner ? 'owner-id' : otherId,
          email: owner ? ownerEmail : 'ayushojha+other@wearehackerone.com',
        } }));
      }
      projectReads++;
      throw new Error('An invalid account pair must not read a Vercel project.');
    };
    await assert.rejects(probeProject('live', appPort), /two different user accounts/);
    assert.equal(projectReads, 0);
    otherId = 'other-id';
    ownerEmail = 'ayushojha+owner@wasmer.io';
    await assert.rejects(probeProject('live', appPort), /HackerOne email alias/);
    assert.equal(projectReads, 0);

    ownerEmail = 'ayushojha+owner@wearehackerone.com';
    globalThis.fetch = (url, options) => {
      if (String(url).endsWith('/v2/user')) {
        const owner = options.headers.Authorization === 'Bearer owner-token';
        return Promise.resolve(Response.json({ user: {
          id: owner ? 'owner-id' : 'other-id',
          email: owner ? ownerEmail : 'ayushojha+other@wearehackerone.com',
        } }));
      }
      projectReads++;
      return Promise.resolve(options.headers.Authorization === 'Bearer owner-token'
        ? Response.json({ id: 'prj_sameaccount' })
        : Response.json({}, { status: 404 }));
    };
    const checks = await probeProject('live', appPort);
    assert.deepEqual(checks.map(({ status }) => status), [200, 404, 404]);
    assert.equal(projectReads, 3);
  } finally {
    globalThis.fetch = fetchBeforeTokenCheck;
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  }
  const invalid = await post('/api/intake', { url: 'https://hackerone.com/other' });
  assert.equal(invalid.status, 400);
  const sample = await post('/api/intake', { url: 'https://hackerone.com/vercel', sampleLab: true });
  assert.equal(sample.status, 200);
  assert.equal(sample.body.source, 'local_sample');
  assert.equal(sample.body.labOnly, true);
  const sampleLive = await post('/api/run', { mode: 'live' });
  assert.equal(sampleLive.status, 400);
  assert.match(sampleLive.body.error, /local sample is lab-only/);
  assert.equal(stubs.guildStarts, 0, 'lab sample must not authorize a live probe');
  const run = await post('/api/run', { mode: 'lab' });
  assert.equal(run.status, 200);
  assert.equal(run.body.verdict, 'candidate');
  assert.equal(run.body.mode, 'lab');
  assert.equal(run.body.submissionEligible, false);
  assert.equal(run.body.evidence.length, 2);
  assert.equal(run.body.sponsorTrace.length, 6);
  assert(run.body.sponsorTrace.some((item) => item.tool === 'Senso' && item.detail.includes('stub-version')));
  assert.equal(run.body.reviewNote.validationQuestions.length, 1);
  assert.equal(typeof run.body.queryLatencyMs, 'number');
  assert.equal(insertedChecks.length, 2);
  assert(insertedChecks.every((check) => check.mode === 'lab' && check.program === 'vercel'));
  const submit = await post('/api/submit', { runId: run.body.id, humanValidated: true });
  assert.equal(submit.status, 400);
  const capture = await post('/api/capture', {
    programUrl: 'https://hackerone.com/vercel', capturedAt: new Date().toISOString(),
    visibleText: 'Vercel REST API. Cross-tenant testing: always use two accounts you own. Scanner rate limits: 5 QPS.',
  });
  assert.equal(capture.status, 200);
  const intake = await post('/api/intake', { url: 'https://hackerone.com/vercel' });
  assert.equal(intake.status, 200);
  assert.equal(intake.body.source, 'browser');
  returnedPolicyId = 'wrong-policy';
  const blocked = await post('/api/run', { mode: 'lab' });
  assert.equal(blocked.status, 400);
  assert.match(blocked.body.error, /Senso did not return a usable passage/);
  assert.equal(insertedChecks.length, 2, 'a mismatched Senso source must stop before probing');
  assert.deepEqual(stubs, { guildStarts: 1, guildCompletes: 1, akash: 2, clickhouse: 3, senso: 2 });
  console.log('Smoke passed: local lab sample, live gate, browser capture, four sponsor HTTP adapters, lab probe, ClickHouse verdict, submission guard.');
} finally {
  app.kill();
  stub.close();
}
