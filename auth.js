/* PokeScan accounts: Clerk in plain JavaScript. The server's /api/health says which mode it runs in:
   'clerk'    → this file loads ClerkJS, mounts its sign-in UI and hands sync.js a fresh session token per request
   'passcode' → the old single-user passcode field (sync.js handles it, nothing to do here)
   The app itself never waits for this: offline or signed out it opens with local data and sync pauses. */
(function () {
'use strict';
const A = {mode: 'none', ready: null, user: null, listeners: []};
const $ = id => document.getElementById(id);

function frontendApi(pk) {                    // pk_test_<base64 of "xxx.clerk.accounts.dev$">
  try { const b64 = pk.replace(/^pk_(test|live)_/, ''); return atob(b64).replace(/\$$/, ''); } catch { return null; }
}
function init(health) {
  if (!health || health.auth !== 'clerk' || !health.clerkPublishableKey) { A.mode = health && health.auth ? health.auth : 'none'; return Promise.resolve(A.mode); }
  if (A.ready) return A.ready;
  A.mode = 'clerk';
  A.ready = new Promise(resolve => {
    const fapi = frontendApi(health.clerkPublishableKey);
    if (!fapi) { A.mode = 'offline'; resolve(A.mode); return; }
    const s = document.createElement('script');
    s.src = `https://${fapi}/npm/@clerk/clerk-js@5/dist/clerk.browser.js`;
    s.setAttribute('data-clerk-publishable-key', health.clerkPublishableKey);
    s.crossOrigin = 'anonymous'; s.async = true;
    s.onload = async () => {
      try {
        await window.Clerk.load();
        A.user = window.Clerk.user || null;
        window.Clerk.addListener(({user}) => { const prev = A.user && A.user.id; A.user = user || null; if ((user && user.id) !== prev) for (const f of A.listeners) f(A.user); });
        resolve(A.mode);
        for (const f of A.listeners) f(A.user);
      } catch (e) { console.warn('Clerk did not load', e); A.mode = 'offline'; resolve(A.mode); }
    };
    s.onerror = () => { A.mode = 'offline'; resolve(A.mode); };   // no network: keep working locally
    document.head.appendChild(s);
  });
  return A.ready;
}
const signedIn = () => A.mode === 'clerk' && !!(window.Clerk && window.Clerk.session);
async function token() { try { return signedIn() ? await window.Clerk.session.getToken() : null; } catch { return null; } }   // short-lived JWT: fetched per request, never stored
function onChange(f) { A.listeners.push(f); }
function mountSignIn(el) { if (window.Clerk && el && !el.dataset.mounted) { el.dataset.mounted = '1'; window.Clerk.mountSignIn(el, {routing: 'virtual', appearance: {variables: {colorPrimary: '#3BC489', colorBackground: '#17222F', colorText: '#EAF1F7', colorInputBackground: '#0E1626', colorInputText: '#EAF1F7'}}}); } }
function unmountSignIn(el) { if (window.Clerk && el && el.dataset.mounted) { try { window.Clerk.unmountSignIn(el); } catch {} delete el.dataset.mounted; } }
async function signOut() { if (window.Clerk) await window.Clerk.signOut(); }
function email() { const u = A.user; return u ? ((u.primaryEmailAddress && u.primaryEmailAddress.emailAddress) || u.username || u.id) : ''; }
window.Auth = {init, mode: () => A.mode, signedIn, token, onChange, mountSignIn, unmountSignIn, signOut, email, userId: () => A.user && A.user.id};
})();
