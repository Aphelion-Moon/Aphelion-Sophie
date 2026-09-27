import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { mkdir, mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createAttachmentVault } from '../../apps/core/storage/attachment-vault.js';
import { createCaseAttachments } from '../../apps/core/storage/case-attachments.js';
import { createAttachmentSource } from '../../apps/core/discord/attachment-source.js';
import { createAttachmentWorker } from '../../apps/core/discord/attachment-worker.js';
import { conversationWorkflow, syntheticConversation } from './case-conversations.js';
import { GUILD } from './domain.js';

export const syntheticFileBytes = Buffer.from('Authored synthetic attachment fixture.\n');
export const syntheticAttachmentPolicy = Object.freeze({ approvalRef: 'synthetic-test-only', maxFileBytes: 1024,
  maxPerMessage: 2, maxStoredBytes: 4096, timeoutMs: 1000, allowedTypes: ['text/plain', 'image/png', 'image/jpeg'], retention: 'indefinite', quarantine: 'unscanned' });
export const syntheticAttachment = (channelId, overrides = {}) => ({ id: '740000000000000001', filename: 'synthetic.txt',
  content_type: 'text/plain', size: syntheticFileBytes.length,
  url: `https://cdn.discordapp.com/attachments/${channelId}/740000000000000001/synthetic.txt`, ...overrides });

export function syntheticFileRequest(state) {
  return (url, options, callback) => {
    state.requests.push({ url, options }); const request = new EventEmitter();
    request.end = () => queueMicrotask(async () => {
      if (state.beforeResponse) await state.beforeResponse();
      if (state.failure) { request.emit('error', new Error('Synthetic transport failure with discarded details')); return; }
      const response = Readable.from(state.chunks ?? [state.bytes]);
      response.headers = { 'content-type': 'text/plain', ...state.headers }; response.statusCode = state.status ?? 200;
      response.destroyed = false; callback(response);
    });
    request.destroy = () => {}; return request;
  };
}
export function attachmentServices(f, vault, state) {
  const store = createCaseAttachments({ pool: f.pool, guildId: GUILD, vault, readPolicy: () => state.policy, enabled: () => state.enabled });
  const source = createAttachmentSource({ request: syntheticFileRequest(state), lookup() { throw new Error('NO_REAL_DNS'); }, enabled: () => state.enabled });
  return { attachmentStore: store, attachmentSource: source, attachmentWorker: createAttachmentWorker({ store, source, vault }) };
}
export async function attachmentWorkflow(cluster) {
  const f = await conversationWorkflow(cluster);
  const base = resolve('.local/attachment-tests'); await mkdir(base, { recursive: true });
  const vaultRoot = await mkdtemp(resolve(base, 'run-')), vault = await createAttachmentVault({ root: vaultRoot, clock: () => f.clock.now });
  const fileState = { policy: structuredClone(syntheticAttachmentPolicy), enabled: true, bytes: syntheticFileBytes, requests: [] };
  let message = 730000000000000010n;
  return { ...f, vault, vaultRoot, fileState, ...attachmentServices(f, vault, fileState),
    addFile: (overrides = {}, files = null) => f.send('MESSAGE_CREATE', syntheticConversation(f.opened.channel_id,
      { id: String(message++), attachments: files ?? [syntheticAttachment(f.opened.channel_id, overrides)] })),
    jobs: () => f.admin.query('SELECT * FROM sophie_core.case_attachment_jobs ORDER BY sequence, ordinal').then(result => result.rows),
    attempts: () => f.admin.query('SELECT * FROM sophie_core.case_attachment_attempts ORDER BY started_at, slot').then(result => result.rows),
    capacity: () => f.admin.query('SELECT * FROM sophie_core.case_attachment_capacity').then(result => result.rows),
  };
}
