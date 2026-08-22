const API_BASE = window.RAKSHAK_API_BASE || '';
const ASSET_ID = window.RAKSHAK_ASSET_ID || null;

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE}${path}`, { ...options, headers: { Accept: 'application/json', ...(options.headers || {}) } });
  if (!response.ok) throw new Error(`API ${response.status}`);
  return response.json();
}

async function loadLandingData() {
  const priorityRequest = request('/api/priorities');
  if (!ASSET_ID) return { priorities: await priorityRequest };
  const [assets, risk, telemetry, priorities] = await Promise.all([request('/api/assets'), request(`/api/assets/${encodeURIComponent(ASSET_ID)}/risk`), request(`/api/assets/${encodeURIComponent(ASSET_ID)}/telemetry?limit=5`), priorityRequest]);
  const asset = Array.isArray(assets) ? assets.find((item) => item.id === ASSET_ID) : null;
  return { asset, risk, telemetry, priorities };
}

async function simulateIntervention(assetId) {
  return request(`/api/assets/${encodeURIComponent(assetId)}/simulate-intervention`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ intervention: 'inspect_service' }) });
}

window.RakshakAPI = { loadLandingData, simulateIntervention };
window.RakshakAPI.loadAssets = () => request('/api/assets');
window.RakshakAPI.loadPriorities = () => request('/api/priorities');
window.RakshakAPI.loadAudit = () => request('/api/audit');
window.RakshakAPI.loadTelemetry = (assetId, limit = 24) => request(`/api/assets/${encodeURIComponent(assetId)}/telemetry?limit=${limit}`);
window.RakshakAPI.loadAsset = (assetId) => request(`/api/assets/${encodeURIComponent(assetId)}`);
window.RakshakAPI.loadRisk = (assetId) => request(`/api/assets/${encodeURIComponent(assetId)}/risk`);
window.RakshakAPI.performAction = (assetId, payload) => request(`/api/assets/${encodeURIComponent(assetId)}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
