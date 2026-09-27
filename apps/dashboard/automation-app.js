import { createDashboardApi } from './api.js';
import { createAutomationController } from './automation-controller.js';
import { createAutomationView } from './automation-view.js';
import { mountDashboardShell } from './shell.js';

const api=createDashboardApi({fetch:window.fetch.bind(window)});
const controller=createAutomationController({api,onChange:state=>view.render(state),
  newRequestId:()=>Array.from(crypto.getRandomValues(new Uint8Array(32)),byte=>byte.toString(16).padStart(2,'0')).join('')});
const view=createAutomationView({document,controller});
window.addEventListener('pagehide',()=>controller.suspend());
document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')controller.suspend();});
mountDashboardShell({window,document,controller});
