import assert from 'node:assert/strict';
import { request } from 'node:http';
import { createStagingRuntime } from '../../apps/core/runtime/staging.js';
import { checkRuntimeDatabase } from '../../apps/core/runtime/database.js';
import { onboardingWorkflow } from '../../tests/fixtures/onboarding-workflow.js';
import { syntheticInteractions } from '../../tests/fixtures/interactions.js';
import { stagingConfiguration } from '../../tests/fixtures/staging.js';
import { createLoopbackGateway, waitForGateway } from '../../tests/fixtures/gateway-server.js';
import { discoveryResponse, SYNTHETIC_GATEWAY_TOKEN } from '../../tests/fixtures/gateway-supervisor.js';
import { gatewayEvent, readyEvent, guildEvent } from '../../tests/fixtures/gateway.js';
import { simulatedOAuth, syntheticClientSecret } from '../../tests/fixtures/oauth.js';
import { dashboardHttp, dashboardBytes } from '../../tests/fixtures/dashboard-http.js';
import { GUILD, USER, OTHER, LEAD, STAFF } from '../../tests/fixtures/domain.js';
import { CREW, MUZZLED, WHITELIST } from '../../tests/fixtures/discord.js';
import { DASHBOARD_COOKIES } from '../../contracts/dashboard-auth.js';
import { automationDocument, automationEvent, PUBLIC_CHANNEL, SECOND_CHANNEL } from '../../tests/fixtures/automation.js';

