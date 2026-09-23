import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const REVIEW = '**Verdict** A solid safe-swap core around Azumarill.\n\n**Game plan**\n- Open: Medicham leads and throws Ice Punch early to pull a shield\n- Mid-game: switch to Azumarill into anything Steel\n- Close: Altaria finishes with shields down\n\n**Strengths**\n- Medicham leads and pressures shields\n- Azumarill is the safe swap\n\n**Weak spots**\n- Tinkaton beats all three: swap to Medicham and bait\n\n**Swaps**\n- Altaria → Corsola (Galarian) (to catch or build): answers Tinkaton\n\n**Order**\nLead: Medicham · Swap: Azumarill · Closer: Altaria\nMedicham pressures shields early; Azumarill is the safest switch; Altaria closes with shields down.';

test('a complete team gets an AI review when asked, never by itself, cached per trio', async ({ page }) => {
  const posts = [];
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/auth')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.endsWith('/api/coach') && m === 'POST') { posts.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: REVIEW }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(() => { localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} })); localStorage.removeItem('bcoach'); });
  const errors = await openApp(page, '#/builder');
  await page.evaluate(async () => { await Sync.detect(); Planner.clearSlots(); });
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'altaria']));
  // a complete trio offers a review and asks for nothing until it is tapped: reviews are Pro and counted per hour
  const ask = page.locator('#builder .team.card.rvwait a:has-text("Review this team")');
  await expect(ask).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts, 'nothing is sent before the tap').toHaveLength(0);
  await ask.click();
  await expect(page.locator('#builder .team.card.review')).toContainText('A solid safe-swap core');
  await expect(page.locator('#builder .team.card.review .rsec')).toHaveCount(5);
  // the game plan sits right under the verdict, its three beats named
  const plan = page.locator('#builder .team.card.review .rsec.plan');
  await expect(plan).toContainText('Game plan');
  await expect(plan.locator('li b')).toHaveText(['Open', 'Mid-game', 'Close']);
  await expect(plan).toContainText('pull a shield');
  await expect(page.locator('#builder .team.card.review')).not.toContainText('No game plan in this review yet');
  expect(posts).toHaveLength(1);
  expect(posts[0].mode).toBe('review');
  expect(posts[0].context.builder.slots).toHaveLength(3);
  // the order the player runs and the app's own role numbers travel with the request
  expect(posts[0].context.builder.lineup.map(x => x.slot)).toEqual(['Lead', 'Swap', 'Closer']);
  expect(posts[0].context.builder.lineup[0].types.length).toBeGreaterThan(0);
  expect(posts[0].context.builder.lineupKnown).toBe(true);
  expect(posts[0].context.builder.appRoles.map(x => x.role).sort()).toEqual(['Closer', 'Lead', 'Swap']);
  // the builder's own slots differ from the review's order: one tap reorders them
  await expect(page.locator('#builder .team.card.review .rsec:has-text("Order") button:has-text("Reorder the slots")')).toBeVisible();
  expect(posts[0].context.builder.weakSpots.length).toBeGreaterThan(0);
  // the same trio again: no new call; a different trio: one more
  await page.evaluate(() => Planner.nav('#/today'));
  await page.evaluate(() => Planner.nav('#/builder'));
  await expect(page.locator('#builder .team.card.review')).toContainText('A solid safe-swap core');
  expect(posts).toHaveLength(1);
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'tinkaton']));
  await page.waitForTimeout(500);
  expect(posts, 'a different trio does not ask by itself either').toHaveLength(1);
  await page.click('#builder .team.card.rvwait a:has-text("Review this team")');
  await expect.poll(() => posts.length).toBe(2);
  // saved party rows carry the verdict, team page shows the review
  // a newly saved party with no review yet: its page offers one and does not ask
  await page.evaluate(() => { Planner.ROSTER.tagged['Fresh'] = ['azumarill', 'altaria', 'tinkaton']; Planner.refresh(); Planner.openTeam(['azumarill', 'altaria', 'tinkaton'], 'Fresh'); });
  await expect(page.locator('#team .team.card.rvwait a:has-text("Review this team")')).toBeVisible();
  await page.waitForTimeout(500);
  expect(posts, 'saving a team spends no review').toHaveLength(2);
  await page.evaluate(() => { Planner.ROSTER.tagged['Core'] = ['azumarill', 'medicham', 'altaria']; Planner.refresh(); Planner.nav('#/teams'); });
  await expect(page.locator('#teams .team.row .ai').first()).toContainText('A solid safe-swap core');
  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria'], 'Core'));
  await expect(page.locator('#team .team.card.review')).toContainText('Strengths');
  expect(posts).toHaveLength(2);
  // the party page shows the saved order as Lead / Swap / Closer, and the review's Order line can be applied in one tap
  await expect(page.locator('#team .hero .role').first()).toContainText('Azumarill');
  await expect(page.locator('#team .hero .sec small')).toContainText('your order');
  await expect(page.locator('#team .team.card.review .rsec:has-text("Order")')).toContainText('Lead: Medicham · Swap: Azumarill · Closer: Altaria');
  await page.click('#team .team.card.review .rsec:has-text("Order") button:has-text("Use this order")');
  await expect.poll(() => page.evaluate(() => Planner.ROSTER.tagged['Core'].join())).toBe('medicham,azumarill,altaria');
  await expect(page.locator('#team .hero .role').first()).toContainText('Medicham');
  await expect(page.locator('#team .hero .role .rl').first()).toContainText('Lead');
  await expect(page.locator('#team .team.card.review .rsec:has-text("Order") button')).toHaveCount(0);
  expect(posts).toHaveLength(2);                    // same trio: the cached review stays
  // the ‹ › arrows on the hero tiles move a member one place, in the saved order
  await page.click('#team .hero .role:nth-child(2) .rl .mvs:has-text("‹")');
  await expect.poll(() => page.evaluate(() => Planner.ROSTER.tagged['Core'].join())).toBe('azumarill,medicham,altaria');
  await expect(page.locator('#team .hero .role').first()).toContainText('Azumarill');
  await page.click('#team .hero .role:nth-child(3) .rl .mvs:has-text("‹")');
  await expect.poll(() => page.evaluate(() => Planner.ROSTER.tagged['Core'].join())).toBe('azumarill,altaria,medicham');
  expect(posts).toHaveLength(2);
  // Refresh review asks again
  await page.click('#team .team.card.review .ctx .dots');
  await page.click('#team .team.card.review .ctx .menu button:has-text("Refresh review")');
  await expect.poll(() => posts.length).toBe(3);
  expect(errors).toEqual([]);
});

