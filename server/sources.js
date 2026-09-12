// Availability schedule for the app: Leek Duck's data as published by ScrapedDuck, plus the Pokémon lists that ScrapedDuck
// leaves out (GO Fest, Raid Days, seasonal events: their raid bosses and spawns only exist on the Leek Duck event page).
// Those pages are fetched here on the server, where there is no CORS, and parsed with the same markup ScrapedDuck relies on:
// .event-section-header#raids|spawns|eggs followed by .pkmn-list-flex > .pkmn-list-item > .pkmn-name (+ .shiny-icon).
const BASE = 'https://raw.githubusercontent.com/bigfoott/ScrapedDuck/data/';
const KINDS = ['raids', 'eggs', 'research', 'events'];
const TTL = 3 * 3600e3;
const WINDOW_AHEAD = 21 * 864e5;
const MAX_PAGES = 14;
const ROCKET_URL = 'https://leekduck.com/rocket-lineups/';
const UNSTRUCTURED = new Set(['pokemon-go-fest', 'event', 'raid-day', 'raid-hour', 'max-mondays', 'max-battles', 'season', 'go-tour', 'safari-zone', 'wild-area', 'city-safari', 'live-event']);

const decode = s => String(s || '').replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/&eacute;/g, 'é').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

/* parseEventPage(html) -> {raids:[{name, shiny, group}], spawns:[...], eggs:[...]} or null when the page has none of them. */
export function parseEventPage(html) {
  if (!html) return null;
  const content = (html.match(/<div[^>]*class="[^"]*page-content[^"]*"[^>]*>([\s\S]*)/) || [null, html])[1];
  const headers = [...content.matchAll(/<[a-z0-9]+[^>]*class="[^"]*event-section-header[^"]*"[^>]*>/gi)].map(m => ({at: m.index, id: ((m[0].match(/\bid="([^"]+)"/) || [])[1] || '').toLowerCase()}));
  if (!headers.length) return null;
  const out = {raids: [], spawns: [], eggs: []};
  for (let i = 0; i < headers.length; i++) {
    const key = headers[i].id.includes('raid') ? 'raids' : headers[i].id.includes('spawn') || headers[i].id.includes('wild') ? 'spawns' : headers[i].id.includes('egg') ? 'eggs' : null;
    if (!key) continue;
    const sect = content.slice(headers[i].at, i + 1 < headers.length ? headers[i + 1].at : undefined);
    // sub-headings inside the section (e.g. "Mega Raids", "Saturday, September 5") label the lists that follow them
    const subs = [...sect.matchAll(/<h[3-5][^>]*>([\s\S]*?)<\/h[3-5]>/gi)].map(m => ({at: m.index, text: decode(m[1])}));
    const items = [...sect.matchAll(/class="[^"]*pkmn-list-item[^"]*"/g)].map(m => m.index);
    items.forEach((at, j) => {
      const chunk = sect.slice(at, items[j + 1] || sect.length);
      const name = decode((chunk.match(/class="[^"]*pkmn-name[^"]*"[^>]*>([\s\S]*?)<\//) || [])[1]);
      if (!name || name.length > 40) return;
      const group = subs.filter(s => s.at < at).pop();
      out[key].push({name, shiny: /shiny-icon/.test(chunk), group: group ? group.text : ''});
    });
  }
  return out.raids.length || out.spawns.length || out.eggs.length ? out : null;
}

/* parseRocketPage(html) -> [{who, title, type, quote, encounter, slots:[[names],[names],[names]]}] or null.
   Leek Duck's Rocket lineups page (verified against the live markup): <div class="rocket-profile"> per grunt or leader, with
   .employee-info (.name, .title, .quote-text) and .lineup-info holding <div class="slot [encounter]"> blocks whose Pokémon are
   <span class="shadow-pokemon" data-pokemon="Persian" data-type1="normal"> (alt="…" on the image as a fallback). The slot with
   "encounter" is the one you can catch. */
export function parseRocketPage(html) {
  if (!html) return null;
  const blocks = html.split(/<div[^>]*class="rocket-profile[^"]*"/i).slice(1);
  if (!blocks.length) return null;
  const out = [];
  for (const b of blocks) {
    const name = decode((b.match(/class="name"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
    const title = decode((b.match(/class="title"[^>]*>([\s\S]*?)<\/div>/i) || [])[1]);
    const quote = decode((b.match(/class="quote-text"[^>]*>([\s\S]*?)<\//i) || [])[1]);
    const typeTag = decode((b.match(/class="type[^"]*"[^>]*>([\s\S]*?)<\//i) || [])[1]);
    const lineup = b.split(/class="lineup-info"/i)[1] || b;
    const slotChunks = lineup.split(/<div[^>]*class="slot[^"]*"/i);
    const slotHeads = [...lineup.matchAll(/<div[^>]*class="slot([^"]*)"/gi)].map(m => m[1]);
    const slots = [], enc = [];
    slotChunks.slice(1).forEach((chunk, i) => {
      const names = [...chunk.matchAll(/data-pokemon="([^"]+)"/g)].map(m => decode(m[1]));
      if (!names.length) for (const m of chunk.matchAll(/<img[^>]*class="pokemon-image"[^>]*alt="([^"]+)"/g)) names.push(decode(m[1]));
      if (!names.length) return;
      slots.push([...new Set(names)]);
      if (/\bencounter\b/i.test(slotHeads[i] || '')) enc.push(slots.length);
    });
    if (!slots.length) continue;
    const typeWord = (typeTag || title || name).match(/\b(normal|fire|water|grass|electric|ice|fighting|poison|ground|flying|psychic|bug|rock|ghost|dragon|dark|steel|fairy)\b/i);
    const type = typeWord ? typeWord[1].toLowerCase() : null;
    const generic = !name || /^grunt$/i.test(name) || /^team go rocket grunt$/i.test(name);
    const who = generic ? (type ? type[0].toUpperCase() + type.slice(1) + '-type Grunt' : (typeTag || title || 'Grunt')) : name;
    out.push({who, title: title || '', type, quote, encounter: enc[0] || null, slots});
  }
  return out.length >= 3 ? out : null;
}

export function makeSources({fetchImpl = fetch, db = null, log = console} = {}) {
  let cache = null, loading = null;
  const get = async (url, timeoutMs) => {
    const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), timeoutMs || 15000);
    try { const r = await fetchImpl(url, {signal: ctl.signal, headers: {'user-agent': 'PokeScan/1.0 (+https://github.com/martijn-veenstra/pokescan)'}}); if (!r.ok) throw new Error(url + ' HTTP ' + r.status); return r; }
    finally { clearTimeout(to); }
  };
  async function refresh() {
    const out = {t: Date.now(), enriched: 0};
    for (const k of KINDS) out[k] = await (await get(BASE + k + '.json')).json();
    const now = Date.now(), prev = cache;
    const todo = (out.events || []).filter(ev => {
      const x = ev.extraData || {}; if (x.raidbattles || x.communityday || x.spotlight) return false;
      if (!UNSTRUCTURED.has(ev.eventType) || !ev.link) return false;
      const a = Date.parse(ev.start), b = Date.parse(ev.end);
      return isFinite(a) && isFinite(b) && b >= now && a <= now + WINDOW_AHEAD;
    }).slice(0, MAX_PAGES);
    for (const ev of todo) {
      // reuse a page parsed in the previous cycle so a slow Leek Duck does not empty the list
      const old = prev && (prev.events || []).find(e => e.eventID === ev.eventID && e.extraData && e.extraData.page);
      try {
        const page = parseEventPage(await (await get(ev.link, 10000)).text());
        if (page) { ev.extraData = Object.assign({}, ev.extraData, {page}); out.enriched++; }
      } catch (e) {
        if (old) { ev.extraData = Object.assign({}, ev.extraData, {page: old.extraData.page}); out.enriched++; }
        if (log) log.warn ? log.warn({err: e.message, event: ev.eventID}, 'event page not read') : log.log('event page not read', ev.eventID, e.message);
      }
    }
    // Team GO Rocket lineups (Shadow Pokémon): one fixed page; keep the previous parse when Leek Duck is slow or changed its markup
    try {
      const lineups = parseRocketPage(await (await get(ROCKET_URL, 10000)).text());
      if (lineups) out.rocket = {t: Date.now(), lineups};
      else throw new Error('no lineups recognised');
    } catch (e) {
      if (prev && prev.rocket) out.rocket = prev.rocket;
      if (log) log.warn ? log.warn({err: e.message}, 'rocket lineups not read') : log.log('rocket lineups not read', e.message);
    }
    cache = out;
    if (db) { try { await db.put('_system', 'sources', out); } catch {} }
    return out;
  }
  return {
    async current() {
      // a cache without Rocket lineups (parser fix just deployed, or Leek Duck was down) is retried after 10 minutes instead of 3 hours
      const fresh = c => c && Date.now() - c.t < (c.rocket ? TTL : Math.min(TTL, 10 * 60e3));
      if (fresh(cache)) return cache;
      if (!cache && db) { try { const row = await db.get('_system', 'sources'); if (row && row.data && Date.now() - row.data.t < TTL) cache = row.data; } catch {} }
      if (fresh(cache)) return cache;
      if (!loading) loading = refresh().finally(() => { loading = null; });
      if (cache) { loading.catch(() => {}); return cache; }        // serve stale while refreshing
      return loading;
    },
    refresh,
    parseEventPage,
    parseRocketPage,
  };
}
