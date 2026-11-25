import {randomUUID} from 'node:crypto';
import {entity,find,fail,changed,revision,records,record,append,exact,text,definition,digest,fileBytes,snapshot,sourceRevision,verifier} from './contracts.mjs';
import {planSignature,taskSignature,ownedRun} from '../goals/contracts.mjs';
import {createLocalMissionTools} from './local.mjs';
import {deliveryZip,verifyDeliveryPack} from './package.mjs';
export {verifyDeliveryPack} from './package.mjs';

export const MISSION_HTTP_METHODS=Object.freeze(['state','create','revise','approve','execute','registerOutput','verify','qa','review','pack','download','preview','stopPreview']);
const common=['projectId','operationId','missionId','expectedRevision'];
const fields={state:['projectId'],create:['definition'],revise:['definition'],approve:[],execute:['action','taskId','expectedGoalRevision','conversationId'],registerOutput:['outputKey','runId'],verify:['outputKey','runId','reviewDigest'],qa:['taskId','expectedGoalRevision'],review:['expectedGoalRevision'],pack:[],download:['projectId','packId'],preview:['outputKey'],stopPreview:['previewId']};
export async function dispatchMissionRequest(service,method,input,caller){
  if(!MISSION_HTTP_METHODS.includes(method))fail('NOT_FOUND','Unsupported Missions API method',404);
  exact(input,['state','download'].includes(method)?fields[method]:[...common,...fields[method]]);
  return service[method](input,caller);
}

