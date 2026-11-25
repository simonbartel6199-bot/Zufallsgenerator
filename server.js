'use strict';
/**
 * Zufallsgenerator für Gruppeneinteilungen
 * - Teilnehmende-Seite:  /
 * - Admin-Seite:         /admin   (Passwort)
 * Keine externen Abhängigkeiten, nur Node.js >= 18.
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = Number(process.env.PORT) || 3000;
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'state.json');
const PUBLIC_DIR = path.join(__dirname, 'public');

const MAX_PARTICIPANTS = 500;
const MAX_NAME_LEN = 40;

fs.mkdirSync(DATA_DIR, { recursive: true });

/* ------------------------------------------------------------------ */
/* Admin-Passwort                                                      */
/* ------------------------------------------------------------------ */
function loadAdminPassword() {
  if (process.env.ADMIN_PASSWORD) return process.env.ADMIN_PASSWORD;
  const file = path.join(DATA_DIR, 'admin-password.txt');
  try {
    const pw = fs.readFileSync(file, 'utf8').trim();
    if (pw) return pw;
  } catch (_) { /* noch nicht vorhanden */ }
  const pw = crypto.randomBytes(6).toString('base64url');
  try { fs.writeFileSync(file, pw + '\n', { mode: 0o600 }); } catch (_) { /* ignorieren */ }
  console.log(`\nKein ADMIN_PASSWORD gesetzt – zufälliges Passwort erzeugt: ${pw}\n`);
  return pw;
}
const ADMIN_PASSWORD = loadAdminPassword();
const ADMIN_TOKEN = crypto.createHmac('sha256', ADMIN_PASSWORD).update('zufallsgenerator-admin').digest('hex');

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

const loginFails = new Map(); // ip -> {count, resetAt}
function clientIp(req) {
  const xf = req.headers['x-forwarded-for'];
  if (xf) return String(xf).split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
}

/* ------------------------------------------------------------------ */
/* Zustand                                                             */
/* ------------------------------------------------------------------ */
function defaultState() {
  return {
    config: { groupCount: 3, groupNames: [], groupSize: null, registrationOpen: true },
    phase: 'open',            // 'open' | 'drawn'
    round: 0,                 // zählt Auslosungen hoch
    draw: null,               // { groups: [Namen], size: number|null, at: ISO }
    participants: [],         // { pid, token, name, group, joinedAt }; group: null | -1 (Warteliste) | Index
  };
}

let state = defaultState();
try {
  const loaded = JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
  state = Object.assign(defaultState(), loaded);
  state.config = Object.assign(defaultState().config, loaded.config || {});
} catch (_) { /* erster Start */ }

let version = 1;
const sseClients = new Set();

function save() {
  version++;
  const tmp = DATA_FILE + '.tmp';
  try {
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, DATA_FILE);
  } catch (e) {
    console.error('Speichern fehlgeschlagen:', e.message);
  }
  for (const res of sseClients) {
    try { res.write(`data: ${version}\n\n`); } catch (_) { sseClients.delete(res); }
  }
}

/* ------------------------------------------------------------------ */
/* Logik                                                               */
/* ------------------------------------------------------------------ */
function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = crypto.randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function groupNamesFromConfig(cfg) {
  const names = [];
  for (let i = 0; i < cfg.groupCount; i++) {
    names.push((cfg.groupNames[i] || '').trim() || `Gruppe ${i + 1}`);
  }
  return names;
}

function performDraw() {
  const cfg = state.config;
  const names = groupNamesFromConfig(cfg);
  const n = names.length;
  const cap = cfg.groupSize || Infinity;
  const people = shuffle(state.participants);
  const order = shuffle([...Array(n).keys()]); // welche Gruppen bekommen bei Ungleichheit die „Extra“-Person
  people.forEach((p, i) => {
    p.group = i >= n * cap ? -1 : order[i % n];
  });
  state.draw = { groups: names, size: cfg.groupSize || null, at: new Date().toISOString() };
  state.phase = 'drawn';
  state.round++;
}

function groupCounts() {
  const counts = Array(state.draw.groups.length).fill(0);
  for (const p of state.participants) if (p.group != null && p.group >= 0) counts[p.group]++;
  return counts;
}

