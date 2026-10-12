import test from 'node:test';
import assert from 'node:assert/strict';
import { createAiObservations } from '../apps/core/discord/ai-observations.js';
import { createAiGateway } from '../apps/core/discord/ai-gateway.js';
import { createAiIngress } from '../apps/core/discord/ai-ingress.js';
import { PERMISSIONS } from '../platform/authorization/discord-permissions.js';

function fixture() {
  let now = 1000, stamp = 'live.1', excluded = false, automation = false, reads = 0;
  const bits = String(PERMISSIONS.viewChannel | PERMISSIONS.sendMessages | PERMISSIONS.readHistory | PERMISSIONS.addReactions);
  const members = { '505': { user: { id: '505', bot: true }, roles: [] }, '404': { user: { id: '404', bot: false }, roles: [] } };
  const channel = { id: '202', guild_id: '101', type: 0, parent_id: '606', permission_overwrites: [] };
  const roles = [{ id: '101', permissions: bits, position: 0 }], source = { id: '303', channelId: '202', authorId: '404', type: 0, revision: 'original', bot: false, webhook: false };
  const transport = { getChannel: async () => { reads++; return structuredClone(channel); }, getGuild: async () => ({ id: '101', owner_id: '808' }), getRoles: async () => structuredClone(roles),
    getMember: async id => structuredClone(members[id] ?? null), getAiSourceMetadata: async () => structuredClone(source), getAutomationSource: async () => ({ ...source, reactions: [] }) };
  const observed = [], pool = { query: async sql => ({ rowCount: (sql.includes('automation_deliveries') ? automation : excluded) ? 1 : 0 }) };
  const authorityStore = { registerPolicy: async () => {}, observeWithPresence: async observation => { observed.push(observation); return { presenceEpoch: 1, grant: { capabilityEpoch: 3 } }; } };
  const observations = createAiObservations({ pool, transport, authorityStore,
    mapping: { guildId: '101', botUserId: '505', muzzled: '909' }, protectedCategoryId: '707', capabilityPolicy: { version: 1 },
    observer: { readAiContinuity: async () => stamp }, clock: () => now });
  return { observations, transport, members, channel, source, roles, observed, pool, authorityStore, event: { guildId: '101', channelId: '202', userId: '404', messageId: '303' },
    exclude: () => { excluded = true; }, automate: () => { automation = true; }, reads: () => reads, time: value => { now = value; }, invalidate: () => { stamp += '.2'; } };
}

test('DS-09 deterministic automation admission takes precedence before AI source access', async () => {
  const f = fixture(); f.automate(); f.transport.getAiSourceMetadata = async () => assert.fail('automation owns this source');
  assert.equal(await f.observations.inspectContext(f.event), null);
});

test('SAI AT-02 real observation adapter excludes registered cases before Discord message access', async () => {
  const f = fixture(); f.exclude(); assert.equal(await f.observations.inspectContext(f.event), null); assert.equal(f.reads(), 0);
  const moved = fixture(); moved.channel.parent_id = '707'; moved.transport.getAiSourceMetadata = async () => assert.fail('case source must not be fetched');
  assert.equal(await moved.observations.inspectContext(moved.event), null);
});

test('SAI AT-03 observations bind actual permissions, source revision and retained member presence', async () => {
  const f = fixture(), context = await f.observations.inspectContext(f.event), member = await f.observations.inspectMember(f.event);
  assert.equal(context.restricted, false); assert.equal(context.canReply, true); assert.equal(member.presenceEpoch, 1); assert.equal(member.accessEpoch, 3);
  assert.equal(await f.observations.inspectMember(f.event), null);
  f.roles[0].permissions = String(PERMISSIONS.viewChannel | PERMISSIONS.readHistory); f.invalidate();
  assert.equal(await f.observations.inspectContext(f.event), null);
  assert.equal(f.observed[0].roleIds.length, 0);
});

