const $ = (id) => document.getElementById(id);
const state = { status: null, intake: null, run: null, busy: false };

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...options,
    });
  } catch {
    throw new Error('The local ProofRun service is unreachable. Start the server and try again.');
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(body.error || body.message || `${response.status} ${response.statusText}`);
  return body;
}

function setMessage(message, isError = false) {
  const element = $('global-message');
  element.hidden = !message;
  element.textContent = message || '';
  element.classList.toggle('is-error', isError);
}

function setBusy(busy, button, activeLabel) {
  state.busy = busy;
  button.disabled = busy;
  button.textContent = busy ? activeLabel : button.dataset.label;
  $('intake-button').disabled = busy;
  $('sample-button').disabled = busy;
  $('watch-button').disabled = busy;
  updateRunButton();
  updateCopyButton();
}

function connected(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['configured', 'connected', 'ready', 'available'].includes(value.toLowerCase());
  if (value && typeof value === 'object') return Boolean(value.connected ?? value.configured ?? value.ready ?? value.available);
  return false;
}

function renderStatus(data) {
  state.status = data;
  $('connection-state').textContent = 'Local service connected';
  $('connection-state').className = 'connection-pill is-online';
  const sponsors = data.sponsors || {};
  const list = $('sponsor-statuses');
  list.replaceChildren();
  for (const [key, label, role] of [
    ['guild', 'Guild', 'Policy gate'],
    ['akash', 'AkashML', 'Check planning & review'],
    ['clickhouse', 'ClickHouse', 'Evidence analysis'],
    ['senso', 'Senso', 'Pinned policy context'],
  ]) {
    const ready = connected(sponsors[key]);
    const row = document.createElement('li');
    row.className = ready ? 'is-ready' : 'is-missing';
    const name = document.createElement('span');
    name.className = 'sponsor-name';
    const words = document.createElement('span');
    words.className = 'sponsor-label';
    const title = document.createElement('strong');
    title.textContent = label;
    const description = document.createElement('small');
    description.textContent = role;
    words.append(title, description);
    name.append(words);
    const status = document.createElement('span');
    status.className = 'status-text';
    status.textContent = ready ? 'Configured' : 'Not configured';
    row.append(name, status);
    list.append(row);
  }
  $('hackerone-status').textContent = data.hackerone?.apiConfigured ? 'Configured' : 'Not configured';
  $('vercel-status').textContent = data.vercel?.configured ? 'Configured' : 'Not configured';
  $('identity-status').textContent = data.hackerone?.idVerified === true ? 'Verified' : data.hackerone?.idVerified === false ? 'Not verified' : 'Not checked';
  const captured = state.intake?.source === 'browser' || Boolean(data.captureReady);
  $('capture-state').textContent = state.intake?.labOnly ? 'Local sample loaded' : captured ? 'Capture received' : 'Waiting for capture';
  $('capture-state').classList.toggle('is-ready', captured || Boolean(state.intake?.labOnly));
  updateModeNote();
}

function listText(element, items) {
  element.replaceChildren();
  for (const item of items) {
    const li = document.createElement('li');
    li.textContent = typeof item === 'string' ? item : JSON.stringify(item);
    element.append(li);
  }
}