/** Ordnet eine Person nach der Auslosung der kleinsten Gruppe mit freiem Platz zu (bei Gleichstand zufällig). */
function placeLate(person) {
  const cap = state.draw.size || Infinity;
  const counts = groupCounts();
  let best = [];
  let min = Infinity;
  counts.forEach((c, i) => {
    if (c >= cap) return;
    if (c < min) { min = c; best = [i]; } else if (c === min) best.push(i);
  });
  person.group = best.length ? best[crypto.randomInt(best.length)] : -1;
}

function promoteWaitlist() {
  if (state.phase !== 'drawn') return;
  for (const p of state.participants) {
    if (p.group === -1) {
      placeLate(p);
      if (p.group === -1) break; // alles voll
    }
  }
}

function cleanName(raw) {
  return String(raw == null ? '' : raw)
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_NAME_LEN);
}

function nameTaken(name) {
  const lower = name.toLowerCase();
  return state.participants.some((p) => p.name.toLowerCase() === lower);
}

function addParticipant(name) {
  const p = {
    pid: crypto.randomBytes(6).toString('hex'),
    token: crypto.randomBytes(16).toString('hex'),
    name,
    group: null,
    joinedAt: new Date().toISOString(),
  };
  state.participants.push(p);
  if (state.phase === 'drawn') placeLate(p);
  return p;
}

function publicState() {
  return {
    version,
    phase: state.phase,
    round: state.round,
    registrationOpen: state.config.registrationOpen,
    groupCount: state.config.groupCount,
    groupSize: state.config.groupSize,
    groups: state.phase === 'drawn' && state.draw ? state.draw.groups : null,
    drawSize: state.draw ? state.draw.size : null,
    participants: state.participants.map((p) => ({ pid: p.pid, name: p.name, group: state.phase === 'drawn' ? p.group : null })),
  };
}

function adminState() {
  return Object.assign(publicState(), { config: state.config });
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */
class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

function sendJson(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > 100 * 1024) { reject(new HttpError(413, 'Anfrage zu groß')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch (_) { reject(new HttpError(400, 'Ungültiges JSON')); }
    });
    req.on('error', reject);
  });
}

function requireAdmin(req) {
  const token = req.headers['x-admin-token'];
  if (!token || !safeEqual(token, ADMIN_TOKEN)) throw new HttpError(401, 'Nicht angemeldet');
}

