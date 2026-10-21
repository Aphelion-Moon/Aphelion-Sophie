import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { request } from 'node:http';
import { readFile } from 'node:fs/promises';
import { startClosedScreenHost } from '../apps/activity/closed-host.js';

const root = new URL('../', import.meta.url);
const page = await readFile(new URL('apps/activity/closed.html', root));
const pin = JSON.parse(await readFile(new URL('legal/DEPENDENCIES.json', root), 'utf8')).activityFont;
const font = await readFile(new URL(pin.path, root));

function get(port, path, { host = 'onboarding.a13.info', method = 'GET', body } = {}) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, path, method, headers: { host } }, res => {
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('P40 the closed screen serves only the not-boarding page and the pinned font, on loopback', async t => {
  const server = await startClosedScreenHost({ page, font, port: 0, allowedHosts: ['onboarding.a13.info'] });
  t.after(() => server.close());
  const { address, port } = server.address();
  assert.equal(address, '127.0.0.1');

  const home = await get(port, '/');
  assert.equal(home.status, 200); assert.match(home.headers['content-type'], /^text\/html/);
  assert.match(home.body.toString('utf8'), /Not boarding yet/);
  assert.doesNotMatch(home.body.toString('utf8'), /<script/i, 'no scripts on the closed screen');
  assert.match(home.headers['content-security-policy'], /default-src 'none'/);
  assert.equal(home.headers['x-content-type-options'], 'nosniff');

  const woff = await get(port, '/fonts/CozetteVector.woff2');
  assert.equal(woff.status, 200); assert.equal(woff.headers['content-type'], 'font/woff2');
  assert.equal(createHash('sha256').update(woff.body).digest('hex'), pin.sha256);

  assert.equal((await get(port, '/activity/api/state')).status, 404);
  assert.equal((await get(port, '/../legal/DEPENDENCIES.json')).status, 404);
  assert.equal((await get(port, '/', { method: 'POST', body: 'x=1' })).status, 405);
  assert.equal((await get(port, '/', { host: 'sophie.a13.info' })).status, 421, 'other hostnames are refused');
  const head = await get(port, '/', { method: 'HEAD' });
  assert.equal(head.status, 200); assert.equal(head.body.length, 0);
});
