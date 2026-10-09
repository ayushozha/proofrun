import assert from 'node:assert/strict';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';

const stubs = { guildStarts: 0, guildCompletes: 0, akash: 0, clickhouse: 0 };
const sessions = new Map();
const stub = http.createServer(async (request, response) => {
  const url = new URL(request.url, 'http://127.0.0.1');
  const body = await new Promise((resolve) => { let value = ''; request.on('data', (part) => value += part); request.on('end', () => resolve(value)); });
  response.setHeader('Content-Type', 'application/json');
  if (url.pathname.endsWith('/chat/completions')) {
    stubs.akash++;
    const explanation = JSON.parse(body).messages[0].content.includes('Explain an owned-account');
    const content = explanation
      ? { summary: 'Owner and other account both returned HTTP 200 with the owner marker.', validationQuestions: ['Which fields are private in the other-account response?'] }
      : { check: 'project_access', rationale: 'Approved bounded check.' };
    response.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(content) } }] }));
  } else if (url.pathname.endsWith('/sessions') && request.method === 'POST') {
    const payload = JSON.parse(JSON.parse(body).initial_prompt);
    const id = randomUUID();
    sessions.set(id, payload);
    if (payload.phase === 'start') stubs.guildStarts++;
    else stubs.guildCompletes++;
    response.end(JSON.stringify({ id }));
  } else if (url.pathname.includes('/sessions/') && url.pathname.endsWith('/events')) {
    const id = url.pathname.split('/')[3];
    const payload = sessions.get(id);
    const decision = payload?.phase === 'start'
      ? { allow: true, decision: 'project_access' }
      : { allow: true, decision: 'recorded', verdict: payload?.verdict };
    response.end(JSON.stringify({ items: [{ type: 'runtime_done', content: { text: JSON.stringify(decision) } }] }));
  } else if (url.pathname === '/') {
    stubs.clickhouse++;
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
  const invalid = await post('/api/intake', { url: 'https://hackerone.com/other' });
  assert.equal(invalid.status, 400);
  const capture = await post('/api/capture', {
    programUrl: 'https://hackerone.com/vercel', capturedAt: new Date().toISOString(),
    visibleText: 'Vercel REST API. Cross-tenant testing: always use two accounts you own. Scanner rate limits: 5 QPS.',
  });
  assert.equal(capture.status, 200);
  const intake = await post('/api/intake', { url: 'https://hackerone.com/vercel' });
  assert.equal(intake.status, 200);
  assert.equal(intake.body.source, 'browser');
  const run = await post('/api/run', { mode: 'lab' });
  assert.equal(run.status, 200);
  assert.equal(run.body.verdict, 'candidate');
  assert.equal(run.body.mode, 'lab');
  assert.equal(run.body.submissionEligible, false);
  assert.equal(run.body.evidence.length, 2);
  assert.equal(run.body.sponsorTrace.length, 5);
  assert.equal(run.body.reviewNote.validationQuestions.length, 1);
  assert.equal(typeof run.body.queryLatencyMs, 'number');
  const submit = await post('/api/submit', { runId: run.body.id, humanValidated: true });
  assert.equal(submit.status, 400);
  assert.deepEqual(stubs, { guildStarts: 1, guildCompletes: 1, akash: 2, clickhouse: 3 });
  console.log('Smoke passed: browser capture, scoped intake, three sponsor HTTP adapters, lab probe, ClickHouse verdict, submission guard.');
} finally {
  app.kill();
  stub.close();
}
