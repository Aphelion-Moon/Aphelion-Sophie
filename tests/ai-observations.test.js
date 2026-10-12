import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiObservations } from '../apps/core/discord/ai-observations.js';
import { createAiGateway } from '../apps/core/discord/ai-gateway.js';
import { createAiIngress } from '../apps/core/discord/ai-ingress.js';
import { createGuildState } from '../apps/core/discord/guild-state.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';

const bits = String(PERMISSIONS.viewChannel | PERMISSIONS.sendMessages | PERMISSIONS.readHistory | PERMISSIONS.addReactions);
function fixture({ members = [{ user: { id: '505', bot: true }, roles: [] }] } = {}) {
  let now = 1000, stamp = 'live.1', excluded = false, automation = false, restReads = 0, sequence = 0;
  const guildState = createGuildState({ guildId: '101', botUserId: '505' });
  const dispatch = (t, d) => guildState.accept({ op: 0, t, s: ++sequence, d });
  dispatch('READY', {});
  dispatch('GUILD_CREATE', { id: '101', owner_id: '808', roles: [{ id: '101', permissions: bits, position: 0 }],
    channels: [{ id: '202', type: 0, parent_id: '606', permission_overwrites: [] }], members, emojis: [{ id: '808', name: 'wave', roles: [] }] });
  const message = (id = '303', userId = '404', member = { roles: [] }) => dispatch('MESSAGE_CREATE', { guild_id: '101', channel_id: '202', id, author: { id: userId, bot: false }, type: 0, ...(member ? { member } : {}) });
  message();
  const transport = { getMember: async id => { restReads++; return id === '505' ? { user: { id: '505', bot: true }, roles: [] } : null; } };
  const observed = [], pool = { query: async sql => ({ rowCount: (sql.includes('automation_deliveries') ? automation : excluded) ? 1 : 0 }) };
  const authorityStore = { registerPolicy: async () => {}, observeWithPresence: async observation => { observed.push(observation); return { presenceEpoch: 1, grant: { capabilityEpoch: 3 } }; } };
  const options = { pool, transport, guildState, authorityStore, mapping: { guildId: '101', botUserId: '505', muzzled: '909' }, protectedCategoryId: '707',
    capabilityPolicy: { version: 1 }, observer: { readAiContinuity: async () => stamp }, clock: () => now };
  return { observations: createAiObservations(options), options, guildState, transport, observed, pool, authorityStore, dispatch, message,
    event: { guildId: '101', channelId: '202', userId: '404', messageId: '303' },
    exclude: () => { excluded = true; }, automate: () => { automation = true; }, restReads: () => restReads, time: value => { now = value; }, disconnect: () => { stamp = null; } };
}
const channel = (change = {}) => ({ guild_id: '101', id: '202', type: 0, parent_id: '606', permission_overwrites: [], ...change });

test('DS-09 deterministic automation admission takes precedence before AI source access', async () => {
  const f = fixture(); f.automate(); assert.equal(await f.observations.inspectContext(f.event), null);
});

test('SAI AT-02 real observation adapter excludes registered cases before any Discord access', async () => {
  const f = fixture(); f.exclude(); assert.equal(await f.observations.inspectContext(f.event), null); assert.equal(f.restReads(), 0);
  const moved = fixture(); moved.dispatch('CHANNEL_UPDATE', channel({ parent_id: '707' }));
  assert.equal(await moved.observations.inspectContext(moved.event), null);
});

test('SAI AT-03 observations bind actual permissions, source revision and retained member presence', async () => {
  const f = fixture(), context = await f.observations.inspectContext(f.event), member = await f.observations.inspectMember(f.event);
  assert.equal(context.restricted, false); assert.equal(context.canReply, true); assert.equal(member.presenceEpoch, 1); assert.equal(member.accessEpoch, 3);
  assert.equal(await f.observations.inspectMember(f.event), null);
  f.dispatch('GUILD_ROLE_UPDATE', { guild_id: '101', role: { id: '101', permissions: String(PERMISSIONS.viewChannel | PERMISSIONS.readHistory), position: 0 } });
  assert.equal(await f.observations.inspectContext(f.event), null);
  assert.equal(f.observed[0].roleIds.length, 0);
});

