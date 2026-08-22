const POLL_INTERVAL_MS = Number(window.RAKSHAK_POLL_INTERVAL_MS) || 900;
const LEVEL_COLOR = Object.freeze({ LOW: '#22c55e', MEDIUM: '#f2a93b', HIGH: '#ef4444', CRITICAL: '#ef4444' });
const TRAJECTORY_STATES = Object.freeze({
  selection: Object.freeze({ status: 'AWAITING ASSET SELECTION', message: 'AWAITING ASSET SELECTION', ui: 'empty' }),
  integration: Object.freeze({ status: 'AWAITING TELEMETRY INTEGRATION', message: 'AWAITING TELEMETRY INTEGRATION', ui: 'empty' }),
  loading: Object.freeze({ status: 'AWAITING TELEMETRY', message: 'AWAITING TELEMETRY', ui: 'loading' }),
  empty: Object.freeze({ status: 'NO TELEMETRY AVAILABLE', message: 'NO TELEMETRY AVAILABLE', ui: 'empty' }),
  error: Object.freeze({ status: 'TELEMETRY UNAVAILABLE', message: 'TELEMETRY UNAVAILABLE', ui: 'error' }),
});
const ACTIVITY_STATES = Object.freeze({
  loading: Object.freeze({ status: 'AWAITING RECENT ACTIVITY', message: 'AWAITING RECENT ACTIVITY', detail: 'NO EVENT ROWS FABRICATED', ui: 'loading' }),
  empty: Object.freeze({ status: 'NO RECENT ACTIVITY', message: 'NO RECENT ACTIVITY', detail: 'AUTHORITATIVE SOURCE RETURNED NO EVENTS', ui: 'empty' }),
  error: Object.freeze({ status: 'ACTIVITY DATA UNAVAILABLE', message: 'ACTIVITY DATA UNAVAILABLE', detail: 'NO LOCAL FALLBACK EVENTS CREATED', ui: 'error' }),
  contract: Object.freeze({ status: 'AWAITING ALERT SOURCE', message: 'AWAITING ALERT INTEGRATION', detail: 'NO AUTHORITATIVE ALERT SOURCE CONFIRMED', ui: 'empty' }),
});
const QUEUE_STATES = Object.freeze({
  selection: Object.freeze({ status: 'SELECT INSPECTOR IDENTITY', message: 'SELECT INSPECTOR IDENTITY', detail: 'QUEUE USES THE ACTIVE BACKEND-PROVIDED ROLE', ui: 'empty' }),
  role: Object.freeze({ status: 'INSPECTOR ROLE REQUIRED', message: 'INSPECTOR-SPECIFIC QUEUE', detail: 'SELECT A RETURNED INSPECTOR IDENTITY TO VIEW ASSIGNMENTS', ui: 'empty' }),
  loading: Object.freeze({ status: 'AWAITING ASSIGNMENTS', message: 'AWAITING ASSIGNMENTS', detail: 'PROTECTED WORK REGISTER REQUEST IN PROGRESS', ui: 'loading' }),
  empty: Object.freeze({ status: 'NO OPEN ASSIGNMENTS', message: 'NO OPEN ASSIGNMENTS', detail: 'AUTHORIZED RESPONSE RETURNED NO OPEN WORK', ui: 'empty' }),
  error: Object.freeze({ status: 'ASSIGNMENT DATA UNAVAILABLE', message: 'ASSIGNMENT DATA UNAVAILABLE', detail: 'NO FALLBACK ASSIGNMENTS CREATED', ui: 'error' }),
  unauthorized: Object.freeze({ status: 'SELECT A VALID USER', message: 'VALID IDENTITY REQUIRED', detail: 'BACKEND RETURNED 401 FOR THE ASSIGNMENT REQUEST', ui: 'error' }),
  forbidden: Object.freeze({ status: 'INSUFFICIENT ROLE PERMISSION', message: 'INSPECTOR QUEUE UNAVAILABLE', detail: 'BACKEND RETURNED 403 FOR THE SELECTED IDENTITY', ui: 'error' }),
  contract: Object.freeze({ status: 'AWAITING ASSIGNMENT CONTRACT', message: 'AWAITING ASSIGNMENT INTEGRATION', detail: 'RESPONSE RECEIVED; ROW SCHEMA REQUIRES CONFIRMATION', ui: 'empty' }),
});
const DEMO_COMMAND_METHODS = Object.freeze({ reset: 'resetDemo', escalate: 'escalateDemo', resolve: 'resolveDemo' });

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let selectedId = null;
const cache = { assets: null, priorities: null };
const selectionListeners = new Set();
let queueRequestVersion = 0;
let queueRequestUserId = null;
let queueBlockedUserId = null;
let protectedRequestVersion = 0;
let demoCommandInFlight = false;

