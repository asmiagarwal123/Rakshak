const API_BASE = window.RAKSHAK_API_BASE || '';
const ASSET_ID = window.RAKSHAK_ASSET_ID || null;
const PUBLIC_REQUESTS = Object.freeze([
  Object.freeze({ method: 'GET', path: '/api/health' }),
  Object.freeze({ method: 'GET', path: '/api/users' }),
  Object.freeze({ method: 'POST', path: '/api/telemetry' }),
]);
const IDENTITY_STORAGE_KEY = 'rakshak:selected-user';

function readStoredIdentity() {
  try {
    const stored = window.sessionStorage.getItem(IDENTITY_STORAGE_KEY);
    const user = stored ? JSON.parse(stored) : null;
    return user && user.id !== undefined && user.id !== null && String(user.id).trim() ? user : null;
  } catch {
    return null;
  }
}

const identityState = { selectedUser: readStoredIdentity(), listeners: new Set() };

async function request(path, options = {}) {
  const method = String(options.method || 'GET').toUpperCase();
  const requestPath = String(path).split('?')[0];
  const isPublicRequest = PUBLIC_REQUESTS.some((entry) => entry.method === method && entry.path === requestPath);
  const headers = new Headers(options.headers || {});
  headers.set('Accept', 'application/json');

  const selectedUserId = identityState.selectedUser?.id;
  if (!isPublicRequest && selectedUserId !== undefined && selectedUserId !== null && String(selectedUserId).trim()) {
    headers.set('X-User-Id', String(selectedUserId));
  }

  const response = await fetch(`${API_BASE}${path}`, { ...options, method, headers });
  if (!response.ok) {
    let payload = null;
    try { payload = await response.json(); } catch { payload = null; }
    const error = new Error(payload?.detail || payload?.message || `API ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    error.path = path;
    window.dispatchEvent(new CustomEvent('rakshak:request-error', { detail: { status: response.status, path, payload, userId: selectedUserId ?? null } }));
    throw error;
  }
  return response.json();
}

function setSelectedUser(user) {
  const hasValidId = user && user.id !== undefined && user.id !== null && String(user.id).trim();
  identityState.selectedUser = hasValidId ? user : null;
  try {
    if (identityState.selectedUser) window.sessionStorage.setItem(IDENTITY_STORAGE_KEY, JSON.stringify(identityState.selectedUser));
    else window.sessionStorage.removeItem(IDENTITY_STORAGE_KEY);
  } catch {
    // The in-memory identity remains usable when session storage is unavailable.
  }
  identityState.listeners.forEach((listener) => listener(identityState.selectedUser));
  window.dispatchEvent(new CustomEvent('rakshak:identity-change', { detail: { user: identityState.selectedUser } }));
}

window.RakshakIdentity = Object.freeze({
  getSelectedUser: () => identityState.selectedUser,
  getSelectedUserId: () => identityState.selectedUser?.id ?? null,
  setSelectedUser,
  subscribe(listener) {
    if (typeof listener !== 'function') return () => {};
    identityState.listeners.add(listener);
    return () => identityState.listeners.delete(listener);
  },
});

async function loadLandingData() {
  const priorityRequest = request('/api/priorities');
  if (!ASSET_ID) return { priorities: await priorityRequest };
  const [assets, risk, telemetry, priorities] = await Promise.all([request('/api/assets'), request(`/api/assets/${encodeURIComponent(ASSET_ID)}/risk`), request(`/api/assets/${encodeURIComponent(ASSET_ID)}/telemetry?limit=5`), priorityRequest]);
  const asset = Array.isArray(assets) ? assets.find((item) => item.id === ASSET_ID) : null;
  return { asset, risk, telemetry, priorities };
}

async function simulateIntervention(assetId, payload) {
  return request(`/api/assets/${encodeURIComponent(assetId)}/simulate-intervention`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
}

window.RakshakAPI = { loadLandingData, simulateIntervention };
window.RakshakAPI.loadHealth = () => request('/api/health');
window.RakshakAPI.loadAssets = () => request('/api/assets');
window.RakshakAPI.loadPriorities = () => request('/api/priorities');
window.RakshakAPI.loadAudit = () => request('/api/audit');
window.RakshakAPI.loadUsers = () => request('/api/users');
window.RakshakAPI.loadAssignments = (assignee = 'me') => request(`/api/assignments?assignee=${encodeURIComponent(assignee)}`);
window.RakshakAPI.loadTelemetry = (assetId, limit = 24) => request(`/api/assets/${encodeURIComponent(assetId)}/telemetry?limit=${limit}`);
window.RakshakAPI.loadAsset = (assetId) => request(`/api/assets/${encodeURIComponent(assetId)}`);
window.RakshakAPI.loadRisk = (assetId) => request(`/api/assets/${encodeURIComponent(assetId)}/risk`);
window.RakshakAPI.performAction = (assetId, payload) => request(`/api/assets/${encodeURIComponent(assetId)}/action`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
window.RakshakAPI.resetDemo = () => request('/api/demo/reset', { method: 'POST' });
window.RakshakAPI.escalateDemo = () => request('/api/demo/escalate', { method: 'POST' });
window.RakshakAPI.resolveDemo = () => request('/api/demo/resolve', { method: 'POST' });
