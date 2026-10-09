import { randomBytes } from 'node:crypto';

const cases = new Map();

const secret = () => randomBytes(18).toString('hex');

export function createTrainingCase(scenario) {
  if (!['exposed', 'patched'].includes(scenario)) throw new Error('Invalid training scenario.');
  const trainingCase = { id: secret(), ownerToken: secret(), otherToken: secret() };
  cases.set(trainingCase.id, { ...trainingCase, scenario, privateSentinel: secret() });
  return trainingCase;
}

export function disposeTrainingCase(id) {
  cases.delete(id);
}

/** An owned, loopback-only HTTP target. The sentinel is never part of the URL. */
export function handleTrainingRequest(request, response, path) {
  if (!path.startsWith('/training/')) return false;
  const match = /^\/training\/projects\/([a-f0-9]{36})$/.exec(path);
  const trainingCase = match && cases.get(match[1]);
  let status = 404;
  let body = { error: 'Training case not found.' };
  if (request.method !== 'GET') {
    status = 405;
    body = { error: 'Only GET is allowed.' };
  } else if (trainingCase) {
    const authorization = request.headers.authorization;
    const owner = authorization === `Bearer ${trainingCase.ownerToken}`;
    const other = authorization === `Bearer ${trainingCase.otherToken}`;
    if (owner || (other && trainingCase.scenario === 'exposed')) {
      status = 200;
      body = { id: trainingCase.id, privateSentinel: trainingCase.privateSentinel };
    } else {
      status = 403;
      body = { error: 'Private project access denied.' };
    }
  }
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
  });
  response.end(JSON.stringify(body));
  return true;
}
