import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../app/server/store.mjs';
import { entity, find } from '../app/server/domain.mjs';
import { applyObservation, markDisconnected, publishState } from '../app/protocol/observations.mjs';
import { createProtocolController } from '../app/protocol/controller.mjs';
import { protocolEvents, protocolRecords } from '../app/server/agui.mjs';

// Fixtures use the pinned native projection/MCP shapes. They do not qualify a
// provider or claim tool execution; tests/live-agui-lifecycle.mjs does that.
async function fixture(t){
  const dir=await mkdtemp(path.join(os.tmpdir(),'forge-protocol-fixture-'));
  let store=await openStore(dir);t.after(()=>store.close());
  const task=entity({status:'running',title:'Fixture'},'project-a');
  const run=entity({taskId:task.id,botId:'bot-a',conversationId:'conversation-a',attemptId:'attempt-a',threadId:'thread-a',t3ProjectId:'t3-project-a',providerRunId:'native-run-a',status:'running'},'project-a');
  await store.transaction(s=>{s.tasks.push(task);s.runs.push(run);});
  return {dir,run,store,async restart(){await store.close();store=await openStore(dir);this.store=store;},async apply(observation,options){return store.transaction(s=>applyObservation(s,find(s,'runs',run.id),observation,options));}};
}
function native(status='running',items=[]){return {thread:{id:'thread-a',projectId:'t3-project-a',providerInstanceId:'codex'},runs:[{id:'native-run-a',status,modelSelection:{model:'gpt-6.1-sol'}}],turnItems:items,runtimeRequests:[],attempts:[{id:'native-attempt-a',runId:'native-run-a',providerThreadId:'native-thread-a',providerTurnId:'native-turn-a',status}]};}
function item(type,id,extra={}){return {type,id,ordinal:1,threadId:'thread-a',runId:'native-run-a',status:'running',...extra};}
const text=(value,status='running')=>item('assistant_message','assistant-a',{messageId:'message-a',text:value,status});

test('FIXTURE native tool argument completion precedes an actual result; missing output never becomes success',async t=>{
  const f=await fixture(t),tool=item('dynamic_tool','tool-a',{toolName:'fixture.read',input:{path:'fixture.txt'}});
  await f.apply(native('running',[tool]));
  let events=protocolEvents(f.store.read(),f.run.id);
  assert.deepEqual(events.filter(e=>e.type.startsWith('TOOL_')).map(e=>e.type),['TOOL_CALL_START','TOOL_CALL_ARGS','TOOL_CALL_END']);
  await f.apply(native('running',[{...tool,status:'completed'}]));
  assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='TOOL_CALL_RESULT').length,0);
  await f.apply(native('completed',[{...tool,status:'completed',output:{text:'fixture result'}}]));
  events=protocolEvents(f.store.read(),f.run.id);
  const result=events.find(e=>e.type==='TOOL_CALL_RESULT');assert.deepEqual(JSON.parse(result.content),{text:'fixture result'});
  const snapshot=find(f.store.read(),'runs',f.run.id).protocolMessages;
  assert.equal(snapshot.find(m=>m.role==='tool').toolCallId,'tool-a');
  assert.equal(snapshot[0].toolCalls[0].function.arguments,'{"path":"fixture.txt"}');
  assert.equal(find(f.store.read(),'tasks',f.run.taskId).status,'review');
});

test('FIXTURE partial invalid JSON, failed output, and cancelled non-execution keep distinct semantics',async t=>{
  const f=await fixture(t);
  await f.apply(native('running',[item('dynamic_tool','partial',{toolName:'fixture',input:'{"a":'})]));
  assert.equal(protocolEvents(f.store.read(),f.run.id).some(e=>e.type==='TOOL_CALL_END'),false);
  await f.apply(native('failed',[item('command_execution','cmd',{input:'read fixture.txt',status:'failed',output:'file missing',exitCode:1,outputIndicatesFailure:true}),item('dynamic_tool','cancel',{toolName:'fixture',input:{},status:'cancelled',toolNonExecutionKind:'user-rejected'})]));
  const run=find(f.store.read(),'runs',f.run.id);
  assert.equal(run.toolObservations.cmd.outputIndicatesFailure,true);assert.equal(run.toolObservations.cancel.resultObserved,false);
  assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='RUN_ERROR').length,1);
});