function renderIntake(data) {
  state.intake = data;
  state.run = null;
  $('capture-state').textContent = data.labOnly ? 'Local sample loaded' : data.source === 'browser' ? 'Capture received' : 'Waiting for capture';
  $('capture-state').classList.toggle('is-ready', Boolean(data.labOnly || data.source === 'browser'));
  resetRunDisplay();
  $('program-details').hidden = false;
  $('program-name').textContent = data.program?.name || data.program?.handle || 'Program';
  $('program-source').textContent = data.source === 'browser' ? 'BROWSER CAPTURE' : data.source === 'hackerone_api' ? 'HACKERONE API' : data.source === 'local_sample' ? 'LOCAL SAMPLE · SYNTHETIC' : String(data.source || 'SOURCE UNAVAILABLE').toUpperCase();
  $('source-program-title').textContent = data.labOnly ? 'Local fixture' : 'HackerOne';
  $('source-program').classList.toggle('is-ready', !data.labOnly);
  $('source-program-detail').textContent = data.labOnly ? 'Synthetic local fixture. It is not current HackerOne scope.' : data.source === 'browser' ? 'Signed-in browser capture received; structured scope is checked separately.' : 'Structured API scope received without signed-in browser capture.';
  $('program-asset').textContent = data.policy?.asset || 'No asset specified in captured policy';
  listText($('program-rules'), Array.isArray(data.policy?.rules) ? data.policy.rules : []);
  const scopes = $('scope-list');
  scopes.replaceChildren();
  for (const scope of Array.isArray(data.scope) ? data.scope : []) {
    const chip = document.createElement('span');
    chip.className = 'scope-chip';
    chip.textContent = typeof scope === 'string' ? scope : scope.asset_identifier || scope.asset || scope.name || JSON.stringify(scope);
    scopes.append(chip);
  }
  const limitations = Array.isArray(data.limitations) ? data.limitations : [];
  $('limitations-block').hidden = limitations.length === 0;
  listText($('limitations-list'), limitations);
  if (data.labOnly) $('mode-lab').checked = true;
  updateModeNote();
}

function selectedMode() {
  return document.querySelector('input[name="run-mode"]:checked')?.value || 'lab';
}

function updateModeNote() {
  const mode = selectedMode();
  const readiness = state.status;
  const missing = [['guild', 'Guild'], ['akash', 'AkashML'], ['clickhouse', 'ClickHouse'], ['senso', 'Senso']]
    .filter(([key]) => !connected(readiness?.sponsors?.[key])).map(([, label]) => label);
  let note;
  if (!state.intake) note = 'Capture the signed-in program, or load the local sample for a lab walkthrough.';
  else if (mode === 'live' && state.intake.labOnly) note = `The local sample cannot authorize live testing. Capture the signed-in program.${missing.length ? ` Also configure ${missing.join(', ')} in the local .env.` : ''}`;
  else if (missing.length) note = `Configure ${missing.join(', ')} in the local .env before running.`;
  else if (mode === 'lab') note = 'Lab mode produces synthetic evidence. It cannot establish a bounty finding.';
  else if (state.intake.source !== 'browser' || !readiness?.captureReady) note = 'Live mode requires a current signed-in browser capture.';
  else if (!readiness?.hackerone?.apiConfigured || state.intake.limitations?.some((item) => /live mode is blocked/i.test(item))) note = 'Live mode also needs HackerOne structured scope and confirmed policy checks.';
  else if (!readiness?.vercel?.configured) note = 'Live mode needs two distinct researcher-owned Vercel accounts registered with your HackerOne email aliases, both tokens, and a project ID.';
  else note = 'Ready for one bounded check inside current scope and researcher-owned accounts.';
  $('mode-note').textContent = note;
  updateRunButton();
}

function updateRunButton() {
  const sponsorsReady = ['guild', 'akash', 'clickhouse', 'senso'].every((key) => connected(state.status?.sponsors?.[key]));
  const liveReady = state.intake && !state.intake.labOnly && state.intake.source === 'browser' && state.status?.captureReady &&
    state.status?.hackerone?.apiConfigured && state.status?.vercel?.configured &&
    !state.intake.limitations?.some((item) => /live mode is blocked/i.test(item));
  $('run-button').disabled = state.busy || !state.intake || !sponsorsReady || (selectedMode() === 'live' && !liveReady);
}

function createElement(tag, className, text) {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined && text !== null) element.textContent = String(text);
  return element;
}

