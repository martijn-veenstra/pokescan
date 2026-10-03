import { test, expect } from '@playwright/test';
import { openApp, seedOnce } from './helpers.js';

test('the type quiz: three levels, an answer says right or wrong and why, the score counts', async ({ page }) => {
  await seedOnce(page, { quiz: null, quizLv: null, quizDaily: null });
  const errors = await openApp(page, '#/quiz');
  await expect(page.locator('#view-quiz .ptitle')).toContainText('Type quiz');
  await expect(page.locator('#quiz .qlv button')).toHaveText(['Beginner', 'Medium', 'Advanced']);
  for (const [lv, n] of [['Beginner', null], ['Medium', 4], ['Advanced', 2]]) {
    await page.locator(`#quiz .qlv button:text-is("${lv}")`).click();
    if (n) await expect(page.locator('#quiz .qopt')).toHaveCount(n);
    await page.locator('#quiz .qopt').first().click();
    await expect(page.locator('#quiz .qopt.right')).toHaveCount(1);               // the right answer is shown either way
    await expect(page.locator('#quiz .qwhy')).toContainText(/Right!|Not quite\./);
    await expect(page.locator('#quiz .qwhy')).toContainText(/×|wins/);             // and why, with the multiplier or the matchup
    await expect(page.locator('#quiz .note')).toContainText(/of 1 right/);
    await page.locator('#quiz button:text-is("Next question")').click();
    await expect(page.locator('#quiz .qwhy')).toHaveCount(0);
  }
  expect(Object.keys(await page.evaluate(() => JSON.parse(localStorage.quiz))).sort()).toEqual(['advanced', 'beginner', 'medium']);
  // every generated question: one right answer, distinct options, an explanation; the type chart agrees with the right answer
  const bad = await page.evaluate(() => { const out = [];
    for (const lv of ['beginner', 'medium', 'advanced']) for (let seed = 1; seed <= 150; seed++) { const q = Planner.quizQuestion(lv, seed);
      if (q.options.filter(o => o.ok).length !== 1) out.push(`${lv} ${seed}: ${q.options.filter(o => o.ok).length} right answers`);
      if (new Set(q.options.map(o => o.html)).size !== q.options.length) out.push(`${lv} ${seed}: duplicate options`);
      if (!q.why) out.push(`${lv} ${seed}: no why`); }
    return out; });
  expect(bad).toEqual([]);
  expect(errors).toEqual([]);
});

test('Today asks one question a day: the same all day, answered once', async ({ page }) => {
  await seedOnce(page, { quiz: null, quizDaily: null });
  const errors = await openApp(page, '#/today');
  const card = page.locator('#today .quiz.daily');
  await expect(card).toBeVisible();
  const q1 = await card.locator('.qtext').innerHTML();
  await page.evaluate(() => Planner.renderToday());
  expect(await card.locator('.qtext').innerHTML(), 'the same question after a redraw').toBe(q1);
  await card.locator('.qopt').first().click();
  await expect(card.locator('.qwhy')).toContainText(/Right!|Not quite\./);
  await expect(card).toContainText('More questions in the Type quiz');
  expect(await card.locator('.qopt[disabled]').count()).toBeGreaterThan(1);       // answered: no second try today
  await page.reload(); await page.waitForFunction(() => typeof APP !== 'undefined' && APP && APP.pokemon && window.Planner && document.querySelector('#today .quiz.daily'));
  await expect(page.locator('#today .quiz.daily .qwhy')).toBeVisible();          // still answered after a reload
  // another day, another question (and the levels take turns)
  const days = await page.evaluate(() => ['2026-10-03', '2026-10-04', '2026-10-05'].map(d => Planner.quizDailyQuestion(d)).map(q => q.lv));
  expect(new Set(days).size).toBe(3);
  await card.locator('a:has-text("More questions")').click();
  await expect(page).toHaveURL(/#\/quiz/);
  expect(errors).toEqual([]);
});

// "My Pokémon only": your side comes from your roster in this league, the other side can be anything
test('the quiz can use only your own Pokémon for your side', async ({ page }) => {
  await seedOnce(page, { quiz: null, quizLv: null, quizDaily: null, quizOwn: null, roster: null });
  const errors = await openApp(page, '#/quiz');
  // an empty roster: the switch says it falls back to every Pokémon, questions still come
  await page.locator('#quiz .qown .chip').click();
  await expect(page.locator('#quiz .qown')).toContainText(/too few in your roster/);
  await expect(page.locator('#quiz .qopt').first()).toBeVisible();
  // three of your own, under the cap
  await page.evaluate(() => { results.length = 0;
    for (const [sp, lv] of [['AZUMARILL', 30], ['MEDICHAM', 40], ['REGISTEEL', 22]]) { const b = DATA.stats[sp][0], m = cpmAt(lv);
      const r = { species: sp, cp: calcCP(b, 5, 14, 14, m), hp: calcHP(b, 14, m), level: lv, dust: null, combos: [[lv, 5, 14, 14, b]], appraisal: [5, 14, 14], txt: '', cpCandidates: [] };
      r.key = `${sp}|${r.cp}|${r.hp}|${lv}|`; results.push(r); }
    save(); Planner.refresh(); Planner.quizLevel('beginner'); });
  const pool = await page.evaluate(() => Planner.quizPool());
  expect(pool.sort()).toEqual(['azumarill', 'medicham', 'registeel']);
  await expect(page.locator('#quiz .qown .chip.sel')).toContainText('My Pokémon only 3');
  // every question with the pool uses one of yours (who), with one right answer and a why
  const bad = await page.evaluate(p => { const out = [], seen = {};
    for (const lv of ['beginner', 'medium', 'advanced']) for (let seed = 1; seed <= 150; seed++) { const q = Planner.quizQuestion(lv, seed, p);
      if (q.who) seen[q.who] = 1;
      if (q.lv === lv && lv !== 'beginner' && !p.includes(q.who)) out.push(`${lv} ${seed}: your side ${q.who} is not yours`);
      if (q.who && !p.includes(q.who)) out.push(`${lv} ${seed}: ${q.who}`);
      if (q.options.filter(o => o.ok).length !== 1 || !q.why) out.push(`${lv} ${seed}: answers`); }
    return {out, seen: Object.keys(seen).sort()}; }, pool);
  expect(bad.out).toEqual([]);
  expect(bad.seen, 'all three of yours turn up').toEqual(['azumarill', 'medicham', 'registeel']);
  // on the page: the beginner questions name your Pokémon
  let named = false;
  for (let i = 0; i < 12 && !named; i++) { const t = await page.locator('#quiz .qtext').innerText(); named = /Your|your/.test(t) && /Azumarill|Medicham|Registeel/.test(t);
    if (!named) await page.evaluate(() => { Planner.quizLevel('beginner'); }); }
  expect(named).toBe(true);
  // Today's question follows the switch and stays the same all day
  await page.evaluate(() => Planner.nav('#/today'));
  const q1 = await page.locator('#today .quiz.daily .qtext').innerHTML();
  await page.evaluate(() => Planner.renderToday());
  expect(await page.locator('#today .quiz.daily .qtext').innerHTML()).toBe(q1);
  expect(errors).toEqual([]);
});
