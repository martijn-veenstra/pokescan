import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const FIXTURES = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
export const expected = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'expected.json'), 'utf8'));
export const fixtureFiles = Object.keys(expected).filter(k => !k.startsWith('_'));

/** Open the app with network side effects stubbed (no PvPoke fetches, no Leek Duck) and wait for data + planner. */
export async function openApp(page, hash = '') {
  await page.route('https://raw.githubusercontent.com/**', r => r.fulfill({ status: 200, contentType: 'application/json', body: '[]' }));
  await page.route('https://leekduck.com/**', r => r.fulfill({ status: 200, contentType: 'text/html', body: '' }));
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(() => { localStorage.setItem('trainer', '40'); });
  await page.goto('/index.html' + hash);
  await page.waitForFunction(() => typeof APP !== 'undefined' && APP && APP.pokemon && window.Planner, null, { timeout: 30000 });
  return errors;
}

/** Feed one screenshot to the importer and wait for it to finish. */
export async function importFile(page, file) {
  await page.evaluate(() => status('…'));
  await page.setInputFiles('#file', path.join(FIXTURES, file));
  await page.waitForFunction(() => /^Done/.test(document.getElementById('stat').textContent), null, { timeout: 180000 });
}

export const cards = page => page.evaluate(() => results.map(r => ({
  species: r.species, cp: r.cp, hp: r.hp, level: r.level,
  ivs: r.appraisal || (r.combos.length === 1 ? r.combos[0].slice(1, 4) : null),
  combos: r.combos.length, moves: r.moves || null, secondMove: r.secondMove, superseded: !!r.superseded,
})));

export const view = page => page.evaluate(() => ({
  view: [...document.querySelectorAll('.view.on')].map(v => v.id).join(','),
  hash: location.hash,
  bar: [...document.querySelectorAll('.navbar button.on')].map(b => b.id).join(','),
}));

/** Seed localStorage once per test (a reload keeps what the app wrote since): {key: value}, objects are JSON-encoded, null removes the key. */
export async function seedOnce(page, store) {
  await page.addInitScript(s => {
    if (sessionStorage.getItem('__seeded')) return; sessionStorage.setItem('__seeded', '1');
    for (const [k, v] of Object.entries(s)) { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }
  }, store);
}
/** A saved-roster object with these in-game parties and nothing else. */
export const roster = (tagged = {}) => ({ tagged, candidates: {}, pending: {}, exclude: [], moves: {}, log: [] });
