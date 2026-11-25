import { appendProtocol, digest } from '../server/agui.mjs';
import { find, changed, now, fail } from '../server/domain.mjs';

export const TERMINAL=new Set(['completed','failed','cancelled','interrupted','rolled_back']);
const ACTIVE=new Set(['preparing','queued','starting','running','waiting']);
export const T3_PROTOCOL_CAPABILITIES=Object.freeze({
  version:'0.1.11',sourceRevision:'59651c1761f6c63e9b6056839067066968e6a406',
  messageSnapshots:true,messageDeltas:true,toolObservations:'native-read-feed',
  frontendToolResults:false,userQuestionAnswers:'t3_pending_request.respond',
  permissionAnswers:'runtime-request.respond (accept once / decline / cancel)',
  reconnect:'explicit-snapshot-no-effect-replay',automaticSseResume:false,
  frontendToolBlocker:'T3 0.1.11 exposes no arbitrary tool-result response payload in MCP or runtime-request.respond (only decision, feedback, answers, attachmentsByQuestionId). t3_thread_send accepts text, not tool-role messages. No frontend tool is advertised or executed.',
});

export function rejectFrontendToolResult(){
  fail('T3_FRONTEND_TOOL_UNSUPPORTED',T3_PROTOCOL_CAPABILITIES.frontendToolBlocker,409,T3_PROTOCOL_CAPABILITIES);
}
export function identity(run){return {projectId:run.projectId,botId:run.botId??null,taskId:run.taskId??null,conversationId:run.conversationId??null,operationId:run.operationId??null,runId:run.id,attemptId:run.attemptId,threadId:run.threadId??null,providerRunId:run.providerRunId??null,providerInstanceId:run.providerInstanceId??run.profile?.provider?.instanceId??null};}
export function projectState(state,run){
  const task=run.taskId?find(state,'tasks',run.taskId,run.projectId):null;
  const refs=key=>state[key].filter(x=>x.projectId===run.projectId).map(x=>({id:x.id,revision:x.revision,...(x.status?{status:x.status}:{}),...(x.jobId?{jobId:x.jobId}:{})}));
  const conversation=run.conversationId?find(state,'conversations',run.conversationId,run.projectId):null;
  return {identity:identity(run),run:{status:run.status,lastKnownStatus:run.lastKnownStatus??null,observation:run.connection?.status??'disconnected',stop:run.stopRequest?.status??null,providerAttempts:run.providerAttempts??[]},task:task?{id:task.id,revision:task.revision,status:task.status}:null,conversation:conversation?{id:conversation.id,revision:conversation.revision,kind:conversation.kind}:null,documents:refs('documents'),reports:refs('reports'),artifacts:refs('artifacts'),pendingInputs:run.pendingInputs??[],pendingApprovals:run.pendingApprovals??[],tools:Object.values(run.toolObservations??{})};
}
export function publishState(state,run,{snapshot=false}={}){
  const next=projectState(state,run),previous=run.protocolState;
  if(snapshot||!previous){
    appendProtocol(state,run,{type:'STATE_SNAPSHOT',snapshot:next},`state:${run.protocolSequence??0}:${digest(next)}`);
  }else{
    const delta=Object.keys(next).filter(key=>digest(previous[key])!==digest(next[key])).map(key=>({op:'replace',path:`/${key}`,value:next[key]}));
    if(delta.length)appendProtocol(state,run,{type:'STATE_DELTA',delta},`delta:${run.protocolSequence??0}:${digest([previous,next])}`);
  }
  run.protocolState=next;
}
function emit(state,run,event,key){return appendProtocol(state,run,event,key);}
function toolArguments(item){
  if(item.type==='dynamic_tool'&&item.toolName&&item.input!==undefined){
    // Codex stores complete item.arguments on item/started, not token fragments.
    // Other providers may leave an unparseable partial string: wait for valid JSON.
    let input=item.input;if(typeof input==='string'){try{input=JSON.parse(input);}catch{return;}}
    return {name:item.toolName,args:JSON.stringify(input)};
  }
  if(item.type==='command_execution'&&typeof item.input==='string'&&item.input)return {name:'command_execution',args:JSON.stringify({command:item.input})};
}
function observeTool(state,run,item){
  const args=toolArguments(item);if(!args)return;
  const id=item.id,prior=run.toolObservations[id];
  if(!prior){
    emit(state,run,{type:'TOOL_CALL_START',toolCallId:id,toolCallName:args.name,parentMessageId:`tool-call:${id}`},`tool:${id}:start`);
    emit(state,run,{type:'TOOL_CALL_ARGS',toolCallId:id,delta:args.args},`tool:${id}:args`);
    emit(state,run,{type:'TOOL_CALL_END',toolCallId:id},`tool:${id}:args-end`);
  }
  // END above proves argument completion only. Missing/cancelled outputs remain
  // explicit observations; a terminal item is never turned into an invented result.
  const resultPresent=Object.hasOwn(item,'output')&&!item.outputOmitted;
  const value={id,name:args.name,argumentsComplete:true,status:item.status,resultObserved:resultPresent&&TERMINAL.has(item.status),...(item.toolNonExecutionKind?{nonExecutionKind:item.toolNonExecutionKind}:{}),...(item.outputIndicatesFailure!==undefined?{outputIndicatesFailure:item.outputIndicatesFailure}:{}),...(item.exitCode!==undefined?{exitCode:item.exitCode}:{})};
  if(prior&&prior.argumentHash!==digest(args.args))value.argumentsChanged=true;
  run.toolObservations[id]={...value,argumentHash:prior?.argumentHash??digest(args.args)};
  if(value.resultObserved){
    const content=typeof item.output==='string'?item.output:JSON.stringify(item.output);
    emit(state,run,{type:'TOOL_CALL_RESULT',toolCallId:id,messageId:`tool-result:${id}`,role:'tool',content},`tool:${id}:result`);
  }
}
function messageView(items){
  const messages=[];
  for(const item of items){
    if(['user_message','assistant_message'].includes(item.type))messages.push({id:item.messageId??item.id??item.itemId,role:item.type==='user_message'?'user':'assistant',content:item.text??''});
    else{
      const args=toolArguments(item);if(!args)continue;
      messages.push({id:`tool-call:${item.id}`,role:'assistant',content:'',toolCalls:[{id:item.id,type:'function',function:{name:args.name,arguments:args.args}}]});
      if(TERMINAL.has(item.status)&&Object.hasOwn(item,'output')&&!item.outputOmitted)messages.push({id:`tool-result:${item.id}`,role:'tool',toolCallId:item.id,content:typeof item.output==='string'?item.output:JSON.stringify(item.output)});
    }
  }
  return messages;
}
function reconcileMessages(state,run,items,{snapshot=false}={}){
  const next=messageView(items),previous=run.protocolMessages??[];
  // A non-prefix edit, deletion, reorder or changed role requires replacement.
  const replacement=previous.some((old,index)=>next[index]?.id!==old.id||next[index]?.role!==old.role||!next[index]?.content.startsWith(old.content)||(old.role==='tool'&&next[index]?.content!==old.content)||digest(next[index]?.toolCalls)!==digest(old.toolCalls));
  if(snapshot||!run.protocolMessages||replacement){
    emit(state,run,{type:'MESSAGES_SNAPSHOT',messages:next},`messages:${run.protocolSequence??0}:${digest(next)}`);
    run.messageStreams=Object.fromEntries(items.filter(i=>i.type==='assistant_message'&&!TERMINAL.has(i.status)).map(i=>[i.messageId??i.id??i.itemId,true]));
  }else{
    for(const message of next){
      const old=previous.find(m=>m.id===message.id);
      if(message.role!=='assistant'||message.toolCalls){if(!old)emit(state,run,{type:'MESSAGES_SNAPSHOT',messages:next},`messages:${digest(next)}`);continue;}
      // A previous authoritative snapshot can already include a partial message.
      if(!old)emit(state,run,{type:'TEXT_MESSAGE_START',messageId:message.id,role:'assistant'},`message:${message.id}:start:${run.messageGeneration??0}`);
      const delta=message.content.slice(old?.content.length??0);
      if(delta)emit(state,run,{type:'TEXT_MESSAGE_CONTENT',messageId:message.id,delta},`message:${message.id}:text:${run.messageGeneration??0}:${digest(message.content)}`);
      run.messageStreams??={};if(!old||delta)run.messageStreams[message.id]=true;
    }
  }
  if(replacement)run.messageGeneration=(run.messageGeneration??0)+1;
  for(const item of items.filter(i=>i.type==='assistant_message'&&TERMINAL.has(i.status))){
    const id=item.messageId??item.id??item.itemId;
    if(run.messageStreams?.[id]){emit(state,run,{type:'TEXT_MESSAGE_END',messageId:id},`message:${id}:end:${run.messageGeneration??0}`);run.messageStreams[id]=false;}
  }
  run.protocolMessages=next;
}
function statusFrom(observation,run){
  const observed=(observation.runs??observation.recentRuns??[]).find(x=>(x.id??x.runId)===run.providerRunId);
  // Never infer this attempt's outcome from a different/latest thread turn.
  if(observed)return observed.status;
  if(observation.thread?.activeRunId===run.providerRunId&&ACTIVE.has(observation.thread.status))return observation.thread.status;
  return 'unknown';
}
export function applyObservation(state,run,observation,{source='native',snapshot=false}={}){
  const thread=observation.thread;
  if((thread?.id??thread?.threadId)!==run.threadId)fail('T3_IDENTITY','Observation belongs to another thread',409);
  if(run.t3ProjectId&&thread.projectId!==run.t3ProjectId)fail('T3_IDENTITY','Observation belongs to another T3 project',409);
  const status=statusFrom(observation,run);
  // A stale concurrent read cannot regress an already confirmed outcome.
  if(!TERMINAL.has(run.status)||TERMINAL.has(status))run.status=status;
  run.lastKnownStatus=run.status;
  run.connection={status:'connected',source,observedAt:now()};
  run.providerInstanceId=thread.providerInstanceId??run.providerInstanceId;
  const observedRun=(observation.runs??observation.recentRuns??[]).find(x=>(x.id??x.runId)===run.providerRunId);
  run.executedModel=observedRun?.executedModel??observedRun?.modelSelection?.model??observedRun?.model??run.executedModel;
  run.providerAttempts=(observation.attempts??[]).filter(x=>x.runId===run.providerRunId).map(x=>({id:x.id,providerThreadId:x.providerThreadId,providerTurnId:x.providerTurnId,providerInstanceId:x.providerInstanceId,status:x.status}));
  let items;
  if(source==='native')items=(observation.turnItems??[]).filter(i=>i.threadId===run.threadId&&i.runId===run.providerRunId).sort((a,b)=>a.ordinal-b.ordinal);
  else{
    // MCP activity text is useful but NOT a structured tool result. A full paged
    // read is used because afterPosition alone misses updates to existing items.
    items=(observation.items??[]).filter(i=>i.sourceThreadId===run.threadId&&i.runId===run.providerRunId).sort((a,b)=>a.position-b.position);
  }
  run.toolObservations??={};
  if(source==='native')for(const item of items)observeTool(state,run,item);
  run.pendingInputs=source==='native'?items.filter(i=>i.type==='user_input_request'&&observation.runtimeRequests?.some(r=>r.id===i.requestId&&r.status==='pending')).map(i=>({requestId:i.requestId,questions:i.questions,responseMode:i.responseMode??'live'})):run.pendingInputs??[];
  run.pendingApprovals=source==='native'?items.filter(i=>i.type==='approval_request'&&observation.runtimeRequests?.some(r=>r.id===i.requestId&&r.status==='pending')).map(i=>({requestId:i.requestId,requestKind:i.requestKind,prompt:i.prompt??null,reason:i.reason??null,options:i.options??[]})):run.pendingApprovals??[];
  const messages=items.filter(i=>['user_message','assistant_message'].includes(i.type));
  reconcileMessages(state,run,items,{snapshot});
  // Only public conversation rows are retained. Never persist opaque reasoning,
  // raw provider sessions, credentials, or an entire native projection.
  run.messages=messages.map(i=>({itemId:i.id??i.itemId,messageId:i.messageId,type:i.type,text:i.text??'',status:i.status,runId:i.runId}));
  run.activities=items.filter(i=>!['reasoning','user_message','assistant_message'].includes(i.type)).map(i=>({itemId:i.id??i.itemId,type:i.type,status:i.status,title:i.title??null,subagentId:i.subagentId??null,childThreadId:i.childThreadId??null}));
  emit(state,run,{type:'CUSTOM',name:'forge.t3.observation',value:{...identity(run),status:run.status,source,executedModel:run.executedModel??null}},`observation:${digest([run.status,source,run.executedModel??null])}`);
  if(!run.terminalEvent&&TERMINAL.has(run.status)){
    if(['failed','rolled_back'].includes(run.status))emit(state,run,{type:'RUN_ERROR',message:`T3 run ${run.status}`,code:`T3_${run.status.toUpperCase()}`},'run:terminal');
    else emit(state,run,{type:'RUN_FINISHED',threadId:run.threadId,runId:run.id,outcome:{type:run.status==='completed'?'success':'cancelled'}},'run:terminal');
    run.terminalEvent=true;
    if(run.taskId){const task=find(state,'tasks',run.taskId,run.projectId);task.status=run.status==='completed'?'review':'blocked';changed(task);}
  }
  publishState(state,run,{snapshot});changed(run);
}
export function markDisconnected(state,run,reason='read-feed-closed'){
  if(run.connection?.status==='disconnected')return;
  run.lastKnownStatus=run.status;
  if(!TERMINAL.has(run.status))run.status='unknown';
  run.connection={status:'disconnected',reason,observedAt:now()};
  emit(state,run,{type:'CUSTOM',name:'forge.observation.disconnected',value:{...identity(run),lastKnownStatus:run.lastKnownStatus,reconnectRequired:true}},`disconnect:${run.protocolSequence??0}`);
  publishState(state,run);changed(run);
}

