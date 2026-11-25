'use strict';
/* Gemeinsame Helfer für Teilnehmenden- und Admin-Seite. */

async function api(method, url, body, adminToken) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (adminToken) headers['X-Admin-Token'] = adminToken;
  const res = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  let data = {};
  try { data = await res.json(); } catch (_) { /* leer */ }
  if (!res.ok) {
    const err = new Error(data.error || `Fehler ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/** Holt `fetchFn` bei jeder Server-Änderung (SSE) und zur Sicherheit alle 15 s. */
function live(fetchFn, indicator) {
  let timer = null;
  const refresh = () => {
    clearTimeout(timer);
    timer = setTimeout(() => { fetchFn().catch(() => {}); }, 50);
  };
  const setOn = (on) => { if (indicator) indicator.classList.toggle('on', on); };

  if ('EventSource' in window) {
    const es = new EventSource('/api/events');
    es.onopen = () => setOn(true);
    es.onmessage = refresh;
    es.onerror = () => setOn(false);
  }
  setInterval(() => { fetchFn().catch(() => {}); }, 15000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) refresh(); });
  fetchFn().catch(() => {});
}

function h(tag, props, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') el.className = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (v === true) el.setAttribute(k, '');
    else if (v !== false && v != null) el.setAttribute(k, v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    el.append(c.nodeType ? c : document.createTextNode(String(c)));
  }
  return el;
}

function hueFor(i) { return (250 + i * 47) % 360; }

/** Zeichnet alle Gruppen (+ Warteliste). Alle Texte laufen über textContent. */
function renderGroups(container, state, opts = {}) {
  const { mePid = null, onRemove = null } = opts;
  container.replaceChildren();
  if (!state.groups) return;

  const buckets = state.groups.map(() => []);
  const waiting = [];
  for (const p of state.participants) {
    if (p.group === -1) waiting.push(p);
    else if (p.group != null && buckets[p.group]) buckets[p.group].push(p);
  }
  const sortByName = (a, b) => a.name.localeCompare(b.name, 'de');

  const member = (p) => h('li', { class: p.pid === mePid ? 'me' : '' },
    h('span', {}, p.name, p.pid === mePid ? ' (du)' : ''),
    onRemove ? h('button', { class: 'icon', title: `${p.name} entfernen`, 'aria-label': `${p.name} entfernen`, onclick: () => onRemove(p) }, '×') : null);

  state.groups.forEach((name, i) => {
    const members = buckets[i].sort(sortByName);
    const mine = mePid && members.some((p) => p.pid === mePid);
    const size = state.drawSize ? `${members.length} / ${state.drawSize}` : String(members.length);
    container.append(h('section', { class: 'group' + (mine ? ' mine' : ''), style: `--h:${hueFor(i)}` },
      h('h3', {}, name, h('span', {}, size)),
      members.length ? h('ul', {}, members.map(member)) : h('p', { class: 'empty' }, 'noch leer')));
  });

  if (waiting.length) {
    container.append(h('section', { class: 'group wait' },
      h('h3', {}, 'Warteliste', h('span', {}, String(waiting.length))),
      h('p', { class: 'muted small' }, 'Alle Gruppen sind voll.'),
      h('ul', {}, waiting.sort(sortByName).map(member))));
  }
}