test('FIXTURE message prefixes append once, non-prefix edits replace and replay survives SQLite restart',async t=>{
  const f=await fixture(t);
  await f.apply(native('running',[text('Hello')]));
  await f.apply(native('running',[text('Hello world')]));
  let events=protocolEvents(f.store.read(),f.run.id);assert.equal(events.find(e=>e.type==='TEXT_MESSAGE_CONTENT').delta,' world');
  await f.apply(native('running',[text('Corrected world')]));
  assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='MESSAGES_SNAPSHOT').at(-1).messages[0].content,'Corrected world');
  await f.apply(native('completed',[text('Corrected world','completed')]));
  const before=protocolRecords(f.store.read(),f.run.id);
  await f.restart();await f.apply(native('completed',[text('Corrected world','completed')]));
  assert.deepEqual(protocolRecords(f.store.read(),f.run.id),before);
  assert.equal(new Set(before.map(e=>e.sourceKey)).size,before.length);
  assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='RUN_FINISHED').length,1);
});

test('FIXTURE snapshots/deltas reflect authoritative revisions and exclude secrets/opaque reasoning',async t=>{
  const f=await fixture(t);
  await f.store.transaction(s=>s.documents.push(entity({snapshot:{secretContent:'not selected'},name:'Book',revision:1},'project-a')));
  await f.apply({...native('running',[text('Public'),item('reasoning','opaque',{text:'DO_NOT_EXPOSE'})]),providerSessions:[{token:'SECRET'}]});
  const baseline=find(f.store.read(),'runs',f.run.id).protocolState;
  await f.store.transaction(s=>{s.documents[0].revision=2;publishState(s,find(s,'runs',f.run.id));});
  const delta=protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='STATE_DELTA').at(-1).delta;
  const applied=structuredClone(baseline);for(const op of delta){assert.equal(op.op,'replace');applied[op.path.slice(1)]=op.value;}
  assert.deepEqual(applied,find(f.store.read(),'runs',f.run.id).protocolState);
  assert.equal(applied.documents[0].revision,2);
  assert.doesNotMatch(JSON.stringify(f.store.read().runs)+JSON.stringify(protocolEvents(f.store.read(),f.run.id)),/SECRET|DO_NOT_EXPOSE|not selected/);
});

test('FIXTURE repeated A/B transitions still publish; text reset then repeated suffix is not suppressed',async t=>{
  const f=await fixture(t);
  await f.apply(native('running',[text('A')]));await f.apply(native('running',[text('AB')]));
  await f.apply(native('running',[text('A')]));await f.apply(native('running',[text('AB')]));
  assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='TEXT_MESSAGE_CONTENT'&&e.delta==='B').length,2);
  await f.store.transaction(s=>markDisconnected(s,find(s,'runs',f.run.id)));
  await f.apply(native('running',[text('AB')]));
  await f.store.transaction(s=>markDisconnected(s,find(s,'runs',f.run.id)));
  await f.apply(native('running',[text('AB')]));
  assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='STATE_DELTA'&&e.delta.some(d=>d.path==='/run'&&d.value.observation==='connected')).length,2);
});

test('FIXTURE project/thread/run identity never borrows another turn terminal status',async t=>{
  const f=await fixture(t);
  await assert.rejects(f.apply({...native(),thread:{id:'thread-b',projectId:'t3-project-a'}}),{code:'T3_IDENTITY'});
  await assert.rejects(f.apply({...native(),thread:{id:'thread-a',projectId:'t3-project-b'}}),{code:'T3_IDENTITY'});
  await f.apply({...native(),runs:[{id:'different-run',status:'completed'}],thread:{id:'thread-a',projectId:'t3-project-a',status:'completed'}});
  assert.equal(find(f.store.read(),'runs',f.run.id).status,'unknown');
  assert.equal(protocolEvents(f.store.read(),f.run.id).some(e=>e.type==='RUN_FINISHED'),false);
});

