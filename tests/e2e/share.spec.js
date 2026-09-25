import { test, expect } from '@playwright/test';
import fs from 'node:fs';
import path from 'node:path';
import { openApp, FIXTURES } from './helpers.js';

// a blank dark PNG: the scanner draws it, finds no status screen, appraisal, attacks or profile, and the share path takes over
const PNG = fs.readFileSync(path.join(FIXTURES, 'blank.png'));
const PK = 'pk_test_' + Buffer.from('fake.clerk.accounts.dev$').toString('base64');
const STUB = `window.Clerk = { user: {id: 'user_bob', primaryEmailAddress: {emailAddress: 'bob@example.com'}}, session: {getToken: async () => 'tok-bob'}, _l: [], load: async function(){}, addListener(f){ this._l.push(f); }, mountSignIn(){}, unmountSignIn(){}, signOut: async function(){} };`;
const ROCKET = { t: Date.now(), lineups: [{ who: 'Fire-type Grunt', type: 'fire', quote: 'Do you know how hot Pokémon fire attacks can get?', encounter: 1, slots: [['Vulpix', 'Growlithe'], ['Ninetales'], ['Arcanine']] }] };

async function setup(page, plan, answers) {
  const posts = [];
  await page.route('https://fake.clerk.accounts.dev/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url()), m = route.request().method();
    if (u.pathname === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, auth: 'clerk', clerkPublishableKey: PK, coach: true, vision: true, version: 'test' }) });
    if (u.pathname === '/api/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'user_bob', auth: 'clerk', plan, features: plan === 'pro' ? ['sync', 'pro', 'coach'] : ['sync'], pro: { price: '€4.99 / month', checkoutUrl: null, coach: true } }) });
    if (u.pathname === '/api/sources') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ t: Date.now(), raids: [], eggs: [], research: [], events: [], rocket: ROCKET }) });
    if (u.pathname === '/api/vision' && m === 'POST') {
      const body = JSON.parse(route.request().postData() || '{}'); posts.push(body);
      if (plan !== 'pro') return route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"upgrade_required"}' });
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: answers.shift() }) });
    }
    if (u.pathname === '/api/coach' && m === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: '**Verdict** ok' }) });
    if (u.pathname === '/api/state' && m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"user_bob","state":{}}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(() => { localStorage.removeItem('sync'); localStorage.removeItem('shares'); localStorage.removeItem('battles'); localStorage.setItem('roster', JSON.stringify({ owned: {}, pending: {}, candidates: { ninetales_shadow: null }, tagged: { Core: ['azumarill', 'medicham', 'altaria'] }, moves: {}, exclude: [], done: {}, snooze: {}, log: [], seen: {} })); });
  const errors = await openApp(page, '#/scans');
  await page.evaluate(async () => { await Sync.detect(); });
  await expect.poll(() => page.evaluate(() => Sync.signedIn() && !!Sync.me())).toBe(true);
  await page.evaluate(() => Sources.load(true));
  await expect.poll(() => page.evaluate(() => Sources.rocket().length)).toBe(1);
  return { posts, errors };
}
const share = (page, name) => page.setInputFiles('#file', { name, mimeType: 'image/png', buffer: PNG });
const done = page => page.waitForFunction(() => /^Done/.test(document.getElementById('stat').textContent), null, { timeout: 60000 });

