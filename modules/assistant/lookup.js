import { requireCondition } from '../../contracts/validation.js';
import { requireKnowledgeSourceId } from './knowledge.js';

export function requireLookupQuery(query) {
  requireCondition(typeof query==='string' && query.trim().length>0 && query.length<=200 && query.isWellFormed() &&
    !/[\x00-\x1f\x7f]/.test(query),'KNOWLEDGE_INPUT_INVALID');
  return query.trim();
}
export function lookupCommandDefinition() {
  return {type:1,name:'lookup',description:'Find a reviewed public source without AI generation.',
    options:[{type:3,name:'query',description:'Words from the public policy or guide.',required:true,max_length:200}]};
}
export function parseLookupCommand(options) {
  requireCondition(Array.isArray(options) && options.length===1 && options[0]?.type===3 && options[0].name==='query' && options[0].options===undefined,'INTERACTION_OPTIONS_INVALID');
  return requireLookupQuery(options[0].value);
}
export function presentLookupSource(source) {
  requireKnowledgeSourceId(source.id);
  const limits={title:200,heading:160,text:4000,url:1000,rights:300,attribution:500,sourceRevision:160};
  for(const [key,limit] of Object.entries(limits))requireCondition(typeof source[key]==='string' && source[key].length>0 && source[key].length<=limit && source[key].isWellFormed(),'KNOWLEDGE_RESULT_INVALID');
  const url=new URL(source.url);requireCondition(url.protocol==='https:' && !url.username && !url.password && !url.port,'KNOWLEDGE_RESULT_INVALID');
  requireCondition(['policy','lore','reference','community-event'].includes(source.authority) && (source.validUntil===null || Number.isSafeInteger(source.validUntil)),'KNOWLEDGE_RESULT_INVALID');
  return Object.fromEntries(['id',...Object.keys(limits),'authority','validUntil'].map(key=>[key,source[key]]));
}
export function knowledgeLookupReply(view) {
  const empty=content=>({content,embeds:[],components:[]});
  if(view.status!=='available')return empty(view.status==='denied' ? 'This lookup requires current membership and an eligible non-ticket text channel.' : 'Reviewed knowledge is unavailable right now.');
  requireCondition(Array.isArray(view.sources) && view.sources.length<=4,'KNOWLEDGE_RESULT_INVALID');
  if(view.sources.length===0)return empty('No current reviewed source matched those words.');
  const source=presentLookupSource(view.sources[0]);
  return {content:`Reviewed source extract${view.sources.length>1 ? ` — first of ${view.sources.length} matches`:''}. No AI generation.`,
    embeds:[{title:source.title,url:source.url,description:source.text,fields:[{name:'Section',value:source.heading}],
      footer:{text:`${source.id} | ${source.authority} | Revision ${source.sourceRevision}\n${source.attribution}\n${source.rights}`}}],components:[]};
}