function setText(selector, value) {
  $$(selector).forEach((element) => { element.textContent = value; });
}

function setRegionState(selector, state) {
  const element = $(selector);
  if (element) element.dataset.uiState = state;
}

function hasReturnedField(payload, field) {
  return payload && Object.prototype.hasOwnProperty.call(payload, field) && payload[field] !== null && payload[field] !== undefined;
}

function setHealthReadout(name, value, state) {
  setText(`[data-health-${name}]`, value);
  const readout = `[data-health-readout="${name === 'status' ? 'status' : name}"]`;
  const element = $(readout);
  if (element) element.dataset.state = state;
}

function renderHealth(payload) {
  const statusAvailable = hasReturnedField(payload, 'status');
  const modeAvailable = hasReturnedField(payload, 'mode');
  const connectionAvailable = hasReturnedField(payload, 'esp32_connected') && typeof payload.esp32_connected === 'boolean';
  const staleAvailable = hasReturnedField(payload, 'telemetry_stale') && typeof payload.telemetry_stale === 'boolean';
  const status = statusAvailable ? String(payload.status) : 'UNAVAILABLE';
  const mode = modeAvailable ? String(payload.mode) : 'UNAVAILABLE';

  setHealthReadout('status', status, statusAvailable && status.toLowerCase() === 'ok' ? 'positive' : statusAvailable ? 'caution' : 'unknown');
  setHealthReadout('mode', mode, modeAvailable ? 'mode' : 'unknown');
  setHealthReadout('hardware', connectionAvailable ? (payload.esp32_connected ? 'ESP32 CONNECTED' : 'ESP32 DISCONNECTED') : 'UNAVAILABLE', connectionAvailable ? (payload.esp32_connected ? 'positive' : 'caution') : 'unknown');
  setHealthReadout('telemetry', staleAvailable ? (payload.telemetry_stale ? 'STALE TELEMETRY' : 'TELEMETRY FRESH') : 'UNAVAILABLE', staleAvailable ? (payload.telemetry_stale ? 'caution' : 'active') : 'unknown');

  const cluster = $('[data-health-cluster]');
  if (cluster) {
    cluster.dataset.uiState = 'loaded';
    cluster.dataset.mode = modeAvailable ? mode.toLowerCase() : 'unknown';
    cluster.dataset.telemetryState = staleAvailable ? (payload.telemetry_stale ? 'stale' : 'fresh') : 'unknown';
  }
  document.body.dataset.telemetryFreshness = staleAvailable ? (payload.telemetry_stale ? 'stale' : 'fresh') : 'unknown';
  setTrajectoryFreshness(staleAvailable, staleAvailable ? payload.telemetry_stale : false);
  const header = $('[data-system-state]');
  if (header) {
    header.dataset.uiState = 'loaded';
    header.dataset.state = statusAvailable && status.toLowerCase() === 'ok' ? 'positive' : statusAvailable ? 'caution' : 'unknown';
  }
  setText('[data-header-system-status]', statusAvailable ? `BACKEND / ${status}` : 'BACKEND STATUS UNAVAILABLE');
}

function renderHealthError() {
  const cluster = $('[data-health-cluster]');
  if (cluster) {
    cluster.dataset.uiState = 'error';
    cluster.dataset.mode = 'unknown';
    cluster.dataset.telemetryState = 'unknown';
  }
  document.body.dataset.telemetryFreshness = 'unknown';
  setTrajectoryFreshness(false, false);
  ['status', 'mode', 'hardware', 'telemetry'].forEach((name) => setHealthReadout(name, 'UNAVAILABLE', 'unknown'));
  const header = $('[data-system-state]');
  if (header) {
    header.dataset.uiState = 'error';
    header.dataset.state = 'error';
  }
  setText('[data-header-system-status]', 'RISKRADAR BACKEND UNAVAILABLE');
}

async function refreshHealth() {
  try {
    renderHealth(await window.RakshakAPI.loadHealth());
  } catch {
    renderHealthError();
  }
}

function assetList(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.assets) ? payload.assets : [];
}

function priorityList(payload) {
  return Array.isArray(payload) ? payload : Array.isArray(payload?.priorities) ? payload.priorities : [];
}

function displayedValue(value) {
  return value === undefined || value === null || value === '' ? '—' : value;
}

function setNodeText(element, value) {
  const nextValue = String(displayedValue(value));
  if (element && element.textContent !== nextValue) element.textContent = nextValue;
}

