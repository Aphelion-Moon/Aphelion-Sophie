import { intakeDeliveryWorkflow } from './case-intake-delivery.js';
import { createCaseMessageCapture } from '../../apps/core/discord/case-message-capture.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { gatewayEvent, readyEvent, guildEvent } from './gateway.js';
import { GUILD, USER } from './domain.js';
import { mapping } from './discord.js';
import { APPLICATION } from './interactions.js';

export const syntheticConversation = (channelId, overrides = {}) => ({ guild_id: GUILD, channel_id: channelId, id: '730000000000000001',
  author: { id: USER, username: 'Synthetic author', global_name: null, bot: false }, type: 0, content: 'Synthetic case conversation',
  timestamp: '2026-09-19T12:00:00.000Z', edited_timestamp: null, attachments: [], embeds: [], ...overrides });

export async function conversationWorkflow(cluster, { capture = true } = {}) {
  const f = await intakeDeliveryWorkflow(cluster), time = () => f.clock.now;
  const caseCapture = capture ? createCaseMessageCapture({ guildId: GUILD, clock: time }) : null;
  const journal = createGatewayJournal({ pool: f.pool, mapping, clock: time, caseCapture });
  const observer = createGatewayObserver({ journal, mapping, applicationId: APPLICATION, clock: time });
  await observer.acquire('conversation-observer');
  let { connection } = await observer.beginIdentify();
  await observer.accept(connection, readyEvent()); observer.heartbeatAcknowledged(connection, 45000);
  await observer.accept(connection, guildEvent()); let sequence = 2;
  const opened = await f.openTicket();
  const send = (type, data, increment = 1) => { sequence += increment; return observer.accept(connection, gatewayEvent(sequence, type, data)); };
  const resume = async (replays = []) => {
    ({ connection } = await observer.beginResume());
    for (const event of replays) await observer.accept(connection, event);
    await send('RESUMED', {}); observer.heartbeatAcknowledged(connection, 45000);
  };
  return { ...f, journal, observer, capture: caseCapture, opened, send, resume,
    connection: () => connection, sequence: () => sequence,
    observations: () => f.admin.query('SELECT * FROM sophie_core.case_message_observations ORDER BY continuity_epoch, sequence, message_id').then(value => value.rows),
    gaps: () => f.admin.query('SELECT * FROM sophie_core.case_capture_gaps ORDER BY channel_id NULLS FIRST, closed_at_ms NULLS FIRST, token').then(value => value.rows),
  };
}
