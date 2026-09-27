import { GUILD, USER } from './domain.js';
export const PUBLIC_CHANNEL = '710';
export const SECOND_CHANNEL = '711';
export const PROTECTED_CATEGORY = '712';
export const automationRule = (changes = {}) => ({id:'help',channels:[PUBLIC_CHANNEL,SECOND_CHANNEL],
  match:{kind:'contains',text:'help',caseSensitive:false},action:{kind:'message',text:'Synthetic public help @everyone <@123> ${literal}'},
  priority:10,stop:true,userCooldownMs:3000,channelCooldownMs:1000,...changes});
export const automationDocument = (rules = [automationRule()]) => ({source:'Synthetic public authored reference',rules});
export const automationEvent = (changes = {}) => ({atMs:0,channelId:PUBLIC_CHANNEL,userId:USER,content:'Synthetic HELP question',bot:false,webhook:false,self:false,...changes});
export const automationChannel = (changes = {}) => ({id:PUBLIC_CHANNEL,guildId:GUILD,type:0,parentId:null,...changes});
