import { permissionDigest } from '../runtime/permission-configuration.js';

// Fixed projections only: no message, form, session, note, attachment or transcript
// tables. One statement gives counts and fingerprints the same database snapshot.
const sources = {
  cases: `SELECT id, user_id, type, state, version, desired_access, channel_id FROM sophie_core.case_reservations WHERE guild_id=$1`,
  provisions: `SELECT case_id, policy_version, operation_token, presence_epoch, audience_version, create_started,
    channel_id, phase, chosen_channel_id, chosen_candidates FROM sophie_core.case_provisions WHERE guild_id=$1`,
  channels: `SELECT case_id, channel_id FROM sophie_core.case_channels WHERE guild_id=$1`,
  invitations: `SELECT case_id, version, user_id, presence_epoch, status, operator_grant
    FROM sophie_core.case_participants WHERE guild_id=$1 AND status IN ('pending','active')`,
  lifecycle: `SELECT case_id, version, action, previous_access, operator_grant FROM sophie_core.case_lifecycle_actions WHERE guild_id=$1 AND status='pending'`,
  deliveries: `SELECT operation_id, kind, status, fence, attempts, dispatch_started, lease_owner, lease_until
    FROM sophie_core.outbox WHERE guild_id=$1 AND status IN ('ready','leased','parked')`,
  members: `SELECT user_id, state->'eligibilityEpoch' AS eligibility_epoch, state->'accessEpoch' AS access_epoch,
    state->'presenceEpoch' AS presence_epoch, state->'muteRequested' AS mute_requested FROM sophie_core.members WHERE guild_id=$1`,
  authority: `SELECT user_id, capability_epoch, presence_epoch, policy_version FROM sophie_core.actor_authority WHERE guild_id=$1`,
  case_policies: `SELECT version, policy FROM sophie_core.case_policies WHERE guild_id=$1`,
  capability_policies: `SELECT version, policy FROM sophie_core.capability_policies WHERE guild_id=$1`,
};
const sql = `WITH ${Object.entries(sources).map(([name, select]) => `${name} AS (${select})`).join(',')},
  retained AS (SELECT r.*, p.policy_version, p.create_started, p.phase, p.channel_id AS provision_channel,
    p.chosen_channel_id, p.chosen_candidates,
    ARRAY(SELECT c.channel_id FROM channels c WHERE c.case_id=r.id ORDER BY c.channel_id COLLATE "C") AS channel_ids
    FROM cases r LEFT JOIN provisions p ON p.case_id=r.id)
  SELECT jsonb_build_object(
    'cases', (SELECT jsonb_build_object('total',count(*), 'open',count(*) FILTER (WHERE desired_access='open'),
      'closed',count(*) FILTER (WHERE desired_access='closed'), 'sealed',count(*) FILTER (WHERE desired_access='sealed'),
      'transitioning',count(*) FILTER (WHERE state IN ('pending','closing')),
      'policyMismatch',count(*) FILTER (WHERE policy_version IS NULL OR policy_version<>$2),
      'unlocated',count(*) FILTER (WHERE create_started AND cardinality(channel_ids)=0),
      'unresolvedSelection',count(*) FILTER (WHERE cardinality(channel_ids)>1 AND
        (chosen_channel_id IS NULL OR NOT chosen_channel_id=ANY(channel_ids) OR
         NOT (chosen_candidates @> channel_ids AND chosen_candidates <@ channel_ids))),
      'unregisteredSelection',count(*) FILTER (WHERE
        (channel_id IS NOT NULL AND NOT channel_id=ANY(channel_ids)) OR
        (provision_channel IS NOT NULL AND NOT provision_channel=ANY(channel_ids)))) FROM retained),
    'channels', (SELECT count(*) FROM channels),
    'invitations', (SELECT jsonb_build_object('pending',count(*) FILTER (WHERE status='pending'),
      'active',count(*) FILTER (WHERE status='active')) FROM invitations),
    'pendingLifecycle', (SELECT count(*) FROM lifecycle),
    'deliveries', (SELECT jsonb_build_object('ready',count(*) FILTER (WHERE status='ready'),
      'leased',count(*) FILTER (WHERE status='leased'), 'parked',count(*) FILTER (WHERE status='parked')) FROM deliveries),
    'casePolicy', (SELECT policy FROM case_policies ORDER BY version DESC LIMIT 1),
    'capabilityPolicy', (SELECT policy FROM capability_policies ORDER BY version DESC LIMIT 1),
    'fingerprints', jsonb_build_object(${Object.keys(sources).map(name => `'${name}', (SELECT encode(sha256(convert_to(
      COALESCE(string_agg(to_jsonb(s)::text, E'\\n' ORDER BY to_jsonb(s)::text COLLATE "C"),''), 'UTF8')), 'hex') FROM ${name} s)`).join(',')})
  ) AS snapshot`;

/** Advisory preparation, never an activation permit or a proof of Discord ACLs. */
export async function reviewPermissionDeployment(client, { guildId, running, candidate, binding }) {
  const snapshot = (await client.query(sql, [guildId, running.casePolicy.version])).rows[0].snapshot;
  const casePolicyChanged = permissionDigest(running.casePolicy) !== permissionDigest(candidate.casePolicy);
  const blockers = [];
  const block = (condition, code) => { if (condition) blockers.push(code); };
  block(snapshot.casePolicy && permissionDigest(snapshot.casePolicy) !== permissionDigest(running.casePolicy), 'registered-case-policy-changed');
  block(snapshot.capabilityPolicy && permissionDigest(snapshot.capabilityPolicy) !== permissionDigest(running.capabilityPolicy), 'registered-capability-policy-changed');
  block(snapshot.cases.policyMismatch, 'retained-case-policy-mismatch');
  block(snapshot.cases.unlocated, 'created-channels-not-located');
  block(snapshot.cases.unresolvedSelection || snapshot.cases.unregisteredSelection, 'channel-selection-unresolved');
  block(snapshot.cases.transitioning || snapshot.pendingLifecycle, 'case-transitions-pending');
  block(snapshot.invitations.pending, 'invitations-pending');
  block(Object.values(snapshot.deliveries).some(count => count > 0), 'deliveries-unsettled');
  const inventory = { cases: snapshot.cases, channels: snapshot.channels, invitations: snapshot.invitations,
    pendingLifecycle: snapshot.pendingLifecycle, deliveries: snapshot.deliveries };
  return { schemaVersion: 1, activation: 'deployment-required', canActivate: false, casePolicyChanged, inventory, blockers,
    requirements: ['durable-activation-procedure', 'exclusive-writer-fence', 'forward-version-rollback',
      ...(snapshot.cases.total ? ['current-discord-channel-inventory'] : []),
      ...(casePolicyChanged && snapshot.cases.total ? ['seal-and-reconcile-retained-channels'] : [])],
    reviewHash: permissionDigest({ schemaVersion: 1, guildId, running, candidate, binding, snapshot }) };
}
