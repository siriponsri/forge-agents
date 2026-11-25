import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { entity, find, changed, revision } from '../server/domain.mjs';
import { hash, stamp, error, text, clean, validateConfig } from './common.mjs';
import { ssh, sshHealth } from './ssh.mjs';
import { jupyterHealth, jupyterStart, jupyterStatus, jupyterStop } from './jupyter.mjs';
import { resource, transition } from './cloud.mjs';

const active=new Set(['queued','submitting','submitted','starting','running','stopping','unknown','interrupted','awaiting-owner']);
const terminal=new Set(['completed','failed','stopped']);
const codeOf=n=>typeof n.code==='string'?n.code:(n.cells??[]).filter(c=>c.cell_type==='code').map(c=>Array.isArray(c.source)?c.source.join(''):c.source??'').join('\n\n');
const publicJob=j=>{const out=structuredClone(j);delete out.ownerToken;return out;};
function selected(s,input){
  const p=find(s,'projects',input.projectId);let choice=p.profile?.compute??{kind:'local'};
  if(input.phaseId){find(s,'phases',input.phaseId,p.id);choice=p.profile?.phaseOverrides?.[input.phaseId]?.compute??choice;}
  const n=input.notebookId?find(s,'notebooks',input.notebookId,p.id):null;
  if(n?.compute?.connectionId||n?.compute?.targetId||n?.compute?.kind)choice=n.compute;
  const targetId=input.targetId??choice.connectionId??choice.targetId;
  if(targetId){const target=find(s,'connections',targetId,p.id);if(target.kind!=='compute')error('COMPUTE_CONFIG','Selected connection is not a compute target');return {project:p,notebook:n,target,config:validateConfig(target.config)};}
  if(choice.kind!=='local')error('COMPUTE_SETUP','Select a configured compute connection for this project/phase',409);
  return {project:p,notebook:n,target:null,config:{kind:'local',timeoutMs:15000}};
}
function owned(s,input){text(input.projectId,'projectId');find(s,'projects',input.projectId);const j=find(s,'jobs',input.jobId,input.projectId);if(!j.computeAttempt)error('COMPUTE_SCOPE','This job is not managed by compute service',409);return j;}
function notebook(n){
  const cells=n.cells?.length&&codeOf({cells:n.cells})===codeOf(n)?structuredClone(n.cells):[{cell_type:'code',metadata:{},source:codeOf(n).split(/(?<=\n)/),outputs:[],execution_count:null}];
  return {nbformat:4,nbformat_minor:5,metadata:{kernelspec:{name:'python3',display_name:'Python 3',language:'python'}},cells:cells.map(c=>({...c,metadata:c.metadata??{},...(c.cell_type==='code'?{execution_count:null,outputs:[]}:{} )}))};
}
export function createComputeService({dataDir,store,localJobs,admit,prepareRuntime}){
  const inflight=new Map(),deadlines=new Map();let closing=false;
  const runtimeFor=({projectId,config,targetId})=>prepareRuntime?prepareRuntime({projectId,config,targetId}):{};
  function armDeadline(j){
    const c=j.configSnapshot?.executor??j.configSnapshot;
    if(closing||c?.kind!=='jupyter'||terminal.has(j.status)||j.stopRequested||deadlines.has(j.id)||!j.deadlineAt)return;
    const timer=setTimeout(()=>{deadlines.delete(j.id);service.stop({projectId:j.projectId,jobId:j.id}).catch(()=>{});},Math.max(1,Date.parse(j.deadlineAt)-Date.now()));timer.unref();deadlines.set(j.id,timer);
  }
  const update=async(id,patch)=>store.transaction(s=>{const j=find(s,'jobs',id);Object.assign(j,patch);changed(j);return publicJob(j);});
  const snapshot=async(j)=>{const dir=path.join(dataDir,'compute',j.id);await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'source.ipynb'),JSON.stringify(j.sourceNotebook),{flag:'wx'});await writeFile(path.join(dir,'manifest.json'),JSON.stringify({jobId:j.id,projectId:j.projectId,operationId:j.operationId,source:j.source,config:j.configSnapshot,environment:j.environment,checkpoint:j.checkpoint??null,sourceNotebookSha256:hash(j.sourceNotebook)},null,2),{flag:'wx'});};
  async function observed(c,runtime={}){
    if(c.kind==='local')return {verified:!!localJobs,execution:!!localJobs,owner:'localJobs',resume:false};
    if(c.kind==='owner-ssh')return sshHealth(c,runtime);
    if(c.kind==='jupyter')return jupyterHealth(c,runtime);
    if(c.kind==='colab-browser')return {verified:false,execution:false,interactive:true,status:'owner-setup-required',setup:colabSetup()};
    const r=await resource(c,runtime);let executor=null;
    if(c.executor&&r.running){if(r.executorMatchesResource===false)error('RESOURCE_IDENTITY_MISMATCH','SSH target does not match the selected cloud resource',409);executor=await observed(c.executor,runtime);}
    return {verified:true,execution:r.running&&!!executor?.execution,resource:r,executor,executorBinding:c.executor?.kind==='jupyter'?'owner-configured; provider does not attest Jupyter URL':'provider-verified'};
  }
  async function refresh(j){
    if(j.computeAttempt.kind==='local')return publicJob(j);
    if(terminal.has(j.status)||j.computeAttempt.kind==='colab-browser')return publicJob(j);
    const c=j.configSnapshot.executor??j.configSnapshot;let r,runtime;armDeadline(j);
    try{runtime=await runtimeFor({projectId:j.projectId,config:j.configSnapshot,targetId:j.computeAttempt.targetId});r=c.kind==='owner-ssh'?await ssh(c,'status',j,runtime):await jupyterStatus(c,j,runtime);}catch(e){return update(j.id,{status:'unknown',lastError:clean(e.message,j.configSnapshot,runtime??{env:{}}),lastObservationAt:stamp()});}finally{runtime?.dispose?.();}
    const permitted=new Set([...active,...terminal]);if(!permitted.has(r.status))r={status:'unknown',reason:'Unrecognized execution state'};
    return update(j.id,{status:r.status,logs:clean(r.logs??j.logs,j.configSnapshot,runtime??{env:{}}).slice(-200000),lastObservationAt:stamp(),remoteObservation:{status:r.status,pid:r.pid??null,exitCode:r.exitCode??null,timedOut:r.timedOut??false},...(r.error||r.reason?{lastError:clean(r.error??r.reason,j.configSnapshot,runtime??{env:{}})}:{}),...(terminal.has(r.status)?{finishedAt:stamp()}:{} )});
  }
  const service={
    async configure(input){
      const config=validateConfig(input.config);
      return store.transaction(s=>{
        const p=find(s,'projects',input.projectId);if(input.phaseId)find(s,'phases',input.phaseId,p.id);
        let target;if(input.targetId){target=find(s,'connections',input.targetId,p.id);if(target.kind!=='compute')error('COMPUTE_SCOPE','Connection is not compute');revision(target,input.expectedRevision);target.config=config;target.name=config.name??config.kind;changed(target);}
        else{target=entity({kind:'compute',name:config.name??config.kind,config},p.id);s.connections.push(target);}
        if(input.select){p.profile??={};const choice={kind:config.kind,connectionId:target.id};if(input.phaseId){p.profile.phaseOverrides??={};p.profile.phaseOverrides[input.phaseId]={...p.profile.phaseOverrides[input.phaseId],compute:choice};}else p.profile.compute=choice;changed(p);}
        return target;
      });
    },
    async health(input){
      const {target,config}=selected(store.read(),input);let result,runtime;
      try{runtime=await runtimeFor({projectId:input.projectId,config,targetId:target?.id});result={status:'observed',...(await observed(config,runtime)),checkedAt:stamp()};}catch(e){result={status:'error',verified:false,execution:false,code:e.code??'COMPUTE_HEALTH',message:clean(e.message,config,runtime??{env:{}}),checkedAt:stamp()};}finally{runtime?.dispose?.();}
      if(target)await store.transaction(s=>{const t=find(s,'connections',target.id,input.projectId);if(t.revision===target.revision){t.health=result;changed(t);}});
      return result;
    },
    async start(input){
      text(input.operationId,'operationId');text(input.projectId,'projectId');text(input.notebookId,'notebookId');
      const fingerprint=hash({projectId:input.projectId,notebookId:input.notebookId,phaseId:input.phaseId??null,targetId:input.targetId??null,mode:input.mode??'restart',previousJobId:input.previousJobId??null,checkpointArtifactId:input.checkpointArtifactId??null});
      const existing=store.read().jobs.find(j=>j.operationId===input.operationId);
      if(existing){if(existing.computeFingerprint!==fingerprint)error('OPERATION_REUSE','Compute operationId was reused with different inputs',409);return publicJob(existing);}
      if(store.read().receipts.some(r=>r.operationId===input.operationId))error('OPERATION_REUSE','Operation ID already belongs to another action',409);
      if(closing)error('COMPUTE_CLOSED','Compute service is shutting down',409);
      if(inflight.has(input.operationId)){const pending=inflight.get(input.operationId);if(pending.fingerprint!==fingerprint)error('OPERATION_REUSE','Compute operation is already reserved',409);return pending.promise;}
      if([...inflight.values()].some(v=>v.projectId===input.projectId))error('WORKSPACE_BUSY','A compute submission already owns this workspace',409);
      const execute=async()=>{
        const sel=selected(store.read(),input),{project:p,notebook:n,config:c,target}=sel;
        if(n.language&&n.language!=='python')error('COMPUTE_LANGUAGE','Only Python notebook execution is supported');
        if(!['restart','resume'].includes(input.mode??'restart'))error('COMPUTE_MODE','mode must be restart or resume');
        const sourceCode=codeOf(n);let checkpoint=null;
        if(input.previousJobId){const prev=owned(store.read(),{projectId:p.id,jobId:input.previousJobId});if(prev.notebookId!==n.id)error('COMPUTE_SCOPE','Previous attempt belongs to another notebook');if(!terminal.has(prev.status))error('COMPUTE_UNCERTAIN','Reconcile and stop the previous attempt before starting another',409);}
        if(input.mode==='resume'){
          if(!input.previousJobId)error('RESUME_UNSUPPORTED','Resume requires an explicit previous attempt',409);
          const prev=owned(store.read(),{projectId:p.id,jobId:input.previousJobId});const cap=n.compute?.resume;
          if(c.kind==='local'||c.kind==='colab-browser'||cap?.protocol!=='forge-checkpoint-env-v1'||cap.sourceSha256!==hash(sourceCode)||prev.source.sha256!==hash(sourceCode))error('RESUME_UNSUPPORTED','This source/target does not declare the verified checkpoint environment protocol; use restart',409);
          const a=find(store.read(),'artifacts',input.checkpointArtifactId,p.id);const location=a.locations?.find(l=>l.kind==='compute'&&l.targetId===target?.id&&l.verifiedAt&&l.sha256===a.sha256);
          if(a.kind!=='checkpoint'||a.status!=='verified'||!location)error('CHECKPOINT_UNVERIFIED','Select a verified checkpoint location on this exact target',409);
          checkpoint={artifactId:a.id,sha256:a.sha256,path:text(location.path,'checkpoint path'),targetId:target.id};
        }else if(input.checkpointArtifactId)error('COMPUTE_MODE','Checkpoint requires resume mode');
        if(c.kind==='local'){
          if(!localJobs)error('COMPUTE_SETUP','Local job owner is not connected',409);
          if(store.read().jobs.some(j=>j.projectId===p.id&&j.computeAttempt&&active.has(j.status)))error('WORKSPACE_BUSY','Reconcile or stop the active workspace execution first',409);
          const j=await localJobs.start({...input,resolvedCompute:{kind:'local',notebookRevision:n.revision,projectRevision:p.revision,targetId:target?.id??null,targetRevision:target?.revision??null}});
          return update(j.id,{computeFingerprint:fingerprint,computeAttempt:{kind:'local',targetId:target?.id??null},source:{notebookId:n.id,revision:j.sourceRevision,sha256:hash(j.code??sourceCode)},configSnapshot:c,environment:{revision:c.environmentRevision??null,qualification:'local-job-owner'},artifactRefs:[],checkpointRefs:[],mode:'restart'});
        }
        // Reserve before any network mutation. Unknown outcomes remain durable and cannot be replayed as new work.
        const j=await store.transaction(s=>{
          const duplicate=s.jobs.find(x=>x.operationId===input.operationId);if(duplicate){if(duplicate.computeFingerprint!==fingerprint)error('OPERATION_REUSE','Operation ID conflict',409);return {...duplicate,replayed:true};}
          const current=selected(s,input);if(current.project.revision!==p.revision||current.notebook.revision!==n.revision||current.target?.revision!==target?.revision)error('REVISION_CONFLICT','Notebook or compute selection changed before dispatch',409);
          if(s.jobs.some(x=>x.projectId===p.id&&x.computeAttempt&&active.has(x.status)))error('WORKSPACE_BUSY','Another execution owns the workspace; reconcile first',409);
          admit?.(s,input);
          const limitSeconds=Math.min(Math.max(Number(p.profile?.limits?.jobSeconds)||120,1),86400);
          const job=entity({kind:'compute-notebook',computeFingerprint:fingerprint,operationId:input.operationId,notebookId:n.id,phaseId:input.phaseId??null,computeAttempt:{kind:c.kind,targetId:target?.id??null,targetRevision:target?.revision??null},sourceRevision:n.revision,source:{notebookId:n.id,revision:n.revision,sha256:hash(sourceCode)},sourceNotebook:notebook(n),code:sourceCode,configSnapshot:c,configRevision:hash(c),environment:{revision:c.environmentRevision??null,qualification:'not-yet-observed'},workspace:p.workspace,profileRevision:p.revision,ownerToken:randomUUID(),status:'submitting',logs:'',remote:null,mode:input.mode??'restart',previousJobId:input.previousJobId??null,checkpoint,checkpointRefs:checkpoint?[checkpoint.artifactId]:[],artifactRefs:[],limitSeconds,startedAt:stamp(),deadlineAt:new Date(Date.now()+limitSeconds*1000).toISOString()},p.id);s.jobs.push(job);return job;
        });
        if(j.replayed)return publicJob(j);
        let dispatchStarted=false,runtime;
        try{
          await snapshot(j);
          if(c.kind==='colab-browser')return update(j.id,{status:'awaiting-owner',setup:colabSetup(),evidenceScope:'owner-interactive; execution has not been observed'});
          runtime=await runtimeFor({projectId:p.id,config:c,targetId:target?.id});
          const health=await observed(c,runtime);await update(j.id,{environment:{...j.environment,observation:health,credentialReferences:runtime.references??[],observedAt:stamp()}});
          const stopped=()=>!!find(store.read(),'jobs',j.id).stopRequested;
          if(stopped())return update(j.id,{status:'stopped',finishedAt:stamp()});
          if(!health.execution)error('COMPUTE_NOT_READY','Selected target is not execution-ready; inspect health and configure its identity/executor',409);
          const exec=c.executor??c;let r;
          admit?.(store.read(),input,{jobId:j.id});
          dispatchStarted=true;
          if(exec.kind==='owner-ssh')r=await ssh(exec,'start',j,runtime);
          else r=await jupyterStart(exec,j,remote=>update(j.id,{remote}),stopped,runtime);
          const result=await update(j.id,{status:r.status,logs:clean(r.logs,c,runtime),submittedAt:stamp(),remote:{...store.read().jobs.find(x=>x.id===j.id).remote,...r.remote},lastObservationAt:stamp()});armDeadline(find(store.read(),'jobs',j.id));return result;
        }catch(e){await update(j.id,{status:e.code==='COMPUTE_CANCELLED'?'stopped':dispatchStarted?'unknown':'failed',lastError:clean(e.message,c,runtime??{env:{}}),errorCode:e.code??'COMPUTE_ERROR'});return publicJob(find(store.read(),'jobs',j.id));}finally{runtime?.dispose?.();}
      };
      const promise=Promise.resolve().then(execute);inflight.set(input.operationId,{fingerprint,promise,projectId:input.projectId});try{return await promise;}finally{inflight.delete(input.operationId);}
    },
    async status(input){return refresh(owned(store.read(),input));},
    async logs(input){const j=await service.status(input);return {jobId:j.id,status:j.status,logs:j.logs??'',observedAt:j.lastObservationAt??null,source:j.source};},
    async stop(input){
      const j=owned(store.read(),input);if(terminal.has(j.status))return publicJob(j);
      if(j.computeAttempt.kind==='local'){if(!localJobs)error('COMPUTE_SETUP','Local job owner is not connected',409);await localJobs.stop(j.id);return publicJob(find(store.read(),'jobs',j.id));}
      if(j.computeAttempt.kind==='colab-browser')return update(j.id,{stopRequested:true,status:'unknown',lastError:'Stop execution in the owner Colab notebook. FORGE cannot acknowledge browser kernel cancellation.'});
      await update(j.id,{stopRequested:true,status:'stopping'});const c=j.configSnapshot.executor??j.configSnapshot;let runtime;
      try{runtime=await runtimeFor({projectId:j.projectId,config:j.configSnapshot,targetId:j.computeAttempt.targetId});const r=c.kind==='owner-ssh'?await ssh(c,'stop',j,runtime):await jupyterStop(c,j,runtime);return update(j.id,{status:r.status,lastObservationAt:stamp()});}
      catch(e){return update(j.id,{status:'unknown',lastError:clean(e.message,j.configSnapshot,runtime??{env:{}})});}finally{runtime?.dispose?.();}
    },
    async reconcile(input={}){
      if(input.projectId)find(store.read(),'projects',input.projectId);
      const reconcileJob=async j=>j.computeAttempt.kind==='local'&&localJobs?.reconcile?publicJob(await localJobs.reconcile({projectId:j.projectId,jobId:j.id})):refresh(j);
      if(input.jobId)return reconcileJob(owned(store.read(),input));
      const jobs=store.read().jobs.filter(j=>j.computeAttempt&&j.computeAttempt.kind!=='colab-mcp'&&(!input.projectId||j.projectId===input.projectId)&&active.has(j.status));
      const results=[];for(const j of jobs)results.push(await reconcileJob(j));
      for(const r of store.read().receipts.filter(r=>r.kind==='compute-lifecycle'&&(!input.projectId||r.projectId===input.projectId)&&['submitting','requested','unknown'].includes(r.status))){
        let patch,runtime;try{runtime=await runtimeFor({projectId:r.projectId,config:r.configSnapshot,targetId:r.targetId});const observation=await resource(r.configSnapshot,runtime);const reached=r.action==='start'?observation.running:['stopped','EXITED'].includes(observation.state);patch={status:reached?'completed':'unknown',observation,lastObservationAt:stamp()};}catch(e){patch={status:'unknown',message:clean(e.message,r.configSnapshot,runtime??{env:{}}),lastObservationAt:stamp()};}finally{runtime?.dispose?.();}
        results.push(await store.transaction(s=>{const current=s.receipts.find(x=>x.operationId===r.operationId);Object.assign(current,patch);return current;}));
      }
      return results;
    },
    async lifecycle(input){
      text(input.operationId,'operationId');if(!input.targetId)error('COMPUTE_CONFIG','Explicit targetId required for resource lifecycle');
      const {config:c,target}=selected(store.read(),input);if(!['vast','runpod'].includes(c.kind))error('COMPUTE_POLICY','Resource lifecycle is only supported for existing Vast/Runpod resources');
      if(!['start','stop'].includes(input.action))error('COMPUTE_POLICY','No provisioning, deletion, resize or purchase operation is supported');
      const fingerprint=hash({projectId:input.projectId,targetId:input.targetId,config:hash(c),action:input.action});
      if(store.read().jobs.some(j=>j.operationId===input.operationId))error('OPERATION_REUSE','Operation ID already belongs to a notebook execution',409);
      const receipt=await store.transaction(s=>{const prev=s.receipts.find(r=>r.operationId===input.operationId);if(prev){if(prev.fingerprint!==fingerprint)error('OPERATION_REUSE','Lifecycle operation ID conflict',409);return {...prev,replayed:true};}if(s.jobs.some(j=>j.computeAttempt?.targetId===target.id&&active.has(j.status)))error('COMPUTE_BUSY','Stop/reconcile owned notebook executions before resource lifecycle',409);const r={operationId:input.operationId,projectId:input.projectId,targetId:target.id,kind:'compute-lifecycle',fingerprint,status:'submitting',action:input.action,resourceId:c.resourceId,configSnapshot:c,createdAt:stamp()};s.receipts.push(r);return r;});
      if(receipt.replayed)return receipt;
      let result,runtime;try{runtime=await runtimeFor({projectId:input.projectId,config:c,targetId:target.id});result=await transition(c,input.action,runtime);}catch(e){result={status:e.code==='COMPUTE_UNCERTAIN'?'unknown':'failed',code:e.code,message:clean(e.message,c,runtime??{env:{}})};}finally{runtime?.dispose?.();}
      return store.transaction(s=>{const r=s.receipts.find(r=>r.operationId===input.operationId);Object.assign(r,result,{observedAt:stamp()});return r;});
    },
    async exportNotebook(input){
      const j=owned(store.read(),input);const doc=structuredClone(j.sourceNotebook??notebook({code:j.code}));doc.metadata.forge={projectId:j.projectId,jobId:j.id,sourceSha256:j.source.sha256,sourceRevision:j.source.revision};return {name:`forge-${j.id}.ipynb`,content:JSON.stringify(doc,null,2),sha256:hash(doc),setup:j.computeAttempt.kind==='colab-browser'?colabSetup():null};
    },
    async importResult(input){
      const j=owned(store.read(),input);if(j.computeAttempt.kind!=='colab-browser')error('COMPUTE_SCOPE','Interactive result import is for Colab browser attempts');
      if(terminal.has(j.status))error('REVISION_CONFLICT','This result was already finalized',409);
      const n=input.notebook;if(!n||n.nbformat!==4||!Array.isArray(n.cells)||n.metadata?.forge?.jobId!==j.id||n.metadata?.forge?.projectId!==j.projectId||hash(codeOf({cells:n.cells}))!==j.source.sha256)error('SOURCE_MISMATCH','Import the saved notebook for this exact attempt and source revision',409);
      const outputs=n.cells.flatMap(c=>c.outputs??[]);if(!n.cells.some(c=>c.cell_type==='code'&&Number.isInteger(c.execution_count)))error('COMPUTE_EVIDENCE','Notebook has no executed cell evidence');
      const bytes=JSON.stringify(n);if(bytes.length>2000000)error('COMPUTE_EVIDENCE','Notebook result exceeds 2 MB');
      const safe=clean(bytes,j.configSnapshot);const file=path.join(dataDir,'compute',j.id,'owner-result.ipynb');await writeFile(file,safe,{flag:'wx'});
      return update(j.id,{status:outputs.some(o=>o.output_type==='error')?'failed':'completed',logs:clean(outputs.map(o=>Array.isArray(o.text)?o.text.join(''):o.text??o.evalue??'').join('\n'),j.configSnapshot).slice(-200000),resultRef:{path:file,sha256:hash(safe),bytes:Buffer.byteLength(safe)},evidenceScope:'owner-imported notebook outputs; not remotely attested execution',finishedAt:stamp()});
    },
    async linkArtifact(input){return store.transaction(s=>{const j=owned(s,input),a=find(s,'artifacts',input.artifactId,input.projectId);if(a.status!=='verified')error('COMPUTE_EVIDENCE','Artifact must be verified');if(!j.artifactRefs.includes(a.id))j.artifactRefs.push(a.id);changed(j);return publicJob(j);});},
    async shutdown(){closing=true;for(const timer of deadlines.values())clearTimeout(timer);deadlines.clear();await Promise.allSettled([...inflight.values()].map(x=>x.promise));/* Remote ownership is durable: shutdown detaches; it never stops an entire resource. */},
  };
  return service;
}
function colabSetup(){return {route:'owner-interactive-notebook',url:'https://colab.research.google.com/',steps:['Export this attempt as .ipynb.','Open Colab using the owner browser account; File > Upload notebook.','Select an available runtime and run the reviewed notebook interactively.','Save required artifacts outside the ephemeral runtime. Download the notebook with outputs; import it into this same attempt.','Stop/disconnect using Colab runtime controls. FORGE cannot attest an interactive kernel stop.'],capabilities:{notebookImportExport:true,automaticExecution:false,automaticCancel:false,remoteApi:false},remoteApi:{status:'not-implemented',endpoint:'https://colaboratory.googleapis.com/mcp',blocker:'Hosted API is a distinct authenticated MCP route requiring account/project enablement and execution/session ownership; browser import/export does not implement it.'}};}
