const $ = (id) => document.getElementById(id);
const state = { status: null, intake: null, intakeUrl: null, run: null, busy: false };

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
  $('program-url').disabled = busy;
  $('program-acronis').disabled = busy;
  $('program-vercel').disabled = busy;
  $('lab-shortcut').disabled = busy;
  updateRunButton();
  updateCopyButton();
}

function connected(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'string') return ['configured', 'connected', 'ready', 'available'].includes(value.toLowerCase());
  if (value && typeof value === 'object') return Boolean(value.connected ?? value.configured ?? value.ready ?? value.available);
  return false;
}

function selectedProgram() {
  try {
    const url = new URL($('program-url').value.trim());
    if (url.protocol !== 'https:' || url.hostname !== 'hackerone.com') return null;
    if (/^\/acronis\/?$/.test(url.pathname)) return 'acronis';
    if (/^\/vercel\/?$/.test(url.pathname)) return 'vercel';
  } catch {}
  return null;
}

function renderProgramChoice(resetMode = false) {
  const program = selectedProgram();
  const acronis = program === 'acronis';
  const vercel = program === 'vercel';
  $('program-acronis').classList.toggle('is-selected', acronis);
  $('program-vercel').classList.toggle('is-selected', vercel);
  $('program-acronis').setAttribute('aria-pressed', String(acronis));
  $('program-vercel').setAttribute('aria-pressed', String(vercel));
  const source = $('program-source-link');
  source.hidden = !program;
  if (program) source.href = `https://hackerone.com/${program}`;
  $('intake-description').textContent = acronis
    ? 'Acronis loads current structured scope from HackerOne. Its public-search check does not need a browser extension or second account.'
    : vercel
      ? 'Vercel needs current HackerOne scope plus a signed-in policy capture from the ProofRun browser extension.'
      : 'Enter one of the two supported HackerOne program URLs to review its current boundary.';
  $('capture-heading-label').textContent = acronis ? 'HackerOne API' : vercel ? 'Browser extension + API' : 'Program source';
  $('capture-instructions').textContent = acronis
    ? 'Load the current Acronis program and eligible structured scope. No target request happens at this step.'
    : vercel
      ? 'Click the extension on the signed-in HackerOne page first. This button then loads the capture and API scope for review.'
      : 'Choose Acronis or Vercel to see the required source and check.';
  $('intake-button').dataset.label = acronis ? 'Review current scope →' : 'Load and review scope →';
  if (!state.busy) $('intake-button').textContent = $('intake-button').dataset.label;
  $('setup-details').hidden = !vercel;
  $('sample-button').hidden = !vercel;
  $('mode-lab').disabled = !vercel;
  if (!vercel) $('mode-live').checked = true;
  else if (resetMode) $('mode-lab').checked = true;
  $('live-mode-description').textContent = acronis
    ? 'One read-only public-search marker request. Current Acronis scope required.'
    : vercel
      ? 'Researcher-owned Vercel accounts. Current policy and scope required.'
      : 'Choose a supported program to see its bounded check.';
  $('run-description').textContent = acronis
    ? 'Acronis makes one inert, read-only search-marker request. Reflection alone is not a vulnerability.'
    : vercel
      ? 'Vercel makes a limited project-read request through two accounts you own. The local training check compares exposed and protected paths.'
      : 'Each program has its own bounded check. Review the current scope before choosing a mode.';
  $('handoff-note').hidden = !vercel;
  if (!state.run) {
    $('report-guidance').textContent = acronis
      ? 'The public-search observation will not become a report from ordinary marker reflection.'
      : 'Run a check to generate a draft. A human must verify a real finding before submission.';
    $('submit-note').textContent = acronis ? 'Reflection alone is not a vulnerability; no report will be submitted.' : 'A lab run can never be submitted.';
  }
  if (acronis) {
    $('capture-state').textContent = state.intake?.program?.handle === 'acronis' ? 'Scope loaded' : state.status?.hackerone?.apiConfigured ? 'API configured' : 'API unavailable';
    $('capture-state').classList.toggle('is-ready', Boolean(state.intake?.program?.handle === 'acronis' || state.status?.hackerone?.apiConfigured));
  } else if (vercel) {
    const source = state.intake?.source || state.status?.captureSource;
    $('capture-state').textContent = state.intake?.labOnly ? 'Training case loaded' : source === 'manual' ? 'Manual review only' : source === 'browser' ? 'Capture received' : 'Waiting for capture';
    $('capture-state').classList.toggle('is-ready', Boolean(state.intake?.labOnly || source === 'browser'));
  } else {
    $('capture-state').textContent = 'Choose program';
    $('capture-state').classList.remove('is-ready');
  }
  updateModeNote();
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
  const captureSource = data.captureSource || state.intake?.source;
  const captured = captureSource === 'browser' || (!captureSource && Boolean(data.captureReady));
  $('capture-state').textContent = state.intake?.labOnly ? 'Training case loaded' : captureSource === 'manual' ? 'Manual review only' : captured ? 'Capture received' : 'Waiting for capture';
  $('capture-state').classList.toggle('is-ready', captured || Boolean(state.intake?.labOnly));
  renderProgramChoice();
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
  state.intakeUrl = $('program-url').value.trim();
  state.run = null;
  $('capture-state').textContent = data.labOnly ? 'Training case loaded' : data.source === 'browser' ? 'Capture received' : data.source === 'manual' ? 'Manual review only' : 'Waiting for capture';
  $('capture-state').classList.toggle('is-ready', Boolean(data.labOnly || data.source === 'browser'));
  resetRunDisplay();
  $('program-details').hidden = false;
  $('program-name').textContent = data.labOnly ? 'Controlled authorization training case' : data.program?.name || data.program?.handle || 'Program';
  $('program-source').textContent = data.source === 'browser' ? 'BROWSER CAPTURE' : data.source === 'manual' ? 'MANUAL TEXT · REVIEW ONLY' : data.source === 'hackerone_api' ? 'HACKERONE API' : data.source === 'local_sample' ? 'LOCAL TRAINING TARGET' : String(data.source || 'SOURCE UNAVAILABLE').toUpperCase();
  $('source-program-title').textContent = data.labOnly ? 'Training target' : 'HackerOne';
  $('source-program').classList.toggle('is-ready', data.source === 'browser' || data.source === 'hackerone_api');
  $('source-program-detail').textContent = data.labOnly ? 'Controlled local training target. It is not current HackerOne scope.' : data.program?.handle === 'acronis' ? 'Current HackerOne structured scope for one read-only public-search check.' : data.source === 'browser' ? 'Signed-in browser capture received; structured scope is checked separately.' : data.source === 'manual' ? 'Pasted policy text is review-only and cannot authorize a live check.' : 'Structured API scope received without signed-in browser capture.';
  $('program-asset').textContent = data.policy?.asset || 'No asset specified in the reviewed scope';
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
  if (data.program?.handle === 'vercel') $('watch-url').value = state.intakeUrl;
  renderProgramChoice();
}

