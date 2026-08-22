const COMMAND_CENTER_ROUTE = window.RakshakRoutes?.commandCenter?.path || null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const POLL_INTERVAL_MS = window.RakshakRuntime.pollIntervalMs;
let lastKnownGood = null;

$$('[data-route]').forEach((link) => link.addEventListener('click', (event) => {
  const route = window.RakshakRoutes?.[link.dataset.route];
  event.preventDefault();
  if (route?.path) { window.location.href = route.path; return; }
  const status = $('[data-route-status]'); if (status) status.textContent = `${route?.label || 'Operational page'} route unavailable.`;
}));

$$('[data-command-link]').forEach((link) => link.addEventListener('click', (event) => {
  if (COMMAND_CENTER_ROUTE) { event.preventDefault(); window.location.href = COMMAND_CENTER_ROUTE; return; }
  event.preventDefault();
  const status = $('[data-command-status]');
  if (status) status.textContent = 'Command Center route unavailable.';
}));

const reveal = () => $$('[data-reveal]').forEach((element) => window.setTimeout(() => element.classList.add('is-visible'), Number(element.dataset.delay || 0)));
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', reveal); else reveal();

const setText = (selector, value, fallback = '—') => $$(selector).forEach((element) => { element.textContent = value ?? fallback; });
const number = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
};

function renderLanding(data) {
  if (!data) return;
  if (Array.isArray(data.priorities)) renderPriorities(data.priorities);
  const asset = data.asset;
  const riskObject = data.risk;
  const risk = riskObject ? {
    score: riskObject.risk_score,
    level: riskObject.risk_level,
  } : null;
  const telemetry = Array.isArray(data.telemetry) ? data.telemetry.at(-1) : data.telemetry;
  if (asset || riskObject || telemetry) lastKnownGood = data;
  document.body.dataset.dataState = telemetry ? 'linked' : asset || riskObject ? 'awaiting-telemetry' : 'awaiting-asset';
  if (asset) {
    setText('[data-asset-name]', asset.name); setText('[data-asset-id]', asset.id); setText('[data-asset-location]', asset.location);
    setText('[data-asset-criticality]', asset.criticality); setText('[data-asset-context]', `${asset.id} / ${asset.location}`);
  }
  if (risk) {
    setText('[data-risk-score], [data-assess-score]', number(risk.score)); setText('[data-risk-level], [data-assess-level]', risk.level);
    renderGauge(number(risk.score), risk.level);
  }
  setText('[data-telemetry-source]', telemetry?.source || '—');
  setText('[data-telemetry-status]', telemetry ? 'TELEMETRY LINKED' : 'TELEMETRY PENDING');
  setText('[data-temperature]', telemetry?.temperature_c ?? telemetry?.temperature); setText('[data-humidity]', telemetry?.humidity ?? telemetry?.humidity_pct);
  setText('[data-temperature-state]', telemetry?.state || '—'); setText('[data-last-update]', telemetry?.timestamp ? new Date(telemetry.timestamp).toLocaleTimeString([], { hour12: false }) : '—');
  if (riskObject) {
    renderFactors(riskObject.factors || []);
    renderMl(riskObject.ml_anomaly); renderTrend(riskObject);
    renderExplain(riskObject);
    renderPrevent(riskObject);
  }
}

function renderGauge(score, level) {
  if (score === null) return;
  const clamped = Math.max(0, Math.min(100, score));
  const needle = $('[data-gauge-needle]');
  if (needle) { const angle = -135 + clamped * 2.7; needle.style.transform = `rotate(${angle}deg)`; needle.style.transformOrigin = '180px 245px'; }
  const palette = { LOW: '#22c55e', MEDIUM: '#f2a93b', HIGH: '#ef4444', CRITICAL: '#ef4444' };
  $$('[data-risk-level], [data-assess-level]').forEach((element) => { element.dataset.level = String(level || '').toLowerCase(); element.style.color = palette[level] || '#8a93a1'; });
}

