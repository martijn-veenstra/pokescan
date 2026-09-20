import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const PK = 'pk_test_' + Buffer.from('fake.clerk.accounts.dev$').toString('base64');
const STUB = `window.Clerk = { user: {id: 'user_bob', primaryEmailAddress: {emailAddress: 'bob@example.com'}}, session: {getToken: async () => 'tok-bob'}, _l: [], load: async function(){}, addListener(f){ this._l.push(f); }, mountSignIn(){}, unmountSignIn(){}, signOut: async function(){} };`;
const REVIEW = '**Verdict** Fine.\n\n**Strengths**\n- ok\n\n**Weak spots**\n- Tinkaton\n\n**Swaps**\n- none\n\n**Order**\nLead: Azumarill · Swap: Medicham · Closer: Altaria';

test('free plan sees the locked review and the Pro page; Pro unlocks the review', async ({ page }) => {
  let plan = 'free'; const coachPosts = [];
  await page.route('https://fake.clerk.accounts.dev/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url()), m = route.request().method();
    if (u.pathname === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, auth: 'clerk', clerkPublishableKey: PK, coach: true, version: 'test' }) });
    if (u.pathname === '/api/me') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ userId: 'user_bob', auth: 'clerk', plan, planSource: plan === 'pro' ? 'paid' : null, features: plan === 'pro' ? ['sync', 'pro', 'coach'] : ['sync'], pro: { price: '€4.99 / month', checkoutUrl: 'https://pay.example/pro?client_reference_id=user_bob', coach: true } }) });
    if (u.pathname === '/api/coach' && m === 'POST') { coachPosts.push(1); return plan === 'pro' ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: REVIEW }) }) : route.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"upgrade_required"}' }); }
    if (u.pathname === '/api/state' && m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"user_bob","state":{}}' });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(() => { localStorage.removeItem('sync'); localStorage.removeItem('bcoach'); });
  const errors = await openApp(page, '#/builder');
  await page.evaluate(async () => { await Sync.detect(); });
  await expect.poll(() => page.evaluate(() => window.Auth && Auth.mode() === 'clerk' && Sync.signedIn() && !!Sync.me())).toBe(true);
  expect(await page.evaluate(() => Sync.plan())).toBe('free');
  // a complete team shows the locked card instead of a review, and nothing is sent to the server
  await page.evaluate(() => Planner.tryTeam(['azumarill', 'medicham', 'altaria']));
  await expect(page.locator('#builder .team.card.pro-lock')).toContainText('AI review');
  await page.waitForTimeout(500);
  expect(coachPosts.length).toBe(0);
  // drawer entry and the Pro page
  await page.click('#menubtn');
  await expect(page.locator('#dr a:has-text("PokeScan Pro")')).toContainText('AI features');
  await page.click('#dr a:has-text("PokeScan Pro")');
  await expect(page.locator('#pro')).toContainText('€4.99 / month');
  await expect(page.locator('#pro a.btn.primary')).toHaveAttribute('href', 'https://pay.example/pro?client_reference_id=user_bob');
  await expect(page.locator('#pro')).toContainText('In Pro today');
  await expect(page.locator('#pro')).toContainText('in development');
  // the teaser links to the Pro page
  await page.evaluate(() => Planner.nav('#/builder'));
  await page.click('#builder .team.card.pro-lock');
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/pro');
  // the account is upgraded: the Pro page says so and the builder review runs
  plan = 'pro';
  await page.evaluate(async () => { await Sync.refreshMe(); });
  await expect(page.locator('#pro')).toContainText('You are on Pro');
  await page.evaluate(() => Planner.nav('#/builder'));
  await expect(page.locator('#builder .team.card.review')).toContainText('Fine.', { timeout: 15000 });
  expect(coachPosts.length).toBe(1);
  expect(errors).toEqual([]);
});
