// Existing real SQLite/Git/Workspace owners; native lifecycle is explicitly
// injected by the shared component fixture. This does not qualify a binary.
import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './research-components-fixture.test.mjs';
import {admitResearchTrial} from '../app/research/context.mjs';
import {selectionForRun} from '../app/context/admission.mjs';
import {createResearchComponentService} from '../app/research-components/index.mjs';
import {createResearchService,digest} from '../app/research/index.mjs';

test('shared admission retains exact cohort selection and refuses stripped authority',async t=>{
  const h=await fixture(t,{complete:false,report:false,maxMs:300000});await h.prepare();await h.advance();
  const s=h.f.store.read(),r=s.runs.at(-1),configured=s.projects.find(p=>p.id===r.projectId).profile.provider;
  assert.equal(admitResearchTrial(s,r).id,h.trial.id);
  assert.deepEqual(selectionForRun(r,configured,{state:s}),r.selection);
  for(const field of ['researchContext','researchComponentContext']){const stripped=structuredClone(r);delete stripped[field];assert.throws(()=>admitResearchTrial(s,stripped));}
  const forged=structuredClone(r);forged.selection.model='foreign';assert.throws(()=>selectionForRun(forged,configured,{state:s}));
  assert.equal(h.f.service.researchComponentContextVersion,0,'an injected older T3 owner must not advertise the new host contract');
  assert.throws(()=>h.f.service.start({...h.f.input({workspaceId:h.slots[1].workspaceId,expectedRevision:1}),researchComponentContext:r.researchComponentContext},h.owner),{code:'RESEARCH_CONTEXT'});
});

test('expired cohort recovery uses only private Stop of exact existing attempts',async t=>{
  const h=await fixture(t,{complete:false,report:false,maxMs:300000});await h.prepare();await h.advance();await h.service.close();
  const before=h.f.store.read(),trial=before.events.find(t=>t.id===h.trial.id),r=before.runs.at(-1);let calls=0;
  const service=createResearchComponentService({store:h.f.store,dataDir:h.f.dataDir,workspaces:h.f.service,adaptive:{},providers:{},authorizeOwner:()=>null,clock:()=>trial.deadlineAt+1,stopExistingWorkspace:(input,detail)=>{calls++;assert.equal(detail.runId,r.id);return h.f.service.stopExisting(input,detail);}});
  await service.recover();await service.recover();assert.equal(calls,1);assert.equal(h.f.store.read().runs.length,1);assert.equal(h.f.store.read().runs[0].status,'interrupted');
  assert.throws(()=>h.f.service.stopExisting(h.f.input({workspaceId:h.slots[0].workspaceId,expectedRevision:1}),{runId:'foreign',reason:'recovery'}),{code:'WORKSPACE_STOP_SCOPE'});
  await service.close();
});

test('Research trial derives outcome and component receipts from the canonical cohort',async t=>{
  const h=await fixture(t,{maxMs:300000});await h.prepare();await h.advance();await h.validateAll();await h.advance();await h.validateAll();await h.advance();
  const owner={version:1,...Object.fromEntries(['dispatch','reconcile','stop','telemetry','validate'].map(k=>[k,()=>{throw Error('No native dispatch from result projection test');}])),async exportComposition(){const data=await h.state();return {format:'forge-research-components-json/1',data,sha256:digest(data)};}};
  const research=createResearchService({store:h.f.store,dataDir:h.f.dataDir,executionOwner:owner,authorizeOwner:(_r,c)=>c===h.owner?{kind:'human',role:'owner'}:null});
  const result=await research.syncComposition({projectId:h.f.p.id,trialId:h.trial.id},h.owner);
  assert.equal(result.status,'PASSED');assert.equal(result.cohort.runIds.length,2);assert.equal(result.componentReceipts.skills.status,'APPLIED');assert.equal(result.componentReceipts.staffing.status,'APPLIED');assert.equal(result.telemetry.tokens,14);assert.equal(result.telemetry.cost,0.02);assert.equal(result.telemetry.currency,'USD');
  assert.equal(h.f.store.read().runs.length,2);await research.close();
});
