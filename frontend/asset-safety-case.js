(function initializeSafetyCase() {
  const POLL_MS = 1000;
  const ROLE_PERMISSIONS = Object.freeze({
    operator: Object.freeze(['ACK', 'ASSIGN']),
    inspector: Object.freeze(['ACK', 'DISMISS', 'RESOLVE']),
    admin: Object.freeze(['ACK', 'ASSIGN', 'DISMISS', 'RESOLVE']),
  });
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const selectedAssetId = new URLSearchParams(window.location.search).get('asset');
  const state = {
    assets: [],
    health: null,
    asset: null,
    risk: null,
    lastGoodAt: null,
    requestVersion: 0,
    refreshPromise: null,
    refreshQueued: false,
    users: [],
    usersRequest: null,
    identityVerified: false,
    activeAction: null,
    pendingActions: new Set(),
    actionVersion: 0,
  };

  function hasValue(value) {
    return value !== undefined && value !== null && value !== '';
  }

  function display(value, fallback = '—') {
    return hasValue(value) ? String(value) : fallback;
  }

  function setText(selector, value, fallback = '—') {
    const node = $(selector);
    if (node) node.textContent = display(value, fallback);
  }

  function setSectionState(name, value) {
    const section = $(`[data-section="${name}"]`);
    if (section) section.dataset.state = value;
  }

  function setCaseStatus(system, refresh) {
    setText('[data-system-state]', system);
    setText('[data-refresh-state]', refresh);
  }

  function formatTimestamp(value) {
    if (!hasValue(value)) return '—';
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toLocaleString();
  }

  function formatList(value, empty = 'NONE RETURNED') {
    if (!Array.isArray(value) || !value.length) return empty;
    return value.map((item) => display(item)).join(' / ');
  }

  function normalizedLevel(value) {
    return hasValue(value) ? String(value).trim().toLowerCase() : 'unknown';
  }

  function initializeRoutes() {
    $$('[data-route]').forEach((link) => {
      const route = window.RakshakRoutes?.[link.dataset.route];
      if (!route?.path) return;
      link.href = route.path;
    });
  }

  function usersFrom(payload) {
    const users = Array.isArray(payload) ? payload : Array.isArray(payload?.users) ? payload.users : [];
    return users.filter((user) => user && hasValue(user.id) && hasValue(user.name) && hasValue(user.role));
  }

  function selectedUser() {
    return window.RakshakIdentity?.getSelectedUser?.() || null;
  }

  function userRole(user = selectedUser()) {
    return hasValue(user?.role) ? String(user.role).trim().toLowerCase() : '';
  }

  function sameUser(first, second) {
    return first && second && String(first.id) === String(second.id) && first.name === second.name && first.role === second.role;
  }

  function renderIdentity() {
    const user = selectedUser();
    const badge = $('[data-identity-state]');
    const verified = state.identityVerified && user;
    setText('[data-active-user]', verified ? user.name : 'SELECT USER IN COMMAND CENTER');
    setText('[data-active-role]', verified ? String(user.role).toUpperCase() : 'IDENTITY REQUIRED');
    if (badge) badge.dataset.identityState = verified ? 'verified' : 'unverified';
  }

  function populateInspectors() {
    const select = $('[data-assignee]');
    if (!select) return;
    select.replaceChildren();
    const placeholder = document.createElement('option');
    placeholder.value = '';
    placeholder.textContent = 'SELECT BACKEND-RETURNED INSPECTOR';
    select.append(placeholder);
    state.users.filter((user) => userRole(user) === 'inspector').forEach((user) => {
      const option = document.createElement('option');
      option.value = String(user.id);
      option.textContent = user.name;
      select.append(option);
    });
  }

  function actionDisabledReason(action, role, verified) {
    if (!verified) return 'Select a valid user';
    if (state.pendingActions.size) return 'Human action request in progress';
    if ((ROLE_PERMISSIONS[role] || []).includes(action)) {
      if (action === 'ASSIGN' && !state.users.some((user) => userRole(user) === 'inspector')) return 'No inspector identities returned';
      if ((action === 'DISMISS' || action === 'RESOLVE') && role === 'inspector') return 'Backend verifies assigned issue';
      return 'Available for selected role';
    }
    if (action === 'ASSIGN') return 'Requires operator or admin role';
    if (action === 'DISMISS' || action === 'RESOLVE') return 'Requires inspector or admin role';
    return 'Action unavailable for selected role';
  }

  function syncActionPermissions() {
    const user = selectedUser();
    const role = userRole(user);
    const verified = Boolean(state.identityVerified && user && ROLE_PERMISSIONS[role]);
    $$('[data-workflow-action]').forEach((button) => {
      const action = button.dataset.workflowAction;
      const allowed = verified && (ROLE_PERMISSIONS[role] || []).includes(action);
      const hasInspector = action !== 'ASSIGN' || state.users.some((candidate) => userRole(candidate) === 'inspector');
      button.disabled = !allowed || !hasInspector || state.pendingActions.size > 0;
      setText(`[data-action-reason="${action}"]`, actionDisabledReason(action, role, verified));
      const control = button.closest('[data-action-control]');
      if (control) control.dataset.permission = button.disabled ? 'disabled' : 'enabled';
    });
    setText('[data-action-panel-state]', verified ? `${String(user.role).toUpperCase()} WORKFLOW` : 'SELECT A VALID USER');
    setSectionState('actions', verified ? 'loaded' : 'identity');
    const simulationButton = $('[data-simulate-intervention]');
    if (simulationButton) simulationButton.disabled = true;
    if (!verified) {
      setText('[data-simulation-panel-state]', 'SELECT A VALID USER');
      setText('[data-simulation-support]', 'SELECT A BACKEND-PROVIDED IDENTITY IN COMMAND CENTER. SCENARIO REQUEST REMAINS DISABLED.');
      setSectionState('simulation', 'identity');
    } else if (role === 'operator') {
      setText('[data-simulation-panel-state]', 'ROLE RESTRICTED');
      setText('[data-simulation-support]', 'SIMULATION REQUIRES INSPECTOR OR ADMIN ROLE. BACKEND AUTHORIZATION REMAINS AUTHORITATIVE.');
      setSectionState('simulation', 'role');
    } else {
      setText('[data-simulation-panel-state]', 'CONTRACT BLOCKED');
      setText('[data-simulation-support]', 'VALID INTERVENTION VALUES ARE NOT DEFINED PER ASSET. REQUEST DISABLED TO PREVENT A FABRICATED PAYLOAD.');
      setSectionState('simulation', 'blocked');
    }
    renderIdentity();
  }

  async function refreshWorkflowUsers() {
    if (state.usersRequest) return state.usersRequest;
    state.usersRequest = window.RakshakAPI.loadUsers().then((payload) => {
      state.users = usersFrom(payload);
      const current = selectedUser();
      const verifiedUser = current ? state.users.find((user) => String(user.id) === String(current.id)) : null;
      state.identityVerified = Boolean(verifiedUser);
      populateInspectors();
      if (current && !verifiedUser) {
        window.RakshakIdentity.setSelectedUser(null);
      } else if (verifiedUser && !sameUser(current, verifiedUser)) {
        window.RakshakIdentity.setSelectedUser(verifiedUser);
      } else {
        syncActionPermissions();
      }
      return state.users;
    }).catch(() => {
      state.users = [];
      state.identityVerified = false;
      populateInspectors();
      syncActionPermissions();
      setText('[data-action-panel-state]', 'USER DIRECTORY UNAVAILABLE');
      return [];
    }).finally(() => {
      state.usersRequest = null;
    });
    return state.usersRequest;
  }

  function clearActionForm() {
    state.activeAction = null;
    const form = $('[data-action-form]');
    if (form) {
      form.hidden = true;
      form.reset();
    }
    const assigneeField = $('[data-assignee-field]');
    if (assigneeField) assigneeField.hidden = true;
    setText('[data-action-form-error]', '', '');
  }

  function clearScenario() {
    setText('[data-sim-before-score]', null);
    setText('[data-sim-before-level]', 'UNAVAILABLE');
    setText('[data-sim-before-priority]', null);
    setText('[data-sim-after-score]', null);
    setText('[data-sim-after-level]', 'UNAVAILABLE');
    setText('[data-sim-after-priority]', null);
    setText('[data-sim-intervention]', 'INTERVENTION VALUE UNVERIFIED');
    setText('[data-sim-changed-factors]', 'NO BACKEND SCENARIO RETURNED');
    setText('[data-sim-note]', 'NO BACKEND SCENARIO RETURNED');
  }

  function openActionForm(action) {
    const button = $(`[data-workflow-action="${action}"]`);
    if (!button || button.disabled) return;
    state.activeAction = action;
    const form = $('[data-action-form]');
    form.hidden = false;
    setText('[data-action-form-title]', action === 'ACK' ? 'CONFIRM RISK ACKNOWLEDGMENT' : action === 'ASSIGN' ? 'CONFIRM INSPECTION ASSIGNMENT' : action === 'DISMISS' ? 'CONFIRM ISSUE DISMISSAL' : 'CONFIRM INSPECTION RESOLUTION');
    setText('[data-action-note-label]', action === 'RESOLVE' ? 'RESOLUTION NOTES / REASON' : 'REASON / NOTE');
    $('[data-assignee-field]').hidden = action !== 'ASSIGN';
    $('[data-action-reason-input]').value = '';
    $('[data-assignee]').value = '';
    setText('[data-action-form-error]', '', '');
    $('[data-action-reason-input]').focus();
  }

  function actionSuccessMessage(action) {
    if (action === 'ACK') return 'RISK ACKNOWLEDGMENT RECORDED';
    if (action === 'ASSIGN') return 'INSPECTION ASSIGNMENT CONFIRMED';
    if (action === 'DISMISS') return 'ISSUE WORKFLOW DISMISSED / LIVE RISK UNCHANGED';
    return 'INSPECTION WORKFLOW RESOLVED / LIVE RISK UNCHANGED';
  }

  function actionErrorMessage(action) {
    if (action === 'ASSIGN') return 'ASSIGNMENT COULD NOT BE CREATED';
    if (action === 'DISMISS') return 'ISSUE COULD NOT BE DISMISSED';
    if (action === 'RESOLVE') return 'INSPECTION COULD NOT BE RESOLVED';
    return 'ACKNOWLEDGMENT COULD NOT BE RECORDED';
  }

  async function submitAction(event) {
    event.preventDefault();
    const action = state.activeAction;
    const user = selectedUser();
    const reason = $('[data-action-reason-input]').value.trim();
    const assignee = $('[data-assignee]').value;
    if (!action || !state.identityVerified || !user) {
      setText('[data-action-form-error]', 'SELECT A VALID USER');
      return;
    }
    if (!reason) {
      setText('[data-action-form-error]', 'ENTER A REASON OR NOTE BEFORE CONFIRMING');
      $('[data-action-reason-input]').focus();
      return;
    }
    if (action === 'ASSIGN' && !assignee) {
      setText('[data-action-form-error]', 'SELECT A BACKEND-RETURNED INSPECTOR');
      $('[data-assignee]').focus();
      return;
    }
    if (state.pendingActions.has(action)) return;

    const requestUserId = String(user.id);
    const version = ++state.actionVersion;
    const payload = { actor: user.id, action, reason };
    if (action === 'ASSIGN') payload.assignee = assignee;
    state.pendingActions.add(action);
    syncActionPermissions();
    $('[data-action-submit]').disabled = true;
    setText('[data-action-result]', `SUBMITTING ${action} TO BACKEND`);
    setText('[data-action-form-error]', '', '');

    try {
      await window.RakshakAPI.performAction(selectedAssetId, payload);
      if (version !== state.actionVersion || String(selectedUser()?.id) !== requestUserId) return;
      setText('[data-action-result]', actionSuccessMessage(action));
      clearActionForm();
      await refresh();
    } catch (error) {
      if (version !== state.actionVersion || String(selectedUser()?.id) !== requestUserId) return;
      if (error?.status === 401) setText('[data-action-form-error]', 'SELECT A VALID USER');
      else if (error?.status === 403) setText('[data-action-form-error]', 'INSUFFICIENT BACKEND PERMISSION FOR THIS ACTION');
      else setText('[data-action-form-error]', actionErrorMessage(action));
      setText('[data-action-result]', 'HUMAN ACTION NOT RECORDED');
    } finally {
      state.pendingActions.delete(action);
      $('[data-action-submit]').disabled = false;
      syncActionPermissions();
    }
  }

  function initializeWorkflow() {
    $$('[data-workflow-action]').forEach((button) => button.addEventListener('click', () => openActionForm(button.dataset.workflowAction)));
    $('[data-action-form]').addEventListener('submit', submitAction);
    $('[data-action-cancel]').addEventListener('click', clearActionForm);
    syncActionPermissions();
  }

  function showSelectionState() {
    document.body.dataset.caseState = 'empty';
    $('[data-selection-state]').hidden = false;
    $('[data-dossier]').hidden = true;
    setCaseStatus('SELECT AN ASSET', 'NO API REQUEST ISSUED');
  }

  function showDossier() {
    $('[data-selection-state]').hidden = true;
    $('[data-dossier]').hidden = false;
  }

  function renderAsset(asset) {
    setText('[data-asset-id]', asset?.id || selectedAssetId, 'SELECT AN ASSET');
    setText('[data-asset-name]', asset?.name, 'ASSET SAFETY CASE');
    setText('[data-asset-type]', asset?.asset_type || asset?.type, 'TYPE NOT RETURNED');
    setText('[data-asset-location]', asset?.location, 'LOCATION NOT RETURNED');
    setText('[data-asset-status]', asset?.status, 'NOT RETURNED');
    setText('[data-asset-criticality]', asset?.criticality, 'NOT RETURNED');
  }

  function applyLevelState(level) {
    const normalized = normalizedLevel(level);
    document.body.dataset.riskLevel = normalized;
    $('[data-section="risk"]')?.setAttribute('data-level', normalized);
    $('[data-validator-state]')?.setAttribute('data-risk-level', normalized);
  }

  function renderGauge(risk) {
    const score = risk?.score;
    const level = risk?.level;
    const numericScore = Number(score);
    const scoreAvailable = hasValue(score) && Number.isFinite(numericScore);
    setText('[data-score]', score);
    setText('[data-summary-score]', score);
    setText('[data-summary-level]', level);
    setText('[data-gauge-level]', level, 'UNRESOLVED');
    setText('[data-priority]', risk?.priority);
    setText('[data-risk-state]', scoreAvailable ? 'ASSESSMENT LINKED' : 'RISK DATA EMPTY');
    setText('[data-asset-level]', level, 'UNRESOLVED');
    setText('[data-gauge-description]', scoreAvailable ? `Prototype risk index ${score} out of 100. Backend level ${display(level, 'unresolved')}.` : 'Risk score unresolved.');
    applyLevelState(level);

    const needle = $('[data-needle]');
    const progress = $('[data-gauge-progress]');
    if (needle) needle.style.setProperty('--gauge-angle', scoreAvailable ? `${-135 + Math.max(0, Math.min(100, numericScore)) * 2.7}deg` : '-135deg');
    if (progress) progress.style.strokeDashoffset = scoreAvailable ? String(100 - Math.max(0, Math.min(100, numericScore))) : '100';
    setSectionState('risk', scoreAvailable ? 'loaded' : 'empty');
  }

  function telemetryIsStale() {
    return state.health?.telemetry_stale === true;
  }

  function renderTelemetry(telemetry) {
    const hasTelemetry = telemetry && typeof telemetry === 'object' && Object.values(telemetry).some(hasValue);
    const stale = telemetryIsStale();
    setText('[data-temperature]', telemetry?.temperature);
    setText('[data-humidity]', hasValue(telemetry?.humidity) ? `${telemetry.humidity}%` : null);
    setText('[data-pressure]', telemetry?.pressure);
    setText('[data-source]', telemetry?.source);
    setText('[data-sample-time]', formatTimestamp(telemetry?.timestamp));

    const simulated = telemetry?.simulated;
    if (simulated === true) setText('[data-simulation-state]', 'SIMULATED TELEMETRY / BACKEND DECLARED');
    else if (simulated === false) setText('[data-simulation-state]', 'SIMULATION FLAG / FALSE');
    else setText('[data-simulation-state]', 'SIMULATION PROVENANCE NOT RETURNED');

    if (!hasTelemetry) {
      setText('[data-telemetry-state]', 'NO TELEMETRY RETURNED');
      setText('[data-stale-detail]', 'CURRENT READING UNAVAILABLE');
      setSectionState('telemetry', 'empty');
      return;
    }
    if (!state.health) {
      setText('[data-telemetry-state]', 'FRESHNESS UNVERIFIED');
      setText('[data-stale-detail]', 'BACKEND HEALTH STATE UNAVAILABLE');
      setSectionState('telemetry', 'unknown');
      return;
    }
    if (stale) {
      setText('[data-telemetry-state]', 'STALE / LAST KNOWN GOOD');
      setText('[data-stale-detail]', 'BACKEND HEALTH REPORTS TELEMETRY STALE');
      setSectionState('telemetry', 'stale');
      return;
    }
    setText('[data-telemetry-state]', 'CURRENT SAMPLE');
    setText('[data-stale-detail]', 'NO STALE FLAG RETURNED BY HEALTH');
    setSectionState('telemetry', 'loaded');
  }

  function renderTrend(trend) {
    const available = trend && typeof trend === 'object' && Object.values(trend).some(hasValue);
    setText('[data-trend-state]', available ? 'BACKEND TREND LINKED' : 'NO TREND RETURNED');
    setText('[data-trend-value]', trend?.state);
    setText('[data-temp-delta]', trend?.temp_delta_5_c);
    setText('[data-velocity]', trend?.velocity_score);
    setText('[data-trend-points]', Array.isArray(trend?.trend_points) ? formatList(trend.trend_points) : trend?.trend_points);
    const vector = $('[data-trend-vector]');
    if (vector) vector.dataset.direction = normalizedLevel(trend?.state);
    setSectionState('trend', available ? 'loaded' : 'empty');
  }

  function makeFactorRow(factor, isTop) {
    const row = document.createElement('article');
    row.className = 'factor-row';
    if (isTop) row.dataset.topContributor = 'true';

    const identity = document.createElement('div');
    const name = document.createElement('strong');
    const source = document.createElement('small');
    name.textContent = display(factor?.name, 'UNNAMED FACTOR');
    source.textContent = `SOURCE / ${display(factor?.source, 'NOT RETURNED')}`;
    identity.append(name, source);

    const value = document.createElement('span');
    value.textContent = display(factor?.value);
    const threshold = document.createElement('span');
    threshold.textContent = display(factor?.threshold);
    const contribution = document.createElement('b');
    contribution.textContent = display(factor?.contribution);

    const rail = document.createElement('div');
    rail.className = 'factor-rail';
    rail.setAttribute('aria-hidden', 'true');
    const fill = document.createElement('i');
    const numericContribution = Number(factor?.contribution);
    fill.style.width = Number.isFinite(numericContribution) ? `${Math.max(0, Math.min(100, numericContribution))}%` : '0%';
    rail.append(fill);
    row.append(identity, value, threshold, contribution, rail);
    return row;
  }

  function renderFactors(factors, riskScore) {
    const list = $('[data-factors]');
    list.replaceChildren();
    setText('[data-factor-score]', riskScore);
    if (!Array.isArray(factors) || !factors.length) {
      const empty = document.createElement('p');
      empty.className = 'empty-copy';
      empty.textContent = 'NO FACTORS RETURNED';
      list.append(empty);
      setText('[data-factor-state]', 'EMPTY');
      setSectionState('factors', 'empty');
      return;
    }
    const numeric = factors.map((factor) => Number(factor?.contribution));
    const topContribution = Math.max(...numeric.filter(Number.isFinite));
    factors.forEach((factor) => list.append(makeFactorRow(factor, Number(factor?.contribution) === topContribution)));
    setText('[data-factor-state]', `${factors.length} FACTORS RETURNED`);
    setSectionState('factors', 'loaded');
  }

  function renderExplanation(explanation, warnings) {
    setText('[data-explanation]', explanation, 'NO EXPLANATION RETURNED');
    setSectionState('explanation', hasValue(explanation) ? 'loaded' : 'empty');
    const stack = $('[data-warnings]');
    stack.replaceChildren();
    const items = Array.isArray(warnings) ? warnings : [];
    stack.hidden = !items.length;
    items.forEach((warning) => {
      const item = document.createElement('p');
      item.textContent = `DATA WARNING / ${display(warning)}`;
      stack.append(item);
    });
  }

  function renderConfidence(detail) {
    const available = detail && typeof detail === 'object' && Object.values(detail).some(hasValue);
    const score = Number(detail?.score);
    setText('[data-confidence]', detail?.score);
    setText('[data-confidence-reason]', detail?.reason, 'NO CONFIDENCE REASON RETURNED');
    setText('[data-channels-present]', formatList(detail?.channels_present));
    setText('[data-channels-missing]', formatList(detail?.channels_missing));
    const bar = $('[data-confidence-bar]');
    if (bar) bar.style.width = Number.isFinite(score) ? `${Math.max(0, Math.min(100, score))}%` : '0%';
    setSectionState('confidence', available ? 'loaded' : 'empty');
  }

  function renderMl(ml) {
    const available = ml && typeof ml === 'object' && Object.values(ml).some(hasValue);
    const status = ml?.status;
    setText('[data-ml-status]', status, available ? 'STATUS NOT RETURNED' : 'UNAVAILABLE');
    setText('[data-ml-model]', ml?.model);
    setText('[data-ml-anomaly]', hasValue(ml?.is_anomaly) ? String(ml.is_anomaly) : null);
    setText('[data-ml-score]', ml?.raw_score);
    setText('[data-ml-contribution]', ml?.contribution);
    const unavailable = !available || String(status).toUpperCase() === 'UNAVAILABLE';
    setText('[data-ml-message]', unavailable ? 'ML ANOMALY DETECTOR UNAVAILABLE / DETERMINISTIC ASSESSMENT REMAINS ACTIVE' : 'BACKEND ML ANOMALY SIGNAL RETURNED');
    setSectionState('ml', unavailable ? 'empty' : 'loaded');
  }

  function renderRecommendation(recommendation) {
    const available = recommendation && typeof recommendation === 'object' && Object.values(recommendation).some(hasValue);
    const provenance = recommendation?.provenance || {};
    const validation = recommendation?.validation;
    setText('[data-recommendation]', recommendation?.action, 'NO RECOMMENDATION RETURNED');
    setText('[data-recommendation-state]', available ? 'BACKEND RESPONSE' : 'EMPTY');
    setText('[data-sop-doc]', provenance?.doc_id);
    setText('[data-sop-title]', provenance?.title);
    setText('[data-sop-section]', provenance?.section);
    setText('[data-sop-version]', provenance?.version);
    const source = $('[data-sop-source]');
    if (source) {
      source.hidden = !hasValue(recommendation?.source);
      source.textContent = hasValue(recommendation?.source) ? `RETURNED SOURCE / ${recommendation.source}` : '';
    }
    setText('[data-validation]', validation);
    setText('[data-rule]', recommendation?.rule_fired, 'RULE NOT RETURNED');
    const gate = $('[data-validator-state]');
    if (gate) gate.dataset.validatorState = hasValue(validation) ? String(validation).toLowerCase() : 'unknown';
    setSectionState('recommendation', available ? 'loaded' : 'empty');
  }

  function downstreamId(item) {
    if (typeof item === 'string' || typeof item === 'number') return String(item);
    return hasValue(item?.asset_id) ? String(item.asset_id) : hasValue(item?.id) ? String(item.id) : null;
  }

  function renderDependencies(dependency) {
    const container = $('[data-dependencies]');
    container.replaceChildren();
    const downstream = Array.isArray(dependency?.downstream) ? dependency.downstream : [];
    setText('[data-dependency-count]', dependency?.downstream_count);
    setText('[data-dependency-impact]', dependency?.impact, 'NO DEPENDENCY IMPACT RETURNED');
    if (!downstream.length) {
      const empty = document.createElement('span');
      empty.className = 'empty-copy';
      empty.textContent = 'NO DOWNSTREAM ASSETS RETURNED';
      container.append(empty);
      setSectionState('dependency', hasValue(dependency?.impact) || hasValue(dependency?.downstream_count) ? 'loaded' : 'empty');
      return;
    }
    downstream.forEach((item, index) => {
      const id = downstreamId(item);
      const asset = state.assets.find((candidate) => id && String(candidate.id) === id);
      const element = id ? document.createElement('a') : document.createElement('div');
      element.className = 'dependency-node';
      if (id) element.href = `asset-safety-case.html?asset=${encodeURIComponent(id)}`;
      const sequence = document.createElement('span');
      sequence.textContent = String(index + 1).padStart(2, '0');
      const copy = document.createElement('div');
      const title = document.createElement('strong');
      const meta = document.createElement('small');
      title.textContent = display(asset?.name || item?.name || id, 'DOWNSTREAM ASSET');
      meta.textContent = id ? `ASSET ID / ${id}` : 'ASSET ID NOT RETURNED';
      copy.append(title, meta);
      element.append(sequence, copy);
      container.append(element);
    });
    setSectionState('dependency', 'loaded');
  }

  function renderRiskObject(payload) {
    const master = payload && typeof payload === 'object' ? payload : {};
    const risk = master.risk || {};
    renderGauge(risk);
    renderTelemetry(master.telemetry);
    renderTrend(master.trend);
    renderFactors(master.factors, risk.score);
    renderExplanation(master.explanation, master.data_warnings);
    renderConfidence(master.confidence_detail);
    renderMl(master.ml_anomaly);
    renderRecommendation(master.recommendation);
    renderDependencies(master.dependency);
  }

  function markLoading() {
    if (state.risk) return;
    ['risk', 'telemetry', 'trend', 'factors', 'explanation', 'confidence', 'ml', 'recommendation', 'dependency'].forEach((name) => setSectionState(name, 'loading'));
    setCaseStatus('CONNECTING TO SAFETY INTELLIGENCE', 'REQUESTING MASTER RISK OBJECT');
  }

  function markIdentityRequired() {
    document.body.dataset.caseState = 'identity';
    setText('[data-risk-state]', 'SELECT A VALID USER');
    setText('[data-telemetry-state]', 'IDENTITY REQUIRED');
    setCaseStatus('SELECT A VALID USER', 'RETURN TO COMMAND CENTER TO CHOOSE A BACKEND IDENTITY');
  }

  function markError(error) {
    document.body.dataset.caseState = state.risk ? 'stale' : 'error';
    if (state.risk) {
      renderTelemetry(state.risk.telemetry);
      setText('[data-telemetry-state]', 'LAST-KNOWN-GOOD / FEED UNAVAILABLE');
      setText('[data-stale-detail]', 'BACKEND REQUEST FAILED / READING RETAINED');
      setSectionState('telemetry', 'stale');
      setCaseStatus('SAFETY CASE FEED TEMPORARILY UNAVAILABLE', 'LAST-KNOWN-GOOD ASSESSMENT RETAINED');
      return;
    }
    ['risk', 'telemetry', 'trend', 'factors', 'explanation', 'confidence', 'ml', 'recommendation', 'dependency'].forEach((name) => setSectionState(name, 'error'));
    setText('[data-risk-state]', 'DATA UNAVAILABLE');
    setText('[data-telemetry-state]', 'DATA UNAVAILABLE');
    setText('[data-factor-state]', 'DATA UNAVAILABLE');
    setText('[data-recommendation-state]', 'DATA UNAVAILABLE');
    if (error?.status === 401) setCaseStatus('SELECT A VALID USER', 'BACKEND RETURNED 401 / IDENTITY MISSING OR UNKNOWN');
    else if (error?.status === 403) setCaseStatus('INSUFFICIENT BACKEND PERMISSION', 'BACKEND RETURNED 403 / REQUEST NOT EXECUTED');
    else setCaseStatus('SAFETY CASE DATA UNAVAILABLE', error?.status ? `API STATUS ${error.status}` : 'BACKEND REQUEST FAILED');
  }

  async function performRefresh() {
    const version = ++state.requestVersion;
    markLoading();
    if (!state.identityVerified || !selectedUser()) {
      markIdentityRequired();
      return;
    }
    try {
      const metadataNeeded = !state.asset || !state.assets.length;
      const [healthResult, riskResult, assetsResult] = await Promise.allSettled([
        window.RakshakAPI.loadHealth(),
        window.RakshakAPI.loadRisk(selectedAssetId),
        metadataNeeded ? window.RakshakAPI.loadAssets() : Promise.resolve(state.assets),
      ]);
      if (version !== state.requestVersion) return;
      if (riskResult.status === 'rejected') throw riskResult.reason;
      const health = healthResult.status === 'fulfilled' ? healthResult.value : null;
      const riskPayload = riskResult.value;
      const assetsPayload = assetsResult.status === 'fulfilled' ? assetsResult.value : state.assets;
      const assets = Array.isArray(assetsPayload) ? assetsPayload : Array.isArray(assetsPayload?.assets) ? assetsPayload.assets : [];
      const listAsset = assets.find((asset) => String(asset?.id) === String(selectedAssetId));
      state.health = health;
      state.assets = assets;
      state.asset = listAsset || state.asset || null;
      state.risk = riskPayload;
      state.lastGoodAt = new Date();
      renderAsset(state.asset || { id: riskPayload?.asset_id });
      renderRiskObject(riskPayload);
      document.body.dataset.caseState = telemetryIsStale() ? 'stale' : 'loaded';
      const systemState = !state.health ? 'ASSESSMENT LINKED / HEALTH STATE UNAVAILABLE' : telemetryIsStale() ? 'ASSESSMENT LINKED / TELEMETRY STALE' : 'SAFETY INTELLIGENCE LINKED';
      setCaseStatus(systemState, `UPDATED ${state.lastGoodAt.toLocaleTimeString()}`);
    } catch (error) {
      if (version === state.requestVersion) markError(error);
    }
  }

  function refresh() {
    if (state.refreshPromise) {
      state.refreshQueued = true;
      return state.refreshPromise;
    }
    state.refreshPromise = performRefresh().finally(() => {
      state.refreshPromise = null;
      if (state.refreshQueued) {
        state.refreshQueued = false;
        refresh();
      }
    });
    return state.refreshPromise;
  }

  function handleIdentityChange() {
    state.requestVersion += 1;
    state.actionVersion += 1;
    state.pendingActions.clear();
    const current = selectedUser();
    const verifiedUser = current ? state.users.find((user) => String(user.id) === String(current.id)) : null;
    state.identityVerified = Boolean(verifiedUser && sameUser(current, verifiedUser));
    state.risk = null;
    state.health = null;
    clearActionForm();
    clearScenario();
    setText('[data-action-result]', 'NO HUMAN ACTION SUBMITTED');
    syncActionPermissions();
    markLoading();
    if (state.identityVerified) refresh();
    else refreshWorkflowUsers().then(refresh);
  }

  initializeRoutes();
  if (!selectedAssetId) {
    showSelectionState();
    return;
  }
  showDossier();
  initializeWorkflow();
  clearScenario();
  window.addEventListener('rakshak:identity-change', handleIdentityChange);
  refreshWorkflowUsers().then(refresh);
  window.setInterval(() => {
    if (state.identityVerified && selectedUser()) refresh();
  }, POLL_MS);
}());
