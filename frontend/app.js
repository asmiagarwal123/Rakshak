const COMMAND_CENTER_ROUTE = window.RakshakRoutes?.commandCenter?.path || null;
const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
let lastKnownGood = null;
let previousScore = null;
let lastKnownPriorities = null;

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
const number = (value) => Number.isFinite(Number(value)) ? Number(value) : null;

function renderLanding(data) {
  if (!data) return;
  if (Array.isArray(data.priorities)) renderPriorities(data.priorities);
  if (!data.asset || !data.risk) return;
  lastKnownGood = data;
  const asset = data.asset;
  const risk = data.risk.risk || data.risk;
  const telemetry = Array.isArray(data.telemetry) ? data.telemetry.at(-1) : data.telemetry;
  setText('[data-asset-name]', asset.name); setText('[data-asset-id]', asset.id); setText('[data-asset-location]', asset.location);
  setText('[data-asset-criticality]', asset.criticality); setText('[data-asset-context]', `${asset.id} / ${asset.location}`);
  setText('[data-risk-score], [data-assess-score]', number(risk.score)); setText('[data-risk-level], [data-assess-level]', risk.level);
  setText('[data-telemetry-source]', telemetry?.source || asset.telemetry_source || '—');
  setText('[data-telemetry-status]', telemetry ? 'TELEMETRY LINKED' : 'TELEMETRY PENDING');
  setText('[data-temperature]', telemetry?.temperature_c ?? telemetry?.temperature); setText('[data-humidity]', telemetry?.humidity ?? telemetry?.humidity_pct);
  setText('[data-temperature-state]', telemetry?.state || '—'); setText('[data-last-update]', telemetry?.timestamp ? new Date(telemetry.timestamp).toLocaleTimeString([], { hour12: false }) : '—');
  renderGauge(number(risk.score), risk.level);
  renderFactors(data.risk.factors || [] , number(risk.score));
  renderMl(data.risk.ml_anomaly); renderTrend(data.risk.trend);
  renderExplain(data.risk);
  renderPrevent(data.risk, asset.id);
}

function renderGauge(score, level) {
  if (score === null) return;
  const clamped = Math.max(0, Math.min(100, score));
  const needle = $('[data-gauge-needle]');
  if (needle) { const angle = -135 + clamped * 2.7; needle.style.transform = `rotate(${angle}deg)`; needle.style.transformOrigin = '180px 245px'; }
  const palette = { LOW: '#22c55e', MEDIUM: '#f2a93b', HIGH: '#ef4444', CRITICAL: '#ef4444' };
  $$('[data-risk-level], [data-assess-level]').forEach((element) => { element.dataset.level = String(level || '').toLowerCase(); element.style.color = palette[level] || '#8a93a1'; });
}

function renderFactors(factors, score) {
  const rows = $('[data-factor-rows]'); if (!rows) return;
  rows.innerHTML = '';
  factors.forEach((factor) => { const row = document.createElement('div'); row.className = 'factor-row'; row.innerHTML = `<span>${factor.name ?? '—'}</span><small>${factor.value ?? '—'} / ${factor.threshold ?? '—'}<br />${factor.source ?? '—'}</small><strong>+${factor.contribution ?? '—'}</strong>`; rows.append(row); });
  const visibleSum = factors.reduce((sum, factor) => sum + (number(factor.contribution) || 0), 0);
  setText('[data-factor-sum]', visibleSum); const verified = score !== null && visibleSum === score;
  setText('[data-factor-check]', verified ? 'FACTOR SUM VERIFIED' : 'DATA INTEGRITY WARNING');
  $('[data-factor-check]')?.classList.toggle('is-warning', !verified);
}

