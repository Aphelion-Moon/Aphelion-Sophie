import { requireCondition, requireId, requireInteger, requireKeys } from '../../contracts/validation.js';
import { freezeAiMaterial, validateAiPrompt, createAiOutputSchema } from './prompt-contract.js';

const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/u.test(value);
export function canonicalAiWorkerIdentity(value) {
  requireKeys(value,['workerId','bootId','releaseHash','profileHash','provider','domain'],'AI_IPC_IDENTITY_INVALID');
  requireCondition([value.workerId,value.bootId,value.releaseHash,value.profileHash].every(hash) &&
    value.provider === 'deepseek' && value.domain === 'public','AI_IPC_IDENTITY_INVALID');
  return freezeAiMaterial(structuredClone(value));
}

/** Only this projection crosses the worker boundary; accounting/delivery metadata stays in core. */
export function aiWorkerPayload(payload, identity) {
  const keys = ['workerDomain','releaseHash','requesterId','restricted','boundary','messages','outputContract','trimGroups','sourceMessages','contractMessageIndex','blocks'];
  const value = Object.fromEntries(keys.filter(key => payload[key] !== undefined).map(key => [key,structuredClone(payload[key])]));
  validateAiWorkerPayload(value,identity); return freezeAiMaterial(value);
}

export function validateAiWorkerPayload(value, identity) {
  const required = ['workerDomain','releaseHash','requesterId','restricted','boundary','messages','outputContract'];
  const allowed = [...required,'trimGroups','sourceMessages','contractMessageIndex','blocks'];
  requireCondition(value && required.every(key => Object.hasOwn(value,key)) && Object.keys(value).every(key => allowed.includes(key)), 'AI_IPC_PAYLOAD_INVALID');
  requireCondition(value.restricted === false && value.workerDomain === 'public' && value.releaseHash === identity.releaseHash, 'AI_IPC_SCOPE_INVALID');
  requireId(value.requesterId); requireKeys(value.boundary,['guildId','channelId','continuity','boundaryEpoch'],'AI_IPC_SCOPE_INVALID');
  requireId(value.boundary.guildId); requireId(value.boundary.channelId); requireInteger(value.boundary.boundaryEpoch,1);
  requireCondition(typeof value.boundary.continuity === 'string' && /^[a-zA-Z0-9._:-]{1,128}$/u.test(value.boundary.continuity),'AI_IPC_SCOPE_INVALID');
  validateAiPrompt(value);
  value.messages.forEach(message => requireKeys(message,['role','content'],'AI_IPC_PAYLOAD_INVALID'));
  value.sourceMessages?.forEach(source => requireKeys(source,['id','index'],'AI_IPC_PAYLOAD_INVALID'));
}

export function validateAiPreparedMetadata(value, payload) {
  requireKeys(value,['bytes','outputTokens','contract'],'AI_IPC_PREPARATION_INVALID');
  requireInteger(value.bytes,0,32768); requireInteger(value.outputTokens,64,512); createAiOutputSchema(value.contract);
  for (const key of ['outcomes','answerOnly','emojiKeys']) requireCondition(JSON.stringify(value.contract[key]) === JSON.stringify(payload.outputContract[key]),'AI_IPC_PREPARATION_INVALID');
  requireCondition(value.contract.sourceIds.every(id => payload.outputContract.sourceIds.includes(id)) &&
    (value.bytes !== 0 || createAiOutputSchema(value.contract).oneOf.length === 1),'AI_IPC_PREPARATION_INVALID');
  return freezeAiMaterial(structuredClone(value));
}