function parseConfig(body) {
  const cfg = {};
  const count = Number(body.groupCount);
  if (!Number.isInteger(count) || count < 1 || count > 50) throw new HttpError(400, 'Anzahl der Gruppen muss zwischen 1 und 50 liegen');
  cfg.groupCount = count;

  if (body.groupSize === null || body.groupSize === '' || body.groupSize === undefined) {
    cfg.groupSize = null;
  } else {
    const size = Number(body.groupSize);
    if (!Number.isInteger(size) || size < 1 || size > 500) throw new HttpError(400, 'Gruppengröße muss zwischen 1 und 500 liegen');
    cfg.groupSize = size;
  }

  const names = Array.isArray(body.groupNames) ? body.groupNames : [];
  cfg.groupNames = names.slice(0, count).map((n) => cleanName(n));
  cfg.registrationOpen = body.registrationOpen !== false;
  return cfg;
}

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;

  if (route === 'GET /api/state') return sendJson(res, 200, publicState());

  if (route === 'GET /api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 3000\n\n');
    sseClients.add(res);
    req.on('close', () => sseClients.delete(res));
    return undefined;
  }

  if (route === 'POST /api/join') {
    const body = await readJson(req);
    if (!state.config.registrationOpen) throw new HttpError(403, 'Die Anmeldung ist geschlossen');
    const name = cleanName(body.name);
    if (!name) throw new HttpError(400, 'Bitte einen Namen eingeben');
    if (nameTaken(name)) throw new HttpError(409, 'Dieser Name ist schon vergeben – bitte z. B. den Nachnamen ergänzen');
    if (state.participants.length >= MAX_PARTICIPANTS) throw new HttpError(403, 'Maximale Teilnehmerzahl erreicht');
    const p = addParticipant(name);
    save();
    return sendJson(res, 200, { pid: p.pid, token: p.token, name: p.name });
  }

  if (route === 'POST /api/leave') {
    const body = await readJson(req);
    const idx = state.participants.findIndex((p) => p.token === body.token);
    if (idx === -1) return sendJson(res, 200, { ok: true });
    state.participants.splice(idx, 1);
    promoteWaitlist();
    save();
    return sendJson(res, 200, { ok: true });
  }

  if (route === 'POST /api/admin/login') {
    const ip = clientIp(req);
    const now = Date.now();
    const rec = loginFails.get(ip);
    if (rec && rec.resetAt > now && rec.count >= 5) throw new HttpError(429, 'Zu viele Versuche – bitte kurz warten');
    const body = await readJson(req);
    if (typeof body.password === 'string' && safeEqual(body.password, ADMIN_PASSWORD)) {
      loginFails.delete(ip);
      return sendJson(res, 200, { token: ADMIN_TOKEN });
    }
    const cur = rec && rec.resetAt > now ? rec : { count: 0, resetAt: now + 60_000 };
    cur.count++;
    loginFails.set(ip, cur);
    throw new HttpError(401, 'Falsches Passwort');
  }

  if (url.pathname.startsWith('/api/admin/')) {
    requireAdmin(req);

    if (route === 'GET /api/admin/state') return sendJson(res, 200, adminState());

    if (route === 'PUT /api/admin/config') {
      state.config = parseConfig(await readJson(req));
      save();
      return sendJson(res, 200, adminState());
    }

    if (route === 'POST /api/admin/draw') {
      const body = await readJson(req);
      if (body.config) state.config = parseConfig(body.config);
      if (!state.participants.length) throw new HttpError(400, 'Es gibt noch keine Teilnehmenden');
      performDraw();
      save();
      return sendJson(res, 200, adminState());
    }

    if (route === 'POST /api/admin/reset-draw') {
      state.phase = 'open';
      state.draw = null;
      state.participants.forEach((p) => { p.group = null; });
      save();
      return sendJson(res, 200, adminState());
    }

    if (route === 'POST /api/admin/clear') {
      state.participants = [];
      state.phase = 'open';
      state.draw = null;
      save();
      return sendJson(res, 200, adminState());
    }

    if (route === 'POST /api/admin/participants') {
      const body = await readJson(req);
      const names = Array.isArray(body.names) ? body.names : [];
      const added = [];
      const skipped = [];
      for (const raw of names) {
        const name = cleanName(raw);
        if (!name) continue;
        if (nameTaken(name) || state.participants.length >= MAX_PARTICIPANTS) { skipped.push(name); continue; }
        addParticipant(name);
        added.push(name);
      }
      if (added.length) save();
      return sendJson(res, 200, { added, skipped });
    }

    const del = url.pathname.match(/^\/api\/admin\/participants\/([0-9a-f]+)$/);
    if (del && req.method === 'DELETE') {
      const idx = state.participants.findIndex((p) => p.pid === del[1]);
      if (idx !== -1) {
        state.participants.splice(idx, 1);
        promoteWaitlist();
        save();
      }
      return sendJson(res, 200, { ok: true });
    }
  }

  throw new HttpError(404, 'Nicht gefunden');
}

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
};

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  if (rel === '/admin') rel = '/admin.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (!file.startsWith(PUBLIC_DIR + path.sep)) throw new HttpError(403, 'Verboten');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('Nicht gefunden');
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(file)] || 'application/octet-stream',
      'Cache-Control': 'no-cache',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(data);
  });
}

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') { res.writeHead(200); return res.end('ok'); }
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'Methode nicht erlaubt');
    return serveStatic(req, res, url);
  } catch (e) {
    if (res.headersSent) return res.end();
    const status = e instanceof HttpError ? e.status : 500;
    if (status === 500) console.error(e);
    return sendJson(res, status, { error: status === 500 ? 'Serverfehler' : e.message });
  }
});

setInterval(() => {
  for (const res of sseClients) { try { res.write(': ping\n\n'); } catch (_) { sseClients.delete(res); } }
}, 25_000).unref();

server.listen(PORT, () => {
  console.log(`Zufallsgenerator läuft auf http://localhost:${PORT}  (Admin: /admin)`);
});
