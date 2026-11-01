#!/usr/bin/env node
/* ============================================================
   خادم داخلي لنظام المواعيد — بلا أي مكتبات خارجية (Node 18+)
   يوفر نفس البيانات التي تعمل عليها الواجهة، وواجهة REST تشبه Firestore
   حتى تعمل نفس الصفحات في الوضع المحلي والوضع السحابي بدون تعديل.
   التشغيل:  node server/server.js
   ============================================================ */
'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'db.json');
const ADMIN_EMAIL = process.env.ADMIN_EMAIL || 'admin@local';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || 'Admin@12345';

/* ---------------- قاعدة البيانات (ملف JSON) ---------------- */
let db = { collections: {} };
let saveTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) db = JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
  } catch (e) {
    console.error('تعذّر قراءة قاعدة البيانات، سيتم البدء بقاعدة جديدة:', e.message);
  }
  db.collections = db.collections || {};
}
function saveNow() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db));
  fs.renameSync(tmp, DB_FILE);
}
function save() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => { saveTimer = null; try { saveNow(); } catch (e) { console.error('save failed', e); } }, 120);
}
function coll(p) {
  const key = String(p || '').replace(/^\/+|\/+$/g, '');
  if (!db.collections[key]) db.collections[key] = {};
  return db.collections[key];
}
function existsColl(p) {
  const key = String(p || '').replace(/^\/+|\/+$/g, '');
  return db.collections[key];
}

/* ---------------- أدوات ---------------- */
const nowTs = () => ({ seconds: Math.floor(Date.now() / 1000), nanoseconds: 0 });

function hashPassword(password, salt) {
  salt = salt || crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return salt + ':' + hash;
}
function verifyPassword(password, stored) {
  if (!stored || stored.indexOf(':') < 0) return false;
  const [salt, hash] = stored.split(':');
  const test = crypto.scryptSync(String(password), salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(test, 'hex'));
}

function resolveValue(v) {
  if (v === null || typeof v !== 'object') return v;
  if (Array.isArray(v)) return v.map(resolveValue);
  if (v.__sv === 'serverTimestamp') return nowTs();
  if (v.__sv === 'delete') return undefined;
  const out = {};
  for (const k of Object.keys(v)) {
    if (v.__sv) break;
    const val = resolveValue(v[k]);
    if (val !== undefined) out[k] = val;
  }
  return out;
}

function applyUpdate(doc, patch) {
  for (const key of Object.keys(patch)) {
    const v = patch[key];
    if (v && typeof v === 'object' && v.__sv === 'arrayUnion') {
      const arr = Array.isArray(doc[key]) ? doc[key].slice() : [];
      (v.values || []).forEach(item => {
        const resolved = resolveValue(item);
        const s = JSON.stringify(resolved);
        if (!arr.some(x => JSON.stringify(x) === s)) arr.push(resolved);
      });
      doc[key] = arr;
    } else if (v && typeof v === 'object' && v.__sv === 'delete') {
      delete doc[key];
    } else {
      const resolved = resolveValue(v);
      if (resolved === undefined) delete doc[key];
      else doc[key] = resolved;
    }
  }
  doc.updatedAt = new Date().toISOString();
  return doc;
}

function sanitize(collPath, doc) {
  if (!doc) return doc;
  const copy = Object.assign({}, doc);
  if (String(collPath || '').split('/')[0] === 'users') delete copy.password;
  return copy;
}

function matches(doc, filters) {
  return (filters || []).every(f => {
    const v = doc[f.field];
    switch (f.op) {
      case '==': return JSON.stringify(v) === JSON.stringify(f.value);
      case '!=': return JSON.stringify(v) !== JSON.stringify(f.value);
      case 'array-contains': return Array.isArray(v) && v.some(x => JSON.stringify(x) === JSON.stringify(f.value));
      case '>=': return v !== undefined && v >= f.value;
      case '<=': return v !== undefined && v <= f.value;
      case '>': return v !== undefined && v > f.value;
      case '<': return v !== undefined && v < f.value;
      case 'in': return Array.isArray(f.value) && f.value.some(x => JSON.stringify(x) === JSON.stringify(v));
      default: return true;
    }
  });
}

