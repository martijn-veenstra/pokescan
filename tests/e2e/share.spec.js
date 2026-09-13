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

test('free plan: the screenshot stays on the device and a Pro teaser appears instead', async ({ page }) => {
  const { posts, errors } = await setup(page, 'free', []);
  await share(page, 'battle.png'); await done(page);
  expect(posts.length).toBe(0);
  await expect(page.locator('#shared .pro-lock')).toContainText('Read this screenshot');
  expect((await page.evaluate(() => JSON.parse(localStorage.getItem('scanlog'))[0].msg))).toContain('PokeScan Pro reads battle results');
  expect(errors).toEqual([]);
});
