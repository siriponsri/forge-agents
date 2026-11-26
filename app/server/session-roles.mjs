import {createHash} from 'node:crypto';
import {entity,find,fail,required,revision,changed} from './domain.mjs';
import {digest as nativeDigest} from '../guarded-runtime/profile.mjs';

// These are advisory working roles. They never confer tool/plan/Budget authority.
export const SESSION_ROLES=Object.freeze(['orchestrator','planner','reviewer','executor','strategist','researcher','designer','tester','assistant']);
const instructions={orchestrator:'Coordinate the approved child sessions of this exact attempt through session_children and session_prompt only. Preserve operation IDs and reconcile uncertain outcomes.',planner:'Develop a concrete plan, dependencies, acceptance criteria and unresolved decisions for Owner review.',reviewer:'Review the actual evidence and changes. Report findings with scope, severity and reproducible checks.',executor:'Implement the approved bounded task and report changed files, verification and remaining gaps.',strategist:'Compare approaches, constraints and tradeoffs; recommend a bounded next action.',researcher:'Collect source-backed findings and distinguish observations, assumptions and unverified claims.',designer:'Design within the project’s existing product and interface constraints; verify real interaction states.',tester:'Verify the acceptance criteria with meaningful checks and report reproducible failures.',assistant:'Help with the scoped conversation and clearly identify decisions that need the Owner.'};
export function sessionRoleInstruction(run){const r=run.sessionRole;if(!r||!SESSION_ROLES.includes(r.role))return '';return `Session working role: ${r.role}. ${instructions[r.role]} This is advisory context. Roles never approve task plans, privileged tools, spending or workspace access. Existing Owner, governance and Budget checks remain authoritative.`;}
const live=new Set(['starting','running','waiting']);
const done=new Set(['completed','failed','cancelled','interrupted','rolled_back','stopped']);
const prefix='session-role.';
const hash=x=>createHash('sha256').update(JSON.stringify(x)??'undefined').digest('hex');
const events=(s,type)=>s.events.filter(e=>e.type===prefix+type);
const assignment=(s,projectId,conversationId,botId)=>events(s,'assignment').filter(e=>e.projectId===projectId&&e.conversationId===conversationId&&e.botId===botId).at(-1);
const binding=c=>({threadId:c?.threadId,t3ProjectId:c?.t3ProjectId,botId:c?.botId,selection:c?.selection});
const bindingHash=c=>hash(binding(c));
const roleView=a=>a?{assignmentId:a.id,projectId:a.projectId,conversationId:a.conversationId,botId:a.botId,role:a.role,roleRevision:a.roleRevision}:null;
const fixedRun=r=>({id:r.id,projectId:r.projectId,attemptId:r.attemptId,conversationId:r.conversationId,botId:r.botId,sessionRole:r.sessionRole,threadId:r.threadId,providerRunId:r.providerRunId,t3ProjectId:r.t3ProjectId,providerInstanceId:r.providerInstanceId,selection:r.selection,...(r.guardedContext?{rootNodeId:r.rootNodeId,nativeProviderThreadId:r.nativeProviderThreadId,nativeProviderTurnId:r.nativeProviderTurnId,nativeThreadRef:r.nativeThreadRef,nativeTurnRef:r.nativeTurnRef,profileDigest:r.guardedContext.profile?nativeDigest(r.guardedContext.profile):null}:{})});
export const sessionRoleRunDigest=r=>hash(fixedRun(r));