/* ---------------- الجلسات ---------------- */
const sessions = new Map();
function newSession(user) {
  const sid = crypto.randomBytes(24).toString('hex');
  sessions.set(sid, { uid: user.uid, anonymous: !!user.anonymous, at: Date.now() });
  return sid;
}
function cookieSid(req) {
  const raw = req.headers.cookie || '';
  const m = raw.match(/(?:^|;\s*)sid=([a-f0-9]+)/);
  return m ? m[1] : null;
}
function currentUser(req) {
  const sid = cookieSid(req);
  if (!sid) return null;
  const s = sessions.get(sid);
  if (!s) return null;
  if (s.anonymous) return { uid: s.uid, anonymous: true, isAnonymous: true, email: null, name: 'مستفيد (حجز عام)' };
  const u = coll('users')[s.uid];
  if (!u) return null;
  return { uid: s.uid, email: u.email, name: u.name, role: u.role, dept: u.dept || '', isAnonymous: false };
}

/* ---------------- SSE (تحديث لحظي داخل الشبكة) ---------------- */
const sseClients = new Set();
function broadcast(changePath) {
  const payload = 'data: ' + JSON.stringify({ path: changePath, at: Date.now() }) + '\n\n';
  for (const res of sseClients) {
    try { res.write(payload); } catch (e) { sseClients.delete(res); }
  }
}

/* ---------------- المزامنة التلقائية مع Firebase ---------------- */
const SYNC_INTERVAL_MINUTES = Math.max(1, Number(process.env.SYNC_INTERVAL_MINUTES || 5));
const SYNC_DEBOUNCE_MS = Math.max(5000, Number(process.env.SYNC_DEBOUNCE_SECONDS || 20) * 1000);
const SYNC_PULL = String(process.env.SYNC_PULL || 'false').toLowerCase() === 'true';

const syncState = {
  enabled: false,
  running: false,
  intervalMinutes: SYNC_INTERVAL_MINUTES,
  pullEnabled: SYNC_PULL,
  lastRunAt: null,
  lastResult: null,
  lastError: null,
  runs: 0,
  users: { at: null, synced: 0, missing: [], errors: 0 }
};
let syncTimer = null;
let syncDebounce = null;
let syncModule = null;

function syncLogLine(line) {
  const msg = '[' + new Date().toISOString() + '] ' + line;
  console.log('[sync] ' + line);
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.appendFileSync(path.join(DATA_DIR, 'sync.log'), msg + '\n');
  } catch (e) { /* لا نُفشل النظام بسبب السجل */ }
}

function loadSyncModule() {
  if (syncModule) return syncModule;
  try { syncModule = require('./firebase-sync'); } catch (e) { syncModule = null; }
  return syncModule;
}

