// Runs the Shuttle Activity's closed screen on 127.0.0.1:38124 for onboarding.a13.info (owner decision of
// 21 October 2026). Refuses to start if the bundled font does not match its pin.
// Usage: node apps/activity/closed-host.mjs [--port 38124]
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { startClosedScreenHost } from './closed-host.js';

const root = new URL('../../', import.meta.url);
const portArg = process.argv.indexOf('--port');
const port = portArg > 0 ? Number(process.argv[portArg + 1]) : 38124;
if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) throw new Error('INVALID_PORT');

const pin = JSON.parse(await readFile(new URL('legal/DEPENDENCIES.json', root), 'utf8')).activityFont;
const font = await readFile(new URL(pin.path, root));
if (createHash('sha256').update(font).digest('hex') !== pin.sha256) throw new Error('ACTIVITY_FONT_PIN_MISMATCH');
const page = await readFile(new URL('apps/activity/closed.html', root));

const server = await startClosedScreenHost({ page, font, port, allowedHosts: ['onboarding.a13.info', `127.0.0.1:${port}`] });
console.log(`Shuttle Activity closed screen on 127.0.0.1:${port}`);
const stop = () => server.close(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
