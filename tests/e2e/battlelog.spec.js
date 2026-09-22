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
    moves: [{ t: 22, by: 'opp', species: 'Registeel', move: 'Focus Blast', blocked: true }, { t: 40, by: 'my', species: 'Azumarill', move: 'Ice Beam', blocked: false }],
    filmData: { reads: [{ t: 0, side: 'my', species: 'AZUMARILL', cp: 1500 }], events: [{ t: 24, what: 'mySh', from: 2, to: 1 }],
                moves: [{ t: 22, by: 'opp', species: 'Registeel', move: 'Focus Blast', blocked: true }, { t: 40, by: 'my', species: 'Azumarill', move: 'Ice Beam', blocked: false }], samples: 40, dur: 90 },
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
  // the moves read off the banners, split by side, with the shielded one marked
  await expect(b).toContainText('Moves used');
  await expect(b.locator('.sec:has-text("Moves used") + .team.card')).toContainText('Ice Beam');
  await expect(b.locator('.chip.warn', { hasText: 'Focus Blast' }), 'a shielded charged move is marked').toBeVisible();

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
  // a card that is merely offering a review must not run the thinking spinner: it reads as a review that never lands
  expect(await b.locator('.pball.rv .ring').evaluate(el => getComputedStyle(el).animationName)).toBe('none');

  await b.locator('a:has-text("Review this battle")').click();
  await expect(b.locator('.team.card.review')).toContainText('You led Azumarill');
  expect(posts).toHaveLength(1);
  expect(posts[0].mode, 'the battle review uses its own server mode').toBe('battle');
  expect(posts[0].context.battle.result).toBe('L');
  expect(posts[0].context.battle.timeline[0]).toMatchObject({ at: 24, what: 'mySh' });
  // and the moves travel with it, so the review can talk about the shield trade instead of guessing
  expect(posts[0].context.battle.movesUsed).toEqual([
    { at: 22, by: 'them', name: 'Registeel', move: 'Focus Blast', shielded: true },
    { at: 40, by: 'you', name: 'Azumarill', move: 'Ice Beam', shielded: false }]);
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

