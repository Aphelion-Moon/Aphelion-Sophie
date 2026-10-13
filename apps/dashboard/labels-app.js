import { createDashboardApi } from './api.js';
import { createLabelsController } from './labels-controller.js';
import { createLabelsView } from './labels-view.js';
import { mountDashboardShell } from './shell.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const controller = createLabelsController({ api, onChange: state => view.render(state) });
const view = createLabelsView({ document, controller });
window.addEventListener('pagehide', () => controller.suspend());
document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') controller.suspend(); });
mountDashboardShell({ window, document, controller });
