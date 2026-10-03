/* PokeScan pages: one entry per page, read by scanner.js (showView: which view, which bottom tab, which page to remember) and
   planner.js (the router, refresh, back labels, the menu). Adding a page = an entry here, a view div in index.html and its render function.
   key: the #/key route and the view-key element · label: the page's name (menu, back buttons) · bar: the bottom tab it lights
   top: a page of its own that is remembered as the last tab · menu: [group, icon] in the menu · render: the Planner function that draws it
   (with arg: the Meta panel it shows) · meta: the panel key of the four Meta pages · alias: another key that shows this page. */
const PAGE_LIST = [
  {key: 'today',    label: 'Today',       bar: 'today',   top: true, menu: ['Play', '☀'],       render: 'renderToday'},
  {key: 'builder',  label: 'Builder',     bar: 'builder', top: true, menu: ['Play', '▦'],       render: 'renderMeta', arg: 'build', meta: 'build'},
  {key: 'teams',    label: 'Saved teams', bar: 'builder', top: true, menu: ['Play', '★'],       render: 'renderTeams'},
  {key: 'matchups', label: 'Game plan',   bar: 'builder', top: true, menu: ['Play', '⚑'],       render: 'renderMatchups'},
  {key: 'battles',  label: 'Battle log',  bar: 'builder', top: true, menu: ['Play', '◔'],       render: 'renderBattles'},
  {key: 'meta',     label: 'Meta teams',  bar: '',        top: true, menu: ['Meta', '♛'],       render: 'renderMeta', arg: 'teams', meta: 'teams'},
  {key: 'rank',     label: 'Rankings',    bar: '',        top: true, menu: ['Meta', '#'],       render: 'renderMeta', arg: 'rank', meta: 'rank'},
  {key: 'raids',    label: 'Raids',       bar: '',        top: true, menu: ['Meta', '⚔'],       render: 'renderMeta', arg: 'raids', meta: 'raids'},
  {key: 'quiz',     label: 'Type quiz',   bar: '',        top: true, menu: ['Meta', '✪'],       render: 'renderQuiz'},
  {key: 'roster',   label: 'Roster',      bar: 'roster',  top: true, menu: ['Collection', '◎'], render: 'renderRoster', alias: 'scans'},
  {key: 'invest',   label: 'Invest',      bar: 'roster',  top: true, menu: ['Collection', '✦'], render: 'renderInvest'},
  {key: 'team',     label: 'Team',        bar: 'builder', render: 'renderTeam'},
  {key: 'mon',      label: 'Pokémon',     bar: 'roster',  render: 'renderMon'},
  {key: 'battle',   label: 'Battle',      bar: 'builder', render: 'renderBattle'},
  {key: 'pro',      label: 'Pro',         bar: '',        render: 'renderPro'},
];
const PAGE = Object.fromEntries(PAGE_LIST.map(p => [p.key, p]));
const pageKey = k => (PAGE_LIST.find(p => p.key === k || p.alias === k) || PAGE.today).key;   // an unknown or old key (#/scans) → the page that shows it
function renderPage(k) {                          // draw a page with its Planner function (once planner.js has loaded)
  const p = PAGE[k], P = window.Planner; if (!p || !P || typeof P[p.render] !== 'function') return;
  if (p.arg) P[p.render](p.arg); else P[p.render]();
}
