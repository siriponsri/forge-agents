import { request, error, clean } from './common.mjs';

const route=c=>`/${c.kind==='vast'?'instances':'pods'}/${encodeURIComponent(c.resourceId)}`;
export async function resource(c,runtime={}){
  const raw=await request(c,route(c),{},runtime);const r=c.kind==='vast'?raw.instances:raw;
  if(String(r?.id)!==c.resourceId)error('RESOURCE_IDENTITY_MISMATCH','Provider response does not match the selected existing resource',409);
  const state=c.kind==='vast'?r.actual_status:r.status;
  if(typeof state!=='string')error('COMPUTE_RESPONSE','Provider did not return a valid resource state',502);
  const running=c.kind==='vast'?state==='running':state==='RUNNING';
  const observation={resourceId:String(r.id),state,running,actions:c.kind==='vast'?['start','stop']:r.actions??[],image:c.kind==='vast'?r.image_uuid:r.image};
  // Never project env, Jupyter tokens, registry credentials, or opaque provider responses.
  if(c.executor?.kind==='owner-ssh'){
    const endpoints=c.kind==='vast'?[{host:r.ssh_host,port:Number(r.ssh_port)}]:Object.values(r.ssh??{});
    observation.executorMatchesResource=endpoints.some(x=>x?.host===c.executor.host&&Number(x.port)===c.executor.port&&(!x.username||x.username===c.executor.user));
  }else if(c.executor?.kind==='jupyter'){
    // Jupyter proxies may not appear in provider responses; require explicit owner binding in Settings.
    observation.executorMatchesResource=null;
  }
  observation.state=clean(state,c,runtime);observation.image=typeof observation.image==='string'?clean(observation.image,c,runtime):null;
  observation.actions=Array.isArray(observation.actions)?observation.actions.filter(a=>['start','stop','restart','terminate'].includes(a)):[];return observation;
}
export async function transition(c,action,runtime={}){
  if(!['start','stop'].includes(action))error('COMPUTE_POLICY','Only start/stop of an explicit existing resource is supported');
  const r=await resource(c,runtime);if(!r.actions.includes(action))error('COMPUTE_STATE','The provider does not offer this transition in the current state',409);
  if(c.kind==='vast'){
    const out=await request(c,route(c),{method:'PUT',body:{state:action==='start'?'running':'stopped'}},runtime);
    if(out.success!==true)error('COMPUTE_REMOTE','Vast did not accept the existing-resource state request',502);
  }else await request(c,`${route(c)}/action`,{method:'POST',body:{action}},runtime);
  return {status:'requested',action,resourceId:c.resourceId,retainedStorage:'May remain billed; no deletion requested'};
}
