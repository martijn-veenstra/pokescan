/* Share anything: a screenshot the on-device reader cannot place (not a status screen, appraisal, attacks or profile) goes to the
   server's vision endpoint on the Pro plan. The model says what it is and what it shows; this module routes the answer:
     battle_end → a battle log entry with the opponent's team, their lead and the result
     rocket     → which Shadow you will meet (from Leek Duck's lineups) and whether your roster wants it
     anything else → a note in the import log
   Results are kept as cards at the top of the Scans page (localStorage 'shares', last 10). */
(function () {
'use strict';
const $ = id => document.getElementById(id);
const SHARES = JSON.parse(localStorage.getItem('shares') || '[]');
const save = () => localStorage.setItem('shares', JSON.stringify(SHARES.slice(0, 10)));
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
const nm = id => (window.Planner && Planner.nameOf) ? Planner.nameOf(id) : id;
const fmtT = s => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, '0')}`;

async function shrink(cv, max) {               // JPEG at most `max` px on the long side: ~1,500 image tokens instead of 6,000
  const s = Math.min(1, max / Math.max(cv.width, cv.height));
  const c = document.createElement('canvas'); c.width = Math.round(cv.width * s); c.height = Math.round(cv.height * s);
  c.getContext('2d').drawImage(cv, 0, 0, c.width, c.height);
  const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
  const b64 = await new Promise(r => { const fr = new FileReader(); fr.onload = () => r(String(fr.result).split(',')[1]); fr.readAsDataURL(blob); });
  return {image: b64, mediaType: 'image/jpeg'};
}
async function ask(payload) {                  // POST /api/vision, then poll the job (phones drop long requests)
  const r = await fetch('/api/vision', {method: 'POST', headers: await Sync.headers(), body: JSON.stringify(payload)});
  const j = await r.json().catch(() => ({}));
  if (r.status === 403) throw new Error('PokeScan Pro reads screenshots');
  if (r.status === 429) throw new Error(j.message || 'too many screenshots this hour');
  if (!r.ok) throw new Error(j.message || j.error || ('server ' + r.status));
  if (j.data) return j.data;
  const t0 = Date.now();
  while (Date.now() - t0 < 120e3) {
    await new Promise(res => setTimeout(res, 1500));
    let p; try { p = await fetch('/api/jobs/' + j.jobId, {headers: await Sync.headers(), cache: 'no-store'}); } catch { continue; }
    const k = await p.json().catch(() => ({}));
    if (k.status === 'done') return k.data;
    if (k.status === 'error') throw new Error(k.error || 'the screenshot could not be read');
    if (p.status === 404) throw new Error('the server restarted while reading; share it again');
  }
  throw new Error('reading the screenshot took more than two minutes');
}

/* entry point from the scanner: the file was drawn on canvas `cv` and recognised as nothing. Returns true when this module took it. */
async function fromScan(file, cv) {
  if (!window.Sync || !Sync.available() || !Sync.signedIn()) return false;
  if (Sync.visionOffered && Sync.visionOffered()) { gain('note', 'not a status screen · PokeScan Pro reads battle results and Rocket taunts from screenshots'); pushCard({kind: 'teaser', t: Date.now(), name: file.name}); render(); return true; }
  if (!Sync.visionAvailable || !Sync.visionAvailable()) return false;
  status(`${file.name}: reading with Claude…`);
  try {
    const data = await ask(await shrink(cv, 1568));
    const card = route(data, file);
    gain('note', `read by Claude: ${card.line}`);
    pushCard(card); render();
    if (typeof toast === 'function') toast(card.toast || card.line, card.go ? `Planner.nav(${JSON.stringify(card.go)})` : null);
    if (window.Planner) Planner.msCheck && Planner.msCheck();
    return true;
  } catch (e) {
    gain('note', `Claude could not read it: ${e.message || e}`);
    return true;
  }
}
/* entry point from the video scanner: a recording with no status screens. `snaps` are small JPEG frames {t, image, mediaType}. */
async function fromFrames(file, snaps, dur) {
  if (!window.Sync || !Sync.available() || !Sync.signedIn()) return false;
  if (Sync.visionOffered && Sync.visionOffered()) { gain('note', 'no status screens · PokeScan Pro reads a battle recording: result, both teams and the decisions that decided it'); pushCard({kind: 'teaser', t: Date.now(), name: file.name}); render(); return true; }
  if (!Sync.visionAvailable || !Sync.visionAvailable()) return false;
  status(`${file.name}: Claude is watching the recording (${snaps.length} frames)…`);
  try {
    const data = await ask({images: snaps.map(s => ({image: s.image, mediaType: s.mediaType, t: s.t})), hint: `screen recording, ${Math.round(dur)} s`});
    const card = route(data, file);
    if (card.kind === 'battle_end') { card.notes = (data.notes || []).filter(n => n && n.text).slice(0, 3); card.film = true; card.line += card.notes.length ? ` · ${card.notes.length} film note${card.notes.length === 1 ? '' : 's'}` : ''; }
    gain('note', `read by Claude: ${card.line}`);
    pushCard(card); render();
    if (typeof toast === 'function') toast(card.toast || card.line, card.go ? `Planner.nav(${JSON.stringify(card.go)})` : null);
    if (window.Planner) Planner.msCheck && Planner.msCheck();
    return true;
  } catch (e) { gain('note', `Claude could not read the recording: ${e.message || e}`); return true; }
}
function pushCard(card) { card.id = card.id || Date.now().toString(36); SHARES.unshift(card); SHARES.splice(10); save(); }
function dismiss(id) { const i = SHARES.findIndex(c => c.id === id); if (i >= 0) { SHARES.splice(i, 1); save(); render(); } }

/* ---- routing ---- */
function route(d, file) {
  const t = (file && file.lastModified) || Date.now();
  if (d.kind === 'battle_end' && d.battle) return battle(d, t);
  if (d.kind === 'rocket' && d.rocket) return rocket(d, t);
  const label = {status: 'a status screen (the on-device reader missed it: try a screenshot with the whole card visible)', appraisal: 'an appraisal screen', storage: 'the storage grid · reading it into the roster is coming to Pro', raid: 'a raid lobby · roster counters from a share are coming to Pro', trade: 'a trade offer · coming to Pro', other: 'not a Pokémon GO screen the app knows'}[d.kind] || d.kind;
  return {kind: d.kind, t, line: `${label}${d.summary ? ' · ' + d.summary : ''}`, summary: d.summary || ''};
}
function battle(d, t) {
  const b = d.battle, P = window.Planner, id = n => (P && P.idByName ? P.idByName(n) : null);
  const my = (b.myTeam || []).map(n => ({name: n, id: id(n)})), opp = (b.oppTeam || []).map(n => ({name: n, id: id(n)}));
  const myIds = my.map(x => x.id).filter(Boolean), oppIds = opp.map(x => x.id).filter(Boolean);
  const result = b.result === 'win' ? 'W' : b.result === 'loss' ? 'L' : b.result === 'draw' ? 'D' : null;
  const party = P && P.partyFor ? P.partyFor(myIds) : null;
  const oppLead = id(b.oppLead) || oppIds[0] || null;
  const entry = {t, result, ids: myIds.length === 3 ? myIds : null, team: party, lead: oppLead, opp: oppIds, oppNames: opp.map(x => x.name), myNames: my.map(x => x.name), myLead: id(b.myLead) || myIds[0] || null, fainted: {me: b.myFainted, opp: b.oppFainted}, src: 'share'};
  if (b.ratingAfter) entry.rating = b.ratingAfter;
  if (result && P && P.addBattle) P.addBattle(entry);
  const vs = opp.map(x => x.name).filter(Boolean).join(' / ') || 'an unknown team';
  const line = `${result === 'W' ? 'Win' : result === 'L' ? 'Loss' : result === 'D' ? 'Draw' : 'Battle'} vs ${vs}${b.oppLead ? ` · they led ${b.oppLead}` : ''}${party ? ` · logged for ${party}` : myIds.length === 3 ? ' · logged' : result ? ' · logged without your team' : ' · result not visible, nothing logged'}`;
  return {kind: 'battle_end', t, line, toast: `${result === 'W' ? '✓ Win' : result === 'L' ? '✕ Loss' : 'Battle'} vs ${opp[0] ? opp[0].name : '?'} logged`, go: '#/battles', summary: d.summary, my, opp, result, party};
}
function rocket(d, t) {
  const r = d.rocket, P = window.Planner, lineups = (window.Sources && Sources.rocket()) || [];
  const norm = s => String(s || '').toLowerCase().replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();
  const q = norm(r.quote);
  let lu = null;
  if (r.who && r.who !== 'grunt') lu = lineups.find(l => norm(l.who).includes(norm(r.who))) || null;
  if (!lu && q) lu = lineups.find(l => l.quote && (norm(l.quote) === q || norm(l.quote).includes(q) || q.includes(norm(l.quote)))) || null;
  if (!lu && r.pokemon && r.pokemon.length) lu = lineups.find(l => l.slots.some(s => s.some(n => r.pokemon.map(norm).includes(norm(n))))) || null;
  const who = lu ? lu.who : (r.who && r.who !== 'grunt' ? r.who : 'Team GO Rocket grunt');
  const slotIdx = lu ? ((lu.encounter || 1) - 1) : 0;
  const names = lu ? (lu.slots[slotIdx] || []) : (r.pokemon || []);
  const cands = names.map(n => P && P.rocketVerdict ? P.rocketVerdict(n) : {name: n, text: ''});
  const want = cands.filter(c => c.wanted), good = cands.filter(c => !c.wanted && c.rank && c.rank <= 100);
  const verdict = !lu && !names.length ? 'Lineups for this taunt are not known right now; they are updated after every rotation.'
    : want.length ? `Catch it: ${want.map(c => c.name).join(' or ')} ${want.length === 1 ? 'is' : 'are'} on your list.`
    : good.length ? `Worth catching: Shadow ${good[0].name} ranks #${good[0].rank} in ${P ? P.leagueAbbr() : 'this league'}.`
    : `Skip unless you need candy: none of ${names.join(', ') || 'these'} rank for your league.`;
  const line = `${who}${r.quote ? ` · "${r.quote}"` : ''}${names.length ? ` · you will meet Shadow ${names.join(' / ')}` : ''} · ${verdict}`;
  return {kind: 'rocket', t, line, toast: `${who}: ${verdict}`, go: '#/scans', who, quote: r.quote || (lu && lu.quote) || '', names, cands, verdict, known: !!lu};
}

