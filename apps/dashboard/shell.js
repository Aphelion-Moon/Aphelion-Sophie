/** Shared appearance and authoring lifecycle. Authored copy and credentials never enter browser storage. */
export function mountDashboardShell({ window, document, controller, now = Date.now }) {
  const quiet = document.getElementById('quiet');
  try { quiet.checked = window.localStorage.getItem('sophie.quiet') === 'true'; } catch { /* Optional appearance only. */ }
  document.body.classList.toggle('quiet-mode', quiet.checked);
  quiet.addEventListener('change', () => {
    document.body.classList.toggle('quiet-mode', quiet.checked);
    try { window.localStorage.setItem('sophie.quiet', String(quiet.checked)); } catch { /* Editing needs no local storage. */ }
  });
  document.getElementById('avatar').addEventListener('error', event => { event.target.hidden = true; });
  window.addEventListener('beforeunload', event => {
    const state = controller.snapshot(); if (state.dirty || state.pending) { event.preventDefault(); event.returnValue = ''; }
  });
  let checkedAt = now(), checking = false;
  const check = async () => {
    if (checking || document.visibilityState !== 'visible' || controller.snapshot().busy) return;
    if (controller.snapshot().phase === 'ready' && now() - checkedAt < 60_000) return;
    checking = true; checkedAt = now();
    try { await controller.checkAccess(); } finally { checking = false; }
  };
  window.addEventListener('focus', check);
  document.addEventListener('visibilitychange', check);
  const watch = () => window.setInterval(check, 60_000);
  let timer = watch();
  window.addEventListener('pagehide', () => { window.clearInterval(timer); timer = null; });
  window.addEventListener('pageshow', event => { if (event.persisted) { if (timer === null) timer = watch(); checkedAt = 0; check(); } });
  const groups = [...document.querySelectorAll('.nav-group')];
  document.addEventListener('keydown', event => { if (event.key === 'Escape') for (const group of groups) if (group.open) { group.open = false; group.querySelector('summary').focus(); } });
  controller.start();
}
