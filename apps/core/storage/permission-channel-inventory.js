import { requireCondition } from '../../../contracts/validation.js';
import { permissionDigest } from '../runtime/permission-configuration.js';

/** Explicit routing/permission metadata only; no case content or participant records. */
export async function readPermissionCaseBindings(client, guildId) {
  const rows = (await client.query(`SELECT r.id,r.type,r.state,r.version,r.desired_access,r.channel_id,
    p.operation_token,p.policy_version,p.presence_epoch,p.audience_version,p.create_started,p.channel_id AS provision_channel_id,p.chosen_channel_id,p.chosen_candidates,
    ARRAY(SELECT c.channel_id FROM sophie_core.case_channels c WHERE c.guild_id=r.guild_id AND c.case_id=r.id ORDER BY c.channel_id COLLATE "C") AS known_channels
    FROM sophie_core.case_reservations r LEFT JOIN sophie_core.case_provisions p ON p.guild_id=r.guild_id AND p.case_id=r.id
    WHERE r.guild_id=$1 ORDER BY r.id COLLATE "C" LIMIT 10001`, [guildId])).rows;
  requireCondition(rows.length <= 10000, 'PERMISSION_INVENTORY_LIMIT');
  return rows;
}

/** Classifies observations; neither a marker nor a selected first result grants authority. */
export function buildPermissionChannelInventory({ bindings, observed, candidate, runningPolicyVersion }) {
  const blockers = new Map(), block = code => blockers.set(code, (blockers.get(code) ?? 0) + 1);
  const byMarker = new Map(), known = new Map(), references = new Map(), collisions = new Set();
  const cases = bindings.map(row => {
    if (row.operation_token === null) block('case-provision-missing');
    else byMarker.set(`sophie:case:v1:${row.operation_token}`, row);
    if (row.policy_version !== runningPolicyVersion) block('case-policy-mismatch');
    for (const id of row.known_channels) { requireCondition(!known.has(id), 'CASE_CHANNEL_COLLISION'); known.set(id, row); }
    for (const id of [...row.known_channels, row.channel_id, row.provision_channel_id, row.chosen_channel_id].filter(Boolean)) {
      if (references.has(id) && references.get(id).id !== row.id) { collisions.add(id); block('channel-reference-collision'); }
      else references.set(id, row);
    }
    if ([row.channel_id, row.provision_channel_id, row.chosen_channel_id].some(id => id !== null && !row.known_channels.includes(id))) block('channel-reference-unregistered');
    return { caseId: row.id, type: row.type, state: row.state, desiredAccess: row.desired_access,
      version: row.version, policyVersion: row.policy_version, presenceEpoch: row.presence_epoch,
      audienceVersion: row.audience_version, token: row.operation_token, createStarted: row.create_started,
      knownChannelIds: row.known_channels, foundChannelIds: [], missingChannelIds: [], selectedChannelId: null };
  });
  const byCase = new Map(cases.map(row => [row.caseId, row]));
  const channels = [];
  for (const channel of observed.channels) {
    const recorded = known.get(channel.id), reference = references.get(channel.id), marked = byMarker.get(channel.marker);
    if (!reference && !marked && channel.marker === null) continue;
    let classification, owner = reference ?? marked;
    if (collisions.has(channel.id) || reference && (marked?.id !== reference.id || channel.type !== 0)) { classification = 'identity-mismatch'; block('channel-identity-mismatch'); }
    else if (!owner) { classification = 'orphan-marker'; block('orphan-case-marker'); }
    else if (channel.type !== 0 || owner.create_started !== true) { classification = 'identity-mismatch'; block('channel-identity-mismatch'); }
    else {
      classification = recorded ? 'recorded' : 'discovered';
      byCase.get(owner.id).foundChannelIds.push(channel.id);
    }
    channels.push({ ...channel, caseId: owner?.id ?? null, classification });
  }
  const observedIds = new Set(observed.channels.map(row => row.id));
  for (const row of bindings) {
    const entry = byCase.get(row.id), found = entry.foundChannelIds.sort();
    entry.missingChannelIds = row.known_channels.filter(id => !observedIds.has(id));
    if (entry.missingChannelIds.length) block('retained-channel-missing');
    if (row.create_started && found.length === 0) block('created-channels-not-located');
    if (row.chosen_channel_id !== null) {
      if (found.includes(row.chosen_channel_id) && permissionDigest(found) === permissionDigest([...(row.chosen_candidates ?? [])].sort())) entry.selectedChannelId = row.chosen_channel_id;
      else block('channel-choice-stale');
    } else if (found.length === 1 && (row.channel_id === null || row.channel_id === found[0])) entry.selectedChannelId = found[0];
    else if (found.length > 1 || row.channel_id !== null && !found.includes(row.channel_id)) block('channel-choice-required');
  }
  const category = observed.channels.find(row => row.id === candidate.casePolicy.categoryId);
  if (!category || category.type !== 4) block('candidate-category-unavailable');
  const selectedRoles = new Set([candidate.mapping.staff, candidate.mapping.leadOps, ...Object.values(candidate.capabilityPolicy.grants).flat(), ...Object.values(candidate.capabilityPolicy.responders).flat()]);
  for (const id of selectedRoles) if (!observed.roles.some(row => row.id === id && !row.managed)) block('candidate-role-unavailable');
  const summary = { cases: cases.length, recorded: channels.filter(row => row.classification === 'recorded').length,
    discovered: channels.filter(row => row.classification === 'discovered').length,
    missing: cases.reduce((count, row) => count + row.missingChannelIds.length, 0),
    mismatched: channels.filter(row => row.classification === 'identity-mismatch').length,
    orphaned: channels.filter(row => row.classification === 'orphan-marker').length,
    open: cases.filter(row => row.desiredAccess === 'open').length, closed: cases.filter(row => row.desiredAccess === 'closed').length,
    sealed: cases.filter(row => row.desiredAccess === 'sealed').length };
  return { schemaVersion: 1, cases, channels, categories: observed.channels.filter(row => row.type === 4 && row.marker === null),
    roles: observed.roles, summary, blockers: [...blockers].sort(([a], [b]) => a.localeCompare(b)).map(([code, count]) => ({ code, count })) };
}
