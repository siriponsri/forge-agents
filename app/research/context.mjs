import {record,records,verifyTrial,digest,canonical,exact,fail,activeTrial} from './contracts.mjs';
export function buildResearchContext(state,{projectId,trialId}){
  const t=record(state,'trial',trialId,projectId),e=record(state,'experiment',t.manifest.experimentId,projectId);verifyTrial(t,e);
  const m=t.manifest;
  return {version:1,experimentId:e.id,trialId:t.id,configDigest:e.configDigest,manifestDigest:t.manifestDigest,split:m.dataset.split,adapterId:e.config.adapter.id,adapterVersion:e.config.adapter.version,policyVersion:m.policyVersion,workspaceId:m.workspaceId,contextPolicyDigest:m.contextPolicyDigest};
}
export function researchContextPolicy(state,{projectId,components}){
  const provider=state.projects.find(p=>p.id===projectId)?.profile?.provider;
  if(!provider?.instanceId||!provider?.model)fail('RESEARCH_CONTEXT_POLICY','Exact project provider/model route required',409);
  const route={providerId:provider.instanceId,modelId:provider.model};
  const policy=state.events.filter(e=>e.type==='context.policy'&&e.projectId===projectId&&digest(e.route)===digest(route)).at(-1)??null;
  return {version:1,mode:policy?'forge-prefix':'native-managed',route,policy:policy?structuredClone(policy):null,components:structuredClone(components),nativeContract:policy?null:'forge-context-native-passthrough/1'};
}
// Mandatory seam in BOTH canonical T3 reservation and final dispatch checks.
// Never call this on a body value without resolving canonical trial authority.
export function admitResearchTrial(state,input){
  const bound=records(state,'trial',input.projectId).find(t=>t.runOperationId===input.operationId||t.manifest.workspaceId===input.workspaceContext?.workspaceId&&t.manifest.execution==='agent');
  if(input.researchContext===undefined){if(bound)fail('RESEARCH_CONTEXT','Research admission cannot be stripped',409);return null;}
  exact(input.researchContext,['version','experimentId','trialId','configDigest','manifestDigest','split','adapterId','adapterVersion','policyVersion','workspaceId','contextPolicyDigest']);
  const t=record(state,'trial',input.researchContext.trialId,input.projectId),e=record(state,'experiment',t.manifest.experimentId,input.projectId);verifyTrial(t,e);
  if(canonical(input.researchContext)!==canonical(buildResearchContext(state,{projectId:input.projectId,trialId:t.id}))||t.manifest.execution!=='agent'||!['reserved','dispatching','running'].includes(t.status)||t.stopRequested||t.restoreReviewRequired||t.runOperationId!==input.operationId||t.manifest.taskId!==input.taskId||!input.workspaceContext||t.manifest.workspaceId!==input.workspaceContext.workspaceId)fail('RESEARCH_CONTEXT','Stale, foreign or unbound research admission',409);
  if(digest(researchContextPolicy(state,{projectId:input.projectId,components:t.manifest.components}))!==t.manifest.contextPolicyDigest)fail('RESEARCH_CONTEXT_POLICY','Declared context policy changed before dispatch',409);
  if(t.deadlineAt!==null&&Date.now()>=t.deadlineAt)fail('RESEARCH_LIMIT','Trial elapsed limit reached before dispatch',409);
  const r=state.runs.find(r=>r.operationId===input.operationId);
  if(r&&(r.stopRequest||r.researchContext&&digest(r.researchContext)!==digest(input.researchContext)))fail('RESEARCH_CONTEXT','Canonical run does not retain this context',409);
  return structuredClone(t);
}
export function assertResearchRestoreAvailable(state){if(records(state,'trial').some(activeTrial))fail('RESEARCH_RESTORE_BUSY','Stop and reconcile reserved research trials before restoring',409);}
// Restoring an older snapshot must never erase acknowledged effect identities.
export function mergeResearchSafety(restored,current){
  const next=structuredClone(restored),byId=new Map(next.events.map(e=>[e.id,e]));
  for(const e of current.events.filter(e=>e.type?.startsWith('research.'))){const old=byId.get(e.id);if(!old||e.type==='research.trial'||e.type==='research.operation'){if(old)Object.assign(old,structuredClone(e));else{const copy=structuredClone(e);next.events.push(copy);byId.set(e.id,copy);}}}
  for(const t of records(next,'trial')){if(activeTrial(t)||t.status==='interrupted'){t.restoreReviewRequired=true;t.status='reconcile-required';t.revision++;}}
  const runIds=new Set(records(next,'trial').map(t=>t.runId).filter(Boolean));
  for(const r of current.runs.filter(r=>runIds.has(r.id)||r.researchContext)){const old=next.runs.find(x=>x.id===r.id);if(old)Object.assign(old,structuredClone(r));else next.runs.push(structuredClone(r));}
  const contextIds=new Set(next.runs.filter(r=>r.researchContext).map(r=>r.contextId).filter(Boolean));
  for(const event of current.events.filter(e=>contextIds.has(e.id))){const old=next.events.find(e=>e.id===event.id);if(old)Object.assign(old,structuredClone(event));else next.events.push(structuredClone(event));}
  for(const receipt of current.receipts.filter(r=>r.type?.startsWith('research.')))if(!next.receipts.some(r=>r.operationId===receipt.operationId))next.receipts.push(structuredClone(receipt));
  return next;
}
