import { EventSchema } from '@ag-ui/core/schemas';
import { PROTOCOL_VERSION } from '@ag-ui/core';
import { entity, now } from './domain.mjs';
export { PROTOCOL_VERSION };
export function appendProtocol(state,run,event){
  const valid=EventSchema.parse({...event,timestamp:Date.now()});
  state.events.push(entity({type:'agui',projectId:run.projectId,runId:run.id,protocol:PROTOCOL_VERSION,event:valid,observedAt:now()}));
}
export function protocolEvents(state,id){return state.events.filter(e=>e.type==='agui'&&e.runId===id).map(e=>e.event);}
