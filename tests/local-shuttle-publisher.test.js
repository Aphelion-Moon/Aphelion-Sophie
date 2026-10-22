import test from 'node:test';
import assert from 'node:assert/strict';
import { createLocalShuttlePublisher, requireElevatedSession } from '../apps/core/operator/local-shuttle-publisher.js';

const GUILD = '100000000000000001', OWNER = '100000000000000099', OTHER = '100000000000000002', DEFINITION = 'shuttle';
const owner = (extra = {}) => ({ capability_epoch: '4', policy_version: 2, observation: { guildOwner: true, present: true, bot: false, ...extra } });

/** Synthetic authority records only: the policy version and each user's last recorded observation. */
function fakePool(rows, policy = 2) {
  const queries = [];
  return { queries, rows, async query(sql, params) {
    queries.push(sql);
    if (sql.includes('capability_policies')) return { rows: [{ version: policy }] };
    if (sql.includes('actor_authority')) return { rows: rows.has(params[1]) ? [rows.get(params[1])] : [] };
    throw new Error('unexpected query');
  } };
}
/** Stands in for the dashboard's store: every use case asks `authorize` first, as the real store does. */
function fakeStore(record) {
  return options => {
    record.options = options;
    const check = async actor => assert.equal(await options.authorize('shuttle.publish', actor, { guildId: options.guildId, definitionId: options.definitionId }), true, 'OPERATION_DENIED');
    return {
      async readOnboardingDraft({ actor }) { record.actor = actor; await check(actor); return { draft: { revision: 3, sha256: 'a'.repeat(64), document: { helpPauses: false, stages: [] } }, latest: { version: 7, status: 'published' }, currentPublishedVersion: 7 }; },
      async saveOnboardingDraft(request) { record.save = request; await check(request.actor); return { definitionId: DEFINITION, action: 'save', revision: request.expectedRevision + 1, sha256: 'b'.repeat(64) }; },
      async reviewOnboardingDraft({ actor, revision }) { await check(actor); return { valid: true, errors: [], publication: { version: 8 }, pages: [{ id: 'the-brochure', title: 'The Brochure', segments: ['a', 'b', 'c'] }],
        latest: { version: 7, status: 'published' }, currentPublishedVersion: 7, latestImpact: { active: 0, rolePending: 0, complete: 0 }, revision }; },
      async publishOnboardingDraft(request) { record.publish = request; await check(request.actor); return { action: 'publish', version: 8 }; },
    };
  };
}
const publisher = (rows, record = {}, extra = {}) => createLocalShuttlePublisher({ pool: fakePool(rows), guildId: GUILD, definitionId: DEFINITION, authorId: OWNER,
  requestId: () => 'c'.repeat(64), createStore: fakeStore(record), ...extra });

test('T-LOCAL-PUB-01 the local command uses the shared store, marked as a local operator, and records the owner as author', async () => {
  const record = {}, local = publisher(new Map([[OWNER, owner()]]), record);
  assert.equal(record.options.origin, 'local-operator'); assert.equal(record.options.guildId, GUILD); assert.equal(record.options.definitionId, DEFINITION);
  const saved = await local.save({ helpPauses: false, stages: [] });
  assert.equal(record.save.expectedRevision, 3, 'saves on top of the latest draft revision');
  assert.deepEqual(record.save.actor, { guildId: GUILD, userId: OWNER, capabilityEpoch: 4, policyVersion: 2 });
  assert.deepEqual(saved.review, { valid: true, errors: [], version: 8, stages: [{ id: 'the-brochure', title: 'The Brochure', messages: 3 }],
    latest: { version: 7, status: 'published' }, currentPublishedVersion: 7, latestImpact: { active: 0, rolePending: 0, complete: 0 } });
  await local.publish({ revision: 4, sha256: 'b'.repeat(64), expectedLatestVersion: 7, expectedLatestStatus: 'published' });
  assert.deepEqual({ ...record.publish, actor: undefined }, { actor: undefined, requestId: 'c'.repeat(64), expectedRevision: 4, expectedHash: 'b'.repeat(64),
    expectedLatestVersion: 7, expectedLatestStatus: 'published' });
  const status = await local.status();
  assert.equal(status.draft.revision, 3); assert.equal('document' in status.draft, false, 'status never prints guidance');
});