function renderFactors(factors) {
  const rows = $('[data-factor-rows]'); if (!rows) return;
  rows.replaceChildren();
  if (!factors.length) { const empty = document.createElement('div'); empty.className = 'awaiting-data'; empty.textContent = 'AWAITING BACKEND FACTOR EVIDENCE'; rows.append(empty); return; }
  factors.forEach((factor) => {
    const row = document.createElement('div'); row.className = 'factor-row';
    const label = document.createElement('span'); label.textContent = factor.factor ?? '—';
    const detail = document.createElement('small'); detail.append(`${factor.value ?? '—'} / ${factor.threshold ?? '—'}`, document.createElement('br'), factor.source ?? '—');
    const contribution = document.createElement('strong'); contribution.textContent = `+${factor.contribution ?? '—'}`;
    row.append(label, detail, contribution); rows.append(row);
  });
}

function renderMl(ml) {
  if (!ml) return;
  const parts = [ml.status, ml.model];
  if (typeof ml.is_anomaly === 'boolean') parts.push(ml.is_anomaly ? 'ANOMALY' : 'NO ANOMALY');
  if (ml.contribution !== undefined && ml.contribution !== null) parts.push(`CONTRIBUTION ${ml.contribution}`);
  setText('[data-ml-status]', parts.filter(Boolean).join(' / '));
}
function renderTrend(riskObject) { if (!riskObject) return; setText('[data-trend-state]', `${riskObject.trend ?? '—'} / Δ ${riskObject.temp_delta_5_c ?? '—'} / V ${riskObject.velocity_score ?? '—'}`); }
function renderPrevent(riskObject) {
  const recommendation = riskObject.recommendation; if (!recommendation) return;
  setText('[data-recommendation-action]', recommendation.action); const provenance = recommendation.provenance || {};
  setText('[data-sop-title]', provenance.title); setText('[data-sop-doc]', provenance.doc_id); setText('[data-sop-section]', provenance.section, ''); setText('[data-sop-version]', provenance.version, '');
  const validation = recommendation.validation; const gate = $('.validator-stage');
  if (validation !== undefined) { const result = typeof validation === 'string' ? validation : validation.result || validation.status; const normalized = String(result || '').toUpperCase(); if (gate) gate.dataset.validatorState = normalized === 'PASS' ? 'pass' : normalized === 'FAIL' ? 'fail' : 'pending'; setText('[data-validator-result]', result); }
  setText('[data-validator-rule]', recommendation.rule_fired);
}
function renderExplain(riskObject) {
  setText('[data-explanation]', riskObject.explanation);
  setText('[data-explain-score]', number(riskObject.risk_score)); setText('[data-explain-level]', riskObject.risk_level);
  const confidence = riskObject.confidence_detail;
  if (confidence) { setText('[data-confidence-score]', confidence.score); setText('[data-confidence-reason]', confidence.reason); setText('[data-confidence-present]', Array.isArray(confidence.channels_present) ? confidence.channels_present.join(', ') || '—' : confidence.channels_present); setText('[data-confidence-missing]', Array.isArray(confidence.channels_missing) ? confidence.channels_missing.join(', ') || '—' : confidence.channels_missing); }
  const factors = riskObject.factors || []; const evidence = $('[data-explain-factors]');
  if (evidence && factors.length) { evidence.innerHTML = ''; factors.forEach((factor) => { const row = document.createElement('div'); row.className = 'evidence-row'; row.innerHTML = '<div class="evidence-source"><span>SOURCE</span><strong></strong></div><div class="evidence-factor"><span>FACTOR</span><strong></strong><small></small></div><div class="evidence-contribution"><span>CONTRIBUTION</span><strong></strong></div>'; row.querySelector('.evidence-source strong').textContent = factor.source ?? '—'; row.querySelector('.evidence-factor strong').textContent = factor.factor ?? '—'; row.querySelector('.evidence-factor small').textContent = factor.value ?? '—'; row.querySelector('.evidence-contribution strong').textContent = `+${factor.contribution ?? '—'}`; evidence.append(row); }); }
  const warningList = $('[data-data-warnings]'); const warnings = riskObject.data_warnings || []; if (warningList) { warningList.innerHTML = ''; warnings.forEach((warning) => { const item = document.createElement('div'); item.className = 'data-warning'; item.textContent = warning; warningList.append(item); }); }
}
function priorityDisplay(value) {
  return value === null || value === undefined || value === '' ? '—' : String(value);
}