async function signedHttp(address, signed) {
  return new Promise((resolve, reject) => {
    const req = request({ ...address, path: '/discord/interactions', method: 'POST', headers: { 'content-type': 'application/json',
      'x-signature-ed25519': signed.signature, 'x-signature-timestamp': signed.timestamp } }, response => {
      const chunks = []; response.on('data', chunk => chunks.push(chunk)); response.on('end', () => resolve({ status: response.statusCode, body: JSON.parse(Buffer.concat(chunks)) }));
    }); req.on('error', reject); req.end(signed.body);
  });
}
export async function runStagingRuntimeSuite(cluster, run) {
  async function fixture({ dashboard = true, automaticWorkers = false, ready = true, answers = false, automation = false, automationIngress = false, unavailableAi = false, knowledgeOnly = false } = {}) {
    const f = await onboardingWorkflow(cluster, { extraCapabilities: { 'case.forms.publish': [LEAD],
      'member.mute': [STAFF, LEAD], 'member.unmute': [STAFF, LEAD], ...(answers ? { 'answers.publish': [STAFF] } : {}), ...(automation ? { 'automation.publish': [STAFF] } : {}) } });
    const clock = () => f.clock.now, identities = syntheticInteractions({ clock }), oauth = simulatedOAuth(), replies = [], faults = [];
    const config = stagingConfiguration(identities.publicKeyHex); if (!dashboard) config.dashboard = null;
    if (answers) config.capabilityPolicy.grants['answers.publish'] = [STAFF];
    if (automation) config.capabilityPolicy.grants['automation.publish'] = [STAFF];
    if (automationIngress) config.automationEnabled = true;
    const peer = await createLoopbackGateway({ onPacket(packet, connection) {
      if (packet.op === 2 && ready) { connection.send(readyEvent()); connection.send(guildEvent()); }
      if (packet.op === 6 && ready) connection.send(gatewayEvent(packet.sequence + 1, 'RESUMED', {}));
    } });
    const fetch = async (url, options) => {
      if (url.endsWith('/gateway/bot')) return Response.json(discoveryResponse());
      if (url.endsWith('/oauth2/token') || options.headers.Authorization?.startsWith('Bearer ')) return oauth.fetch(url, options);
      if (url.includes('/webhooks/')) { replies.push(JSON.parse(options.body)); return new Response(null, { status: 200 }); }
      return f.discord.fetch(url, options);
    };
    const ai = unavailableAi ? { aiControlPool: { query: async () => { throw Error('synthetic control outage'); }, connect: async () => { throw Error('synthetic control outage'); } },
      aiWorker: { current: async () => assert.fail('unavailable control store must prevent worker qualification'), generate: async () => assert.fail('no AI ingestion') },
      aiKnowledge: { lookup: async () => assert.fail('no knowledge ingestion'), current: async () => assert.fail('no knowledge ingestion'), currentReferences: async () => assert.fail('no knowledge ingestion') } } :
      knowledgeOnly ? { aiKnowledge: { lookup: async query => { assert.equal(query, 'synthetic topic'); return []; }, current: async () => true } } : {};
    const createHost = () => createStagingRuntime({ configuration: config, pool: f.pool, ...ai, token: SYNTHETIC_GATEWAY_TOKEN,
      clientSecret: syntheticClientSecret, fetch, connect: peer.connect, clock, random: () => 0.25, onFault: value => faults.push(value) });
    let runtime = await createHost();
    assert.equal(peer.connections.length, 0);
    let addresses = await runtime.start({ automaticWorkers, ephemeralPorts: true });
    if (ready) await waitForGateway(async () => (await runtime.status()).current);
    const send = async payload => {
      const before = replies.length;
      const ack = await signedHttp(addresses.interactions, identities.signed(payload));
      if (ack.body.type === 5) await waitForGateway(async () => {
        if (payload.data?.name === 'whitelist' && payload.data.options?.[0]?.name === 'start') await runtime.runOnce();
        return replies.length > before;
      });
      return ack;
    };
    return { ...f, config, get runtime() { return runtime; }, get addresses() { return addresses; }, identities, oauth, replies, faults, peer, send,
      async restart() { runtime = await createHost(); addresses = await runtime.start({ automaticWorkers, ephemeralPorts: true });
        await waitForGateway(async () => (await runtime.status()).current); },
      async close() { await runtime.stop(); await peer.stop(); } };
  }
  const scenario = (name, work, options) => run(name, async () => { const f = await fixture(options); try { await work(f); } finally { await f.close(); } });
  await run('RT01 runtime database privileges reject the owner and accept the restricted core identity', async () => {
    await cluster.adminPool.query('GRANT USAGE ON SCHEMA sophie_migrations TO sophie_test_core');
    await cluster.adminPool.query('GRANT SELECT ON sophie_migrations.applied TO sophie_test_core');
    const result = await checkRuntimeDatabase(cluster.corePool); assert.ok(result.checkedTables > 0); assert.equal(result.migrations, 60);
    await assert.rejects(checkRuntimeDatabase(cluster.adminPool), /RUNTIME_DATABASE_PRIVILEGES_INVALID/);
    const client = await cluster.adminPool.connect(); await client.query('BEGIN');
    try {
      await client.query("UPDATE sophie_migrations.applied SET sha256 = 'invalid' WHERE id = '030-case-attachments.sql'");
      // The changed metadata is deliberately read on the same transaction connection.
      const { verifyCoreMigrations } = await import('../../apps/core/storage/migrate.js');
      await assert.rejects(verifyCoreMigrations(client), /MIGRATION_CHECKSUM_MISMATCH/);
    } finally { await client.query('ROLLBACK'); client.release(); }
  });
  await scenario('RT02 startup accepts signed ping but suppresses commands before Gateway readiness', async f => {
    const ping = await f.send({ application_id: f.config.applicationId, type: 1 }); assert.deepEqual(ping.body, { type: 1 });
    const response = await f.send(f.identities.payload()); assert.equal(response.body.type, 4);
    assert.equal(response.body.data.content, 'Sophie commands are currently disabled.');
    assert.equal(f.discord.state.calls.some(call => call.method !== 'GET'), false);
  }, { ready: false, dashboard: false });
  await scenario('RT03 combined signed moderation and membership workers apply Muzzled then reconcile Crew', async f => {
    const response = await f.send(f.identities.payload()); assert.equal(response.body.type, 5);
    for (let index = 0; index < 4; index++) await f.runtime.runOnce();
    assert.ok(f.discord.state.members.get(USER).includes(MUZZLED)); assert.equal(f.discord.state.members.get(USER).includes(CREW), false);
    await f.send(f.identities.payload({ data: { type: 1, name: 'unmute', options: [{ name: 'member', type: 6, value: USER }] } }));
    for (let index = 0; index < 4; index++) await f.runtime.runOnce();
    assert.equal(f.discord.state.members.get(USER).includes(MUZZLED), false); assert.ok(f.discord.state.members.get(USER).includes(CREW));
    assert.deepEqual(f.faults, []);
  });
  await scenario('RT04 combined private ticket request provisions a channel and captures synthetic observations', async f => {
    const response = await f.send(f.identities.payload({ member: { user: { id: USER } }, data: { type: 1, name: 'ticket',
      options: [{ type: 1, name: 'open', options: [{ type: 3, name: 'type', value: 'quick-help' }] }] } })); assert.equal(response.body.type, 5);
    const customId = f.replies.at(-1).components[0].components[0].custom_id;
    for (let index = 0; index < 5; index++) await f.runtime.runOnce();
    const row = (await f.rows('case_reservations')).find(item => item.type === 'quick-help'); assert.equal(row.state, 'open');
    const direct = (await f.rows('case_direct_notices'))[0]; assert.equal(direct.state, 'sent');
    assert.equal(f.discord.state.messages.get(direct.message_id).content.includes(`/channels/${GUILD}/${row.channel_id}`), true);
    f.peer.connections[0].send(gatewayEvent(3, 'MESSAGE_CREATE', { guild_id: GUILD, channel_id: row.channel_id, id: '731',
      author: { id: USER, username: 'Synthetic user' }, content: 'Synthetic runtime observation', timestamp: new Date(f.clock.now).toISOString(), attachments: [], embeds: [] }));
    await waitForGateway(async () => (await f.rows('case_message_observations')).length === 1);
    const checkTicket = () => f.send(f.identities.payload({ type: 3, member: { user: { id: USER } }, message: { id: OTHER },
      data: { component_type: 2, custom_id: customId } }));
    assert.equal((await checkTicket()).body.type, 5);
    assert.equal(f.replies.at(-1).components[0].components[0].url, `https://discord.com/channels/${GUILD}/${row.channel_id}`);
    const channel = f.discord.state.channels.get(row.channel_id), saved = channel.permission_overwrites;
    channel.permission_overwrites = [];
    await checkTicket();
    assert.match(f.replies.at(-1).content, /could not be verified/);
    assert.deepEqual(f.faults.splice(0), ['TICKET_DESTINATION_CONFIRM_CASE_CHANNEL_ACL_MISMATCH']);
    channel.permission_overwrites = saved;
    const replyText = 'Synthetic signed Discord Staff reply';
    const replyPayload = f.identities.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'reply', options: [
      { type: 3, name: 'case', value: `${row.id}@${row.version}` }, { type: 3, name: 'text', value: replyText }, { type: 5, name: 'confirm', value: true },
    ] }] } });
    assert.equal((await f.send(replyPayload)).body.type, 5); assert.match(f.replies.at(-1).content, /Delivery is pending/);
    assert.equal(JSON.stringify(f.replies.at(-1)).includes(replyText), false);
    await f.runtime.runOnce();
    const sentReply = (await f.rows('case_replies'))[0]; assert.equal(sentReply.state, 'confirmed');
    assert.equal(f.discord.state.messages.get(sentReply.message_id).embeds[0].description, replyText);
    await f.send(replyPayload); assert.match(f.replies.at(-1).content, /already has confirmed delivery/);
    assert.equal((await f.rows('case_replies')).length, 1);
    const recoveryText = 'Synthetic reply with a lost POST response', recoveryPayload = structuredClone(replyPayload);
    recoveryPayload.id = f.identities.payload().id; recoveryPayload.data.options[0].options[1].value = recoveryText;
    const recoveryAuthor = '100000000000000088'; f.discord.state.members.set(recoveryAuthor, [STAFF]);
    recoveryPayload.member.user.id = recoveryAuthor;
    let dropReply = true;
    f.discord.state.afterWrite = call => { if (dropReply && call.method === 'POST' && call.path.endsWith('/messages')) {
      dropReply = false; throw new Error('synthetic reply response lost');
    } };
    assert.equal((await f.send(recoveryPayload)).body.type, 5); assert.match(f.replies.at(-1).content, /Delivery is pending/);
    await f.runtime.runOnce(); f.discord.state.afterWrite = null;
    await f.admin.query("UPDATE sophie_core.outbox SET available_at = '-infinity' WHERE kind = 'case.reply' AND status = 'ready'");
    await f.runtime.runOnce();
    const pendingReply = (await f.rows('case_replies')).find(reply => reply.body === recoveryText);
    assert.equal(pendingReply.create_started, true); assert.equal(pendingReply.message_id, null);
    const replyIssue = (await f.rows('case_delivery_issues')).find(issue => issue.operation_id === `reply.${pendingReply.id}`); assert.ok(replyIssue);
    await f.send(f.identities.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'issues' }] } }));
    assert.ok(JSON.stringify(f.replies.at(-1)).includes(`sophie:staff-reply:v1:${pendingReply.id}`));
    assert.equal(JSON.stringify(f.replies.at(-1)).includes(recoveryText), false);
    const delivered = [...f.discord.state.messages.values()].find(message => message.embeds?.[0]?.footer?.text === `sophie:staff-reply:v1:${pendingReply.id}`);
    await f.send(f.identities.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'ticket', options: [{ type: 1, name: 'recover', options: [
      { type: 3, name: 'issue', value: `${replyIssue.id}.${replyIssue.revision}` }, { type: 3, name: 'message', value: delivered.id },
    ] }] } }));
    assert.match(f.replies.at(-1).content, /verified message reference is recorded/);
    await f.runtime.runOnce();
    assert.equal((await f.rows('case_replies')).find(reply => reply.id === pendingReply.id).state, 'confirmed');
    assert.equal([...f.discord.state.messages.values()].filter(message => message.embeds?.[0]?.footer?.text === `sophie:staff-reply:v1:${pendingReply.id}`).length, 1);
    assert.equal((await f.runtime.status()).productionReady, false); assert.deepEqual(f.faults, []);
  });
  await scenario('RT05 dashboard assets and OAuth use the composed current-authority configuration APIs', async f => {
    const html = await dashboardBytes(f.addresses.dashboard, '/'); assert.equal(html.status, 303);
    assert.equal(html.headers.location, '/login?returnTo=%2F');
    assert.equal((await dashboardBytes(f.addresses.dashboard, '/login')).status, 200);
    const start = await dashboardHttp(f.addresses.dashboard, '/auth/start?returnTo=%2Flocalizations'); assert.equal(start.status, 303);
    const state = new URL(start.headers.location).searchParams.get('state'), cookie = start.headers['set-cookie'][0].split(';')[0];
    f.discord.state.members.set(OTHER, [LEAD]);
    const done = await dashboardHttp(f.addresses.dashboard, `/auth/callback?state=${state}&code=${f.oauth.issueCode(OTHER)}`, { headers: { Cookie: cookie } });
    assert.equal(done.status, 303); assert.equal(done.headers.location, '/localizations'); const session = done.headers['set-cookie'].find(value => value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
    const status = await dashboardHttp(f.addresses.dashboard, '/auth/session', { headers: { Cookie: session } });
    assert.equal(status.status, 200); assert.equal(status.body.canEditOnboarding, true); assert.equal(status.body.canEditShuttle, true); assert.equal(status.body.canEditForms, true);
    assert.equal(status.body.canEditAnswers, false);
    assert.equal((await dashboardBytes(f.addresses.dashboard, '/localizations', { headers: { Cookie: session } })).status, 200);
    assert.equal((await dashboardHttp(f.addresses.dashboard, '/api/system-wording')).status, 403);
    const wording = await dashboardHttp(f.addresses.dashboard, '/api/system-wording', { headers: { Cookie: session } });
    assert.equal(wording.status, 200); assert.equal(wording.body.revision, 0);
    const applied = await dashboardHttp(f.addresses.dashboard, '/api/system-wording/save', { method: 'POST',
      headers: { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken },
      body: JSON.stringify({ requestId: '7'.repeat(64), expectedRevision: 0, wording: { 'onboarding.next': 'Next page' } }) });
    assert.equal(applied.status, 200); assert.equal(applied.body.revision, 1);
    assert.equal((await dashboardHttp(f.addresses.dashboard, '/api/system-wording', { headers: { Cookie: session } })).body.wording['onboarding.next'], 'Next page');
    assert.equal(status.body.canEditAutomation, false);
    assert.equal((await dashboardHttp(f.addresses.dashboard, '/api/automation', {headers:{Cookie:session}})).status,403);
    const answerDenied = await dashboardHttp(f.addresses.dashboard, '/api/answers/review', { method: 'POST',
      headers: { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken },
      body: JSON.stringify({ name: 'synthetic', expectedRevision: 0, action: 'publish', document: { title: 'Synthetic', text: 'Public authored test', source: 'Synthetic source' } }) });
    assert.equal(answerDenied.status, 403); assert.equal((await f.rows('curated_answers')).length, 0);
    const forms = await dashboardHttp(f.addresses.dashboard, '/api/ticket-forms/history?caseType=admin-help&kind=drafts', { headers: { Cookie: session } });
    assert.equal(forms.status, 200);
    const contactAccess = await dashboardHttp(f.addresses.dashboard, '/api/contacts/access', { headers: { Cookie: session } });
    assert.equal(contactAccess.status, 200); assert.equal(contactAccess.body.canCreate, true);
    const received = await dashboardHttp(f.addresses.dashboard, '/api/contacts/received', { headers: { Cookie: session } });
    assert.equal(received.status, 200); assert.deepEqual(received.body.items, []); assert.equal(received.body.actorId, OTHER);
    await f.send(f.identities.payload({ member: { user: { id: USER } }, data: { type: 1, name: 'ticket',
      options: [{ type: 1, name: 'open', options: [{ type: 3, name: 'type', value: 'quick-help' }] }] } }));
    for (let index = 0; index < 5; index++) await f.runtime.runOnce();
    const ticket = (await f.rows('case_reservations')).find(row => row.type === 'quick-help'); assert.equal(ticket.state, 'open');
    const managed = await dashboardHttp(f.addresses.dashboard, `/api/cases/manage?channelId=${ticket.channel_id}`, { headers: { Cookie: session } });
    assert.equal(managed.status, 200); assert.equal(managed.body.actorId, OTHER);
    const claimed = await dashboardHttp(f.addresses.dashboard, '/api/cases/manage/change', { method: 'POST',
      headers: { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken },
      body: JSON.stringify({ channelId: ticket.channel_id, requestId: 'd'.repeat(64), expectedVersion: ticket.version, action: 'claim', targetId: null, reason: null, confirmed: true }) });
    assert.equal(claimed.status, 200); assert.equal((await f.rows('case_staff_actions')).at(-1).operator_grant.userId, OTHER);
    const replyPage = await dashboardHttp(f.addresses.dashboard, `/api/cases/replies?channelId=${ticket.channel_id}`, { headers: { Cookie: session } });
    assert.equal(replyPage.status, 200); assert.equal(replyPage.body.canReply, true);
    const authored = await dashboardHttp(f.addresses.dashboard, '/api/cases/replies/request', { method: 'POST',
      headers: { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken },
      body: JSON.stringify({ channelId: ticket.channel_id, requestId: 'e'.repeat(64), expectedVersion: replyPage.body.version,
        text: 'Synthetic reply through the composed authenticated HTTP path.', confirmed: true }) });
    assert.equal(authored.status, 200); assert.equal(authored.body.state, 'pending');
    await f.runtime.runOnce();
    const delivered = (await f.rows('case_replies'))[0]; assert.equal(delivered.state, 'confirmed');
    assert.equal(f.discord.state.messages.get(delivered.message_id).embeds[0].title, `Staff reply · user ${OTHER}`);
    const message = f.discord.state.messages.get(delivered.message_id);
    f.peer.connections[0].send(gatewayEvent(3, 'MESSAGE_CREATE', { ...message, guild_id: GUILD, timestamp: new Date(f.clock.now).toISOString() }));
    await waitForGateway(async () => (await f.rows('case_message_observations')).some(record => record.message_id === delivered.message_id));
    const captured = (await f.rows('case_message_observations')).find(record => record.message_id === delivered.message_id);
    assert.equal(captured.patch.embeds[0].description, delivered.body); assert.equal(captured.patch.embeds[0].title, `Staff reply · user ${OTHER}`);
  });
  await scenario('RT13 enabled automation delivers and recovers an uncertain effect through authenticated APIs while case capture stays separate',async f=>{
    for(const id of [PUBLIC_CHANNEL,SECOND_CHANNEL])f.discord.state.channels.set(id,{id,guild_id:GUILD,type:0,parent_id:null,permission_overwrites:[]});
    f.discord.state.roles.find(role=>role.id===GUILD).permissions=String((1n<<10n)|(1n<<11n));
    const start=await dashboardHttp(f.addresses.dashboard,'/auth/start'),state=new URL(start.headers.location).searchParams.get('state'),cookie=start.headers['set-cookie'][0].split(';')[0];
    const done=await dashboardHttp(f.addresses.dashboard,`/auth/callback?state=${state}&code=${f.oauth.issueCode(OTHER)}`,{headers:{Cookie:cookie}});
    const session=done.headers['set-cookie'].find(value=>value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
    const status=await dashboardHttp(f.addresses.dashboard,'/auth/session',{headers:{Cookie:session}}),headers={Cookie:session,Origin:f.config.dashboard.origin,'Content-Type':'application/json','X-CSRF-Token':status.body.csrfToken};
    const post=(path,body)=>dashboardHttp(f.addresses.dashboard,`/api/automation/${path}`,{method:'POST',headers,body:JSON.stringify(body)});
    const fields={expectedRevision:0,action:'publish',document:automationDocument()},review=await post('review',fields);assert.equal(review.status,200);
    assert.equal((await post('change',{...fields,requestId:'a'.repeat(64),reviewSha256:review.body.reviewSha256,confirmed:true,approvedPublic:true})).status,200);
    const message={id:'901',guild_id:GUILD,channel_id:PUBLIC_CHANNEL,type:0,author:{id:USER,bot:false},content:'Synthetic public help',timestamp:new Date(f.clock.now).toISOString(),attachments:[],embeds:[]};
    f.discord.state.messages.set(message.id,structuredClone(message));
    f.peer.connections[0].send(gatewayEvent(3,'MESSAGE_CREATE',message));await waitForGateway(async()=>(await f.rows('automation_deliveries')).length===1);
    f.peer.connections[0].send(gatewayEvent(4,'MESSAGE_CREATE',message));await waitForGateway(async()=>Number((await f.rows('gateway_lifecycle'))[0].sequence)===4);
    assert.equal((await f.rows('automation_events')).length,1);assert.equal((await f.rows('case_message_observations')).length,0);
    await f.send(f.identities.payload({member:{user:{id:USER}},data:{type:1,name:'ticket',options:[{type:1,name:'open',options:[{type:3,name:'type',value:'quick-help'}]}]}}));
    for(let index=0;index<5;index++)await f.runtime.runOnce();
    const automated=(await f.rows('automation_deliveries'))[0];assert.equal(automated.state,'confirmed');
    assert.equal(f.discord.state.messages.get(automated.sent_message_id).content,fields.document.rules[0].action.text);
    const ticket=(await f.rows('case_reservations')).find(row=>row.type==='quick-help');assert.equal(ticket.state,'open');
    f.peer.connections[0].send(gatewayEvent(5,'MESSAGE_CREATE',{...message,id:'902',channel_id:ticket.channel_id,content:'Synthetic private help sentinel'}));
    await waitForGateway(async()=>(await f.rows('case_message_observations')).length===1);
    assert.equal((await f.rows('automation_events')).length,1);assert.equal((await f.rows('outbox')).filter(row=>row.kind==='automation.dispatch').length,1);assert.deepEqual(f.faults,[]);
    f.clock.now+=3000;
    // Advancing the synthetic cooldown expires the previous heartbeat proof as well.
    await waitForGateway(async()=>(await f.runtime.status()).current);
    const later={...message,id:'903'};f.discord.state.messages.set(later.id,structuredClone(later));
    f.peer.connections[0].send(gatewayEvent(6,'MESSAGE_CREATE',later));await waitForGateway(async()=>(await f.rows('automation_deliveries')).length===2);
    f.discord.state.afterWrite=call=>{if(call.method==='POST'&&call.path===`/api/v10/channels/${PUBLIC_CHANNEL}/messages`)throw Error('Synthetic lost automation response');};
    await f.runtime.runOnce();f.discord.state.afterWrite=null;
    const issues=await dashboardHttp(f.addresses.dashboard,'/api/automation/issues',{headers});assert.equal(issues.status,200);assert.equal(issues.body.entries.length,1);
    const issue=issues.body.entries[0];assert.equal(issue.canRecover,true);
    const candidate=[...f.discord.state.messages.values()].find(value=>value.nonce===issue.deliveryId.slice(0,24));assert.ok(candidate);
    const repair={deliveryId:issue.deliveryId,expectedVersion:issue.reviewVersion,action:'recover',messageId:candidate.id,requestId:'c'.repeat(64),confirmed:true};
    assert.equal((await post('repair',repair)).status,200);assert.equal((await post('repair',repair)).body.duplicate,true);
    await f.runtime.runOnce();assert.equal((await f.rows('automation_deliveries')).find(row=>row.id===issue.deliveryId).state,'confirmed');
    const detail=await dashboardHttp(f.addresses.dashboard,`/api/automation/issue?deliveryId=${issue.deliveryId}`,{headers});assert.equal(detail.status,200);
    assert.ok(detail.body.events.some(event=>event.kind==='operator-recover'));assert.deepEqual(f.faults,[]);
  },{automation:true,automationIngress:true});
  await scenario('RT12 composed automation APIs retain reviewed policies and dry-run cooldowns without sending', async f => {
    for (const id of [PUBLIC_CHANNEL,SECOND_CHANNEL]) f.discord.state.channels.set(id,{id,guild_id:GUILD,type:0,parent_id:null,permission_overwrites:[]});
    const start = await dashboardHttp(f.addresses.dashboard,'/auth/start'), state = new URL(start.headers.location).searchParams.get('state'), cookie = start.headers['set-cookie'][0].split(';')[0];
    const done = await dashboardHttp(f.addresses.dashboard,`/auth/callback?state=${state}&code=${f.oauth.issueCode(OTHER)}`,{headers:{Cookie:cookie}});
    const session = done.headers['set-cookie'].find(value=>value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
    const status = await dashboardHttp(f.addresses.dashboard,'/auth/session',{headers:{Cookie:session}}); assert.equal(status.body.canEditAutomation,true);
    const headers = {Cookie:session,Origin:f.config.dashboard.origin,'Content-Type':'application/json','X-CSRF-Token':status.body.csrfToken};
    const post = (path,body)=>dashboardHttp(f.addresses.dashboard,`/api/automation/${path}`,{method:'POST',headers,body:JSON.stringify(body)});
    const fields = {expectedRevision:0,action:'publish',document:automationDocument()}, review = await post('review',fields); assert.equal(review.status,200);
    const request = {...fields,requestId:'a'.repeat(64),reviewSha256:review.body.reviewSha256,confirmed:true,approvedPublic:true};
    assert.equal((await post('change',request)).status,200); assert.equal((await post('change',request)).body.duplicate,true);
    const preview = await post('preview',{expectedRevision:1,document:fields.document,synthetic:true,events:[automationEvent(),automationEvent({atMs:500})]});
    assert.equal(preview.status,200); assert.deepEqual(preview.body.results.map(row=>row.actions.length),[1,0]); assert.equal(preview.body.deliveryEnabled,false);
    f.discord.state.channels.get(PUBLIC_CHANNEL).parent_id = f.config.casePolicy.categoryId;
    assert.equal((await post('review',{...fields,expectedRevision:1})).status,409);
    const withdrawal = {expectedRevision:1,action:'withdraw',document:null}, checked = await post('review',withdrawal);
    assert.equal((await post('change',{...request,...withdrawal,requestId:'b'.repeat(64),reviewSha256:checked.body.reviewSha256})).status,200);
    assert.equal((await post('change',request)).body.duplicate,true);
    assert.equal((await f.rows('automation_policies')).length,2); assert.equal((await f.rows('outbox')).length,0);
    f.discord.state.members.set(OTHER,[]); assert.equal((await dashboardHttp(f.addresses.dashboard,'/api/automation',{headers})).status,403);
    assert.deepEqual(f.faults,[]);
  },{automation:true});
  await scenario('RT11 public answer publication and signed Discord lookup enforce current membership and withdrawal', async f => {
    assert.equal((await dashboardBytes(f.addresses.dashboard, '/answers')).status, 303);
    const start = await dashboardHttp(f.addresses.dashboard, '/auth/start');
    const state = new URL(start.headers.location).searchParams.get('state'), cookie = start.headers['set-cookie'][0].split(';')[0];
    const done = await dashboardHttp(f.addresses.dashboard, `/auth/callback?state=${state}&code=${f.oauth.issueCode(OTHER)}`, { headers: { Cookie: cookie } });
    const session = done.headers['set-cookie'].find(value => value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
    const status = await dashboardHttp(f.addresses.dashboard, '/auth/session', { headers: { Cookie: session } });
    assert.equal(status.body.canEditAnswers, true);
    const headers = { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken };
    const post = (path, body) => dashboardHttp(f.addresses.dashboard, `/api/answers/${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
    const fields = { name: 'synthetic-public', expectedRevision: 0, action: 'publish', document: { title: 'Synthetic public help', text: 'Literal @everyone public test', source: 'Synthetic authored reference' } };
    const review = await post('review', fields); assert.equal(review.status, 200);
    const request = { ...fields, requestId: 'a'.repeat(64), reviewSha256: review.body.reviewSha256, confirmed: true, approvedPublic: true };
    assert.equal((await post('change', request)).status, 200); assert.equal((await post('change', request)).body.duplicate, true);
    const lookup = await dashboardHttp(f.addresses.dashboard, `/api/answers/lookup?name=${fields.name}`, { headers });
    assert.equal(lookup.status, 200); assert.deepEqual(lookup.body.document, fields.document);
    const command = (action, options) => f.identities.payload({ member: { user: { id: USER } },
      data: { type: 1, name: 'answer', options: [{ type: 1, name: action, options }] } });
    const show = () => f.send(command('show', [{ type: 3, name: 'name', value: fields.name }]));
    const ack = await show(); assert.equal(ack.body.type, 5); assert.equal(ack.body.data.flags, 64);
    assert.equal(f.replies.at(-1).embeds[0].description, fields.document.text);
    assert.equal(f.replies.at(-1).embeds[0].footer.text, fields.document.source);
    assert.deepEqual(f.replies.at(-1).allowed_mentions.parse, []);
    await f.send(command('list', [])); assert.ok(f.replies.at(-1).content.includes(fields.name));
    await f.send(command('list', [{ type: 3, name: 'after', value: fields.name }]));
    assert.match(f.replies.at(-1).content, /No published answers/);
    const roles = f.discord.state.members.get(USER); f.discord.state.members.delete(USER);
    await show(); assert.deepEqual(f.replies.at(-1).embeds, []); assert.match(f.replies.at(-1).content, /don’t have access/);
    f.discord.state.members.set(USER, roles);
    await f.send(f.identities.payload({ member: { user: { id: USER } }, data: { type: 1, name: 'ticket',
      options: [{ type: 1, name: 'open', options: [{ type: 3, name: 'type', value: 'quick-help' }] }] } }));
    for (let index = 0; index < 5; index++) await f.runtime.runOnce();
    const ticket = (await f.rows('case_reservations')).find(row => row.type === 'quick-help'); assert.equal(ticket.state, 'open');
    const selectedReply = { channelId: ticket.channel_id, expectedVersion: ticket.version, requestId: 'c'.repeat(64), text: fields.document.text,
      answer: { name: fields.name, revision: lookup.body.revision, sha256: lookup.body.sha256 }, confirmed: true };
    const prepareReply = () => f.send(f.identities.payload({ data: { type:1,name:'ticket',options:[{type:1,name:'answer',options:[
      {type:3,name:'case',value:`${ticket.id}@${ticket.version}`},{type:3,name:'name',value:fields.name},
    ]}] } }));
    const clickReview = (customId,userId = OTHER) => f.send(f.identities.payload({type:3,member:{user:{id:userId}},message:{id:'123'},
      data:{component_type:2,custom_id:customId}}));
    await prepareReply(); const cancel = f.replies.at(-1).components[0].components[1].custom_id;
    assert.equal(f.replies.at(-1).embeds[0].description,fields.document.text); assert.equal((await f.rows('case_replies')).length,0);
    await clickReview(cancel); assert.match(f.replies.at(-1).content,/Review cancelled/);
    await prepareReply(); const confirm = f.replies.at(-1).components[0].components[0].custom_id;
    await clickReview(confirm,USER); assert.match(f.replies.at(-1).content,/don’t have access/);
    await clickReview(confirm); assert.match(f.replies.at(-1).content,/Reply request recorded/);
    const discordReply = (await f.rows('case_replies'))[0]; assert.deepEqual(discordReply.answer_reference,selectedReply.answer);
    f.clock.now += 3000;
    // Advancing the synthetic cooldown also expires the previous Gateway heartbeat.
    await waitForGateway(async () => (await f.runtime.status()).current);
    const replyRequest = () => dashboardHttp(f.addresses.dashboard, '/api/cases/replies/request', { method: 'POST', headers, body: JSON.stringify(selectedReply) });
    const admitted = await replyRequest(); assert.equal(admitted.status, 200); assert.equal(admitted.body.state, 'pending');
    const withdrawal = { ...fields, expectedRevision: 1, action: 'withdraw', document: null }, checked = await post('review', withdrawal);
    assert.equal((await post('change', { ...request, ...withdrawal, requestId: 'b'.repeat(64), reviewSha256: checked.body.reviewSha256 })).status, 200);
    assert.equal((await dashboardHttp(f.addresses.dashboard, `/api/answers/lookup?name=${fields.name}`, { headers })).status, 404);
    await show(); assert.deepEqual(f.replies.at(-1).embeds, []); assert.match(f.replies.at(-1).content, /public answer is unavailable/);
    await f.send(command('list', [])); assert.match(f.replies.at(-1).content, /No published answers/);
    await f.runtime.runOnce(); await f.runtime.runOnce();
    const reply = (await f.rows('case_replies')).find(value => value.id === admitted.body.id); assert.equal(reply.state, 'confirmed'); assert.deepEqual(reply.answer_reference, selectedReply.answer);
    assert.equal(f.discord.state.messages.get(reply.message_id).embeds[0].description, selectedReply.text);
    const retried = await replyRequest(); assert.equal(retried.status, 200); assert.equal(retried.body.id, admitted.body.id); assert.equal(retried.body.duplicate, true);
    await clickReview(confirm); assert.match(f.replies.at(-1).content,/confirmed delivery/);
    assert.equal((await f.rows('case_replies')).length, 2); assert.equal((await f.rows('curated_answers')).length, 2);
    assert.deepEqual((await f.rows('case_answer_reviews')).map(value => value.state).sort(),['cancelled','submitted']); assert.deepEqual(f.faults, []);
  }, { answers: true });
  await scenario('RT06 automatic worker loop is bounded and stops with listeners and Gateway', async f => {
    await f.send(f.identities.payload());
    await waitForGateway(() => f.discord.state.members.get(USER).includes(MUZZLED));
    await f.runtime.stop(); const calls = f.discord.state.calls.length;
    await f.runtime.runOnce(); assert.equal(f.discord.state.calls.length, calls);
    await assert.rejects(signedHttp(f.addresses.interactions, f.identities.signed({ application_id: f.config.applicationId, type: 1 })));
    assert.equal((await f.runtime.status()).current, false); assert.equal((await f.rows('gateway_lifecycle'))[0].status, 'offline');
  }, { automaticWorkers: true, dashboard: false });
  await scenario('RT07 composed Shuttle buttons progress all stages and deliver Whitelist under current policy', async f => {
    await f.send(f.identities.payload({ member: { user: { id: USER } },
      data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'start' }] } }));
    for (let stage = 0; stage < 5; stage++) {
      await waitForGateway(async () => { await f.runtime.runOnce(); return (await f.current())?.ready; });
      const screen = await f.current(); assert.ok(screen?.message_id);
      const ack = await f.send(f.control(screen, 'advance')); assert.equal(ack.body.type, 6);
      await waitForGateway(async () => (await f.current()).snapshot.version > screen.snapshot.version);
      assert.equal((await f.rows('shuttle_screens')).length, 1);
    }
    await waitForGateway(async () => { await f.runtime.runOnce(); return (await f.rows('sessions'))[0].state.status === 'complete'; });
    assert.equal((await f.rows('sessions'))[0].state.status, 'complete'); assert.ok(f.discord.state.members.get(USER).includes(WHITELIST));
    assert.deepEqual(f.faults, []);
  });
  await scenario('RT08 Gateway guild unavailability closes command and worker gates', async f => {
    f.peer.connections[0].send(gatewayEvent(3, 'GUILD_DELETE', { id: GUILD, unavailable: true }));
    await waitForGateway(async () => !(await f.runtime.status()).current);
    const calls = f.discord.state.calls.length;
    const response = await f.send(f.identities.payload()); assert.equal(response.body.type, 4);
    await f.runtime.runOnce(); assert.equal(f.discord.state.calls.length, calls);
    assert.equal(f.discord.state.members.get(USER).includes(MUZZLED), false);
  });
  await scenario('RT09 stopped host resumes retained Gateway cursor and queued work after lease expiry', async f => {
    await f.send(f.identities.payload());
    const before = (await f.rows('gateway_lifecycle'))[0];
    await f.runtime.stop();
    // Honor the actual existing 30-second ownership lease; do not clear a database gate to pass.
    await new Promise(resolve => setTimeout(resolve, 31_000));
    await f.restart();
    assert.ok(f.peer.connections[1].received.some(packet => packet.op === 6 && packet.sequence === Number(before.sequence)));
    for (let index = 0; index < 4; index++) await f.runtime.runOnce();
    assert.ok(f.discord.state.members.get(USER).includes(MUZZLED));
    assert.ok((await f.rows('gateway_lifecycle'))[0].fence > before.fence); assert.deepEqual(f.faults, []);
  }, { dashboard: false });
  await scenario('RT14 an observed maintenance barrier disables the existing host until an explicit restart', async f => {
    const operationId='a'.repeat(64);
    await f.admin.query(`INSERT INTO sophie_control.maintenance_operations
      (operation_id,guild_id,candidate_version,request_sha256,review_sha256,generation,phase,database_actor)
      VALUES ($1,$2,1,$1,$1,1,'held',session_user)`,[operationId,GUILD]);
    // Fault injection: normal maintenance entry rejects this host's active lease.
    await f.admin.query('UPDATE sophie_control.runtime_gate SET generation=1,operation_id=$1 WHERE singleton',[operationId]);
    assert.equal((await f.runtime.status()).current,false);
    const before=f.discord.state.calls.length;await f.runtime.runOnce();assert.equal(f.discord.state.calls.length,before);
    assert.ok(f.faults.includes('RUNTIME_MAINTENANCE_ACTIVE'));
    await f.admin.query('UPDATE sophie_control.runtime_gate SET operation_id=NULL WHERE singleton');
    assert.equal((await f.runtime.status()).current,false,'The old host must not resume itself after cancellation');
  },{dashboard:false});
  await scenario('RT10 composed member export uses the approved reader policy and confirmed authenticated attachment route', async f => {
    await f.send(f.identities.payload({ member: { user: { id: USER } }, data: { type: 1, name: 'ticket',
      options: [{ type: 1, name: 'open', options: [{ type: 3, name: 'type', value: 'quick-help' }] }] } }));
    for (let index = 0; index < 5; index++) await f.runtime.runOnce();
    const row = (await f.rows('case_reservations'))[0], provision = (await f.rows('case_provisions'))[0];
    f.peer.connections[0].send(gatewayEvent(3, 'MESSAGE_CREATE', { guild_id: GUILD, channel_id: row.channel_id, id: '731',
      author: { id: USER }, content: 'Synthetic composed member export', timestamp: new Date(f.clock.now).toISOString(), attachments: [], embeds: [] }));
    await waitForGateway(async () => (await f.rows('case_message_observations')).length === 1);
    const start = await dashboardHttp(f.addresses.dashboard, '/auth/start');
    const state = new URL(start.headers.location).searchParams.get('state'), cookie = start.headers['set-cookie'][0].split(';')[0];
    const done = await dashboardHttp(f.addresses.dashboard, `/auth/callback?state=${state}&code=${f.oauth.issueCode(USER)}`, { headers: { Cookie: cookie } });
    const session = done.headers['set-cookie'].find(value => value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
    const status = await dashboardHttp(f.addresses.dashboard, '/auth/session', { headers: { Cookie: session } });
    assert.equal(status.body.canEditForms, false);
    const headers = { Cookie: session, Origin: f.config.dashboard.origin, 'X-CSRF-Token': status.body.csrfToken, 'Content-Type': 'application/json' };
    const scope = { caseToken: provision.operation_token, channelId: row.channel_id };
    const review = await dashboardHttp(f.addresses.dashboard, '/api/cases/export/review', { method: 'POST', headers, body: JSON.stringify(scope) });
    assert.equal(review.status, 200); assert.equal(review.body.observations, 1);
    const download = await dashboardBytes(f.addresses.dashboard, '/api/cases/export/download', { method: 'POST', headers,
      body: JSON.stringify({ ...scope, requestId: 'b'.repeat(64), reviewHash: review.body.reviewHash, confirmed: true }) });
    assert.equal(download.status, 200); assert.ok(download.text.includes('Synthetic composed member export'));
    assert.equal((await f.rows('case_export_attempts')).at(-1).actor_id, USER); assert.deepEqual(f.faults, []);
  });
  await scenario('RT15 a publisher posts an editable public Onboarding panel through signed ingress', async f => {
    const channelId = '700000000000000111';
    f.discord.state.channels.set(channelId, { id: channelId, guild_id: GUILD, type: 0, parent_id: null, permission_overwrites: [] });
    const panel = userId => f.identities.payload({ channel_id: channelId, member: { user: { id: userId } },
      data: { type: 1, name: 'whitelist', options: [{ type: 1, name: 'panel' }] } });
    const denied = await f.send(panel(USER)); assert.equal(denied.body.data.flags, 64);
    f.discord.state.members.set(OTHER, [LEAD]);
    const posted = await f.send(panel(OTHER));
    assert.equal(posted.body.type, 4); assert.equal(posted.body.data.flags, undefined);
    assert.equal(posted.body.data.embeds[0].title, 'Begin The Shuttle');
    assert.equal(posted.body.data.components[0].components[0].custom_id, 'sophie:shuttle:start:1');
    assert.deepEqual(posted.body.data.allowed_mentions.parse, []);
    f.discord.state.channels.get(channelId).parent_id = f.config.casePolicy.categoryId;
    assert.equal((await f.send(panel(OTHER))).body.data.flags, 64);
    assert.deepEqual(f.faults, []);
  });

  await scenario('RT16 signed Staff closure replies privately and retires the channel through the worker', async f => {
    const screen = await f.open();
    const result = await f.send(f.identities.payload({ member: { user: { id: OTHER } }, data: { type: 1, name: 'whitelist', options: [
      { type: 1, name: 'close', options: [{ type: 5, name: 'confirm', value: true }, { type: 7, name: 'channel', value: screen.channel_id }] }] } }));
    assert.equal(result.body.type, 5); assert.equal(result.body.data.flags, 64);
    assert.match(f.replies.at(-1).content, /Channel closure requested/);
    await f.runtime.runOnce(); assert.equal(f.discord.state.channels.has(screen.channel_id), false);
    assert.deepEqual(f.faults, []);
  });

  await scenario('RT17 an unavailable optional AI control lane cannot stop signed administration or leak message content', async f => {
    assert.ok(f.faults.includes('AI_CONTROL_UNAVAILABLE'));
    f.peer.connections[0].send(gatewayEvent(3, 'MESSAGE_CREATE', { guild_id: GUILD, channel_id: PUBLIC_CHANNEL, id: '732',
      author: { id: USER }, content: 'Synthetic excluded AI sentinel', type: 0, timestamp: new Date(f.clock.now).toISOString() }));
    await waitForGateway(() => f.faults.includes('AI_TURN_UNAVAILABLE'));
    assert.equal((await f.runtime.status()).current,true);
    assert.equal((await f.send(f.identities.payload())).body.type,5);
    for (let index = 0; index < 4; index++) await f.runtime.runOnce();
    assert.ok(f.discord.state.members.get(USER).includes(MUZZLED));
    assert.ok(f.faults.every(code => ['AI_CONTROL_UNAVAILABLE','AI_TURN_UNAVAILABLE'].includes(code)));
  }, { unavailableAi: true, dashboard: false });

  await scenario('DS07-RT18 a member can use public knowledge lookup without any AI worker or control store', async f => {
    const start = await dashboardHttp(f.addresses.dashboard, '/auth/start');
    const state = new URL(start.headers.location).searchParams.get('state'), cookie = start.headers['set-cookie'][0].split(';')[0];
    const done = await dashboardHttp(f.addresses.dashboard, `/auth/callback?state=${state}&code=${f.oauth.issueCode(USER)}`, { headers: { Cookie: cookie } });
    const session = done.headers['set-cookie'].find(value => value.startsWith(`${DASHBOARD_COOKIES.session}=`)).split(';')[0];
    const status = await dashboardHttp(f.addresses.dashboard, '/auth/session', { headers: { Cookie: session } });
    assert.equal(status.body.aiAvailable, false); assert.equal(status.body.knowledgeAvailable, true); assert.equal(status.body.canEditKnowledge, false);
    const headers = { Cookie: session, Origin: f.config.dashboard.origin, 'Content-Type': 'application/json', 'X-CSRF-Token': status.body.csrfToken };
    const response = await dashboardHttp(f.addresses.dashboard, '/api/knowledge/lookup', { method:'POST',headers,body:JSON.stringify({query:'synthetic topic'}) });
    assert.equal(response.status,200); assert.deepEqual(response.body.sources,[]); assert.equal(response.body.actorId,USER);
    assert.deepEqual(f.faults,[]);
  }, { knowledgeOnly: true });

}
