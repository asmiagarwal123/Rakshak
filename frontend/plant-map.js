(function initializePlantMap() {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const XHTML_NS = 'http://www.w3.org/1999/xhtml';
  const POLL_MS = window.RakshakRuntime.pollIntervalMs;
  const CANVAS = Object.freeze({ width: 1200, height: 620, nodeWidth: 220, nodeHeight: 126, marginX: 58, marginY: 64 });
  const SELECTION_STORAGE_KEY = 'rakshak:selected-asset';
  const SUPPORTED_ICONS = new Set(['tank', 'pump', 'boiler', 'valve', 'motor']);
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const nodeFor = (assetId) => $$('[data-node]').find((node) => node.dataset.node === String(assetId)) || null;
  const state = {
    assets: [],
    riskObjects: new Map(),
    edges: [],
    unresolved: [],
    positions: new Map(),
    selected: null,
    requestedSelection: initialSelection(),
    graphSignature: '',
    topologyAttempted: false,
    topologyFailures: 0,
    requestVersion: 0,
    refreshPromise: null,
    refreshQueued: false,
    lastGoodAt: null,
    viewport: { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height },
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

  function normalized(value) {
    return hasValue(value) ? String(value).trim().toLowerCase() : '';
  }

  function readStoredSelection() {
    try { return window.sessionStorage.getItem(SELECTION_STORAGE_KEY); } catch { return null; }
  }

  function initialSelection() {
    const direct = new URLSearchParams(window.location.search).get('asset');
    if (direct) return direct;
    try {
      const referrer = document.referrer ? new URL(document.referrer) : null;
      if (referrer?.origin === window.location.origin) {
        const referred = referrer.searchParams.get('asset');
        if (referred) return referred;
      }
    } catch {
      // An unavailable or cross-origin referrer is not selection context.
    }
    return readStoredSelection();
  }

  function storeSelection(assetId) {
    try {
      if (assetId) window.sessionStorage.setItem(SELECTION_STORAGE_KEY, String(assetId));
      else window.sessionStorage.removeItem(SELECTION_STORAGE_KEY);
    } catch {
      // Selection still works in memory when session storage is unavailable.
    }
  }

  function svgElement(name, attributes = {}) {
    const element = document.createElementNS(SVG_NS, name);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
    return element;
  }

  function appendSvgText(parent, textValue, attributes = {}) {
    const text = svgElement('text', attributes);
    text.textContent = display(textValue);
    parent.append(text);
    return text;
  }

  function renderIdentity() {
    const badge = $('[data-identity-state]');
    setText('[data-active-user]', 'IDENTITY BACKEND PENDING');
    setText('[data-active-role]', 'A3/A4 DEFERRED');
    if (badge) {
      badge.dataset.identityState = 'unverified';
      badge.dataset.backendState = 'pending';
    }
  }

  function initializeRoutes() {
    $$('[data-route]').forEach((link) => {
      const route = window.RakshakRoutes?.[link.dataset.route];
      if (route?.path) link.href = route.path;
    });
    updateSafetyCaseRoute();
  }

  function safetyCasePath(assetId) {
    const base = window.RakshakRoutes?.safetyCase?.path || 'asset-safety-case.html';
    return assetId ? `${base}?asset=${encodeURIComponent(assetId)}` : base;
  }

  function updateSafetyCaseRoute() {
    const link = $('[data-route="safetyCase"]');
    if (link) link.href = safetyCasePath(state.selected);
  }

  function assetsFrom(payload) {
    const assets = Array.isArray(payload) ? payload : Array.isArray(payload?.assets) ? payload.assets : [];
    return assets.filter((asset) => asset && hasValue(asset.id));
  }

  function riskFor(asset) {
    const master = state.riskObjects.get(String(asset?.id));
    if (master && typeof master === 'object') {
      return {
        score: master.risk_score,
        level: master.risk_level,
        priority_score: master.priority_score,
      };
    }
    const snapshot = asset?.risk && typeof asset.risk === 'object' ? asset.risk : {};
    return {
      score: snapshot.score ?? asset?.risk_score,
      level: snapshot.level ?? asset?.risk_level,
      priority_score: asset?.priority_score,
    };
  }

  function dependencyFor(assetId) {
    const master = state.riskObjects.get(String(assetId));
    return master?.dependency && typeof master.dependency === 'object' ? master.dependency : null;
  }

  function iconFor(asset) {
    const type = normalized(asset?.asset_type || asset?.type);
    if (SUPPORTED_ICONS.has(type)) return type;
    return [...SUPPORTED_ICONS].find((icon) => type.includes(icon)) || 'generic';
  }

  function referenceLabel(reference) {
    if (typeof reference === 'string' || typeof reference === 'number') return String(reference);
    return display(reference?.name || reference?.asset_id || reference?.id, 'UNRESOLVED REFERENCE');
  }

  function resolveReference(reference) {
    const explicitId = typeof reference === 'object' && reference ? reference.asset_id ?? reference.id : reference;
    if (hasValue(explicitId)) {
      const idMatch = state.assets.find((asset) => String(asset.id) === String(explicitId));
      if (idMatch) return idMatch;
    }
    const label = referenceLabel(reference).toLowerCase();
    return state.assets.find((asset) => hasValue(asset.name) && String(asset.name).trim().toLowerCase() === label) || null;
  }

  function buildTopology() {
    const edges = [];
    const unresolved = [];
    const seen = new Set();
    state.assets.forEach((asset) => {
      const dependency = dependencyFor(asset.id);
      const downstream = Array.isArray(dependency?.downstream) ? dependency.downstream : [];
      downstream.forEach((reference) => {
        const target = resolveReference(reference);
        if (!target || String(target.id) === String(asset.id)) {
          unresolved.push({ source: String(asset.id), reference, label: referenceLabel(reference) });
          return;
        }
        const key = `${asset.id}→${target.id}`;
        if (seen.has(key)) return;
        seen.add(key);
        edges.push({ key, source: String(asset.id), target: String(target.id) });
      });
    });
    state.edges = edges;
    state.unresolved = unresolved;
  }

  function gridLayout(assets) {
    const columns = Math.min(3, Math.max(1, Math.ceil(Math.sqrt(assets.length))));
    const rows = Math.max(1, Math.ceil(assets.length / columns));
    const usableWidth = CANVAS.width - (CANVAS.marginX * 2) - CANVAS.nodeWidth;
    const usableHeight = CANVAS.height - (CANVAS.marginY * 2) - CANVAS.nodeHeight;
    const positions = new Map();
    assets.forEach((asset, index) => {
      const column = index % columns;
      const row = Math.floor(index / columns);
      const x = CANVAS.marginX + (columns === 1 ? usableWidth / 2 : column * usableWidth / (columns - 1));
      const y = CANVAS.marginY + (rows === 1 ? usableHeight / 2 : row * usableHeight / (rows - 1));
      positions.set(String(asset.id), { x, y });
    });
    return positions;
  }

  function dependencyLayout(assets, edges) {
    if (!edges.length) return gridLayout(assets);
    const ids = assets.map((asset) => String(asset.id));
    const indegree = new Map(ids.map((id) => [id, 0]));
    const adjacency = new Map(ids.map((id) => [id, []]));
    edges.forEach((edge) => {
      indegree.set(edge.target, (indegree.get(edge.target) || 0) + 1);
      adjacency.get(edge.source)?.push(edge.target);
    });
    const depth = new Map(ids.map((id) => [id, 0]));
    const queue = ids.filter((id) => indegree.get(id) === 0);
    const processed = new Set();
    while (queue.length) {
      const source = queue.shift();
      if (processed.has(source)) continue;
      processed.add(source);
      (adjacency.get(source) || []).forEach((target) => {
        depth.set(target, Math.max(depth.get(target) || 0, (depth.get(source) || 0) + 1));
        indegree.set(target, (indegree.get(target) || 0) - 1);
        if (indegree.get(target) === 0) queue.push(target);
      });
    }
    const maximumDepth = Math.max(...depth.values(), 0);
    const layers = new Map();
    ids.forEach((id) => {
      const layer = depth.get(id) || 0;
      if (!layers.has(layer)) layers.set(layer, []);
      layers.get(layer).push(id);
    });
    const usableWidth = CANVAS.width - (CANVAS.marginX * 2) - CANVAS.nodeWidth;
    const positions = new Map();
    layers.forEach((layerIds, layer) => {
      const x = CANVAS.marginX + (maximumDepth ? layer * usableWidth / maximumDepth : usableWidth / 2);
      const totalHeight = layerIds.length * CANVAS.nodeHeight;
      const gap = Math.max(24, (CANVAS.height - (CANVAS.marginY * 2) - totalHeight) / Math.max(1, layerIds.length - 1));
      const startY = layerIds.length === 1 ? (CANVAS.height - CANVAS.nodeHeight) / 2 : Math.max(CANVAS.marginY, (CANVAS.height - totalHeight - gap * (layerIds.length - 1)) / 2);
      layerIds.forEach((id, index) => positions.set(id, { x, y: startY + index * (CANVAS.nodeHeight + gap) }));
    });
    return positions;
  }

  function conduitPath(sourcePosition, targetPosition) {
    const startX = sourcePosition.x + CANVAS.nodeWidth;
    const startY = sourcePosition.y + CANVAS.nodeHeight / 2;
    const endX = targetPosition.x;
    const endY = targetPosition.y + CANVAS.nodeHeight / 2;
    const middleX = startX < endX ? startX + (endX - startX) / 2 : Math.min(CANVAS.width - 22, Math.max(startX, endX) + 34);
    return `M${startX} ${startY}H${middleX}V${endY}H${endX}`;
  }

  function createNode(asset, position) {
    const id = String(asset.id);
    const group = svgElement('g', { class: 'asset-node', tabindex: '0', role: 'button', 'aria-pressed': 'false', 'data-node': id, transform: `translate(${position.x} ${position.y})` });
    group.append(svgElement('rect', { class: 'node-housing', width: CANVAS.nodeWidth, height: CANVAS.nodeHeight, rx: '4' }));
    group.append(svgElement('rect', { class: 'node-header', width: CANVAS.nodeWidth, height: '31', rx: '4' }));
    group.append(svgElement('rect', { class: 'severity-rail', width: '6', height: CANVAS.nodeHeight }));
    group.append(svgElement('path', { class: 'selection-brackets', d: `M0 19V0H19M${CANVAS.nodeWidth - 19} 0H${CANVAS.nodeWidth}V19M0 ${CANVAS.nodeHeight - 19}V${CANVAS.nodeHeight}H19M${CANVAS.nodeWidth - 19} ${CANVAS.nodeHeight}H${CANVAS.nodeWidth}V${CANVAS.nodeHeight - 19}` }));
    group.append(svgElement('circle', { class: 'connection-port input-port', cx: '0', cy: CANVAS.nodeHeight / 2, r: '5' }));
    group.append(svgElement('circle', { class: 'connection-port output-port', cx: CANVAS.nodeWidth, cy: CANVAS.nodeHeight / 2, r: '5' }));
    appendSvgText(group, asset.id, { class: 'node-id', x: '16', y: '21', 'data-node-id': '' });
    appendSvgText(group, 'UNAVAILABLE', { class: 'node-level', x: CANVAS.nodeWidth - 13, y: '21', 'text-anchor': 'end', 'data-node-level': '' });
    const icon = svgElement('use', { class: 'node-icon', href: `#asset-${iconFor(asset)}`, x: '14', y: '43', width: '39', height: '39', 'data-node-icon': '' });
    group.append(icon);
    const foreign = svgElement('foreignObject', { x: '62', y: '41', width: '143', height: '45' });
    const name = document.createElementNS(XHTML_NS, 'div');
    name.className = 'node-name';
    name.dataset.nodeName = '';
    name.textContent = display(asset.name || asset.id);
    foreign.append(name);
    group.append(foreign);
    appendSvgText(group, asset.asset_type || asset.type, { class: 'node-type', x: '16', y: '94', 'data-node-type': '' });
    appendSvgText(group, '—', { class: 'node-score', x: '16', y: '116', 'data-node-score': '' });
    appendSvgText(group, '/ 100', { class: 'node-score-unit', x: '53', y: '116' });
    appendSvgText(group, asset.status, { class: 'node-status', x: CANVAS.nodeWidth - 13, y: '114', 'text-anchor': 'end', 'data-node-status': '' });
    const title = svgElement('title', { 'data-node-title': '' });
    group.append(title);
    group.addEventListener('click', () => selectAsset(id));
    group.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        selectAsset(id);
      }
    });
    return group;
  }

  function graphStructureSignature() {
    const ids = state.assets.map((asset) => String(asset.id)).join('|');
    const edges = state.edges.map((edge) => edge.key).sort().join('|');
    return `${ids}::${edges}`;
  }

  function rebuildGraph() {
    const edgeLayer = $('[data-edges]');
    const nodeLayer = $('[data-nodes]');
    edgeLayer.replaceChildren();
    nodeLayer.replaceChildren();
    state.positions = dependencyLayout(state.assets, state.edges);
    state.edges.forEach((edge) => {
      const source = state.positions.get(edge.source);
      const target = state.positions.get(edge.target);
      if (!source || !target) return;
      const path = svgElement('path', { class: 'conduit', d: conduitPath(source, target), 'data-edge': edge.key, 'data-source': edge.source, 'data-target': edge.target, 'marker-end': 'url(#conduit-arrow)' });
      edgeLayer.append(path);
    });
    state.assets.forEach((asset) => {
      const position = state.positions.get(String(asset.id));
      if (position) nodeLayer.append(createNode(asset, position));
    });
    state.graphSignature = graphStructureSignature();
    fitView();
  }

  function reachableFrom(assetId, reverse = false) {
    const visited = new Set();
    const queue = [String(assetId)];
    while (queue.length) {
      const current = queue.shift();
      state.edges.forEach((edge) => {
        const from = reverse ? edge.target : edge.source;
        const to = reverse ? edge.source : edge.target;
        if (from === current && !visited.has(to)) {
          visited.add(to);
          queue.push(to);
        }
      });
    }
    visited.delete(String(assetId));
    return visited;
  }

  function activeEdgeKeys(assetId, reverse = false) {
    if (!assetId) return new Set();
    const reachable = new Set([String(assetId)]);
    const active = new Set();
    let changed = true;
    while (changed) {
      changed = false;
      state.edges.forEach((edge) => {
        const source = reverse ? edge.target : edge.source;
        const target = reverse ? edge.source : edge.target;
        if (reachable.has(source) && !active.has(edge.key)) {
          active.add(edge.key);
          if (!reachable.has(target)) {
            reachable.add(target);
            changed = true;
          }
        }
      });
    }
    return active;
  }

  function updateGraphPresentation() {
    const downstream = state.selected ? reachableFrom(state.selected) : new Set();
    const upstream = state.selected ? reachableFrom(state.selected, true) : new Set();
    const activeEdges = activeEdgeKeys(state.selected);
    const upstreamEdges = activeEdgeKeys(state.selected, true);
    state.assets.forEach((asset) => {
      const id = String(asset.id);
      const node = nodeFor(id);
      if (!node) return;
      const risk = riskFor(asset);
      const level = normalized(risk.level) || 'unavailable';
      const selected = id === state.selected;
      const isDownstream = downstream.has(id);
      const isUpstream = upstream.has(id);
      node.setAttribute('class', `asset-node level-${level}${selected ? ' is-selected' : ''}${isDownstream ? ' is-downstream' : ''}${isUpstream ? ' is-upstream' : ''}${state.selected && !selected && !isDownstream && !isUpstream ? ' is-subdued' : ''}`);
      node.setAttribute('aria-pressed', String(selected));
      node.setAttribute('aria-label', `${display(asset.name || asset.id)}. Asset ${display(asset.id)}. Risk ${display(risk.score, 'unavailable')}. Level ${display(risk.level, 'unavailable')}. Status ${display(asset.status, 'unavailable')}.`);
      $('[data-node-id]', node).textContent = display(asset.id);
      $('[data-node-level]', node).textContent = display(risk.level, 'UNAVAILABLE');
      $('[data-node-name]', node).textContent = display(asset.name || asset.id);
      $('[data-node-type]', node).textContent = display(asset.asset_type || asset.type, 'TYPE UNAVAILABLE').toUpperCase();
      $('[data-node-score]', node).textContent = display(risk.score);
      $('[data-node-status]', node).textContent = display(asset.status, 'STATUS UNAVAILABLE').toUpperCase();
      $('[data-node-icon]', node).setAttribute('href', `#asset-${iconFor(asset)}`);
      $('[data-node-title]', node).textContent = `${display(asset.name || asset.id)} / RISK ${display(risk.score)} / LEVEL ${display(risk.level)} / PRIORITY ${display(risk.priority_score)}`;
    });
    $$('[data-edge]').forEach((path) => {
      const key = path.dataset.edge;
      const upstreamEdge = upstreamEdges.has(key);
      path.setAttribute('class', `conduit${activeEdges.has(key) ? ' is-active' : ''}${upstreamEdge ? ' is-upstream' : ''}${state.selected && !activeEdges.has(key) && !upstreamEdge ? ' is-subdued' : ''}`);
    });
  }

  function detailLine(label, value) {
    const item = document.createElement('div');
    const term = document.createElement('dt');
    const description = document.createElement('dd');
    term.textContent = label;
    description.textContent = display(value, 'NOT AVAILABLE');
    item.append(term, description);
    return item;
  }

  function renderDownstreamList(container, dependency) {
    const downstream = Array.isArray(dependency?.downstream) ? dependency.downstream : [];
    if (!downstream.length) {
      const empty = document.createElement('li');
      empty.className = 'downstream-empty';
      empty.textContent = 'NO DOWNSTREAM REFERENCES RETURNED';
      container.append(empty);
      return;
    }
    downstream.forEach((reference) => {
      const item = document.createElement('li');
      const target = resolveReference(reference);
      const index = document.createElement('span');
      const copy = document.createElement('div');
      const name = document.createElement('strong');
      const meta = document.createElement('small');
      index.textContent = String(container.children.length + 1).padStart(2, '0');
      name.textContent = target ? display(target.name || target.id) : referenceLabel(reference);
      meta.textContent = target ? `ASSET ID / ${target.id}` : 'RETURNED REFERENCE / ASSET ID UNRESOLVED';
      copy.append(name, meta);
      item.append(index, copy);
      if (target) {
        item.tabIndex = 0;
        item.setAttribute('role', 'button');
        item.addEventListener('click', () => selectAsset(String(target.id)));
        item.addEventListener('keydown', (event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            selectAsset(String(target.id));
          }
        });
      } else item.classList.add('is-unresolved');
      container.append(item);
    });
  }

  function renderDetail() {
    const container = $('[data-detail]');
    container.replaceChildren();
    const asset = state.assets.find((candidate) => String(candidate.id) === String(state.selected));
    if (!asset) {
      setText('[data-detail-state]', 'NO SELECTION');
      const empty = document.createElement('div');
      empty.className = 'detail-empty';
      const marker = document.createElement('i');
      marker.setAttribute('aria-hidden', 'true');
      const title = document.createElement('strong');
      const copy = document.createElement('p');
      title.textContent = 'SELECT AN ASSET NODE';
      copy.textContent = 'Inspect confirmed downstream relationships without leaving the network.';
      empty.append(marker, title, copy);
      container.append(empty);
      return;
    }
    const risk = riskFor(asset);
    const dependency = dependencyFor(asset.id);
    setText('[data-detail-state]', 'SELECTED');

    const identity = document.createElement('div');
    identity.className = 'selected-identity';
    const id = document.createElement('span');
    const name = document.createElement('h3');
    const meta = document.createElement('p');
    id.textContent = display(asset.id);
    name.textContent = display(asset.name || asset.id);
    meta.textContent = [asset.asset_type || asset.type, asset.location, asset.status].filter(hasValue).map(String).join(' / ') || 'IDENTITY METADATA NOT RETURNED';
    identity.append(id, name, meta);

    const riskGrid = document.createElement('dl');
    riskGrid.className = 'detail-grid';
    riskGrid.append(detailLine('PROTOTYPE RISK INDEX', risk.score), detailLine('RISK LEVEL', risk.level), detailLine('PRIORITY', risk.priority_score), detailLine('ASSET STATUS', asset.status));

    const impact = document.createElement('section');
    impact.className = 'impact-record';
    const impactLabel = document.createElement('span');
    const impactValue = document.createElement('strong');
    const count = document.createElement('small');
    impactLabel.textContent = 'DEPENDENCY IMPACT';
    impactValue.textContent = display(dependency?.impact, 'NOT AVAILABLE');
    count.textContent = `DOWNSTREAM COUNT / ${display(dependency?.downstream_count, 'NOT AVAILABLE')}`;
    impact.append(impactLabel, impactValue, count);

    const downstreamSection = document.createElement('section');
    downstreamSection.className = 'downstream-record';
    const downstreamTitle = document.createElement('h4');
    const downstreamList = document.createElement('ol');
    downstreamTitle.textContent = 'RETURNED DOWNSTREAM CONTEXT';
    renderDownstreamList(downstreamList, dependency);
    downstreamSection.append(downstreamTitle, downstreamList);

    const link = document.createElement('a');
    link.className = 'case-link';
    link.href = safetyCasePath(asset.id);
    link.textContent = 'OPEN ASSET SAFETY CASE →';

    container.append(identity, riskGrid, impact, downstreamSection, link);
  }

  function selectAsset(assetId, options = {}) {
    const id = String(assetId);
    if (!state.assets.some((asset) => String(asset.id) === id)) return;
    state.selected = id;
    if (options.persist !== false) storeSelection(id);
    updateSafetyCaseRoute();
    updateGraphPresentation();
    renderDetail();
    nodeFor(id)?.focus({ preventScroll: true });
  }

  function setGraphState(kind, title, detail) {
    const holder = $('[data-graph-state]');
    holder.dataset.state = kind;
    $('strong', holder).textContent = title;
    $('small', holder).textContent = detail;
    holder.hidden = kind === 'loaded';
  }

  function updateTopologyState() {
    setText('[data-asset-count]', state.assets.length || null);
    setText('[data-edge-count]', state.edges.length || null);
    if (!state.assets.length) return;
    if (!state.topologyAttempted) {
      setText('[data-topology-summary]', 'AWAITING DATA');
      setGraphState('topology', 'AWAITING DEPENDENCY TOPOLOGY', 'REAL ASSET NODES ARE AVAILABLE / NO EDGES GUESSED');
    } else if (!state.edges.length) {
      setText('[data-topology-summary]', 'UNAVAILABLE');
      setGraphState('topology', 'DEPENDENCY TOPOLOGY UNAVAILABLE', state.unresolved.length ? `${state.unresolved.length} RETURNED REFERENCES COULD NOT BE RESOLVED TO ASSET IDs` : 'NO RESOLVABLE DOWNSTREAM EDGES RETURNED');
    } else if (state.unresolved.length || state.topologyFailures) {
      setText('[data-topology-summary]', 'PARTIAL');
      setGraphState('partial', 'TOPOLOGY PARTIALLY RESOLVED', `${state.edges.length} CONFIRMED EDGES / ${state.unresolved.length} UNRESOLVED REFERENCES / ${state.topologyFailures} RISK REQUEST FAILURES`);
    } else {
      setText('[data-topology-summary]', 'API CONFIRMED');
      setGraphState('loaded', '', '');
    }
  }

  function renderGraph() {
    buildTopology();
    const signature = graphStructureSignature();
    if (signature !== state.graphSignature) rebuildGraph();
    updateGraphPresentation();
    renderDetail();
    updateTopologyState();
  }

  async function refreshTopology(version) {
    const results = await Promise.allSettled(state.assets.map((asset) => window.RakshakAPI.loadRisk(asset.id)));
    if (version !== state.requestVersion) return;
    state.topologyAttempted = true;
    state.topologyFailures = 0;
    results.forEach((result, index) => {
      const assetId = String(state.assets[index].id);
      if (result.status === 'fulfilled') state.riskObjects.set(assetId, result.value);
      else state.topologyFailures += 1;
    });
  }

  function clearGraphForIdentity() {
    state.assets = [];
    state.riskObjects.clear();
    state.edges = [];
    state.unresolved = [];
    state.positions.clear();
    state.graphSignature = '';
    state.topologyAttempted = false;
    state.topologyFailures = 0;
    $('[data-edges]').replaceChildren();
    $('[data-nodes]').replaceChildren();
    setText('[data-asset-count]', null);
    setText('[data-edge-count]', null);
    setText('[data-topology-summary]', 'AWAITING DATA');
    setGraphState('loading', 'AWAITING PLANT DEPENDENCY DATA', 'NO PLACEHOLDER NODES OR EDGES RENDERED');
    renderDetail();
  }

  function renderRefreshError(error) {
    document.body.dataset.mapState = state.assets.length ? 'stale' : 'error';
    if (state.assets.length) {
      setText('[data-system-state]', 'PLANT FEED TEMPORARILY UNAVAILABLE');
      setText('[data-refresh-state]', 'LAST-KNOWN-GOOD NETWORK RETAINED');
      setText('[data-risk-state]', 'RISK STATE / LAST KNOWN GOOD');
      return;
    }
    setText('[data-system-state]', 'PLANT DATA UNAVAILABLE');
    setText('[data-refresh-state]', error?.status ? `API STATUS ${error.status}` : 'BACKEND REQUEST FAILED');
    setText('[data-risk-state]', 'RISK DATA UNAVAILABLE');
    setGraphState('error', 'PLANT DATA UNAVAILABLE', 'NO FALLBACK ASSETS OR RELATIONSHIPS CREATED');
  }

  async function performRefresh() {
    const version = ++state.requestVersion;
    if (!state.assets.length) {
      document.body.dataset.mapState = 'loading';
      setText('[data-system-state]', 'AWAITING PLANT DEPENDENCY DATA');
      setText('[data-refresh-state]', 'REQUESTING API ASSET SNAPSHOT');
    }
    try {
      const assets = assetsFrom(await window.RakshakAPI.loadAssets());
      if (version !== state.requestVersion) return;
      if (!assets.length) {
        state.assets = [];
        state.riskObjects.clear();
        state.edges = [];
        state.graphSignature = '';
        $('[data-edges]').replaceChildren();
        $('[data-nodes]').replaceChildren();
        document.body.dataset.mapState = 'empty';
        setText('[data-system-state]', 'NO ASSET DATA AVAILABLE');
        setText('[data-refresh-state]', 'GET /api/assets RETURNED AN EMPTY ARRAY');
        setText('[data-risk-state]', 'NO RISK STATE AVAILABLE');
        setGraphState('empty', 'NO ASSET DATA AVAILABLE', 'NO STATIC ASSET NODES CREATED');
        renderDetail();
        return;
      }
      state.assets = assets;
      await refreshTopology(version);
      if (version !== state.requestVersion) return;
      if (state.selected && !state.assets.some((asset) => String(asset.id) === state.selected)) state.selected = null;
      if (!state.selected && state.requestedSelection && state.assets.some((asset) => String(asset.id) === String(state.requestedSelection))) state.selected = String(state.requestedSelection);
      state.lastGoodAt = new Date();
      document.body.dataset.mapState = 'loaded';
      renderGraph();
      updateSafetyCaseRoute();
      setText('[data-system-state]', state.edges.length ? 'PLANT DEPENDENCY NETWORK LINKED' : 'ASSET NETWORK LINKED / TOPOLOGY UNAVAILABLE');
      setText('[data-refresh-state]', `UPDATED ${state.lastGoodAt.toLocaleTimeString()}`);
      setText('[data-risk-state]', 'LIVE API RISK STATE');
    } catch (error) {
      if (version === state.requestVersion) renderRefreshError(error);
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

  function applyViewBox() {
    $('[data-graph]').setAttribute('viewBox', `${state.viewport.x} ${state.viewport.y} ${state.viewport.width} ${state.viewport.height}`);
  }

  function fitView() {
    state.viewport = { x: 0, y: 0, width: CANVAS.width, height: CANVAS.height };
    applyViewBox();
  }

  function zoom(direction) {
    const factor = direction === 'in' ? 0.82 : 1.22;
    const nextWidth = Math.max(660, Math.min(CANVAS.width, state.viewport.width * factor));
    const nextHeight = nextWidth * CANVAS.height / CANVAS.width;
    const centerX = state.viewport.x + state.viewport.width / 2;
    const centerY = state.viewport.y + state.viewport.height / 2;
    state.viewport = { x: centerX - nextWidth / 2, y: centerY - nextHeight / 2, width: nextWidth, height: nextHeight };
    applyViewBox();
  }

  function initializeControls() {
    $('[data-fit]').addEventListener('click', fitView);
    $$('[data-zoom]').forEach((button) => button.addEventListener('click', () => zoom(button.dataset.zoom)));
  }

  function handleIdentityChange() {
    renderIdentity();
  }

  initializeRoutes();
  initializeControls();
  renderIdentity();
  refresh();
  window.setInterval(refresh, POLL_MS);
}());
