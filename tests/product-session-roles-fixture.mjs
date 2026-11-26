import {mkdtemp,rm} from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import {openStore} from '../app/server/store.mjs';
import {command,entity,find,changed} from '../app/server/domain.mjs';
import {createSessionRoleService} from '../app/server/session-roles.mjs';
import {reserveBudget,validateBudgetAdmission} from '../app/budgets/index.mjs';

export const gate=()=>{let release,enter;return {promise:new Promise(r=>release=r),entered:new Promise(r=>enter=r),release,enter};};

// Real SQLite, domain commands and Budget ledger; the native conversation
// OWNER LIFECYCLE below is explicitly INJECTED, not a provider or T3 attachment.
// It exercises reserve → async setup → final synchronous fences → observation.
export async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-session-roles-'));let store=await openStore(dir),roles,qualifier;
  const qualifyRun=(s,r)=>qualifier?.(s,r);
  const handles=new WeakMap(),owner={},ownerState={active:true};handles.set(owner,{kind:'owner'});
  const authorize=(request,caller)=>{const who=handles.get(caller);if(who?.kind==='owner')return ownerState.active?who:null;if(!who||who.active&&who.active(request.state)!==true)return null;return who;};
  const callerForRun=(r,{active}={})=>{const caller={};handles.set(caller,{kind:'run',runId:r.id,attemptId:r.attemptId,projectId:r.projectId,conversationId:r.conversationId,active});return caller;};
  const create=async(type,projectId,data)=>(await command(store,{operationId:crypto.randomUUID(),type,projectId,data})).entity;
  const p=await create('project.create',null,{name:'Session role engineering fixture',workspace:path.join(dir,'workspace')}),q=await create('project.create',null,{name:'Foreign fixture',workspace:path.join(dir,'other')});
  const selection={instanceId:'fixture-provider',connectionId:'fixture-connection',model:'fixture-model',options:[]};
  const bot=await create('bot.create',p.id,{name:'Parent',kind:'resident'}),childBot=await create('bot.create',p.id,{name:'Child',kind:'resident'}),foreignBot=await create('bot.create',q.id,{name:'Foreign',kind:'resident'});
  const chat=await create('conversation.create',p.id,{name:'Parent chat',kind:'private',botId:bot.id}),child=await create('conversation.create',p.id,{name:'Child chat',kind:'private',botId:childBot.id}),foreign=await create('conversation.create',q.id,{name:'Foreign chat',kind:'private',botId:foreignBot.id});
  let parent=await store.transaction(s=>{for(const c of [chat,child])find(s,'conversations',c.id).bindings={[c.botId]:{botId:c.botId,threadId:`thread-${c.id}`,t3ProjectId:'fixture-t3-project',selection:{instanceId:selection.instanceId,model:selection.model,options:selection.options}}};
    find(s,'projects',p.id).profile.provider=selection;
    const r=entity({kind:'conversation',operationId:crypto.randomUUID(),attemptId:crypto.randomUUID(),conversationId:chat.id,botId:bot.id,threadId:`thread-${chat.id}`,providerRunId:'fixture-parent-run',t3ProjectId:'fixture-t3-project',providerInstanceId:selection.instanceId,selection,status:'running'},p.id);s.runs.push(r);return r;});
  const ownerLifecycle={calls:0,effects:[],stopCalls:0,hold:null,beforeReserve:null,loseResponse:false,reconcileStatus:'completed',
    async send(input){
      ownerLifecycle.calls++;await ownerLifecycle.beforeReserve?.(input);
      let r=await store.transaction(s=>{const context=roles.validateDispatch(s,input),role=roles.captureRole(s,input),prior=s.runs.find(x=>x.operationId===input.operationId);if(prior)return prior;
        const r=entity({kind:'conversation',...input,inputText:input.text,sessionRoleContext:context,sessionRole:role,status:'submitting',attemptId:crypto.randomUUID(),providerInstanceId:selection.instanceId,selection},p.id);delete r.text;s.runs.push(r);reserveBudget(s,{run:r,input});return r;});
      if(ownerLifecycle.hold){ownerLifecycle.hold.enter();await ownerLifecycle.hold.promise;}
      try{const s=store.read();r=find(s,'runs',r.id);roles.validateDispatch(s,r);roles.validateRole(s,r);validateBudgetAdmission(s,{run:r,input});
        ownerLifecycle.effects.push({operationId:r.operationId,runId:r.id});
        await store.transaction(s=>{const r=find(s,'runs',ownerLifecycle.effects.at(-1).runId);r.status=ownerLifecycle.loseResponse?'unknown':'running';if(!ownerLifecycle.loseResponse){r.threadId=`thread-${child.id}`;r.providerRunId=`native-${r.id}`;}changed(r);});
        if(ownerLifecycle.loseResponse)throw new Error('fixture response lost after acceptance');
      }catch(e){if(!ownerLifecycle.effects.some(x=>x.runId===r.id))await store.transaction(s=>{find(s,'runs',r.id).status='failed';});throw e;}
      return find(store.read(),'runs',r.id);
    },
    async reconcile({runId}){return store.transaction(s=>{const r=find(s,'runs',runId);if(ownerLifecycle.effects.some(x=>x.runId===r.id)){r.threadId=`thread-${child.id}`;r.providerRunId=`native-${r.id}`;r.status=r.stopRequest?'interrupted':ownerLifecycle.reconcileStatus;r.executedModel='fixture-model';changed(r);}return r;});},
    async stop({runId}){return store.transaction(s=>{const r=find(s,'runs',runId);if(!r.stopRequest){ownerLifecycle.stopCalls++;r.stopRequest={status:'confirmed'};r.status='interrupted';changed(r);}return r;});},
  };
  const make=()=>createSessionRoleService({store,conversations:ownerLifecycle,authorize,qualifyRun});roles=make();
  const assign=(conversationId,botId,role,expectedRevision=0)=>roles.assign({projectId:p.id,operationId:crypto.randomUUID(),conversationId,botId,role,expectedRevision},owner);
  await assign(chat.id,bot.id,'orchestrator');await assign(child.id,childBot.id,'executor');
  // Inject the same immutable reservation snapshot that the real owner mounts.
  parent=await store.transaction(s=>{const r=find(s,'runs',parent.id);r.sessionRole=roles.captureRole(s,r);return r;});
  const bind=()=>roles.bind({projectId:p.id,operationId:crypto.randomUUID(),parentRunId:parent.id,childConversationId:child.id,childBotId:childBot.id},owner),m=await bind();
  const input={projectId:p.id,parentRunId:parent.id,membershipId:m.id,operationId:crypto.randomUUID(),text:'Review the bounded fixture work.'};
  t.after(async()=>{await roles.close();await store.close();await rm(dir,{recursive:true,force:true});});
  return {get store(){return store;},get roles(){return roles;},owner,ownerState,callerForRun,authorize,qualifyRun,setQualifier:fn=>{qualifier=fn;},ownerLifecycle,p,q,bot,childBot,chat,child,foreign,foreignBot,parent,m,input,selection,assign,bind,
    async reopen(){await roles.close();await store.close();store=await openStore(dir);roles=make();await roles.recover();},
  };
}
