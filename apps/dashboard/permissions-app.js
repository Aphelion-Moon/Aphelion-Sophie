import { createDashboardApi } from './api.js';
import { createPermissionsController } from './permissions-controller.js';
import { createPermissionsView } from './permissions-view.js';
import { mountDashboardShell } from './shell.js';

const api = createDashboardApi({ fetch: window.fetch.bind(window) });
const controller = createPermissionsController({ api, onChange: state => view.render(state),
  newRequestId: () => Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('') });
const view = createPermissionsView({ document, controller });
mountDashboardShell({ window, document, controller });
let applicationTimer=window.setInterval(()=>controller.refreshApplication(false),3000);
window.addEventListener('pagehide',()=>{window.clearInterval(applicationTimer);applicationTimer=null;});
window.addEventListener('pageshow',event=>{if(event.persisted&&applicationTimer===null)applicationTimer=window.setInterval(()=>controller.refreshApplication(false),3000);});