test('FIXTURE transport drop is unknown, explicit reconnect reads same run and never executes effects',async t=>{
  const f=await fixture(t);let snapshot=native('running',[text('partial')]),onDrop,requests=[];
  const controller=createProtocolController({store:f.store,call:async name=>{requests.push(name);throw Error('unexpected mutation');},openFeed:async cb=>{onDrop=cb;return {projection:async()=>snapshot,subscribe:()=>()=>{},close(){}};}});t.after(()=>controller.close());
  await controller.observe(f.run.id);await onDrop();
  assert.equal(find(f.store.read(),'runs',f.run.id).status,'unknown');
  assert.equal(controller.recovery(f.run.id).events[0].messages[0].content,'partial');
  snapshot=native('interrupted',[text('partial','interrupted')]);await controller.reconnect(f.run.id);
  const recovery=controller.recovery(f.run.id);assert.equal(recovery.status,'interrupted');assert.equal(recovery.identity.attemptId,'attempt-a');
  assert.deepEqual(requests,[]);assert.equal(protocolEvents(f.store.read(),f.run.id).filter(e=>e.type==='RUN_FINISHED').at(-1).outcome.type,'cancelled');
});

test('FIXTURE backend restart marks stale connections and in-flight receipts uncertain without dispatch',async t=>{
  const f=await fixture(t);await f.apply(native('running',[text('partial')]));
  await f.store.transaction(s=>{s.receipts.push({operationId:'in-flight',type:'t3.input-response',status:'submitting'});find(s,'runs',f.run.id).stopRequest={status:'submitting'};});
  await f.restart();let dispatched=0;
  const controller=createProtocolController({store:f.store,call:async()=>{dispatched++;},openFeed:async()=>{dispatched++;}});
  await controller.recover();const before=f.store.read().revision;await controller.recover();
  assert.equal(f.store.read().revision,before);assert.equal(dispatched,0);
  assert.equal(find(f.store.read(),'runs',f.run.id).status,'unknown');assert.equal(find(f.store.read(),'runs',f.run.id).stopRequest.status,'unknown');
  assert.equal(f.store.read().receipts.find(x=>x.operationId==='in-flight').status,'unknown');
  assert.equal(controller.recovery(f.run.id).events[0].messages[0].content,'partial');
});

test('FIXTURE publishing authoritative state changes is safe for a store subscriber',async t=>{
  const f=await fixture(t);await f.apply(native());
  const controller=createProtocolController({store:f.store,call:async()=>{},openFeed:async()=>{}});
  let before=f.store.read().revision;await controller.refreshState(f.run.id);assert.equal(f.store.read().revision,before);
  await f.store.transaction(s=>{s.documents.push(entity({name:'New document'},'project-a'));});
  await controller.refreshState(f.run.id);before=f.store.read().revision;
  await controller.refreshState(f.run.id);assert.equal(f.store.read().revision,before);
  assert.equal(controller.recovery(f.run.id).events[1].snapshot.documents.length,1);
});

test('FIXTURE stop acknowledgement is not cancellation and repeated stop never resends',async t=>{
  const f=await fixture(t);let calls=0;
  const controller=createProtocolController({store:f.store,call:async(name,args)=>{assert.equal(name,'t3_thread_interrupt');assert.equal(args.runId,'native-run-a');assert.equal(args.stop,undefined);calls++;return {status:'interrupt_requested'};},openFeed:async()=>({projection:async()=>native(),close(){}})});t.after(()=>controller.close());
  await controller.stop(f.run.id);await controller.stop(f.run.id);
  assert.equal(calls,1);assert.equal(find(f.store.read(),'runs',f.run.id).status,'running');
  assert.equal(protocolEvents(f.store.read(),f.run.id).some(e=>e.type==='RUN_FINISHED'),false);
});

test('FIXTURE frontend result return is rejected without sending text or a fabricated result',async t=>{
  const f=await fixture(t);let calls=0;
  const controller=createProtocolController({store:f.store,call:async()=>{calls++;},openFeed:async()=>{calls++;}});
  assert.throws(()=>controller.returnToolResult(f.run.id,{toolCallId:'fake',content:'done'}),{code:'T3_FRONTEND_TOOL_UNSUPPORTED'});
  assert.equal(calls,0);assert.equal(controller.capabilities().frontendToolResults,false);
});

