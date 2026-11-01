/* ============================================================
   منطق مزامنة المواعيد مع Firebase (وحدة مشتركة)
   يستخدمها الخادم الداخلي تلقائياً، ويمكن تشغيلها يدوياً من sync-firebase.js
   ------------------------------------------------------------
   المتطلبات: server/service-account.json
   (Firebase ← Project settings ← Service accounts ← Generate new private key)
   ============================================================ */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DB_FILE = process.env.DATA_DIR ? path.join(process.env.DATA_DIR, 'db.json') : path.join(__dirname, 'data', 'db.json');
const SA_FILE = process.env.FIREBASE_SA || path.join(__dirname, 'service-account.json');
const COLLECTIONS = ['appointments'];
const API = 'https://firestore.googleapis.com/v1';

/* ---------------- حساب الخدمة والتوكن ---------------- */
function serviceAccountPath() { return SA_FILE; }
function hasServiceAccount() { return fs.existsSync(SA_FILE); }
function loadServiceAccount() { return JSON.parse(fs.readFileSync(SA_FILE, 'utf8')); }

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}
function makeJwt(sa, scope) {
  const now = Math.floor(Date.now() / 1000);
  const header = { alg: 'RS256', typ: 'JWT' };
  const claim = { iss: sa.client_email, scope, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 };
  const input = base64url(JSON.stringify(header)) + '.' + base64url(JSON.stringify(claim));
  const signer = crypto.createSign('RSA-SHA256');
  signer.update(input);
  const signature = signer.sign(sa.private_key).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
  return input + '.' + signature;
}
async function getToken(sa) {
  const assertion = makeJwt(sa, 'https://www.googleapis.com/auth/datastore');
  const body = 'grant_type=' + encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer') +
    '&assertion=' + encodeURIComponent(assertion);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body
  });
  const json = await res.json();
  if (!res.ok) {
    const e = new Error('فشل الحصول على صلاحية الوصول: ' + (json.error_description || json.error || res.status));
    e.code = 'sync/auth';
    throw e;
  }
  return json.access_token;
}

/* ---------------- تحويل القيم ---------------- */
function toValue(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'string') return { stringValue: v };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(toValue) } };
  if (typeof v === 'object') {
    if (typeof v.seconds === 'number') return { timestampValue: new Date(v.seconds * 1000).toISOString() };
    const fields = {};
    Object.keys(v).forEach(k => { fields[k] = toValue(v[k]); });
    return { mapValue: { fields } };
  }
  return { stringValue: String(v) };
}
function fromValue(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('timestampValue' in v) return { seconds: Math.floor(new Date(v.timestampValue).getTime() / 1000), nanoseconds: 0 };
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(fromValue);
  if ('mapValue' in v) {
    const out = {};
    const f = v.mapValue.fields || {};
    Object.keys(f).forEach(k => { out[k] = fromValue(f[k]); });
    return out;
  }
  return null;
}
function toFields(doc) {
  const fields = {};
  Object.keys(doc).forEach(k => { if (k !== 'id') fields[k] = toValue(doc[k]); });
  return fields;
}
function docName(project, coll, id) {
  return 'projects/' + project + '/databases/(default)/documents/' + coll + '/' + encodeURIComponent(id);
}

/* ---------------- Firestore REST ---------------- */
async function getRemote(token, project, coll, id) {
  const res = await fetch(API + '/' + docName(project, coll, id), { headers: { Authorization: 'Bearer ' + token } });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('قراءة ' + id + ' فشلت: ' + res.status);
  const json = await res.json();
  const out = {};
  const f = json.fields || {};
  Object.keys(f).forEach(k => { out[k] = fromValue(f[k]); });
  return out;
}
async function listRemote(token, project, coll) {
  let url = API + '/projects/' + project + '/databases/(default)/documents/' + coll + '?pageSize=300';
  const out = [];
  while (url) {
    const res = await fetch(url, { headers: { Authorization: 'Bearer ' + token } });
    if (!res.ok) throw new Error('قراءة القائمة فشلت: ' + res.status);
    const json = await res.json();
    (json.documents || []).forEach(d => {
      const id = decodeURIComponent(d.name.split('/').pop());
      const obj = { id };
      const f = d.fields || {};
      Object.keys(f).forEach(k => { obj[k] = fromValue(f[k]); });
      out.push(obj);
    });
    url = json.nextPageToken
      ? API + '/projects/' + project + '/databases/(default)/documents/' + coll + '?pageSize=300&pageToken=' + encodeURIComponent(json.nextPageToken)
      : null;
  }
  return out;
}
async function writeRemote(token, project, coll, id, doc) {
  const res = await fetch(API + '/' + docName(project, coll, id), {
    method: 'PATCH',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: toFields(doc) })
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error('كتابة ' + id + ' فشلت: ' + res.status + ' ' + txt.slice(0, 160));
  }
}