function renderWatch(data) {
  $('watch-result').hidden = false;
  const status = ['baseline', 'changed', 'unchanged'].includes(data.status) ? data.status : 'baseline';
  const labels = { baseline: 'BASELINE RECORDED', changed: 'SCOPE CHANGED', unchanged: 'NO CHANGE' };
  $('watch-status').dataset.status = status;
  $('watch-status').textContent = labels[status];
  const headings = { baseline: 'Structured scope baseline saved', changed: 'Structured scope entries changed', unchanged: 'Structured scope unchanged' };
  const heading = $('watch-summary');
  heading.textContent = headings[status];
  let summary = $('watch-summary-detail');
  if (!summary) {
    summary = createElement('p', 'watch-summary-detail');
    summary.id = 'watch-summary-detail';
    heading.after(summary);
  }
  const attribution = ` Source: ${data.source?.url} (fetched ${data.source?.fetchedAt}). No target was tested.`;
  const explanation = data.summary?.endsWith(attribution) ? data.summary.slice(0, -attribution.length) : data.summary;
  summary.textContent = explanation || 'Current HackerOne structured scope was observed.';
  const count = data.scopeCount;
  $('watch-count').textContent = Number.isFinite(count) ? `${count} scope entr${count === 1 ? 'y' : 'ies'}` : 'Scope count unavailable';
  const sourceLink = $('watch-source');
  try {
    const source = new URL(data.source?.url);
    if (source.protocol !== 'https:' || source.hostname !== 'hackerone.com') throw new Error('Unexpected source');
    sourceLink.href = source.href;
    sourceLink.textContent = source.hostname + source.pathname;
  } catch {
    sourceLink.removeAttribute('href');
    sourceLink.textContent = 'Source unavailable';
  }
  const fetched = new Date(data.source?.fetchedAt);
  $('watch-fetched').textContent = Number.isNaN(fetched.getTime()) ? 'Fetch time unavailable' : `Fetched ${fetched.toLocaleString()}`;
  const latency = data.queryLatencyMs;
  $('watch-latency').hidden = !Number.isFinite(latency) || latency < 0;
  if (!$('watch-latency').hidden) $('watch-latency').textContent = `ClickHouse ${Math.round(latency * 10) / 10} ms`;
  $('watch-added-title').textContent = status === 'baseline' ? 'Baseline scope entries' : 'Added scope entries';
  for (const [id, items] of [['watch-added', data.added], ['watch-removed', data.removed]]) {
    const list = $(id);
    list.replaceChildren();
    for (const item of Array.isArray(items) ? items : []) list.append(createElement('li', '', item));
    if (!list.children.length) list.append(createElement('li', 'is-empty', status === 'baseline' && id === 'watch-added' ? 'Baseline stored; no prior structured scope to compare.' : 'None observed.'));
  }
  const trace = $('watch-sponsor-trace');
  trace.replaceChildren();
  for (const call of Array.isArray(data.sponsorTrace) ? data.sponsorTrace : []) {
    const row = createElement('li', /fail|error/i.test(call.status || '') ? 'is-failed' : '');
    const title = createElement('strong', '', call.tool || 'Tool');
    title.append(createElement('code', '', call.status || 'recorded'));
    row.append(title, createElement('p', '', call.detail || 'No detail recorded.'));
    trace.append(row);
  }
  if (!trace.children.length) trace.append(createElement('li', '', 'No sponsor calls recorded.'));
}

