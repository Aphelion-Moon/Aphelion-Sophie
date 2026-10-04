import assert from 'node:assert/strict';
import { aiDigest } from '../../apps/core/storage/ai-controls.js';
import { canonicalAiConfiguration, defaultParticipation } from '../../modules/assistant/participation.js';
import { canonicalPersonality, DRAFT_PERSONALITY } from '../../modules/assistant/personality.js';
import { createKnowledgeLibrary } from '../../apps/knowledge/library.js';
import { validateAiOutput } from '../../modules/assistant/output.js';
import { GUILD, USER, OTHER } from './domain.js';
import { PUBLIC_CHANNEL } from './automation.js';

/** Synthetic qualification only. Uses the disposable test database, never an installed worker or provider. */
export async function qualifiedGatewayAi({ cluster, configuration, discord, clock }) {
  const admin = cluster.adminPool, checked = new Map(), calls = { knowledge: [], lookups: [], worker: [], qualification: 0 };
  let heldReply = null;
  function holdNextReply() {
    assert.equal(heldReply, null);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const reply = validateAiOutput({ kind: 'reply', text: 'Synthetic late public answer', purpose: 'conversation', support: 'current_conversation', citations: [] },
      { outcomes: ['reply'], answerOnly: false, sources: [], emojiKeys: [] });
    const held = { gate, reply, signal: null, started: false, finished: false }; heldReply = held;
    return { release, started: () => held.started, aborted: () => held.signal?.aborted === true, finished: () => held.finished };
  }
  const channels = [
    { id: PUBLIC_CHANNEL, type: 0, parent_id: null },
    { id: '911', type: 0, parent_id: configuration.casePolicy.categoryId, excluded: true },
    { id: '912', type: 0, parent_id: null, excluded: true },
    { id: '913', type: 11, parent_id: '911' },
    { id: '914', type: 11, parent_id: null, excluded: true },
    { id: '915', type: 0, parent_id: configuration.casePolicy.categoryId },
    { id: '916', type: 0, parent_id: configuration.casePolicy.categoryId, excluded: true },
  ];
  const profile = { ...defaultParticipation('addressed'), typing: false };
  const document = canonicalAiConfiguration({ schemaVersion: 1, enabled: true, deadlineMs: 15000,
    channels: channels.map(channel => ({ channelId: channel.id, profile })), emojis: [] });
  const character = canonicalPersonality(DRAFT_PERSONALITY), configurationHash = aiDigest(document), personalityHash = aiDigest(character);
  // Public source is actually usable, including history inspection; a disabled lane cannot satisfy the test.
  discord.state.roles.find(role => role.id === GUILD).permissions = String((1n << 10n) | (1n << 11n) | (1n << 16n));
  await admin.query('INSERT INTO sophie_ai.state(guild_id,disabled,configuration_revision,personality_revision) VALUES($1,false,1,1)', [GUILD]);
  for (const [kind, value, hash, request] of [['configuration', document, configurationHash, 'a'], ['personality', character, personalityHash, 'b']]) {
    await admin.query(`INSERT INTO sophie_ai.publications(guild_id,kind,revision,document,sha256,actor_id,request_id,request_sha256)
      VALUES($1,$2,1,$3,$4,$5,$6,$4)`, [GUILD, kind, value, hash, OTHER, request.repeat(64)]);
  }
  const roles = discord.state.roles.map(({ id, permissions }) => ({ id, permissions })).sort((a, b) => a.id.localeCompare(b.id));
  for (const channel of channels) {
    discord.state.channels.set(channel.id, { id: channel.id, guild_id: GUILD, type: channel.type, parent_id: channel.parent_id, permission_overwrites: [] });
    if (channel.excluded) await admin.query('INSERT INTO sophie_core.case_exclusions(guild_id,channel_id,parent_id) VALUES($1,$2,$3)', [GUILD, channel.id, channel.parent_id]);
    const audienceHash = aiDigest({ guildId: GUILD, channelId: channel.id, parentId: channel.parent_id, ownerId: discord.state.ownerId, roles, overwrites: [] });
    await admin.query(`INSERT INTO sophie_ai.qualifications(guild_id,channel_id,boundary_epoch,audience_sha256,worker_domain,
      release_sha256,evidence_sha256,configuration_sha256,personality_sha256,restricted,active,restore_ready)
      VALUES($1,$2,1,$3,'synthetic-public',$4,$4,$5,$6,false,true,true)`,
    [GUILD, channel.id, audienceHash, 'c'.repeat(64), configurationHash, personalityHash]);
    await admin.query(`INSERT INTO sophie_ai.consents(guild_id,channel_id,user_id,epoch,enabled,presence_epoch,notice_revision)
      VALUES($1,$2,$3,1,true,1,1)`, [GUILD, channel.id, USER]);
  }
  // Observe admission reaching each qualification, so bounded ingress capacity cannot silently skip a sentinel.
  async function query(client, text, values) {
    const result = await client.query(text, values);
    if (text.startsWith('SELECT * FROM sophie_ai.qualifications WHERE')) checked.set(values[1], (checked.get(values[1]) ?? 0) + 1);
    return result;
  }
  const controlPool = { query: (text, values) => query(admin, text, values), async connect() {
    const client = await admin.connect(); return { query: (text, values) => query(client, text, values), release: () => client.release() };
  } };
  // A real, restricted knowledge identity makes an empty case search meaningful.
  await admin.query('GRANT USAGE ON SCHEMA sophie_knowledge TO sophie_test_knowledge');
  await admin.query('GRANT SELECT,INSERT,UPDATE ON ALL TABLES IN SCHEMA sophie_knowledge TO sophie_test_knowledge');
  const publisher = { userId: OTHER }, library = createKnowledgeLibrary({ pool: cluster.knowledgePool, guildId: GUILD,
    authorize: async (_action, actor) => actor === publisher, restoreCurrent: async () => true, clock });
  const source = { id: 'synthetic-public-beacon', title: 'Synthetic public beacon', kind: 'owner-publication', authority: 'reference',
    url: 'https://example.test/public-beacon', rights: 'Synthetic fixture authored for this check', attribution: 'Synthetic author',
    sourceRevision: 'synthetic-1', dependencyHash: 'e'.repeat(64), fetchedAt: clock(), validUntil: null,
    aliases: ['public beacon'], sections: [{ heading: 'Public beacon', text: 'The public beacon is blue.' }] };
  const review = await library.review({ actor: publisher, expectedEpoch: 0, document: source });
  await library.publish({ actor: publisher, expectedEpoch: 0, document: source, reviewHash: review.reviewHash, requestId: 'e'.repeat(64), confirmed: true });
  async function qualifyCase(channelId) {
    // Deliberately authorize the AI configuration for a real synthetic case. Its permanent
    // core exclusion must still win, even if an operator's qualification were incorrect.
    const channel = discord.state.channels.get(channelId);
    assert.ok(channel);
    const expanded = canonicalAiConfiguration({ ...document, channels: [...document.channels, { channelId, profile }] }), hash = aiDigest(expanded);
    const audience = aiDigest({ guildId: GUILD, channelId, parentId: channel.parent_id, ownerId: discord.state.ownerId,
      roles, overwrites: channel.permission_overwrites });
    const client = await admin.connect();
    try {
      await client.query('BEGIN');
      await client.query(`INSERT INTO sophie_ai.publications(guild_id,kind,revision,document,sha256,actor_id,request_id,request_sha256)
        VALUES($1,'configuration',2,$2,$3,$4,$5,$3)`, [GUILD, expanded, hash, OTHER, 'd'.repeat(64)]);
      await client.query('UPDATE sophie_ai.state SET configuration_revision=2 WHERE guild_id=$1', [GUILD]);
      await client.query('UPDATE sophie_ai.qualifications SET configuration_sha256=$2 WHERE guild_id=$1', [GUILD, hash]);
      await client.query(`INSERT INTO sophie_ai.qualifications(guild_id,channel_id,boundary_epoch,audience_sha256,worker_domain,
        release_sha256,evidence_sha256,configuration_sha256,personality_sha256,restricted,active,restore_ready)
        VALUES($1,$2,1,$3,'synthetic-public',$4,$4,$5,$6,false,true,true)`, [GUILD, channelId, audience, 'c'.repeat(64), hash, personalityHash]);
      await client.query(`INSERT INTO sophie_ai.consents(guild_id,channel_id,user_id,epoch,enabled,presence_epoch,notice_revision)
        VALUES($1,$2,$3,1,true,1,1)`, [GUILD, channelId, USER]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
  }
  return { probe: { channels, checked, calls, qualifyCase, holdNextReply }, adapters: {
    aiControlPool: controlPool,
    // This fixture has no saved preferences. Journal durability and OS access are separate tests.
    aiPreferenceJournal: { read: async () => 0, advance: async () => assert.fail('No preference changes expected') },
    aiWorker: { current: async () => { calls.qualification++; return true; }, generate: async (payload, context) => {
      calls.worker.push(structuredClone(payload)); assert.equal(payload.boundary.channelId, PUBLIC_CHANNEL);
      assert.equal(JSON.stringify(payload).replaceAll('\\', '').includes('EXCLUDED_SENTINEL'), false);
      const held = heldReply; heldReply = null;
      if (held === null) return { kind: 'silent' };
      held.signal = context.signal; held.started = true;
      // Deliberately ignore abort until released, modeling a physically late worker result.
      await held.gate; held.finished = true; return held.reply;
    } },
    aiKnowledge: { lookup: async (text, request) => {
      assert.equal(text.replaceAll('\\', '').includes('EXCLUDED_SENTINEL'), false);
      if (request.channelId !== undefined) assert.equal(request.channelId, PUBLIC_CHANNEL);
      const sources = await library.lookup(text, request);
      (request.channelId === undefined ? calls.lookups : calls.knowledge).push({ text, channelId: request.channelId, sources: sources.length });
      return sources;
    }, current: library.current, currentReferences: library.currentReferences },
  } };
}
