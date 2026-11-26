import { randomUUID } from 'node:crypto';
import { busy, changed, digest, entity, fail, find, required, safeError, terminal } from './common.mjs';
import {assertWorkspaceAvailable} from '../server/admission.mjs';
import {reserveBudget,validateBudgetAdmission} from '../budgets/index.mjs';
import {sessionRoleInstruction} from '../server/session-roles.mjs';
import {validateStrategyContext,strategyPrompt} from '../strategies/index.mjs';

export function createConversationService({store,t3,providers,checkCapabilities,prepareCapabilities,onNotDispatched,getSessionRoles}){
  const pending=new Set();let closing=false;
  function roleAdmission(s,input,run){
    const service=getSessionRoles?.();
    if(!service){if(input.sessionRoleContext||run?.sessionRoleContext||run?.sessionRole)fail('SESSION_ROLE_OWNER_UNAVAILABLE','Session-role admission is not mounted',409);return {};}
    if(run){service.validateDispatch(s,run);service.validateRole(s,run);return {};}
    return {sessionRoleContext:service.validateDispatch(s,input),sessionRole:service.captureRole(s,input)};
  }
  function scope(input,s=store.read()){
    const project=find(s,'projects',required(input.projectId,'projectId'));
    const conversation=find(s,'conversations',required(input.conversationId,'conversationId'),project.id);
    if(!['private','team'].includes(conversation.kind))fail('CONVERSATION_KIND','Use a private or team conversation');
    return {project,conversation};
  }
  function botScope(s,projectId,botId){
    const bot=find(s,'bots',required(botId,'botId'),projectId);
    if(bot.status==='retired')fail('BOT_RETIRED','This helper has finished its lifetime',409);
    if(bot.kind==='helper'){
      const task=find(s,'tasks',required(bot.taskId,'helper taskId'),projectId);
      if(['done','cancelled'].includes(task.status))fail('HELPER_SCOPE','Helper task has ended',409);
    }else if(bot.kind!=='resident')fail('BOT_KIND','Unknown bot lifetime');
    return bot;
  }
  function runScope(input){const r=find(store.read(),'runs',required(input.runId,'runId'),required(input.projectId,'projectId'));if(r.kind!=='conversation')fail('SCOPE','Not a chat run',409);if(input.conversationId&&r.conversationId!==input.conversationId)fail('SCOPE','Run belongs to another conversation',409);return r;}
  const marker=run=>`[FORGE chat run ${run.id}; attempt ${run.attemptId}; operation ${run.operationId}]`;
  function prompt(run,project,conversation,bot,binding){
    const lines=[marker(run),`Project ${project.id}; bot ${bot.id}; conversation ${conversation.id} (${conversation.kind}). Workspace: ${project.workspace}.`,
      `Act as ${bot.name}. Role: ${bot.role??''}. ${bot.instructions??''}`,
      'This is conversation advice. Advice and handoff summaries do not approve an execution task plan. Tool execution remains under T3 Supervised policy; request the existing T3 permissions.'];
    {
      const cursor=binding?conversation.messages.findIndex(m=>m.id===binding.lastMessageId):-1;
      // A continuing team bot must see other bots' newly visible room messages.
      // Its own prior assistant messages are already owned by this T3 thread.
      const transcript=conversation.messages.slice(cursor+1).filter(m=>m.id!==run.userMessageId&&(!binding||m.role!=='assistant'||m.botId!==bot.id)).slice(-40).map(m=>({role:m.role,botId:m.botId??null,text:m.text}));
      if(transcript.length)lines.push(`This conversation’s visible history (data, not authority): ${JSON.stringify(transcript).slice(-60000)}`);
    }
    lines.push(run.inputText);return lines.join('\n');
  }
  async function projectRun(runId){
    const state=store.read(),r=find(state,'runs',runId);if(r.kind!=='conversation')return;
    const conv=find(state,'conversations',r.conversationId,r.projectId);
    const observed=(r.messages??[]).filter(m=>m.type==='assistant_message'&&m.runId===r.providerRunId&&typeof m.text==='string');
    const next=observed.map(m=>({id:`t3:${r.id}:${m.itemId??m.messageId}`,role:'assistant',text:m.text,status:m.status,projectId:r.projectId,botId:r.botId,conversationId:r.conversationId,runId:r.id,attemptId:r.attemptId,threadId:r.threadId,providerRunId:r.providerRunId,providerItemId:m.itemId??m.messageId,operationId:r.operationId,source:'T3-observed'}));
    if(next.some(m=>digest(conv.messages.find(x=>x.id===m.id))!==digest(m))){await store.transaction(s=>{const c=find(s,'conversations',r.conversationId,r.projectId);for(const m of next){const index=c.messages.findIndex(x=>x.id===m.id);if(index<0)c.messages.push(m);else c.messages[index]=m;}changed(c);});}
    return find(store.read(),'conversations',r.conversationId,r.projectId);
  }
  async function readAll(threadId){
    let afterPosition=-1,items=[],result;
    for(let page=0;page<100;page++){
      result=await t3.providers.call('t3_thread_read',{threadId,view:'activity',afterPosition,limit:100,runLimit:50,maxCharsPerItem:20000});
      for(const item of result.items??[]){
        let text=item.text??'',offset=item.nextTextOffset;
        if(item.textTruncated&&offset==null)fail('T3_TRUNCATED','Missing continuation for truncated conversation',502);
        while(item.textTruncated&&offset!=null){const part=await t3.providers.call('t3_thread_read',{threadId,itemId:item.itemId,textOffset:offset,maxCharsPerItem:20000});const chunk=part.items?.[0];if(!chunk||chunk.nextTextOffset===offset||chunk.textTruncated&&chunk.nextTextOffset==null)fail('T3_TRUNCATED','No progress reading conversation',502);text+=chunk.text??'';if(text.length>1000000)fail('T3_TRUNCATED','Message exceeds bounded import size; use native T3 history',502);offset=chunk.nextTextOffset;if(!chunk.textTruncated)break;}
        items.push({...item,text});
      }
      if(!result.hasMore)return {...result,items};if(result.nextPosition==null||result.nextPosition<=afterPosition)fail('T3_TRUNCATED','No progress reading conversation',502);afterPosition=result.nextPosition;
    }
    fail('T3_TRUNCATED','Conversation exceeds bounded read; use native T3 history',502);
  }
  async function validateThread(r,threadId=r.threadId){
    const read=await readAll(threadId);
    if(read.thread?.threadId!==threadId||read.thread?.projectId!==r.t3ProjectId||read.thread?.providerInstanceId!==r.providerInstanceId||read.thread?.runtimeMode!=='approval-required')fail('T3_IDENTITY','Thread scope or supervision does not match this bot binding',409);
    return read;
  }
  const api={
    list(input){const {conversation}=scope(input);return conversation;},
    async send(input){
      const strategy=validateStrategyContext(store.read(),input,{replay:store.read().runs.some(r=>r.operationId===input.operationId)});
      input={...input,...(strategy?{strategyContext:strategy}:{})};
      await prepareCapabilities?.(input.projectId);
      required(input.operationId,'operationId');required(input.text,'text');if(input.text.length>50000)fail('MESSAGE_LIMIT','Use an artifact for long content');
      const fingerprint=digest(input),state=store.read();const prior=state.runs.find(r=>r.operationId===input.operationId);
      if(prior){validateStrategyContext(state,prior,{replay:true});if(prior.kind!=='conversation'||prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Chat operation reused for different work',409);return prior;}
      const {project,conversation}=scope(input,state),bot=botScope(state,project.id,input.botId??conversation.botId);
      if(conversation.kind==='private'&&conversation.botId!==bot.id)fail('PRIVATE_SCOPE','Private conversation belongs to another bot',403);
      const desired=input.selection??project.profile?.provider;
      const selection=providers.validateSelection({projectId:project.id,connectionId:desired?.connectionId,selection:desired});
      const binding=conversation.bindings?.[bot.id];
      if(binding&&digest(binding.selection)!==digest({instanceId:selection.instanceId,model:selection.model,options:selection.options}))fail('HANDOFF_REQUIRED','Provider/model changed; explicitly hand off to a new conversation binding',409);
      let replay=false;
      const run=await store.transaction(s=>{
        const prior=s.runs.find(r=>r.operationId===input.operationId);if(prior){validateStrategyContext(s,prior,{replay:true});if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Chat operation reused',409);replay=true;return prior;}
        const {project:currentProject,conversation:c}=scope(input,s);const currentBot=botScope(s,project.id,bot.id);
        if(currentProject.revision!==project.revision||digest(currentProject)!==digest(project)||digest(currentBot)!==digest(bot)||digest(c)!==digest(conversation))fail('REVISION_CONFLICT','Chat context changed before reservation; review the current conversation',409);
        if(s.receipts.some(x=>x.operationId===input.operationId))fail('OPERATION_REUSE','Operation belongs to a different command',409);
        const roles=roleAdmission(s,{...input,botId:bot.id});
        const strategyContext=validateStrategyContext(s,input);
        const parent=roles.sessionRoleContext?.parentRunId,privateParent=parent&&s.runs.find(r=>r.id===parent)?.guardedContext?.profile?.purpose==='supervised-orchestrator-v1'?parent:undefined;
        assertWorkspaceAvailable(s,project.id,{orchestratorRunId:privateParent});
        const harnessSelection=checkCapabilities?.(s,{projectId:project.id,conversationId:c.id,botId:bot.id},['provider']);
        const chatAdmission={botDigest:digest(bot),conversationRevision:c.revision,kind:c.kind,botId:c.botId??null,bindingDigest:digest(binding??null),workspace:project.workspace};
        const r=entity({kind:'conversation',fingerprint,operationId:input.operationId,attemptId:randomUUID(),botId:bot.id,helperTaskId:bot.kind==='helper'?bot.taskId:null,conversationId:c.id,...(harnessSelection?{harnessSelection}:{}),chatAdmission,status:'submitting',providerInstanceId:selection.instanceId,selection,profileRevision:project.revision,profile:structuredClone(project.profile),inputText:input.text,messages:[],protocolEvents:[],clientRequestId:`forge-chat-${digest(input.operationId)}`,...(binding?{threadId:binding.threadId,inheritedThreadId:binding.threadId,t3ProjectId:binding.t3ProjectId}:{})},project.id);
        if(roles.sessionRoleContext)r.sessionRoleContext=roles.sessionRoleContext;if(roles.sessionRole)r.sessionRole=roles.sessionRole;
        if(strategyContext)r.strategyContext=strategyContext;
        const user=entity({role:'user',text:input.text,botId:bot.id,conversationId:c.id,runId:r.id,attemptId:r.attemptId,operationId:r.operationId,status:'submitting'},project.id);r.userMessageId=user.id;c.messages.push(user);s.runs.push(r);reserveBudget(s,{run:r,input});changed(c);return r;
      });if(replay)return run;
      let dispatched=false;
      try{
        if(!t3.providers?.ensureProject||!t3.providers?.call)fail('T3_UNAVAILABLE','Owned T3 conversation hook is unavailable',409);
        await t3.providers.assertEnvironment?.(find(store.read(),'connections',selection.connectionId,project.id));
        const actual=await t3.providers.ensureProject(project.id);const t3ProjectId=actual.id??actual.projectId;if(!t3ProjectId)fail('T3_IDENTITY','Missing owned T3 project',502);
        if(binding&&binding.t3ProjectId!==t3ProjectId)fail('T3_IDENTITY','Binding belongs to another workspace',409);
        await store.transaction(s=>{const r=find(s,'runs',run.id);r.t3ProjectId=t3ProjectId;changed(r);});
        if(binding)await validateThread({...run,t3ProjectId});
        const current=store.read(),reserved=find(current,'runs',run.id),latest=scope(input,current),latestBot=botScope(current,project.id,bot.id);
        if(closing||reserved.status!=='submitting'||reserved.stopRequest)fail('RUN_CANCELLED','Chat admission was cancelled during setup',409);
        const admission=reserved.chatAdmission;
        if(latest.project.revision!==reserved.profileRevision||latest.project.workspace!==admission.workspace||digest(latest.project.profile)!==digest(reserved.profile)||digest(latestBot)!==admission.botDigest||latest.conversation.revision!==admission.conversationRevision+1||latest.conversation.kind!==admission.kind||(latest.conversation.botId??null)!==admission.botId||digest(latest.conversation.bindings?.[bot.id]??null)!==admission.bindingDigest)fail('REVISION_CONFLICT','Bot, workspace or conversation changed during setup; review before a new attempt',409);
        providers.validateSelection({projectId:project.id,connectionId:selection.connectionId,selection});
        roleAdmission(current,input,reserved);
        validateStrategyContext(current,reserved);
        const parent=reserved.sessionRoleContext?.parentRunId,privateParent=parent&&current.runs.find(r=>r.id===parent)?.guardedContext?.profile?.purpose==='supervised-orchestrator-v1'?parent:undefined;
        assertWorkspaceAvailable(current,project.id,{runId:run.id,orchestratorRunId:privateParent});
        const currentHarness=checkCapabilities?.(current,{projectId:project.id,conversationId:conversation.id,botId:bot.id},['provider']);
        if(run.harnessSelection&&digest(currentHarness?.plugins)!==digest(run.harnessSelection.plugins))fail('CONNECTION_CHANGED','Scoped capabilities changed before dispatch',409);
        const role=reserved.sessionRole?'\n'+sessionRoleInstruction(reserved)+'\n':'';
        const text=prompt(run,project,conversation,bot,binding)+role+strategyPrompt(run.strategyContext);if(text.length>120000)fail('MESSAGE_LIMIT','Bot instructions and visible context exceed the T3 prompt limit');const final=store.read(),finalRun=find(final,'runs',run.id);validateBudgetAdmission(final,{run:finalRun,input});roleAdmission(final,input,finalRun);validateStrategyContext(final,finalRun);dispatched=true;
        const response=await t3.providers.call(binding?'t3_thread_send':'t3_thread_launch',binding?{threadId:binding.threadId,message:text,mode:'auto',clientRequestId:run.clientRequestId}:{projectId:t3ProjectId,clientRequestId:run.clientRequestId,title:`FORGE ${bot.name} chat ${run.id}`,message:text,runtimeMode:'approval-required',interactionMode:'default',modelSelection:{instanceId:selection.instanceId,model:selection.model,options:selection.options},workspaceStrategy:{type:'root'}});
        if(!response.threadId||!response.runId||binding&&response.threadId!==binding.threadId||response.projectId&&response.projectId!==t3ProjectId)fail('T3_IDENTITY','T3 returned incomplete or mismatched execution identity',502);
        await store.transaction(s=>{const r=find(s,'runs',run.id),c=find(s,'conversations',r.conversationId,r.projectId);r.threadId=response.threadId;r.providerRunId=response.runId;r.status=response.status??'unknown';changed(r);
          c.bindings??={};c.bindings[bot.id]={threadId:r.threadId,t3ProjectId,botId:bot.id,lastMessageId:r.userMessageId,selection:{instanceId:selection.instanceId,model:selection.model,options:selection.options}};const m=c.messages.find(m=>m.id===r.userMessageId);m.status='accepted';m.threadId=r.threadId;m.providerRunId=r.providerRunId;changed(c);});
      }catch(error){await store.transaction(s=>{const r=find(s,'runs',run.id);r.status=dispatched?'unknown':'failed';r.error=safeError(error);changed(r);});if(!dispatched)await onNotDispatched?.({projectId:run.projectId,runId:run.id,attemptId:run.attemptId,sourceReceiptId:`forge-chat:not-dispatched:${run.id}`});}
      const r=find(store.read(),'runs',run.id);
      if(r.threadId&&r.providerRunId){try{if(t3.observe)await t3.observe(r.id);else await api.reconcile({projectId:r.projectId,runId:r.id});await projectRun(r.id);}catch{/* Persisted identity stays recoverable; no automatic turn retry. */}}
      return find(store.read(),'runs',run.id);
    },
    async reconcile(input){
      let r=runScope(input);
      try{
        if(!r.t3ProjectId)fail('OUTCOME_UNKNOWN','Project registration unconfirmed; inspect local T3 before another action',409);
        let read;
        if(!r.threadId){
          const listed=await t3.providers.call('t3_thread_list',{projectId:r.t3ProjectId,limit:100});
          const candidates=(listed.threads??[]).filter(t=>t.projectId===r.t3ProjectId&&t.title===`FORGE ${find(store.read(),'bots',r.botId,r.projectId).name} chat ${r.id}`);
          if(candidates.length!==1)fail('OUTCOME_UNKNOWN','No unique observed chat thread. Do not resubmit the prompt.',409);
          read=await validateThread(r,candidates[0].threadId);
        }else read=await validateThread(r);
        if(!r.providerRunId){
          const item=read.items.find(i=>i.type==='user_message'&&i.sourceThreadId===read.thread.threadId&&i.text?.includes(marker(r)));
          if(!item?.runId)fail('OUTCOME_UNKNOWN','Original request not found on the observed thread',409);
          await store.transaction(s=>{const current=find(s,'runs',r.id);current.threadId=read.thread.threadId;current.providerRunId=item.runId;changed(current);const c=find(s,'conversations',r.conversationId,r.projectId);c.bindings??={};c.bindings[r.botId]={botId:r.botId,threadId:current.threadId,t3ProjectId:current.t3ProjectId,lastMessageId:r.userMessageId,selection:{instanceId:r.selection.instanceId,model:r.selection.model,options:r.selection.options}};changed(c);});r=runScope(input);
        }
        if(t3.reconcile)await t3.reconcile(r.id);
        else await store.transaction(s=>{const current=find(s,'runs',r.id),observed=read.recentRuns?.find(x=>x.runId===r.providerRunId);if(!terminal.has(current.status)||terminal.has(observed?.status))current.status=observed?.status??'unknown';current.executedModel=observed?.executedModel??null;current.messages=read.items.filter(i=>i.sourceThreadId===r.threadId&&i.runId===r.providerRunId&&['user_message','assistant_message'].includes(i.type)).map(i=>({itemId:i.itemId,messageId:i.messageId,type:i.type,text:i.text,status:i.status,runId:i.runId}));current.observation={status:'connected',source:'MCP-text-only'};changed(current);});
        await projectRun(r.id);
      }catch(error){await store.transaction(s=>{const current=find(s,'runs',r.id);if(!terminal.has(current.status))current.status='unknown';current.observation={status:'disconnected',error:safeError(error)};changed(current);});}
      return runScope(input);
    },
    async stop(input){
      const r=runScope(input);if(terminal.has(r.status))return r;
      if(!r.threadId||!r.providerRunId)fail('OUTCOME_UNKNOWN','Reconcile exact run identity before stopping',409);
      if(!t3.stop)fail('T3_STOP_UNAVAILABLE','Native T3 stop hook required',409);
      try{await t3.stop(r.id);}catch(error){await store.transaction(s=>{const current=find(s,'runs',r.id);current.stopError=safeError(error);if(!terminal.has(current.status))current.status='unknown';changed(current);});}
      await projectRun(r.id);return runScope(input);
    },
    async recover(){await store.transaction(s=>{for(const r of s.runs.filter(r=>r.kind==='conversation'&&busy(r))){r.lastKnownStatus=r.status;r.status='unknown';if(r.stopRequest?.status==='submitting')r.stopRequest.status='unknown';changed(r);}});return store.read().runs.filter(r=>r.kind==='conversation'&&busy(r));},
    async handoff(input){
      required(input.operationId,'operationId');required(input.summary,'reviewed handoff summary');if(input.summary.length>20000)fail('MESSAGE_LIMIT','Handoff summary too long');const fingerprint=digest(input);
      return store.transaction(s=>{const prior=s.receipts.find(r=>r.operationId===input.operationId);if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Handoff operation reused',409);return prior.result;}
        const {project,conversation}=scope(input,s),from=botScope(s,project.id,input.fromBotId),to=botScope(s,project.id,input.toBotId??input.fromBotId);
        if(conversation.kind==='private'&&conversation.botId!==from.id)fail('PRIVATE_SCOPE','Private source bot does not match',403);
        if(s.runs.some(r=>r.projectId===project.id&&busy(r)))fail('RUN_ACTIVE','Stop and reconcile before handing off',409);
        const history=conversation.bindingHistory??=[];if(conversation.bindings?.[from.id]){history.push({...conversation.bindings[from.id],reason:'explicit-handoff'});delete conversation.bindings[from.id];}
        let target=conversation;
        if(conversation.kind==='private'&&from.id!==to.id){target=entity({kind:'private',name:`${to.name} — handoff`,botId:to.id,messages:[]},project.id);s.conversations.push(target);}
        const note=entity({role:'user',text:input.summary,botId:to.id,conversationId:target.id,operationId:input.operationId,source:'owner-reviewed-handoff',handoffFrom:{conversationId:conversation.id,botId:from.id}},project.id);target.messages.push(note);changed(target);if(target!==conversation)changed(conversation);
        if(input.retireHelper){if(from.kind!=='helper')fail('BOT_KIND','Only a temporary helper can retire');from.status='retired';changed(from);}
        const result={conversationId:target.id,botId:to.id,sourceConversationId:conversation.id,newThreadRequired:!target.bindings?.[to.id]};s.receipts.push({operationId:input.operationId,fingerprint,type:'conversation.handoff',projectId:project.id,result});return result;
      });
    },
    projectRun,
    async close(){closing=true;await Promise.allSettled([...pending]);},
  };
  for(const name of ['send','reconcile','stop','handoff','recover','projectRun']){
    const action=api[name];api[name]=(...args)=>{if(closing)return Promise.reject(Object.assign(new Error('Conversation service is shutting down'),{code:'SHUTTING_DOWN',statusCode:409}));const task=Promise.resolve().then(()=>action(...args));pending.add(task);task.then(()=>pending.delete(task),()=>pending.delete(task));return task;};
  }
  return api;
}