function renderEvidence(data) {
  $('evidence-empty').hidden = true;
  $('evidence-results').hidden = false;
  $('source-evidence').classList.add('is-ready');
  $('source-evidence-detail').textContent = data.mode === 'lab' ? 'Synthetic observations from the local fixture; no bounty claim.' : 'Bounded observations from researcher-owned accounts; inspect raw evidence.';
  const verdicts = { candidate: 'Candidate finding — human validation required', expected: 'Expected boundary held', inconclusive: 'Inconclusive evidence' };
  $('result-verdict').textContent = data.mode === 'lab' && data.verdict === 'candidate'
    ? 'Simulated candidate — local lab only'
    : verdicts[data.verdict] || `Result: ${data.verdict || 'unknown'}`;
  $('result-mode').textContent = data.mode === 'live' ? 'LIVE CHECK' : 'LOCAL LAB · SYNTHETIC';
  const latency = data.queryLatencyMs;
  $('query-latency').hidden = !Number.isFinite(latency) || latency < 0;
  if (!$('query-latency').hidden) $('query-latency').textContent = `ClickHouse query ${Math.round(latency * 10) / 10} ms`;
  $('result-explanation').textContent = data.mode === 'lab'
    ? 'Synthetic outcomes demonstrate the analysis workflow. They do not establish a real vulnerability.'
    : data.verdict === 'candidate'
      ? 'The response differs across accounts. Reproduce and inspect the full evidence before you consider submission.'
      : data.verdict === 'expected'
        ? 'The other account did not access the owner’s private project in this run.'
        : 'This run did not provide enough evidence to support a report.';
  const list = $('evidence-list');
  list.replaceChildren();
  for (const item of Array.isArray(data.evidence) ? data.evidence : []) {
    const row = createElement('li', item.actor !== 'owner' && item.ownerMarkerPresent ? 'is-alert' : '');
    const dot = createElement('span', 'timeline-dot');
    dot.setAttribute('aria-hidden', 'true');
    const body = createElement('div', 'timeline-content');
    const top = createElement('div', 'timeline-top');
    top.append(createElement('strong', '', item.actor || 'Check'), createElement('code', '', item.status === undefined ? 'No status' : `HTTP ${item.status}`));
    const detail = item.detail || (item.ownerMarkerPresent ? 'Owner marker observed in response.' : 'Owner marker absent from response.');
    body.append(top, createElement('p', '', detail));
    row.append(dot, body);
    list.append(row);
  }
  if (!list.children.length) list.append(createElement('li', '', 'No evidence items were recorded.'));
  const review = data.reviewNote;
  const questions = Array.isArray(review?.validationQuestions) ? review.validationQuestions.filter((question) => typeof question === 'string' && question.trim()) : [];
  $('review-note').hidden = !review?.summary && questions.length === 0;
  $('review-summary').textContent = typeof review?.summary === 'string' ? review.summary : '';
  $('review-summary').hidden = !$('review-summary').textContent;
  const questionList = $('review-questions');
  questionList.replaceChildren();
  for (const question of questions) questionList.append(createElement('li', '', question));
  questionList.hidden = questions.length === 0;
}

function renderTrace(data) {
  const trace = Array.isArray(data.sponsorTrace) ? data.sponsorTrace : [];
  $('trace-mode').textContent = data.mode === 'lab' ? 'LAB / SIMULATED' : 'LIVE RUN';
  $('trace-empty').hidden = trace.length > 0;
  $('sponsor-trace').hidden = trace.length === 0;
  const list = $('sponsor-trace');
  list.replaceChildren();
  for (const call of trace) {
    const row = createElement('li', /fail|error/i.test(call.status || '') ? 'is-failed' : '');
    const title = createElement('strong', '', call.tool || 'Tool');
    title.append(createElement('code', '', call.status || 'recorded'));
    row.append(title, createElement('p', '', call.detail || 'No detail recorded.'));
    list.append(row);
  }
  const senso = trace.find((call) => call.tool === 'Senso' && call.status === 'retrieved');
  $('source-policy').classList.toggle('is-ready', Boolean(senso));
  $('source-policy-detail').textContent = senso ? senso.detail : 'A pinned ProofRun policy is retrieved when a run begins.';
}

