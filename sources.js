/* PokeScan sources: where a Pokémon can be obtained right now or soon (raids, eggs, field research, events).
   Data is Leek Duck's schedule as published by the ScrapedDuck project (github.com/bigfoott/ScrapedDuck). When the app is
   served by the PokeScan server, /api/sources adds the raid bosses and spawns of GO Fest, Raid Day and seasonal event pages
   (which ScrapedDuck leaves out); on the static GitHub Pages copy the JSON comes straight from GitHub. Cached for six hours. */
(function () {
'use strict';
const BASE = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/';
const KINDS = ['raids', 'eggs', 'research', 'events'];
const TTL = 6 * 3600e3;
let S = null, loading = null, error = '';
try { S = JSON.parse(localStorage.getItem('sources') || 'null'); } catch { S = null; }
const listeners = [];

const REGIONAL = new Set(['alolan', 'galarian', 'hisuian', 'paldean']);
const NOISE = new Set(['mega', 'shadow', 'primal', 'x', 'y', 'forme', 'form', 'dynamax', 'gigantamax']);
const COSMETIC = new Set(['busted', 'disguised', 'incarnate', 'ordinary', 'standard', 'normal', 'average', 'altered', 'origin']);
function tokens(name) { return String(name || '').toLowerCase().replace(/[()\-–_,:]/g, ' ').split(/\s+/).filter(Boolean); }
function sig(name) {                          // {base, regional, shadow} so "Galarian Stunfisk" == "Stunfisk (Galarian)"
  const t = tokens(name), regional = t.filter(x => REGIONAL.has(x)).sort().join('+');
  const rest = t.filter(x => !REGIONAL.has(x) && !NOISE.has(x) && !COSMETIC.has(x));
  return {base: rest[0] || '', regional, shadow: t.includes('shadow'), mega: t.includes('mega') || t.includes('primal')};
}
const same = (a, b) => a.base && a.base === b.base && a.regional === b.regional;
const stripHtml = s => String(s || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const dt = s => { const d = new Date(s); return isNaN(d) ? null : d; };
const day = d => d.toLocaleDateString('nl-NL', {day: 'numeric', month: 'short'});
function whenLabel(start, end) {
  const now = Date.now(), a = dt(start), b = dt(end);
  if (!a || !b) return '';
  if (a.getTime() <= now && b.getTime() >= now) return `now, until ${day(b)}`;
  if (a.getTime() > now) return a.toDateString() === b.toDateString() ? `${day(a)} ${a.toLocaleTimeString('nl-NL', {hour: '2-digit', minute: '2-digit'})}` : `${day(a)} – ${day(b)}`;
  return '';
}
const tierOf = s => (String(s).match(/(\d)-star|mega|shadow|super mega|elite/i) || [''])[0];

async function load(force) {
  if (!force && S && Date.now() - S.t < TTL) return S;
  if (loading) return loading;
  loading = (async () => {
    try {
      let out = null;
      try {                                   // the PokeScan server enriches events with their page lists
        const r = await fetch('/api/sources', {cache: 'no-store'});
        if (r.ok && (r.headers.get('content-type') || '').includes('json')) { const j = await r.json(); if (j && j.events) out = j; }
      } catch {}
      if (!out) {
        out = {t: Date.now()};
        for (const k of KINDS) {
          const r = await fetch(BASE + k + '.json', {cache: 'no-store'});
          if (!r.ok) throw new Error(k + ' HTTP ' + r.status);
          out[k] = await r.json();
        }
      }
      out.t = Date.now();
      S = out; error = '';
      try { localStorage.setItem('sources', JSON.stringify(S)); } catch {}
      listeners.forEach(f => { try { f(); } catch {} });
    } catch (e) { error = e.message || String(e); }
    loading = null;
    return S;
  })();
  return loading;
}

/* forSpecies(names): entries for any of the given display names (a species and its pre-evolutions), soonest first. */
function forSpecies(names, opts) {
  if (!S) return [];
  opts = opts || {};
  const want = (Array.isArray(names) ? names : [names]).map(n => ({name: n, s: sig(n)}));
  const hit = bossName => { const b = sig(bossName); const w = want.find(x => same(x.s, b)); return w ? {w, b} : null; };
  const out = [], now = Date.now();
  const push = (e) => { if (!out.some(o => o.kind === e.kind && o.what === e.what && o.name === e.name && o.start === e.start)) out.push(e); };
  for (const r of S.raids || []) {
    const h = hit(r.name); if (!h) continue;
    if (h.b.shadow !== !!opts.shadow) continue;
    push({kind: 'raid', name: h.w.name, what: r.tier, now: true, when: 'in raids now', remote: !h.b.shadow, shiny: !!r.canBeShiny, sort: 0, note: h.b.mega ? 'Mega raid, you catch the normal form' : ''});
  }
  for (const ev of S.events || []) {
    const x = ev.extraData || {}, when = whenLabel(ev.start, ev.end); if (!when) continue;
    const a = dt(ev.start), sort = a && a.getTime() > now ? a.getTime() - now : 0, isNow = sort === 0;
    if (ev.eventType === 'raid-battles' && x.raidbattles) {
      for (const b of x.raidbattles.bosses || []) { const h = hit(b.name); if (!h) continue;
        const shadow = h.b.shadow || /shadow/i.test(ev.name); if (shadow !== !!opts.shadow) continue;
        push({kind: 'raid', name: h.w.name, what: (tierOf(ev.name) || 'raid') + (/raid/i.test(tierOf(ev.name)) ? '' : ' raids'), now: isNow, when, remote: !shadow, shiny: !!b.canBeShiny, sort, start: ev.start, note: h.b.mega ? 'Mega raid, you catch the normal form' : ''}); }
    } else if (ev.eventType === 'community-day' && x.communityday) {
      for (const sp of x.communityday.spawns || []) { const h = hit(sp.name); if (!h || opts.shadow) continue;
        push({kind: 'event', name: h.w.name, what: 'Community Day', now: isNow, when, sort, start: ev.start, remote: false, note: 'wild spawns everywhere'}); }
    } else if (ev.eventType === 'pokemon-spotlight-hour' && x.spotlight) {
      for (const sp of x.spotlight.list || [x.spotlight]) { const h = hit(sp.name); if (!h || opts.shadow) continue;
        push({kind: 'event', name: h.w.name, what: 'Spotlight Hour', now: isNow, when, sort, start: ev.start, remote: false, note: x.spotlight.bonus || ''}); }
    }
    if (x.page) {                             // lists read from the Leek Duck event page by the server
      const label = ev.eventType === 'pokemon-go-fest' ? 'GO Fest' : ev.eventType === 'raid-day' ? 'Raid Day' : ev.name.length < 32 ? ev.name : 'event';
      for (const b of x.page.raids || []) { const h = hit(b.name); if (!h) continue;
        if (h.b.shadow !== !!opts.shadow) continue;
        const tier = b.group && /raid|star|mega|tier/i.test(b.group) ? b.group.replace(/\s*[·,-].*$/, '') : (h.b.mega ? 'Mega raids' : 'raids');
        push({kind: 'raid', name: h.w.name, what: `${tier} (${label})`, now: isNow, when: b.group && !/raid|star|mega|tier/i.test(b.group) ? `${b.group} · ${when}` : when, remote: !h.b.shadow, shiny: !!b.shiny, sort, start: ev.start, note: h.b.mega ? 'Mega raid, you catch the normal form' : ''}); }
      if (!opts.shadow) {
        for (const sp of x.page.spawns || []) { const h = hit(sp.name); if (!h) continue;
          push({kind: 'event', name: h.w.name, what: `wild spawns (${label})`, now: isNow, when, sort, start: ev.start, remote: false, shiny: !!sp.shiny, note: ''}); }
        for (const eg of x.page.eggs || []) { const h = hit(eg.name); if (!h) continue;
          push({kind: 'egg', name: h.w.name, what: `eggs (${label})`, now: isNow, when, sort, start: ev.start, remote: false, shiny: !!eg.shiny, note: eg.group || ''}); }
      }
      continue;
    }
    if (['raid-day', 'raid-hour', 'event', 'max-mondays', 'max-battles'].includes(ev.eventType)) {
      // no structured list: match the event name itself ("Staraptor Super Mega Raid Day", "Dynamax Ralts during Max Monday")
      for (const w of want) { const b = sig(ev.name); if (!same(w.s, b) || (b.shadow !== !!opts.shadow)) continue;
        const what = ev.eventType === 'raid-day' ? 'Raid Day' : ev.eventType === 'raid-hour' ? 'Raid Hour' : ev.eventType.startsWith('max') ? 'Max Battles' : 'Event';
        push({kind: ev.eventType.startsWith('raid') ? 'raid' : 'event', name: w.name, what, now: isNow, when, sort, start: ev.start, remote: ev.eventType.startsWith('raid') && !b.shadow, note: ev.eventType.startsWith('max') ? 'Dynamax form, in person' : ''}); }
    }
  }
  if (!opts.shadow) {
    for (const e of S.eggs || []) { const h = hit(e.name); if (!h) continue;
      push({kind: 'egg', name: h.w.name, what: `${e.eggType} eggs${e.isAdventureSync ? ' (Adventure Sync)' : e.isGiftExchange ? ' (gifts)' : ''}`, now: true, when: 'hatching now', shiny: !!e.canBeShiny, sort: 1, remote: false, note: e.isRegional ? 'regional' : ''}); }
    for (const q of S.research || []) for (const rw of q.rewards || []) { const h = hit(rw.name); if (!h) continue;
      push({kind: 'research', name: h.w.name, what: 'field research', now: true, when: stripHtml(q.text), shiny: !!rw.canBeShiny, sort: 2, remote: false, note: ''}); }
  }
  return out.sort((a, b) => a.sort - b.sort);
}
function hint(names, opts) {                  // one short phrase for a Next-moves line, or ''
  const e = forSpecies(names, opts)[0]; if (!e) return '';
  return e.kind === 'raid' ? `${e.name} ${e.what.toLowerCase()} ${e.when}` : e.kind === 'egg' ? `${e.name} from ${e.what}` : e.kind === 'research' ? `${e.name} from field research` : `${e.name} ${e.what} ${e.when}`;
}
function onChange(f) { listeners.push(f); }
window.Sources = {load, forSpecies, hint, onChange, ready: () => !!S, updated: () => S ? S.t : 0, error: () => error};
window.addEventListener('load', () => setTimeout(() => load(false), 800));
})();
