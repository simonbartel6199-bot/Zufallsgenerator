'use strict';
/* Admin-Oberfläche */

const $ = (id) => document.getElementById(id);
const TOKEN_KEY = 'zg-admin-token';

let token = null;
try { token = localStorage.getItem(TOKEN_KEY); } catch (_) { token = null; }

let state = null;
let formDirty = false;
let started = false;

function show(id, on) { $(id).classList.toggle('hidden', !on); }

function logout() {
  token = null;
  try { localStorage.removeItem(TOKEN_KEY); } catch (_) { /* ignorieren */ }
  show('adminView', false);
  show('loginView', true);
}

async function call(method, url, body) {
  try {
    return await api(method, url, body, token);
  } catch (err) {
    if (err.status === 401) logout();
    throw err;
  }
}

/* ---------- Formular ---------- */
function readConfig() {
  const names = $('groupNames').value.split('\n').map((s) => s.trim());
  while (names.length && !names[names.length - 1]) names.pop();
  let count = parseInt($('groupCount').value, 10) || 1;
  if (names.length > count) { count = names.length; $('groupCount').value = count; }
  const size = parseInt($('groupSize').value, 10);
  return {
    groupCount: count,
    groupSize: Number.isInteger(size) && size > 0 ? size : null,
    groupNames: names,
    registrationOpen: $('regOpen').checked,
  };
}

function fillForm(cfg) {
  $('groupCount').value = cfg.groupCount;
  $('groupSize').value = cfg.groupSize || '';
  $('groupNames').value = cfg.groupNames.join('\n');
  $('regOpen').checked = cfg.registrationOpen;
}

function updateSizeHint() {
  const cfg = readConfig();
  const n = state ? state.participants.length : 0;
  let text = '';
  if (n > 0) {
    const lo = Math.floor(n / cfg.groupCount);
    const hi = Math.ceil(n / cfg.groupCount);
    text = `Bei ${n} Teilnehmenden: ${lo === hi ? lo : `${lo}–${hi}`} Personen pro Gruppe.`;
    if (cfg.groupSize) {
      const cap = cfg.groupSize * cfg.groupCount;
      text += n > cap
        ? ` ⚠️ Es passen nur ${cap} Personen hinein – ${n - cap} kämen auf die Warteliste.`
        : ` Maximal ${cfg.groupSize} pro Gruppe.`;
    }
  }
  $('sizeHint').textContent = text;
}

/* ---------- Anzeige ---------- */
function render() {
  if (!state) return;
  if (!formDirty) fillForm(state.config);
  updateSizeHint();

  const drawn = state.phase === 'drawn';
  $('countBadge').textContent = state.participants.length;

  const people = state.participants.slice().sort((a, b) => a.name.localeCompare(b.name, 'de'));
  $('people').replaceChildren(...(people.length
    ? people.map((p) => h('li', { class: 'chip' },
      p.name,
      h('button', { class: 'icon', title: `${p.name} entfernen`, 'aria-label': `${p.name} entfernen`, onclick: () => removePerson(p) }, '×')))
    : [h('li', { class: 'empty' }, 'Noch niemand angemeldet.')]));

  $('statusText').textContent = drawn
    ? `Ausgelost (Durchgang ${state.round}). Du kannst jederzeit neu auslosen – alle sehen das Ergebnis sofort.`
    : (state.participants.length ? 'Noch nicht ausgelost – Teilnehmende sehen bis dahin nur die Liste der Angemeldeten.' : 'Warte auf Anmeldungen …');
  $('drawBtn').textContent = drawn ? '🎲 Neu auslosen' : '🎲 Zufällig einteilen';
  $('drawBtn').disabled = state.participants.length === 0;
  $('resetBtn').disabled = !drawn;
  $('clearBtn').disabled = state.participants.length === 0;

  show('resultCard', drawn);
  if (drawn) renderGroups($('groups'), state, { onRemove: removePerson });
}

async function load() {
  if (!token) return;
  try {
    state = await call('GET', '/api/admin/state');
  } catch (err) {
    return;
  }
  show('loginView', false);
  show('adminView', true);
  if (!started) {
    started = true;
    $('shareUrl').textContent = `${location.origin}/`;
  }
  render();
}

function setError(msg) { $('actionError').textContent = msg || ''; }

/* ---------- Aktionen ---------- */
async function saveConfig() {
  const res = await call('PUT', '/api/admin/config', readConfig());
  formDirty = false;
  state = res;
  render();
  return res;
}