/* ---- cards on the Scans page ---- */
function render() {
  const el = $('shared'); if (!el) return;
  if (!SHARES.length) { el.innerHTML = ''; return; }
  el.innerHTML = SHARES.map(c => {
    const x = `<span class="x" onclick="Share.dismiss('${c.id}')">✕</span>`, when = new Date(c.t).toLocaleString('nl-NL', {day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit'});
    if (c.kind === 'teaser') return window.Planner && Planner.proTeaser ? Planner.proTeaser('Read this screenshot', 'Claude reads battle results and Team GO Rocket taunts from screenshots. That is a Pro feature.').replace('<div class="sec"', x + '<div class="sec"') : '';
    if (c.kind === 'battle_end') {
      const side = (list, lead) => list.map(p => `<span class="chip ${p.id ? '' : 'dim'} ${lead && p.name === lead ? 'ok' : ''}" ${p.id ? `onclick="Planner.openMon('${p.id}')" style="cursor:pointer"` : ''}>${p.id ? Planner.icon(p.id, 'xs') : ''}${esc(p.name || '?')}</span>`).join('');
      return `<div class="team card share" style="cursor:default">${x}<div class="sec" style="margin:0 0 6px"><span>${c.result === 'W' ? '✓ Win' : c.result === 'L' ? '✕ Loss' : c.result === 'D' ? 'Draw' : 'Battle'} <small>read by Claude · ${esc(when)}</small></span></div>
        <div class="dt">Their team${c.opp && c.opp[0] ? ', lead first' : ''}</div><div class="chips">${side(c.opp || [], c.opp && c.opp[0] && c.opp[0].name)}</div>
        <div class="dt" style="margin-top:6px">Your team${c.party ? ` · ${esc(c.party)}` : ''}</div><div class="chips">${side(c.my || [])}</div>
        ${c.notes && c.notes.length ? `<div class="dt" style="margin-top:8px;color:var(--ink);font-weight:600">Film study</div>${c.notes.map(n => `<div class="fn"><span class="ts">${n.t != null ? fmtT(n.t) : ''}</span><span>${esc(n.text)}</span></div>`).join('')}` : ''}
        <div class="dt" style="margin-top:6px"><a href="#" onclick="Planner.nav('#/battles');return false">Battle log</a>${c.opp && c.opp[0] && c.opp[0].id ? ` · <a href="#" onclick="Planner.openMon('${c.opp[0].id}');return false">how to beat ${esc(c.opp[0].name)}</a>` : ''}</div></div>`;
    }
    if (c.kind === 'rocket') {
      return `<div class="team card share" style="cursor:default">${x}<div class="sec" style="margin:0 0 6px"><span>${esc(c.who)} <small>read by Claude · ${esc(when)}</small></span></div>
        ${c.quote ? `<div class="dt">“${esc(c.quote)}”</div>` : ''}
        ${c.names.length ? `<div class="dt" style="margin-top:6px">You will meet Shadow</div><div class="chips">${c.cands.map(k => `<span class="chip ${k.wanted ? 'ok' : k.rank && k.rank <= 100 ? 'gl' : ''}" ${k.id ? `onclick="Planner.openMon('${k.id}')" style="cursor:pointer"` : ''}>${k.id ? Planner.icon(k.id, 'xs') : ''}${esc(k.name)}${k.text ? ` <span style="opacity:.7">${esc(k.text)}</span>` : ''}</span>`).join('')}</div>` : ''}
        <div class="dt" style="margin-top:6px;color:var(--ink)">${esc(c.verdict)}</div></div>`;
    }
    return `<div class="team card share" style="cursor:default">${x}<div class="sec" style="margin:0 0 4px"><span>Shared screenshot <small>read by Claude · ${esc(when)}</small></span></div><div class="dt">${esc(c.line)}</div></div>`;
  }).join('');
}

/* ---- share target: the service worker stores files shared to the app in a cache; the app picks them up on #/inbox ---- */
async function drainInbox() {
  if (!('caches' in window)) return 0;
  const c = await caches.open('share-inbox'), keys = await c.keys(), files = [];
  for (const k of keys) { const r = await c.match(k); if (!r) continue; const blob = await r.blob(); files.push(new File([blob], decodeURIComponent(r.headers.get('x-name') || 'shared.jpg'), {type: blob.type || r.headers.get('content-type') || 'image/jpeg'})); await c.delete(k); }
  if (files.length && typeof importFiles === 'function') { if (window.Planner) Planner.nav('#/scans'); await importFiles(files); }
  return files.length;
}
window.Share = {fromScan, fromFrames, render, dismiss, drainInbox, list: () => SHARES, route, ask};
window.addEventListener('load', () => setTimeout(render, 0));
})();
