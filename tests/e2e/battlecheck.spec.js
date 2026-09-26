import { test, expect } from '@playwright/test';
import { openApp } from './helpers.js';

const REVIEW = [
  '**Grade** C — the lead lost and the shields went on moves Azumarill takes easily.',
  '**What happened** You led Azumarill into Registeel, shielded a Focus Blast and threw Ice Beam into the Steel type.',
  '**Mistakes**\n- 0:22 Shielded Focus Blast, which Azumarill resists.\n- 0:40 Ice Beam into Registeel.',
  '**Moves** Ice Beam is resisted by Registeel.',
  '**Matchups** Azumarill loses to Registeel; Medicham wins it.',
  '**Shields** One shield spent on a resisted move.',
  '**Try this next time**\n- Lead Medicham into a Steel lead.\n- Let resisted charged moves through.\n- Bait with Play Rough before Ice Beam.',
  '**Team tip** Keep the team.'].join('\n\n');

// two recorded battles against a Registeel lead, with both sides' send-outs read, so every move has a target
const battle = (id, dt) => ({
  id, t: Date.now() - dt, league: 'great', result: 'L', src: 'film',
  ids: ['azumarill', 'medicham', 'altaria'], myIds: ['azumarill', 'medicham', 'altaria'], team: 'Rain', opp: ['registeel', 'skarmory'], oppNames: ['Registeel', 'Skarmory'],
  myNames: ['Azumarill', 'Medicham', 'Altaria'], myLead: 'azumarill', lead: 'registeel', shields: { me: 1, opp: 1 }, fainted: { me: 3, opp: 1 },
  film: ['0:00 you sent Azumarill', '0:22 you shielded', '1:02 you lost'],
  moves: [{ t: 22, by: 'opp', species: 'Registeel', move: 'Focus Blast', blocked: true }, { t: 40, by: 'my', species: 'Azumarill', move: 'Ice Beam', blocked: false }],
  filmData: { reads: [{ t: 0, side: 'my', species: 'AZUMARILL', cp: 1500 }, { t: 0, side: 'opp', species: 'REGISTEEL', cp: 1490 }],
              events: [{ t: 22, what: 'mySh', from: 2, to: 1 }], moves: [], samples: 40, dur: 90 },
});
const seed = () => {
  localStorage.setItem('roster', JSON.stringify({ tagged: { Rain: ['azumarill', 'medicham', 'altaria'] }, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] }));
  localStorage.setItem('battles', JSON.stringify([BATTLE_A, BATTLE_B]));
  localStorage.setItem('sync', JSON.stringify({ code: 'test', last: {}, base: {} })); localStorage.removeItem('bcoach');
};

test('the battle check names the move into a resist, the losing lead and the wasted shield; the review builds on it', async ({ page }) => {
  const posts = [];
  await page.route('**/api/**', route => {
    const u = route.request().url(), m = route.request().method();
    if (u.endsWith('/api/health')) return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true, db: true, storage: 'memory', sync: true, coach: true, version: 'test' }) });
    if (u.endsWith('/api/coach') && m === 'POST') { posts.push(JSON.parse(route.request().postData())); return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ text: REVIEW }) }); }
    return route.fulfill({ status: 200, contentType: 'application/json', body: '{"user":"default","state":{}}' });
  });
  await page.addInitScript(`const BATTLE_A = ${JSON.stringify(battle('b1', 0))}, BATTLE_B = ${JSON.stringify(battle('b2', 3600e3))}; (${seed})();`);
  const errors = await openApp(page, '#/battles');
  await page.evaluate(async () => { await Sync.detect(); Planner.renderBattles(); });
  // across battles: the habits card counts what keeps happening
  const log = page.locator('#battles');
  await expect(log.locator('.habits')).toContainText('2 charged moves thrown into a resist');
  await expect(log.locator('.habits')).toContainText("Azumarill's Ice Beam into Registeel (2×)");
  await expect(log.locator('.habits')).toContainText('shields spent on a charged move you resist');
  // one battle: the check, computed on the phone
  await page.evaluate(() => Planner.nav('#/battle/b1'));
  const b = page.locator('#battle');
  const check = b.locator('.bcheck');
  await expect(check).toContainText('0:40');
  await expect(check).toContainText('Ice Beam (ice) into Registeel: not very effective (×0.63)');
  await expect(check).toContainText('You shielded Registeel Focus Blast, which Azumarill resists');
  await expect(check).toContainText(/Lead Azumarill against Registeel: loses it/);
  await expect(check.locator('.bck.bad .fx').filter({ hasText: 'Medicham' })).toHaveCount(1);   // who should have led instead
  // the review is asked for by hand and carries those checks
  await b.locator('a:has-text("Coach me on this battle")').click();
  await expect(b.locator('.team.card.review .bgrade .gl')).toHaveText('C');
  await expect(b.locator('.rsec.next')).toContainText('Lead Medicham into a Steel lead');
  for (const s of ['What happened', 'Mistakes', 'Moves', 'Matchups', 'Shields', 'Try this next time', 'Team tip']) await expect(b.locator(`.rsec:has(b:text-is("${s}"))`)).toHaveCount(1);
  const ctx = posts[0].context.battle;
  expect(ctx.appChecks.filter(x => x.kind === 'mistake').map(x => x.what).join('\n')).toMatch(/Ice Beam \(ice\) into Registeel/);
  expect(ctx.history.join('\n')).toMatch(/thrown into a resist/);
  expect(errors).toEqual([]);
});
