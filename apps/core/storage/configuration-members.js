import { requireCondition } from '../../../contracts/validation.js';
import { inTransaction } from './transaction.js';
import { lockMember } from './members.js';
import { requireOwnedRoleChange } from '../../../modules/membership/discord-policy.js';

/** Core-only migration of owned role metadata. No Whitelist restoration branch. */
export function createConfigurationMemberMigration({ pool, operationId, previous, candidate, transport, oldRoles, newRoles, held, authorize, clock }) {
  const guildId = candidate.guildId, changed = ['crew','muzzled','whitelist'].filter(key=>previous[key]!==candidate[key]);
  const guard = async () => { await held(operationId); requireCondition(await authorize(), 'OPERATION_DENIED'); };
  const transaction = work => inTransaction(pool, async client => {
    await client.query('SELECT pg_advisory_xact_lock(182745,47)');
    requireCondition((await client.query('SELECT 1 FROM sophie_control.runtime_gate WHERE singleton AND operation_id=$1', [operationId])).rowCount, 'MAINTENANCE_STALE');
    return work(client);
  });
  const insert = async (client, rows) => {
    for (const row of rows) if (!row.bot && row.userId !== candidate.botUserId) await client.query(`INSERT INTO sophie_control.configuration_members(operation_id,user_id)
      VALUES ($1,$2) ON CONFLICT DO NOTHING`, [operationId,row.userId]);
  };
  async function step(row) {
    await guard();
    const { context, observation } = await oldRoles.prepare(row.user_id);
    if (!observation.present) {
      await transaction(client=>client.query('UPDATE sophie_control.configuration_members SET verified=true,pending_effect=NULL WHERE operation_id=$1 AND user_id=$2', [operationId,row.user_id])); return;
    }
    const ids = context.memberRoleIds;
    if (row.pending_effect !== null) {
      const effect = row.pending_effect;
      requireCondition(changed.some(key=>effect.roleId===previous[key]||effect.roleId===candidate[key]) || [candidate.crew,candidate.muzzled].includes(effect.roleId), 'PERMISSION_RECORD_CORRUPT');
      // A lost response is resolved by observation. Never resend an unobserved effect.
      requireCondition(ids.includes(effect.roleId) === effect.add, 'MEMBERSHIP_MIGRATION_UNCERTAIN');
      await transaction(client=>client.query('UPDATE sophie_control.configuration_members SET pending_effect=NULL WHERE operation_id=$1 AND user_id=$2', [operationId,row.user_id]));
    }
    const mute = await transaction(async client => {
      const member = await lockMember(client,guildId,row.user_id);
      const needed = member.muteRequested || row.requires_mute || ids.includes(previous.muzzled) || ids.includes(candidate.muzzled);
      if (needed) await client.query('UPDATE sophie_control.configuration_members SET requires_mute=true WHERE operation_id=$1 AND user_id=$2', [operationId,row.user_id]);
      return needed;
    });
    let change = null, mapping = candidate, roles = newRoles;
    if (mute && ids.includes(candidate.crew)) change='remove_crew';
    else if (changed.includes('crew') && ids.includes(previous.crew)) { change='remove_crew'; mapping=previous; roles=oldRoles; }
    else if (changed.includes('whitelist') && ids.includes(previous.whitelist)) { change='remove_whitelist'; mapping=previous; roles=oldRoles; }
    else if (changed.includes('whitelist') && ids.includes(candidate.whitelist)) change='remove_whitelist';
    else if (mute && !ids.includes(candidate.muzzled)) change='add_muzzled';
    else if (changed.includes('muzzled') && ids.includes(previous.muzzled)) { change='remove_muzzled'; mapping=previous; roles=oldRoles; }
    else if (!mute && !ids.includes(candidate.crew)) change='add_crew';
    if (change === null) {
      await oldRoles.assertCurrent(context); await guard();
      await transaction(client=>client.query('UPDATE sophie_control.configuration_members SET verified=true WHERE operation_id=$1 AND user_id=$2', [operationId,row.user_id])); return;
    }
    const prepared = await roles.prepare(row.user_id);
    if (!prepared.observation.present) return;
    // Recompute on the next turn if external membership changes raced preparation.
    if (JSON.stringify([...prepared.context.memberRoleIds].sort()) !== JSON.stringify([...ids].sort())) return;
    const effect = requireOwnedRoleChange(prepared.context,mapping,change,clock());
    await guard();
    await transaction(client=>client.query('UPDATE sophie_control.configuration_members SET pending_effect=$3 WHERE operation_id=$1 AND user_id=$2', [operationId,row.user_id,effect]));
    await roles.change(prepared.context,change);
    const confirmed = await roles.prepare(row.user_id);
    requireCondition(!confirmed.observation.present || confirmed.context.memberRoleIds.includes(effect.roleId)===effect.add, 'MEMBERSHIP_MIGRATION_UNCERTAIN');
    await transaction(client=>client.query('UPDATE sophie_control.configuration_members SET pending_effect=NULL WHERE operation_id=$1 AND user_id=$2', [operationId,row.user_id]));
  }
  return Object.freeze({
    async runOnce() {
      await guard();
      const state = (await pool.query('SELECT member_cursor,member_scan_complete FROM sophie_control.configuration_applications WHERE operation_id=$1', [operationId])).rows[0];
      if (!state.member_scan_complete) {
        const page = await transport.getMemberPage(state.member_cursor);
        const ids = page.map(row=>row.userId);
        requireCondition(new Set(ids).size===ids.length && ids.every((id,i)=>BigInt(id)>BigInt(i?ids[i-1]:state.member_cursor??'0')), 'MEMBER_INVENTORY_INVALID');
        await transaction(async client => {
          await insert(client,page);
          await client.query('UPDATE sophie_control.configuration_applications SET member_cursor=$2,member_scan_complete=$3 WHERE operation_id=$1', [operationId,ids.at(-1)??state.member_cursor,page.length<100]);
        });
        return { state:'progressed' };
      }
      const row = (await pool.query('SELECT * FROM sophie_control.configuration_members WHERE operation_id=$1 AND NOT verified ORDER BY user_id COLLATE "C" LIMIT 1', [operationId])).rows[0];
      if (row) { await step(row); return { state:'progressed' }; }
      return { state:'complete' };
    },
    async verify() {
      await guard(); if (!changed.length) return true;
      let after=null, pages=0;
      do {
        requireCondition(++pages<=10000,'MEMBER_INVENTORY_LIMIT');
        const page=await transport.getMemberPage(after);
        requireCondition(page.every((row,i)=>BigInt(row.userId)>BigInt(i?page[i-1].userId:after??'0')), 'MEMBER_INVENTORY_INVALID');
        const retained=(await pool.query('SELECT user_id,requires_mute FROM sophie_control.configuration_members WHERE operation_id=$1 AND user_id=ANY($2::text[])',[operationId,page.map(row=>row.userId)])).rows;
        const restrictions=new Map(retained.map(row=>[row.user_id,row.requires_mute]));
        const stale=page.filter(row=>{
          if(row.bot||row.userId===candidate.botUserId)return false;
          const muted=restrictions.get(row.userId)||row.roleIds.includes(candidate.muzzled)||row.roleIds.includes(previous.muzzled);
          return !restrictions.has(row.userId)||changed.some(key=>row.roleIds.includes(previous[key]))||
            (changed.includes('whitelist')&&row.roleIds.includes(candidate.whitelist))||
            (muted?(!row.roleIds.includes(candidate.muzzled)||row.roleIds.includes(candidate.crew)):!row.roleIds.includes(candidate.crew));
        });
        if(stale.length){await transaction(async client=>{await insert(client,stale);for(const row of stale)await client.query('UPDATE sophie_control.configuration_members SET verified=false WHERE operation_id=$1 AND user_id=$2',[operationId,row.userId]);});return false;}
        if(page.length<100)return true;after=page.at(-1).userId;
      }while(true);
    },
  });
}