async function runSync(reason) {
  if (!syncState.enabled || syncState.running) return syncState;
  const mod = loadSyncModule();
  if (!mod) { syncState.lastError = 'وحدة المزامنة غير متاحة'; return syncState; }

  syncState.running = true;
  const started = Date.now();
  try {
    const pushRes = await mod.push({ data: db });
    let pullRes = null;
    if (SYNC_PULL) {
      pullRes = await mod.pull({ data: db });
      broadcast('appointments');
    }
    save();
    syncState.runs++;
    syncState.lastRunAt = new Date().toISOString();
    syncState.lastError = null;
    syncState.lastResult = {
      reason: reason || 'scheduled',
      pushed: pushRes.pushed,
      skipped: pushRes.skipped,
      errors: pushRes.errors,
      pulled: pullRes ? pullRes.added + pullRes.updated : 0,
      durationMs: Date.now() - started
    };
    await syncUsersIfChanged(mod);
    if (pushRes.pushed || (pullRes && (pullRes.added || pullRes.updated))) {
      syncLogLine('تمت المزامنة: رفع ' + pushRes.pushed + ' · سحب ' + (pullRes ? pullRes.added + pullRes.updated : 0) +
        ' · تُخطّي ' + pushRes.skipped + ' · أخطاء ' + pushRes.errors + ' (' + (reason || 'scheduled') + ')');
    }
    if (pushRes.errors) syncLogLine('تحذير: ' + pushRes.errors + ' مستند(ات) فشلت مزامنتها، سيُعاد المحاولة تلقائياً');
  } catch (e) {
    const raw = String(e && e.message || e);
    syncState.lastError = /fetch failed|ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|network/i.test(raw)
      ? 'تعذّر الاتصال بخوادم Google — تحقق من الإنترنت أو من بروكسي الشبكة على جهاز الخادم'
      : raw;
    syncState.lastRunAt = new Date().toISOString();
    syncLogLine('فشلت المزامنة: ' + syncState.lastError);
  } finally {
    syncState.running = false;
  }
  return syncState;
}

let lastUsersSignature = null;
function usersSignature() {
  const users = (db.collections && db.collections.users) || {};
  return JSON.stringify(Object.keys(users).sort().map(k => [users[k].email, users[k].name, users[k].role, users[k].dept]));
}

async function syncUsersIfChanged(mod) {
  if (!mod || !mod.syncUsers) return null;
  const sig = usersSignature();
  if (sig === lastUsersSignature) return null;
  try {
    const res = await mod.syncUsers({ data: db });
    syncState.users = {
      at: new Date().toISOString(),
      synced: res.synced,
      missing: res.missing.map(m => ({ name: m.name, email: m.email })),
      errors: res.errors
    };
    if (res.synced) syncLogLine('مزامنة الحسابات: ' + res.synced + ' حساباً' +
      (res.missing.length ? ' · بدون حساب Firebase: ' + res.missing.length : ''));
    if (res.missing.length) {
      syncLogLine('حسابات محلية بلا حساب Firebase: ' + res.missing.map(m => m.email).join(', '));
    }
    lastUsersSignature = sig;
    save();
    return res;
  } catch (e) {
    syncState.users = { at: new Date().toISOString(), synced: 0, missing: [], errors: 1 };
    syncLogLine('تعذّرت مزامنة الحسابات: ' + e.message);
    return null;
  }
}

function scheduleSyncSoon(reason) {
  if (!syncState.enabled) return;
  if (syncDebounce) return;
  syncDebounce = setTimeout(() => {
    syncDebounce = null;
    runSync(reason || 'after-change');
  }, SYNC_DEBOUNCE_MS);
}

function startSyncScheduler() {
  const mod = loadSyncModule();
  if (!mod || !mod.hasServiceAccount()) {
    syncState.enabled = false;
    console.log('المزامنة مع Firebase: غير مفعّلة (ضع ملف service-account.json في مجلد server لتفعيلها)');
    return;
  }
  syncState.enabled = true;
  syncLogLine('المزامنة مفعّلة — كل ' + SYNC_INTERVAL_MINUTES + ' دقيقة' + (SYNC_PULL ? ' (مع سحب من السحابة)' : ' (رفع فقط)'));
  setTimeout(() => runSync('startup'), 15000);
  syncTimer = setInterval(() => runSync('scheduled'), SYNC_INTERVAL_MINUTES * 60 * 1000);
  if (syncTimer.unref) syncTimer.unref();
}

/* ---------------- HTTP ---------------- */
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.ttf': 'font/ttf', '.map': 'application/json'
};

function send(res, code, obj, headers) {
  const body = JSON.stringify(obj);
  res.writeHead(code, Object.assign({
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store'
  }, headers || {}));
  res.end(body);
}
function fail(res, code, errCode, message) {
  send(res, code, { error: { code: errCode, message: message || errCode } });
}