function selectedMode() {
  return document.querySelector('input[name="run-mode"]:checked')?.value || 'lab';
}

function updateModeNote() {
  const mode = selectedMode();
  const readiness = state.status;
  const program = state.intake?.program?.handle || selectedProgram();
  const missing = [['guild', 'Guild'], ['akash', 'AkashML'], ['clickhouse', 'ClickHouse'], ['senso', 'Senso']]
    .filter(([key]) => !connected(readiness?.sponsors?.[key])).map(([, label]) => label);
  let note;
  if (!state.intake) note = program === 'acronis' ? 'Review current HackerOne scope to enable one read-only search-marker request.'
    : program === 'vercel' ? 'Capture the signed-in program, or load the controlled training case.'
      : 'Enter the Acronis or Vercel HackerOne program URL to begin.';
  else if (program === 'acronis' && missing.length) note = `Configure ${missing.join(', ')} in the local .env before the Acronis probe.`;
  else if (program === 'acronis' && !readiness?.hackerone?.apiConfigured) note = 'The Acronis probe needs the HackerOne API credentials for current program scope.';
  else if (program === 'acronis' && (state.intake.check !== 'search_reflection' || state.intake.source !== 'hackerone_api' || !state.intake.scope?.length || state.intake.limitations?.some((item) => /blocked|not confirmed/i.test(item)))) note = 'Acronis scope is not confirmed for this one read-only search-marker request.';
  else if (program === 'acronis') note = 'Ready for one inert, read-only search-marker request. Reflection alone is not a vulnerability.';
  else if (mode === 'live' && state.intake.labOnly) note = `The local sample cannot authorize live testing. Capture the signed-in program.${missing.length ? ` Also configure ${missing.join(', ')} in the local .env.` : ''}`;
  else if (missing.length) note = `Configure ${missing.join(', ')} in the local .env before running.`;
  else if (mode === 'lab') note = 'Ready to compare exposed and protected local training paths. This cannot establish a bounty finding.';
  else if (state.intake.source !== 'browser' && readiness?.captureReady) note = 'Browser capture received. Load and review this program again before a live check.';
  else if (state.intake.source !== 'browser' || !readiness?.captureReady) note = 'Live mode requires a current signed-in browser capture.';
  else if (!readiness?.hackerone?.apiConfigured || state.intake.limitations?.some((item) => /live mode is blocked/i.test(item))) note = 'Live mode also needs HackerOne structured scope and confirmed policy checks.';
  else if (!readiness?.vercel?.configured) note = 'Live mode needs two distinct researcher-owned Vercel accounts registered with your HackerOne email aliases, both tokens, and a project ID.';
  else note = 'Ready for one bounded check inside current scope and researcher-owned accounts.';
  $('mode-note').textContent = note;
  updateRunButton();
}

