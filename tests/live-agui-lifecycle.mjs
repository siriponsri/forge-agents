// Explicit provider qualification only; never part of npm test/user startup.
// A fresh isolated FORGE home is required. No development sessions are imported.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { openStore } from '../app/server/store.mjs';
import { createT3Service } from '../app/server/t3.mjs';
import { command } from '../app/server/domain.mjs';
import { protocolEvents } from '../app/server/agui.mjs';

const dir=process.env.FORGE_AGUI_LIVE_DIR??await mkdtemp(path.join(os.tmpdir(),'forge-agui-live-'));
const store=await openStore(dir),t3=createT3Service({dataDir:dir,store});
const op=(type,projectId,data)=>command(store,{type,operationId:crypto.randomUUID(),projectId,data});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const evidence={observedAt:new Date().toISOString(),kind:'actual-provider-disposable-engineering-fixture',t3Version:'0.1.11',sourceRevision:'59651c1761f6c63e9b6056839067066968e6a406',requestedModel:'gpt-6.1-sol',requestedOptions:[{id:'reasoningEffort',value:'xhigh'}],frontendToolResults:'IMPLEMENTATION_BLOCKED: no supported return contract in pinned T3',homeUat:'NOT_RUN',checks:[]};
async function record(){await writeFile(path.join(dir,'sanitized-evidence.json'),JSON.stringify(evidence,null,2));}
async function settle(run,timeout=90000,{approveFixtureRead=false}={}){
  const deadline=Date.now()+timeout;let observation;
  do{
    observation=await t3.reconcile(run.id);
    if(approveFixtureRead&&observation.pendingApprovals?.length){
      assert.equal(observation.pendingApprovals.length,1,'only one bounded read permission is authorized');
      const commands=observation.protocolMessages.flatMap(m=>m.toolCalls??[]).map(c=>JSON.parse(c.function.arguments).command).filter(Boolean);
      const command=commands.at(-1);
      assert.ok(/Get-Content/.test(command)&&/fixture\.txt/.test(command)&&!/[;|\r\n]|&&|\$\(/.test(command),'only the expected read-only fixture command is authorized');
      const requestId=observation.pendingApprovals[0].requestId;
      await t3.respondApproval(run.id,{operationId:`live-fixture-read-${run.id}`,requestId,decision:'accept'});
      evidence.checks.push({kind:'explicit-single-read-permission',runId:run.id,requestId,decision:'accept',scope:'one fixture read only; no session-wide permission'});
    }
    if(['completed','failed','interrupted','cancelled','rolled_back'].includes(observation.status))return observation;
    await sleep(1000);
  }while(Date.now()<deadline);
  return observation;
}
let active;
try{
  console.log({dataDir:dir,stage:'starting-isolated-T3'});
  await t3.start();let provider;
  for(let n=0;n<10;n++){const catalog=await t3.catalog();provider=catalog.providers?.find(p=>p.providerInstanceId==='codex');if(provider?.canRunChildTask&&provider.models.some(m=>m.id==='gpt-6.1-sol'))break;await sleep(1000);}
  assert.ok(provider?.canRunChildTask&&provider.models.some(m=>m.id==='gpt-6.1-sol'),'selected provider/model unavailable');
  for(const prior of store.read().runs.filter(r=>r.threadId&&!['completed','failed','interrupted','cancelled','rolled_back'].includes(r.status))){
    const observed=await t3.reconcile(prior.id);
    if(!['completed','failed','interrupted','cancelled','rolled_back'].includes(observed.status))await t3.stop(prior.id);
  }
  const workspace=path.join(dir,'bounded-read-only-workspace');await mkdir(workspace,{recursive:true});
  await writeFile(path.join(workspace,'fixture.txt'),'FORGE_AGUI_TOOL_READ_OK\n');
  const project=store.read().projects.find(p=>p.workspace===workspace)??(await op('project.create',null,{name:'Disposable protocol engineering fixture',workspace,profile:{provider:{instanceId:'codex',model:'gpt-6.1-sol',options:evidence.requestedOptions},compute:{kind:'local'}}})).entity;
  const plan=(await op('plan.create',project.id,{name:'Read-only protocol qualification',approved:true})).entity;
  const task=(await op('task.create',project.id,{title:'Read fixture.txt with one read-only tool',description:`This is a disposable FORGE protocol engineering fixture. Use one harmless read-only tool/command to read the exact absolute path ${path.join(workspace,'fixture.txt')}. Set workdir to ${workspace}. Do not write or edit any files, access credentials or use the network. Reply with the file contents. Do not spawn agents.`,planId:plan.id})).entity;
  active=await t3.startRun({operationId:crypto.randomUUID(),projectId:project.id,taskId:task.id});assert.ok(active.threadId,active.error);
  console.log({stage:'actual-read-run',runId:active.id});
  await t3.observe(active.id);const completed=await settle(active,90000,{approveFixtureRead:true});
  const events=protocolEvents(store.read(),active.id);
  const replayCount=events.length;await t3.reconcile(active.id);assert.equal(protocolEvents(store.read(),active.id).length,replayCount);
  evidence.checks.push({kind:'read-tool-and-native-feed',runId:active.id,threadId:active.threadId,providerRunId:active.providerRunId,status:completed.status,executedModel:completed.executedModel,providerAttempts:completed.providerAttempts,replyMarkerObserved:completed.messages.some(m=>m.text.includes('FORGE_AGUI_TOOL_READ_OK')),toolResults:events.filter(e=>e.type==='TOOL_CALL_RESULT').length,eventTypes:[...new Set(events.map(e=>e.type))],idempotentReconcile:true});await record();
  assert.equal(completed.status,'completed');assert.ok(completed.messages.some(m=>m.text.includes('FORGE_AGUI_TOOL_READ_OK')),'actual read reply not observed');assert.ok(events.some(e=>e.type==='TOOL_CALL_RESULT'&&e.content.includes('FORGE_AGUI_TOOL_READ_OK')),'actual fixture-read tool result not observed');
  const stopTask=(await op('task.create',project.id,{title:'Bounded stop and reconnect check',description:'Disposable protocol engineering fixture. Run one harmless read-only command that waits 20 seconds then prints FORGE_WAIT_DONE (PowerShell Start-Sleep -Seconds 20; Write-Output FORGE_WAIT_DONE). Do not write/edit files, access credentials, use network or spawn agents. Wait for the command then reply done.',planId:plan.id})).entity;
  active=await t3.startRun({operationId:crypto.randomUUID(),projectId:project.id,taskId:stopTask.id});assert.ok(active.threadId,active.error);await t3.observe(active.id);
  await sleep(1500);await t3.disconnect(active.id);
  const disconnected=t3.recovery(active.id);assert.equal(disconnected.status,'unknown');
  await t3.reconnect(active.id);await t3.stop(active.id);const stopped=await settle(active,30000);
  const identityBefore=t3.recovery(active.id).identity;await t3.disconnect(active.id);await t3.reconnect(active.id);
  assert.deepEqual(t3.recovery(active.id).identity,identityBefore);
  evidence.checks.push({kind:'actual-stop-and-explicit-reconnect',runId:active.id,threadId:active.threadId,providerRunId:active.providerRunId,status:stopped.status,stopAcknowledgement:stopped.stopRequest,identityPreserved:true,runCount:store.read().runs.length,partialMessageCount:stopped.messages.length});await record();
  assert.ok(['cancelled','interrupted'].includes(stopped.status),'stop did not produce a confirmed interrupted/cancelled run');
  console.log({result:'PASSED',checks:evidence.checks,evidencePath:path.join(dir,'sanitized-evidence.json')});
}catch(error){evidence.error=error.message;await record();console.error({result:'FAILED',error:error.message,evidencePath:path.join(dir,'sanitized-evidence.json')});process.exitCode=1;}
finally{
  if(active?.threadId){try{const observed=await t3.reconcile(active.id);if(!['completed','failed','cancelled','interrupted','rolled_back'].includes(observed.status))await t3.stop(active.id);}catch{}}
  await t3.shutdown();await store.close();
}