test('SAI AT-03 changed audience invalidates cached metadata and unknown/missing source denies', async () => {
  const f = fixture(), first = await f.observations.inspectContext(f.event);
  f.channel.permission_overwrites = [{ id: '999', type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' }]; f.invalidate();
  const second = await f.observations.inspectContext(f.event); assert.notEqual(second.audienceHash, first.audienceHash);
  // A deleted source reaches the runtime as a MESSAGE_DELETE invalidation, which clears cached source metadata.
  f.transport.getAiSourceMetadata = async () => null; f.observations.clear(); assert.equal(await f.observations.inspectContext(f.event), null);
  f.members['404'].communication_disabled_until = new Date(20000).toISOString(); f.invalidate();
  assert.equal(await f.observations.inspectContext(f.event), null);
});

test('SAI RL-01 rechecks reuse source metadata within the cache window and re-read it after clear() or the window', async () => {
  const f = fixture(); let sourceReads = 0; const read = f.transport.getAiSourceMetadata;
  f.transport.getAiSourceMetadata = async (...args) => { sourceReads++; return read(...args); };
  assert.ok(await f.observations.inspectContext(f.event)); assert.ok(await f.observations.inspectContext(f.event)); assert.equal(sourceReads, 1);
  f.observations.clear(); assert.ok(await f.observations.inspectContext(f.event)); assert.equal(sourceReads, 2);
  f.time(3100); assert.ok(await f.observations.inspectContext(f.event)); assert.equal(sourceReads, 3);
  f.source.revision = '2026-10-12T10:00:00Z'; f.observations.clear();
  assert.equal((await f.observations.inspectContext(f.event)).messageRevision, '2026-10-12T10:00:00Z');
});

test('SAI RL-02 short Discord cooldowns are waited out; long ones are reported by route class and refused', async () => {
  const waits = [], traces = [];
  const f = fixture(); let limited = 2; const read = f.transport.getMember;
  f.transport.getMember = async id => { if (id === '404' && limited-- > 0) throw Object.assign(Error('RATE_LIMITED'), { code: 'RATE_LIMITED', retryAfterMs: 800 }); return read(id); };
  const observations = createAiObservations({ pool: f.pool, transport: f.transport, authorityStore: f.authorityStore,
    mapping: { guildId: '101', botUserId: '505', muzzled: '909' }, protectedCategoryId: '707', capabilityPolicy: { version: 1 },
    observer: { readAiContinuity: async () => 'live.1' }, clock: () => 1000, trace: code => traces.push(code), wait: async ms => { waits.push(ms); } });
  assert.ok(await observations.inspectContext(f.event)); assert.deepEqual(waits, [800, 800]); assert.deepEqual(traces, []);
  f.transport.getMember = async () => { throw Object.assign(Error('RATE_LIMITED'), { code: 'RATE_LIMITED', retryAfterMs: 5000 }); };
  observations.clear();
  await assert.rejects(observations.inspectContext(f.event), error => error.code === 'RATE_LIMITED');
  assert.deepEqual(traces, ['AI_OBSERVATION_LIMITED_BOT_RATE_LIMITED_5000MS']);
});

test('SAI RL-03 member observations carry the Discord join time of the current membership', async () => {
  const f = fixture(); f.members['404'].joined_at = '2026-10-01T12:00:00.000Z';
  assert.ok(await f.observations.inspectContext(f.event));
  assert.equal((await f.observations.inspectMember(f.event)).joinedAt, Date.parse('2026-10-01T12:00:00.000Z'));
  const missing = fixture(); assert.ok(await missing.observations.inspectContext(missing.event));
  assert.equal((await missing.observations.inspectMember(missing.event)).joinedAt, null);
});

test('SAI AT-05 a private channel with individual bot and member grants remains restricted', async () => {
  const f = fixture();
  f.channel.permission_overwrites = [
    { id: '101', type: 0, allow: '0', deny: String(PERMISSIONS.viewChannel) },
    ...['505','404'].map(id => ({ id, type: 1, allow: String(PERMISSIONS.viewChannel), deny: '0' })),
  ];
  const observed = await f.observations.inspectContext(f.event);
  assert.equal(observed.eligible,true); assert.equal(observed.restricted,true);
});

test('DS-08 invalidation fences in-flight metadata and one-use member observations', async () => {
  const f = fixture(), original = f.transport.getChannel;
  let release, started;
  const reading = new Promise(resolve => { started = resolve; });
  f.transport.getChannel = async () => {
    const saved = await original(); started(); await new Promise(resolve => { release = resolve; }); return saved;
  };
  const pending = f.observations.inspectContext(f.event); await reading;
  f.observations.clear(); f.channel.parent_id = '707'; release();
  assert.equal(await pending, null);
  f.transport.getChannel = original;
  assert.equal(await f.observations.inspectContext(f.event), null); assert.equal(f.reads(), 2);
  const member = fixture(); assert.ok(await member.observations.inspectContext(member.event));
  member.observations.clear(); assert.equal(await member.observations.inspectMember(member.event), null);
});

test('SAI AT-02 exclusions registered during authority or automation checks deny source access', async () => {
  for (const phase of ['authority', 'automation']) {
    const f = fixture(); f.transport.getAiSourceMetadata = async () => assert.fail('newly excluded source must not be fetched');
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

test('SAI AT-02 exclusion during source or emoji lookup denies context and reactions', async () => {
  const f = fixture(); f.transport.getAiSourceMetadata = async () => { f.exclude(); return f.source; };
  assert.equal(await f.observations.inspectContext(f.event), null); assert.equal(await f.observations.inspectMember(f.event), null);
  const reaction = fixture(); reaction.transport.getAutomationEmoji = async () => { reaction.exclude(); return { id: '808', name: 'wave', roles: [] }; };
  reaction.transport.getAutomationSource = async () => assert.fail('newly excluded source must not be fetched');
  assert.equal(await reaction.observations.canReact(reaction.event, { id: '808', name: 'wave' }), false);
  const late = fixture(); late.transport.getAutomationSource = async () => { late.exclude(); return { ...late.source, reactions: [] }; };
  assert.equal(await late.observations.canReact(late.event, { id: null, name: 'wave' }), false);
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