// The matching private T3 adapter owns this turn. It has no ordinary installed
// orchestration run ID; retain its actual attempt/node/thread/turn references.
export function applyGuardedObservation(state,run,projection){
  const thread=projection.providerThread,turn=projection.providerTurn,terminal=projection.terminal;
  if(!thread||!turn)return;
  if(thread.appThreadId!==run.threadId||turn.providerThreadId!==thread.id||turn.runAttemptId!==run.attemptId||turn.nodeId!==run.rootNodeId)fail('T3_IDENTITY','Guarded observation belongs to another canonical attempt',409);
  run.nativeProviderThreadId=thread.id;run.nativeProviderTurnId=turn.id;run.nativeTurnRef=turn.nativeTurnRef??null;run.nativeThreadRef=thread.nativeThreadRef??null;
  const status=terminal?.status??turn.status;
  if(!TERMINAL.has(run.status)&&status==='running'){
    if(run.status!=='running'){
      const task=find(state,'tasks',run.taskId,run.projectId);
      if(!run.guardedReservedTaskSnapshot||digest(task)!==run.guardedReservedTaskSnapshot){
        run.status='unknown';run.stopRequest??={status:'required',source:'guarded-revision-revoked'};
        const occurrence=state.events.find(e=>e.id===run.proactiveContext?.occurrenceId);if(occurrence){occurrence.stopRequested='APPROVED_TASK_CHANGED';changed(occurrence);}
        appendProtocol(state,run,{type:'CUSTOM',name:'forge.guarded.admission-revoked',value:{reason:'APPROVED_TASK_CHANGED'}},'guarded:task-revoked');
      }else{
        run.status='running';task.status='running';task.threadId=run.threadId;changed(task);run.guardedTaskSnapshot=digest(task);
        appendProtocol(state,run,{type:'RUN_STARTED',threadId:run.threadId,runId:run.id},'guarded:started');
      }
    }
  }
  if(terminal&&TERMINAL.has(status))run.status=status;
  run.connection={status:'connected',source:'guarded-native-adapter',observedAt:now()};run.executedModel=turn.model??run.selection.model;
  const items=projection.turnItems.filter(i=>i.runId===run.id&&i.threadId===run.threadId).sort((a,b)=>(a.ordinal??0)-(b.ordinal??0));
  run.toolObservations??={};for(const item of items)observeTool(state,run,item);reconcileMessages(state,run,items);
  run.messages=items.filter(i=>['user_message','assistant_message'].includes(i.type)).map(i=>({itemId:i.id,messageId:i.messageId,type:i.type,text:i.text??'',status:i.status,runId:run.id}));
  run.activities=items.filter(i=>!['reasoning','user_message','assistant_message'].includes(i.type)).map(i=>({itemId:i.id,type:i.type,status:i.status,title:i.title??null}));
  if(terminal&&!run.terminalEvent){
    appendProtocol(state,run,['failed','rolled_back'].includes(status)?{type:'RUN_ERROR',message:`T3 run ${status}`,code:`T3_${status.toUpperCase()}`}:{type:'RUN_FINISHED',threadId:run.threadId,runId:run.id,outcome:{type:status==='completed'?'success':'cancelled'}},'guarded:terminal');
    run.terminalEvent=true;const task=find(state,'tasks',run.taskId,run.projectId);if(digest(task)===(run.guardedTaskSnapshot??run.guardedReservedTaskSnapshot)){task.status=status==='completed'?'review':'blocked';changed(task);}
  }
  publishState(state,run);changed(run);
}
