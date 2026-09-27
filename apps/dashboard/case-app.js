import { createDashboardApi } from './api.js';
import { createCaseController } from './case-controller.js';
import { createCaseView } from './case-view.js';
import { mountDashboardShell } from './shell.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const controller = createCaseController({ api, onChange: state => view.render(state),
  newRequestId: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join(''),
  downloadFile({ blob, filename }) {
    const url = URL.createObjectURL(blob), link = document.createElement('a');
    link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
  },
});
const view = createCaseView({ document, controller });
// Drop rendered content and ignore late responses while hidden, including back/forward cache entries.
window.addEventListener('pagehide', () => controller.suspend());
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') controller.suspend(); });
mountDashboardShell({ window, document, controller });
