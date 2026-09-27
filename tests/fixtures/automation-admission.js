import { onboardingWorkflow } from './onboarding-workflow.js';
import { createAutomationPolicies } from '../../apps/core/storage/automation-policies.js';
import { createAutomationChannels } from '../../apps/core/discord/automation-channels.js';
import { createAutomationIngress } from '../../apps/core/discord/automation-ingress.js';
import { createAutomationAdmission } from '../../apps/core/storage/automation-admission.js';
import { createGatewayJournal } from '../../apps/core/storage/gateway-journal.js';
import { createGatewayObserver } from '../../apps/core/discord/gateway-observer.js';
import { automationDocument, PUBLIC_CHANNEL, SECOND_CHANNEL, PROTECTED_CATEGORY } from './automation.js';
import { GUILD, USER, OTHER, STAFF } from './domain.js';
import { BOT, mapping } from './discord.js';
import { APPLICATION } from './interactions.js';
import { gatewayEvent, readyEvent, guildEvent } from './gateway.js';

export async function automationAdmissionFixture(cluster,{document=automationDocument(),admissionOptions={},journalPool}={}){
  const f=await onboardingWorkflow(cluster,{extraCapabilities:{'automation.publish':[STAFF]}}),clock=()=>f.clock.now;
  for(const id of new Set([PUBLIC_CHANNEL,SECOND_CHANNEL,...document.rules.flatMap(rule=>rule.channels)]))
    f.discord.state.channels.set(id,{id,guild_id:GUILD,type:0,parent_id:null,permission_overwrites:[]});
  const channels=createAutomationChannels({transport:f.discord.transport}),ingress=createAutomationIngress({guildId:GUILD,botUserId:BOT,clock});
  const automation=createAutomationPolicies({pool:f.pool,authorize:f.authorization.authorize,guildId:GUILD,channels,protectedCategoryId:PROTECTED_CATEGORY});
  const fields={expectedRevision:0,action:'publish',document},actor=await f.actor(OTHER),review=await automation.review({actor,...fields});
  await automation.change({actor,...fields,reviewSha256:review.reviewSha256,requestId:'a'.repeat(64),confirmed:true,approvedPublic:true});
  const admission=createAutomationAdmission({guildId:GUILD,protectedCategoryId:PROTECTED_CATEGORY,channels,ingress,...admissionOptions});
  const journal=createGatewayJournal({pool:typeof journalPool === 'function' ? journalPool(f.pool) : journalPool ?? f.pool,mapping,clock,automation:admission});
  const observer=createGatewayObserver({journal,mapping,applicationId:APPLICATION,clock});
  await observer.acquire('automation-test'); const {connection}=await observer.beginIdentify();
  await observer.accept(connection,readyEvent());observer.heartbeatAcknowledged(connection,45000);await observer.accept(connection,guildEvent());
  let sequence=2;
  const payload=(changes={})=>gatewayEvent(++sequence,'MESSAGE_CREATE',{id:String(900+sequence),guild_id:GUILD,channel_id:PUBLIC_CHANNEL,
    type:0,author:{id:USER,bot:false},content:'Synthetic help request',...changes});
  const send=changes=>observer.accept(connection,payload(changes));
  const step=ms=>{f.clock.now+=ms;observer.heartbeatAcknowledged(connection,45000);};
  return {...f,clock,channels,ingress,automation,admission,journal,observer,connection,payload,send,step,
    sendPayload:value=>observer.accept(connection,value)};
}
