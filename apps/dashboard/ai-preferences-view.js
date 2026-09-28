import { canonicalResponsePreferences } from '../../modules/assistant/preferences.js';

/** Member-authored settings stay on this authenticated page; remote use is visibly held. */
export function createPreferenceEditor({api,document,perform,identity,changed,saved}) {
  const el=id=>document.getElementById(id);let current=null;
  function clear() {
    current=null;el('reply-length').value='';el('preferred-language').value='';el('preference-state').textContent='';
    for(const id of ['save-preferences','delete-preferences','export-preferences'])el(id).disabled=true;
  }
  function render(value) {
    const actor=identity();
    if(!actor || value.actorId!==actor.userId || value.guildId!==actor.guildId || value.remoteUse!==false ||
      typeof value.available!=='boolean' || typeof value.quarantined!=='boolean' ||
      value.epoch!==null && (!Number.isSafeInteger(value.epoch) || value.epoch<0) ||
      value.settings!==null && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt<=0)) {clear();throw Error('AI_PREFERENCE_RESULT_INVALID');}
    const settings=value.settings===null ? {replyLength:null,language:null}:canonicalResponsePreferences(value.settings);
    current=value;el('reply-length').value=settings.replyLength ?? '';el('preferred-language').value=settings.language ?? '';
    el('save-preferences').disabled=!value.available || value.quarantined;
    el('delete-preferences').disabled=!value.available || value.epoch===0;
    el('export-preferences').disabled=!value.available || value.quarantined;
    el('preference-state').textContent=!value.available ? 'Saved preferences are unavailable right now.' : value.quarantined
      ? 'Earlier settings are held for a recovery check. Delete them to start with a clean record.' : value.settings===null
        ? 'You have no saved response preferences.' : `Saved by you. Expires ${new Date(value.expiresAt).toLocaleDateString()}. Use with external AI is off.`;
  }
  async function load(){render(await api.aiPreferences());}
  for(const id of ['reply-length','preferred-language'])el(id).addEventListener('input',changed);
  el('save-preferences').addEventListener('click',()=>perform(async()=>{
    if(!current?.available || current.quarantined)return;
    const settings=canonicalResponsePreferences({replyLength:el('reply-length').value || null,language:el('preferred-language').value.trim() || null});
    render(await api.aiSavePreferences({expectedEpoch:current.epoch,settings,confirmed:true}));
    saved();
  }));
  el('delete-preferences').addEventListener('click',()=>perform(async()=>{
    if(!current?.available)return;
    render(await api.aiDeletePreferences({expectedEpoch:current.epoch,confirmed:true}));
    saved();
  }));
  el('export-preferences').addEventListener('click',()=>perform(async()=>{
    await load();if(!current?.available || current.quarantined)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(current,null,2)+'\n'],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='sophie-response-preferences.json';link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
  }));
  clear();return Object.freeze({load,clear});
}
