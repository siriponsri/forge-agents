import { EventSchema } from '@ag-ui/core/schemas';
import { PROTOCOL_VERSION } from '@ag-ui/core';
import { entity, now } from './domain.mjs';
import { createHash } from 'node:crypto';
export { PROTOCOL_VERSION };
export function digest(value){return createHash('sha256').update(JSON.stringify(value)??'undefined').digest('hex');}
// A receipt and its validated event commit in the same domain transaction. Replaying
// a provider observation is display-only, including after process restart.
export function appendProtocol(state,run,event,sourceKey){
  const fingerprint=digest(event);
  const key=sourceKey??`value:${fingerprint}`;
  run.protocolReceipts??={};
  if(run.protocolReceipts[key])return false;
  const valid=EventSchema.parse({...event,timestamp:Date.now()});
  const record=entity({type:'agui',projectId:run.projectId,runId:run.id,attemptId:run.attemptId,protocol:PROTOCOL_VERSION,sourceKey:key,sequence:(run.protocolSequence??0)+1,event:valid,observedAt:now()});
  state.events.push(record);run.protocolSequence=record.sequence;
  run.protocolReceipts[key]={eventId:record.id,sequence:record.sequence,fingerprint};
  return true;
}
export function protocolEvents(state,id){return state.events.filter(e=>e.type==='agui'&&e.runId===id).map(e=>e.event);}
export function protocolRecords(state,id,{afterSequence=0}={}){return state.events.filter(e=>e.type==='agui'&&e.runId===id&&(e.sequence??0)>afterSequence);}
