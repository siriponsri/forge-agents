import {randomUUID} from 'node:crypto';
import {verifyTrial,record,digest,append} from '../research/contracts.mjs';
import {buildResearchContext,researchContextPolicy} from '../research/context.mjs';
import {contextFor,pathKey} from '../workspaces/contracts.mjs';

const clone=structuredClone;
const same=(a,b)=>digest(a??null)===digest(b??null);
const deny=code=>{throw Object.assign(new Error(code),{code,statusCode:409});};
const sync=(fn,...args)=>{const v=fn(...args);if(v?.then)deny('RESEARCH_NATIVE_SYNC_REQUIRED');return v;};
const nativeComponents={memory:'disabled',skills:'disabled',adaptation:'disabled',staffing:'disabled'};
const limitKeys=['maxMs','maxSteps','maxRetries','maxAgents','maxTokens','maxCost'];
const phases=new Set(['create','discovery','attest','raw','resolved','executor','prompt','context','context-select','context-load','model-request']);

/** Private SAME-writer callbacks, not a second runtime. The observer MUST read
 * the live Guarded installation/lease and current selected route, never events
 * or test/config JSON. This dependency has no default, HTTP or model setter.
 * retain/nativePhase/modelRequest/reserveAction/recordReceipt run inside the
 * canonical store transaction also used for Stop, restore and policy changes.
 */