test('Pro: an end-of-battle screenshot logs the battle with the opponents; a Rocket taunt gets a verdict', async ({ page }) => {
  const battle = { kind: 'battle_end', confidence: 0.9, battle: { result: 'loss', myTeam: ['Azumarill', 'Medicham', 'Altaria'], oppTeam: ['Tinkaton', 'Cresselia', 'Clodsire'], myLead: 'Azumarill', oppLead: 'Tinkaton', myFainted: 3, oppFainted: 1, ratingAfter: null, ratingDelta: null }, rocket: null, summary: 'GO Battle League loss' };
  const taunt = { kind: 'rocket', confidence: 0.95, battle: null, rocket: { who: 'grunt', quote: 'Do you know how hot Pokémon fire attacks can get?', pokemon: [] }, summary: 'Rocket grunt taunt' };
  const { posts, errors } = await setup(page, 'pro', [battle, taunt]);
  await share(page, 'battle.png'); await done(page);
  expect(posts.length).toBe(1);
  expect(posts[0].mediaType).toBe('image/jpeg'); expect(posts[0].image.length).toBeGreaterThan(100);
  // the card, the toast, the log entry
  await expect(page.locator('#shared .team.card.share').first()).toContainText('Loss');
  await expect(page.locator('#shared .team.card.share').first()).toContainText('Tinkaton');
  await expect(page.locator('#shared .team.card.share').first()).toContainText('Core');
  await expect(page.locator('#toast')).toContainText('Loss vs Tinkaton logged');
  const b = await page.evaluate(() => Planner.BATTLES[Planner.BATTLES.length - 1]);
  expect(b.result).toBe('L'); expect(b.src).toBe('share'); expect(b.team).toBe('Core'); expect(b.lead).toBe('tinkaton');
  expect(b.opp).toEqual(['tinkaton', 'cresselia', 'clodsire']); expect(b.ids).toEqual(['azumarill', 'medicham', 'altaria']);
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('scanlog'))[0].msg))).toContain('read by Claude');
  // the battles page shows what you face
  await page.evaluate(() => Planner.nav('#/battles'));
  await expect(page.locator('#battles')).toContainText('What you face');
  await expect(page.locator('#battles')).toContainText(/Tinkaton.*×1 · 0-1/);
  // Rocket taunt: matched to the Leek Duck lineup, Vulpix flagged because Ninetales (Shadow) is wanted
  await page.evaluate(() => Planner.nav('#/scans'));
  await share(page, 'rocket.png'); await done(page);
  const card = page.locator('#shared .team.card.share').first();
  await expect(card).toContainText('Fire-type Grunt');
  await expect(card).toContainText('Vulpix');
  await expect(card).toContainText('evolves into your wanted Ninetales (Shadow)');
  await expect(card).toContainText('Catch it: Vulpix');
  expect(posts.length).toBe(2);
  // dismiss keeps the rest
  await card.locator('.x').click();
  await expect(page.locator('#shared .team.card.share')).toHaveCount(1);
  expect(errors).toEqual([]);
});

test('Pro: a battle recording is read from sampled frames and gets film-study notes', async ({ page }) => {
  const film = { kind: 'battle_end', confidence: 0.8, battle: { result: 'win', myTeam: ['Azumarill', 'Medicham', 'Altaria'], oppTeam: ['Skarmory', 'Lickitung', 'Sableye'], myLead: 'Azumarill', oppLead: 'Skarmory', myFainted: 2, oppFainted: 3, ratingAfter: null, ratingDelta: null }, rocket: null, summary: 'GO Battle League win',
    notes: [{ t: 42, text: 'Ice Beam thrown into Skarmory\'s shield; a Play Rough bait first would have kept the shield count even.' }, { t: 131, text: 'Medicham fainted with a full Ice Punch of energy unused.' }] };
  const { posts, errors } = await setup(page, 'pro', [film]);
  // the video scanner hands over its sampled frames; here we build three small frames in the page and call the same entry point
  const ok = await page.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 90; c.height = 160; const g = c.getContext('2d'); g.fillStyle = '#123'; g.fillRect(0, 0, 90, 160);
    const snap = t => ({ t, image: c.toDataURL('image/jpeg', 0.7).split(',')[1], mediaType: 'image/jpeg' });
    return Share.fromFrames({ name: 'battle.mp4', lastModified: Date.now() }, [snap(5), snap(60), snap(120), snap(178)], 180);
  });
  expect(ok).toBe(true);
  expect(posts.length).toBe(1); expect(posts[0].images.length).toBe(4); expect(posts[0].images[3].t).toBe(178); expect(posts[0].hint).toContain('screen recording');
  const card = page.locator('#shared .team.card.share').first();
  await expect(card).toContainText('Win'); await expect(card).toContainText('Skarmory');
  await expect(card).toContainText('Film study'); await expect(card).toContainText('0:42'); await expect(card).toContainText('Ice Beam thrown into');
  const b = await page.evaluate(() => Planner.BATTLES[Planner.BATTLES.length - 1]);
  expect(b.result).toBe('W'); expect(b.opp).toEqual(['skarmory', 'lickitung', 'sableye']); expect(b.team).toBe('Core');
  expect(errors).toEqual([]);
});