function updateRunButton() {
  const button = $('run-button');
  const program = state.intake?.program?.handle || selectedProgram();
  if (!state.busy) {
    button.textContent = selectedMode() === 'lab' ? 'Run paired training check →' : program === 'acronis' ? 'Run one read-only probe →' : 'Run bounded live check →';
    button.dataset.label = button.textContent;
  }
  const sponsorsReady = ['guild', 'akash', 'clickhouse', 'senso'].every((key) => connected(state.status?.sponsors?.[key]));
  const acronisReady = program === 'acronis' && state.intake?.check === 'search_reflection' && state.intake?.source === 'hackerone_api' &&
    state.status?.hackerone?.apiConfigured && state.intake.scope?.length &&
    !state.intake.limitations?.some((item) => /blocked|not confirmed/i.test(item));
  const vercelReady = program === 'vercel' && state.intake && !state.intake.labOnly && state.intake.source === 'browser' && state.status?.captureReady &&
    state.status?.hackerone?.apiConfigured && state.status?.vercel?.configured &&
    !state.intake.limitations?.some((item) => /live mode is blocked/i.test(item));
  button.disabled = state.busy || !state.intake || !sponsorsReady || (selectedMode() === 'live' ? !(acronisReady || vercelReady) : program !== 'vercel');
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

function renderValidation(validation) {
  const section = $('validation-results');
  section.hidden = !validation;
  if (!validation) return;
  const passed = validation.passed === true;
  const status = $('validation-status');
  status.dataset.passed = String(passed);
  status.textContent = passed ? 'CONTROL CONFIRMED' : 'CONTROL INCOMPLETE';
  const labels = {
    candidate: 'Cross-account read observed',
    exposed: 'Cross-account read observed',
    confirmed: 'Cross-account read observed',
    expected: 'Access boundary held',
    protected: 'Access boundary held',
    blocked: 'Access boundary held',
    inconclusive: 'Evidence inconclusive',
  };
  for (const [kind, target] of [['exposed', 'validation-exposed-evidence'], ['patched', 'validation-patched-evidence']]) {
    const result = validation[kind] || {};
    $(kind === 'exposed' ? 'validation-exposed-verdict' : 'validation-patched-verdict').textContent =
      labels[result.verdict] || (result.verdict ? `Result: ${String(result.verdict).replaceAll('_', ' ')}` : 'No verdict recorded');
    const list = $(target);
    list.replaceChildren();
    for (const item of Array.isArray(result.evidence) ? result.evidence : []) {
      const row = createElement('li', item.actor !== 'owner' && item.ownerMarkerPresent ? 'is-alert' : '');
      const label = createElement('strong', '', item.actor || 'Check');
      label.append(createElement('code', '', item.status === 0 ? 'NO RESPONSE' : item.status === undefined ? 'NO STATUS' : `HTTP ${item.status}`));
      row.append(label, createElement('span', '', item.detail || 'No detail recorded.'));
      list.append(row);
    }
    if (!list.children.length) list.append(createElement('li', 'is-empty', 'No observations recorded.'));
  }
}

function renderEvidence(data) {
  const acronis = data.programHandle === 'acronis' || state.intake?.program?.handle === 'acronis';
  const acronisResponded = Number(data.evidence?.[0]?.status) > 0;
  const acronisCapped = acronis && data.evidence?.[0]?.responseCapped === true;
  $('evidence-empty').hidden = true;
  $('evidence-results').hidden = false;
  $('source-evidence').classList.add('is-ready');
  $('source-evidence-detail').textContent = data.mode === 'lab' ? 'Synthetic observations from the local fixture; no bounty claim.' : acronis ? acronisCapped ? 'One live public-search response observed; only its first 256 KiB were read.' : acronisResponded ? 'One live public-search response observed. Reflection alone is not a vulnerability.' : 'One public-search request attempted; no target response was recorded.' : 'Bounded observations from researcher-owned accounts; inspect raw evidence.';
  const verdicts = { candidate: 'Candidate finding — human validation required', expected: 'Expected boundary held', inconclusive: 'Inconclusive evidence' };
  $('result-verdict').textContent = acronis
    ? acronisResponded ? 'Search response observed — no finding established' : 'No target response — no finding established'
    : data.mode === 'lab' && data.verdict === 'candidate'
    ? 'Simulated candidate — local lab only'
    : verdicts[data.verdict] || `Result: ${data.verdict || 'unknown'}`;
  $('result-mode').textContent = acronis ? 'LIVE · ONE READ-ONLY REQUEST' : data.mode === 'live' ? 'LIVE CHECK' : 'LOCAL LAB · SYNTHETIC';
  const latency = data.queryLatencyMs;
  $('query-latency').hidden = !Number.isFinite(latency) || latency < 0;
  if (!$('query-latency').hidden) $('query-latency').textContent = `ClickHouse query ${Math.round(latency * 10) / 10} ms`;
  $('result-explanation').textContent = acronis
    ? acronisCapped
      ? 'ProofRun recorded one response, but stopped reading at 256 KiB. The unread remainder cannot be assessed; no vulnerability or bounty report is claimed.'
      : acronisResponded
      ? 'ProofRun sent one inert search marker to the scoped public search endpoint and recorded the response. Reflection alone is not a vulnerability; no bounty report was generated.'
      : 'ProofRun attempted the one bounded public-search request but did not receive a usable target response. No vulnerability or bounty report is claimed.'
    : data.mode === 'lab'
    ? 'Synthetic outcomes demonstrate the analysis workflow. They do not establish a real vulnerability.'
    : data.verdict === 'candidate'
      ? 'The response differs across accounts. Reproduce and inspect the full evidence before you consider submission.'
      : data.verdict === 'expected'
        ? 'The other account did not access the owner’s private project in this run.'
        : 'This run did not provide enough evidence to support a report.';
  renderValidation(data.validation);
  if (data.validation) {
    $('source-evidence-detail').textContent = 'Two controlled local training paths were compared; no HackerOne target was tested.';
    $('result-verdict').textContent = data.validation.passed === true ? 'Authorization failure reproduced in training' : 'Training control incomplete';
    $('result-mode').textContent = 'CONTROLLED TRAINING · NOT HACKERONE';
    $('result-explanation').textContent = data.validation.passed === true
      ? 'The exposed path returned protected data to a second account while the corrected path held. This validates the check on a controlled training target, not a live bounty finding.'
      : 'The paired exposed and protected paths did not establish the expected difference. Inspect both outcomes before claiming this check works.';
  }
  const list = $('evidence-list');
  list.replaceChildren();
  list.hidden = Boolean(data.validation && !data.evidence?.length);
  for (const item of Array.isArray(data.evidence) ? data.evidence : []) {
    const row = createElement('li', item.actor !== 'owner' && item.ownerMarkerPresent ? 'is-alert' : '');
    const dot = createElement('span', 'timeline-dot');
    dot.setAttribute('aria-hidden', 'true');
    const body = createElement('div', 'timeline-content');
    const top = createElement('div', 'timeline-top');
    top.append(createElement('strong', '', item.actor === 'public_search' ? 'Public search' : item.actor || 'Check'), createElement('code', '', item.status === 0 ? 'NO RESPONSE' : item.status === undefined ? 'No status' : `HTTP ${item.status}`));
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
  $('trace-mode').textContent = data.validation ? 'LAB / PAIRED CONTROL' : data.mode === 'lab' ? 'LAB / SIMULATED' : data.programHandle === 'acronis' ? 'LIVE / ACRONIS' : 'LIVE RUN';
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
  const acronis = data.programHandle === 'acronis' || state.intake?.program?.handle === 'acronis';
  const hasDraft = !data.validation && draft && typeof draft === 'object';
  $('report-fields').hidden = !hasDraft;
  $('draft-title').value = hasDraft ? draft.title || '' : '';
  $('draft-information').value = hasDraft ? draft.vulnerability_information || '' : '';
  $('draft-impact').value = hasDraft ? draft.impact || '' : '';
  $('draft-severity').value = hasDraft ? draft.severity_rating || '' : '';
  $('human-validated').checked = false;
  $('validation-note').value = '';
  $('validation-label').hidden = !hasDraft || data.mode !== 'live' || data.verdict !== 'candidate';
  $('validation-note-block').hidden = $('validation-label').hidden;
  $('report-guidance').textContent = acronis
    ? 'No report was generated. One read-only search-marker response cannot establish a vulnerability from ordinary reflection.'
    : data.validation
    ? 'This is a controlled training result, not a HackerOne finding. No bounty report is available from this run.'
    : data.mode === 'lab'
    ? 'Synthetic draft for interface testing only. It cannot be sent to HackerOne.'
    : data.verdict === 'candidate'
      ? 'Review every claim against raw evidence. Verify real impact and attach an unedited screenshot or video directly in HackerOne before submitting.'
      : 'This run does not establish a reportable finding.';
  $('submit-note').textContent = acronis ? 'Reflection alone is not a vulnerability; there is nothing to submit.'
    : data.validation ? 'Controlled training results cannot be submitted to HackerOne.'
    : data.mode === 'lab' ? 'A lab run can never be submitted.'
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
  $('validation-results').hidden = true;
  $('evidence-list').hidden = false;
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

function clearCase() {
  state.intake = null;
  state.intakeUrl = null;
  state.run = null;
  $('program-details').hidden = true;
  $('capture-state').textContent = 'Capture needed';
  $('capture-state').classList.remove('is-ready');
  $('source-program').classList.remove('is-ready');
  $('source-program-title').textContent = 'HackerOne';
  $('source-program-detail').textContent = 'Waiting for current program scope.';
  resetRunDisplay();
  renderProgramChoice();
}

async function capture(event) {
  event.preventDefault();
  setMessage('');
  clearCase();
  const button = $('intake-button');
  setBusy(true, button, 'Loading scope…');
  try {
    const data = await request('/api/intake', { method: 'POST', body: JSON.stringify({ url: $('program-url').value.trim() }) });
    renderIntake(data);
    setMessage(data.program?.handle === 'acronis'
      ? 'Current Acronis scope loaded from HackerOne API. Review it before the one read-only search-marker request.'
      : data.source === 'browser'
      ? `Captured ${data.program?.name || 'program'} policy from the signed-in browser. Review the scope before running a check.`
      : data.source === 'manual'
        ? 'Manual policy text loaded for review only. A signed-in extension capture is still required for a live check.'
        : `Loaded ${data.program?.name || 'program'} scope from HackerOne API. Browser capture is still required for a live check.`);
    request('/api/status').then(renderStatus).catch(() => {});
  } catch (error) {
    $('program-details').hidden = true;
    setMessage(error.message, true);
  } finally {
    setBusy(false, button, 'Loading scope…');
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
  clearCase();
  const button = $('sample-button');
  setBusy(true, button, 'Loading sample…');
  try {
    const data = await request('/api/intake', { method: 'POST', body: JSON.stringify({ url: $('program-url').value.trim(), sampleLab: true }) });
    renderIntake(data);
    setMessage('Controlled training case loaded. It compares exposed and protected local paths; no HackerOne target will be tested.');
  } catch (error) {
    $('program-details').hidden = true;
    setMessage(error.message, true);
  } finally {
    setBusy(false, button, 'Loading sample…');
  }
}

async function openTraining() {
  if (state.busy) return;
  $('program-url').value = 'https://hackerone.com/vercel';
  $('program-url').dispatchEvent(new Event('input', { bubbles: true }));
  await loadSample();
  if (state.intake?.labOnly) $('run-title').scrollIntoView({ behavior: 'smooth', block: 'start' });
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
    setMessage(data.programHandle === 'acronis'
      ? Number(data.evidence?.[0]?.status) > 0
        ? 'Acronis read-only probe completed. One search response was recorded; no vulnerability or report is claimed.'
        : 'Acronis read-only probe attempted. No target response was recorded; no vulnerability or report is claimed.'
      : data.validation?.passed === true ? 'Controlled training check confirmed the authorization difference. This is not a HackerOne finding.'
        : data.validation ? 'Controlled training check completed, but the paired control did not confirm the expected difference.'
          : data.mode === 'lab' ? 'Local lab run completed with synthetic evidence.' : 'Live check completed. Inspect the recorded evidence before taking any action.');
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
$('program-url').addEventListener('input', () => {
  if (state.intake && $('program-url').value.trim() !== state.intakeUrl) {
    clearCase();
    setMessage('Program URL changed. Load and review this program before running another check.');
  }
  renderProgramChoice(true);
});
document.querySelectorAll('.program-preset').forEach((button) => button.addEventListener('click', () => {
  $('program-url').value = button.dataset.url;
  $('program-url').dispatchEvent(new Event('input', { bubbles: true }));
}));
$('watch-form').addEventListener('submit', watchPolicy);
$('sample-button').addEventListener('click', loadSample);
$('lab-shortcut').addEventListener('click', openTraining);
$('run-button').addEventListener('click', runCheck);
$('copy-button').addEventListener('click', copyReport);
$('human-validated').addEventListener('change', updateCopyButton);
$('validation-note').addEventListener('input', updateCopyButton);
['draft-title', 'draft-information', 'draft-impact', 'draft-severity'].forEach((id) => $(id).addEventListener('input', updateCopyButton));
document.querySelectorAll('input[name="run-mode"]').forEach((input) => input.addEventListener('change', updateModeNote));

renderProgramChoice(true);
request('/api/status').then(renderStatus).catch((error) => {
  $('connection-state').textContent = 'Local service offline';
  $('connection-state').className = 'connection-pill is-offline';
  setMessage(error.message, true);
});