test('the review card runs the Pokéball loader: shaking with a live timer, caught when the review lands', async ({ page }) => {
  let polls = 0;
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/auth')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    // the server hands back a job, as it does for a real review: the card waits while we poll
    if (u.endsWith('/api/coach') && m === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: '{"jobId":"j1"}' });
    if (u.includes('/api/coach/j1')) return route.fulfill({ status: 200, contentType: 'application/json', body: ++polls < 2 ? '{"status":"working"}' : JSON.stringify({ status: 'done', text: REVIEW }) });
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(() => { localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} })); localStorage.removeItem('bcoach'); });
  const errors = await openApp(page, '#/builder');
  await page.evaluate(async () => { await Sync.detect(); Planner.clearSlots(); });
  await page.evaluate(() => Planner.goBuilder(['azumarill', 'medicham', 'altaria']));
  await page.click('#builder .team.card.rvwait a:has-text("Review this team")');
  // the ball shakes inside the card while Claude thinks, and the heading counts the seconds
  const ball = page.locator('#builder .team.card.rvwait .pball.rv');
  await expect(ball).toHaveClass(/\bon\b/);
  await expect(ball.locator('svg .ball')).toHaveCount(1);
  // the catch lasts 900 ms and then the card becomes the review, so polling for it is a race on a loaded machine:
  // watch for the class instead, from before the job can resolve, and assert afterwards that it happened
  await page.evaluate(() => { window.__caught = false;
    new MutationObserver(() => { if (document.querySelector('.pball.rv.done')) window.__caught = true; })
      .observe(document.body, {subtree: true, childList: true, attributes: true, attributeFilter: ['class']}); });
  await expect.poll(() => page.locator('#builder .rvsec').textContent()).toMatch(/[1-9]\d*s/);
  // it lands: the ball is caught first, then the card becomes the review
  await expect(page.locator('#builder .team.card.review')).toContainText('A solid safe-swap core');
  expect(await page.evaluate(() => window.__caught), 'the ball was caught before the card turned into the review').toBe(true);
  await expect(page.locator('#builder .team.card.rvwait')).toHaveCount(0);
  expect(errors).toEqual([]);
});