export function createResearchNativeOwner({observeGuarded,resolveAllocation,clock=Date.now}={}){
  if(typeof observeGuarded!=='function')throw new TypeError('Private live Guarded observer required');
  if(resolveAllocation!==undefined&&typeof resolveAllocation!=='function')throw new TypeError('Trusted canonical allocation resolver required');
  const leases=new Map(),envelopes=new Map(); // Database replay cannot revive process capabilities.
  let closed=false;
  function snapshot(s,request){
    if(closed)deny('RESEARCH_NATIVE_CLOSED');
    const trial=record(s,'trial',request.trialId,request.projectId),m=trial.manifest;
    verifyTrial(trial,record(s,'experiment',m.experimentId,request.projectId));
    const allocation=resolveAllocation?sync(resolveAllocation,s,{projectId:trial.projectId,trialId:trial.id,workspaceId:request.workspaceId,runOperationId:request.runOperationId,runId:request.runId,attemptId:request.attemptId}):null;
    if(allocation){
      const a=allocation.allocation,w=allocation.workspace,envelope=allocation.envelope;
      if(!a?.id||!allocation.composition?.id||!same(allocation.trial,trial)||!same(allocation.manifest,m)||!w||!same(w,s.events.find(e=>e.id===w.id&&e.type==='workspace.workspace'&&e.projectId===trial.projectId))||!same(allocation.task,s.tasks.find(e=>e.id===w.taskId&&e.projectId===trial.projectId))||a.workspaceId!==w.id||(a.runOperationId??a.operationId)!==`workspace-run:${w.id}`||!envelope||envelope.trialId!==trial.id||envelope.manifestDigest!==trial.manifestDigest||!same(envelope.limits,m.limits)||envelope.deadlineAt!==trial.deadlineAt||!Array.isArray(envelope.allocationIds)||!envelope.allocationIds.includes(a.id)||new Set(envelope.allocationIds).size!==envelope.allocationIds.length||envelope.allocationCount!==envelope.allocationIds.length||envelope.allocationCount>m.limits.maxAgents)deny('RESEARCH_NATIVE_ALLOCATION_CHANGED');
    }
    const workspace=allocation?.workspace??s.events.find(w=>w.id===m.workspaceId&&w.projectId===trial.projectId&&w.type==='workspace.workspace');
    const operationId=allocation?`workspace-run:${workspace.id}`:trial.runOperationId;
    const runs=s.runs.filter(r=>r.operationId===operationId),run=runs[0]??null;
    if(!workspace||runs.length>1||m.execution!=='agent'||!allocation&&(request.workspaceId!==m.workspaceId||workspace.taskId!==m.taskId||workspace.baseSha!==m.workspaceBase||trial.runOperationId!==`workspace-run:${workspace.id}`))deny('RESEARCH_NATIVE_OWNERSHIP');
    const expected={version:1,projectId:trial.projectId,trialId:trial.id,manifestDigest:trial.manifestDigest,workspaceId:workspace.id,taskId:workspace.taskId,runOperationId:operationId,runId:run?.id??null,attemptId:run?.attemptId??null,deadlineAt:trial.deadlineAt,route:m.contextPolicy.route,components:m.components,limits:m.limits};
    if(!same(request,expected))deny('RESEARCH_NATIVE_REQUEST_CHANGED');
    if(m.fault!=='none'||!allocation&&(m.policy!=='static'||['skills','staffing','adaptation'].some(k=>m.components[k])))deny('RESEARCH_NATIVE_COMPONENT_UNSUPPORTED');
    const limits=m.limits;
    if(limits.maxTokens!==null||limits.maxCost!==null||limits.unknownAccounting!=='allow'||limits.maxBytes>65536)deny('RESEARCH_NATIVE_LIMIT_UNSUPPORTED');
    if(!Number.isSafeInteger(trial.startedAt)||!Number.isSafeInteger(trial.deadlineAt)||trial.deadlineAt!==trial.startedAt+limits.maxMs||clock()>=trial.deadlineAt||trial.stopRequested||trial.restoreReviewRequired||workspace.stopRequested||workspace.restoreReviewRequired||!['reserved','dispatching','running'].includes(trial.status))deny('RESEARCH_NATIVE_STOPPED_OR_EXPIRED');
    const project=s.projects.find(p=>p.id===trial.projectId);
    if(!project||pathKey(project.workspace)!==pathKey(workspace.sourceRoot)||digest(project.profile)!==workspace.profileDigest||!same(researchContextPolicy(s,{projectId:trial.projectId,components:m.components}),m.contextPolicy)||digest(m.contextPolicy)!==m.contextPolicyDigest)deny('RESEARCH_NATIVE_POLICY_CHANGED');
    if(run&&(run.projectId!==trial.projectId||run.taskId!==workspace.taskId||!run.attemptId||run.stopRequest||run.stopRequested||run.revoked||!['submitting','running'].includes(run.status)||!same(run.researchContext,buildResearchContext(s,{projectId:trial.projectId,trialId:trial.id}))||!same(run.workspaceContext,contextFor(workspace))||allocation&&!run.researchComponentContext||workspace.id===m.workspaceId&&(trial.runId&&trial.runId!==run.id||trial.attemptId&&trial.attemptId!==run.attemptId)||pathKey(run.workspace??run.actualWorkspace??'')!==pathKey(workspace.worktreePath)))deny('RESEARCH_NATIVE_RUN_CHANGED');
    return {request:expected,trial,workspace,run,allocation};
  }
  function observe(s,x,stage){
    const o=sync(observeGuarded,s,{...x,stage});
    if(!o||!o.routeProof||o.routeProof.expiresAt<=clock()||o.routeProof.mode!=='mediated-actions'||o.routeProof.nativeActions!=='guarded'||o.routeProof.normalizedActions!=='guarded'||!o.routeProof.evidenceId||o.routeProof.projectId!==x.trial.projectId||o.routeProof.taskId!==x.workspace.taskId||o.route?.providerInstanceId!==x.request.route.providerId||o.route?.modelId!==x.request.route.modelId||!o.policyGeneration||!o.toolGeneration)deny('RESEARCH_NATIVE_LIVE_PROOF_REQUIRED');
    const scope={paths:['output.json'],capabilities:['read','propose','workspace.write']};
    if(!same(o.scope,scope)||o.routeProof.scopeDigest!==digest(scope)||o.limits?.maxTokens!==null||o.limits?.maxCost!==null||!Number.isSafeInteger(o.limits?.maxRunMs)||o.limits.maxRunMs<1||o.limits.maxRunMs>x.trial.manifest.limits.maxMs)deny('RESEARCH_NATIVE_SCOPE_CHANGED');
    if(x.run){
      const p=o.profile;
      if(!p||p.runId!==x.run.id||p.projectId!==x.run.projectId||p.taskId!==x.run.taskId||p.threadId!==x.run.threadId||p.expiresAt>x.trial.deadlineAt||p.expiresAt<=clock()||!same(p.route,o.route)||p.policyGeneration!==o.policyGeneration||p.toolGeneration!==o.toolGeneration||!same(p.scope,{...scope,maxBytes:x.request.limits.maxBytes}))deny('RESEARCH_NATIVE_PROFILE_CHANGED');
      if(['send','action','native-phase','model-request'].includes(stage)){
        const a=o.attestation;
        if(!a||a.profileDigest!==digest(p)||a.contextDigest!==p.contextDigest||a.manifestDigest!==p.manifestDigest||a.binarySha256!==p.route.opencodeBinarySha256||a.policyGeneration!==p.policyGeneration||a.toolGeneration!==p.toolGeneration||a.effects!==0||a.negativeCount!==17||!o.phases?.includes('openSession')||!o.phases?.includes('ensureThread'))deny('RESEARCH_NATIVE_ATTESTATION_REQUIRED');
      }
    }
    return o;
  }
  function requestForRun(s,run){
    if(!run?.researchContext)deny('RESEARCH_NATIVE_CONTEXT_REQUIRED');
    const t=record(s,'trial',run.researchContext.trialId,run.projectId),m=t.manifest;
    return {version:1,projectId:t.projectId,trialId:t.id,manifestDigest:t.manifestDigest,workspaceId:run.workspaceContext?.workspaceId??m.workspaceId,taskId:run.taskId,runOperationId:run.operationId,runId:run.id,attemptId:run.attemptId,deadlineAt:t.deadlineAt,route:m.contextPolicy.route,components:m.components,limits:m.limits};
  }
  const identity=(o,x)=>({route:o.route,policyGeneration:o.policyGeneration,toolGeneration:o.toolGeneration,scope:o.scope,routeEvidenceId:o.routeProof.evidenceId,profile:o.profile??null,allocation:x.allocation?{compositionId:x.allocation.composition.id,allocationId:x.allocation.allocation.id,workspaceId:x.workspace.id,runOperationId:x.request.runOperationId}:null});
  function live(s,request,stage){
    const x=snapshot(s,request),o=observe(s,x,stage),key=digest(request),entry=leases.get(key);
    if(!entry||!same(entry.identity,identity(o,x)))deny('RESEARCH_NATIVE_LEASE_REQUIRED');
    return {...x,o,entry,key};
  }
  function resources(s,x){
    const r=s.events.find(e=>e.id===x.entry.resourceId&&e.type==='research.native-resources'&&e.requestDigest===x.key&&e.runId===x.request.runId&&e.attemptId===x.request.attemptId);
    if(!r||r.digest!==digest({...r,digest:undefined}))deny('RESEARCH_NATIVE_RESOURCES_CHANGED');
    const g=s.events.find(e=>e.type==='research.native-envelope'&&e.id===r.envelopeId&&e.projectId===x.trial.projectId&&e.trialId===x.trial.id);
    if(!g||envelopes.get(x.trial.id)!==g.id||g.manifestDigest!==x.trial.manifestDigest||g.deadlineAt!==x.request.deadlineAt||!same(g.limits,x.request.limits)||g.digest!==digest({...g,digest:undefined}))deny('RESEARCH_NATIVE_ENVELOPE_CHANGED');
    return g;
  }
  function changed(r){r.revision++;r.digest=digest({...r,digest:undefined});}
  function event(s,kind,x,value){return append(s,kind,{version:1,requestDigest:x.key,runId:x.request.runId,attemptId:x.request.attemptId,trialId:x.trial.id,...value},x.trial.projectId,clock);}
  const api={
    requestForRun,
    retain(s,request){
      const x=snapshot(s,request),o=observe(s,x,'retain'),key=digest(request),existing=leases.get(key);
      if(existing){live(s,request,'retain');return api.qualification(s,request);}
      // A persisted run claim without this process capability is unknown. Never
      // reset counters or recreate an execution lease on restart.
      if(s.events.some(e=>e.type==='research.native-resources'&&e.trialId===x.trial.id&&e.runId===request.runId))deny('RESEARCH_NATIVE_RESTART_RECONCILE');
      const value={...x,key},stage=x.run?'reserved-mandatory-gates':'route-admission';
      let g=s.events.find(e=>e.type==='research.native-envelope'&&e.projectId===x.trial.projectId&&e.trialId===x.trial.id);
      if(g&&!envelopes.has(x.trial.id))deny('RESEARCH_NATIVE_RESTART_RECONCILE');
      if(!g){g=append(s,'native-envelope',{version:1,trialId:x.trial.id,manifestDigest:x.trial.manifestDigest,deadlineAt:request.deadlineAt,limits:clone(request.limits),nativePreparedRequests:0,modelRequests:0,retries:0,agents:0,agentRuns:[],actions:[],receipts:[],phases:[],tokens:null,cost:null,currency:null,finality:null,transportFailed:false},x.trial.projectId,clock);g.digest=digest(g);envelopes.set(x.trial.id,g.id);}
      const a=event(s,'native-actions',value,{stage,nativeComponents,compositionId:x.allocation?.composition.id??null,allocationId:x.allocation?.allocation.id??null,routeDigest:digest(o.route),scopeDigest:digest(o.scope),policyGeneration:o.policyGeneration,toolGeneration:o.toolGeneration,routeEvidenceId:o.routeProof.evidenceId});
      const r=event(s,'native-resources',value,{stage,envelopeId:g.id});r.digest=digest(r);
      const e=event(s,'enforcement',value,{mechanism:'guarded-native/1',nativeComponents,stage,actions:{ownerReceiptId:a.id},limits:{ownerReceiptId:r.id,...Object.fromEntries(limitKeys.map(k=>[k,request.limits[k]]))}});
      leases.set(key,{identity:clone(identity(o,x)),resourceId:r.id,receiptId:e.id,nonce:randomUUID()});return api.qualification(s,request);
    },
    qualification(s,request){try{const x=live(s,request,'qualification');resources(s,x);const e=s.events.find(e=>e.id===x.entry.receiptId&&e.requestDigest===x.key&&e.type==='research.enforcement');return e?{version:1,requestDigest:x.key,receiptId:e.id}:null;}catch{return null;}},
    admit(s,{run,stage='current',profile,attestation}){
      const x=live(s,requestForRun(s,run),stage);
      if(!same(x.run,run)||profile&&!same(profile,x.o.profile)||attestation&&!same(attestation,x.o.attestation))deny('RESEARCH_NATIVE_DETAIL_CHANGED');resources(s,x);return true;
    },
    nativePhase(s,{run,profile,body,attestation}){
      const boot=['create','discovery','attest','raw','resolved','executor'].includes(body?.phase);
      const x=live(s,requestForRun(s,run),boot?'current':'native-phase');
      if(!phases.has(body?.phase)||body.profileDigest!==digest(x.o.profile)||profile&&!same(profile,x.o.profile)||attestation&&!same(attestation,x.o.attestation))deny('RESEARCH_NATIVE_PHASE_DENIED');
      const r=resources(s,x);
      if(body.phase==='create'){if(r.agentRuns.includes(run.id)||r.agents>=x.request.limits.maxAgents)deny('RESEARCH_NATIVE_AGENT_LIMIT');r.agents++;r.agentRuns.push(run.id);}
      if(body.phase==='model-request'){if(r.nativePreparedRequests>=x.request.limits.maxSteps)deny('RESEARCH_NATIVE_STEP_LIMIT');r.nativePreparedRequests++;}
      if(!r.phases.includes(body.phase))r.phases.push(body.phase);changed(r);return true;
    },
    modelRequest(s,{run}){
      const x=live(s,requestForRun(s,run),'model-request'),r=resources(s,x);
      if(r.transportFailed)deny('RESEARCH_NATIVE_RETRY_DENIED');
      if(r.modelRequests>=x.request.limits.maxSteps)deny('RESEARCH_NATIVE_STEP_LIMIT');
      r.modelRequests++;changed(r);return {deadlineAt:x.request.deadlineAt,requestDigest:x.key,maxSteps:x.request.limits.maxSteps};
    },
    modelFailure(s,{run}){const x=live(s,requestForRun(s,run),'current'),r=resources(s,x);r.transportFailed=true;changed(r);},
    action(s,{run,profile,capability,path,attestation}){
      api.admit(s,{run,stage:'action',profile,attestation});if(path!=='output.json'||!['read','propose','workspace.write'].includes(capability))deny('RESEARCH_NATIVE_ACTION_SCOPE');return true;
    },
    reserveAction(s,{run,profile,operationId,requestDigest,capability,path,attestation,priorOperations}){
      api.action(s,{run,profile,capability,path,attestation});const x=live(s,requestForRun(s,run),'action'),r=resources(s,x);
      if(typeof operationId!=='string'||!operationId||!/^[a-f0-9]{64}$/.test(requestDigest))deny('RESEARCH_NATIVE_ACTION_ID');
      if(!Array.isArray(priorOperations)||priorOperations.some(a=>!a.runId||!a.operationId||!['unknown','completed'].includes(a.status)||!/^[a-f0-9]{64}$/.test(a.requestDigest)))deny('RESEARCH_NATIVE_DURABLE_ACTION_LEDGER_REQUIRED');
      const opKey=a=>a.runId+'\0'+a.operationId;
      const ids=new Set([...priorOperations.map(opKey),...r.actions.map(opKey)]);
      const previous=r.actions.find(a=>a.operationId===operationId&&a.runId===run.id);
      if(previous){if(previous.requestDigest!==requestDigest||previous.capability!==capability||previous.path!==path)deny('RESEARCH_NATIVE_ACTION_COLLISION');return true;}
      if(ids.has(opKey({runId:run.id,operationId})))deny('RESEARCH_NATIVE_UNKNOWN_ACTION');
      if(ids.size>=x.request.limits.maxSteps)deny('RESEARCH_NATIVE_ACTION_LIMIT');
      r.actions.push({runId:run.id,attemptId:run.attemptId,operationId,requestDigest,capability,path,outcome:'unknown'});changed(r);return true;
    },
    recordReceipt(s,{run,receipt}){
      const x=live(s,requestForRun(s,run),'action'),r=resources(s,x),a=r.actions.find(a=>a.operationId===receipt.operationId&&a.runId===run.id);
      if(!a||a.requestDigest!==receipt.requestDigest||receipt.owner!=='guarded-file-broker'||receipt.runId!==run.id||receipt.projectId!==run.projectId||receipt.taskId!==run.taskId||receipt.profileDigest!==digest(x.o.profile)||receipt.path!==a.path||receipt.capability!==a.capability||receipt.outcome!=='completed')deny('RESEARCH_NATIVE_RECEIPT_CHANGED');
      const existing=r.receipts.find(e=>e.id===receipt.id);if(existing&&!same(existing,receipt))deny('RESEARCH_NATIVE_RECEIPT_COLLISION');
      if(!existing)r.receipts.push(clone(receipt));a.outcome='completed';changed(r);
    },
    resourceSnapshot(s,request){const x=live(s,request,'qualification');return clone(resources(s,x));},
    close(){closed=true;leases.clear();envelopes.clear();},
  };
  return Object.freeze(api);
}
