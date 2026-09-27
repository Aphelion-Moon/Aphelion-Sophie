import { open } from 'node:fs/promises';
import { requireCondition } from '../../../contracts/validation.js';

/** Operator-selected bounded local configuration; never reachable through a request route. */
export async function readRuntimeJson(path) {
  requireCondition(typeof path === 'string' && path.length > 0, 'RUNTIME_FILE_REQUIRED');
  const file = await open(path, 'r');
  try {
    const bytes = Buffer.alloc(65537), { bytesRead } = await file.read(bytes, 0, bytes.length, 0);
    requireCondition(bytesRead > 0 && bytesRead <= 65536, 'RUNTIME_FILE_INVALID');
    return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, bytesRead)));
  } finally { await file.close(); }
}