function renderReport(data) {
  const draft = data.reportDraft;
  const hasDraft = draft && typeof draft === 'object';
  $('report-fields').hidden = !hasDraft;
  $('draft-title').value = hasDraft ? draft.title || '' : '';
  $('draft-information').value = hasDraft ? draft.vulnerability_information || '' : '';
  $('draft-impact').value = hasDraft ? draft.impact || '' : '';
  $('draft-severity').value = hasDraft ? draft.severity_rating || '' : '';
  $('human-validated').checked = false;
  $('validation-note').value = '';
  $('validation-label').hidden = !hasDraft || data.mode !== 'live' || data.verdict !== 'candidate';
  $('validation-note-block').hidden = $('validation-label').hidden;
  $('report-guidance').textContent = data.mode === 'lab'
    ? 'Synthetic draft for interface testing only. It cannot be sent to HackerOne.'
    : data.verdict === 'candidate'
      ? 'Review every claim against raw evidence. Verify real impact and attach an unedited screenshot or video directly in HackerOne before submitting.'
      : 'This run does not establish a reportable finding.';
  $('submit-note').textContent = data.mode === 'lab' ? 'A lab run can never be submitted.'
    : data.verdict !== 'candidate' ? 'Only a validated live candidate can be submitted.'
      : 'ProofRun cannot attach Vercel’s required PoC media through the direct report API. Use the reviewed draft and submit with media in HackerOne.';
  $('copy-result').hidden = true;
  updateCopyButton();
}

function updateCopyButton() {
  const run = state.run;
  const title = $('draft-title').value.trim();
  const info = $('draft-information').value.trim();
  const impact = $('draft-impact').value.trim();
  const provisional = /human verification still required|potential unauthorized access|local lab exercise|do not submit/i.test(`${title}\n${info}\n${impact}`);
  $('copy-button').disabled = state.busy || !run || run.mode !== 'live' || run.verdict !== 'candidate' ||
    !$('human-validated').checked || $('validation-note').value.trim().length < 40 ||
    [title, info, impact].some((value) => value.length < 20) || !$('draft-severity').value || provisional;
}

function resetRunDisplay() {
  $('evidence-empty').hidden = false;
  $('evidence-results').hidden = true;
  $('review-note').hidden = true;
  $('query-latency').hidden = true;
  $('trace-empty').hidden = false;
  $('sponsor-trace').hidden = true;
  $('trace-mode').textContent = '';
  $('report-fields').hidden = true;
  $('validation-label').hidden = true;
  $('validation-note-block').hidden = true;
  $('report-guidance').textContent = 'Run a check to generate a draft. A human must verify a real finding before submission.';
  $('submit-note').textContent = 'A lab run can never be submitted.';
  $('copy-result').hidden = true;
  $('source-policy').classList.remove('is-ready');
  $('source-policy-detail').textContent = 'A pinned ProofRun policy is retrieved when a run begins.';
  $('source-evidence').classList.remove('is-ready');
  $('source-evidence-detail').textContent = 'No observations recorded yet.';
  updateCopyButton();
}

async function capture(event) {
  event.preventDefault();
  setMessage('');
  state.intake = null;
  updateRunButton();
  const button = $('intake-button');
  setBusy(true, button, 'Capturing…');
  try {
    const data = await request('/api/intake', { method: 'POST', body: JSON.stringify({ url: $('program-url').value.trim() }) });
    renderIntake(data);
    setMessage(data.source === 'browser'
      ? `Captured ${data.program?.name || 'program'} policy from the signed-in browser. Review the scope before running a check.`
      : `Loaded ${data.program?.name || 'program'} scope from HackerOne API. Browser capture is still required for a live check.`);
    request('/api/status').then(renderStatus).catch(() => {});
  } catch (error) {
    $('program-details').hidden = true;
    setMessage(error.message, true);
  } finally {
    setBusy(false, button, 'Capturing…');
  }
}

async function watchPolicy(event) {
  event.preventDefault();
  setMessage('Fetching live HackerOne scope. Sponsor review may take a few minutes; keep this page open.');
  $('watch-result').hidden = true;
  const button = $('watch-button');
  setBusy(true, button, 'Watching…');
  try {
    const data = await request('/api/watch', { method: 'POST', body: JSON.stringify({ url: $('watch-url').value.trim() }) });
    renderWatch(data);
    setMessage(data.status === 'changed' ? 'Structured scope change recorded. Review the delta and source before acting.' : 'Structured scope observation recorded. No target was probed.');
    $('watch-result').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false, button, 'Watching…');
  }
}

