import { parentPort, workerData } from 'node:worker_threads';
import { extractMediaWikiHtml } from './html-extractor.js';

try { parentPort.postMessage({ ok: true, value: extractMediaWikiHtml(workerData.html) }); }
catch (error) { parentPort.postMessage({ ok: false, error: /^WIKI_[A-Z_]+$/u.test(error?.message) ? error.message : 'WIKI_EXTRACTION_FAILED' }); }
