// Git, SQLite, Workspace, Context, Memory and independent checker are real.
// Native execution and qualification receipts are explicitly injected owners.
import {fixture as workspaceFixture} from './workspaces-fixture.test.mjs';
import {createResearchExecutionBridge} from '../app/server/research.mjs';
import {createResearchService,defaultResearchConfig,buildResearchContext} from '../app/research/index.mjs';
import {digest,append} from '../app/research/contracts.mjs';
import {createContextService} from '../app/context/index.mjs';
import {createT3ContextSeam} from '../app/context/pre-dispatch.mjs';
import {createMemoryService} from '../app/memory/index.mjs';
import {decideResearchPolicy} from '../app/research/policies.mjs';

export async function fixture(t,{qualified=true,memory=false,passthrough=false,config={},afterStart,afterAuthorize,workspacesPatch={}}={}){
  const f=await workspaceFixture(t),owner=f.owner;
  const authorizeOwner=async(request,caller)=>{await afterAuthorize?.(request,caller,f);return caller===owner?{kind:'human',role:'owner'}:null;};
  const scope={projectId:f.p.id,kind:'project',id:f.p.id},route={providerId:f.p.profile.provider.instanceId,modelId:f.p.profile.provider.model},source={kind:'fixture',reference:'INJECTED_NATIVE_NOT_LIVE; real Context/Memory owner',observedAt:'2026-11-25T00:00:00Z'};
  const memoryService=await createMemoryService({store:f.store,dataDir:f.dataDir,authorize:({callerContext})=>callerContext===owner});
  const context=await createContextService({store:f.store,dataDir:f.dataDir,authorize:({callerContext})=>callerContext===owner,memoryContext:(i,c)=>memoryService.context(i,c),memoryResolveRefs:(i,c)=>memoryService.resolveRefs(i,c),capabilities:async()=>({contextOwner:'native',acceptsForgePrefix:true,compactForgePrefix:true,source})});
  if(!passthrough)await context.policy({projectId:f.p.id,operationId:crypto.randomUUID(),route,budget:{contextWindow:100000,outputReserve:1000,safetyReserve:100},source},owner);
  if(memory)await memoryService.remember({projectId:f.p.id,scope,operationId:crypto.randomUUID(),memoryType:'semantic',title:'Saved engineering memory',content:'ACTUAL_MEMORY_RECALL_QUALIFICATION',factKey:'fixture-memory'},owner);
  let bridge,hostContext;const observed={starts:[],messages:[],proofRequests:[]};
  function requestFor(trial,run=null){return {version:1,projectId:f.p.id,trialId:trial.id,manifestDigest:trial.manifestDigest,workspaceId:trial.manifest.workspaceId,taskId:trial.manifest.taskId,runOperationId:trial.runOperationId,runId:run?.id??null,attemptId:run?.attemptId??null,deadlineAt:trial.deadlineAt,route:trial.manifest.contextPolicy.route,components:trial.manifest.components,limits:trial.manifest.limits};}
  async function installProof(trial,run=null){
    const request=requestFor(trial,run),requestDigest=digest(request);
    return f.store.transaction(s=>{
      const ownerReceipt=append(s,'injected-owner-enforcement',{qualification:'INJECTED_NATIVE_PROOF_NOT_LIVE',requestDigest,runId:request.runId,attemptId:request.attemptId},f.p.id);
      return append(s,'enforcement',{version:1,requestDigest,mechanism:'guarded-native/1',nativeComponents:{memory:'disabled',skills:'disabled',adaptation:'disabled',staffing:'disabled'},actions:{ownerReceiptId:ownerReceipt.id},limits:{ownerReceiptId:ownerReceipt.id,...Object.fromEntries(['maxMs','maxSteps','maxRetries','maxAgents','maxTokens','maxCost'].map(k=>[k,request.limits[k]]))}},f.p.id);
    });
  }
  const qualification=qualified?(s,request)=>{observed.proofRequests.push(request);const event=s.events.find(e=>e.type==='research.enforcement'&&e.requestDigest===digest(request));return event?{version:1,requestDigest:digest(request),receiptId:event.id}:null;}:undefined;
  const startRun=f.t3.startRun.bind(f.t3);
  f.t3.startRun=async input=>{
    // Explicit host seam emulates lead-owned Workspace's third argument, which
    // is deliberately not implemented in this worker's assigned paths.
    let run=await startRun({...input,researchContext:hostContext});
    await installProof(f.store.read().events.find(e=>e.id===hostContext.trialId),run);
    const baseMessage=`Original canonical task ${run.taskId}. Preserve original Owner constraints.`;
    const prepared=await bridge.prepare({run,baseMessage});observed.messages.push(prepared.message);
    const seam=createT3ContextSeam({service:context,callerContextForRun:()=>owner,allowNativePassthrough:passthrough,memoryForRun:r=>bridge.memoryEnabled(r)?{scope,query:'ACTUAL_MEMORY',maxCharacters:16000}:undefined});
    const actual=await seam({run:f.store.read().runs.find(r=>r.id===run.id),project:f.p,baseMessage:prepared.message});
    await f.store.transaction(s=>{const r=s.runs.find(r=>r.id===run.id);r.contextId=actual.contextId;r.contextReceipt=actual.receipt;r.contextMode=actual.mode;r.researchReceipt=bridge.validatePrepared(s,r);});
    run=f.store.read().runs.find(r=>r.id===run.id);await afterStart?.(run,f);return run;
  };
  const workspaces={
    async start(input,caller,internal){observed.starts.push({input,caller,internal});hostContext=internal.researchContext;return f.service.start(input,caller);},
    reconcile:(...args)=>f.service.reconcile(...args),stop:(...args)=>f.service.stop(...args),...workspacesPatch,
  };
  const makeBridge=()=>createResearchExecutionBridge({store:f.store,dataDir:f.dataDir,workspaces,t3:f.t3,authorizeOwner,qualification});bridge=makeBridge();
  const research=createResearchService({store:f.store,dataDir:f.dataDir,authorizeOwner,executionOwner:bridge.executionOwner});
  t.after(async()=>{await bridge.close();await research.close();await memoryService.close();});
  await f.configure();const w=await f.create();
  const raw={...defaultResearchConfig(),execution:'agent',repetitions:1,policies:['static'],ablations:[{name:'single task',components:{memory,skills:false,staffing:false,adaptation:false,verification:false}}],limits:{...defaultResearchConfig().limits,maxMs:30000,maxRetries:0},...config};
  const experiment=await research.create(f.input({config:raw}),owner),trial=await research.reserve(f.input({experimentId:experiment.id,repetition:0,policyIndex:0,ablationIndex:0,workspaceId:w.id,taskId:w.taskId}),owner);
  await installProof(trial);
  const currentTrial=()=>f.store.read().events.find(e=>e.id===trial.id);
  const currentRun=()=>f.store.read().runs.find(r=>r.operationId===trial.runOperationId);
  const dispatchInput=()=>{const t=currentTrial();return {projectId:f.p.id,trialId:t.id,experimentId:experiment.id,taskId:w.taskId,workspaceId:w.id,runOperationId:t.runOperationId,researchContext:buildResearchContext(f.store.read(),{projectId:f.p.id,trialId:t.id}),policy:decideResearchPolicy({policy:t.manifest.policy,components:t.manifest.components,limits:t.manifest.limits,step:0})};};
  const start=async()=>{await f.store.transaction(s=>{const t=s.events.find(e=>e.id===trial.id);t.status='dispatching';t.startedAt=Date.now();t.deadlineAt=Date.now()+raw.limits.maxMs;});if(qualified)await installProof(currentTrial());return bridge.executionOwner.dispatch(dispatchInput(),owner);};
  const scopeInput=()=>({projectId:f.p.id,trialId:trial.id,workspaceId:w.id,runOperationId:trial.runOperationId,runId:currentRun()?.id??null});
  const validateInput=()=>({projectId:f.p.id,trialId:trial.id,runId:currentRun().id,attemptId:currentRun().attemptId,manifestDigest:trial.manifestDigest,dataset:trial.manifest.dataset});
  return {f,owner,w,trial,experiment,observed,research,context,memoryService,scope,route,currentTrial,currentRun,dispatchInput,scopeInput,validateInput,installProof,start,get bridge(){return bridge;},async reopenBridge(){await bridge.close();bridge=makeBridge();return bridge;}};
}
