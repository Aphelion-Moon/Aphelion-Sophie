import { parentPort, workerData } from 'node:worker_threads';
import { extractMediaWikiHtml, extractSiteHtml } from './html-extractor.js';

try { parentPort.postMessage({ ok: true, value: (workerData.mode === 'site' ? extractSiteHtml : extractMediaWikiHtml)(workerData.html) }); }
catch (error) { parentPort.postMessage({ ok: false, error: /^(?:WIKI|SITE)_[A-Z_]+$/u.test(error?.message) ? error.message : 'WIKI_EXTRACTION_FAILED' }); }
