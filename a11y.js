/* PokeScan a11y layer. The views build HTML from template strings with inline onclick handlers; rewriting all of them
   into <button>s would touch every template, so this layer makes the existing DOM accessible instead:
   - every clickable div/span/a[href="#"] gets role="button" and tabindex="0", and Enter/Space activates it (delegated);
   - the five overlays (#sheet, #drawer, #profile, #help, #syncbox) become real dialogs when they open: role, aria-modal,
     focus moves in, Tab is trapped, Escape closes (same path as clicking the backdrop), focus returns to the opener.
   New elements are covered by a MutationObserver, so views that render later need nothing. */
(function () {
'use strict';

/* ---------- clickable elements ---------- */
const CLICKY = '[onclick]';
const NATIVE = /^(button|a|input|select|textarea|summary|label)$/i;
function fix(root) {
  if (!(root instanceof Element) && root !== document) return;
  const els = (root instanceof Element && root.matches(CLICKY) ? [root] : []).concat([...(root.querySelectorAll ? root.querySelectorAll(CLICKY) : [])]);
  for (const el of els) {
    if (NATIVE.test(el.tagName)) continue;                     // buttons, links and inputs are fine as they are
    if (el.id && /^(drawer|sheet|syncbox|profile|help)$/.test(el.id)) continue;   // backdrops: not in the tab order
    const h = el.getAttribute('onclick') || '';
    if (/^\s*(event\.stopPropagation\(\)|if\s*\(event\.target===this\)[^;]*);?\s*$/.test(h)) continue;   // bubbling guards, not controls
    if (!el.hasAttribute('role')) el.setAttribute('role', 'button');
    if (!el.hasAttribute('tabindex')) el.setAttribute('tabindex', '0');
    if (el.classList.contains('x') && !el.hasAttribute('aria-label')) el.setAttribute('aria-label', 'Close');
  }
}
document.addEventListener('keydown', e => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const el = e.target;
  if (!(el instanceof Element) || NATIVE.test(el.tagName) || el.getAttribute('role') !== 'button') return;
  e.preventDefault();                                          // space must not scroll
  el.click();
});

/* ---------- dialogs ---------- */
const DIALOGS = ['sheet', 'drawer', 'profile', 'help', 'syncbox'];
const state = new Map();                                       // id -> {opener}
const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
function dialogEl(id) { return document.getElementById(id); }
function panel(d) { return d.firstElementChild || d; }         // focus and label live on the inner box, the outer div is the backdrop
function onOpen(d) {
  const p = panel(d);
  p.setAttribute('role', 'dialog'); p.setAttribute('aria-modal', 'true');
  const h = p.querySelector('h2, .ttl');
  if (h) { if (!h.id) h.id = d.id + '-title'; p.setAttribute('aria-labelledby', h.id); }
  state.set(d.id, { opener: document.activeElement instanceof HTMLElement ? document.activeElement : null });
  fix(d);
  const f = p.querySelector(FOCUSABLE);
  (f || p).focus({ preventScroll: true });
  if (!f) { p.setAttribute('tabindex', '-1'); p.focus({ preventScroll: true }); }
}
function onClose(d) {
  const s = state.get(d.id); state.delete(d.id);
  if (s && s.opener && document.contains(s.opener)) s.opener.focus({ preventScroll: true });
}
function topOpen() {
  for (const id of DIALOGS) { const d = dialogEl(id); if (d && d.classList.contains('open')) return d; }
  return null;
}
document.addEventListener('keydown', e => {
  const d = topOpen(); if (!d) return;
  if (e.key === 'Escape') { e.preventDefault(); d.click(); return; }   // the backdrop's own handler closes it (event.target === the backdrop)
  if (e.key !== 'Tab') return;
  const list = [...panel(d).querySelectorAll(FOCUSABLE)].filter(el => el.offsetParent !== null);
  if (!list.length) return;
  const first = list[0], last = list[list.length - 1];
  if (e.shiftKey && (document.activeElement === first || !panel(d).contains(document.activeElement))) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});

/* ---------- observe ---------- */
function start() {
  fix(document);
  for (const id of DIALOGS) { const d = dialogEl(id); if (d && d.classList.contains('open')) onOpen(d); }
  new MutationObserver(muts => {
    for (const m of muts) {
      if (m.type === 'childList') for (const n of m.addedNodes) fix(n);
      else if (m.type === 'attributes' && m.attributeName === 'class') {
        const el = m.target;
        if (el instanceof Element && DIALOGS.includes(el.id)) {
          const open = el.classList.contains('open'), was = state.has(el.id);
          if (open && !was) onOpen(el);
          else if (!open && was) onClose(el);
        }
      }
    }
  }).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class'] });
}
if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start);
else start();
})();
