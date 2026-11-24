import { fail } from './common.mjs';
export const SETUP_RPC_METHODS=new Set(['server.getConfig','server.refreshProviders','server.updateSettings','provider.install.start','provider.install.cancel','provider.install.subscribe','provider.auth.start','provider.auth.respond','provider.auth.complete','provider.auth.cancel','provider.auth.subscribe']);
export function validateSetupRequest(tag,payload){
  if(!SETUP_RPC_METHODS.has(tag))fail('SETUP_RPC_FORBIDDEN','Not a provider setup operation',403);
  if(tag==='server.updateSettings'&&(Object.keys(payload.patch??{}).length||!payload.providerInstanceMutation||Object.keys(payload).some(k=>!['patch','providerInstanceMutation'].includes(k))))fail('SETUP_RPC_FORBIDDEN','Only a single provider instance mutation is allowed',403);
  if(tag==='provider.auth.respond'&&(payload.response?.type!=='browser'||!['accept','decline'].includes(payload.response.action)||Object.keys(payload.response).some(k=>!['type','action'].includes(k))))fail('SETUP_RPC_FORBIDDEN','Only browser consent is supported on this setup channel',403);
}
// Effect RPC framing at the pinned release, not JSON-RPC. Lead supplies a
// short-lived ticket for its isolated FORGE server, then revokes the session.
export async function openT3ProviderChannel({url,ticket,WebSocketImpl=WebSocket,timeoutMs=30000}){
  const endpoint=new URL('/ws',url);endpoint.protocol='ws:';endpoint.searchParams.set('orchestrationProtocol','2');endpoint.searchParams.set('wsTicket',ticket);
  const ws=new WebSocketImpl(endpoint);let serial=0,closed=false;const pending=new Map();
  const send=frame=>ws.send(JSON.stringify(frame));
  const close=()=>{if(closed)return;closed=true;for(const p of pending.values()){clearTimeout(p.timer);p.reject(Object.assign(new Error('T3 setup channel closed; reconcile first'),{code:'OUTCOME_UNKNOWN'}));}pending.clear();ws.close();};
  ws.addEventListener('message',event=>{let frames;try{const v=JSON.parse(event.data);frames=Array.isArray(v)?v:[v];}catch{close();return;}
    for(const f of frames){if(f._tag==='Ping'){send({_tag:'Pong'});continue;}const p=pending.get(String(f.requestId));if(!p)continue;
      if(f._tag==='Chunk'&&p.first&&f.values?.length){clearTimeout(p.timer);pending.delete(String(f.requestId));send({_tag:'Ack',requestId:f.requestId});send({_tag:'Interrupt',requestId:f.requestId});p.resolve(f.values[0]);}
      else if(f._tag==='Exit'){clearTimeout(p.timer);pending.delete(String(f.requestId));if(f.exit?._tag==='Success')p.resolve(f.exit.value);else p.reject(Object.assign(new Error('Provider setup RPC failed'),{code:'SETUP_RPC_FAILED'}));}
    }
  });
  ws.addEventListener('close',close);ws.addEventListener('error',close);
  await new Promise((resolve,reject)=>{const timer=setTimeout(()=>{close();reject(new Error('T3 setup connect timeout'));},timeoutMs);ws.addEventListener('open',()=>{clearTimeout(timer);resolve();},{once:true});ws.addEventListener('error',()=>{clearTimeout(timer);reject(new Error('T3 setup connection failed'));},{once:true});});
  return {request(tag,payload){validateSetupRequest(tag,payload);if(closed)fail('SETUP_DISCONNECTED','Reconnect setup channel',409);
    const id=String(++serial);return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{pending.delete(id);send({_tag:'Interrupt',requestId:id});reject(new Error('T3 setup timeout; reconcile before retry'));},timeoutMs);pending.set(id,{resolve,reject,timer,first:tag.endsWith('.subscribe')});send({_tag:'Request',id,tag,payload,headers:[]});});},close};
}
