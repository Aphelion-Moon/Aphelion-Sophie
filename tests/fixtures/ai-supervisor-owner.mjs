import { openAiSupervisorJournal } from '../../apps/ai-supervisor/journal.js';

// This child owns only a synthetic journal/pipe. It never imports or calls Docker.
process.once('message',async({registration,directory,identity,operationId,containerId,phase})=>{
  try {
    const journal=await openAiSupervisorJournal({registration,directory});let state=journal.snapshot();
    if(phase!=='empty')state=await journal.begin({revision:state.revision,identity,operationId});
    if(['creating','created','starting','running'].includes(phase))state=await journal.creating({revision:state.revision});
    if(['created','starting','running'].includes(phase))state=await journal.created({revision:state.revision,containerId});
    if(['starting','running'].includes(phase))state=await journal.starting({revision:state.revision});
    if(phase==='running')state=await journal.running({revision:state.revision});
    process.send({ready:true,phase:state.phase});
    process.once('message',async()=>{await journal.close();process.disconnect();});
  } catch {process.send({ready:false});process.disconnect();}
});