test('FIXTURE native permission response is explicit, run scoped, once-only and cannot widen the session',async t=>{
  const f=await fixture(t);let sent=0;
  const observation=native('running',[item('approval_request','approval',{requestId:'permission-a',requestKind:'command',prompt:'Read fixture'})]);observation.runtimeRequests=[{id:'permission-a',status:'pending'}];
  const controller=createProtocolController({store:f.store,call:async()=>{throw Error('no MCP approval route');},openFeed:async()=>({projection:async()=>observation,close(){}}),sendApproval:async input=>{sent++;assert.equal(input.requestId,'permission-a');assert.equal(input.threadId,'thread-a');assert.equal(input.decision,'accept');return {sequence:10};}});t.after(()=>controller.close());
  await assert.rejects(controller.respondApproval(f.run.id,{operationId:'broad',requestId:'permission-a',decision:'acceptAlways'}),{code:'VALIDATION'});
  await assert.rejects(controller.respondApproval(f.run.id,{operationId:'foreign',requestId:'permission-b',decision:'accept'}),{code:'T3_INPUT_NOT_PENDING'});
  const input={operationId:'accept-once',requestId:'permission-a',decision:'accept'};
  assert.equal((await controller.respondApproval(f.run.id,input)).status,'accepted');await controller.respondApproval(f.run.id,input);
  await assert.rejects(controller.respondApproval(f.run.id,{...input,operationId:'another'}),{code:'INPUT_ALREADY_SUBMITTED'});
  assert.equal(sent,1);
});

test('FIXTURE supported input answers reserve durable idempotency before dispatch; uncertain answers cannot replay',async t=>{
  const f=await fixture(t);const observation=native('waiting',[item('user_input_request','question',{requestId:'request-a',questions:[{id:'q',question:'Choose'}]})]);observation.runtimeRequests=[{id:'request-a',status:'pending'}];await f.apply(observation);
  let effects=0;const controller=createProtocolController({store:f.store,openFeed:async()=>{},call:async(name,args)=>{assert.equal(name,'t3_pending_request');if(args.action==='list')return {requestIds:['request-a']};effects++;throw new Error('connection lost after send');}});
  const input={operationId:'answer-once',requestId:'request-a',answers:{q:'yes'}};
  await assert.rejects(controller.respondInput(f.run.id,input),/connection lost/);
  assert.equal((await controller.respondInput(f.run.id,input)).status,'unknown');
  await assert.rejects(controller.respondInput(f.run.id,{...input,operationId:'other'}),{code:'INPUT_ALREADY_SUBMITTED'});
  await assert.rejects(controller.respondInput(f.run.id,{...input,answers:{q:'no'}}),{code:'OPERATION_REUSE'});
  assert.equal(effects,1);
});

test('FIXTURE MCP paged activity and text continuation are read-only and cannot invent tool results',async t=>{
  const f=await fixture(t);const calls=[];
  const controller=createProtocolController({store:f.store,openFeed:async()=>{throw Error('unused');},call:async(name,args)=>{
    calls.push({name,args});const row={sourceThreadId:'thread-a',runId:'native-run-a',itemId:'mcp-message',messageId:'mcp-message',position:0,type:'assistant_message',status:'running',text:'Hello',textTruncated:true,nextTextOffset:5};
    const common={thread:{threadId:'thread-a',projectId:'t3-project-a'},recentRuns:[{runId:'native-run-a',status:'running'}]};
    if(args.itemId)return {...common,items:[{...row,text:' world',textTruncated:false,nextTextOffset:null}]};
    if(args.afterPosition===-1)return {...common,items:[row],hasMore:true,nextPosition:0};
    return {...common,items:[{...row,itemId:'tool',position:1,type:'dynamic_tool',text:'Success',textTruncated:false}],hasMore:false,nextPosition:1};
  }});
  await controller.reconcile(f.run.id,{source:'mcp'});
  assert.equal(find(f.store.read(),'runs',f.run.id).protocolMessages[0].content,'Hello world');
  assert.equal(protocolEvents(f.store.read(),f.run.id).some(e=>e.type==='TOOL_CALL_RESULT'),false);
  assert.ok(calls.every(c=>c.name==='t3_thread_read'));assert.equal(calls.length,3);
});
