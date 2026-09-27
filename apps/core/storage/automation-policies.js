import { requireCondition, requireId, requireInteger, requireKeys } from '../../../contracts/validation.js';
import { operatorGrant } from '../../../contracts/operator-grant.js';
import { canonicalAutomation, previewAutomation, requireAutomationHash } from '../../../modules/automation/index.js';
import { inTransaction } from './transaction.js';
import { automationDigest as digest, checkedAutomationPolicy as checked, latestAutomationPolicy, lockAutomationPolicy } from './automation-policy-records.js';
import { inspectAutomationChannel } from './automation-channel-policy.js';

const revision = value => requireInteger(value,0,2147483646);
function intent(value) {
  requireKeys(value,['expectedRevision','action','document'],'AUTOMATION_INPUT_INVALID'); revision(value.expectedRevision);
  requireCondition(['publish','withdraw'].includes(value.action),'AUTOMATION_INPUT_INVALID');
  if (value.action === 'withdraw') requireCondition(value.document === null,'AUTOMATION_INPUT_INVALID');
  return { expectedRevision: value.expectedRevision, action: value.action, document: value.action === 'publish' ? canonicalAutomation(value.document) : null };
}

/** Reviewed configuration only. Dry-run samples are never stored or sent. */
export function createAutomationPolicies({ pool, authorize, guildId, channels, protectedCategoryId }) {
  requireId(guildId); requireId(protectedCategoryId);
  requireCondition(typeof authorize === 'function' && typeof channels?.inspect === 'function','TRUSTED_ADAPTERS_REQUIRED');
  async function access(actor) {
    requireCondition(await authorize('automation.publish',actor,{guildId}) === true,'OPERATION_DENIED');
    const grant = operatorGrant(actor); requireCondition(grant.guildId === guildId,'FOREIGN_GUILD'); return grant;
  }
  const operation = (actor,work) => inTransaction(pool, async client => {
    const grant = await access(actor); await lockAutomationPolicy(client,guildId);
    const result = await work(client,grant); await access(actor); return result;
  });
  async function current(client,expectedRevision,withdraw = false) {
    const row = await latestAutomationPolicy(client,guildId);
    requireCondition((row?.revision ?? 0) === expectedRevision,'AUTOMATION_STALE');
    if (withdraw) requireCondition(row?.action === 'publish','AUTOMATION_UNAVAILABLE');
    return row;
  }
  async function excluded(client,ids) {
    const blocked = new Set();
    for (const id of ids) {
      if (await inspectAutomationChannel(client,{guildId,protectedCategoryId,channels,channelId:id}) === null) blocked.add(id);
    }
    return blocked;
  }
  async function checkChannels(client,document) {
    if (document === null) return;
    const ids = new Set(document.rules.flatMap(rule => rule.channels));
    requireCondition((await excluded(client,ids)).size === 0,'AUTOMATION_CHANNEL_UNAVAILABLE');
  }
  return Object.freeze({
    current: ({actor}) => operation(actor,async client => ({ current: await latestAutomationPolicy(client,guildId) })),
    async history({actor,before = null}) {
      if (before !== null) { revision(before); requireCondition(before > 0,'AUTOMATION_INPUT_INVALID'); }
      return operation(actor,async client => {
        const rows = (await client.query(`SELECT * FROM sophie_core.automation_policies WHERE guild_id = $1
          AND ($2::integer IS NULL OR revision < $2) ORDER BY revision DESC LIMIT 11`,[guildId,before])).rows;
        const entries = rows.slice(0,10).map(checked); return {entries,nextBefore:rows.length > 10 ? entries.at(-1).revision : null};
      });
    },
    async review({actor,...fields}) {
      const request = intent(fields);
      return operation(actor,async client => {
        const previous = await current(client,request.expectedRevision,request.action === 'withdraw'); await checkChannels(client,request.document);
        return {...request,previous,reviewSha256:digest(request),preservesHistory:true};
      });
    },
    async preview({actor,expectedRevision,document,events,synthetic}) {
      revision(expectedRevision); const policy = canonicalAutomation(document);
      requireCondition(synthetic === true && Array.isArray(events) && events.length > 0 && events.length <= 20,'AUTOMATION_PREVIEW_INVALID');
      // Validate the whole timeline before network/database work; the actual pass uses current exclusions.
      previewAutomation(policy,events,new Set(events.map(event => event.channelId)));
      return operation(actor,async client => {
        await current(client,expectedRevision); await checkChannels(client,policy);
        const blocked = await excluded(client,new Set(events.map(event => event.channelId)));
        return { ...previewAutomation(policy,events,blocked), expectedRevision, documentSha256:digest(policy),
          deliveryEnabled:false, sampleRetained:false, mentions:'none', linkPreviews:false };
      });
    },
    async change({actor,requestId,reviewSha256,confirmed,approvedPublic,...fields}) {
      const request = intent(fields); requireAutomationHash(requestId); requireAutomationHash(reviewSha256);
      requireCondition(confirmed === true && approvedPublic === true,'AUTOMATION_CONFIRMATION_REQUIRED');
      requireCondition(reviewSha256 === digest(request),'AUTOMATION_REVIEW_STALE');
      return operation(actor,async (client,grant) => {
        const prior = (await client.query('SELECT * FROM sophie_core.automation_policies WHERE guild_id = $1 AND request_id = $2',[guildId,requestId])).rows[0];
        if (prior) {
          checked(prior); requireCondition(prior.operator_grant.userId === grant.userId && prior.request_sha256 === reviewSha256,'AUTOMATION_REQUEST_COLLISION');
          return { revision:prior.revision,action:prior.action,duplicate:true };
        }
        await current(client,request.expectedRevision,request.action === 'withdraw'); await checkChannels(client,request.document);
        const next = request.expectedRevision + 1; revision(next);
        await client.query(`INSERT INTO sophie_core.automation_policies
          (guild_id,revision,action,document,document_sha256,request_id,request_sha256,operator_grant,approved_public)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)`,[guildId,next,request.action,request.document,
          request.document === null ? null : digest(request.document),requestId,reviewSha256,grant]);
        return {revision:next,action:request.action,duplicate:false};
      });
    },
  });
}