/* ---------------- محلي ---------------- */
function loadLocal() {
  if (!fs.existsSync(DB_FILE)) throw new Error('لا توجد قاعدة بيانات محلية: ' + DB_FILE);
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}
function saveLocal(db) {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 1));
  fs.renameSync(tmp, DB_FILE);
}
function stamp(doc) {
  if (!doc) return 0;
  if (doc.updatedAt) return new Date(doc.updatedAt).getTime() || 0;
  if (doc.createdAt && doc.createdAt.seconds) return doc.createdAt.seconds * 1000;
  return 0;
}

/* ---------------- العمليات ---------------- */
async function push(opts) {
  opts = opts || {};
  const sa = loadServiceAccount();
  const project = sa.project_id;
  const token = await getToken(sa);
  const db = opts.data || loadLocal();
  const result = { project, pushed: 0, skipped: 0, errors: 0, details: [] };

  for (const collName of COLLECTIONS) {
    const localColl = (db.collections && db.collections[collName]) || {};
    for (const id of Object.keys(localColl)) {
      const localDoc = localColl[id];
      try {
        const remoteDoc = await getRemote(token, project, collName, id);
        if (remoteDoc && stamp(remoteDoc) >= stamp(localDoc)) { result.skipped++; continue; }
        if (opts.dryRun) { result.details.push({ id, action: remoteDoc ? 'update' : 'create' }); continue; }
        if (localDoc.syncError) delete localDoc.syncError;
        await writeRemote(token, project, collName, id, localDoc);
        result.pushed++;
      } catch (e) {
        result.errors++;
        result.details.push({ id, error: e.message });
        if (!opts.dryRun) {
          localDoc.syncError = e.message;
          localDoc.syncErrorAt = new Date().toISOString();
        }
      }
    }
  }
  if (!opts.data && !opts.dryRun) saveLocal(db);
  result.data = db.collections;
  return result;
}

async function pull(opts) {
  opts = opts || {};
  const sa = loadServiceAccount();
  const project = sa.project_id;
  const token = await getToken(sa);
  const db = opts.data || loadLocal();
  db.collections = db.collections || {};
  const result = { project, added: 0, updated: 0, skipped: 0, errors: 0, details: [] };

  for (const collName of COLLECTIONS) {
    const remote = await listRemote(token, project, collName);
    db.collections[collName] = db.collections[collName] || {};
    for (const r of remote) {
      const id = r.id;
      const cur = db.collections[collName][id];
      if (!cur) { db.collections[collName][id] = r; result.added++; }
      else if (stamp(r) > stamp(cur)) { db.collections[collName][id] = Object.assign({}, cur, r); result.updated++; }
      else result.skipped++;
    }
  }
  if (!opts.data && !opts.dryRun) saveLocal(db);
  result.data = db.collections;
  return result;
}

async function status() {
  const sa = loadServiceAccount();
  const project = sa.project_id;
  const token = await getToken(sa);
  const db = loadLocal();
  const out = { project, pending: 0, items: [] };
  const localColl = (db.collections && db.collections.appointments) || {};
  for (const id of Object.keys(localColl)) {
    const remoteDoc = await getRemote(token, project, 'appointments', id);
    if (!remoteDoc) { out.pending++; out.items.push({ id, action: 'create' }); }
    else if (stamp(remoteDoc) < stamp(localColl[id])) { out.pending++; out.items.push({ id, action: 'update' }); }
  }
  return out;
}

module.exports = {
  serviceAccountPath, hasServiceAccount, loadServiceAccount,
  makeJwt, getToken, toValue, fromValue, toFields, stamp,
  push, pull, status, DB_FILE, SA_FILE
};