function setTrajectoryPanelState(state) {
  const panel = $('.trajectory');
  const nextState = TRAJECTORY_STATES[state] || TRAJECTORY_STATES.integration;
  if (!panel) return;
  panel.dataset.plotState = state;
  panel.dataset.uiState = nextState.ui;
  setText('[data-telemetry-state]', nextState.status);
  setText('[data-chart-empty]', nextState.message);
  const emptyState = $('[data-chart-empty]');
  if (emptyState) emptyState.hidden = false;
  if (state === 'selection' || state === 'integration') {
    setText('[data-current-temperature]', '—');
    $('[data-trajectory-line]')?.setAttribute('d', '');
    $('[data-chart-points]')?.replaceChildren();
  }
}

function setTrajectoryFreshness(staleAvailable, isStale) {
  const panel = $('.trajectory');
  const freshness = staleAvailable ? (isStale ? 'stale' : 'fresh') : 'unknown';
  if (panel) panel.dataset.telemetryFreshness = freshness;
  setText('[data-trajectory-freshness]', staleAvailable ? `BACKEND FRESHNESS / ${isStale ? 'STALE' : 'FRESH'}` : 'BACKEND FRESHNESS / UNKNOWN');
}

function setActivityState(state) {
  const panel = $('.activity-panel');
  const list = $('[data-activity-list]');
  const nextState = ACTIVITY_STATES[state] || ACTIVITY_STATES.contract;
  if (!panel || !list) return;
  panel.dataset.activityState = state;
  panel.dataset.uiState = nextState.ui;
  setText('[data-activity-status]', nextState.status);
  list.innerHTML = `<li class="activity-state"><div class="technical-state compact"><i aria-hidden="true"></i><strong>${nextState.message}</strong><small>${nextState.detail}</small></div></li>`;
}

function setInspectorQueueState(state) {
  const panel = $('.inspector-queue');
  const list = $('[data-assignment-list]');
  const nextState = QUEUE_STATES[state] || QUEUE_STATES.selection;
  if (!panel || !list) return;
  if (panel.dataset.queueState === state) return;
  panel.dataset.queueState = state;
  panel.dataset.uiState = nextState.ui;
  setText('[data-assignments-state]', nextState.status);
  list.innerHTML = `<li class="queue-state"><div class="technical-state compact"><i aria-hidden="true"></i><strong>${nextState.message}</strong><small>${nextState.detail}</small></div></li>`;
}

function protectedRequestIsCurrent(version, userId) {
  const currentUserId = window.RakshakIdentity?.getSelectedUserId();
  return version === protectedRequestVersion && String(currentUserId) === String(userId);
}

function clearProtectedCommandData() {
  cache.assets = null;
  cache.priorities = null;
  setText('[data-plant-status]', 'AWAITING ASSET DATA');
  setText('[data-plant-count]', '—');
  setText('[data-assets-state]', 'AWAITING ASSET DATA');
  setRegionState('.runtime-channel:first-child', 'loading');
  const assetMount = $('[data-assets]');
  if (assetMount) assetMount.innerHTML = '<div class="technical-state"><i aria-hidden="true"></i><strong>AWAITING ASSET DATA</strong><small>PROTECTED DATA REFRESH PENDING</small></div>';
  setRegionState('.asset-section', 'loading');
  setText('[data-priority-state]', 'AWAITING PRIORITY DATA');
  renderPriorityState('AWAITING PRIORITY DATA', 'PROTECTED RANKING REFRESH PENDING', 'loading');
  clearSelectedAsset();
}

function handleProtectedAuthorizationFailure(status) {
  if (status !== 401 && status !== 403) return false;
  protectedPollingEnabled = false;
  protectedRequestVersion += 1;
  clearProtectedCommandData();
  if (status === 401) {
    setInspectorQueueState('unauthorized');
    setText('.nav-status', 'SELECTED IDENTITY IS REQUIRED OR NOT RECOGNIZED.');
  } else {
    setInspectorQueueState('forbidden');
    setText('.nav-status', 'SELECTED IDENTITY DOES NOT HAVE PERMISSION.');
  }
  return true;
}

function syncDemoControls(user) {
  const root = $('[data-demo-controls]');
  if (!root) return;
  const isAdmin = Boolean(user) && String(user.role).toLowerCase() === 'admin';
  root.dataset.state = isAdmin ? 'ready' : 'locked';
  $$('[data-demo-command]').forEach((button) => { button.disabled = !isAdmin || demoCommandInFlight; });
  if (!user) setText('[data-demo-status]', 'SELECT ADMIN IDENTITY');
  else if (!isAdmin) setText('[data-demo-status]', 'ADMIN ROLE REQUIRED');
  else setText('[data-demo-status]', 'BACKEND COMMANDS READY');
}

