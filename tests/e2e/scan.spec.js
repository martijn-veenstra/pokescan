import { test, expect } from '@playwright/test';
import { openApp, importFile, cards, expected, fixtureFiles } from './helpers.js';

test.describe('scanner fixture corpus', () => {
  for (const file of fixtureFiles) {
    test(file, async ({ page }) => {
      const errors = await openApp(page, '#/scans');
      await page.evaluate(() => { results.length = 0; save(); render(); });
      await importFile(page, file);
      const got = await cards(page), want = expected[file];
      expect(got, 'exactly one card').toHaveLength(1);
      const c = got[0];
      expect(c.species).toBe(want.species);
      expect(c.cp).toBe(want.cp);
      expect(c.hp).toBe(want.hp);
      if (want.level !== undefined) expect(c.level).toBe(want.level);
      if (want.ivs) expect(c.ivs).toEqual(want.ivs);
      if (want.moves) { expect(c.moves).toEqual(want.moves); expect(c.secondMove).toBe(want.secondMove); }
      else expect(c.moves, 'no moves invented for an appraisal').toBeNull();
      expect(errors).toEqual([]);
    });
  }
});

test('appraisal then status screen of the same Pokémon fold into one card', async ({ page }) => {
  await openApp(page, '#/scans');
  await page.evaluate(() => { results.length = 0; save(); render(); });
  await importFile(page, 'stun-appr.png');
  await importFile(page, 'stun-status.png');
  const got = await cards(page);
  expect(got).toHaveLength(1);
  expect(got[0]).toMatchObject({ species: 'STUNFISK', cp: 794, hp: 126, ivs: [5, 9, 13], moves: ['METAL_CLAW', 'EARTHQUAKE'], secondMove: false });
});
