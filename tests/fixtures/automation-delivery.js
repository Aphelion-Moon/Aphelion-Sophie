import { automationAdmissionFixture } from './automation-admission.js';
import { createAutomationMessages } from '../../apps/core/discord/automation-messages.js';
import { createAutomationDelivery } from '../../apps/core/storage/automation-delivery.js';
import { createAutomationDispatcher } from '../../apps/core/discord/automation-dispatcher.js';
import { PERMISSIONS } from '../../platform/authorization/discord-permissions.js';
import { GUILD, OTHER } from './domain.js';
import { BOT, BOT_ROLE } from './discord.js';
import { PROTECTED_CATEGORY } from './automation.js';

export async function automationDeliveryFixture(cluster,options={}) {
  const f = await automationAdmissionFixture(cluster,options), control = {active:true};
  f.discord.state.roles.find(role=>role.id === GUILD).permissions = String(PERMISSIONS.viewChannel | PERMISSIONS.sendMessages);
  const bot = f.discord.state.roles.find(role=>role.id === BOT_ROLE); bot.permissions = String(BigInt(bot.permissions) | PERMISSIONS.addReactions | PERMISSIONS.readHistory);
  const messages = createAutomationMessages({transport:f.discord.transport,roles:f.discord.roles,botUserId:BOT,protectedCategoryId:PROTECTED_CATEGORY,clock:f.clock});
  const services = (changes={}) => {
    const store = createAutomationDelivery({pool:f.pool,clock:f.clock,guildId:GUILD,protectedCategoryId:PROTECTED_CATEGORY,channels:f.channels,messages,automationEnabled:()=>control.active,...changes});
    return {store,worker:createAutomationDispatcher({outbox:f.outbox,store,messages,enabled:()=>true})};
  };
  async function send(changes={}) {
    const event=f.payload(changes);f.discord.state.messages.set(event.d.id,structuredClone(event.d));await f.sendPayload(event);return event.d.id;
  }
  async function withdraw() {
    const actor=await f.actor(OTHER),fields={expectedRevision:1,action:'withdraw',document:null},review=await f.automation.review({actor,...fields});
    await f.automation.change({actor,...fields,requestId:'b'.repeat(64),reviewSha256:review.reviewSha256,confirmed:true,approvedPublic:true});
  }
  return {...f,control,messages,services,...services(),send,withdraw,
    record:async()=>(await f.rows('automation_deliveries'))[0],
    job:async()=>(await f.rows('outbox')).find(row=>row.kind === 'automation.dispatch'),
    run:async(worker)=> (worker ?? services().worker).runOnce('automation-worker')};
}