async function refreshAfterMutation() {
  if (refreshPromise) {
    refreshQueued = true;
    await refreshPromise;
  }
  await refreshAll();
}

async function runDemoCommand(command) {
  const method = DEMO_COMMAND_METHODS[command];
  const user = window.RakshakIdentity?.getSelectedUser();
  const isAdmin = Boolean(user) && String(user.role).toLowerCase() === 'admin';
  if (!method || !isAdmin || demoCommandInFlight) return;
  const userId = String(user.id);
  demoCommandInFlight = true;
  $$('[data-demo-command]').forEach((button) => { button.disabled = true; });
  setText('[data-demo-status]', 'BACKEND COMMAND IN PROGRESS');
  try {
    await window.RakshakAPI[method]();
    await refreshAfterMutation();
    if (String(window.RakshakIdentity?.getSelectedUserId()) === userId) setText('[data-demo-status]', 'BACKEND COMMAND COMPLETE / STATE REFRESHED');
  } catch (error) {
    if (String(window.RakshakIdentity?.getSelectedUserId()) !== userId) return;
    if (error?.status === 401) setText('[data-demo-status]', 'SELECT A VALID ADMIN USER');
    else if (error?.status === 403) setText('[data-demo-status]', 'ADMIN PERMISSION REQUIRED');
    else setText('[data-demo-status]', 'BACKEND COMMAND UNAVAILABLE');
  } finally {
    demoCommandInFlight = false;
    const currentUser = window.RakshakIdentity?.getSelectedUser();
    const stillAdmin = Boolean(currentUser) && String(currentUser.role).toLowerCase() === 'admin';
    const root = $('[data-demo-controls]');
    if (root) root.dataset.state = stillAdmin ? 'ready' : 'locked';
    $$('[data-demo-command]').forEach((button) => { button.disabled = !stillAdmin; });
    if (String(currentUser?.id) !== userId) syncDemoControls(currentUser || null);
  }
}

function initializeDemoControls() {
  $$('[data-demo-command]').forEach((button) => button.addEventListener('click', () => runDemoCommand(button.dataset.demoCommand)));
  syncDemoControls(window.RakshakIdentity?.getSelectedUser() || null);
}

async function refreshInspectorQueue(user) {
  const hasIdentity = user?.id !== undefined && user?.id !== null && String(user.id).trim();
  if (!hasIdentity) {
    setInspectorQueueState('selection');
    return;
  }
  if (String(user.role).toLowerCase() !== 'inspector') {
    setInspectorQueueState('role');
    return;
  }

  const userId = String(user.id);
  if (queueBlockedUserId === userId || queueRequestUserId === userId) return;
  const requestVersion = queueRequestVersion;
  queueRequestUserId = userId;
  const panel = $('.inspector-queue');
  if (panel?.dataset.queueIdentity !== userId) {
    panel.dataset.queueIdentity = userId;
    setInspectorQueueState('loading');
  }

  try {
    await window.RakshakAPI.loadAssignments();
    const activeUserId = window.RakshakIdentity?.getSelectedUserId();
    if (requestVersion !== queueRequestVersion || String(activeUserId) !== userId) return;
    setInspectorQueueState('contract');
  } catch (error) {
    const activeUserId = window.RakshakIdentity?.getSelectedUserId();
    if (requestVersion !== queueRequestVersion || String(activeUserId) !== userId) return;
    if (error?.status === 401) {
      queueBlockedUserId = userId;
      setInspectorQueueState('unauthorized');
    } else if (error?.status === 403) {
      queueBlockedUserId = userId;
      setInspectorQueueState('forbidden');
    } else {
      setInspectorQueueState('error');
    }
  } finally {
    if (queueRequestUserId === userId) queueRequestUserId = null;
  }
}

function publishSelection(asset) {
  selectionListeners.forEach((listener) => listener(asset || null));
  window.dispatchEvent(new CustomEvent('rakshak:asset-selection', { detail: { asset: asset || null } }));
}

window.RakshakSelection = Object.freeze({
  getSelectedAssetId: () => selectedId,
  getSelectedAsset: () => assetList(cache.assets).find((item) => String(item.id) === String(selectedId)) || null,
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    selectionListeners.add(listener);
    return () => selectionListeners.delete(listener);
  },
});

$$('[data-route]').forEach((link) => link.addEventListener('click', (event) => {
  const route = window.RakshakRoutes?.[link.dataset.route];
  if (!route?.path) return;
  event.preventDefault();
  window.location.href = route.path;
}));