function renderMl(ml) { if (!ml) return; setText('[data-ml-status]', ml.status === 'AVAILABLE' ? `${ml.model || 'MODEL'} / ${ml.is_anomaly ? 'ANOMALY' : 'NO ANOMALY'} / +${ml.contribution ?? 0}` : 'UNAVAILABLE'); }
function renderTrend(trend) { if (!trend) return; setText('[data-trend-state]', `${trend.state || '—'} / Δ ${trend.temp_delta_5_c ?? '—'} / V ${trend.velocity_score ?? '—'}`); }
function renderPrevent(riskObject, assetId) {
  const recommendation = riskObject.recommendation; if (!recommendation) return;
  setText('[data-recommendation-action]', recommendation.action); const provenance = recommendation.provenance || {};
  setText('[data-sop-title]', provenance.title); setText('[data-sop-doc]', provenance.doc_id); setText('[data-sop-section]', provenance.section, ''); setText('[data-sop-version]', provenance.version, '');
  const validation = recommendation.validation; const gate = $('.validator-stage');
  if (validation !== undefined) { const result = typeof validation === 'string' ? validation : validation.result || validation.status; const normalized = String(result || '').toUpperCase(); if (gate) gate.dataset.validatorState = normalized === 'PASS' ? 'pass' : normalized === 'FAIL' ? 'fail' : 'pending'; setText('[data-validator-result]', result); }
  setText('[data-validator-rule]', recommendation.rule_fired);
  const risk = riskObject.risk || riskObject; setText('[data-before-score]', number(risk.score)); setText('[data-before-level]', risk.level);
  const button = $('[data-simulate]'); if (button && !button.dataset.bound) { button.dataset.bound = 'true'; button.addEventListener('click', () => runSimulation(assetId, button)); }
}
async function runSimulation(assetId, button) {
  if (!assetId || !window.RakshakAPI?.simulateIntervention) return;
  button.disabled = true; button.classList.add('is-processing'); setText('[data-simulation-status]', 'SIMULATION REQUEST IN PROGRESS');
  try { const result = await window.RakshakAPI.simulateIntervention(assetId); const before = result.before || {}; const after = result.after || {}; setText('[data-before-score]', before.score); setText('[data-before-level]', before.level); setText('[data-after-score]', after.score); setText('[data-after-level]', after.level); const changed = $('[data-changed-factors]'); if (changed) { changed.innerHTML = ''; (result.changed_factors || []).forEach((item) => { const row = document.createElement('div'); row.textContent = typeof item === 'string' ? item : JSON.stringify(item); changed.append(row); }); } setText('[data-simulation-note]', result.note); setText('[data-simulation-status]', 'SCENARIO SIMULATION COMPLETE'); } catch (error) { setText('[data-simulation-status]', 'SIMULATION UNAVAILABLE'); } finally { button.disabled = false; button.classList.remove('is-processing'); }
}
function renderExplain(riskObject) {
  const risk = riskObject.risk || riskObject;
  setText('[data-explanation]', riskObject.explanation);
  setText('[data-explain-score]', number(risk.score)); setText('[data-explain-level]', risk.level);
  const confidence = riskObject.confidence_detail;
  if (confidence) { setText('[data-confidence-score]', confidence.score); setText('[data-confidence-reason]', confidence.reason); setText('[data-confidence-present]', Array.isArray(confidence.channels_present) ? confidence.channels_present.join(', ') || '—' : confidence.channels_present); setText('[data-confidence-missing]', Array.isArray(confidence.channels_missing) ? confidence.channels_missing.join(', ') || '—' : confidence.channels_missing); }
  const factors = riskObject.factors || []; const evidence = $('[data-explain-factors]');
  if (evidence && factors.length) { evidence.innerHTML = ''; factors.forEach((factor) => { const row = document.createElement('div'); row.className = 'evidence-row'; row.innerHTML = `<div class="evidence-source"><span>SOURCE</span><strong>${factor.source ?? '—'}</strong></div><div class="evidence-factor"><span>FACTOR</span><strong>${factor.name ?? '—'}</strong><small>${factor.value ?? '—'}</small></div><div class="evidence-contribution"><span>CONTRIBUTION</span><strong>+${factor.contribution ?? '—'}</strong></div>`; evidence.append(row); }); }
  const warningList = $('[data-data-warnings]'); const warnings = riskObject.data_warnings || []; if (warningList) { warningList.innerHTML = ''; warnings.forEach((warning) => { const item = document.createElement('div'); item.className = 'data-warning'; item.textContent = warning; warningList.append(item); }); }
}
function renderPriorities(items) {
  const queue = $('[data-priority-rows]'); if (!queue || !items.length) return;
  const before = new Map($$('.priority-row').map((row) => [row.dataset.assetId, row.getBoundingClientRect()]));
  const existing = new Map($$('.priority-row').map((row) => [row.dataset.assetId, row]));
  items.forEach((item) => {
    const id = item.asset_id || item.id; if (!id) return;
    let row = existing.get(String(id));
    if (!row) { row = document.createElement('div'); row.className = 'priority-row'; row.dataset.assetId = String(id); queue.append(row); }
    const level = String(item.level || '').toUpperCase(); row.dataset.level = level.toLowerCase();
    row.innerHTML = `<span class="priority-rank">#${item.rank ?? '—'}</span><div class="priority-asset"><strong>${item.name ?? '—'}</strong><small>${item.asset_id ?? '—'}</small></div><div><span class="priority-label">RISK</span><strong class="priority-risk">${item.risk ?? '—'}</strong></div><div><span class="priority-label">LEVEL</span><strong class="priority-level">${item.level ?? '—'}</strong></div><div><span class="priority-label">PRIORITY</span><strong class="priority-score">${item.priority ?? '—'}</strong></div><div class="priority-trend"><span class="priority-label">TREND</span><strong>${item.trend ?? '—'}</strong></div>`;
  });
  const ids = new Set(items.map((item) => String(item.asset_id || item.id)).filter(Boolean));
  existing.forEach((row, id) => { if (!ids.has(id)) row.remove(); });
  items.forEach((item) => { const row = existing.get(String(item.asset_id || item.id)) || [...queue.children].find((child) => child.dataset.assetId === String(item.asset_id || item.id)); if (row) queue.append(row); });
  $$('.priority-row').forEach((row) => { const old = before.get(row.dataset.assetId); const next = row.getBoundingClientRect(); if (old) { const dy = old.top - next.top; if (Math.abs(dy) > 1) { row.style.transform = `translateY(${dy}px)`; row.classList.add('is-moving'); requestAnimationFrame(() => { row.style.transform = ''; }); window.setTimeout(() => row.classList.remove('is-moving'), 700); } } });
  lastKnownPriorities = items;
  setText('[data-priority-status]', 'PRIORITY QUEUE LINKED');
}

function observeSection(selector, className) { const section = $(selector); if (!section) return; if (!('IntersectionObserver' in window)) { section.classList.add(className); return; } const observer = new IntersectionObserver(([entry]) => { if (entry.isIntersecting) { section.classList.add(className); observer.disconnect(); } }, { threshold: .16 }); observer.observe(section); }
observeSection('.observe', 'is-active'); observeSection('.assess', 'is-active');
observeSection('.explain', 'is-active');
observeSection('.prioritize', 'is-active');
observeSection('.prevent', 'is-active');

async function refresh() { try { const data = await window.RakshakAPI?.loadLandingData(); if (data) renderLanding(data); } catch (error) { if (!lastKnownGood) document.body.dataset.dataState = 'awaiting-telemetry'; } }
refresh(); window.setInterval(refresh, 900);
