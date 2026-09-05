/* PokeScan sync: localStorage stays the working copy; scans and roster are mirrored to the server's /api when
   the app is served by the PokeScan server and a passcode has been entered. On GitHub Pages there is no API,
   so this module stays silent and the button is hidden. */
(function () {
'use strict';
const S = Object.assign({code: '', last: {}, base: {}}, JSON.parse(localStorage.getItem('sync') || '{}'));
const save = () => localStorage.setItem('sync', JSON.stringify(S));
let available = null, timer = null, busy = false, lastError = '';
const dirty = new Set();
const $ = id => document.getElementById(id);
const hdr = () => ({authorization: 'Bearer ' + S.code, 'content-type': 'application/json'});

async function detect() {
  try {
    const r = await fetch('/api/health', {cache: 'no-store'});
    const j = r.ok ? await r.json() : null;
    available = !!(j && j.ok && j.sync);
  } catch { available = false; }
  paint();
  return available;
}
function local(kind) {
  if (kind === 'scans') return results;
  if (kind === 'roster') return window.Planner ? Planner.ROSTER : JSON.parse(localStorage.getItem('roster') || '{}');
  return null;
}
function applyRemote(kind, data) {
  if (kind === 'scans') {
    const have = new Set(results.map(r => r.key));
    let added = 0;
    const valid = r => r && typeof r.key === 'string' && typeof r.species === 'string' && Array.isArray(r.combos);
    for (const r of data || []) if (valid(r) && !have.has(r.key)) { results.push(r); added++; }
    // for records both sides have, take remote fields we lack (archived state, appraisal, moves)
    const byKey = new Map((data || []).filter(valid).map(r => [r.key, r]));
    for (const r of results) {
      const rem = byKey.get(r.key); if (!rem) continue;
      for (const f of ['superseded', 'appraisal', 'moves', 'fav', 'bench', 'level', 'combos', 'cp']) if (r[f] === undefined && rem[f] !== undefined) r[f] = rem[f];
    }
    localStorage.setItem('scans', JSON.stringify(results));
    if (added && typeof render === 'function') render();
    return added > 0;
  }
  if (kind === 'roster') {
    const R = local('roster');
    let changed = false;
    for (const blk of ['owned', 'pending', 'candidates', 'tagged', 'moves', 'done', 'snooze']) {
      R[blk] = R[blk] || {};
      for (const [k, v] of Object.entries((data || {})[blk] || {})) if (!(k in R[blk])) { R[blk][k] = v; changed = true; }
    }
    R.exclude = R.exclude || [];
    for (const x of (data || {}).exclude || []) if (!R.exclude.includes(x)) { R.exclude.push(x); changed = true; }
    R.log = R.log || [];
    const seen = new Set(R.log.map(e => e.t + e.id));
    for (const e of (data || {}).log || []) if (!seen.has(e.t + e.id)) { R.log.push(e); changed = true; }
    R.log.sort((a, b) => b.t - a.t);
    R.log = R.log.slice(0, 50);
    localStorage.setItem('roster', JSON.stringify(R));
    return changed;
  }
  return false;
}
async function pull() {
  const r = await fetch('/api/state', {headers: hdr(), cache: 'no-store'});
  if (r.status === 401) throw new Error('wrong passcode');
  if (!r.ok) throw new Error('server ' + r.status);
  const {state} = await r.json();
  let changed = 0;
  for (const kind of ['scans', 'roster']) if (state[kind]) {
    if (applyRemote(kind, state[kind].data)) changed++;
    S.base[kind] = state[kind].updatedAt;
  }
  if (changed && window.Planner) Planner.refresh();
  return changed;
}
async function pushKind(kind) {
  let r = await fetch('/api/state/' + kind, {method: 'PUT', headers: hdr(), body: JSON.stringify({data: local(kind), baseUpdatedAt: S.base[kind]})});
  if (r.status === 409) {                      // someone else wrote first: merge theirs in, then write the union
    const {current} = await r.json();
    applyRemote(kind, current.data);
    S.base[kind] = current.updatedAt;
    r = await fetch('/api/state/' + kind, {method: 'PUT', headers: hdr(), body: JSON.stringify({data: local(kind), baseUpdatedAt: S.base[kind]})});
  }
  if (r.status === 401) throw new Error('wrong passcode');
  if (!r.ok) throw new Error('server ' + r.status);
  S.base[kind] = (await r.json()).updatedAt;
  S.last[kind] = Date.now();
}
async function flush() {
  if (!available || !S.code || busy || !dirty.size) return;
  busy = true; paint();
  try {
    for (const kind of [...dirty]) { await pushKind(kind); dirty.delete(kind); }
    lastError = ''; save();
  } catch (e) { lastError = e.message; }
  busy = false; paint();
}
function touch(kind) {
  if (!available || !S.code) return;
  dirty.add(kind); clearTimeout(timer); timer = setTimeout(flush, 1500);
}
async function connect(code) {
  S.code = (code || '').trim(); save(); lastError = '';
  if (available === null) await detect();
  try {
    const r = await fetch('/api/auth', {method: 'POST', headers: hdr()});
    if (r.status === 401) throw new Error('wrong passcode');
    if (!r.ok) throw new Error('server ' + r.status);
    await pull();
    dirty.add('scans'); dirty.add('roster');
    await flush();
    S.connectedAt = Date.now(); save();
  } catch (e) { lastError = e.message; if (e.message === 'wrong passcode') { S.code = ''; save(); } }
  paint();
}
function disconnect() { S.code = ''; S.base = {}; S.last = {}; save(); paint(); }
async function syncNow() {
  if (!S.code) return;
  busy = true; paint();
  try { await pull(); dirty.add('scans'); dirty.add('roster'); busy = false; await flush(); lastError = ''; }
  catch (e) { lastError = e.message; busy = false; }
  paint();
}
function paint() {
  const b = $('syncbtn'); if (!b) return;
  if (available === false) { b.style.display = 'none'; return; }
  b.style.display = '';
  b.classList.toggle('on', !!S.code && !lastError);
  b.classList.toggle('err', !!lastError);
  b.title = lastError ? 'Sync error: ' + lastError : S.code ? 'Synced' : 'Set up sync';
  const box = $('syncbox');
  if (box && box.classList.contains('open')) renderBox();
}
function renderBox() {
  const box = $('syncbox'); if (!box) return;
  const last = Math.max(S.last.scans || 0, S.last.roster || 0);
  box.innerHTML = `<div class="box"><h2>Sync across devices <span class="x" onclick="Sync.toggle()">✕</span></h2>
    <p class="dim">Scans, roster, parties and the completion log are stored on your PokeScan server, so every phone and browser sees the same data. Enter the passcode you set on the server.</p>
    ${S.code ? `<div class="team" style="cursor:default"><b>Connected</b><div class="dt">${lastError ? '⚠ ' + lastError : last ? 'last synced ' + new Date(last).toLocaleString('nl-NL') : 'not synced yet'}${busy ? ' · syncing…' : ''}</div></div>
      <div class="acts"><button onclick="Sync.syncNow()">Sync now</button><button onclick="Sync.disconnect()">Sign out on this device</button></div>`
    : `<div class="add"><input id="synccode" type="password" placeholder="passcode" autocomplete="current-password"><button onclick="Sync.connect(document.getElementById('synccode').value)">Connect</button></div>${lastError ? `<div class="note" style="color:#F59A8B">⚠ ${lastError}</div>` : ''}`}
    <p class="dim" style="font-size:12px;margin-top:10px">Local storage stays the working copy, so the app keeps working offline. Changes are pushed a moment after you make them and pulled when you open the app.</p></div>`;
}
function toggle() { const box = $('syncbox'); box.classList.toggle('open'); if (box.classList.contains('open')) renderBox(); }
async function init() {
  if (await detect() && S.code) {
    try { await pull(); } catch (e) { lastError = e.message; }
    paint();
  }
}
window.Sync = {touch, connect, disconnect, syncNow, toggle, init, flush, detect, state: S, error: () => lastError, available: () => available};
window.addEventListener('load', () => setTimeout(init, 300));
window.addEventListener('online', () => { if (S.code) flush(); });
})();