$$('[data-pending]').forEach((link) => link.addEventListener('click', (event) => {
  const route = Object.values(window.RakshakRoutes || {}).find((item) => item.label === link.dataset.pending);
  if (route?.path) {
    event.preventDefault();
    window.location.href = route.path;
    return;
  }
  event.preventDefault();
  setText('.nav-status', `${link.dataset.pending} route pending.`);
}));

function renderSelectedAsset(asset) {
  if (!asset?.id) return;
  const risk = asset.risk || {};
  selectedId = asset.id;
  setText('[data-selected-asset]', asset.id);
  setText('[data-selected-id]', asset.id);
  setText('[data-selected-name]', displayedValue(asset.name));
  setText('[data-selected-location]', displayedValue(asset.location));
  setText('[data-selected-risk]', displayedValue(risk.score));
  setText('[data-selected-level]', displayedValue(risk.level));
  setText('[data-selected-priority]', displayedValue(risk.priority));
  const selectedDial = $('[data-selected-dial]');
  const selectedDialValue = riskGaugeValue(risk.score);
  if (selectedDial) {
    selectedDial.dataset.level = levelKey(risk.level).toLowerCase();
    selectedDial.querySelector('span').textContent = displayedValue(risk.score);
    selectedDial.querySelector('i').style.opacity = selectedDialValue === null ? '0' : '1';
    if (selectedDialValue !== null) selectedDial.querySelector('i').style.transform = `rotate(${-135 + selectedDialValue * 2.7}deg)`;
  }
  $$('.asset-instrument').forEach((instrument) => instrument.setAttribute('aria-pressed', String(instrument.dataset.assetId) === String(asset.id) ? 'true' : 'false'));
  updatePrioritySelection();
  setRegionState('.runtime-channel:nth-child(2)', 'loaded');
  setText('[data-trajectory-asset]', `${displayedValue(asset.name)} / ${asset.id}`);
  setTrajectoryPanelState('integration');
  const safetyCaseLink = $('[data-open-safety-case]');
  if (safetyCaseLink) {
    safetyCaseLink.href = `asset-safety-case.html?asset=${encodeURIComponent(asset.id)}`;
    safetyCaseLink.hidden = false;
  }
  publishSelection(asset);
}

function selectAsset(assetId) {
  if (!assetId) return;
  const asset = assetList(cache.assets).find((item) => String(item.id) === String(assetId));
  if (asset) renderSelectedAsset(asset);
}

function clearSelectedAsset() {
  selectedId = null;
  setText('[data-selected-asset]', 'AWAITING SELECTION');
  setText('[data-selected-id], [data-selected-location], [data-selected-risk], [data-selected-level], [data-selected-priority]', '—');
  setText('[data-selected-name]', 'AWAITING SELECTION');
  const selectedDial = $('[data-selected-dial]');
  if (selectedDial) {
    selectedDial.dataset.level = '';
    selectedDial.querySelector('span').textContent = '—';
    selectedDial.querySelector('i').style.opacity = '0';
  }
  const safetyCaseLink = $('[data-open-safety-case]');
  if (safetyCaseLink) safetyCaseLink.hidden = true;
  updatePrioritySelection();
  setText('[data-trajectory-asset]', 'AWAITING ASSET SELECTION');
  setTrajectoryPanelState('selection');
  setRegionState('.runtime-channel:nth-child(2)', 'empty');
  publishSelection(null);
}

function riskGaugeValue(score) {
  if (score === null || score === undefined || score === '') return null;
  const value = Number(score);
  return Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
}

function levelKey(level) {
  const key = String(level || '').toUpperCase();
  return Object.prototype.hasOwnProperty.call(LEVEL_COLOR, key) ? key : 'UNRESOLVED';
}

function instrumentMarkup() {
  return `<span class="instrument-active-marker" aria-hidden="true"></span>
    <header class="instrument-header"><span data-module-id>—</span><span data-module-type>—</span></header>
    <div class="instrument-identity"><strong data-module-name>—</strong><span data-module-location>—</span></div>
    <div class="risk-instrument">
      <svg class="mini-gauge" viewBox="0 0 160 130" role="img" aria-label="Risk index awaiting backend value">
        <path class="mini-track" pathLength="100" d="M44.6 105.4 A50 50 0 1 1 115.4 105.4" />
        <path class="mini-value-arc" pathLength="100" d="M44.6 105.4 A50 50 0 1 1 115.4 105.4" />
        <g class="gauge-ticks" aria-hidden="true"><path d="M45 105l7-5M30 70h9M45 35l7 6M80 20v9M115 35l-7 6M130 70h-9M115 105l-7-5" /></g>
        <line class="mini-needle" x1="80" y1="106" x2="80" y2="53" />
        <circle class="gauge-hub" cx="80" cy="106" r="5" />
      </svg>
      <div class="gauge-readout"><span>RISK INDEX</span><strong data-module-score>—</strong><div class="gauge-state"><i class="risk-state-indicator" aria-hidden="true"></i><b data-module-level>AWAITING</b></div></div>
    </div>
    <div class="instrument-readouts"><div><span>PRIORITY</span><strong data-module-priority>—</strong></div><div><span>CRITICALITY</span><strong data-module-criticality>—</strong></div></div>
    <div class="sparkline-mount"><span>TELEMETRY SPARKLINE</span><div class="sparkline-frame" aria-label="Telemetry sparkline awaiting confirmed backend contract"><small>AWAITING TELEMETRY CONTRACT</small></div></div>
    <footer class="instrument-footer"><span>ASSET STATUS</span><strong data-module-status>—</strong></footer>`;
}

