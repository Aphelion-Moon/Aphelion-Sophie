import { createDashboardApi } from './api.js';
import { createGuidanceController } from './controller.js';
import { createGuidanceView } from './view.js';
import { mountDashboardShell } from './shell.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const controller = createGuidanceController({ api, onChange: state => view.render(state),
  newRequestId: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') });
const view = createGuidanceView({ document, controller });
mountDashboardShell({ window, document, controller });
