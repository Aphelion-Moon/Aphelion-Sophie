import { canonicalResponsePreferences } from '../../modules/assistant/preferences.js';

/** Member-authored settings stay on this authenticated page; remote use is visibly held. */
export function createPreferenceEditor({api,document,perform,identity,changed,saved}) {
  const el=id=>document.getElementById(id);let current=null;
  function clear() {
    current=null;el('reply-length').value='';el('preferred-language').value='';el('preference-state').textContent='';
    for(const id of ['save-preferences','delete-preferences','export-preferences','save-retention','retain-on-leave'])el(id).disabled=true;
    el('retain-on-leave').checked=false;el('retention-state').textContent='';
  }
  function render(value) {
    const actor=identity();
    if(!actor || value.actorId!==actor.userId || value.guildId!==actor.guildId || value.remoteUse!==false ||
      typeof value.available!=='boolean' || typeof value.quarantined!=='boolean' || typeof value.retainOnLeave!=='boolean' ||
      value.epoch!==null && (!Number.isSafeInteger(value.epoch) || value.epoch<0) ||
      value.settings!==null && (!Number.isSafeInteger(value.expiresAt) || value.expiresAt<=0)) {clear();throw Error('AI_PREFERENCE_RESULT_INVALID');}
    const settings=value.settings===null ? {replyLength:null,language:null}:canonicalResponsePreferences(value.settings);
    current=value;el('reply-length').value=settings.replyLength ?? '';el('preferred-language').value=settings.language ?? '';
    el('save-preferences').disabled=!value.available || value.quarantined;
    el('delete-preferences').disabled=!value.available || value.epoch===0;
    el('export-preferences').disabled=!value.available || value.quarantined;
    el('retain-on-leave').checked=value.retainOnLeave;
    for(const id of ['save-retention','retain-on-leave'])el(id).disabled=!value.available || value.quarantined;
    el('retention-state').textContent=!value.available || value.quarantined?'Your saved departure choice is unavailable right now. Reload when recovery completes.':value.retainOnLeave?'Saved choice: retain my AI data when I leave. Existing expiry limits still apply.':'Saved choice: delete my AI data when I leave the server.';
    el('preference-state').textContent=!value.available ? 'Saved preferences are unavailable right now.' : value.quarantined
      ? 'Earlier settings are held for a recovery check. Delete them to start with a clean record.' : value.settings===null
        ? 'You have no saved response preferences.' : `Saved by you. Expires ${new Date(value.expiresAt).toLocaleDateString()}. Use with external AI is off.`;
  }
  async function load(){render(await api.aiPreferences());}
  for(const id of ['reply-length','preferred-language'])el(id).addEventListener('input',changed);
  el('retain-on-leave').addEventListener('change',changed);
  el('save-retention').addEventListener('click',()=>perform(async()=>{
    if(!current?.available || current.quarantined)return;
    render(await api.aiSaveRetention({expectedEpoch:current.epoch,retainOnLeave:el('retain-on-leave').checked,confirmed:true}));saved();
  }));
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
    // The attachment route performs a fresh self-authorized read at download time.
    const link=document.createElement('a');link.href='/api/ai/preferences/export';link.download='sophie-response-preferences.json';link.click();
  }));
  clear();return Object.freeze({load,clear});
}