function createAssetInstrument(key) {
  const instrument = document.createElement('button');
  instrument.type = 'button';
  instrument.className = 'asset-instrument';
  instrument.dataset.assetKey = key;
  instrument.setAttribute('aria-pressed', 'false');
  instrument.innerHTML = instrumentMarkup();
  instrument.addEventListener('click', () => selectAsset(instrument.dataset.assetId));
  return instrument;
}

function updateAssetInstrument(instrument, asset) {
  const risk = asset.risk || {};
  const visualScore = riskGaugeValue(risk.score);
  const returnedLevel = levelKey(risk.level);
  const color = LEVEL_COLOR[returnedLevel] || '#8a93a1';
  instrument.dataset.assetId = asset.id == null ? '' : String(asset.id);
  instrument.dataset.level = returnedLevel.toLowerCase();
  instrument.disabled = !instrument.dataset.assetId;
  instrument.setAttribute('aria-pressed', String(asset.id) === String(selectedId) ? 'true' : 'false');
  instrument.setAttribute('aria-label', `${displayedValue(asset.name)} / risk ${displayedValue(risk.score)} / level ${displayedValue(risk.level)}`);
  instrument.querySelector('[data-module-id]').textContent = displayedValue(asset.id);
  instrument.querySelector('[data-module-type]').textContent = displayedValue(asset.asset_type);
  instrument.querySelector('[data-module-name]').textContent = displayedValue(asset.name);
  instrument.querySelector('[data-module-location]').textContent = displayedValue(asset.location);
  instrument.querySelector('[data-module-score]').textContent = displayedValue(risk.score);
  instrument.querySelector('[data-module-level]').textContent = displayedValue(risk.level);
  instrument.querySelector('[data-module-priority]').textContent = displayedValue(risk.priority);
  instrument.querySelector('[data-module-criticality]').textContent = displayedValue(asset.criticality);
  instrument.querySelector('[data-module-status]').textContent = displayedValue(asset.status);
  const gauge = instrument.querySelector('.mini-gauge');
  const arc = instrument.querySelector('.mini-value-arc');
  const needle = instrument.querySelector('.mini-needle');
  gauge.setAttribute('aria-label', visualScore === null ? 'Risk index awaiting backend value' : `Risk index ${risk.score}, level ${displayedValue(risk.level)}`);
  arc.style.stroke = color;
  needle.style.stroke = color;
  if (visualScore === null) {
    instrument.dataset.gaugeState = 'unresolved';
    arc.style.strokeDasharray = '0 100';
    needle.style.opacity = '0';
    delete instrument.dataset.renderedScore;
    return;
  }
  instrument.dataset.gaugeState = 'resolved';
  arc.style.strokeDasharray = `${visualScore} 100`;
  needle.style.opacity = '1';
  needle.style.transform = `rotate(${-135 + visualScore * 2.7}deg)`;
  instrument.dataset.renderedScore = String(risk.score);
}

function renderAssets(items) {
  const element = $('[data-assets]');
  if (!element) return;
  if (!items.length) {
    element.innerHTML = '<div class="technical-state"><i aria-hidden="true"></i><strong>NO ASSET DATA AVAILABLE</strong><small>INSTRUMENT MOUNTS REMAIN READY</small></div>';
    clearSelectedAsset();
    setRegionState('.asset-section', 'empty');
    setRegionState('.runtime-channel:nth-child(2)', 'empty');
    return;
  }

  element.querySelector('.technical-state')?.remove();
  const existing = new Map($$('.asset-instrument').map((instrument) => [instrument.dataset.assetKey, instrument]));
  const activeKeys = new Set();
  items.forEach((asset, index) => {
    const key = asset.id == null || asset.id === '' ? `record-${index}` : String(asset.id);
    activeKeys.add(key);
    const instrument = existing.get(key) || createAssetInstrument(key);
    updateAssetInstrument(instrument, asset);
    const currentAtIndex = element.children[index];
    if (currentAtIndex !== instrument) element.insertBefore(instrument, currentAtIndex || null);
  });
  existing.forEach((instrument, key) => { if (!activeKeys.has(key)) instrument.remove(); });
  setRegionState('.asset-section', 'loaded');
}

