import {AsyncLocalStorage} from 'node:async_hooks';
import {createResearchNativeOwner} from '../research-native/owner.mjs';
import {openResearchModelGateway} from '../research-native/model-gateway.mjs';
import {precreateResearchOutput} from '../research-native/output.mjs';
import {resolveResearchAllocation,validateResearchComponentContext,contextForAllocation as allocationContext} from '../research-components/index.mjs';
import {admitResearchTrial,buildResearchContext} from '../research/context.mjs';
import {record,records,verifyTrial,digest,fail} from '../research/contracts.mjs';
import {contextFor,assertNoMixedControllers} from '../workspaces/contracts.mjs';
import {validateWorkspaceContext} from '../workspaces/context.mjs';

const same=(a,b)=>digest(a??null)===digest(b??null);
const scope={paths:['output.json'],capabilities:['read','propose','workspace.write']};
const sync=(fn,...args)=>{const value=fn(...args);if(value?.then)fail('RESEARCH_ROUTE_SYNC','Private synchronous observation required',409);return value;};

/** Root-only adapter to the existing Guarded owner. All synchronous callbacks
 * take the CURRENT canonical writer snapshot. No HTTP/body can install this
 * adapter, supply a proof, choose membership or resolve credentials. */
export function createResearchRoute({store,dataDir,policy,getGuarded,components,clock=Date.now}={}){
  if(!store?.transaction||!store?.read||!dataDir||!policy?.observe||!policy?.resolve||typeof getGuarded!=='function')throw new TypeError('Canonical store, selected policy and private Guarded getter required');
  const gateways=new Set(),byRun=new Map(),fence=new AsyncLocalStorage();let closed=false;
  function member(s,input){
    validateResearchComponentContext(s,input,clock);
    if(!input.researchContext){admitResearchTrial(s,input);return null;}
    const t=record(s,'trial',input.researchContext.trialId,input.projectId);verifyTrial(t,record(s,'experiment',t.manifest.experimentId,input.projectId));
    const x=resolveResearchAllocation(s,{projectId:input.projectId,trialId:t.id,workspaceId:input.workspaceContext?.workspaceId,runOperationId:input.operationId});
    if(!x)admitResearchTrial(s,input);
    const w=x?.workspace??s.events.find(e=>e.type==='workspace.workspace'&&e.id===t.manifest.workspaceId&&e.projectId===input.projectId);
    if(!w||input.taskId!==w.taskId||input.operationId!==`workspace-run:${w.id}`||!same(input.workspaceContext,contextFor(w))||!same(input.researchContext,buildResearchContext(s,{projectId:t.projectId,trialId:t.id})))fail('RESEARCH_OWNERSHIP','Exact canonical Research member required',409);
    assertNoMixedControllers(s,t.projectId,{taskId:w.taskId});
    validateWorkspaceContext(s,{projectId:t.projectId,taskId:w.taskId,operationId:input.operationId,workspaceContext:input.workspaceContext},{preparing:true});
    if(closed||t.stopRequested||t.restoreReviewRequired||w.stopRequested||w.restoreReviewRequired||!Number.isSafeInteger(t.startedAt)||t.deadlineAt!==t.startedAt+t.manifest.limits.maxMs||clock()>=t.deadlineAt)fail('RESEARCH_LIMIT','Stopped, frozen or expired Research route',409);
    const run=s.runs.find(r=>r.projectId===t.projectId&&r.operationId===input.operationId)??null;
    return {trial:t,workspace:w,allocation:x?.allocation??null,run};
  }
  function researchRequest(s,input){
    const x=member(s,input);if(!x)return null;
    const {trial:t,workspace:w,run}=x,m=t.manifest;
    return {version:1,projectId:t.projectId,trialId:t.id,manifestDigest:t.manifestDigest,workspaceId:w.id,taskId:w.taskId,runOperationId:input.operationId,runId:run?.id??null,attemptId:run?.attemptId??null,deadlineAt:t.deadlineAt,route:m.contextPolicy.route,components:m.components,limits:m.limits};
  }
  function guardedRequest(s,input){
    const x=member(s,input);if(!x)return null;const {trial:t,workspace:w,allocation:a}=x;
    return {projectId:t.projectId,taskId:w.taskId,envelopeDigest:t.manifestDigest,identitySnapshot:digest({trialId:t.id,manifestDigest:t.manifestDigest,allocationId:a?.id??null,workspaceId:w.id,taskId:w.taskId,operationId:input.operationId}),scope:structuredClone(scope),limits:{maxRunMs:t.manifest.limits.maxMs,maxTokens:t.manifest.limits.maxTokens,maxCost:t.manifest.limits.maxCost},deadlineAt:t.deadlineAt,maxBytes:t.manifest.limits.maxBytes};
  }
  const native=createResearchNativeOwner({clock,resolveAllocation:resolveResearchAllocation,observeGuarded(s,{request,run,workspace,stage}){
    const input=run??{projectId:request.projectId,taskId:request.taskId,operationId:request.runOperationId,workspaceContext:contextFor(workspace),researchContext:buildResearchContext(s,{projectId:request.projectId,trialId:request.trialId})};
    // Before reservation use the canonical allocation context, never a source
    // actor or caller record. The resolver has already verified that allocation.
    if(!run){const x=resolveResearchAllocation(s,{projectId:request.projectId,trialId:request.trialId,workspaceId:workspace.id,runOperationId:request.runOperationId});if(x)input.researchComponentContext=allocationContext(x.allocation);}
    const g=getGuarded(),selected=sync(policy.observe,s,{projectId:request.projectId}),r=guardedRequest(s,input),live=run?g?.privateSnapshot?.(run.id):null;
    // The run-bound bridge validates its installation/images immediately before
    // invoking these callbacks, under the same writer. Observe that SAME private
    // accepted proof here; asking the installation host to re-qualify again at
    // each nested callback multiplies synchronous image reads during attestation.
    // privateSnapshot still checks live images; current policy is observed above.
    const proof=run?live?.routeProof:g?.qualifyProactive?.(s,r);
    if(run&&(!proof||proof.projectId!==r.projectId||proof.taskId!==r.taskId||proof.envelopeDigest!==r.envelopeDigest||proof.identitySnapshot!==r.identitySnapshot||proof.scopeDigest!==digest(r.scope)))fail('RESEARCH_NATIVE_LIVE_PROOF_REQUIRED','Exact private accepted route binding required',409);
    if(run&&(!live||live.profile?.runId!==run.id||live.revoked))fail('RESEARCH_NATIVE_LIVE_PROOF_REQUIRED','Actual private Guarded reservation required',409);
    if(run&&['send','action','native-phase','model-request'].includes(stage)&&live.live!==true)fail('RESEARCH_NATIVE_ATTESTATION_REQUIRED','Current live native lease required for effects',409);
    return {...selected,scope:structuredClone(scope),limits:r.limits,routeProof:proof,profile:live?.profile??null,attestation:live?.attestation??null,phases:live?.phases??[]};
  }});
  function currentRun(s,run){const actual=s.runs.find(r=>r.id===run?.id);if(!actual||!same(actual,run))fail('RESEARCH_OWNERSHIP','Current canonical run snapshot required',409);member(s,actual);return actual;}
  function exactBound(s,entry,{runId,attemptId}){const r=s.runs.find(r=>r.id===runId&&r.attemptId===attemptId);if(!r||!same(guardedRequest(s,r),entry.request))fail('RESEARCH_NATIVE_EGRESS_BINDING','Gateway must bind its exact prepared canonical member',409);return currentRun(s,r);}
  const api={
    requestForInput:guardedRequest,
    researchRequestForInput:researchRequest,
    allowUnknownAccounting(s,{run,input}={}){const x=member(s,run??input??{});return !!x&&x.trial.manifest.limits.unknownAccounting==='allow'&&x.trial.manifest.limits.maxTokens===null&&x.trial.manifest.limits.maxCost===null;},
    retainInput(s,input){const r=researchRequest(s,input);return r?native.retain(s,r):null;},
    reserve(s,{run}){if(!run?.researchContext){member(s,run);return null;}currentRun(s,run);return native.retain(s,native.requestForRun(s,run));},
    qualification:(s,request)=>native.qualification(s,request),
    validate(s,detail){
      if(!detail.run?.researchContext){member(s,detail.input??detail.run??{});return true;}
      const run=currentRun(s,detail.run);
      // Guarded reserve calls admission before the Research run capability can
      // be retained. This stage permits reservation only, never a native send.
      if(detail.stage==='reservation')return true;
      if(['send','action'].includes(detail.stage)){
        const receipt=run.researchReceipt;
        const context=s.events.find(e=>e.id===run.contextId&&e.runId===run.id&&e.projectId===run.projectId);
        if(!receipt?.finalMessageDigest||receipt.forgeContextId!==context?.id||receipt.finalMessageHash!==context.accounting?.requestHash||detail.messageDigest&&detail.messageDigest!==receipt.finalMessageDigest)fail('RESEARCH_FINAL_PROMPT','Actual Context final message receipt required',409);
        if(run.researchComponentContext){
          const p=records(s,'component-consumption',run.projectId).find(e=>e.id===run.researchComponentReceipt?.eventId),prefix=context.type==='context.version'?context.active?.find(i=>i.id===`prefix:${run.id}`)?.text:null;
          if(!components?.validatePrompt||!p||p.digest!==digest({...p,digest:undefined})||receipt.componentReceiptDigest!==digest(run.researchComponentReceipt))fail('RESEARCH_COMPONENT_PROMPT','Actual component owner consumption required',409);
          // Passthrough's whole message hash is the component message digest;
          // forge-prefix exposes its exact canonical prepared text separately.
          if(prefix!==null&&!same(components.validatePrompt(s,run,prefix),run.researchComponentReceipt)||prefix===null&&context.accounting.requestHash!==p.messageDigest)fail('RESEARCH_COMPONENT_PROMPT','Component prompt differs from Context consumption',409);
        }
      }
      if(detail.stage==='action')return native.action(s,detail);
      return native.admit(s,detail);
    },
    onNativePhase(s,detail){if(!detail.run?.researchContext){member(s,detail.run??{});return true;}currentRun(s,detail.run);return native.nativePhase(s,detail);},
    onBeforeAction(s,detail){
      if(!detail.run?.researchContext){member(s,detail.run??{});return;}
      api.validate(s,{...detail,stage:'action'});
      const run=currentRun(s,detail.run),request=native.requestForRun(s,run),g=getGuarded(),prior=[];
      // Inspect every exact allocated run, including completed/unknown members.
      // Never filter the global ledger to only the currently active allocation.
      const composition=records(s,'composition',run.projectId).find(c=>c.trialId===request.trialId);
      const operations=composition?records(s,'allocation',run.projectId).filter(a=>a.compositionId===composition.id).map(a=>a.operationId):[run.operationId];
      for(const r of s.runs.filter(r=>r.projectId===run.projectId&&operations.includes(r.operationId))){
        resolveResearchAllocation(s,{projectId:r.projectId,trialId:request.trialId,workspaceId:r.workspaceContext?.workspaceId,runOperationId:r.operationId,runId:r.id,attemptId:r.attemptId});
        const ledger=sync(g.inspectOperations.bind(g),r.id);if(!Array.isArray(ledger)||ledger.some(a=>a.runId!==r.id))fail('RESEARCH_NATIVE_DURABLE_ACTION_LEDGER_REQUIRED','Exact cohort broker ledger required',409);prior.push(...ledger);
      }
      native.reserveAction(s,{...detail,priorOperations:[...prior,...(detail.priorOperations??[])]});
    },
    onReceipt(s,detail){if(detail.run?.researchContext){currentRun(s,detail.run);native.recordReceipt(s,detail);}else member(s,detail.run??{});},
    async resolveProvider(input,options){
      const request=api.requestForInput(store.read(),input);if(!request)return policy.resolve(input,options);
      if(!same(input.request,request))fail('RESEARCH_NATIVE_REQUEST_CHANGED','Exact host-prepared Guarded request required',409);
      const original=await policy.resolve(input,options),entry={request,gateway:null,binding:null};
      try{
        if(!same(api.requestForInput(store.read(),input),request))fail('RESEARCH_NATIVE_REQUEST_CHANGED','Research changed during provider resolution',409);
        entry.gateway=await openResearchModelGateway({provider:original.provider,clock,withFence:(_id,fn)=>store.transaction(s=>fence.run(s,fn)),authorizeRequest:binding=>{const s=fence.getStore();return native.modelRequest(s,{run:exactBound(s,entry,binding)});},onFailure:binding=>{const s=fence.getStore();native.modelFailure(s,{run:exactBound(s,entry,binding)});}});gateways.add(entry);
        if(closed)fail('RESEARCH_SUSPENDED','Research route closed during preparation',409);
        return {...original,provider:entry.gateway.provider,
          bind(binding){exactBound(store.read(),entry,binding);if(entry.binding&&!same(entry.binding,binding))fail('RESEARCH_NATIVE_EGRESS_REBIND','Cannot rebind gateway',409);entry.gateway.bind(binding);entry.binding=structuredClone(binding);byRun.set(binding.runId,entry);},
          close:()=>closeEntry(entry)};
      }catch(error){await closeEntry(entry);throw error;}
    },
    precreate(runId){return precreateResearchOutput({store,dataDir,runId,clock,admit:(s,d)=>native.admit(s,d)});},
    closeRun(runId){return closeEntry(byRun.get(runId));},
    async close(){closed=true;native.close();await Promise.allSettled([...gateways].map(closeEntry));},
  };
  async function closeEntry(entry){if(!entry)return;await entry.gateway?.close();gateways.delete(entry);if(entry.binding&&byRun.get(entry.binding.runId)===entry)byRun.delete(entry.binding.runId);}
  return Object.freeze(api);
}
