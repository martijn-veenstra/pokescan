/* PokeScan sync: localStorage stays the working copy; scans and roster are mirrored to the server's /api when
   the app is served by the PokeScan server and a passcode has been entered. On GitHub Pages there is no API,
   so this module stays silent and the button is hidden. */
(function () {
'use strict';
const S = Object.assign({code: '', last: {}, base: {}, user: ''}, JSON.parse(localStorage.getItem('sync') || '{}'));
const save = () => localStorage.setItem('sync', JSON.stringify(S));
/* Local data is per account. The plain keys stay the working copy; on an account switch they are parked under
   u:<userId>:<key> (or anon:<key>) and the incoming account's parked copy takes their place, then the page
   reloads so every in-memory structure (results, Planner.ROSTER, …) starts from the right store. Data made
   without an account is adopted by the first account that signs in; after that nothing crosses accounts. */
const USER_KEYS = ['scans', 'roster', 'battles', 'blog', 'bdraft', 'bcoach', 'shares', 'scanlog', 'tname', 'trainer', 'appr', 'mu', 'milestones', 'shadow'];
if (!localStorage.getItem('ns')) localStorage.setItem('ns', S.user || 'anon');   // migration: existing keys belong to the signed-in user, or to anon
const parked = id => USER_KEYS.some(k => localStorage.getItem('u:' + id + ':' + k) !== null);
function swapStore(to) {                        // returns true when the page must reload to pick up the new store
  const from = localStorage.getItem('ns') || 'anon';
  if (from === to) return false;
  if (to !== 'anon' && from === 'anon' && !parked(to)) { localStorage.setItem('ns', to); return false; }   // first sign-in adopts the anonymous data
  for (const k of USER_KEYS) {                  // park the current owner's data…
    const v = localStorage.getItem(k);
    if (v === null) localStorage.removeItem('u:' + from + ':' + k); else localStorage.setItem('u:' + from + ':' + k, v);
  }
  for (const k of USER_KEYS) {                  // …and put the new owner's in its place
    const v = localStorage.getItem('u:' + to + ':' + k);
    if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v);
  }
  localStorage.setItem('ns', to);
  try { caches.delete('share-inbox'); } catch {}   // shared screenshots waiting for import belong to the previous user
  return true;
}
let available = null, timer = null, busy = false, lastError = '', health = null, me = null;   // me: /api/me (plan, features) for the signed-in account
const dirty = new Set(S.dirty || []);           // kinds with unpushed edits; persisted in S so a reload inside the debounce loses nothing
const epoch = {};                               // per kind, bumped by touch(): an edit made during a PUT stays queued
/* Per-record ledger: SH[kind][id] = {h: hash of the record, t: ms of the last local change, del: 1 for a tombstone}.
   touch() diffs the working copy against it, so every edit and delete gets a timestamp even when offline; the merge
   in applyRemote takes the newer side per record, and a tombstone beats an older record, so deletes stick. */
const SH = JSON.parse(localStorage.getItem('shadow') || '{}');
const saveShadow = () => localStorage.setItem('shadow', JSON.stringify(SH));
const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = (h * 33 ^ s.charCodeAt(i)) >>> 0; return h.toString(36); };
const TOMB_TTL = 90 * 24 * 3600e3;              // tombstones older than 90 days are pruned
const ROSTER_BLOCKS = ['owned', 'pending', 'candidates', 'tagged', 'moves', 'done', 'snooze', 'seen', 'have'];
const rosterDoc = () => window.Planner ? Planner.ROSTER : JSON.parse(localStorage.getItem('roster') || '{}');
const battlesArr = () => window.Planner ? Planner.BATTLES : JSON.parse(localStorage.getItem('battles') || '[]');
function localItems(kind) {                     // id → value of the live working copy
  const m = new Map();
  if (kind === 'scans') { for (const r of (typeof results !== 'undefined' ? results : [])) if (r && r.key) m.set(r.key, r); }
  else if (kind === 'battles') { for (const b of battlesArr()) if (b && b.id) m.set(b.id, b); }
  else if (kind === 'roster') {
    const R = rosterDoc();
    for (const blk of ROSTER_BLOCKS) for (const [k, v] of Object.entries(R[blk] || {})) m.set(blk + ':' + k, v === undefined ? null : v);
    for (const x of R.exclude || []) m.set('x:' + x, 1);
  }
  return m;
}
function stamp(kind) {                          // record what changed: new/edited records get now(), gone records a tombstone
  const led = SH[kind] || (SH[kind] = {});
  const first = !led.__init;                    // migration: records that predate the ledger get 0, so the first merge is today's union
  const items = localItems(kind), t = Date.now();
  for (const [id, v] of items) {
    const h = hash(JSON.stringify(v)), e = led[id];
    if (!e || e.h !== h || e.del) led[id] = { h, t: first && !e ? 0 : t };
  }
  if (!first) for (const [id, e] of Object.entries(led)) if (id !== '__init' && !e.del && !items.has(id)) led[id] = { t, del: 1 };
  for (const [id, e] of Object.entries(led)) if (id !== '__init' && e.del && t - e.t > TOMB_TTL) delete led[id];
  led.__init = 1;
  saveShadow();
}
function wire(kind) {                           // the push payload: records with their updatedAt, plus tombstones
  stamp(kind);
  const led = SH[kind] || {};
  if (kind === 'scans' || kind === 'battles') {
    const out = [];
    for (const [id, v] of localItems(kind)) out.push(Object.assign({}, v, { updatedAt: (led[id] || {}).t || 0 }));
    for (const [id, e] of Object.entries(led)) if (id !== '__init' && e.del) out.push(kind === 'scans' ? { key: id, deleted: true, updatedAt: e.t } : { id, deleted: true, updatedAt: e.t });
    return out;
  }
  if (kind === 'roster') {
    const meta = {}, del = {};
    for (const [id, e] of Object.entries(led)) { if (id === '__init') continue; if (e.del) del[id] = e.t; else meta[id] = e.t; }
    return Object.assign({}, rosterDoc(), { __meta: meta, __del: del });
  }
  return null;
}
const $ = id => document.getElementById(id);
const clerkMode = () => !!(health && health.auth === 'clerk');
const signedIn = () => clerkMode() ? !!(window.Auth && Auth.signedIn()) : !!S.code;   // the one question every caller asks
async function hdr() {                          // Clerk: a fresh short-lived session token per request; passcode: the code
  const tok = clerkMode() ? await Auth.token() : S.code;
  if (!tok) throw new Error(clerkMode() ? 'signed out' : 'connect sync first (cloud button)');
  return {authorization: 'Bearer ' + tok, 'content-type': 'application/json'};
}
const authErr = () => clerkMode() ? 'signed out' : 'wrong passcode';

