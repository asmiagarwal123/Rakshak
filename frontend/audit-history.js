(function initializeAuditHistory() {
  const POLL_MS = 1000;
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = {
    events: [],
    nodes: new Map(),
    knownKeys: new Set(),
    expandedKeys: new Set(),
    initialized: false,
    lastGoodAt: null,
    requestVersion: 0,
    refreshPromise: null,
    refreshQueued: false,
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

  function selectedUser() {
    return window.RakshakIdentity?.getSelectedUser?.() || null;
  }

  function renderIdentity() {
    const user = selectedUser();
    const badge = $('[data-identity-state]');
    setText('[data-active-user]', user?.name, 'SELECT USER IN COMMAND CENTER');
    setText('[data-active-role]', user?.role ? String(user.role).toUpperCase() : null, 'IDENTITY REQUIRED');
    if (badge) badge.dataset.identityState = user ? 'verified' : 'unverified';
  }

  function initializeRoutes() {
    $$('[data-route]').forEach((link) => {
      const route = window.RakshakRoutes?.[link.dataset.route];
      if (route?.path) link.href = route.path;
    });
  }

  function safetyCasePath(assetId) {
    const base = window.RakshakRoutes?.safetyCase?.path || 'asset-safety-case.html';
    return `${base}?asset=${encodeURIComponent(assetId)}`;
  }

  function eventsFrom(payload) {
    const events = Array.isArray(payload) ? payload : Array.isArray(payload?.events) ? payload.events : [];
    return events.filter((event) => event && typeof event === 'object');
  }

  function safeJson(value, spacing = 0) {
    try { return JSON.stringify(value, null, spacing); } catch { return String(value); }
  }

  function hashText(value) {
    let hash = 2166136261;
    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function eventFingerprint(event) {
    if (hasValue(event.id)) return `id:${event.id}`;
    if (hasValue(event.event_id)) return `event:${event.event_id}`;
    return `record:${hashText([
      display(event.timestamp || event.created_at || event.time, ''),
      display(event.actor || event.actor_id, ''),
      display(event.asset_id, ''),
      display(event.event_type, ''),
      safeJson(event.payload),
    ].join('|'))}`;
  }

  function keyedEvents(events) {
    const occurrences = new Map();
    return events.map((event) => {
      const fingerprint = eventFingerprint(event);
      const occurrence = occurrences.get(fingerprint) || 0;
      occurrences.set(fingerprint, occurrence + 1);
      return { event, key: `${fingerprint}:${occurrence}` };
    });
  }

  function timestampValue(event) {
    const parsed = Date.parse(event.timestamp || event.created_at || event.time || '');
    return Number.isFinite(parsed) ? parsed : null;
  }

  function newestFirst(events) {
    return events.map((event, index) => ({ event, index, time: timestampValue(event) }))
      .sort((a, b) => {
        if (a.time !== null && b.time !== null && a.time !== b.time) return b.time - a.time;
        if (a.time !== null && b.time === null) return -1;
        if (a.time === null && b.time !== null) return 1;
        return a.index - b.index;
      })
      .map((entry) => entry.event);
  }

  function filterValues(field) {
    return [...new Set(state.events.map(({ event }) => event[field]).filter(hasValue).map(String))]
      .sort((a, b) => a.localeCompare(b));
  }

  function createOption(value, label = value) {
    const option = document.createElement('option');
    option.value = value;
    option.textContent = label;
    return option;
  }

  function populateSelect(select, values, allLabel) {
    const current = select.value;
    select.replaceChildren(createOption('', allLabel), ...values.map((value) => createOption(value)));
    select.value = values.includes(current) ? current : '';
  }

  function populateFilters() {
    populateSelect($('[data-asset-filter]'), filterValues('asset_id'), 'ALL ASSETS');
    populateSelect($('[data-type-filter]'), filterValues('event_type'), 'ALL EVENT TYPES');
  }

  function filteredEvents() {
    const assetId = $('[data-asset-filter]').value;
    const eventType = $('[data-type-filter]').value;
    return state.events.filter(({ event }) => (
      (!assetId || String(event.asset_id) === assetId)
      && (!eventType || String(event.event_type) === eventType)
    ));
  }

  function updateFilterState(visibleCount) {
    const assetId = $('[data-asset-filter]').value;
    const eventType = $('[data-type-filter]').value;
    const clear = $('[data-clear-filters]');
    clear.disabled = !assetId && !eventType;
    setText('[data-visible-count]', visibleCount);
    if (!assetId && !eventType) setText('[data-filter-state]', 'SHOWING ALL RECEIVED EVENTS');
    else {
      const scopes = [];
      if (assetId) scopes.push(`ASSET ${assetId}`);
      if (eventType) scopes.push(`TYPE ${eventType}`);
      setText('[data-filter-state]', `${visibleCount} MATCHES / ${scopes.join(' / ')}`);
    }
  }

  function timestampParts(event) {
    const raw = display(event.timestamp || event.created_at || event.time, 'TIMESTAMP NOT RETURNED');
    const separator = raw.indexOf('T');
    if (separator < 0) return { raw, date: raw, time: '' };
    return { raw, date: raw.slice(0, separator), time: raw.slice(separator + 1) };
  }

  function compactValue(value) {
    if (!hasValue(value)) return 'NULL';
    if (typeof value === 'object') return safeJson(value);
    return String(value);
  }

  function payloadEntries(payload) {
    if (payload && typeof payload === 'object' && !Array.isArray(payload)) return Object.entries(payload);
    return hasValue(payload) ? [['value', payload]] : [];
  }

  function createEventIcon(eventType) {
    const type = String(eventType || '').toUpperCase();
    const holder = document.createElement('span');
    holder.className = 'event-icon';
    holder.setAttribute('aria-hidden', 'true');
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    let drawing = 'M4 12h4l2-5 4 10 2-5h4';
    if (type.includes('ASSESS')) drawing = 'M4 5h16v14H4zM8 9h8M8 13h5';
    else if (type.includes('ACTION')) drawing = 'M5 12l4 4 10-10';
    else if (type.includes('INTERVENTION')) drawing = 'M4 8h12M12 4l4 4-4 4M20 16H8M12 12l-4 4 4 4';
    else if (type.includes('RESET')) drawing = 'M7 7a7 7 0 1 1-2 7M7 3v4H3';
    else if (type.includes('ESCALATE')) drawing = 'M5 18 12 5l7 13M8 14h8';
    path.setAttribute('d', drawing);
    svg.append(path);
    holder.append(svg);
    return holder;
  }

  function createPayloadSummary(payload) {
    const summary = document.createElement('div');
    summary.className = 'payload-summary';
    const entries = payloadEntries(payload).slice(0, 3);
    if (!entries.length) {
      const empty = document.createElement('span');
      empty.className = 'payload-empty';
      empty.textContent = 'NO PAYLOAD DETAIL RETURNED';
      summary.append(empty);
      return summary;
    }
    entries.forEach(([key, value]) => {
      const item = document.createElement('span');
      const label = document.createElement('small');
      const data = document.createElement('strong');
      label.textContent = String(key).replaceAll('_', ' ').toUpperCase();
      data.textContent = compactValue(value);
      item.append(label, data);
      summary.append(item);
    });
    return summary;
  }

  function createPayloadDetail(payload, detailId) {
    const detail = document.createElement('div');
    detail.className = 'event-detail';
    detail.id = detailId;
    detail.hidden = true;
    const entries = payloadEntries(payload);
    if (!entries.length) {
      const empty = document.createElement('p');
      empty.textContent = 'NO PAYLOAD DETAIL RETURNED';
      detail.append(empty);
      return detail;
    }
    const list = document.createElement('dl');
    entries.forEach(([key, value]) => {
      const row = document.createElement('div');
      const term = document.createElement('dt');
      const description = document.createElement('dd');
      term.textContent = String(key).replaceAll('_', ' ').toUpperCase();
      description.textContent = compactValue(value);
      row.append(term, description);
      list.append(row);
    });
    detail.append(list);
    return detail;
  }

  function createEventNode(record, isNew) {
    const { event, key } = record;
    const article = document.createElement('article');
    article.className = `event-record${isNew ? ' is-new' : ''}`;
    article.dataset.eventKey = key;
    article.dataset.eventType = display(event.event_type, 'UNSPECIFIED').toUpperCase();

    const timestamp = timestampParts(event);
    const time = document.createElement('time');
    time.className = 'event-time';
    time.dateTime = timestamp.raw;
    time.title = timestamp.raw;
    const date = document.createElement('span');
    const clock = document.createElement('strong');
    date.textContent = timestamp.date;
    clock.textContent = timestamp.time;
    time.append(date, clock);

    const marker = document.createElement('span');
    marker.className = 'rail-marker';
    marker.setAttribute('aria-hidden', 'true');

    const card = document.createElement('div');
    card.className = 'event-card';
    const head = document.createElement('header');
    head.className = 'event-head';
    const icon = createEventIcon(event.event_type);
    const identity = document.createElement('div');
    identity.className = 'event-identity';
    const channel = document.createElement('span');
    const type = document.createElement('h3');
    channel.textContent = 'RECORDED EVENT';
    type.textContent = display(event.event_type, 'EVENT TYPE NOT RETURNED').toUpperCase();
    identity.append(channel, type);
    head.append(icon, identity);

    if (hasValue(event.asset_id)) {
      const asset = document.createElement('a');
      asset.className = 'event-asset';
      asset.href = safetyCasePath(event.asset_id);
      asset.setAttribute('aria-label', `Open Asset Safety Case for ${event.asset_id}`);
      asset.textContent = `ASSET ${event.asset_id} ↗`;
      head.append(asset);
    }

    const actor = document.createElement('div');
    actor.className = 'event-actor';
    const actorLabel = document.createElement('span');
    const actorValue = document.createElement('strong');
    actorLabel.textContent = 'ACTOR';
    actorValue.textContent = display(event.actor || event.actor_id, 'NOT RETURNED');
    actor.append(actorLabel, actorValue);

    const summary = createPayloadSummary(event.payload);
    const detailId = `event-detail-${hashText(key)}`;
    const detail = createPayloadDetail(event.payload, detailId);
    card.append(head, actor, summary);

    if (payloadEntries(event.payload).length) {
      const toggle = document.createElement('button');
      toggle.className = 'event-toggle';
      toggle.type = 'button';
      toggle.setAttribute('aria-expanded', 'false');
      toggle.setAttribute('aria-controls', detailId);
      toggle.textContent = 'VIEW PAYLOAD DETAIL +';
      toggle.addEventListener('click', () => {
        const expanded = toggle.getAttribute('aria-expanded') !== 'true';
        toggle.setAttribute('aria-expanded', String(expanded));
        toggle.textContent = expanded ? 'HIDE PAYLOAD DETAIL −' : 'VIEW PAYLOAD DETAIL +';
        detail.hidden = !expanded;
        article.classList.toggle('is-expanded', expanded);
        if (expanded) state.expandedKeys.add(key);
        else state.expandedKeys.delete(key);
      });
      card.append(toggle, detail);
    } else card.append(detail);

    article.append(time, marker, card);
    if (state.expandedKeys.has(key)) {
      const toggle = $('.event-toggle', article);
      if (toggle) {
        toggle.setAttribute('aria-expanded', 'true');
        toggle.textContent = 'HIDE PAYLOAD DETAIL −';
        detail.hidden = false;
        article.classList.add('is-expanded');
      }
    }
    if (isNew) window.setTimeout(() => article.classList.remove('is-new'), 1900);
    return article;
  }

  function timelineState(kind, title, detail) {
    const timeline = $('[data-timeline]');
    let holder = $('[data-timeline-state]', timeline);
    if (!holder) {
      holder = document.createElement('div');
      holder.className = 'timeline-state';
      holder.dataset.timelineState = '';
      const indicator = document.createElement('i');
      indicator.setAttribute('aria-hidden', 'true');
      holder.append(indicator, document.createElement('strong'), document.createElement('small'));
      timeline.append(holder);
    }
    holder.dataset.state = kind;
    $('strong', holder).textContent = title;
    $('small', holder).textContent = detail;
    return holder;
  }

  function renderTimeline(newKeys = new Set()) {
    const timeline = $('[data-timeline]');
    const visible = filteredEvents();
    updateFilterState(visible.length);
    timeline.setAttribute('aria-busy', 'false');

    const existingState = $('[data-timeline-state]', timeline);
    if (!visible.length) {
      $$('[data-event-key]', timeline).forEach((node) => node.remove());
      const filteredOut = state.events.length > 0;
      timelineState('empty', filteredOut ? 'NO EVENTS MATCH CURRENT FILTERS' : 'NO AUDIT EVENTS YET', filteredOut ? 'CLEAR OR CHANGE THE CLIENT-SIDE FILTERS' : 'NO SAMPLE EVENTS INJECTED');
      return;
    }
    existingState?.remove();

    const visibleKeys = new Set(visible.map(({ key }) => key));
    $$('[data-event-key]', timeline).forEach((node) => {
      if (!visibleKeys.has(node.dataset.eventKey)) node.remove();
    });
    visible.forEach((record, index) => {
      let node = state.nodes.get(record.key);
      if (!node) {
        node = createEventNode(record, newKeys.has(record.key));
        state.nodes.set(record.key, node);
      }
      const current = timeline.children[index];
      if (current !== node) timeline.insertBefore(node, current || null);
    });
  }

  function pruneDetachedEvents(currentKeys) {
    state.nodes.forEach((node, key) => {
      if (!currentKeys.has(key)) {
        node.remove();
        state.nodes.delete(key);
        state.expandedKeys.delete(key);
      }
    });
  }

  function renderLoaded(events) {
    const records = keyedEvents(newestFirst(events));
    const currentKeys = new Set(records.map(({ key }) => key));
    const newKeys = state.initialized
      ? new Set(records.filter(({ key }) => !state.knownKeys.has(key)).map(({ key }) => key))
      : new Set();
    state.events = records;
    populateFilters();
    pruneDetachedEvents(currentKeys);
    renderTimeline(newKeys);
    state.knownKeys = currentKeys;
    state.initialized = true;
    setText('[data-total-count]', records.length);
    setText('[data-recorder-state]', records.length ? 'LIVE / LINKED' : 'EMPTY');
  }

  function renderRefreshError(error) {
    document.body.dataset.auditState = state.initialized ? 'stale' : 'error';
    setText('[data-feed-state]', 'AUDIT FEED TEMPORARILY UNAVAILABLE');
    setText('[data-recorder-state]', state.initialized ? 'LAST KNOWN GOOD' : 'UNAVAILABLE');
    if (state.initialized) {
      setText('[data-update-state]', 'LAST-KNOWN-GOOD HISTORY RETAINED');
      return;
    }
    if (error?.status === 401) {
      setText('[data-update-state]', 'BACKEND RETURNED 401 / SELECT A VALID USER');
      timelineState('error', 'SELECT A VALID USER', 'CHOOSE A BACKEND-PROVIDED IDENTITY IN COMMAND CENTER');
    } else if (error?.status === 403) {
      setText('[data-update-state]', 'BACKEND RETURNED 403 / ACCESS DENIED');
      timelineState('error', 'AUDIT FEED TEMPORARILY UNAVAILABLE', 'SELECTED IDENTITY IS NOT AUTHORIZED');
    } else {
      setText('[data-update-state]', error?.status ? `API STATUS ${error.status}` : 'BACKEND REQUEST FAILED');
      timelineState('error', 'AUDIT FEED TEMPORARILY UNAVAILABLE', 'NO FALLBACK EVENTS CREATED');
    }
    $('[data-timeline]').setAttribute('aria-busy', 'false');
  }

  async function performRefresh() {
    const version = ++state.requestVersion;
    if (!state.initialized) {
      document.body.dataset.auditState = 'loading';
      $('[data-timeline]').setAttribute('aria-busy', 'true');
      setText('[data-feed-state]', 'AWAITING AUDIT DATA');
      setText('[data-update-state]', 'REQUESTING GET /api/audit');
    }
    try {
      const payload = await window.RakshakAPI.loadAudit();
      if (version !== state.requestVersion) return;
      const events = eventsFrom(payload);
      state.lastGoodAt = new Date();
      document.body.dataset.auditState = events.length ? 'loaded' : 'empty';
      renderLoaded(events);
      setText('[data-feed-state]', events.length ? 'AUDIT FEED LINKED' : 'AUDIT FEED LINKED / NO EVENTS');
      setText('[data-update-state]', `UPDATED ${state.lastGoodAt.toLocaleTimeString()}`);
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

  function clearProtectedHistory() {
    state.requestVersion += 1;
    state.events = [];
    state.nodes.clear();
    state.knownKeys.clear();
    state.expandedKeys.clear();
    state.initialized = false;
    state.lastGoodAt = null;
    $('[data-timeline]').replaceChildren();
    timelineState('loading', 'AWAITING AUDIT EVENTS', 'NO SAMPLE EVENTS INJECTED');
    setText('[data-total-count]', null);
    setText('[data-visible-count]', null);
    setText('[data-recorder-state]', 'AWAITING DATA');
    populateFilters();
  }

  function handleIdentityChange() {
    clearProtectedHistory();
    renderIdentity();
    refresh();
  }

  function handleFilterChange() {
    renderTimeline();
  }

  initializeRoutes();
  renderIdentity();
  $('[data-asset-filter]').addEventListener('change', handleFilterChange);
  $('[data-type-filter]').addEventListener('change', handleFilterChange);
  $('[data-clear-filters]').addEventListener('click', () => {
    $('[data-asset-filter]').value = '';
    $('[data-type-filter]').value = '';
    renderTimeline();
  });
  window.addEventListener('rakshak:identity-change', handleIdentityChange);
  refresh();
  window.setInterval(refresh, POLL_MS);
}());
