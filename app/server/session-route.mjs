import {randomUUID} from 'node:crypto';
import {digest} from '../guarded-runtime/profile.mjs';
import {PURPOSE,NATIVE_NAMES,toolManifest,bindingFor} from '../session-tools/contract.mjs';
import {openSessionNativeGateway} from '../session-tools/native-gateway.mjs';
import {digest as taskDigest} from './agui.mjs';

const TYPE='session-route.intent',same=(a,b)=>digest(a??null)===digest(b??null);
const fail=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};
const exact=(v,keys)=>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('SESSION_ROUTE_INPUT');};
const find=(s,key,id,p)=>s[key].find(x=>x.id===id&&(p===undefined||x.projectId===p))??fail('SESSION_ROUTE_SCOPE');
const sync=(fn,...args)=>{const v=fn(...args);if(v?.then)fail('SESSION_ROUTE_SYNC');return v;};
const mixed=['adaptiveContext','assistanceContext','relayContext','goalContext','proactiveContext','workspaceContext','researchContext','researchComponentContext','frontendContext','sessionRoleContext'];
const scope={paths:['.'],capabilities:['session_children','session_prompt']};
const taskDefinition=t=>Object.fromEntries(['id','projectId','title','description','planId','phaseId','botId','dependsOn','evidence','artifactIds'].map(k=>[k,t[k]??null]));

/** Private root facade; canonical T3 alone owns reservation/turns. Human approval
 * and all live native capabilities stay in this process, never in JSON state. */
