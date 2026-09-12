import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

// pk_test_ + base64("fake.clerk.accounts.dev$")
const PK = 'pk_test_' + Buffer.from('fake.clerk.accounts.dev$').toString('base64');
const STUB = `window.Clerk = { user: null, session: null, _l: [], load: async function(){}, addListener(f){ this._l.push(f); }, mountSignIn(el){ el.innerHTML = '<div class="stub-signin">stub sign-in</div>'; }, unmountSignIn(){},
  signOut: async function(){ this.user = null; this.session = null; this._l.forEach(f => f({user: null})); },
  __signIn(){ this.user = {id: 'user_alice', primaryEmailAddress: {emailAddress: 'alice@example.com'}}; this.session = {getToken: async () => 'tok-alice'}; this._l.forEach(f => f({user: this.user})); } };`;

test('Clerk mode: sign-in sheet, token headers, per-account sync', async ({ page }) => {
  const calls = [];
  await page.route('https://fake.clerk.accounts.dev/**', r => r.fulfill({ status: 200, contentType: 'application/javascript', body: STUB }));
  await page.route('**/api/**', route => {
    const u = new URL(route.request().url()), m = route.request().method(), auth = route.request().headers()['authorization'] || '';
    calls.push(m + ' ' + u.pathname + ' ' + auth);
    if (u.pathname === '/api/health') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, auth: 'clerk', clerkPublishableKey: PK, coach: true, version: 'test' }) });
    if (auth !== 'Bearer tok-alice') return route.fulfill({ status: 401, contentType: 'application/json', body: '{"error":"bad_token"}' });
    if (u.pathname === '/api/state' && m === 'GET') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user: 'user_alice', state: { roster: { data: { owned: { tinkaton: null } }, updatedAt: '2026-09-12T00:00:00Z' } } }) });
    if (u.pathname.startsWith('/api/state/') && m === 'PUT') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ updatedAt: new Date().toISOString() }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
  });
  await page.addInitScript(() => localStorage.removeItem('sync'));
  const errors = await openApp(page, '#/today');
  await page.evaluate(async () => { await Sync.detect(); });
  await expect.poll(() => page.evaluate(() => window.Auth && Auth.mode())).toBe('clerk');
  // signed out: the cloud button offers sign-in, the sheet mounts Clerk's UI, nothing is pushed
  expect(await page.evaluate(() => Sync.signedIn())).toBe(false);
  await page.click('#syncbtn');
  await expect(page.locator('#syncbox .stub-signin')).toBeVisible();
  await page.click('#syncbox .x');
  // sign in → pull with the token, roster merged, drawer shows the account
  await page.evaluate(() => window.Clerk.__signIn());
  await expect.poll(() => page.evaluate(() => Sync.signedIn())).toBe(true);
  await expect.poll(() => calls.some(c => c.startsWith('GET /api/state Bearer tok-alice'))).toBe(true);
  await expect.poll(() => page.evaluate(() => 'tinkaton' in Planner.ROSTER.owned)).toBe(true);
  expect(calls.some(c => /Bearer (?!tok-alice)/.test(c) && !c.includes('/api/health'))).toBe(false);
  await page.click('#menubtn');
  await expect(page.locator('#dr a:has-text("Account")')).toContainText('alice@example.com');
  await page.click('#dr .x');
  // sign out clears the connection but keeps local data
  await page.evaluate(() => window.Clerk.signOut());
  await expect.poll(() => page.evaluate(() => Sync.signedIn())).toBe(false);
  expect(await page.evaluate(() => 'tinkaton' in Planner.ROSTER.owned)).toBe(true);
  expect(errors).toEqual([]);
});
