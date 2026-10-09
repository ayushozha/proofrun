// Sponsor adapters exchange only normalized metadata. Tokens, raw responses,
// project IDs, and confidential program policy never leave the local worker.

const AKASH_BASE = 'https://api.akashml.com/v1';
const GUILD_BASE = 'https://api.guild.ai/v1';
const TABLE = 'proofrun_checks';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required for this sponsor integration`);
  return value;
}

function endpoint(base, path) {
  const root = new URL(base);
  const url = new URL(path || '', `${root.origin}${root.pathname.replace(/\/?$/, '/')}`);
  if (!path) url.search = root.search;
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('Sponsor API URL must use HTTPS');
  }
  return url;
}

async function request(url, options, sponsor, timeout = 20000) {
  let response;
  try {
    response = await fetch(url, { ...options, signal: AbortSignal.timeout(timeout) });
  } catch (error) {
    throw new Error(`${sponsor} request failed: ${error.name === 'TimeoutError' ? 'timeout' : 'network error'}`);
  }
  if (!response.ok) throw new Error(`${sponsor} returned HTTP ${response.status}`);
  return response;
}

export function sponsorStatus() {
  const akashml = Boolean(process.env.AKASHML_API_KEY && process.env.AKASHML_MODEL);
  const clickhouse = Boolean(process.env.CLICKHOUSE_URL && process.env.CLICKHOUSE_USER && process.env.CLICKHOUSE_PASSWORD);
  const guild = Boolean(process.env.GUILD_API_KEY && process.env.GUILD_WORKSPACE && process.env.GUILD_AGENT_ID);
  return { akashml, clickhouse, guild, ready: akashml && clickhouse && guild };
}

/** Ask real AkashML inference to select only the approved project-access check or stop. */
export async function planWithAkash(input) {
  const key = required('AKASHML_API_KEY');
  const model = required('AKASHML_MODEL');
  const programHandle = input?.programHandle === 'vercel' ? 'vercel' : 'unsupported';
  const scopeApproved = input?.scopeApproved === true;
  const url = endpoint(process.env.AKASHML_BASE_URL || AKASH_BASE, 'chat/completions');
  const prompt = { programHandle, scopeApproved, requestedCheck: 'project_access' };
  const response = await request(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 160,
      messages: [
        { role: 'system', content: 'You are a bounded security-test planner. Return only JSON: {"check":"project_access"|"stop","rationale":"one short sentence"}. Choose project_access only when programHandle is vercel AND scopeApproved is true. No other checks, commands, hosts, endpoints, or secrets.' },
        { role: 'user', content: JSON.stringify(prompt) },
      ],
    }),
  }, 'AkashML');
  const body = await response.json();
  let plan;
  try {
    const content = body?.choices?.[0]?.message?.content;
    plan = JSON.parse(content);
  } catch {
    throw new Error('AkashML returned an invalid plan');
  }
  if (!['project_access', 'stop'].includes(plan?.check)) throw new Error('AkashML returned a disallowed check');
  if (plan.check === 'project_access' && (!scopeApproved || programHandle !== 'vercel')) {
    throw new Error('AkashML plan failed the local scope gate');
  }
  return { check: plan.check, rationale: String(plan.rationale || '').slice(0, 240) };
}

/** Explain only normalized observations; this is a review note, never proof of impact. */
export async function explainWithAkash({ verdict, checks }) {
  if (!['candidate', 'expected', 'inconclusive'].includes(verdict)) throw new Error('Invalid verdict');
  const observations = normalizedChecks(checks);
  const key = required('AKASHML_API_KEY');
  const model = required('AKASHML_MODEL');
  const url = endpoint(process.env.AKASHML_BASE_URL || AKASH_BASE, 'chat/completions');
  const response = await request(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      temperature: 0,
      max_tokens: 320,
      messages: [
        { role: 'system', content: 'Explain an owned-account authorization check for human review. Return ONLY JSON with exactly {"summary":string,"validationQuestions":string[]}. Summary: one short sentence about the provided HTTP statuses and owner-marker booleans. Questions: 1-3 brief checks a human should perform. Treat candidate as unconfirmed. Do not claim a vulnerability, impact, data exposure, severity, or root cause. Do not invent access rights, response content, URLs, tokens, commands, or facts beyond the input.' },
        { role: 'user', content: JSON.stringify({ verdict, checks: observations }) },
      ],
    }),
  }, 'AkashML');
  let explanation;
  try { explanation = JSON.parse((await response.json())?.choices?.[0]?.message?.content); }
  catch { throw new Error('AkashML returned an invalid explanation'); }
  if (!explanation || Object.keys(explanation).sort().join(',') !== 'summary,validationQuestions'
    || typeof explanation.summary !== 'string' || !Array.isArray(explanation.validationQuestions)
    || explanation.summary.trim().length < 20 || explanation.summary.trim().length > 400
    || explanation.validationQuestions.length < 1 || explanation.validationQuestions.length > 3
    || !explanation.validationQuestions.every((question) => typeof question === 'string' && question.trim().length >= 8 && question.trim().length <= 180)) {
    throw new Error('AkashML explanation failed the format gate');
  }
  const prose = [explanation.summary, ...explanation.validationQuestions].join(' ');
  if (/https?:\/\/|\b(?:exfiltrat\w*|breach|critical|confirmed|exploited|vulnerability)\b|data exposure/i.test(prose)) {
    throw new Error('AkashML explanation made an unsupported claim');
  }
  const statuses = new Set(observations.map(({ status }) => String(status)));
  if ([...prose.matchAll(/\b[1-5][0-9]{2}\b/g)].some(([status]) => !statuses.has(status))) {
    throw new Error('AkashML explanation invented an HTTP status');
  }
  return { summary: explanation.summary.trim(), validationQuestions: explanation.validationQuestions.map((question) => question.trim()) };
}

function normalizedChecks(checks) {
  if (!Array.isArray(checks) || checks.length < 2 || checks.length > 12) {
    throw new Error('Expected 2 to 12 normalized checks');
  }
  const safe = checks.map(({ actor, status, ownerMarkerPresent }) => {
    if (!['owner', 'other', 'anonymous'].includes(actor)) throw new Error('Invalid check actor');
    if (!Number.isInteger(status) || status < 0 || status > 599) throw new Error('Invalid HTTP status');
    if (typeof ownerMarkerPresent !== 'boolean') throw new Error('Invalid marker result');
    return { actor, status, ownerMarkerPresent };
  });
  if (!safe.some(({ actor }) => actor === 'owner') || !safe.some(({ actor }) => actor === 'other')) {
    throw new Error('Owner and other-account checks are required');
  }
  return safe;
}

function normalizedRun(run) {
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(run?.id || '')) throw new Error('Invalid run ID');
  if (run?.programHandle !== 'vercel') throw new Error('Unsupported program');
  if (!['lab', 'live'].includes(run?.mode)) throw new Error('Invalid run mode');
  return normalizedChecks(run.checks).map(({ actor, status, ownerMarkerPresent }) => ({
    run_id: run.id, program: 'vercel', mode: run.mode, actor, status, owner_marker: Number(ownerMarkerPresent),
  }));
}

async function clickhouse(sql, data) {
  const url = endpoint(required('CLICKHOUSE_URL'), '');
  const user = required('CLICKHOUSE_USER');
  const password = required('CLICKHOUSE_PASSWORD');
  const auth = Buffer.from(`${user}:${password}`).toString('base64');
  if (data) url.searchParams.set('query', sql);
  const response = await request(url, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'text/plain; charset=utf-8' },
    body: data || sql,
  }, 'ClickHouse');
  return response.text();
}

/** Persist sanitized comparisons and query the verdict from ClickHouse. */
export async function recordWithClickHouse(run) {
  const checks = normalizedRun(run);
  await clickhouse(`CREATE TABLE IF NOT EXISTS ${TABLE} (
    run_id String, program LowCardinality(String), mode LowCardinality(String), actor LowCardinality(String),
    status UInt16, owner_marker UInt8, created_at DateTime64(3) DEFAULT now64(3)
  ) ENGINE = MergeTree ORDER BY (mode, run_id, actor, created_at)`);
  await clickhouse(`INSERT INTO ${TABLE} FORMAT JSONEachRow`, checks.map((check) => JSON.stringify(check)).join('\n'));
  const safeId = checks[0].run_id.replace(/'/g, "''");
  const queryStarted = performance.now();
  const raw = await clickhouse(`SELECT
    countIf(actor = 'owner' AND status >= 200 AND status < 300 AND owner_marker = 1) AS owner_read,
    countIf(actor = 'other' AND status >= 200 AND status < 300 AND owner_marker = 1) AS other_read,
    countIf(actor = 'other' AND status IN (401, 403, 404)) AS other_denied,
    countIf(actor = 'anonymous' AND status IN (401, 403, 404)) AS anonymous_denied
    FROM ${TABLE} WHERE mode = '${run.mode}' AND run_id = '${safeId}' FORMAT JSONEachRow`);
  let metrics;
  try { metrics = JSON.parse(raw.trim()); } catch { throw new Error('ClickHouse returned an invalid comparison'); }
  const counts = Object.fromEntries(['owner_read', 'other_read', 'other_denied', 'anonymous_denied']
    .map((name) => [name, Number(metrics[name] || 0)]));
  const verdict = counts.owner_read && counts.other_read ? 'candidate'
    : counts.owner_read && counts.other_denied && counts.anonymous_denied ? 'expected'
    : 'inconclusive';
  return { verdict, metrics: counts, recorded: checks.length, queryLatencyMs: Math.round(performance.now() - queryStarted) };
}

function guildPayload(phase, data) {
  if (!['start', 'complete'].includes(phase)) throw new Error('Invalid Guild phase');
  if (!/^[a-zA-Z0-9_-]{8,80}$/.test(data?.id || '')) throw new Error('Invalid run ID');
  if (data?.programHandle !== 'vercel') throw new Error('Unsupported program');
  if (phase === 'start') return { phase, id: data.id, programHandle: 'vercel', scopeApproved: data.scopeApproved === true, check: 'project_access' };
  if (!['candidate', 'expected', 'inconclusive'].includes(data?.verdict)) throw new Error('Invalid verdict');
  return { phase, id: data.id, programHandle: 'vercel', verdict: data.verdict };
}

/** Run the published Guild gate agent, wait for its reply, and enforce its decision. */
export async function runOnGuild(phase, data) {
  const payload = guildPayload(phase, data);
  const key = required('GUILD_API_KEY');
  const workspace = encodeURIComponent(required('GUILD_WORKSPACE'));
  const agentId = required('GUILD_AGENT_ID');
  const base = process.env.GUILD_API_BASE_URL || GUILD_BASE;
  const headers = { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' };
  const started = await request(endpoint(base, `workspaces/${workspace}/sessions`), {
    method: 'POST', headers,
    body: JSON.stringify({ session_type: 'chat', agent_id: agentId, initial_prompt: JSON.stringify(payload) }),
  }, 'Guild');
  const session = await started.json();
  if (!/^[a-f0-9-]{36}$/i.test(session?.id || '')) throw new Error('Guild returned an invalid session ID');
  const deadline = Date.now() + 45000;
  while (Date.now() < deadline) {
    const events = await request(endpoint(base, `sessions/${encodeURIComponent(session.id)}/events?limit=100`), { headers }, 'Guild');
    const body = await events.json();
    const text = body?.items?.find((event) => event.type === 'runtime_done' && typeof event.content?.text === 'string')?.content.text?.trim();
    if (text) {
      let decision;
      try { decision = JSON.parse(text); } catch { throw new Error('Guild returned an invalid decision'); }
      if (phase === 'start') {
        if (typeof decision?.allow !== 'boolean' || !['project_access', 'stop'].includes(decision?.decision)) {
          throw new Error('Guild returned an invalid start decision');
        }
        if (decision.allow && decision.decision !== 'project_access') throw new Error('Guild returned an inconsistent start decision');
      } else if (decision?.allow !== true || decision?.decision !== 'recorded' || decision?.verdict !== payload.verdict) {
        throw new Error('Guild did not acknowledge the completion verdict');
      }
      return { allow: decision.allow, sessionId: session.id, text, decision: decision.decision };
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new Error('Guild agent did not respond before timeout');
}

export function notifyGuild(event) {
  return runOnGuild('complete', event);
}