test('free plan: the screenshot stays on the device and a Pro teaser appears instead', async ({ page }) => {
  const { posts, errors } = await setup(page, 'free', []);
  await share(page, 'battle.png'); await done(page);
  expect(posts.length).toBe(0);
  await expect(page.locator('#shared .pro-lock')).toContainText('Read this screenshot');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('scanlog'))[0].msg))).toContain('PokeScan Pro reads battle results');
  expect(errors).toEqual([]);
});

/* When the on-device reader misses a status screen, Claude's read of it is not just a note: its name, HP and attacks go
   onto the matching card (here a Meditite whose screen was scrolled down, so the CP is off screen), and a readable CP
   and HP of a Pokémon without a card make a new card. */
test('Pro: a status screen Claude reads updates the card, or makes one', async ({ page }) => {
  const answers = [];
  const { posts, errors } = await setup(page, 'pro', answers);
  await page.evaluate(() => { const b = DATA.stats['MEDITITE'][0], lv = 10, m = cpmAt(lv), r = { species: 'MEDITITE', cp: calcCP(b, 5, 13, 12, m), hp: calcHP(b, 12, m), level: lv, dust: null, combos: [[lv, 5, 13, 12, b]], appraisal: [5, 13, 12], txt: '', cpCandidates: [] }; r.key = `MEDITITE|${r.cp}|${r.hp}|${lv}|`; results.length = 0; results.push(r); save(); Planner.refresh(); });
  answers.push({ kind: 'status', confidence: 0.9, pokemon: { name: 'Meditite', cp: null, hp: 48, hpMax: 48, fast: 'Confusion', charged: ['Psyshock'], newAttack: true }, summary: 'Status screen for a Meditite' });
  await share(page, 'IMG_2167.png'); await done(page);
  expect(posts).toHaveLength(1);
  expect(await page.evaluate(() => results.map(r => [r.species, r.moves, r.secondMove]))).toEqual([['MEDITITE', ['CONFUSION', 'PSYSHOCK'], false]]);
  await expect(page.locator('#toast')).toContainText(/Read by Claude · MEDITITE moves: Confusion · Psyshock/);
  // a Pokémon with no card yet: CP and HP make one
  const azu = await page.evaluate(() => { const b = DATA.stats['AZUMARILL'][0], m = cpmAt(20); return { cp: calcCP(b, 8, 15, 15, m), hp: calcHP(b, 15, m) }; });
  answers.push({ kind: 'status', confidence: 0.9, pokemon: { name: 'Azumarill', cp: azu.cp, hp: azu.hp, hpMax: azu.hp, fast: 'Bubble', charged: ['Ice Beam', 'Play Rough'], newAttack: false }, summary: 'Status screen for an Azumarill' });
  await share(page, 'IMG_3000.png'); await done(page);
  const a = await page.evaluate(() => results.find(r => r.species === 'AZUMARILL'));
  expect(a).toBeTruthy();
  expect(a.cp).toBe(azu.cp);
  expect(a.moves).toEqual(['BUBBLE', 'ICE_BEAM', 'PLAY_ROUGH']);
  expect(await page.evaluate(() => JSON.parse(localStorage.getItem('shares') || '[]').length)).toBe(0);   // placed on cards, no leftover note card
  expect(errors).toEqual([]);
});
