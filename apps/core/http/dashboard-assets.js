import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { requireCondition } from '../../../contracts/validation.js';
import { DASHBOARD_GROUPS, dashboardPageAllowed } from '../../../contracts/dashboard-navigation.js';

export const DASHBOARD_CSP = "default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self'; connect-src 'self'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'";
const assets = [
  ['/ai', '../../dashboard/ai.html', 'text/html; charset=utf-8'],
  ['/ai-preferences', '../../dashboard/ai-preferences.html', 'text/html; charset=utf-8'],
  ['/dashboard/ai-app.js', '../../dashboard/ai-app.js', 'text/javascript; charset=utf-8'],
  ['/modules/assistant/participation.js', '../../../modules/assistant/participation.js', 'text/javascript; charset=utf-8'],
  ['/modules/assistant/personality.js', '../../../modules/assistant/personality.js', 'text/javascript; charset=utf-8'],
  ['/login', '../../dashboard/login.html', 'text/html; charset=utf-8'],
  ['/localizations', '../../dashboard/localizations.html', 'text/html; charset=utf-8'],
  ['/dashboard/localizations-app.js', '../../dashboard/localizations-app.js', 'text/javascript; charset=utf-8'],
  ['/automation', '../../dashboard/automation.html', 'text/html; charset=utf-8'],
  ...['automation-app', 'automation-controller', 'automation-view'].map(name => [`/dashboard/${name}.js`, `../../dashboard/${name}.js`, 'text/javascript; charset=utf-8']),
  ['/modules/automation/index.js', '../../../modules/automation/index.js', 'text/javascript; charset=utf-8'],
  ['/contracts/validation.js', '../../../contracts/validation.js', 'text/javascript; charset=utf-8'],
  ['/contracts/dashboard-navigation.js', '../../../contracts/dashboard-navigation.js', 'text/javascript; charset=utf-8'],
  ['/modules/onboarding/presentation.js', '../../../modules/onboarding/presentation.js', 'text/javascript; charset=utf-8'],
  ['/dashboard/markdown.js', '../../dashboard/markdown.js', 'text/javascript; charset=utf-8'],
  ['/permissions', '../../dashboard/permissions.html', 'text/html; charset=utf-8'],
  ...['permissions-app', 'permissions-controller', 'permissions-view'].map(name => [`/dashboard/${name}.js`, `../../dashboard/${name}.js`, 'text/javascript; charset=utf-8']),
  ['/', '../../dashboard/index.html', 'text/html; charset=utf-8'],
  ['/ticket-forms', '../../dashboard/ticket-forms.html', 'text/html; charset=utf-8'],
  ['/cases', '../../dashboard/cases.html', 'text/html; charset=utf-8'],
  ['/manage-cases', '../../dashboard/manage-cases.html', 'text/html; charset=utf-8'],
  ['/contact-entry', '../../dashboard/contact-entry.html', 'text/html; charset=utf-8'],
  ['/contacts', '../../dashboard/contacts.html', 'text/html; charset=utf-8'],
  ['/case-labels', '../../dashboard/case-labels.html', 'text/html; charset=utf-8'],
  ['/staff-notes', '../../dashboard/staff-notes.html', 'text/html; charset=utf-8'],
  ['/case-replies', '../../dashboard/case-replies.html', 'text/html; charset=utf-8'],
  ['/answers', '../../dashboard/answers.html', 'text/html; charset=utf-8'],
  ['/dashboard/styles.css', '../../dashboard/styles.css', 'text/css; charset=utf-8'],
  ...['replies-app', 'replies-controller', 'replies-view'].map(name => [`/dashboard/${name}.js`, `../../dashboard/${name}.js`, 'text/javascript; charset=utf-8']),
  ...['answers-app', 'answers-controller', 'answers-view'].map(name => [`/dashboard/${name}.js`, `../../dashboard/${name}.js`, 'text/javascript; charset=utf-8']),
  ...['app', 'api', 'controller', 'view', 'authoring-controller', 'shell', 'form-app', 'form-controller', 'form-view', 'case-app', 'case-controller', 'case-view', 'notes-app', 'notes-controller', 'notes-view', 'labels-app', 'labels-controller', 'labels-view', 'management-app', 'management-controller', 'management-view', 'contact-app', 'contact-controller', 'contact-view', 'contacts-app', 'contacts-controller', 'contacts-view'].map(name => [`/dashboard/${name}.js`, `../../dashboard/${name}.js`, 'text/javascript; charset=utf-8']),
  ['/dashboard/sophie-avatar.png', '../../../Sophie-Visual-Assets-v1/assets/sophie/neon-chibi-v1/sophie-avatar.png', 'image/png'],
];

/** Preload a closed asset set. Request paths are never interpreted as filesystem paths. */
export async function createDashboardPresentation() {
  const files = new Map();
  for (const [path, file, contentType] of assets) {
    let bytes = await readFile(new URL(file, import.meta.url));
    if (contentType.startsWith('text/html')) {
      // Navigation values are fixed application copy, never request or authored data.
      bytes = Buffer.from(bytes.toString('utf8').replace('href="/auth/start"', `href="/auth/start?returnTo=${encodeURIComponent(path === '/login' ? '/' : path)}"`));
    }
    files.set(path, { contentType, bytes });
  }
  const manifest = JSON.parse(await readFile(new URL('../../../Sophie-Visual-Assets-v1/asset-manifest.json', import.meta.url), 'utf8'));
  const avatar = manifest.assets.find(asset => asset.id === 'sophie.avatar.neon-chibi-v1'), bytes = files.get('/dashboard/sophie-avatar.png').bytes;
  requireCondition(avatar?.bytes === bytes.length && createHash('sha256').update(bytes).digest('hex') === avatar.sha256, 'DASHBOARD_ASSET_INVALID');
  return Object.freeze({ get(path, session = null) {
    const asset = files.get(path); if (!asset || !asset.contentType.startsWith('text/html') || path === '/login') return asset ?? null;
    const navigation = DASHBOARD_GROUPS.map(group => {
      const pages = group.pages.filter(([target]) => session === null || dashboardPageAllowed(target, session));
      if (!pages.length) return '';
      return `<details class="nav-group" open><summary>${group.title}</summary><div class="nav-links">` +
        pages.map(([target,label]) => `<a href="${target}"${target === path ? ' aria-current="page"' : ''}>${label}</a>`).join('') + '</div></details>';
    }).join('');
    let html = asset.bytes.toString('utf8').replace('<!-- service-navigation -->', navigation);
    if (session !== null) html = html.replace('</head>', `<meta name="sophie-session" content="${encodeURIComponent(JSON.stringify(session))}"></head>`);
    return { ...asset, bytes: Buffer.from(html) };
  } });
}

export function sendDashboardAsset(response, asset) {
  response.writeHead(200, { 'Content-Type': asset.contentType, 'Content-Length': asset.bytes.length, 'Cache-Control': 'no-store',
    'Content-Security-Policy': DASHBOARD_CSP, 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer',
    'Permissions-Policy': 'camera=(), microphone=(), geolocation=()' });
  response.end(asset.bytes);
}
