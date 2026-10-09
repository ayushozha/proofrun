import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const envPath = fileURLToPath(new URL('.env', root));
if (existsSync(envPath)) process.loadEnvFile(envPath);

const key = process.env.SENSO_API_KEY?.trim();
if (!key) throw new Error('Set SENSO_API_KEY in the project .env before seeding Senso.');

const base = 'https://apiv2.senso.ai/api/v1/';
const policy = await readFile(new URL('../docs/proofrun-policy.md', import.meta.url), 'utf8');
const query = "What owned-site source audit and one anonymous GET /api/access does ProofRun allow for ayushojha.com?";

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(new URL(path, base), {
      ...options,
      headers: { 'X-API-Key': key, 'Content-Type': 'application/json', ...options.headers },
      signal: AbortSignal.timeout(15000),
    });
  } catch {
    throw new Error('Senso request failed to connect or timed out.');
  }
  if (response.status === 409) throw new Error('Senso already has identical policy text (HTTP 409). Find its existing content ID in your Senso knowledge base; no new document was created.');
  if (response.status === 402) throw new Error('Senso credits are exhausted or the spending limit was reached (HTTP 402). Check your Senso credit balance.');
  if (!response.ok) throw new Error(`Senso returned HTTP ${response.status}.`);
  try { return await response.json(); }
  catch { throw new Error('Senso returned invalid JSON.'); }
}

const created = await request('org/kb/raw', {
  method: 'POST',
  body: JSON.stringify({ title: 'ProofRun bounded verification policy', text: policy }),
});
const contentId = created.id ?? created.content_id;
const nodeId = created.kb_node_id;
if (!contentId || !nodeId) throw new Error('Senso created the policy but did not return its content and node IDs. Find it in the Senso knowledge base.');
console.log(`content_id: ${contentId}`);
console.log(`kb_node_id: ${nodeId}`);

let ready = false;
for (let attempt = 0; attempt < 24; attempt++) {
  if (attempt) await new Promise((resolve) => setTimeout(resolve, 5000));
  const node = await request(`org/kb/nodes/${encodeURIComponent(nodeId)}`);
  const status = node?.content?.processing_status;
  if (status === 'complete') { ready = true; break; }
  if (status === 'failed') throw new Error(`Senso could not process policy node ${nodeId}. Check its status in Senso.`);
}
if (!ready) throw new Error(`Senso policy node ${nodeId} is still processing. Check again before using it.`);
const search = await request('org/search/context', {
  method: 'POST',
  headers: { 'X-Senso-Signals': 'off' },
  body: JSON.stringify({ query, content_ids: [contentId], require_scoped_ids: true, max_results: 3 }),
});
const passage = search?.results?.find((item) => item?.content_id === contentId);
if (!passage?.version_id) throw new Error('Senso processed the policy, but scoped search did not return a version ID. The content ID above is valid; check search before running ProofRun.');
console.log(`version_id: ${passage.version_id}`);