test('T-LOCAL-PUB-02 only the recorded guild owner, on the current policy, can be the author', async () => {
  await assert.rejects(publisher(new Map()).status(), /LOCAL_OPERATOR_AUTHOR_UNKNOWN/);
  for (const observation of [{ guildOwner: false }, { present: false }, { bot: true }]) {
    await assert.rejects(publisher(new Map([[OWNER, owner(observation)]])).status(), /LOCAL_OPERATOR_AUTHOR_NOT_OWNER/);
  }
  await assert.rejects(publisher(new Map([[OWNER, { ...owner(), policy_version: 1 }]])).status(), /LOCAL_OPERATOR_AUTHOR_NOT_OWNER/, 'a record on an older policy');
  assert.throws(() => publisher(new Map(), {}, { authorId: 'owner' }), /INVALID/);
});

test('T-LOCAL-PUB-03 authorisation covers only this command\'s actor, only publishing this definition, and only while the owner record is unchanged', async () => {
  const record = {}, rows = new Map([[OWNER, owner()]]), local = publisher(rows, record);
  await local.status();
  const { authorize } = record.options, actor = record.actor, scope = { guildId: GUILD, definitionId: DEFINITION };
  assert.equal(await authorize('shuttle.publish', actor, scope), true);
  assert.equal(await authorize('shuttle.publish', { ...actor }, scope), false, 'a copied actor');
  assert.equal(await authorize('case.manage', actor, scope), false, 'another capability');
  assert.equal(await authorize('shuttle.publish', actor, { guildId: GUILD, definitionId: 'other' }), false, 'another definition');
  rows.set(OWNER, { ...owner(), capability_epoch: '5' });
  assert.equal(await authorize('shuttle.publish', actor, scope), false, 'the owner record changed since the operation began');
  rows.set(OWNER, owner({ guildOwner: false }));
  await assert.rejects(authorize('shuttle.publish', actor, scope), /LOCAL_OPERATOR_AUTHOR_NOT_OWNER/);
  rows.delete(OWNER);
  await assert.rejects(local.save({ helpPauses: false, stages: [] }), /LOCAL_OPERATOR_AUTHOR_UNKNOWN/);
});

test('T-LOCAL-PUB-04 the command refuses to run outside an elevated Windows session', () => {
  const run = stdout => () => ({ status: 0, stdout });
  const high = '"Mandatory Label\\High Mandatory Level","Label","S-1-16-12288",""\r\n', medium = '"Mandatory Label\\Medium Mandatory Level","Label","S-1-16-8192",""\r\n';
  const calls = [];
  requireElevatedSession({ run: (path, args) => { calls.push([path, args]); return { status: 0, stdout: high }; }, platform: 'win32', systemRoot: 'C:\\Windows' });
  assert.deepEqual(calls, [['C:\\Windows\\System32\\whoami.exe', ['/groups', '/fo', 'csv', '/nh']]]);
  assert.throws(() => requireElevatedSession({ run: run(medium), platform: 'win32', systemRoot: 'C:\\Windows' }), /LOCAL_OPERATOR_ELEVATION_REQUIRED/);
  assert.throws(() => requireElevatedSession({ run: () => ({ status: 1, stdout: high }), platform: 'win32', systemRoot: 'C:\\Windows' }), /LOCAL_OPERATOR_ELEVATION_REQUIRED/);
  assert.throws(() => requireElevatedSession({ run: run(high), platform: 'linux', systemRoot: 'C:\\Windows' }), /LOCAL_OPERATOR_ELEVATION_REQUIRED/);
});