function updatePrioritySelection() {
  $$('.priority-record').forEach((row) => {
    const isSelected = selectedId !== null && String(row.dataset.assetId) === String(selectedId);
    row.setAttribute('aria-selected', String(isSelected));
  });
}

function createPriorityRow(key) {
  const row = document.createElement('tr');
  row.className = 'priority-record';
  row.dataset.priorityKey = key;
  row.innerHTML = `
    <td class="priority-rank"><strong data-priority-rank>—</strong><small data-top-priority>CURRENT PRIORITY</small></td>
    <td class="priority-asset"><strong data-priority-name>—</strong><small data-priority-asset-id>—</small></td>
    <td class="priority-risk" data-priority-risk>—</td>
    <td class="priority-level" data-priority-level>—</td>
    <td class="priority-trend" data-priority-trend>—</td>
    <td class="priority-score" data-priority-score>—</td>`;
  row.addEventListener('click', () => selectAsset(row.dataset.assetId));
  row.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    selectAsset(row.dataset.assetId);
  });
  return row;
}

function updatePriorityRow(row, item, index) {
  const assetIdAvailable = item.asset_id !== undefined && item.asset_id !== null && item.asset_id !== '';
  row.dataset.assetId = assetIdAvailable ? String(item.asset_id) : '';
  row.dataset.selectable = String(assetIdAvailable);
  row.dataset.level = levelKey(item.level).toLowerCase();
  row.dataset.topPriority = String(index === 0);
  row.tabIndex = assetIdAvailable ? 0 : -1;
  row.setAttribute('aria-label', `Rank ${displayedValue(item.rank)}, ${displayedValue(item.name)}, risk ${displayedValue(item.risk)}, level ${displayedValue(item.level)}, trend ${displayedValue(item.trend)}, priority ${displayedValue(item.priority)}`);
  setNodeText(row.querySelector('[data-priority-rank]'), item.rank);
  setNodeText(row.querySelector('[data-priority-name]'), item.name);
  setNodeText(row.querySelector('[data-priority-asset-id]'), item.asset_id);
  setNodeText(row.querySelector('[data-priority-risk]'), item.risk);
  setNodeText(row.querySelector('[data-priority-level]'), item.level);
  setNodeText(row.querySelector('[data-priority-trend]'), item.trend);
  setNodeText(row.querySelector('[data-priority-score]'), item.priority);
}

function renderPriorityState(title, detail, state) {
  const body = $('[data-priority-body]');
  if (!body) return;
  body.innerHTML = `<tr class="priority-state-row"><td colspan="6"><div class="technical-state"><i aria-hidden="true"></i><strong>${title}</strong><small>${detail}</small></div></td></tr>`;
  setRegionState('.priority', state);
}

function renderPriorities(items) {
  const body = $('[data-priority-body]');
  if (!body) return;
  if (!items.length) {
    renderPriorityState('NO PRIORITY DATA AVAILABLE', 'BACKEND RETURNED NO RANKED RECORDS', 'empty');
    return;
  }

  body.querySelector('.priority-state-row')?.remove();
  const existing = new Map($$('.priority-record').map((row) => [row.dataset.priorityKey, row]));
  const activeKeys = new Set();
  items.forEach((item, index) => {
    const key = item.asset_id === undefined || item.asset_id === null || item.asset_id === '' ? `priority-record-${index}` : String(item.asset_id);
    activeKeys.add(key);
    const row = existing.get(key) || createPriorityRow(key);
    updatePriorityRow(row, item, index);
    const currentAtIndex = body.children[index];
    if (currentAtIndex !== row) body.insertBefore(row, currentAtIndex || null);
  });
  existing.forEach((row, key) => { if (!activeKeys.has(key)) row.remove(); });
  updatePrioritySelection();
  setRegionState('.priority', 'loaded');
}