function readBody(req, limitBytes) {
  return new Promise((resolve, reject) => {
    let size = 0; const chunks = [];
    req.on('data', c => {
      size += c.length;
      if (size > (limitBytes || 4 * 1024 * 1024)) { reject(Object.assign(new Error('payload too large'), { code: 'invalid-argument' })); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch (e) { reject(Object.assign(new Error('JSON غير صالح'), { code: 'invalid-argument' })); }
    });
    req.on('error', reject);
  });
}

function serveStatic(req, res, pathname) {
  let rel = decodeURIComponent(pathname);
  if (rel === '/' || rel === '') rel = '/index.html';
  const full = path.join(ROOT, rel);
  if (!full.startsWith(ROOT)) return fail(res, 403, 'permission-denied', 'مسار غير مسموح');
  fs.readFile(full, (err, buf) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('الصفحة غير موجودة');
      return;
    }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(full).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-cache'
    });
    res.end(buf);
  });
}

/* التحقق من الحجز العام (مطابق لقواعد Firestore) */
function validBooking(d) {
  const str = (v) => typeof v === 'string';
  if (!str(d.name) || d.name.length < 2 || d.name.length > 120) return false;
  if (!str(d.phone) || d.phone.length < 9 || d.phone.length > 15) return false;
  if (!str(d.subject) || d.subject.length < 2 || d.subject.length > 500) return false;
  if (!str(d.dept) || d.dept.length < 2 || d.dept.length > 100) return false;
  if (!str(d.date) || d.date.length !== 10) return false;
  if (!str(d.time)) return false;
  if (!str(d.status)) return false;
  if (d.deleted === true) return false;
  return true;
}

function userName(uid) { const u = coll('users')[uid]; return u ? u.name : ''; }
function isAdmin(user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  const u = coll('users')[user.uid];
  return !!(u && u.role === 'admin');
}