test('a read recording is a draft first: summary, team pick, then Save puts it in the log', async ({ page }) => {
  // seed once, not again on the reload below — the reload is what proves a pending read survives leaving the page
  await page.addInitScript(() => {
    localStorage.setItem('roster', JSON.stringify({ tagged: { Rain: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
    if (!sessionStorage.getItem('seeded')) { sessionStorage.setItem('seeded', '1'); localStorage.removeItem('battles'); localStorage.removeItem('bdraft'); }
  });
  const errors = await openApp(page, '#/battles');
  // the by-hand widget is gone: importing is how a battle gets logged
  await expect(page.locator('#battles')).not.toContainText('Log a battle');
  await expect(page.locator('#battles .wl .win')).toHaveCount(0);

  // two battles read off a recording arrive as one draft
  await page.evaluate(() => Planner.draftBattles([
    { result: 'L', myIds: ['azumarill', 'medicham'], myNames: ['Azumarill', 'Medicham'], opp: ['registeel'], oppNames: ['Registeel'],
      shields: { me: 2, opp: 1 }, fainted: { me: 3, opp: 1 }, film: ['0:00 you sent Azumarill (1500)'], filmData: { dur: 90, events: [], reads: [] }, src: 'film', t: Date.now() },
    { result: 'W', myIds: ['azumarill', 'altaria'], myNames: ['Azumarill', 'Altaria'], opp: ['tinkaton'], oppNames: ['Tinkaton'],
      shields: { me: 1, opp: 2 }, fainted: { me: 1, opp: 3 }, film: ['0:00 you sent Azumarill (1500)'], filmData: { dur: 80, events: [], reads: [] }, src: 'film', t: Date.now() },
  ]));
  const card = page.locator('#battles .team.card.draft');
  await expect(card).toBeVisible();
  await expect(card).toContainText('2 battles · 1-1');
  await expect(card).toContainText('vs Registeel');
  await expect(card).toContainText('shields 2–1');
  expect(await page.evaluate(() => Planner.BATTLES.length), 'a draft is not in the log').toBe(0);

  // the party is guessed from what the recording read, and one pick covers the whole set
  await expect(card.locator('.chip.ok')).toContainText('Rain');
  await card.locator('.chip:has-text("Rain")').click();                 // toggle off
  await expect(page.locator('#battles .team.card.draft .chip.ok')).toHaveCount(0);
  await page.locator('#battles .team.card.draft .chip:has-text("Rain")').click();

  await page.locator('#battles .team.card.draft .wl .win').click();
  await expect(page.locator('#battles .team.card.draft')).toHaveCount(0);
  const saved = await page.evaluate(() => Planner.BATTLES.map(b => ({ r: b.result, team: b.team, ids: b.ids })));
  expect(saved).toHaveLength(2);
  expect(saved.every(b => b.team === 'Rain' && b.ids.length === 3), 'the pick is applied to every battle of the set').toBe(true);
  // and it survives a reload while it waits
  await page.evaluate(() => Planner.draftBattles([{ result: 'W', myIds: ['azumarill'], myNames: ['Azumarill'], opp: ['jellicent'], oppNames: ['Jellicent'], film: [], filmData: { dur: 60, events: [], reads: [] }, src: 'film', t: Date.now() }]));
  await page.reload();
  await page.waitForFunction(() => window.Planner && APP);
  await expect(page.locator('#battles .team.card.draft')).toContainText('vs Jellicent');
  await page.locator('#battles .team.card.draft button:has-text("Discard")').click();
  await expect(page.locator('#battles .team.card.draft')).toHaveCount(0);
  expect(await page.evaluate(() => Planner.BATTLES.length)).toBe(2);
  expect(errors).toEqual([]);
});

test('a truncated read says how little of the recording it managed, instead of looking complete', async ({ page }) => {
  await page.addInitScript(() => { localStorage.removeItem('battles'); localStorage.removeItem('blog'); });
  const errors = await openApp(page, '#/battles');
  await page.evaluate(() => {
    // what a stall leaves behind: one battle read, but only the first 37 s of a 205 s recording
    Planner.logBattleImport({ file: 'stalled.mp4', kind: 'video', size: 396e6, ms: 130000, ok: true,
      film: { frames: 80, cal: true, rows: 70, shots: 6, banners: 12, good: 1, entries: 1, dur: 205, seen0: 2, seen1: 37 } });
    Planner.logBattleImport({ file: 'whole.mp4', kind: 'video', size: 396e6, ms: 130000, ok: true,
      film: { frames: 324, cal: true, rows: 300, shots: 12, banners: 52, good: 1, entries: 1, dur: 205, seen0: 2, seen1: 200 } });
  });
  const log = page.locator('#battles .team.card.blog');
  await expect(log).toContainText('1 battle read.');
  await expect(log, 'the truncated one says what is missing').toContainText('Only 2–37 s of the 205 s recording could be read');
  await expect(log).toContainText('read 2–37s of 205s');
  // a read that covered the battle says nothing extra
  const rows = log.locator('.il');
  await expect(rows.nth(0), 'the complete read is not flagged').not.toContainText('could be read');
  expect(errors).toEqual([]);
});

test('a battle row carries the clock time, the timeline is not boxed twice, and an idle review does not spin', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('roster', JSON.stringify({ tagged: {}, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
    // 21 Sep 2026 at 19:42 — two battles the same evening are only told apart by the time
    localStorage.setItem('battles', JSON.stringify([{
      id: 'b9', t: new Date('2026-09-21T19:42:00').getTime(), league: 'great', result: 'W', src: 'film',
      ids: null, myIds: ['azumarill'], myNames: ['Azumarill'], opp: ['registeel'], oppNames: ['Registeel'], lead: 'registeel',
      shields: { me: 1, opp: 2 }, fainted: { me: 1, opp: 3 },
      film: ['0:17 you sent Azumarill (1465)', '1:02 they lost a Pokémon'],
      // a move read off a banner before the side could be worked out: it must still be shown, not silently dropped
      moves: [{ t: 65, by: null, species: 'Bastiodon', move: 'Stone Edge', blocked: false }],
      filmData: { reads: [], events: [], moves: [], samples: 40, dur: 181 },
    }]));
  });
  const errors = await openApp(page, '#/battles');
  await expect(page.locator('#battles .team.row .dt').first(), 'the log says when, to the minute').toContainText('21 sep 19:42');

  await page.locator('#battles .team.row').first().click();
  await expect.poll(() => page.evaluate(() => location.hash)).toBe('#/battle/b9');
  await expect(page.locator('#battle .team.card .sec .dim').first()).toContainText('21 sep 19:42');
  // the timeline is its own card, not a box drawn inside another one
  await expect(page.locator('#battle .filmt')).toBeVisible();
  await expect(page.locator('#battle .team.card .filmt'), 'no card inside a card').toHaveCount(0);
  // a move with no side still appears, under its own row
  await expect(page.locator('#battle')).toContainText('Side not read');
  await expect(page.locator('#battle .chip', { hasText: 'Stone Edge' })).toBeVisible();
  expect(errors).toEqual([]);
});