async function refreshProtectedData() {
  const requestVersion = protectedRequestVersion;
  const requestUserId = window.RakshakIdentity?.getSelectedUserId();
  if (requestUserId === null || requestUserId === undefined) return;
  try {
    const assetsPayload = await window.RakshakAPI.loadAssets();
    if (!protectedRequestIsCurrent(requestVersion, requestUserId)) return;
    cache.assets = assetsPayload;
    const assets = assetList(assetsPayload);
    renderAssets(assets);
    setText('[data-plant-status]', assets.length ? 'ASSET DATA LINKED' : 'NO ASSET DATA AVAILABLE');
    setText('[data-plant-count]', assets.length ? `${assets.length} MONITORED ASSETS` : '—');
    setText('[data-assets-state]', assets.length ? 'ASSET DATA LINKED' : 'NO ASSET DATA AVAILABLE');
    setRegionState('.runtime-channel:first-child', assets.length ? 'loaded' : 'empty');

    let selectedAsset = assets.find((asset) => String(asset.id) === String(selectedId));
    if (!selectedAsset) selectedAsset = assets.find((asset) => asset.id !== null && asset.id !== undefined && asset.id !== '');
    if (selectedAsset) renderSelectedAsset(selectedAsset); else clearSelectedAsset();
  } catch (error) {
    if (!protectedRequestIsCurrent(requestVersion, requestUserId)) return;
    if (handleProtectedAuthorizationFailure(error?.status)) return;
    setText('[data-plant-status]', 'ASSET DATA UNAVAILABLE');
    setText('[data-assets-state]', 'ASSET DATA UNAVAILABLE');
    setRegionState('.asset-section', 'error');
    setRegionState('.runtime-channel:first-child', 'error');
    if (!cache.assets) {
      const assetMount = $('[data-assets]');
      if (assetMount) assetMount.innerHTML = '<div class="technical-state"><i aria-hidden="true"></i><strong>RISKRADAR BACKEND UNAVAILABLE</strong><small>ASSET DATA COULD NOT BE RECEIVED</small></div>';
    }
  }

  try {
    const prioritiesPayload = await window.RakshakAPI.loadPriorities();
    if (!protectedRequestIsCurrent(requestVersion, requestUserId)) return;
    cache.priorities = prioritiesPayload;
    const priorities = priorityList(prioritiesPayload);
    renderPriorities(priorities);
    setText('[data-priority-state]', priorities.length ? 'PRIORITY DATA LINKED' : 'NO PRIORITY DATA AVAILABLE');
  } catch (error) {
    if (!protectedRequestIsCurrent(requestVersion, requestUserId)) return;
    if (handleProtectedAuthorizationFailure(error?.status)) return;
    if (!cache.priorities) {
      setText('[data-priority-state]', 'PRIORITY DATA UNAVAILABLE');
      renderPriorityState('PRIORITY DATA UNAVAILABLE', 'RETRY WHEN BACKEND RETURNS', 'error');
    }
  }

}

let pollingTimer = null;
let protectedPollingEnabled = false;
let refreshPromise = null;
let refreshQueued = false;

function refreshAll() {
  if (refreshPromise) {
    refreshQueued = true;
    return refreshPromise;
  }
  refreshPromise = (async () => {
    const work = [refreshHealth()];
    if (window.RakshakRolePicker?.refresh) work.push(window.RakshakRolePicker.refresh());
    if (protectedPollingEnabled) {
      work.push(refreshProtectedData());
      work.push(refreshInspectorQueue(window.RakshakIdentity?.getSelectedUser() || null));
    }
    await Promise.allSettled(work);
  })().finally(() => {
    refreshPromise = null;
    if (refreshQueued) {
      refreshQueued = false;
      refreshAll();
    }
  });
  return refreshPromise;
}

function stopPolling() {
  if (pollingTimer === null) return;
  window.clearInterval(pollingTimer);
  pollingTimer = null;
}

function startPolling() {
  stopPolling();
  refreshAll();
  pollingTimer = window.setInterval(refreshAll, POLL_INTERVAL_MS);
}

function handleIdentityChange(user) {
  protectedRequestVersion += 1;
  queueRequestVersion += 1;
  queueRequestUserId = null;
  queueBlockedUserId = null;
  const queuePanel = $('.inspector-queue');
  if (queuePanel) queuePanel.dataset.queueIdentity = '';
  syncDemoControls(user || null);
  clearProtectedCommandData();
  protectedPollingEnabled = Boolean(user);
  if (!user) {
    setText('.nav-status', 'SELECT AN IDENTITY TO CONNECT PROTECTED DATA.');
    setInspectorQueueState('selection');
    return;
  }
  setText('.nav-status', '');
  refreshAll();
}

async function initializeCommandCenter() {
  setActivityState('contract');
  initializeDemoControls();
  window.RakshakIdentity?.subscribe(handleIdentityChange);
  startPolling();
  await (window.RakshakRolePicker?.ready || Promise.resolve());
  handleIdentityChange(window.RakshakIdentity?.getSelectedUser() || null);
}

initializeCommandCenter();