let detectedAt = 0;
async function detect() {
  detectedAt = Date.now();
  try {
    const r = await fetch('/api/health', {cache: 'no-store'});
    const j = r.ok ? await r.json() : null;
    health = j;
    available = !!(j && j.ok && j.sync);
    if (available && window.Auth) Auth.init(j).then(() => paint());
  } catch { available = false; }
  paint();
  return available;
}
function local(kind) {
  if (kind === 'scans') return results;
  if (kind === 'roster') return rosterDoc();
  if (kind === 'battles') return battlesArr();
  return null;
}
function mergeList(kind, data) {                // scans and battles: per record, the newer side wins; a tombstone is a record
  const led = SH[kind] || (SH[kind] = {});
  const isScan = kind === 'scans';
  const arr = local(kind);
  const idOf = r => isScan ? r && r.key : r && r.id;
  const valid = r => isScan ? (r && typeof r.key === 'string' && typeof r.species === 'string' && Array.isArray(r.combos)) : (r && r.id);
  const pos = new Map(); arr.forEach((r, i) => pos.set(idOf(r), i));
  const reindex = () => { pos.clear(); arr.forEach((r, i) => pos.set(idOf(r), i)); };
  let changed = false;
  for (const raw of data || []) {
    const id = idOf(raw); if (!id) continue;
    const rt = Number(raw.updatedAt) || 0, e = led[id], lt = e ? e.t : 0;
    if (raw.deleted) {                          // their delete: only when newer than our last change
      if (e && rt <= lt) continue;
      if (pos.has(id)) { arr.splice(pos.get(id), 1); reindex(); changed = true; }
      led[id] = { t: rt, del: 1 };
      continue;
    }
    if (!valid(raw)) continue;
    const rec = Object.assign({}, raw); delete rec.updatedAt; delete rec.deleted;
    if (!pos.has(id)) {
      if (e && e.del && lt >= rt) continue;     // we deleted it more recently: it stays gone
      arr.push(rec); pos.set(id, arr.length - 1);
      led[id] = { h: hash(JSON.stringify(rec)), t: rt }; changed = true;
    } else if (rt > lt) {                       // their edit is newer: their record replaces ours
      arr[pos.get(id)] = rec;
      led[id] = { h: hash(JSON.stringify(rec)), t: rt }; changed = true;
    } else if (isScan && rt === lt) {           // same age (usually both 0, from before the ledger): today's field union
      const r = arr[pos.get(id)]; let filled = false;
      for (const f of ['superseded', 'appraisal', 'moves', 'fav', 'bench', 'level', 'combos', 'cp']) if (r[f] === undefined && rec[f] !== undefined) { r[f] = rec[f]; filled = true; }
      if (filled) { led[id] = { h: hash(JSON.stringify(r)), t: lt }; changed = true; }
    }
  }
  if (changed) {
    if (isScan) { localStorage.setItem('scans', JSON.stringify(arr)); if (typeof render === 'function') render(); }
    else { arr.sort((a, b) => a.t - b.t); localStorage.setItem('battles', JSON.stringify(arr)); }
  }
  saveShadow();
  return changed;
}
function mergeRoster(data) {                    // per entry over every block; __meta/__del carry the remote timestamps (absent from old clients: 0)
  const led = SH.roster || (SH.roster = {});
  const R = local('roster');
  const meta = (data && data.__meta) || {}, del = (data && data.__del) || {};
  const parts = id => { const i = id.indexOf(':'); return [id.slice(0, i), id.slice(i + 1)]; };
  const has = id => { if (id[0] === 'x' && id[1] === ':') return (R.exclude || []).includes(id.slice(2)); const [b, k] = parts(id); return !!R[b] && (k in R[b]); };
  const put = (id, v) => { if (id[0] === 'x' && id[1] === ':') { (R.exclude = R.exclude || []).includes(id.slice(2)) || R.exclude.push(id.slice(2)); return; } const [b, k] = parts(id); (R[b] = R[b] || {})[k] = v; };
  const drop = id => { if (id[0] === 'x' && id[1] === ':') { R.exclude = (R.exclude || []).filter(y => y !== id.slice(2)); return; } const [b, k] = parts(id); if (R[b]) delete R[b][k]; };
  let changed = false;
  const rItems = new Map();
  for (const blk of ROSTER_BLOCKS) for (const [k, v] of Object.entries((data || {})[blk] || {})) rItems.set(blk + ':' + k, v === undefined ? null : v);
  for (const x of (data || {}).exclude || []) rItems.set('x:' + x, 1);
  for (const [id, v] of rItems) {
    const rt = Number(meta[id]) || 0, e = led[id], lt = e ? e.t : 0;
    if (!has(id)) {
      if (e && e.del && lt >= rt) continue;
      put(id, v); led[id] = { h: hash(JSON.stringify(v)), t: rt }; changed = true;
    } else if (rt > lt) { put(id, v); led[id] = { h: hash(JSON.stringify(v)), t: rt }; changed = true; }
  }
  for (const [id, dt0] of Object.entries(del)) {
    const dt = Number(dt0) || 0, e = led[id], lt = e ? e.t : 0;
    if (e && dt <= lt) continue;
    if (has(id)) { drop(id); changed = true; }
    led[id] = { t: dt, del: 1 };
  }
  R.log = R.log || [];                          // the activity log stays an append-only union
  const seen = new Set(R.log.map(e => e.t + e.id));
  for (const e of (data || {}).log || []) if (e && !seen.has(e.t + e.id)) { R.log.push(e); changed = true; }
  R.log.sort((a, b) => b.t - a.t); R.log = R.log.slice(0, 50);
  localStorage.setItem('roster', JSON.stringify(R));
  saveShadow();
  return changed;
}
function applyRemote(kind, data) {
  if (!(SH[kind] || {}).__init) stamp(kind);    // baseline first, so our unsent local changes carry their timestamps into the merge
  if (kind === 'scans' || kind === 'battles') return mergeList(kind, data);
  if (kind === 'roster') return mergeRoster(data);
  return false;
}
async function pull() {
  const r = await fetch('/api/state', {headers: await hdr(), cache: 'no-store'});
  if (r.status === 401) throw new Error(authErr());
  if (!r.ok) throw new Error('server ' + r.status);
  const {state} = await r.json();
  let changed = 0;
  for (const kind of ['scans', 'roster', 'battles']) if (state[kind]) {
    if (applyRemote(kind, state[kind].data)) changed++;
    S.base[kind] = state[kind].updatedAt;
  }
  if (changed && window.Planner) Planner.refresh();
  return changed;
}
async function pushKind(kind) {
  const before = epoch[kind] || 0;              // an edit during the PUT bumps this and keeps the kind queued
  let body = wire(kind);
  let r = await fetch('/api/state/' + kind, {method: 'PUT', headers: await hdr(), body: JSON.stringify({data: body, baseUpdatedAt: S.base[kind]})});
  for (let attempt = 0; r.status === 409 && attempt < 3; attempt++) {   // someone else wrote first: merge theirs in, then write the union
    const {current} = await r.json();
    applyRemote(kind, current.data);
    S.base[kind] = current.updatedAt;
    body = wire(kind);
    r = await fetch('/api/state/' + kind, {method: 'PUT', headers: await hdr(), body: JSON.stringify({data: body, baseUpdatedAt: S.base[kind]})});
  }
  if (r.status === 401) throw new Error(authErr());
  if (!r.ok) throw new Error('server ' + r.status);
  S.base[kind] = (await r.json()).updatedAt;
  S.last[kind] = Date.now();
  return (epoch[kind] || 0) === before;         // false: it changed while we pushed, push it again
}
async function flush() {
  if (!signedIn() || busy || !dirty.size) return;
  if (available === false) await detect();      // the app may have started offline; a change made then still deserves a push
  if (!available) return;
  busy = true; paint();
  try {
    for (const kind of [...dirty]) { if (await pushKind(kind)) dirty.delete(kind); }
    lastError = ''; S.dirty = [...dirty]; save();
  } catch (e) { lastError = e.message; S.dirty = [...dirty]; save(); }
  busy = false; paint();
  if (dirty.size && !lastError) { clearTimeout(timer); timer = setTimeout(flush, 1500); }   // kinds that changed mid-push go again
}
function touch(kind) {
  stamp(kind);                                  // the ledger records the change (and its timestamp) even when offline or signed out
  epoch[kind] = (epoch[kind] || 0) + 1;
  dirty.add(kind); S.dirty = [...dirty]; save();
  if (!signedIn()) return;
  clearTimeout(timer); timer = setTimeout(flush, 1500);   // flush itself re-checks busy/available, so a timer during a push reschedules
}
async function connect(code) {
  S.code = (code || '').trim(); save(); lastError = '';
  if (available === null) await detect();
  try {
    const r = await fetch('/api/auth', {method: 'POST', headers: await hdr()});
    if (r.status === 401) throw new Error(authErr());
    if (!r.ok) throw new Error('server ' + r.status);
    await pull();
    dirty.add('scans'); dirty.add('roster'); dirty.add('battles');
    await flush();
    S.connectedAt = Date.now(); save();
  } catch (e) { lastError = e.message; if (e.message === 'wrong passcode') { S.code = ''; save(); } }
  paint(); if (window.Planner) Planner.refresh();
}
async function refreshMe() {                    // plan and features of the signed-in account; null when signed out
  if (!signedIn()) { me = null; return null; }
  try { const r = await fetch('/api/me', {headers: await hdr(), cache: 'no-store'}); me = r.ok ? await r.json() : null; } catch { me = null; }
  paint(); if (window.Planner) Planner.refresh();
  return me;
}
const plan = () => me ? me.plan : (health && health.auth !== 'clerk' && signedIn() ? 'pro' : 'free');   // without accounts the server is the owner's own: everything unlocked
const isPro = () => plan() === 'pro';
async function onUser(user) {                  // Clerk: signed in, signed out, or another account on this phone
  if (!user) {
    S.base = {}; S.last = {}; lastError = ''; me = null; save();
    if (swapStore('anon')) { location.reload(); return; }   // the previous user's data leaves the screen and the device's working copy
    paint(); if (window.Planner) Planner.refresh(); return;
  }
  if (S.user && S.user !== user.id) { S.base = {}; S.last = {}; }   // never merge one account's local copy into another's server data by accident
  S.user = user.id; save(); lastError = '';
  if (swapStore(user.id)) { location.reload(); return; }    // this account's own local data takes the working copy's place; sync resumes after the reload
  refreshMe();
  try { await pull(); dirty.add('scans'); dirty.add('roster'); dirty.add('battles'); await flush(); S.connectedAt = Date.now(); save(); }
  catch (e) { lastError = e.message; }
  paint(); if (window.Planner) Planner.refresh();
}
if (window.Auth) Auth.onChange(onUser);
function disconnect() { if (clerkMode()) { Auth.signOut(); return; } S.code = ''; S.base = {}; S.last = {}; save(); paint(); if (window.Planner) Planner.renderToday(); }
async function syncNow() {
  if (!signedIn()) return;
  busy = true; paint();
  try { await pull(); dirty.add('scans'); dirty.add('roster'); dirty.add('battles'); busy = false; await flush(); lastError = ''; }
  catch (e) { lastError = e.message; busy = false; }
  paint();
}
function paint() {
  const b = $('syncbtn'); if (!b) return;
  if (available === false) { b.style.display = 'none'; return; }
  b.style.display = '';
  b.classList.toggle('on', signedIn() && !lastError);
  b.classList.toggle('err', !!lastError);
  b.title = lastError ? 'Sync error: ' + lastError : signedIn() ? 'Synced' : clerkMode() ? 'Sign in' : 'Set up sync';
  const box = $('syncbox');
  if (box && box.classList.contains('open')) renderBox();
}
function renderBox() {
  const box = $('syncbox'); if (!box) return;
  const last = Math.max(S.last.scans || 0, S.last.roster || 0);
  if (clerkMode()) {
    const mode = Auth.mode();
    box.innerHTML = `<div class="box"><h2>${signedIn() ? 'Your account' : 'Sign in'} <span class="x" onclick="Sync.toggle()">✕</span></h2>
      ${signedIn() ? `<div class="team" style="cursor:default"><b>${Auth.email() || 'Signed in'}</b><div class="dt">${lastError ? '⚠ ' + lastError : last ? 'last synced ' + new Date(last).toLocaleString('nl-NL') : 'not synced yet'}${busy ? ' · syncing…' : ''}</div>
          <div class="dt" style="margin-top:4px">id <code id="uid">${Auth.userId() || ''}</code> <button class="mini" onclick="Sync.copyId(this)">Copy</button></div></div>
        <div class="acts"><button onclick="Sync.syncNow()">Sync now</button><button onclick="Sync.disconnect()">Sign out</button></div>
        ${health.passcodeData ? `<details class="imp" ${importMsg ? 'open' : ''}><summary>Import passcode data</summary>
          <p class="dim" style="font-size:12px">One-time: move the scans, roster, teams and battles saved under the old passcode into this account. Only what this account does not have yet is moved.</p>
          <div class="add" style="margin:6px 0"><input id="impcode" type="password" placeholder="server passcode" autocomplete="off"><button onclick="Sync.importPasscode()" ${busy ? 'disabled' : ''}>Import</button></div>
          ${importMsg ? `<div class="note" ${/^⚠/.test(importMsg) ? 'style="color:#F59A8B"' : ''}>${importMsg}</div>` : ''}</details>` : ''}
        <p class="dim" style="font-size:12px;margin-top:10px">Scans, roster, parties, battles and the completion log follow your account to every device. Local storage stays the working copy, so the app keeps working offline.</p>`
      : mode === 'offline' ? `<p class="dim">Could not reach the sign-in service. You can keep using the app; sync resumes when you are back online.</p>`
      : `<p class="dim">Sign in with Google or an email and password. Your scans and teams then follow you to every device.</p><div id="clerk-signin"></div>${lastError && lastError !== 'signed out' ? `<div class="note" style="color:#F59A8B">⚠ ${lastError}</div>` : ''}`}</div>`;
    if (!signedIn() && mode === 'clerk') Auth.mountSignIn($('clerk-signin'));
    return;
  }
  box.innerHTML = `<div class="box"><h2>Sync across devices <span class="x" onclick="Sync.toggle()">✕</span></h2>
    <p class="dim">Scans, roster, parties and the completion log are stored on your PokeScan server, so every phone and browser sees the same data. Enter the passcode you set on the server.</p>
    ${S.code ? `<div class="team" style="cursor:default"><b>Connected</b><div class="dt">${lastError ? '⚠ ' + lastError : last ? 'last synced ' + new Date(last).toLocaleString('nl-NL') : 'not synced yet'}${busy ? ' · syncing…' : ''}</div></div>
      <div class="acts"><button onclick="Sync.syncNow()">Sync now</button><button onclick="Sync.disconnect()">Sign out on this device</button></div>`
    : `<div class="add"><input id="synccode" type="password" placeholder="passcode" autocomplete="current-password"><button onclick="Sync.connect(document.getElementById('synccode').value)">Connect</button></div>${lastError ? `<div class="note" style="color:#F59A8B">⚠ ${lastError}</div>` : ''}`}
    <p class="dim" style="font-size:12px;margin-top:10px">Local storage stays the working copy, so the app keeps working offline. Changes are pushed a moment after you make them and pulled when you open the app.</p></div>`;
}
async function coach(context, onProgress, mode) {   // server-side Claude review of one team, or of one battle (mode 'battle'); needs sync connected and ANTHROPIC_API_KEY on the server
  if (!signedIn()) throw new Error(clerkMode() ? 'sign in first (cloud button)' : 'connect sync first (cloud button)');
  let r, j;
  try { r = await fetch('/api/coach', {method: 'POST', headers: await hdr(), body: JSON.stringify({context, mode: mode || 'review'})}); }
  catch (e) { throw new Error('could not reach the server (' + (e.message || e) + ')'); }
  j = await r.json().catch(() => ({}));
  if (r.status === 401) throw new Error(authErr());
  if (r.status === 429) throw new Error('the reviewer is resting: ' + (j.message || 'too many reviews this hour'));
  if (!r.ok) throw new Error(j.message || j.error || ('server ' + r.status));
  if (j.text) return j.text;
  // the server hands back a job; poll it (a single long request would be cut off by the phone after about a minute)
  const t0 = Date.now();
  while (Date.now() - t0 < 5 * 60e3) {
    await new Promise(res => setTimeout(res, 2500));
    if (onProgress) onProgress(Math.round((Date.now() - t0) / 1000));
    let p;
    try { p = await fetch('/api/coach/' + j.jobId, {headers: await hdr(), cache: 'no-store'}); } catch { continue; }   // a flaky network just retries
    if (p.status === 401) throw new Error(authErr());
    if (p.status === 404) throw new Error('the server restarted while thinking; ask again');
    const k = await p.json().catch(() => ({}));
    if (k.status === 'done') return k.text;
    if (k.status === 'error') throw new Error(k.error || 'the coach did not answer');
  }
  throw new Error('the coach took more than five minutes; try again later');
}
function toggle() { const box = $('syncbox'); box.classList.toggle('open'); if (box.classList.contains('open')) renderBox(); else { importMsg = ''; if (window.Auth) Auth.unmountSignIn($('clerk-signin')); } }
let importMsg = '';
const KIND_LABEL = {scans: 'scans', roster: 'roster and teams', appr: 'appraisals', battles: 'battle log'};
async function importPasscode() {              // one-time: the passcode era's rows become this account's, then a pull brings them to this phone
  const code = ($('impcode') || {}).value || '';
  if (!code) { importMsg = '⚠ enter the server passcode'; renderBox(); return; }
  busy = true; importMsg = ''; renderBox();
  try {
    const r = await fetch('/api/migrate', {method: 'POST', headers: await hdr(), body: JSON.stringify({passcode: code})});
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.message || j.error || ('HTTP ' + r.status));
    const moved = (j.moved || []).map(k => KIND_LABEL[k] || k);
    await pull();
    importMsg = moved.length ? `Imported: ${moved.join(', ')}.` : 'Nothing to import: this account already has every kind, or the passcode account is empty.';
    lastError = '';
    if (window.Planner) { Planner.refresh(); }
  } catch (e) { importMsg = '⚠ ' + e.message; }
  busy = false; renderBox(); paint();
}
function copyId(btn) { const id = (window.Auth && Auth.userId()) || ''; if (!id) return; navigator.clipboard && navigator.clipboard.writeText(id).then(() => { if (btn) { btn.textContent = 'Copied'; setTimeout(() => { btn.textContent = 'Copy'; }, 1200); } }).catch(() => {}); }
async function init() {
  if (await detect() && !clerkMode() && S.code) {
    try { await pull(); dirty.add('scans'); dirty.add('roster'); dirty.add('battles'); await flush(); }   // push too: edits made while the server was unreachable
    catch (e) { lastError = e.message; }
    paint(); if (window.Planner) Planner.renderToday();
  } else if (dirty.size && signedIn()) flush();  // edits queued before this load (dirty is persisted)
}
window.Sync = {touch, connect, disconnect, syncNow, toggle, init, flush, detect, coach, importPasscode, copyId, refreshMe, state: S, error: () => lastError, available: () => available, signedIn,
               health: () => health, me: () => me, plan, isPro, headers: hdr, coachAvailable: () => !!(health && health.coach && signedIn() && isPro()),
               visionAvailable: () => !!(health && health.vision && signedIn() && isPro()), visionOffered: () => !!(health && health.vision && signedIn() && !isPro()),
               coachOffered: () => !!(health && health.coach && signedIn() && !isPro())};   // the server has the AI, this account has not unlocked it yet
window.addEventListener('load', () => setTimeout(init, 300));
window.addEventListener('online', async () => { if (!signedIn()) return; if (available === false) await detect(); flush(); });
// the server may gain the coach (or sync) after a redeploy: re-read /api/health when the app comes back to the foreground
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  if (available !== false && Date.now() - detectedAt < 120e3) { if (dirty.size && signedIn()) flush(); return; }
  const before = JSON.stringify(health);
  await detect();
  if (JSON.stringify(health) !== before && window.Planner) Planner.renderToday();
  if (dirty.size && signedIn()) flush();        // offline edits go out as soon as the app is visible and the server reachable
});
})();