test('SAI AT-03 Gateway changes to audience, source and timeout take effect on the next observation', async () => {
  const f = fixture(), first = await f.observations.inspectContext(f.event);
  f.dispatch('CHANNEL_UPDATE', channel({ permission_overwrites: [{ id: '999', type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' }] }));
  const second = await f.observations.inspectContext(f.event); assert.notEqual(second.audienceHash, first.audienceHash);
  f.dispatch('GUILD_MEMBER_UPDATE', { guild_id: '101', user: { id: '404', bot: false }, roles: [], communication_disabled_until: new Date(20000).toISOString() });
  assert.equal(await f.observations.inspectContext(f.event), null);
  const deleted = fixture(); deleted.dispatch('MESSAGE_DELETE', { guild_id: '101', channel_id: '202', id: '303' });
  assert.equal(await deleted.observations.inspectContext(deleted.event), null);
  const unknown = fixture(); assert.equal(await unknown.observations.inspectContext({ ...unknown.event, messageId: '398' }), null);
});

test('SAI RL-01 known members and messages need no Discord REST read; edits update the revision', async () => {
  const f = fixture();
  for (let index = 0; index < 20; index++) assert.ok(await f.observations.inspectContext(f.event));
  assert.equal(f.restReads(), 0);
  f.dispatch('MESSAGE_UPDATE', { guild_id: '101', channel_id: '202', id: '303', edited_timestamp: '2026-10-12T10:00:00Z' });
  assert.equal((await f.observations.inspectContext(f.event)).messageRevision, '2026-10-12T10:00:00Z');
});

test('SAI RL-02 an unknown member is read once; short cooldowns are waited out and long ones refused by route class', async () => {
  const waits = [], traces = [], f = fixture({ members: [] });
  let limited = 2; f.message('320', '410', null);
  f.transport.getMember = async id => {
    if (id === '410' && limited-- > 0) throw Object.assign(Error('RATE_LIMITED'), { code: 'RATE_LIMITED', retryAfterMs: 800 });
    return { user: { id, bot: id === '505' }, roles: [] };
  };
  const observations = createAiObservations({ ...f.options, trace: code => traces.push(code), wait: async ms => { waits.push(ms); } });
  const event = { ...f.event, userId: '410', messageId: '320' };
  assert.ok(await observations.inspectContext(event)); assert.deepEqual(waits, [800, 800]); assert.deepEqual(traces, []);
  f.transport.getMember = async () => assert.fail('a member described once is kept current by Gateway events');
  assert.ok(await observations.inspectContext(event));
  const other = fixture(); other.message('321', '411', null);
  const limitedObservations = createAiObservations({ ...other.options, transport: { getMember: async () => { throw Object.assign(Error('RATE_LIMITED'), { code: 'RATE_LIMITED', retryAfterMs: 5000 }); } }, trace: code => traces.push(code) });
  await assert.rejects(limitedObservations.inspectContext({ ...other.event, userId: '411', messageId: '321' }), error => error.code === 'RATE_LIMITED');
  assert.deepEqual(traces, ['AI_OBSERVATION_LIMITED_MEMBER_RATE_LIMITED_5000MS']);
});

test('SAI RL-03 member observations carry the Discord join time of the current membership', async () => {
  const f = fixture(); f.message('304', '404', { roles: [], joined_at: '2026-10-01T12:00:00.000Z' });
  assert.ok(await f.observations.inspectContext(f.event));
  assert.equal((await f.observations.inspectMember(f.event)).joinedAt, Date.parse('2026-10-01T12:00:00.000Z'));
  const missing = fixture(); assert.ok(await missing.observations.inspectContext(missing.event));
  assert.equal((await missing.observations.inspectMember(missing.event)).joinedAt, null);
});

test('SAI RL-04 an unrelated member\'s change leaves this member\'s binding unchanged', async () => {
  const f = fixture(), before = await f.observations.inspectContext(f.event), member = await f.observations.inspectMember(f.event);
  f.dispatch('GUILD_MEMBER_UPDATE', { guild_id: '101', user: { id: '450', bot: false }, roles: ['101'], nick: 'Someone else' });
  const after = await f.observations.inspectContext(f.event), again = await f.observations.inspectMember(f.event);
  assert.equal(after.audienceHash, before.audienceHash); assert.equal(after.continuity, before.continuity); assert.equal(again.memberHash, member.memberHash);
  f.dispatch('GUILD_MEMBER_UPDATE', { guild_id: '101', user: { id: '404', bot: false }, roles: ['101'] });
  await f.observations.inspectContext(f.event); assert.notEqual((await f.observations.inspectMember(f.event)).memberHash, member.memberHash);
});

test('SAI AT-05 a private channel with individual bot and member grants remains restricted', async () => {
  const f = fixture();
  f.dispatch('CHANNEL_UPDATE', channel({ permission_overwrites: [
    { id: '101', type: 0, allow: '0', deny: String(PERMISSIONS.viewChannel) },
    ...['505','404'].map(id => ({ id, type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' })),
  ] }));
  const observed = await f.observations.inspectContext(f.event);
  assert.equal(observed.eligible,true); assert.equal(observed.restricted,true);
});

test('DS-08 a new Gateway session, a disconnect or clear() fences observations', async () => {
  const f = fixture(), observe = f.authorityStore.observeWithPresence;
  f.authorityStore.observeWithPresence = async (...args) => { const result = await observe(...args); f.dispatch('READY', {}); return result; };
  assert.equal(await f.observations.inspectContext(f.event), null);
  assert.equal(await f.observations.inspectContext(f.event), null, 'nothing is observed before the next GUILD_CREATE');
  const offline = fixture(); offline.disconnect(); assert.equal(await offline.observations.inspectContext(offline.event), null);
  const member = fixture(); assert.ok(await member.observations.inspectContext(member.event));
  member.observations.clear(); assert.equal(await member.observations.inspectMember(member.event), null);
});

test('SAI AT-02 exclusions registered during authority or automation checks deny source access', async () => {
  for (const phase of ['authority', 'automation']) {
    const f = fixture();
    if (phase === 'authority') {
      const observe = f.authorityStore.observeWithPresence;
      f.authorityStore.observeWithPresence = async (...args) => { const result = await observe(...args); f.exclude(); return result; };
    } else {
      const query = f.pool.query;
      f.pool.query = async sql => { const result = await query(sql); if (sql.includes('automation_deliveries')) f.exclude(); return result; };
    }
    assert.equal(await f.observations.inspectContext(f.event), null, phase);
    assert.equal(await f.observations.inspectMember(f.event), null);
  }
});

test('SAI AT-02 reactions need a current source, an available emoji and no new exclusion', async () => {
  const f = fixture();
  assert.equal(await f.observations.canReact(f.event, { id: '808', name: 'wave' }), true);
  assert.equal(await f.observations.canReact(f.event, { id: '809', name: 'wave' }), false);
  assert.equal(await f.observations.canReact({ ...f.event, messageId: '398' }, { id: null, name: 'wave' }), false);
  const observe = f.authorityStore.observeWithPresence;
  f.authorityStore.observeWithPresence = async (...args) => { const result = await observe(...args); f.exclude(); return result; };
  assert.equal(await f.observations.canReact(f.event, { id: null, name: 'wave' }), false);
});

test('SAI AT-07 Gateway handoff is bounded, commit-dependent and detached from slow AI', async () => {
  let release; const held = new Promise(resolve => { release = resolve; }), seen = [], invalidations = [];
  const ingress = createAiIngress({ guildId: '101', botUserId: '505', clock: () => 1000 });
  const turns = { handle: async proof => { seen.push(ingress.inspect(proof)); await held; }, invalidate: filter => invalidations.push(filter), stop: async () => {} };
  const bridge = createAiGateway({ ingress, turns, onFault: () => assert.fail('unexpected fault') });
  const packet = id => ({ t: 'MESSAGE_CREATE', d: { guild_id: '101', id, channel_id: '202', author: { id: '404' }, type: 0 } });
  const rejected = bridge.prepare(packet('300')); bridge.committed(rejected, false);
  const accepted = ['301','302','303','304'].map(id => bridge.prepare(packet(id)));
  assert.equal(bridge.prepare(packet('305')), null); accepted.forEach(proof => bridge.committed(proof, true));
  await new Promise(resolve => setImmediate(resolve)); assert.equal(seen.length, 4);
  bridge.prepare({ t: 'MESSAGE_DELETE', d: { guild_id: '101', channel_id: '202', id: '301' } });
  assert.deepEqual(invalidations.at(-1), { channelId: '202', messageId: '301' });
  release(); await bridge.stop(); assert.equal(bridge.prepare(packet('306')), null);
});

test('DS06-E02 only a complete committed edit reaches replacement; rejected or partial edits cancel',async()=>{
  const ingress=createAiIngress({guildId:'101',botUserId:'505',clock:()=>1000}),invalidations=[],seen=[];
  const turns={prepareEdit:()=>true,edit:async proof=>seen.push(ingress.content(proof)),handle:()=>assert.fail('edits cannot become new turns'),
    invalidate:filter=>invalidations.push(filter),stop:async()=>{}};
  const bridge=createAiGateway({ingress,turns,onFault:()=>assert.fail('unexpected fault')});
  const packet={t:'MESSAGE_UPDATE',d:{guild_id:'101',id:'303',channel_id:'202',author:{id:'404'},type:0,
    attachments:[],mentions:[],edited_timestamp:'2026-09-28T12:00:00Z',content:'Revised fragment'}};
  const rejected=bridge.prepare(packet);bridge.committed(rejected,false);assert.equal(invalidations.length,1);assert.equal(seen.length,0);
  const accepted=bridge.prepare(packet);bridge.committed(accepted,true);await new Promise(resolve=>setImmediate(resolve));assert.equal(seen[0].text,'Revised fragment');
  const partial={...packet,d:{...packet.d}};delete partial.d.attachments;assert.equal(bridge.prepare(partial),null);assert.equal(invalidations.length,2);
  await bridge.stop();
});

test('RB-03 member and role events cancel nothing, a channel change stops only that channel, a bulk delete names each message', async () => {
  const ingress = createAiIngress({ guildId: '101', botUserId: '505', clock: () => 1000 }), invalidations = [], cancelled = [];
  const bridge = createAiGateway({ ingress, turns: { handle: async () => {}, invalidate: filter => invalidations.push(filter ?? {}), cancelChannel: id => cancelled.push(id), stop: async () => {} }, onFault: () => assert.fail('unexpected fault') });
  for (const t of ['GUILD_MEMBER_UPDATE', 'GUILD_ROLE_UPDATE', 'GUILD_UPDATE']) bridge.prepare({ t, d: { guild_id: '101', id: '101', user: { id: '450' } } });
  bridge.prepare({ t: 'CHANNEL_UPDATE', d: { guild_id: '101', id: '202' } });
  assert.deepEqual(invalidations, []); assert.deepEqual(cancelled, ['202']);
  bridge.prepare({ t: 'MESSAGE_DELETE_BULK', d: { guild_id: '101', channel_id: '202', ids: ['301', '302'] } });
  assert.deepEqual(invalidations, [{ channelId: '202', messageId: '301' }, { channelId: '202', messageId: '302' }]); await bridge.stop();
});