async function loadSample() {
  setMessage('');
  state.intake = null;
  updateRunButton();
  const button = $('sample-button');
  setBusy(true, button, 'Loading sample…');
  try {
    const data = await request('/api/intake', { method: 'POST', body: JSON.stringify({ url: $('program-url').value.trim(), sampleLab: true }) });
    renderIntake(data);
    setMessage('Local sample loaded. This synthetic scenario is for the lab walkthrough only.');
  } catch (error) {
    $('program-details').hidden = true;
    setMessage(error.message, true);
  } finally {
    setBusy(false, button, 'Loading sample…');
  }
}

async function runCheck() {
  if (!state.intake) return;
  setMessage('Running sponsor checks. The Guild policy gate may take a few minutes; keep this page open.');
  const button = $('run-button');
  setBusy(true, button, 'Running…');
  try {
    const data = await request('/api/run', { method: 'POST', body: JSON.stringify({ mode: selectedMode() }) });
    state.run = data;
    renderEvidence(data);
    renderTrace(data);
    renderReport(data);
    setMessage(data.mode === 'lab' ? 'Local lab run completed with synthetic evidence.' : 'Live check completed. Inspect the recorded evidence before taking any action.');
    $('evidence-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
  } catch (error) {
    setMessage(error.message, true);
  } finally {
    setBusy(false, button, 'Running…');
  }
}

async function copyReport() {
  if ($('copy-button').disabled || !state.run?.id) return;
  setMessage('');
  const button = $('copy-button');
  setBusy(true, button, 'Copying…');
  try {
    const report = [
      `Title: ${$('draft-title').value.trim()}`,
      `Severity: ${$('draft-severity').value}`,
      `Proof of concept:\n${$('draft-information').value.trim()}`,
      `Impact:\n${$('draft-impact').value.trim()}`,
      `Independent validation:\n${$('validation-note').value.trim()}`,
    ].join('\n\n');
    await navigator.clipboard.writeText(report);
    $('copy-result').hidden = false;
    $('copy-result').classList.remove('is-error');
    $('copy-result').textContent = 'Copied. Paste into HackerOne, attach the required unedited media, and personally review the final form before submitting.';
  } catch (error) {
    $('copy-result').hidden = false;
    $('copy-result').classList.add('is-error');
    $('copy-result').textContent = error.message || 'Clipboard access failed. Copy the report fields manually.';
  } finally {
    setBusy(false, button, 'Copying…');
  }
}

$('intake-button').dataset.label = $('intake-button').textContent;
$('sample-button').dataset.label = $('sample-button').textContent;
$('watch-button').dataset.label = $('watch-button').textContent;
$('run-button').dataset.label = $('run-button').textContent;
$('copy-button').dataset.label = $('copy-button').textContent;
$('intake-form').addEventListener('submit', capture);
$('watch-form').addEventListener('submit', watchPolicy);
$('sample-button').addEventListener('click', loadSample);
$('run-button').addEventListener('click', runCheck);
$('copy-button').addEventListener('click', copyReport);
$('human-validated').addEventListener('change', updateCopyButton);
$('validation-note').addEventListener('input', updateCopyButton);
['draft-title', 'draft-information', 'draft-impact', 'draft-severity'].forEach((id) => $(id).addEventListener('input', updateCopyButton));
document.querySelectorAll('input[name="run-mode"]').forEach((input) => input.addEventListener('change', updateModeNote));

request('/api/status').then(renderStatus).catch((error) => {
  $('connection-state').textContent = 'Local service offline';
  $('connection-state').className = 'connection-pill is-offline';
  setMessage(error.message, true);
});
