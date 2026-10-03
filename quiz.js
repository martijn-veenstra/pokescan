/* PokeScan type quiz (#/quiz): three levels that teach what hits what. Beginner: type against type. Medium: real moves on real
   Pokémon, dual types included. Advanced: two meta Pokémon, who wins one on one. Every answer says why, with the type chart.
   Plus one question of the day on Today. Builds on planner.js through window.PS; adds its functions to window.Planner. */
(function () {
'use strict';
const {M, UI, esc, nm, icon, ti, tset, mvH, capT, typeWhy, TYPES18, weakToTypes} = PS;

const LEVELS = [['beginner', 'Beginner', 'type against type'], ['medium', 'Medium', 'moves on Pokémon'], ['advanced', 'Advanced', 'Pokémon against Pokémon']];
// the multipliers Pokémon GO uses, and the words for them
const EFF = [[2.56, 'Double super effective'], [1.6, 'Super effective'], [1, 'Neutral'], [0.625, 'Not very effective'], [0.390625, 'Resisted twice'], [0.244140625, 'Resisted three times']];
const effName = e => EFF.reduce((b, x) => Math.abs(Math.log(x[0] / e)) < Math.abs(Math.log(b[0] / e)) ? x : b)[1];
const xM = e => '×' + (+e.toFixed(2));
const typeName = t => `<span class="mvh">${ti(t)}${capT(t)}</span>`;
const types = ts => ts.map(typeName).join(' / ');

/* ---------- questions: {lv, text (html), options [{html, ok}], why (html)} ---------- */
function rng(seed) {                                   // a small seeded generator: the question of the day is the same all day
  let a = seed >>> 0; return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pickOf = (r, list) => list[Math.floor(r() * list.length)];
const shuffle = (r, list) => { const a = list.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
function effOptions(r, e, singles) {                   // four multiplier answers including the right one
  const pool = (singles ? EFF.slice(1, 5) : EFF).map(x => x[0]), right = pool.reduce((b, x) => Math.abs(Math.log(x / e)) < Math.abs(Math.log(b / e)) ? x : b);
  const others = shuffle(r, pool.filter(x => x !== right)).slice(0, 3);
  return shuffle(r, [right].concat(others)).map(x => ({html: `${effName(x)} <span class="dim">${xM(x)}</span>`, ok: x === right}));
}
function chartWhy(atk, def) {                         // the type chart, one defending type at a time
  const parts = def.map(d => `${typeName(atk)} on ${typeName(d)} ${xM(PVP.eff(atk, [d]))}`);
  return def.length > 1 ? `${parts.join(' · ')} → together ${xM(PVP.eff(atk, def))}` : parts[0];
}
const strongOn = t => TYPES18.filter(d => PVP.eff(t, [d]) > 1), weakOn = t => TYPES18.filter(d => PVP.eff(t, [d]) < 1);

function beginner(r) {
  if (r() < 0.55) {                                    // how effective is A on D?
    let a, d, e, tries = 0;
    do { a = pickOf(r, TYPES18); d = pickOf(r, TYPES18); e = PVP.eff(a, [d]); } while (e === 1 && r() < 0.7 && ++tries < 20);   // mostly the ones worth knowing
    return {lv: 'beginner', text: `A ${typeName(a)} attack hits a ${typeName(d)} Pokémon. How effective is it?`, options: effOptions(r, e, true),
      why: `${chartWhy(a, [d])}: ${effName(e).toLowerCase()}. ${typeName(a)} is strong against ${strongOn(a).map(typeName).join(', ') || 'nothing'}; it is resisted by ${weakOn(a).map(typeName).join(', ') || 'nothing'}.`};
  }
  const d = pickOf(r, TYPES18), weak = weakToTypes([d]);   // which attack type is super effective against D?
  const right = pickOf(r, weak), wrong = shuffle(r, TYPES18.filter(t => PVP.eff(t, [d]) <= 1)).slice(0, 3);
  return {lv: 'beginner', text: `Which attack type is super effective against a ${typeName(d)} Pokémon?`,
    options: shuffle(r, [right].concat(wrong)).map(t => ({html: typeName(t), ok: t === right})),
    why: `${typeName(d)} is weak to ${weak.map(typeName).join(', ')}. ${chartWhy(right, [d])}.`};
}
function metaMons(n) { const L = M().L; return (L.meta || []).filter(id => L.pokemon[id]).slice(0, n || 60); }
function medium(r) {
  const L = M().L, mons = metaMons(60); if (mons.length < 4) return beginner(r);
  const charged = id => L.movesOf(id).slice(1).filter(k => APP.moves[k] && APP.moves[k].e < 0);
  if (r() < 0.55) {                                    // how effective is this move on that Pokémon?
    let a, d, k, e, tries = 0;
    do { a = pickOf(r, mons); d = pickOf(r, mons); k = pickOf(r, charged(a)); e = k ? PVP.eff(APP.moves[k].t, L.pokemon[d].types) : 1; } while ((!k || a === d || (e === 1 && r() < 0.7)) && ++tries < 40);
    if (!k || a === d) return beginner(r);           // no usable move found in this league: a beginner question instead
    const dt = L.pokemon[d].types, t = APP.moves[k].t;
    return {lv: 'medium', text: `${icon(a, 's')}<b>${esc(nm(a))}</b> uses ${mvH(k)} on ${icon(d, 's')}<b>${esc(nm(d))}</b> (${types(dt)}). How effective is it?`, options: effOptions(r, e, false),
      why: `${mvH(k)} is a ${typeName(t)} move. ${chartWhy(t, dt)}: ${effName(e).toLowerCase()}. Dual types multiply: one resist and one weakness cancel out.`};
  }
  let d, opts, tries = 0;                              // which of these moves hits that Pokémon hardest?
  do {
    d = pickOf(r, mons);
    const pool = shuffle(r, [...new Set(mons.flatMap(charged))]), byType = new Map();
    for (const k of pool) if (!byType.has(APP.moves[k].t)) byType.set(APP.moves[k].t, k);
    opts = shuffle(r, [...byType.values()]).slice(0, 4).map(k => ({k, e: PVP.eff(APP.moves[k].t, L.pokemon[d].types)}));
  } while ((opts.length < 4 || opts.filter(o => o.e === Math.max(...opts.map(x => x.e))).length > 1) && ++tries < 40);
  if (opts.length < 2) return beginner(r);
  const best = opts.reduce((b, o) => o.e > b.e ? o : b), dt = L.pokemon[d].types;
  return {lv: 'medium', text: `Which charged move hits ${icon(d, 's')}<b>${esc(nm(d))}</b> (${types(dt)}) hardest?`,
    options: opts.map(o => ({html: mvH(o.k), ok: o === best})),
    why: opts.slice().sort((p, q) => q.e - p.e).map(o => `${mvH(o.k)} ${xM(o.e)}`).join(' · ') + `. ${chartWhy(APP.moves[best.k].t, dt)}.`};
}
function advanced(r) {
  const L = M().L, mons = metaMons(50); if (mons.length < 4) return medium(r);
  let a, b, v, tries = 0;
  do { a = pickOf(r, mons); b = pickOf(r, mons); v = a === b ? 500 : L.rating(a, b, '1-1'); } while ((a === b || Math.abs(v - 500) < 120) && ++tries < 60);
  if (a === b || Math.abs(v - 500) < 120) return medium(r);
  const win = v >= 500 ? a : b, lose = win === a ? b : a, rw = Math.round(win === a ? v : L.rating(b, a, '1-1'));
  const side = id => `<span class="qside">${icon(id, 'l')}<b>${esc(nm(id))}</b><span class="qty">${tset(L.pokemon[id].types)}</span></span>`;
  return {lv: 'advanced', text: `One on one, one shield each: who wins?<div class="qvs">${side(a)}<span class="dim">vs</span>${side(b)}</div>`,
    options: [a, b].map(id => ({html: `${icon(id, 's')}${esc(nm(id))}`, ok: id === win})),
    why: `<b>${esc(nm(win))}</b> wins (${rw} of 1000, 500 is even) against <b>${esc(nm(lose))}</b>.${typeWhy(L, win, lose)}`};
}
const MAKE = {beginner, medium, advanced};

/* ---------- scores ---------- */
const load = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || 'null') || d; } catch { return d; } };
const SCORE = load('quiz', {});
const saveScore = () => { try { localStorage.setItem('quiz', JSON.stringify(SCORE)); } catch {} };
function mark(lv, ok) { const s = SCORE[lv] = SCORE[lv] || {right: 0, total: 0, streak: 0, best: 0}; s.total++; if (ok) { s.right++; s.streak++; s.best = Math.max(s.best, s.streak); } else s.streak = 0; saveScore(); }

function qHtml(q, picked, onPick) {                   // the question card: options become right/wrong once picked, then the why
  const done = picked != null;
  return `<div class="qtext">${q.text}</div><div class="qopts${q.options.length === 2 ? ' two' : ''}">` + q.options.map((o, i) => `<button class="qopt${done ? (o.ok ? ' right' : i === picked ? ' wrong' : ' off') : ''}"${done ? ' disabled' : ` onclick="${onPick}(${i})"`}>${o.html}</button>`).join('') +
    `</div>${done ? `<div class="qwhy ${q.options[picked].ok ? 'ok' : 'no'}"><b>${q.options[picked].ok ? 'Right!' : 'Not quite.'}</b> ${q.why}</div>` : ''}`;
}

/* ---------- the page ---------- */
const QZ = {lv: (() => { try { return localStorage.getItem('quizLv') || 'beginner'; } catch { return 'beginner'; } })(), q: null, picked: null};
function newQuestion() { QZ.q = MAKE[QZ.lv](Math.random); QZ.picked = null; }
function renderQuiz() {
  const el = $('quiz'); if (!el) return;
  if (!APP || !window.PVP) { el.innerHTML = '<div class="note">Loading battle data…</div>'; return; }
  try {
    if (!QZ.q || QZ.q.lv !== QZ.lv) newQuestion();
    const s = SCORE[QZ.lv] || {right: 0, total: 0, streak: 0, best: 0};
    let h = `<div class="tabs sub seg qlv">${LEVELS.map(([k, l]) => `<button class="${QZ.lv === k ? 'on' : ''}" onclick="Planner.quizLevel('${k}')">${l}</button>`).join('')}</div>`;
    h += `<div class="note">${LEVELS.find(x => x[0] === QZ.lv)[2]} · ${s.total ? `${s.right} of ${s.total} right · streak ${s.streak}${s.best ? ` · best ${s.best}` : ''}` : 'no answers yet'}</div>`;
    h += `<div class="team card quiz" style="cursor:default">${qHtml(QZ.q, QZ.picked, 'Planner.quizPick')}</div>`;
    if (QZ.picked != null) h += `<button class="btn" onclick="Planner.quizNext()">Next question</button>`;
    el.innerHTML = h;
  } catch (e) { el.innerHTML = PS.errorCard('Type quiz', e); }
}
function quizPick(i) { if (QZ.picked != null || !QZ.q) return; QZ.picked = i; mark(QZ.lv, QZ.q.options[i].ok); renderQuiz(); }
function quizNext() { newQuestion(); renderQuiz(); window.scrollTo(0, 0); }
function quizLevel(k) { QZ.lv = k; try { localStorage.setItem('quizLv', k); } catch {} newQuestion(); renderQuiz(); }

/* ---------- the question of the day, on Today ---------- */
const today = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
function dailyQuestion(day) {                          // the same question all day (per league for the advanced ones), the levels in turn
  day = day || today(); let h = 2166136261; for (const c of day + '|' + LEAGUE.slug) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const n = Math.floor(Date.parse(day) / 864e5), lv = LEVELS[((n % 3) + 3) % 3][0];
  return MAKE[lv](rng(h));
}
function quizCard() {
  if (!APP || !window.PVP) return '';
  try {
    const day = today(), D = load('quizDaily', {}), q = dailyQuestion(day), picked = D.day === day ? D.picked : null;
    return `<div class="sec">Question of the day <small>${LEVELS.find(x => x[0] === q.lv)[1].toLowerCase()} · type quiz</small></div><div class="team card quiz daily" style="cursor:default">${qHtml(q, picked, 'Planner.quizDaily')}
      ${picked != null ? `<div class="dt" style="margin-top:8px"><a href="#" onclick="Planner.nav('#/quiz');return false">More questions in the Type quiz ›</a></div>` : ''}</div>`;
  } catch (e) { return ''; }
}
function quizDaily(i) {
  const day = today(), D = load('quizDaily', {}); if (D.day === day) return;
  const q = dailyQuestion(day); mark(q.lv, q.options[i].ok);
  try { localStorage.setItem('quizDaily', JSON.stringify({day, picked: i, ok: q.options[i].ok})); } catch {}
  Planner.renderToday();
}

Object.assign(Planner, {renderQuiz, quizPick, quizNext, quizLevel, quizCard, quizDaily, quizQuestion: (lv, seed) => MAKE[lv](rng(seed)), quizDailyQuestion: dailyQuestion});
})();