/* ---------------- المعالجة ---------------- */
async function handleApi(req, res, url) {
  const p = url.pathname;
  const user = currentUser(req);

  /* --- صحة الخادم: تستخدمها الواجهة لاكتشاف الوضع المحلي --- */
  if (p === '/api/health') {
    return send(res, 200, { ok: true, app: 'appointment-system', mode: 'local', time: new Date().toISOString() });
  }

  /* --- المصادقة --- */
  if (p === '/api/auth/me') {
    return send(res, 200, { user: user || null });
  }
  if (p === '/api/auth/login' && req.method === 'POST') {
    const body = await readBody(req);
    const email = String(body.email || '').trim().toLowerCase();
    const users = coll('users');
    const uid = Object.keys(users).find(k => String(users[k].email || '').toLowerCase() === email);
    if (!uid) return fail(res, 401, 'auth/user-not-found', 'البريد الإلكتروني غير مسجل');
    if (!verifyPassword(body.password || '', users[uid].password)) return fail(res, 401, 'auth/wrong-password', 'كلمة المرور غير صحيحة');
    const sid = newSession({ uid });
    const u = users[uid];
    return send(res, 200, {
      user: { uid, email: u.email, name: u.name, role: u.role, dept: u.dept || '', isAnonymous: false }
    }, { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
  }
  if (p === '/api/auth/logout' && req.method === 'POST') {
    const sid = cookieSid(req);
    if (sid) sessions.delete(sid);
    return send(res, 200, { ok: true }, { 'Set-Cookie': 'sid=; Path=/; HttpOnly; Max-Age=0' });
  }
  if (p === '/api/auth/anonymous' && req.method === 'POST') {
    const sid = newSession({ uid: 'anon-' + crypto.randomBytes(4).toString('hex'), anonymous: true });
    return send(res, 200, { user: { uid: 'anonymous', anonymous: true, isAnonymous: true, name: 'مستفيد (حجز عام)' } },
      { 'Set-Cookie': `sid=${sid}; Path=/; HttpOnly; SameSite=Lax` });
  }

  /* --- أحداث لحظية --- */
  if (p === '/api/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    res.write(': connected\n\n');
    sseClients.add(res);
    const ping = setInterval(() => { try { res.write(': ping\n\n'); } catch (e) {} }, 25000);
    req.on('close', () => { clearInterval(ping); sseClients.delete(res); });
    return;
  }

  /* --- قراءة --- */
  if (p === '/api/doc' && req.method === 'GET') {
    if (!user) return fail(res, 403, 'permission-denied', 'القراءة تتطلب جلسة');
    const collPath = url.searchParams.get('path');
    const id = url.searchParams.get('id');
    const doc = coll(collPath)[id];
    return send(res, 200, { id, exists: !!doc, data: doc ? sanitize(collPath, doc) : null });
  }
  if (p === '/api/query' && req.method === 'POST') {
    if (!user) return fail(res, 403, 'permission-denied', 'القراءة تتطلب جلسة');
    const body = await readBody(req);
    const docs = coll(body.path);
    let list = Object.keys(docs).map(id => ({ id, data: sanitize(body.path, docs[id]) }))
      .filter(d => matches(d.data, body.filters));
    if (body.limit) list = list.slice(0, body.limit);
    return send(res, 200, { docs: list });
  }

  /* --- كتابة --- */
  if (p === '/api/doc' && req.method === 'POST') {
    const body = await readBody(req);
    const collPath = String(body.path || '');
    const data = resolveValue(body.data || {});
    if (collPath === 'appointments' && !user && !validBooking(data)) {
      return fail(res, 403, 'permission-denied', 'بيانات الحجز غير مكتملة أو غير صالحة');
    }
    if (!user && collPath !== 'appointments') return fail(res, 403, 'permission-denied', 'الكتابة تتطلب جلسة');
    const docs = coll(collPath);
    let id = body.id ? String(body.id) : 'doc-' + crypto.randomBytes(6).toString('hex');
    if (docs[id]) return fail(res, 409, 'already-exists', 'المستند موجود مسبقاً');
    data.id = id;
    data.updatedAt = new Date().toISOString();
    docs[id] = data;
    save(); broadcast(collPath);
    if (collPath === 'appointments') scheduleSyncSoon('new-appointment');
    return send(res, 200, { id, data });
  }
  if (p === '/api/doc' && req.method === 'PUT') {
    const body = await readBody(req);
    const collPath = String(body.path || '');
    if (!body.id) return fail(res, 400, 'invalid-argument', 'معرّف المستند مطلوب');
    let data = resolveValue(body.data || {});
    if (collPath === 'appointments' && !user && !validBooking(data)) {
      return fail(res, 403, 'permission-denied', 'بيانات الحجز غير مكتملة أو غير صالحة');
    }
    if (!user && collPath !== 'appointments') return fail(res, 403, 'permission-denied', 'الكتابة تتطلب جلسة');
    const docs = coll(collPath);
    data.id = body.id;
    data.updatedAt = new Date().toISOString();
    docs[body.id] = data;
    save(); broadcast(collPath);
    if (collPath === 'appointments') scheduleSyncSoon('updated-appointment');
    return send(res, 200, { id: body.id, data });
  }
  if (p === '/api/doc' && req.method === 'PATCH') {
    if (!user) return fail(res, 403, 'permission-denied', 'التعديل يتطلب جلسة');
    const body = await readBody(req);
    const docs = coll(body.path);
    const doc = docs[body.id];
    if (!doc) return fail(res, 404, 'not-found', 'المستند غير موجود');
    applyUpdate(doc, body.data || {});
    save(); broadcast(body.path);
    if (body.path === 'appointments') scheduleSyncSoon('updated-appointment');
    return send(res, 200, { id: body.id, data: doc });
  }
  if (p === '/api/doc' && req.method === 'DELETE') {
    if (!user) return fail(res, 403, 'permission-denied', 'الحذف يتطلب جلسة');
    const body = await readBody(req);
    const docs = coll(body.path);
    if (!docs[body.id]) return fail(res, 404, 'not-found', 'المستند غير موجود');
    delete docs[body.id];
    save(); broadcast(body.path);
    if (body.path === 'appointments') scheduleSyncSoon('deleted-appointment');
    return send(res, 200, { ok: true });
  }
  if (p === '/api/batch' && req.method === 'POST') {
    if (!user) return fail(res, 403, 'permission-denied', 'الكتابة تتطلب جلسة');
    const body = await readBody(req);
    const touched = new Set();
    for (const op of body.ops || []) {
      const docs = coll(op.path);
      if (op.type === 'delete') { delete docs[op.id]; }
      else if (op.type === 'update') { if (docs[op.id]) applyUpdate(docs[op.id], op.data || {}); }
      else if (op.type === 'set') { docs[op.id] = Object.assign(resolveValue(op.data || {}), { id: op.id }); }
      touched.add(op.path);
    }
    save(); touched.forEach(broadcast);
    if (touched.has('appointments')) scheduleSyncSoon('batch');
    return send(res, 200, { ok: true });
  }

  /* --- المزامنة مع Firebase --- */
  if (p === '/api/sync/status') {
    if (!isAdmin(user)) return fail(res, 403, 'permission-denied', 'حالة المزامنة لمدير النظام فقط');
    return send(res, 200, {
      enabled: syncState.enabled,
      running: syncState.running,
      intervalMinutes: syncState.intervalMinutes,
      pullEnabled: syncState.pullEnabled,
      lastRunAt: syncState.lastRunAt,
      lastResult: syncState.lastResult,
      lastError: syncState.lastError,
      runs: syncState.runs,
      users: syncState.users,
      serviceAccount: (loadSyncModule() || {}).serviceAccountPath ? loadSyncModule().serviceAccountPath() : null
    });
  }
  if (p === '/api/sync/now' && req.method === 'POST') {
    if (!isAdmin(user)) return fail(res, 403, 'permission-denied', 'المزامنة الفورية لمدير النظام فقط');
    if (!syncState.enabled) return fail(res, 400, 'invalid-argument', 'المزامنة غير مفعّلة — ضع ملف service-account.json ثم أعد تشغيل الخادم');
    await runSync('manual');
    return send(res, 200, {
      ok: !syncState.lastError,
      lastRunAt: syncState.lastRunAt,
      lastResult: syncState.lastResult,
      lastError: syncState.lastError
    });
  }

  /* --- المستخدمون (مدير النظام) --- */
  if (p === '/api/users' && req.method === 'GET') {
    if (!user) return fail(res, 403, 'permission-denied', 'يتطلب جلسة');
    const users = coll('users');
    return send(res, 200, {
      users: Object.keys(users).map(uid => ({
        uid, name: users[uid].name, email: users[uid].email, role: users[uid].role, dept: users[uid].dept || ''
      }))
    });
  }
  if (p === '/api/users' && req.method === 'POST') {
    if (!isAdmin(user)) return fail(res, 403, 'permission-denied', 'إدارة المستخدمين لمدير النظام فقط');
    const body = await readBody(req);
    const users = coll('users');
    const email = String(body.email || '').trim().toLowerCase();
    if (!email || !body.password || !body.name) return fail(res, 400, 'invalid-argument', 'بيانات ناقصة');
    if (Object.keys(users).some(k => String(users[k].email || '').toLowerCase() === email)) {
      return fail(res, 409, 'auth/email-already-in-use', 'البريد الإلكتروني مستخدم بالفعل');
    }
    const uid = 'u-' + crypto.randomBytes(6).toString('hex');
    users[uid] = {
      name: body.name, email, role: body.role || 'registration', dept: body.dept || '',
      password: hashPassword(body.password), createdAt: new Date().toISOString()
    };
    save(); broadcast('users');
    if (syncState.enabled) {
      const email0 = email;
      const name0 = body.name;
      Promise.resolve().then(async () => {
        try {
          const mod = loadSyncModule();
          const acc = await mod.createAuthUser(email0, body.password, name0);
          const u = coll('users')[uid];
          if (u) {
            u.firebaseUid = acc.uid;
            delete u.authPending;
            await mod.pushUserDoc(acc.uid, u);
            save();
            broadcast('users');
            lastUsersSignature = null;
          }
          syncLogLine('أُنشئ حساب Firebase للمستخدم ' + email0);
        } catch (e) {
          const u = coll('users')[uid];
          if (u) { u.authPending = true; save(); }
          syncLogLine('تعذّر إنشاء حساب Firebase للمستخدم ' + email0 + ' (' + e.message + ') — أنشئه من لوحة Firebase');
        }
      });
    }
    return send(res, 200, { uid });
  }
  if (/^\/api\/users\/[^/]+\/password$/.test(p) && req.method === 'POST') {
    if (!isAdmin(user)) return fail(res, 403, 'permission-denied', 'تغيير كلمات المرور لمدير النظام فقط');
    const uid = p.split('/')[3];
    const users = coll('users');
    if (!users[uid]) return fail(res, 404, 'not-found', 'المستخدم غير موجود');
    const body = await readBody(req);
    const pw = String(body.password || '');
    if (pw.length < 6) return fail(res, 400, 'invalid-argument', 'كلمة المرور يجب أن تكون 6 أحرف على الأقل');
    users[uid].password = hashPassword(pw);
    users[uid].passwordChangedAt = new Date().toISOString();
    save();
    return send(res, 200, { ok: true });
  }
  if (p.startsWith('/api/users/') && req.method === 'DELETE') {
    if (!isAdmin(user)) return fail(res, 403, 'permission-denied', 'إدارة المستخدمين لمدير النظام فقط');
    const uid = p.split('/').pop();
    const users = coll('users');
    if (!users[uid]) return fail(res, 404, 'not-found', 'المستخدم غير موجود');
    delete users[uid];
    save(); broadcast('users');
    return send(res, 200, { ok: true });
  }

  return fail(res, 404, 'not-found', 'مسار غير معروف');
}

/* ---------------- التهيئة ---------------- */
function seedAdmin() {
  const users = coll('users');
  if (Object.keys(users).length > 0) return;
  const uid = 'u-admin';
  users[uid] = {
    name: 'مدير النظام', email: ADMIN_EMAIL.toLowerCase(), role: 'admin', dept: '',
    password: hashPassword(ADMIN_PASSWORD), createdAt: new Date().toISOString()
  };
  saveNow();
  console.log('==========================================================');
  console.log(' تم إنشاء حساب مدير النظام لأول مرة:');
  console.log('   البريد  : ' + ADMIN_EMAIL);
  console.log('   المرور  : ' + ADMIN_PASSWORD);
  console.log(' غيّر كلمة المرور بعد أول دخول (إدارة المستخدمين).');
  console.log('==========================================================');
}

load();
seedAdmin();
fs.mkdirSync(DATA_DIR, { recursive: true });

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://' + (req.headers.host || 'localhost'));
  if (url.pathname.startsWith('/api/')) {
    handleApi(req, res, url).catch(e => {
      if (!res.headersSent) fail(res, 500, e.code || 'internal', e.message);
      else try { res.end(); } catch (_) {}
    });
    return;
  }
  serveStatic(req, res, url.pathname);
});

startSyncScheduler();

server.listen(PORT, HOST, () => {
  console.log('نظام المواعيد يعمل في الوضع المحلي (شبكة داخلية)');
  console.log('الرابط: http://' + (HOST === '0.0.0.0' ? 'localhost' : HOST) + ':' + PORT + '/');
  console.log('البيانات: ' + DB_FILE);
});

process.on('SIGINT', () => { try { saveNow(); } catch (e) {} process.exit(0); });
process.on('SIGTERM', () => { try { saveNow(); } catch (e) {} process.exit(0); });