// One canonical SQLite store and one Goals/T3 execution owner. Mission events
// describe intent/revisions/delivery; they are never a parallel task database.
export function createMissionService({store,goals,t3,artifacts,authorize,local=createLocalMissionTools()}){
  let suspended=false,closed=false;const work=new Set(),previews=new Map(),previewStarting=new Map();
  const get=(i,s=store.read())=>record(s,'definition',i.missionId,i.projectId);
  const goal=(s,m)=>{const g=find(s,'events',m.goalId,m.projectId);if(g.type!=='goal.goal')fail('GOAL_SCOPE','Not an existing Goals record',409);return g;};
  function active(){if(closed||suspended)fail('RESTORING','Missions is stopped or suspended for restore',409);}
  async function human(action,i,caller){
    find(store.read(),'projects',i.projectId);
    const actor=await authorize?.({action,projectId:i.projectId,missionId:i.missionId,expectedRevision:i.expectedRevision},caller);
    if(actor?.kind!=='human'||!actor.subject||actor.role!==(action==='qa'?'qa':'owner')||action==='qa'&&!actor.independent)fail('HUMAN_REVIEW_REQUIRED','Use the authenticated Owner session; review identity cannot come from JSON',403);
    return {kind:'human',subject:actor.subject,role:actor.role,...(action==='qa'?{independent:true}:{})};
  }
  function tracked(fn){const p=Promise.resolve().then(fn);work.add(p);p.then(()=>work.delete(p),()=>work.delete(p));return p;}
  async function mutate(method,i,caller,fn){
    active();exact(i,[...common,...fields[method]]);text(i.operationId,'Operation id',180);i=structuredClone(i);const actor=await human(method==='qa'?'qa':'mission',i,caller),fingerprint=digest({service:'missions',method,input:i});
    return store.transaction(async s=>{
      active();find(s,'projects',i.projectId);const old=s.receipts.find(r=>r.operationId===i.operationId);
      if(old){if(old.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to a different command',409);return old.result;}
      const m=method==='create'?null:get(i,s);if(m)revision(m,i.expectedRevision);
      const result=await fn(s,m,i,actor);s.receipts.push({operationId:i.operationId,type:'mission.command',method,fingerprint,result:structuredClone(result)});return result;
    });
  }
  async function replay(method,i,caller){
    active();exact(i,[...common,...fields[method]]);text(i.operationId,'Operation id',180);await human('mission',i,caller);
    const old=store.read().receipts.find(r=>r.operationId===i.operationId);if(!old)return null;
    if(old.fingerprint!==digest({service:'missions',method,input:i}))fail('OPERATION_REUSE','Operation ID belongs to a different command',409);return old.result;
  }
  function buildPlan(s,m){
    const d=m.definition,p=entity({name:d.title,description:`${d.objective}\nConstraints: ${d.constraints}\nInputs: ${d.inputs}`,approved:false},m.projectId);s.plans.push(p);
    const ids={};for(const o of d.outputs){if(o.botId)find(s,'bots',o.botId,m.projectId);const task=entity({title:o.name,description:`${d.objective}\nOutput: ${o.path}\nAcceptance: ${o.acceptance}\nTests (argv, no shell): ${JSON.stringify(['node','--test','--test-concurrency=1','--',...o.testFiles])}\nConstraints: ${d.constraints}\nInputs: ${d.inputs}\nDecisions: ${JSON.stringify(d.decisions)}\nRegister actual file bytes and request independent QA; a completion message is insufficient.`,planId:p.id,botId:o.botId,status:'backlog',dependsOn:o.dependsOn.map(k=>ids[k]),runIds:[],artifactIds:[],evidence:[]},m.projectId);s.tasks.push(task);ids[o.key]=task.id;}
    m.planId=p.id;m.taskIds=ids;m.goalId=null;m.status='draft';m.approval=null;m.review=null;
    append(s,'revision',{missionId:m.id,definitionRevision:m.definitionRevision,definition:d,planId:p.id,taskIds:ids},m.projectId);
  }
  function current(s,m){
    if(!m.approval||m.restoreReviewRequired)fail('OWNER_REVIEW_REQUIRED','Review the current mission after changes or restore',409);
    const p=find(s,'plans',m.planId,m.projectId);if(planSignature(p)!==m.approval.planSignature)fail('PLAN_CHANGED','Canonical plan changed; create a reviewed mission revision',409);
    for(const id of Object.values(m.taskIds))if(taskSignature(find(s,'tasks',id,m.projectId))!==m.approval.taskSignatures[id])fail('TASK_CHANGED','Canonical task definition changed',409);
    const g=goal(s,m);if(g.planId!==m.planId||digest(g.taskIds)!==digest(Object.values(m.taskIds))||digest(g.criteria)!==digest(m.goalCreate.criteria)||g.objective!==m.definition.objective)fail('GOAL_CHANGED','Goal acceptance changed; create a new reviewed mission revision',409);return g;
  }
  function output(m,key){const o=m.definition.outputs.find(o=>o.key===key);if(!o)fail('OUTPUT_SCOPE','Select a deliverable in this mission');return o;}
  function attempt(s,m,o,runId){
    const g=current(s,m),r=find(s,'runs',runId,m.projectId),a=g.attempts.find(a=>a.operationId===r.operationId);
    if(!a||a.context.goalRevision!==g.goalRevision||a.taskId!==m.taskIds[o.key]||ownedRun(s,g,a)?.id!==r.id||!r.attemptId||r.status!=='completed'||!r.selection?.model||!r.selection?.instanceId)fail('RUN_SCOPE','A completed exact Goals/T3 attempt with observed provider selection is required',409);
    return {g,r,a};
  }
  const outputs=(s,m)=>records(s,'output',m.projectId).filter(x=>x.missionId===m.id&&x.definitionRevision===m.definitionRevision);
  async function checkOutput(s,m,o){
    const x=outputs(s,m).filter(x=>x.outputKey===o.key).at(-1);if(!x)fail('EVIDENCE_REQUIRED',`Register deliverable ${o.name}`,409);
    const {r}=attempt(s,m,o,x.runId);if(r.attemptId!==x.attemptId)fail('RUN_SCOPE','Run attempt changed',409);
    const a=find(s,'artifacts',x.artifactId,m.projectId),p=find(s,'projects',m.projectId),f=await fileBytes(p.workspace,o.path);
    if(f.sha256!==x.sha256||a.sha256!==x.sha256||f.bytes.length!==x.bytes)fail('INTEGRITY','Deliverable bytes changed; register and verify a new revision',409);
    return {x,r,a,bytes:f.bytes};
  }
  async function checked(s,m,{taskId}={}){
    const result=[];
    for(const o of m.definition.outputs.filter(o=>!taskId||m.taskIds[o.key]===taskId)){
      const value=await checkOutput(s,m,o),latest=records(s,'test',m.projectId).filter(v=>v.outputId===value.x.id).at(-1),v=latest?.status==='PASSED'&&s.events.find(v=>v.type==='verification.result'&&v.projectId===m.projectId&&v.missionId===m.id&&v.outputId===value.x.id&&v.runId===value.r.id&&v.attemptId===value.r.attemptId&&v.verifier?.id===verifier(m,o).id&&v.status==='PASSED'&&v.checks?.some(c=>c.testId===latest.id));
      if(!v)fail('TESTS_REQUIRED',`Run the reviewed tests for ${o.name}`,409);
      const source=await snapshot(find(s,'projects',m.projectId).workspace,o);if(digest(source)!==digest(v.sourceFiles))fail('EVIDENCE_STALE','Source or test bytes changed since verification',409);
      result.push({...value,o,verification:v,source});
    }
    if(!result.length)fail('TASK_SCOPE','Task is outside this mission',409);return result;
  }
  async function external(method,i,caller){
    active();exact(i,[...common,...fields[method]]);await human(method==='qa'?'qa':'mission',i,caller);
    const s=store.read(),m=get(i,s);revision(m,i.expectedRevision);const g=method==='execute'&&['pause','cancel','reconcile'].includes(i.action)?goal(s,m):current(s,m);
    if(method==='qa'||method==='review')await checked(s,m,{taskId:method==='qa'?i.taskId:undefined});
    const action=method==='execute'?i.action:method;if(!['resume','advance','reconcile','pause','cancel','qa','review'].includes(action))fail('VALIDATION','Unsupported existing Goals action');
    if(action==='reconcile'){
      const a=g.attempts.at(-1),r=a&&ownedRun(s,g,a);
      // Refresh only the existing T3 observation. A terminal attempt must not
      // receive a premature one-shot Goals verdict before Mission tests exist.
      if(r&&t3?.reconcile)await t3.reconcile(r.id);
      const state=store.read(),run=a&&ownedRun(state,goal(state,m),a);
      if(run?.status==='completed')await checked(state,m,{taskId:run.taskId});
      else if(run&&!['failed','cancelled','interrupted','rolled_back'].includes(run.status)&&!t3?.reconcile)fail('T3_OBSERVATION_REQUIRED','Refresh the exact run through the injected T3 owner before reconciliation',409);
    }
    const args={projectId:i.projectId,operationId:i.operationId,goalId:g.id,expectedRevision:i.expectedGoalRevision};
    if(i.taskId!==undefined)args.taskId=i.taskId;if(i.conversationId!==undefined)args.conversationId=i.conversationId;
    if(!['advance','qa'].includes(action))delete args.taskId;if(action!=='advance')delete args.conversationId;
    return goals[action](args,caller);
  }
  const api={
    async state(i,caller){
      exact(i,fields.state);await human('mission',i,caller);const s=store.read(),missions=records(s,'definition',i.projectId),commandReviews=[];
      for(const m of missions)for(const o of m.definition.outputs){try{const v=await checkOutput(s,m,o),sourceFiles=await snapshot(find(s,'projects',i.projectId).workspace,o);commandReviews.push({missionId:m.id,outputKey:o.key,outputId:v.x.id,runId:v.r.id,sourceFiles,reviewDigest:digest({missionId:m.id,definitionRevision:m.definitionRevision,outputId:v.x.id,sourceFiles,testFiles:o.testFiles}),command:['node','--test','--test-concurrency=1','--',...o.testFiles],maxMs:30000});}catch{/* Missing outputs are ordinary draft state. */}}
      return {missions,outputs:records(s,'output',i.projectId),packs:records(s,'pack',i.projectId),commandReviews,previews:[...previews.values()].filter(x=>x.projectId===i.projectId&&Date.parse(x.expiresAt)>Date.now()),capabilities:{executionOwner:'existing Goals / T3',verification:'Owner-reviewed node --test; no OS sandbox',preview:'immutable registered static files, loopback only',delivery:'portable checksummed ZIP',restore:'metadata requires new Owner mission revision; no automatic execution',homeUat:'NOT_RUN'}};
    },
    create:(i,c)=>mutate('create',i,c,(s,_m,i,actor)=>{const m=append(s,'definition',{definition:definition(i.definition),definitionRevision:1,actor},i.projectId);buildPlan(s,m);return m;}),
    revise:(i,c)=>mutate('revise',i,c,(s,m,i,actor)=>{
      if(m.status==='approving')fail('RECONCILE_REQUIRED','Finish the durable approval first',409);
      if(m.goalId){const g=goal(s,m);if(!['cancelled','completed','exhausted'].includes(g.status)||g.attempts.some(a=>!a.reconciled&&a.status!=='cancelled_before_dispatch'))fail('RECONCILE_REQUIRED','Cancel or finish and reconcile the existing Goal before revising',409);}
      m.definition=definition(i.definition);m.definitionRevision++;m.restoreReviewRequired=false;m.actor=actor;buildPlan(s,m);changed(m);return m;
    }),
    approve:(i,c)=>tracked(async()=>{
      const reserved=await mutate('approve',i,c,(s,m,_i,actor)=>{
        if(!m.goalId&&m.status==='approving')return m;
        if(m.goalId||m.status!=='draft')fail('ALREADY_APPROVED','This mission already has an approval',409);
        if(m.definition.decisions.some(d=>!d.answer.trim()))fail('DECISION_REQUIRED','Answer the unresolved decisions before approving',409);
        const p=find(s,'plans',m.planId,m.projectId);p.approved=true;changed(p);m.approval={actor,definitionRevision:m.definitionRevision,planSignature:planSignature(p),taskSignatures:Object.fromEntries(Object.values(m.taskIds).map(id=>[id,taskSignature(find(s,'tasks',id,m.projectId))]))};
        m.status='approving';m.goalCreate={projectId:m.projectId,operationId:`${i.operationId}:goal`,planId:p.id,objective:m.definition.objective,taskIds:Object.values(m.taskIds),criteria:m.definition.outputs.map(o=>({id:o.key,taskId:m.taskIds[o.key],description:o.acceptance,kind:'verifierReceipt',verifier:verifier(m,o)})),policy:{mode:'manual',maxAttempts:12,maxAttemptsPerTask:3,maxMs:3600000,maxUnchangedFailures:2,tokens:{unknown:'block',maxTotal:null},reportedCost:{unknown:'block',maxAmount:null,currency:null}}};changed(m);return m;
      });
      active();const g=await goals.create(reserved.goalCreate);
      return store.transaction(s=>{active();const m=get(i,s);if(m.definitionRevision!==reserved.definitionRevision)fail('REVISION_CONFLICT','Mission changed during approval',409);if(m.goalId&&m.goalId!==g.id)fail('GOAL_SCOPE','Another Goal is linked',409);if(!m.goalId){m.goalId=g.id;m.status='approved';changed(m);append(s,'approval',{missionId:m.id,goalId:g.id,...m.approval},m.projectId);}return m;});
    }),
    execute:(i,c)=>tracked(()=>external('execute',i,c)),qa:(i,c)=>tracked(()=>external('qa',i,c)),review:(i,c)=>tracked(()=>external('review',i,c)),
    registerOutput:(i,c)=>tracked(async()=>{
      const prior=await replay('registerOutput',i,c);if(prior)return prior;
      active();await human('mission',i,c);const s=store.read(),m=get(i,s);revision(m,i.expectedRevision);const o=output(m,i.outputKey),{r}=attempt(s,m,o,i.runId),p=find(s,'projects',m.projectId),f=await fileBytes(p.workspace,o.path),source=await sourceRevision(p.workspace,o);
      const a=await artifacts.register({projectId:m.projectId,path:o.path,kind:'mission-output',source:{kind:'mission',missionId:m.id,definitionRevision:m.definitionRevision,taskId:r.taskId,runId:r.id,attemptId:r.attemptId,provider:r.selection,sourceRevision:{plan:m.approval.planSignature,task:m.approval.taskSignatures[r.taskId]}}});
      if(a.sha256!==f.sha256)fail('INTEGRITY','Output changed during registration',409);
      return mutate('registerOutput',i,c,async(s,m)=>{const {r}=attempt(s,m,o,i.runId),bytes=await fileBytes(p.workspace,o.path);if(bytes.sha256!==a.sha256||digest(await snapshot(p.workspace,o))!==source.sha256)fail('INTEGRITY','Output/source changed during registration',409);const x=append(s,'output',{missionId:m.id,definitionRevision:m.definitionRevision,outputKey:o.key,taskId:r.taskId,runId:r.id,attemptId:r.attemptId,provider:structuredClone(r.selection),artifactId:a.id,sha256:a.sha256,bytes:bytes.bytes.length,path:o.path,sourceRevision:{plan:m.approval.planSignature,task:m.approval.taskSignatures[r.taskId],...source}},m.projectId);const task=find(s,'tasks',r.taskId,m.projectId);if(!task.artifactIds.includes(a.id)){task.artifactIds.push(a.id);changed(task);}return x;});
    }),
    verify:(i,c)=>tracked(async()=>{
      // Reserve before process creation: lost responses/restarts never re-run a
      // possibly effectful test with the same operation ID.
      const ticket=await mutate('verify',i,c,async(s,m,_i,actor)=>{
        const o=output(m,i.outputKey),value=await checkOutput(s,m,o),source=await snapshot(find(s,'projects',m.projectId).workspace,o);
        const reviewDigest=digest({missionId:m.id,definitionRevision:m.definitionRevision,outputId:value.x.id,sourceFiles:source,testFiles:o.testFiles});
        if(i.runId!==value.r.id||i.reviewDigest!==reviewDigest)fail('COMMAND_REVIEW_REQUIRED','Review current source/test checksums and the exact command before running',409,{reviewDigest,sourceFiles:source,command:['node','--test','--test-concurrency=1','--',...o.testFiles],maxMs:30000});
        return append(s,'test',{missionId:m.id,definitionRevision:m.definitionRevision,outputId:value.x.id,outputKey:o.key,runId:value.r.id,attemptId:value.r.attemptId,actor,sourceFiles:source,status:'dispatching',operationId:i.operationId},m.projectId);
      });
      const persisted=record(store.read(),'test',ticket.id,i.projectId);if(persisted.status!=='dispatching'||ticket!==undefined&&persisted.dispatched) return persisted;
      // Atomic claim for duplicate concurrent calls in this process.
      const claimed=await store.transaction(s=>{active();const x=record(s,'test',ticket.id,i.projectId);if(x.dispatched)return false;x.dispatched=true;changed(x);return true;});if(!claimed)return record(store.read(),'test',ticket.id,i.projectId);
      const before=store.read(),m=get(i,before),o=output(m,i.outputKey);let result;
      try{result=await local.test({workspace:find(before,'projects',m.projectId).workspace,testFiles:o.testFiles,maxMs:30000});}catch(e){result={status:'FAILED',error:e.message};}
      return store.transaction(async s=>{const x=record(s,'test',ticket.id,i.projectId),m=get(i,s);if(suspended||m.definitionRevision!==x.definitionRevision){x.status='unknown';changed(x);return x;}
        const source=await snapshot(find(s,'projects',m.projectId).workspace,o);if(digest(source)!==digest(x.sourceFiles))result={...result,status:'FAILED',error:'Source changed during tests'};
        await checkOutput(s,m,o);Object.assign(x,{status:result.status,result});changed(x);
        const v=entity({type:'verification.result',missionId:m.id,definitionRevision:m.definitionRevision,outputId:x.outputId,runId:x.runId,attemptId:x.attemptId,status:x.status,verifier:verifier(m,o),checkedAt:new Date().toISOString(),sourceFiles:source,checks:[{kind:'mission-local-node-tests',status:x.status,testId:x.id,result}]},m.projectId);s.events.push(v);return x;
      });
    }),
    pack:(i,c)=>tracked(async()=>{
      const prior=await replay('pack',i,c);if(prior)return prior;
      active();await human('mission',i,c);const s=store.read(),m=get(i,s);revision(m,i.expectedRevision);const g=current(s,m),values=await checked(s,m);
      if(g.status!=='completed'||!g.review||Object.values(m.taskIds).some(id=>!g.qa[id]))fail('QA_REQUIRED','Independent QA and final Owner acceptance are required before packaging',409);
      const files=new Map(),entries=[];let size=0;
      for(const value of values)for(const source of value.source){const entry=`files/${source.path}`;if(files.has(entry))continue;const f=await fileBytes(find(s,'projects',m.projectId).workspace,source.path);if(f.sha256!==source.sha256)fail('INTEGRITY','Source changed during packaging',409);size+=f.bytes.length;if(size>32*1024*1024)fail('SIZE','Selected source bytes exceed 32 MiB');files.set(entry,f.bytes);entries.push({entry,path:source.path,sha256:f.sha256,bytes:f.bytes.length});}
      const manifest={format:'forge-delivery-pack/v1',mission:{id:m.id,definitionRevision:m.definitionRevision,definition:m.definition},canonical:{planId:m.planId,planSignature:m.approval.planSignature,taskIds:m.taskIds,goalId:g.id,goalRevision:g.goalRevision,criteria:g.criteria},files:entries,outputs:values.map(v=>({outputKey:v.o.key,artifactId:v.a.id,taskId:v.r.taskId,runId:v.r.id,attemptId:v.r.attemptId,provider:v.x.provider,path:v.o.path,sha256:v.x.sha256,bytes:v.x.bytes,sourceRevision:v.x.sourceRevision,verification:{id:v.verification.id,verifier:v.verification.verifier,status:v.verification.status,sourceFiles:v.source,checks:v.verification.checks.map(c=>({kind:c.kind,status:c.status,testId:c.testId,result:{...c.result,command:c.result.command?{...c.result.command,cwd:'<selected-project>',executable:'node'}:undefined}}))}})),qa:Object.values(g.qa).map(id=>find(s,'events',id,m.projectId)),ownerReview:find(s,'events',g.review,m.projectId),notYetVerified:['HOME_UAT_NOT_RUN','No model-quality claim from tests; provider selections are durable execution records','Only listed source files are included and checksum-verified; dependencies, build/install environments and other project files are excluded','Static preview does not qualify server-side runtime, deployment, or network integrations','Pack import does not grant execution, credential, permission, or restore authority'],createdAt:find(s,'events',g.review,m.projectId).createdAt};
      const bytes=deliveryZip(manifest,files),verified=verifyDeliveryPack(bytes),a=await artifacts.upload({projectId:m.projectId,operationId:`${i.operationId}:zip`,name:`mission-${m.id}-r${m.definitionRevision}.zip`,kind:'delivery-pack',base64:bytes.toString('base64')});
      return mutate('pack',i,c,async(s,m)=>{const g=current(s,m);await checked(s,m);if(g.review!==manifest.ownerReview.id)fail('REVISION_CONFLICT','Review changed during packaging',409);return append(s,'pack',{missionId:m.id,definitionRevision:m.definitionRevision,artifactId:a.id,sha256:a.sha256,bytes:a.bytes,manifestSha256:verified.manifestSha256,ownerReviewId:g.review,filename:a.name},m.projectId);});
    }),
    async download(i,c){exact(i,fields.download);await human('mission',i,c);const s=store.read(),p=record(s,'pack',i.packId,i.projectId),a=find(s,'artifacts',p.artifactId,i.projectId),workspace=find(s,'projects',i.projectId).workspace,f=await fileBytes(workspace,a.path);if(f.sha256!==p.sha256)fail('INTEGRITY','Pack archive bytes changed',409);const v=verifyDeliveryPack(f.bytes);if(v.manifestSha256!==p.manifestSha256)fail('INTEGRITY','Pack manifest changed',409);return {path:f.path,bytes:f.bytes,filename:p.filename,contentType:'application/zip'};},
    preview:(i,c)=>tracked(async()=>{
      const x=await mutate('preview',i,c,async(s,m)=>{const o=output(m,i.outputKey),v=await checkOutput(s,m,o);const files=await Promise.all(outputs(s,m).map(async x=>{const o=output(m,x.outputKey),v=await checkOutput(s,m,o);return {path:o.path,sha256:v.x.sha256};}));return {missionId:m.id,projectId:m.projectId,entry:o.path,files,outputId:v.x.id,previewId:randomUUID()};});
      if(previews.has(x.previewId))return previews.get(x.previewId);
      if(!previewStarting.has(x.previewId)){
        const pending=(async()=>{const p=await local.preview({workspace:find(store.read(),'projects',i.projectId).workspace,files:x.files,entry:x.entry});const result={...p,previewId:x.previewId,missionId:x.missionId,projectId:i.projectId};previews.set(x.previewId,result);return result;})();
        previewStarting.set(x.previewId,pending);pending.then(()=>previewStarting.delete(x.previewId),()=>previewStarting.delete(x.previewId));
      }
      return previewStarting.get(x.previewId);
    }),
    async stopPreview(i,c){await mutate('stopPreview',i,c,()=>{const p=previews.get(i.previewId);if(p&&p.projectId!==i.projectId)fail('SCOPE','Preview belongs to another project',403);return {previewId:i.previewId};});await previewStarting.get(i.previewId);const p=previews.get(i.previewId);if(p){if(p.projectId!==i.projectId)fail('SCOPE','Preview belongs to another project',403);await local.stopPreview({id:p.id});previews.delete(i.previewId);}return {status:'stopped'};},
    async recover(){await store.transaction(s=>{for(const x of s.events.filter(e=>e.type==='mission.test'&&e.status==='dispatching')){x.status='unknown';changed(x);}});},
    async suspendForRestore(){suspended=true;await local.suspend();await Promise.allSettled([...work]);previews.clear();},
    async afterRestore(){await api.recover();await store.transaction(s=>{for(const m of s.events.filter(e=>e.type==='mission.definition')){m.restoreReviewRequired=true;changed(m);}});},
    cancelRestore(){suspended=false;local.resume();},
    async close(){closed=true;await local.close();await Promise.allSettled([...work]);previews.clear();},
  };
  return api;
}