async function removePerson(p) {
  setError('');
  try { await call('DELETE', `/api/admin/participants/${p.pid}`); await load(); } catch (e) { setError(e.message); }
}

$('loginForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('loginError').textContent = '';
  try {
    const res = await api('POST', '/api/admin/login', { password: $('pw').value });
    token = res.token;
    try { localStorage.setItem(TOKEN_KEY, token); } catch (_) { /* ignorieren */ }
    $('pw').value = '';
    start();
  } catch (err) {
    $('loginError').textContent = err.message;
  }
});

$('logoutBtn').addEventListener('click', logout);

$('saveBtn').addEventListener('click', async () => {
  setError('');
  $('saveMsg').textContent = '';
  try {
    await saveConfig();
    $('saveMsg').textContent = 'Gespeichert ✓';
    setTimeout(() => { $('saveMsg').textContent = ''; }, 2500);
  } catch (e) { setError(e.message); }
});

['groupCount', 'groupSize', 'groupNames', 'regOpen'].forEach((id) => {
  $(id).addEventListener('input', () => { formDirty = true; updateSizeHint(); });
  $(id).addEventListener('change', () => { formDirty = true; updateSizeHint(); });
});

// Anmeldung öffnen/schließen wirkt sofort (wird mit den übrigen Einstellungen gespeichert)
$('regOpen').addEventListener('change', async () => {
  setError('');
  try { await saveConfig(); } catch (e) { setError(e.message); }
});

$('drawBtn').addEventListener('click', async () => {
  setError('');
  if (state.phase === 'drawn' && !confirm('Wirklich neu auslosen? Die bisherige Einteilung wird für alle ersetzt.')) return;
  try {
    state = await call('POST', '/api/admin/draw', { config: readConfig() });
    formDirty = false;
    render();
  } catch (e) { setError(e.message); }
});

$('resetBtn').addEventListener('click', async () => {
  setError('');
  if (!confirm('Einteilung zurücksetzen? Die Teilnehmenden bleiben angemeldet, die Gruppen verschwinden für alle.')) return;
  try { state = await call('POST', '/api/admin/reset-draw'); render(); } catch (e) { setError(e.message); }
});

$('clearBtn').addEventListener('click', async () => {
  setError('');
  if (!confirm('Wirklich ALLE Teilnehmenden entfernen und die Einteilung löschen?')) return;
  try { state = await call('POST', '/api/admin/clear'); render(); } catch (e) { setError(e.message); }
});

$('addBtn').addEventListener('click', async () => {
  setError('');
  const names = $('addNames').value.split('\n').map((s) => s.trim()).filter(Boolean);
  if (!names.length) return;
  try {
    const res = await call('POST', '/api/admin/participants', { names });
    $('addNames').value = '';
    $('addMsg').textContent = `${res.added.length} hinzugefügt` + (res.skipped.length ? `, übersprungen (Duplikat/Limit): ${res.skipped.join(', ')}` : '');
    await load();
  } catch (e) { setError(e.message); }
});

$('copyUrl').addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(`${location.origin}/`);
    $('copyUrl').textContent = 'Kopiert ✓';
  } catch (_) {
    $('copyUrl').textContent = 'Bitte manuell kopieren';
  }
  setTimeout(() => { $('copyUrl').textContent = 'Link kopieren'; }, 2000);
});

$('copyResult').addEventListener('click', async () => {
  if (!state || !state.groups) return;
  const lines = state.groups.map((name, i) => {
    const members = state.participants.filter((p) => p.group === i).map((p) => p.name).sort((a, b) => a.localeCompare(b, 'de'));
    return `${name}: ${members.join(', ')}`;
  });
  const wait = state.participants.filter((p) => p.group === -1).map((p) => p.name);
  if (wait.length) lines.push(`Warteliste: ${wait.join(', ')}`);
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    $('copyResult').textContent = 'Kopiert ✓';
  } catch (_) {
    $('copyResult').textContent = 'Kopieren nicht möglich';
  }
  setTimeout(() => { $('copyResult').textContent = 'Ergebnis als Text kopieren'; }, 2000);
});

let liveStarted = false;
function start() {
  if (liveStarted) { load(); return; }
  liveStarted = true;
  live(load, $('live'));
}

if (token) {
  start();
} else {
  show('loginView', true);
}
