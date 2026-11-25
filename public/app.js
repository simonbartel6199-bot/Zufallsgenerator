'use strict';
/* Oberfläche für Teilnehmende */

const $ = (id) => document.getElementById(id);
const KEY = 'zg-me';

let me = null; // { pid, token, name }
try { me = JSON.parse(localStorage.getItem('zg-me')); } catch (_) { me = null; }

let state = null;
let lastRound = null;
let animating = false;

function show(id, on) { $(id).classList.toggle('hidden', !on); }

function forgetMe() {
  me = null;
  try { localStorage.removeItem(KEY); } catch (_) { /* ignorieren */ }
}

async function leave() {
  if (!me) return;
  if (!confirm('Wirklich abmelden? Du wirst aus der Liste entfernt.')) return;
  try { await api('POST', '/api/leave', { token: me.token }); } catch (_) { /* egal */ }
  forgetMe();
  await load();
}

function render() {
  if (!state) return;
  $('loading').classList.add('hidden');

  const mine = me && state.participants.find((p) => p.pid === me.pid);
  if (me && !mine) forgetMe(); // wurde (z. B. vom Admin) entfernt

  const drawn = state.phase === 'drawn';
  const registered = !!(me && mine);

  // Anmeldung
  show('joinCard', !registered && state.registrationOpen);
  show('closedCard', !registered && !state.registrationOpen);
  $('joinInfo').textContent = drawn
    ? 'Die Gruppen sind schon ausgelost – du wirst automatisch einer Gruppe zugeteilt.'
    : `${state.participants.length} ${state.participants.length === 1 ? 'Person ist' : 'Personen sind'} schon angemeldet.`;

  // Wartezustand
  show('waitCard', registered && !drawn);
  if (registered) $('meName').textContent = mine.name;

  // Ergebnis
  const showResult = drawn && !animating;
  show('groupsCard', showResult);
  show('shuffleCard', drawn && animating);
  show('peopleCard', !drawn);
  show('resultHero', false);
  show('waitlistHero', false);

  if (showResult) {
    if (registered && mine.group != null && mine.group >= 0) {
      $('myGroup').textContent = state.groups[mine.group];
      show('resultHero', true);
    } else if (registered && mine.group === -1) {
      show('waitlistHero', true);
    }
    $('groupsNote').textContent = state.drawSize
      ? `Maximal ${state.drawSize} Personen pro Gruppe.`
      : '';
    show('leaveRow', registered);
    renderGroups($('groups'), state, { mePid: registered ? me.pid : null });
  }

  // Liste vor der Auslosung
  if (!drawn) {
    $('peopleCount').textContent = state.participants.length;
    $('people').replaceChildren(...state.participants
      .slice().sort((a, b) => a.name.localeCompare(b.name, 'de'))
      .map((p) => h('li', { class: 'chip' + (registered && p.pid === me.pid ? ' me' : '') }, p.name)));
  }
}

async function load() {
  const next = await api('GET', '/api/state');

  // Neue Auslosung, während die Seite offen ist → kurze Animation
  if (lastRound !== null && next.round !== lastRound && next.phase === 'drawn' && !animating) {
    animating = true;
    state = next;
    render();
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    setTimeout(() => {
      animating = false;
      render();
      const hero = $('resultHero');
      if (!hero.classList.contains('hidden') && !reduce) {
        hero.classList.remove('pop');
        void hero.offsetWidth;
        hero.classList.add('pop');
      }
    }, reduce ? 0 : 1800);
  } else {
    state = next;
    if (!animating) render();
  }
  lastRound = next.round;
}

$('joinForm').addEventListener('submit', async (e) => {
  e.preventDefault();
  $('joinError').textContent = '';
  const btn = e.target.querySelector('button');
  btn.disabled = true;
  try {
    const res = await api('POST', '/api/join', { name: $('name').value });
    me = { pid: res.pid, token: res.token, name: res.name };
    try { localStorage.setItem(KEY, JSON.stringify(me)); } catch (_) { /* ignorieren */ }
    $('name').value = '';
    await load();
  } catch (err) {
    $('joinError').textContent = err.message;
  } finally {
    btn.disabled = false;
  }
});

$('leaveBtn').addEventListener('click', leave);
$('leaveBtn2').addEventListener('click', leave);

live(load, $('live'));