// A private adapter has actual provider-thread/turn references, not fabricated
// ordinary orchestration run IDs. Only a trusted synchronous observer can
// qualify its exact purpose, manifest and actual native attestation.
export function qualifySessionRoleRun(s,r,qualifyRun){
  const guarded=Object.keys(r).some(k=>/^guarded/i.test(k)&&r[k]!=null);
  if(r.proactiveContext||r.researchContext||r.frontendContext)fail('SESSION_ROLE_QUALIFICATION','This route has no qualified session-prompt tool manifest',403);
  if(!guarded)return null;
  const q=typeof qualifyRun==='function'?qualifyRun(s,r):null,p=r.guardedContext?.profile;
  const keys=['projectId','runId','attemptId','threadId','providerThreadId','providerTurnId','nativeSessionId','nativeTurnId','identityKind'];
  if(!q||q.then||q.purpose!=='supervised-orchestrator-v1'||p?.purpose!==q.purpose||!['manifestDigest','profileDigest','attestationDigest'].every(k=>/^[a-f0-9]{64}$/.test(q[k]))||q.manifestDigest!==p.manifestDigest||q.profileDigest!==nativeDigest(p)||!q.binding||Object.keys(q.binding).sort().join()!==[...keys].sort().join()||keys.some(k=>typeof q.binding[k]!=='string'||!q.binding[k]||q.binding[k].length>300)||q.binding.identityKind!=='private-adapter')fail('SESSION_ROLE_QUALIFICATION','Current native profile, manifest and attestation proof are required',403);
  const b=q.binding,thread=r.guardedProjection?.providerThread,turn=r.guardedProjection?.providerTurn;
  if(b.projectId!==r.projectId||b.runId!==r.id||b.attemptId!==r.attemptId||b.threadId!==r.threadId||!r.rootNodeId||thread?.appThreadId!==r.threadId||thread?.id!==b.providerThreadId||turn?.id!==b.providerTurnId||turn?.providerThreadId!==thread.id||turn?.nodeId!==r.rootNodeId||turn?.runAttemptId!==r.attemptId||turn?.status!=='running'||r.nativeProviderThreadId!==b.providerThreadId||r.nativeProviderTurnId!==b.providerTurnId||r.nativeThreadRef?.nativeId!==b.nativeSessionId||r.nativeTurnRef?.nativeId!==b.nativeTurnId||thread.nativeThreadRef?.nativeId!==b.nativeSessionId||turn.nativeTurnRef?.nativeId!==b.nativeTurnId)fail('SESSION_ROLE_BINDING','Private adapter references differ from the actual canonical attempt',403);
  return structuredClone(q);
}

function exact(input,keys){
  if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!keys.includes(k)))fail('SESSION_ROLE_INPUT','Use only the fields for this session command');
  for(const k of keys.filter(k=>/Id$/.test(k)&&k!=='operationId'))if(input[k]!==undefined)required(input[k],k);
  return structuredClone(input);
}
function session(s,projectId,conversationId,botId){
  find(s,'projects',projectId);const c=find(s,'conversations',conversationId,projectId),b=find(s,'bots',botId,projectId);
  if(!['private','team'].includes(c.kind)||c.kind==='private'&&c.botId!==botId||b.status==='retired')fail('SESSION_ROLE_SCOPE','Choose an active bot in its own conversation',403);
  if(b.kind==='helper'&&['done','cancelled'].includes(find(s,'tasks',b.taskId,projectId).status))fail('SESSION_ROLE_SCOPE','The helper task has ended',409);
  return c;
}
function bound(s,projectId,conversationId,botId){
  const c=session(s,projectId,conversationId,botId),b=c.bindings?.[botId];
  if(!b?.threadId||!b.t3ProjectId||b.botId!==botId||!b.selection?.instanceId||!b.selection.model)fail('SESSION_ROLE_BINDING','Open this bot’s conversation through Providers first; an owned T3 binding is required',409);
  return b;
}
function parent(s,id,projectId,qualifyRun){
  const r=find(s,'runs',id,projectId);
  if(!live.has(r.status)||r.stopRequest||r.stopRequested||r.restoreReviewRequired)fail('SESSION_ROLE_PARENT_INACTIVE','The parent attempt must be active and unstopped',409);
  session(s,projectId,r.conversationId,r.botId);
  const qualified=qualifySessionRoleRun(s,r,qualifyRun);
  if((qualified?['attemptId','threadId','providerInstanceId']:['attemptId','threadId','providerRunId','t3ProjectId','providerInstanceId']).some(k=>typeof r[k]!=='string'||!r[k]))fail('SESSION_ROLE_BINDING','Reconcile the exact parent native attempt before linking a child',409);
  const a=assignment(s,projectId,r.conversationId,r.botId);
  if(a?.role!=='orchestrator')fail('SESSION_ROLE_ORCHESTRATOR','Assign the orchestrator role to this parent session first',403);
  if(!r.sessionRole||r.sessionRole.role!=='orchestrator'||hash(r.sessionRole)!==hash(roleView(a)))fail('SESSION_ROLE_STALE','Start a new parent attempt with the current orchestrator role; dispatched authority cannot be changed retroactively',409);
  return {run:r,role:roleView(a)};
}
function membership(s,id,projectId){const m=events(s,'membership').find(e=>e.id===id&&e.projectId===projectId);if(!m)fail('SESSION_ROLE_SCOPE','Child membership not found in this project',404);return m;}
function checkMembership(s,m,qualifyRun){
  if(m.status!=='approved'||m.restoreReviewRequired)fail('SESSION_ROLE_MEMBERSHIP','This child link is revoked or requires Owner review after restore',403);
  const p=parent(s,m.parentRunId,m.projectId,qualifyRun);
  if(sessionRoleRunDigest(p.run)!==m.parentDigest||hash(p.role)!==hash(m.parentRole))fail('SESSION_ROLE_STALE','Parent attempt or role changed. Approve a new child link.',409);
  const childRole=roleView(assignment(s,m.projectId,m.childConversationId,m.childBotId));
  if(!childRole||hash(childRole)!==hash(m.childRole)||bindingHash(bound(s,m.projectId,m.childConversationId,m.childBotId))!==m.childBindingHash)fail('SESSION_ROLE_STALE','Child role or owned binding changed. Approve a new child link.',409);
  return p;
}