function createPriorityRow() {
  const row = document.createElement('div');
  row.className = 'priority-row';
  row.setAttribute('role', 'listitem');
  row.innerHTML = '<span class="priority-rank"></span><div class="priority-asset"><strong></strong><small></small></div><div class="priority-metric priority-metric--risk"><span class="priority-label">RISK</span><strong class="priority-risk"></strong></div><div class="priority-metric priority-metric--level"><span class="priority-label">LEVEL</span><strong class="priority-level"></strong></div><div class="priority-trend"><span class="priority-label">TREND</span><strong></strong></div><div class="priority-metric priority-metric--score"><span class="priority-label">PRIORITY</span><strong class="priority-score"></strong></div>';
  return row;
}

function updatePriorityRow(row, item) {
  const level = priorityDisplay(item.level).toUpperCase();
  row.dataset.priorityAssetId = priorityDisplay(item.asset_id);
  row.dataset.level = level.toLowerCase();
  row.querySelector('.priority-rank').textContent = `#${priorityDisplay(item.rank)}`;
  row.querySelector('.priority-asset strong').textContent = priorityDisplay(item.name);
  row.querySelector('.priority-asset strong').title = priorityDisplay(item.name);
  row.querySelector('.priority-asset small').textContent = priorityDisplay(item.asset_id);
  row.querySelector('.priority-risk').textContent = priorityDisplay(item.risk);
  row.querySelector('.priority-level').textContent = level;
  row.querySelector('.priority-trend strong').textContent = priorityDisplay(item.trend);
  row.querySelector('.priority-score').textContent = priorityDisplay(item.priority);
  row.setAttribute('aria-label', `Rank ${priorityDisplay(item.rank)}. Asset ${priorityDisplay(item.asset_id)}. ${priorityDisplay(item.name)}. Risk ${priorityDisplay(item.risk)}. Level ${level}. Trend ${priorityDisplay(item.trend)}. Priority ${priorityDisplay(item.priority)}.`);
}

function renderPriorities(items) {
  const queue = $('[data-priority-rows]');
  if (!queue) return;
  const returned = Array.isArray(items)
    ? items.filter((item) => item && typeof item === 'object')
    : [];
  queue.replaceChildren();

  if (!returned.length) {
    queue.dataset.state = 'awaiting';
    const awaiting = document.createElement('div');
    awaiting.className = 'awaiting-data';
    awaiting.textContent = 'Awaiting /api/priorities';
    queue.append(awaiting);
    return;
  }

  queue.dataset.state = 'loaded';
  returned.forEach((item) => {
    const row = createPriorityRow();
    updatePriorityRow(row, item);
    queue.append(row);
  });
  setText('[data-priority-status]', 'PRIORITY QUEUE LINKED');
  setText('[data-priority-output-state]', `BACKEND PRIORITY OUTPUT / ${returned.length} ASSETS`);
}

function observeSection(selector, className) { const section = $(selector); if (!section) return; if (!('IntersectionObserver' in window)) { section.classList.add(className); return; } const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { section.classList.add(className); observer.disconnect(); } }, { threshold: .16 }); observer.observe(section); }
observeSection('.observe', 'is-active'); observeSection('.assess', 'is-active');
observeSection('.explain', 'is-active');
observeSection('.prioritize', 'is-active');
observeSection('.prevent', 'is-active');

async function refresh() { try { const data = await window.RakshakAPI?.loadLandingData(); if (data) renderLanding(data); } catch (error) { if (!lastKnownGood) document.body.dataset.dataState = 'awaiting-telemetry'; } }
refresh(); window.setInterval(refresh, POLL_INTERVAL_MS);
