import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './budgets-fixture.test.mjs';
import {createProtocolController} from '../app/protocol/controller.mjs';
import {createNativeUsageBridge} from '../app/budgets/native-usage.mjs';

// Exact pinned protocol fixture, not a captured/live provider run. Real SQLite,
// protocol queue, Budget commit guard, accounting ledger and replay are used.
test('native observation collects inside its transaction and feeds only after releasing the run queue',{timeout:8000},async t=>{
  const f=await fixture(t),run=await f.start({threadId:'native-thread',providerRunId:'native-run',t3ProjectId:'native-project'}),model=run.selection.model,providerInstanceId=run.providerInstanceId;
  const ref=nativeId=>({driver:'codex',nativeId,strength:'strong'});
  const p={thread:{id:run.threadId,projectId:run.t3ProjectId,providerInstanceId},runs:[{id:run.providerRunId,threadId:run.threadId,status:'running',providerInstanceId,modelSelection:{instanceId:providerInstanceId,model},activeAttemptId:'native-attempt'}],turnItems:[],runtimeRequests:[],
    attempts:[{id:'native-attempt',runId:run.providerRunId,attemptOrdinal:1,rootNodeId:'root',providerInstanceId,providerThreadId:'provider-thread',providerTurnId:'turn',nativeThreadId:'session',status:'completed'}],
    providerThreads:[{id:'provider-thread',driver:'codex',providerInstanceId,appThreadId:run.threadId,nativeThreadRef:ref('session')}],
    providerTurns:[{id:'turn',providerThreadId:'provider-thread',nodeId:'root',runAttemptId:'native-attempt',ordinal:1,status:'completed',nativeTurnRef:ref('native-turn'),nativeThreadRef:ref('session'),model,turnTokenUsage:{usageScope:'main_agent',usageStatus:'complete',inputTokens:10,outputTokens:4,hasSubagents:false,models:[model],otherUsage:{inputTokens:0,outputTokens:0}}}]};
  const bridge=createNativeUsageBridge({store:f.store,budgets:f.service});let nested=false,controller;
  controller=createProtocolController({store:f.store,call:async()=>{throw Error('No provider effect allowed');},openFeed:async()=>({projection:async()=>structuredClone(p),close(){}}),onNativeUsage:async input=>{if(!nested){nested=true;await controller.reconcile(run.id);}await bridge.feed(input);}});t.after(()=>controller.close());
  const observed=await controller.reconcile(run.id);assert.equal(observed.status,'running');assert.equal(observed.nativeUsage.mainAgent.knownTokens,14);
  let s=f.store.read(),obs=s.events.filter(e=>e.type==='budget.observation');assert.equal(obs.length,1);assert.equal(obs[0].usage.totalTokens,14);assert.equal(obs[0].cost,null);assert.equal(obs[0].final,false);assert.equal(s.events.find(e=>e.type==='budget.reservation').held,true);
  await controller.reconcile(run.id);assert.equal(f.store.read().events.filter(e=>e.type==='budget.observation').length,1);
  p.runs[0].status='completed';const complete=await controller.reconcile(run.id);assert.equal(complete.reportedUsage.totalTokens,14);assert.ok(complete.reportedUsage.source.startsWith('t3.native.turn-usage/1'));
  const old=structuredClone(p),next=structuredClone(p.providerTurns[0]);Object.assign(next,{id:'turn-2',ordinal:2,nativeTurnRef:ref('native-turn-2')});Object.assign(next.turnTokenUsage,{inputTokens:20,outputTokens:6});p.providerTurns.push(next);p.attempts[0].providerTurnId=next.id;
  assert.equal((await controller.reconcile(run.id)).reportedUsage.totalTokens,40);
  const latest=structuredClone(p);Object.assign(p,old);const stale=await controller.reconcile(run.id);assert.equal(stale.reportedUsage.totalTokens,40);assert.equal(stale.nativeUsage.mainAgent.knownTokens,40);assert.equal(stale.nativeUsage.lastRead,'historical-snapshot');
  Object.assign(p,latest);p.providerTurns[0].turnTokenUsage.inputTokens=9;
  const terminal=await controller.reconcile(run.id);assert.equal(terminal.status,'completed');assert.equal(terminal.connection.status,'connected');assert.equal(terminal.nativeUsage.status,'unavailable');assert.equal(terminal.nativeUsage.reason,'NATIVE_USAGE_REGRESSION');
  assert.equal(terminal.reportedUsage,null,'a regressed or incomplete current source cannot retain a previously qualified run total');
  const unavailable=(await f.state()).nativeUsage[0];assert.equal(unavailable.status,'unavailable');assert.equal(unavailable.reason,'NATIVE_USAGE_REGRESSION');assert.equal(unavailable.mainAgent,null);assert.equal(unavailable.usage,null);assert.equal(unavailable.lastConfirmed.usage.totalTokens,40,'historical receipt is retained without being presented as current qualification');
  assert.equal(f.store.read().events.filter(e=>e.type==='budget.observation').length,2,'invalid accounting cannot replace known receipts or discard valid lifecycle');
});