export function createSessionRoute({store,authorizeOwner,policy,getGuarded,getT3,getRoles,getMcp,clock=Date.now}){
  const approvals=new Map(),gateways=new Map(),revoked=new Set();let closed=false;
  function owner(i,caller){const who=sync(authorizeOwner,{action:'session-route',projectId:i.projectId},caller);if(who?.kind!=='human'||who.role!=='owner')fail('SESSION_ROUTE_OWNER_REQUIRED');}
  const rowFor=(s,i)=>s.events.find(e=>e.type===TYPE&&e.context.operationId===i.operationId);
  function childPin(s,p,child){
    exact(child,['conversationId','botId']);const c=find(s,'conversations',child.conversationId,p),b=find(s,'bots',child.botId,p),binding=c.bindings?.[b.id],role=getRoles().captureRole(s,{projectId:p,conversationId:c.id,botId:b.id});
    if(b.status==='retired'||c.kind==='private'&&c.botId!==b.id||!binding?.threadId||!binding.t3ProjectId||binding.botId!==b.id||!role)fail('SESSION_ROUTE_CHILD_REQUIRED');
    return {...child,role,bindingDigest:digest({threadId:binding.threadId,t3ProjectId:binding.t3ProjectId,botId:binding.botId,selection:binding.selection})};
  }
  function snapshot(s,i){
    const p=find(s,'projects',i.projectId),t=find(s,'tasks',i.taskId,p.id),b=find(s,'bots',t.botId,p.id),c=find(s,'conversations',i.conversationId,p.id),plan=find(s,'plans',t.planId,p.id);
    const role=getRoles().captureRole(s,{projectId:p.id,conversationId:c.id,botId:b.id});
    if(!plan.approved||b.status==='retired'||c.kind==='private'&&c.botId!==b.id||role?.role!=='orchestrator')fail('SESSION_ROUTE_APPROVED_ROLE_REQUIRED');
    return {taskDefinition:digest(taskDefinition(t)),taskRevision:t.revision,plan:digest(plan),bot:digest(b),conversation:digest({id:c.id,kind:c.kind,botId:c.botId??null}),role,settings:digest({workspace:p.workspace,profile:p.profile}),selected:digest(sync(policy.observe,s,{projectId:p.id}))};
  }
  function validateContext(s,i,{run,replay=false}={}){
    const row=rowFor(s,i),c=i.sessionContext;
    if(!row&&!c&&!run?.sessionContext)return null;
    if(!row||!c||!same(c,row.context)||i.projectId!==c.projectId||i.taskId!==c.taskId||i.conversationId!==c.conversationId||mixed.some(k=>i[k]||run?.[k]))fail('SESSION_ROUTE_CONTEXT');
    if(replay){if(!run||!same(run.sessionContext,c)||row.runId!==run.id||row.attemptId!==run.attemptId)fail('SESSION_ROUTE_CONTEXT');return structuredClone(c);}
    if(closed||revoked.has(row.id)||!approvals.has(row.id)||!['approved','dispatching','dispatched'].includes(row.status)||clock()>=c.expiresAt)fail('SESSION_ROUTE_INACTIVE');
    owner(c,approvals.get(row.id));const observed=snapshot(s,c);
    if(!same({...observed,taskRevision:c.snapshot.taskRevision},c.snapshot))fail('SESSION_ROUTE_CHANGED');
    for(const pin of c.children)if(!same(childPin(s,c.projectId,{conversationId:pin.conversationId,botId:pin.botId}),pin))fail('SESSION_ROUTE_CHILD_CHANGED');
    if(run){const task=find(s,'tasks',run.taskId,run.projectId);if(!same(run.sessionRole,c.snapshot.role)||row.runId&&row.runId!==run.id||run.stopRequest||run.stopRequested||!['submitting','running'].includes(run.status)||taskDigest(task)!==(run.guardedTaskSnapshot??run.guardedReservedTaskSnapshot)||!same(run.selection,c.selection))fail('SESSION_ROUTE_RUN_CHANGED');}
    return structuredClone(c);
  }
  function requestForInput(s,i){const c=validateContext(s,i);return c?{projectId:c.projectId,taskId:c.taskId,purpose:PURPOSE,envelopeDigest:digest(c),identitySnapshot:c.identitySnapshot,scope:structuredClone(scope),limits:{maxRunMs:c.maxMs,maxTokens:null,maxCost:null},deadlineAt:c.expiresAt}:null;}
  function validate(s,{run,input}){validateContext(s,input??run,{run});return true;}
  function current(runId,s=store.read()){
    const r=find(s,'runs',runId);validateContext(s,r,{run:r});const n=getGuarded()?.privateSnapshot(runId),p=n?.profile,c=r.sessionContext;
    if(!p||p.purpose!==PURPOSE||p.runId!==r.id||p.attemptId!==r.attemptId||p.threadId!==r.threadId||p.envelopeDigest!==digest(c)||p.identitySnapshot!==c.identitySnapshot||p.manifestDigest!==digest(toolManifest())||!same(p.scope,{...scope,maxBytes:65536})||p.expiresAt>c.expiresAt||clock()>=p.expiresAt)fail('SESSION_ROUTE_NATIVE_REQUIRED');return n;
  }
  function qualifyRun(s,r){
    const n=current(r.id,s),p=n.profile,a=n.attestation,thread=n.providerThread,turn=n.providerTurn;
    if(!n.live||!a||a.purpose!==PURPOSE||a.profileDigest!==digest(p)||a.binarySha256!==p.route.opencodeBinarySha256||a.manifestDigest!==p.manifestDigest||a.contextDigest!==p.contextDigest||a.policyGeneration!==p.policyGeneration||a.toolGeneration!==p.toolGeneration||a.sessionID!==thread?.nativeThreadRef?.nativeId||!Number.isSafeInteger(a.pid)||a.pid<1||!same(a.names,NATIVE_NAMES)||!a.evidenceId?.startsWith('orchestrator-session-v1:')||!n.phases?.includes('openSession')||!n.phases?.includes('ensureThread')||thread?.appThreadId!==r.threadId||turn?.runAttemptId!==r.attemptId||turn?.nodeId!==r.rootNodeId||turn?.providerThreadId!==thread.id||turn.status!=='running'||r.nativeProviderThreadId!==thread.id||r.nativeProviderTurnId!==turn.id)fail('SESSION_ROUTE_ATTESTATION_REQUIRED');
    return {purpose:PURPOSE,manifestDigest:p.manifestDigest,profileDigest:digest(p),attestationDigest:digest(a),binding:bindingFor({projectId:r.projectId,runId:r.id,attemptId:r.attemptId,threadId:r.threadId,providerThreadId:thread.id,providerTurnId:turn.id,nativeSessionId:thread.nativeThreadRef.nativeId,nativeTurnId:turn.nativeTurnRef?.nativeId,identityKind:'private-adapter'})};
  }
  function reserve(s,{run,input}){const c=validateContext(s,input,{run}),row=rowFor(s,input);if(row.status!=='dispatching')fail('SESSION_ROUTE_ALREADY_USED');row.runId=run.id;row.attemptId=run.attemptId;row.status='dispatched';return c;}
  function onEvent(s,{run}){
    if(!run.sessionContext||run.status!=='running')return;
    qualifyRun(s,run);const row=rowFor(s,run),caller=approvals.get(row.id);
    for(const child of row.context.children)getRoles().bindInTransaction(s,{projectId:run.projectId,operationId:`session-intent-child:${row.id}:${child.conversationId}:${child.botId}`,parentRunId:run.id,childConversationId:child.conversationId,childBotId:child.botId},caller);
  }
  async function createSessionGateway({profile,assertCurrent,withFence,authorizePhase}){
    if(gateways.has(profile.runId))fail('SESSION_ROUTE_ALREADY_BOUND');let descriptor,closing;
    const gateway=await openSessionNativeGateway({assertCurrent,withFence,authorizePhase,
      bindingProvider(native,p){const s=store.read(),r=find(s,'runs',p.runId),q=qualifyRun(s,r);if(!same(p,current(r.id,s).profile)||native.sessionId!==q.binding.nativeSessionId)fail('SESSION_ROUTE_BINDING');return q.binding;},
      attachmentProvider(binding,_native,p){if(!descriptor){descriptor=getMcp().issueForRun(find(store.read(),'runs',p.runId),binding);descriptor={...descriptor,expiresAt:Math.min(descriptor.expiresAt,p.expiresAt)};}return descriptor;},
      onClose(){descriptor?.revoke();gateways.delete(profile.runId);}});
    const owned={...gateway,close(){return closing??=gateway.close();}};gateways.set(profile.runId,owned);return owned;
  }
  function inputFor(row){const c=row.context;return {projectId:c.projectId,taskId:c.taskId,conversationId:c.conversationId,operationId:c.operationId,sessionContext:c};}
  async function createIntent(i,caller){
    exact(i,['projectId','taskId','conversationId','children','operationId','maxMs']);owner(i,caller);
    if(!i.operationId||!Array.isArray(i.children)||!i.children.length||i.children.length>8||new Set(i.children.map(c=>`${c.conversationId}:${c.botId}`)).size!==i.children.length)fail('SESSION_ROUTE_INPUT');
    const maxMs=i.maxMs??300000;if(!Number.isSafeInteger(maxMs)||maxMs<10000||maxMs>900000)fail('SESSION_ROUTE_LIMIT');
    const result=await store.transaction(s=>{owner(i,caller);const prior=s.receipts.find(e=>e.operationId===i.operationId);if(prior){if(prior.type!==TYPE||prior.fingerprint!==digest(i))fail('OPERATION_REUSE');return find(s,'events',prior.intentId);}
      if(s.events.some(e=>e.operationId===i.operationId)||s.runs.some(r=>r.operationId===i.operationId))fail('OPERATION_REUSE');
      const snap=snapshot(s,i),task=find(s,'tasks',i.taskId,i.projectId);if(!['ready','backlog'].includes(task.status))fail('SESSION_ROUTE_TASK_REQUIRED');
      const children=i.children.map(c=>childPin(s,i.projectId,c));if(children.some(c=>c.conversationId===i.conversationId))fail('SESSION_ROUTE_CHILD_REQUIRED');
      const id=randomUUID(),context={version:1,purpose:PURPOSE,intentId:id,projectId:i.projectId,taskId:i.taskId,conversationId:i.conversationId,botId:task.botId,snapshot:snap,children,selection:structuredClone(find(s,'projects',i.projectId).profile.provider),operationId:randomUUID(),maxMs,expiresAt:clock()+maxMs};context.identitySnapshot=digest({projectId:context.projectId,taskId:context.taskId,conversationId:context.conversationId,role:snap.role,children,snapshot:snap});
      const row={id,type:TYPE,projectId:i.projectId,context,status:'approved',createdAt:clock()};s.events.push(row);s.receipts.push({type:TYPE,projectId:i.projectId,operationId:i.operationId,intentId:id,fingerprint:digest(i)});return row;});
    if(result.status==='approved')approvals.set(result.id,caller);return {intentId:result.id,operationId:result.context.operationId,status:result.status,expiresAt:result.context.expiresAt};
  }
  async function start(i,caller){exact(i,['projectId','intentId','operationId']);owner(i,caller);let dispatch=false;const row=await store.transaction(s=>{const row=find(s,'events',i.intentId,i.projectId);if(row.type!==TYPE||row.context.operationId!==i.operationId)fail('SESSION_ROUTE_CONTEXT');if(row.status!=='approved')return row;validateContext(s,inputFor(row));row.status='dispatching';dispatch=true;return row;});if(!dispatch)return {intentId:row.id,status:row.status,runId:row.runId??null};const r=await getT3().startRun(inputFor(row));return {intentId:row.id,status:r.status,runId:r.id,attemptId:r.attemptId};}
  async function cancel(i,caller){
    exact(i,['projectId','intentId','operationId']);owner(i,caller);
    const row=await store.transaction(s=>{owner(i,caller);const row=find(s,'events',i.intentId,i.projectId);if(row.type!==TYPE||row.context.operationId!==i.operationId)fail('SESSION_ROUTE_CONTEXT');row.status='cancelled';return row;});
    revoked.add(row.id);approvals.delete(row.id);
    await closeRun(row.runId);if(row.runId)await getT3().stop(row.runId);
    return {intentId:row.id,status:'cancelled',runId:row.runId??null};
  }
  function closeRun(id){revoked.add(store.read().runs.find(r=>r.id===id)?.sessionContext?.intentId);return gateways.get(id)?.close()??Promise.resolve();}
  async function invalidateForRestore(){for(const id of approvals.keys())revoked.add(id);approvals.clear();await Promise.allSettled([...gateways.values()].map(g=>g.close()));}
  async function recover(){approvals.clear();await store.transaction(s=>{for(const row of s.events.filter(e=>e.type===TYPE)){row.status='unknown';row.restoreReviewRequired=true;}});}
  return Object.freeze({validateContext,validate,requestForInput,reserve,qualifyRun,onEvent,createSessionGateway,createIntent,start,cancel,closeRun,invalidateForRestore,recover,async close(){closed=true;await invalidateForRestore();}});
}

export function mergeSessionRouteSafety(restored,previous){
  for(const e of previous.events.filter(e=>e.type===TYPE)){const old=restored.events.find(x=>x.id===e.id);if(old&&!same(old.context,e.context))fail('SESSION_ROUTE_RESTORE_CONFLICT');if(old)Object.assign(old,structuredClone(e));else restored.events.push(structuredClone(e));}
  for(const e of restored.events.filter(e=>e.type===TYPE)){e.status='unknown';e.restoreReviewRequired=true;}
  for(const r of previous.receipts.filter(r=>r.type===TYPE)){const old=restored.receipts.find(x=>x.operationId===r.operationId);if(old&&!same(old,r))fail('SESSION_ROUTE_RESTORE_CONFLICT');if(!old)restored.receipts.push(structuredClone(r));}
  for(const r of previous.runs.filter(r=>r.sessionContext)){const i=restored.runs.findIndex(x=>x.id===r.id),copy=structuredClone(r);if(['submitting','running','waiting'].includes(copy.status))copy.status='unknown';if(i<0)restored.runs.push(copy);else restored.runs[i]=copy;}return restored;
}
