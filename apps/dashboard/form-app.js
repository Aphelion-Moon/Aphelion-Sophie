import { createDashboardApi } from './api.js';
import { createFormController } from './form-controller.js';
import { createFormView } from './form-view.js';
import { mountDashboardShell } from './shell.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const controller = createFormController({ api, onChange: state => view.render(state),
  newRequestId: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') });
const view = createFormView({ document, controller });
mountDashboardShell({ window, document, controller });