test('a review saved before the game plan existed offers to refresh for one, without asking by itself', async ({ page }) => {
  const posts = [];
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/auth')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.endsWith('/api/coach') && m === 'POST') { posts.push(1); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: REVIEW }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(() => {
    localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} }));
    localStorage.setItem('roster', JSON.stringify({ tagged: { Core: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
    const key = ['azumarill', 'medicham', 'altaria'].sort().join('+') + '|great';
    localStorage.setItem('bcoach', JSON.stringify({ reviews: { [key]: { t: Date.now() - 86400000, text: '**Verdict** An older review.\n\n**Strengths**\n- ok', slots: ['azumarill', 'medicham', 'altaria'] } } }));
  });
  const errors = await openApp(page, '#/teams');
  await page.evaluate(async () => { await Sync.detect(); Planner.openTeam(['azumarill', 'medicham', 'altaria'], 'Core'); });
  const card = page.locator('#team .team.card.review');
  await expect(card).toContainText('An older review');
  await expect(card).toContainText('No game plan in this review yet');
  expect(posts, 'an old review is not replaced behind the player\'s back').toHaveLength(0);
  await card.locator('a:has-text("refresh it")').click();
  await expect.poll(() => posts.length).toBe(1);
  await expect(page.locator('#team .team.card.review .rsec.plan')).toContainText('Open');
  await expect(page.locator('#team .team.card.review')).not.toContainText('No game plan in this review yet');
  expect(errors).toEqual([]);
});

test('a refresh that does not come through keeps the review there was', async ({ page }) => {
  let n = 0;
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/auth')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.endsWith('/api/coach') && m === 'POST') { n++; return route.fulfill({ status: 429, contentType: 'application/json', body: JSON.stringify({ error: 'rate_limited', message: 'at most 10 reviews per hour per account' }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(() => {
    localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} }));
    localStorage.setItem('roster', JSON.stringify({ tagged: { Core: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
    const key = ['azumarill', 'medicham', 'altaria'].sort().join('+') + '|great';
    localStorage.setItem('bcoach', JSON.stringify({ reviews: { [key]: { t: Date.now() - 3600000, text: '**Verdict** The review from before.\n\n**Game plan**\n- Open: lead\n- Mid-game: swap\n- Close: close', slots: ['azumarill', 'medicham', 'altaria'] } } }));
  });
  const errors = await openApp(page, '#/teams');
  await page.evaluate(async () => { await Sync.detect(); Planner.openTeam(['azumarill', 'medicham', 'altaria'], 'Core'); });
  await page.click('#team .team.card.review .ctx .dots');
  await page.click('#team .team.card.review .ctx .menu button:has-text("Refresh review")');
  await expect.poll(() => n).toBe(1);
  const card = page.locator('#team .team.card.review');
  await expect(card).toContainText('The review from before');
  await expect(card).toContainText('did not come through');
  await expect(card).toContainText('10 reviews per hour');
  expect(errors).toEqual([]);
});