/** authorize must synchronously resolve a PRIVATE host handle, never JSON identity.
 * conversations is the existing canonical owner, with validateDispatch mounted
 * at reservation AND synchronously at the final native dispatch boundary. */
export function createSessionRoleService({store,conversations,authorize,qualifyRun}){
  if(!store?.transaction||!store.read||typeof authorize!=='function')throw new TypeError('Canonical store and private authority resolver required');
  let closing=false;const pending=new Set();
  const getParent=(s,id,projectId)=>parent(s,id,projectId,qualifyRun),checkLink=(s,m)=>checkMembership(s,m,qualifyRun);
  function identity(s,action,input,caller,ownerOnly=false){
    const who=authorize({action:prefix+action,projectId:input.projectId,conversationId:input.conversationId,parentRunId:input.parentRunId,state:s},caller);
    if(who?.then||!who||!['owner','run'].includes(who.kind))fail('SESSION_ROLE_FORBIDDEN','Authenticated Owner or scoped parent run authority required',403);
    if(who.kind==='owner')return who;
    if(ownerOnly)fail('SESSION_ROLE_OWNER_REQUIRED','Only the human Owner can change roles and approve child membership',403);
    const p=getParent(s,input.parentRunId??who.runId,input.projectId),r=p.run;
    if(who.runId!==r.id||who.attemptId!==r.attemptId||who.projectId!==r.projectId||who.conversationId!==r.conversationId||input.parentRunId&&input.parentRunId!==r.id)fail('SESSION_ROLE_FORBIDDEN','Caller is not this exact parent session and attempt',403);
    return who;
  }
  function prior(s,method,input){
    const receipt=s.receipts.find(r=>r.operationId===input.operationId),fingerprint=hash({method,input});
    if(receipt){if(receipt.type!==prefix+method||receipt.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to a different command',409);return receipt;}
    if(s.runs.some(r=>r.operationId===input.operationId)||s.events.some(e=>e.operationId===input.operationId))fail('OPERATION_REUSE','Operation ID belongs to other work',409);
  }
  function receipt(s,method,input,result){s.receipts.push({type:prefix+method,projectId:input.projectId,operationId:input.operationId,fingerprint:hash({method,input}),result:structuredClone(result)});return result;}
  function commandEvent(s,input){const c=events(s,'prompt').find(e=>e.id===input.commandId&&e.projectId===input.projectId);if(!c)fail('SESSION_ROLE_SCOPE','Prompt command not found in this project',404);return c;}
  function runFor(s,c){const r=s.runs.find(r=>r.operationId===c.dispatchInput.operationId);if(!r)return null;if(r.kind!=='conversation'||r.projectId!==c.projectId||r.conversationId!==c.dispatchInput.conversationId||r.botId!==c.dispatchInput.botId||r.inputText!==c.dispatchInput.text||hash(r.sessionRoleContext)!==hash(c.context))fail('SESSION_ROLE_RUN_CONFLICT','Canonical run does not match the reserved child prompt',409);return r;}
  function view(s,c){const r=runFor(s,c);return {...structuredClone(c),childRun:r?{id:r.id,attemptId:r.attemptId,status:r.status,threadId:r.threadId,providerRunId:r.providerRunId,executedModel:r.executedModel??null}:null};}
  function accessCommand(s,c,action,caller){const who=identity(s,action,{projectId:c.projectId,parentRunId:c.parentRunId},caller);if(who.kind==='run')checkLink(s,membership(s,c.membershipId,c.projectId));}
  async function link(commandId){return store.transaction(s=>{const c=events(s,'prompt').find(x=>x.id===commandId),r=runFor(s,c);if(r){c.childRunId=r.id;c.childAttemptId=r.attemptId;c.status=r.status==='failed'&&!r.providerRunId?'not-dispatched':'linked';changed(c);}return view(s,c);});}
  const api={
    state(raw,caller){const input=exact(raw,['projectId']);const s=store.read();identity(s,'state',input,caller,true);find(s,'projects',input.projectId);return {projectId:input.projectId,roles:[...SESSION_ROLES],assignments:events(s,'assignment').filter(e=>e.projectId===input.projectId&&assignment(s,e.projectId,e.conversationId,e.botId)?.id===e.id),memberships:events(s,'membership').filter(e=>e.projectId===input.projectId).map(m=>{try{checkLink(s,m);return {...m,usable:true};}catch(e){return {...m,usable:false,unavailableReason:e.code};}}),commands:events(s,'prompt').filter(e=>e.projectId===input.projectId).map(c=>view(s,c))};},
    async assign(raw,caller){
      const input=exact(raw,['projectId','operationId','conversationId','botId','role','expectedRevision']);required(input.operationId,'operationId');if(!SESSION_ROLES.includes(input.role))fail('SESSION_ROLE_INPUT','Choose a supported working role');
      return store.transaction(s=>{identity(s,'assign',input,caller,true);const old=prior(s,'assign',input);if(old)return old.result;session(s,input.projectId,input.conversationId,input.botId);const previous=assignment(s,input.projectId,input.conversationId,input.botId);if(input.expectedRevision!==(previous?.roleRevision??0))fail('REVISION_CONFLICT','Role changed; reload before saving',409);
        const a=entity({type:prefix+'assignment',conversationId:input.conversationId,botId:input.botId,role:input.role,roleRevision:(previous?.roleRevision??0)+1},input.projectId);s.events.push(a);return receipt(s,'assign',input,roleView(a));});
    },
    async bind(raw,caller){
      const input=exact(raw,['projectId','operationId','parentRunId','childConversationId','childBotId']);required(input.operationId,'operationId');
      return store.transaction(s=>{identity(s,'bind',input,caller,true);const old=prior(s,'bind',input);if(old)return old.result;const p=getParent(s,input.parentRunId,input.projectId),b=bound(s,input.projectId,input.childConversationId,input.childBotId),a=roleView(assignment(s,input.projectId,input.childConversationId,input.childBotId));
        if(!a)fail('SESSION_ROLE_REQUIRED','Assign a working role to the child first',409);
        if(p.run.conversationId===input.childConversationId||p.run.threadId===b.threadId)fail('SESSION_ROLE_CYCLE','Parent and child must be different sessions and native threads',409);
        const m=entity({type:prefix+'membership',parentRunId:p.run.id,parentAttemptId:p.run.attemptId,parentConversationId:p.run.conversationId,parentBotId:p.run.botId,parentDigest:sessionRoleRunDigest(p.run),parentRole:p.role,childConversationId:input.childConversationId,childBotId:input.childBotId,childRole:a,childBindingHash:bindingHash(b),status:'approved',approvedBy:'human-owner'},input.projectId);
        s.events.push(m);return receipt(s,'bind',input,m);});
    },
    async revoke(raw,caller){const input=exact(raw,['projectId','operationId','membershipId','expectedRevision']);required(input.operationId,'operationId');return store.transaction(s=>{identity(s,'revoke',input,caller,true);const old=prior(s,'revoke',input);if(old)return old.result;const m=membership(s,input.membershipId,input.projectId);revision(m,input.expectedRevision);m.status='revoked';changed(m);return receipt(s,'revoke',input,m);});},
    children(raw,caller){const input=exact(raw,['projectId','parentRunId']),s=store.read();identity(s,'children',input,caller);getParent(s,input.parentRunId,input.projectId);return {projectId:input.projectId,parentRunId:input.parentRunId,children:events(s,'membership').filter(m=>m.projectId===input.projectId&&m.parentRunId===input.parentRunId).flatMap(m=>{try{checkLink(s,m);return [{membershipId:m.id,conversationId:m.childConversationId,botId:m.childBotId,role:m.childRole.role}];}catch{return [];}})};},
    async prompt(raw,caller){
      const input=exact(raw,['projectId','operationId','parentRunId','membershipId','text']);required(input.operationId,'operationId');required(input.text,'text');if(input.text.length>48000)fail('SESSION_ROLE_INPUT','Use an artifact for prompts longer than 48,000 characters');
      let replay=false;
      const c=await store.transaction(s=>{identity(s,'prompt',input,caller);const old=prior(s,'prompt',input);if(old){replay=true;const c=commandEvent(s,{projectId:input.projectId,commandId:old.result.commandId});accessCommand(s,c,'prompt',caller);return c;}
        const m=membership(s,input.membershipId,input.projectId);if(m.parentRunId!==input.parentRunId)fail('SESSION_ROLE_SCOPE','This child was not approved for the current parent run',403);checkLink(s,m);
        const dispatchOperationId='forge-session-prompt-'+hash({projectId:input.projectId,operationId:input.operationId});
        if(s.receipts.some(x=>x.operationId===dispatchOperationId)||s.runs.some(x=>x.operationId===dispatchOperationId))fail('OPERATION_REUSE','Reserved conversation operation ID is already consumed',409);
        const c=entity({type:prefix+'prompt',operationId:input.operationId,parentRunId:m.parentRunId,membershipId:m.id,status:'reserved',stopRequested:false},input.projectId);
        c.context={commandId:c.id,membershipId:m.id,membershipRevision:m.revision,parentRunId:m.parentRunId,parentAttemptId:m.parentAttemptId,parentDigest:m.parentDigest,parentRole:m.parentRole,childRole:m.childRole,childBindingHash:m.childBindingHash};
        c.dispatchInput={projectId:input.projectId,conversationId:m.childConversationId,botId:m.childBotId,operationId:dispatchOperationId,text:input.text,sessionRoleContext:c.context};
        s.events.push(c);receipt(s,'prompt',input,{commandId:c.id});return c;});
      if(replay)return view(store.read(),c);
      // Persist the sole send attempt BEFORE calling the owner. A crash here is
      // uncertain; neither replay nor recovery is allowed to send it again.
      const dispatch=await store.transaction(s=>{const current=commandEvent(s,{projectId:c.projectId,commandId:c.id});identity(s,'prompt',input,caller);if(current.stopRequested){current.status='stopped';changed(current);return false;}checkLink(s,membership(s,c.membershipId,c.projectId));current.status='dispatching';changed(current);return true;});
      if(dispatch){try{if(typeof conversations?.send!=='function')fail('SESSION_ROLE_OWNER_UNAVAILABLE','Canonical conversation owner is not mounted',409);await conversations.send(structuredClone(c.dispatchInput));}catch(error){await store.transaction(s=>{const current=commandEvent(s,{projectId:c.projectId,commandId:c.id});current.status='unknown';current.error={code:/^(SESSION_ROLE_|BUDGET_|WORKSPACE_BUSY$|REVISION_CONFLICT$|HANDOFF_REQUIRED$)/.test(error.code??'')?error.code:'SESSION_ROLE_OUTCOME_UNKNOWN',message:'Delivery is unconfirmed. Reconcile this command; do not resend it.'};changed(current);});}}
      return link(c.id);
    },
    async reconcile(raw,caller){const input=exact(raw,['projectId','commandId']),s=store.read(),c=commandEvent(s,input);accessCommand(s,c,'reconcile',caller);const r=runFor(s,c);if(r&&typeof conversations?.reconcile==='function')await conversations.reconcile({projectId:r.projectId,runId:r.id});if(commandEvent(store.read(),input).stopRequested)return api.stop(input,caller);return link(c.id);},
    async stop(raw,caller){
      const input=exact(raw,['projectId','commandId']);const c=await store.transaction(s=>{const c=commandEvent(s,input);accessCommand(s,c,'stop',caller);c.stopRequested=true;if(c.status==='reserved')c.status='stopped';changed(c);return c;});
      const r=runFor(store.read(),c);if(r&&!done.has(r.status)&&r.threadId&&r.providerRunId){if(typeof conversations?.stop!=='function')fail('SESSION_ROLE_OWNER_UNAVAILABLE','Canonical conversation Stop is not mounted',409);await conversations.stop({projectId:r.projectId,runId:r.id});}return link(c.id);
    },
    // Synchronous owner hook, called inside reservation and immediately before
    // the actual native send. No role payload supplied by JSON can mint this.
    validateDispatch(s,input){
      if(!input.sessionRoleContext){if(events(s,'prompt').some(c=>c.dispatchInput.operationId===input.operationId))fail('SESSION_ROLE_CONTEXT','A reserved child prompt cannot omit its context',403);return null;}
      const c=commandEvent(s,{projectId:input.projectId,commandId:input.sessionRoleContext.commandId});
      if(c.stopRequested||c.status!=='dispatching')fail('SESSION_ROLE_STOPPED','Child prompt is stopped or is no longer pending dispatch',409);
      const expected=c.dispatchInput;
      if(input.operationId!==expected.operationId||input.conversationId!==expected.conversationId||input.botId!==expected.botId||(input.text??input.inputText)!==expected.text||hash(input.sessionRoleContext)!==hash(c.context))fail('SESSION_ROLE_CONTEXT','Prompt does not match its canonical reservation',403);
      const m=membership(s,c.membershipId,c.projectId);checkLink(s,m);if(m.revision!==c.context.membershipRevision)fail('SESSION_ROLE_STALE','Child approval changed during admission',409);
      return structuredClone(c.context);
    },
    captureRole(s,input){return roleView(assignment(s,input.projectId,input.conversationId,input.botId));},
    validateRole(s,run){if(hash(api.captureRole(s,run))!==hash(run.sessionRole??null))fail('SESSION_ROLE_STALE','Session role changed before dispatch. Review a new attempt.',409);return run.sessionRole??null;},
    async recover(){return store.transaction(s=>{for(const c of events(s,'prompt')){const r=runFor(s,c);if(r){c.childRunId=r.id;c.childAttemptId=r.attemptId;c.status='linked';}else if(['reserved','dispatching'].includes(c.status))c.status='unknown';changed(c);}return {recovered:true,resent:0};});},
    async close(){closing=true;await Promise.allSettled([...pending]);},
  };
  for(const method of ['assign','bind','revoke','prompt','reconcile','stop','recover']){const fn=api[method];api[method]=(...args)=>{if(closing)return Promise.reject(Object.assign(new Error('Session roles are shutting down'),{code:'SHUTTING_DOWN',statusCode:409}));const p=Promise.resolve().then(()=>fn(...args));pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};}
  return Object.freeze(api);
}

export function dispatchSessionRoleRequest(service,method,input,caller){if(!['state','assign','bind','revoke','children','prompt','reconcile','stop'].includes(method))fail('NOT_FOUND','Session role operation not found',404);return service[method](input,caller);}

// Invoke inside the existing restore transaction; restored memberships need a
// fresh Owner link and consumed prompt operation identities must never revive.
export function mergeSessionRoleSafety(restored,previous){
  for(const e of previous.events.filter(e=>e.type?.startsWith(prefix))){const old=restored.events.find(x=>x.id===e.id);if(old&&old.type!==e.type)fail('SESSION_ROLE_RESTORE_CONFLICT','Conflicting session role event identity',409);if(old)Object.assign(old,structuredClone(e));else restored.events.push(structuredClone(e));}
  for(const r of previous.receipts.filter(r=>r.type?.startsWith(prefix))){const old=restored.receipts.find(x=>x.operationId===r.operationId);if(old&&(old.type!==r.type||old.fingerprint!==r.fingerprint))fail('SESSION_ROLE_RESTORE_CONFLICT','Conflicting session role receipt identity',409);if(!old)restored.receipts.push(structuredClone(r));}
  for(const m of events(restored,'membership')){m.restoreReviewRequired=true;m.status='revoked';}
  for(const c of events(restored,'prompt')){c.stopRequested=true;if(['reserved','dispatching'].includes(c.status))c.status='unknown';}
  return restored;
}
