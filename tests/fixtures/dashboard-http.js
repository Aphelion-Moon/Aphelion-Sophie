import { request as httpRequest } from 'node:http';
import { dashboardConfiguration } from './oauth.js';

/** Manual cookies/Host over loopback; no assertion of browser TLS or Secure-cookie enforcement. */
export async function dashboardHttp(server, path, { method = 'GET', headers = {}, body = '' } = {}) {
  const result = await dashboardBytes(server, path, { method, headers, body });
  return { ...result, body: JSON.parse(result.text) };
}

export async function dashboardBytes(server, path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const request = httpRequest({ host: server.host, port: server.port, path, method,
      headers: { Host: new URL(dashboardConfiguration.origin).host, ...headers } }, response => {
      const chunks = []; response.on('data', chunk => { chunks.push(chunk); });
      response.on('end', () => { const bytes = Buffer.concat(chunks); resolve({ status: response.statusCode, headers: response.headers, bytes, text: bytes.toString('utf8') }); });
    });
    request.on('error', reject); request.end(body);
  });
}
