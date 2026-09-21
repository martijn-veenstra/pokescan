import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const BREVIEW = '**What happened** You led Azumarill into Medicham and switched on the Counter.\n\n**Turning point** At 0:24, when you spent the second shield.\n\n**Do differently**\n- Lead Altaria and hold a shield for the closer\n\n**Matchup note** This trio is short on a Fighting answer.';

// one film battle in the log, as the reader would leave it: teams read, no party attributed yet
const seed = () => {
  localStorage.setItem('roster', JSON.stringify({ tagged: { Rain: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
  localStorage.setItem('battles', JSON.stringify([{
    id: 'b1', t: Date.now(), league: 'great', result: 'L', src: 'film',
    ids: null, myIds: ['azumarill', 'medicham'], team: null, opp: ['registeel', 'skarmory'], oppNames: ['Registeel', 'Skarmory'],
    myNames: ['Azumarill', 'Medicham'], myLead: 'azumarill', lead: 'registeel',
    shields: { me: 2, opp: 1 }, fainted: { me: 3, opp: 1 },
    film: ['0:00 you sent Azumarill (1500)', '0:24 you shielded (1 left)', '1:02 you lost a Pokémon'],
    filmData: { reads: [{ t: 0, side: 'my', species: 'AZUMARILL', cp: 1500 }], events: [{ t: 24, what: 'mySh', from: 2, to: 1 }], samples: 40, dur: 90 },
  }]));
};

test('the battle log imports recordings, attributes a team, and opens each battle', async ({ page }) => {
  await page.addInitScript(seed);
  const errors = await openApp(page, '#/battles');

  // the import door is here now, on the page the battles live on
  const btn = page.locator('#battles button:has-text("Import a battle recording")');
  await expect(btn).toBeVisible();
  expect(await page.locator('#vfile').getAttribute('accept')).toBe('video/*');

  // a film battle with no party yet asks which one you played, and suggests the closest match
  const chips = page.locator('#battles .tchips.bteam');
  await expect(chips).toBeVisible();
  await expect(chips.locator('.chip.sug')).toContainText('Rain');       // two of three members match
  expect(await page.evaluate(() => Planner.matchParty(['azumarill', 'medicham']))).toBe('Rain');
  await chips.locator('.chip:has-text("Rain")').click();
  // attributing it fills the trio, so the stats and the team page count it from here on
  expect(await page.evaluate(() => { const b = Planner.BATTLES.find(x => x.id === 'b1'); return [b.team, b.ids]; }))
    .toEqual(['Rain', ['azumarill', 'medicham', 'altaria']]);
  await expect(page.locator('#battles .tchips.bteam')).toHaveCount(0);  // asked once, then quiet

  // the row opens the battle's own page
  await page.locator('#battles .team.row').first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/battle/b1');
  const b = page.locator('#battle');
  await expect(b).toContainText('Loss');
  await expect(b).toContainText('Registeel / Skarmory');
  await expect(b.locator('.filmt')).toContainText('0:24 you shielded');
  await expect(b).toContainText('you 2 · them 1');                      // shields
  await expect(b).toContainText('from your recording');

  // and the team it was played with now lists it
  await page.evaluate(() => Planner.openTeam(['azumarill', 'medicham', 'altaria'], 'Rain'));
  await expect(page.locator('#team')).toContainText('Its battles');
  await page.locator('#team .team.row', { hasText: 'vs Registeel' }).first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/battle/b1');
  expect(errors).toEqual([]);
});

test('a battle review is asked for by hand, not spent automatically', async ({ page }) => {
  const posts = [];
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/auth')) return route.fulfill({ status: 200, contentType: 'application/json', body: '{"ok":true}' });
    if (u.endsWith('/api/coach') && m === 'POST') { posts.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: BREVIEW }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(seed);
  await page.addInitScript(() => { localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} })); localStorage.removeItem('bcoach'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(async () => { await Sync.detect(); Planner.nav('#/battle/b1'); });
  const b = page.locator('#battle');
  await expect(b.locator('.rvwait')).toContainText('Review this battle');
  expect(posts, 'nothing is spent until asked').toHaveLength(0);

  await b.locator('a:has-text("Review this battle")').click();
  await expect(b.locator('.team.card.review')).toContainText('You led Azumarill');
  expect(posts).toHaveLength(1);
  expect(posts[0].mode, 'the battle review uses its own server mode').toBe('battle');
  expect(posts[0].context.battle.result).toBe('L');
  expect(posts[0].context.battle.timeline[0]).toMatchObject({ at: 24, what: 'mySh' });
  expect(posts[0].context.builder, 'a battle review does not carry the builder team').toBeUndefined();
  // all four sections are parsed, not dumped as one block
  await expect(b.locator('.rsec')).toHaveCount(4);
  await expect(b.locator('.rsec:has-text("Turning point")')).toContainText('0:24');
  // it is cached: leaving and coming back does not ask again
  await page.evaluate(() => { Planner.nav('#/battles'); Planner.nav('#/battle/b1'); });
  await expect(b.locator('.team.card.review')).toContainText('You led Azumarill');
  expect(posts).toHaveLength(1);
  expect(errors).toEqual([]);
});
