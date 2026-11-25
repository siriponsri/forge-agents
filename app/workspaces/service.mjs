import path from 'node:path';
import {append,record,records,find,fail,changed,revision,digest,boundedText,integer,taskSignature,planSignature,approvedTask,assertNoMixedControllers,policy,contextFor,ownedRun,terminal,activeWorkspace,pathKey} from './contracts.mjs';
import {assertIsolatedWorkspaceAvailable} from './context.mjs';
import {checkoutPath,inspectSource,inspectWorkspace,addWorktree,git,gitText,runChecks,noLinks} from './git.mjs';

export function createWorkspaceService({store,dataDir,t3,authorize}){
  const pending=new Set(),locks=new Set();let closed=false;
  const recoveryStop=Symbol('private existing Research workspace Stop');
  const get=(s,i)=>record(s,'workspace',i.workspaceId,i.projectId);
  const queue=(s,i)=>record(s,'integration',i.integrationId,i.projectId);
  async function identity(action,input,caller){
    if(caller===recoveryStop&&action==='stop')return;
    if(!authorize||await authorize({action:action==='state'?'read':'write',scope:{kind:'project',id:input.projectId,projectId:input.projectId},callerContext:caller,state:store.read()})!==true)fail('OWNER_REQUIRED','An authenticated local Owner action is required',403);
  }
  function track(p){pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}
  async function operation(method,input,caller,fn){
    input=structuredClone(input);await identity(method,input,caller);boundedText(input.operationId,'operationId',200);
    const fingerprint=digest({method,input});
    const existing=store.read().events.find(e=>e.type==='workspace.operation'&&e.operationId===input.operationId);
    if(existing){if(existing.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to different workspace work',409);return existing.result??existing;}
    // Stop must be able to invalidate admission while provider setup is awaited.
    const key=input.workspaceId??input.integrationId??input.projectId;
    const lock=method==='stop'?`${key}:stop`:key;
    if(locks.has(lock))fail('WORKSPACE_BUSY','An owned operation is still in progress; reconcile its result',409);
    locks.add(lock);let op;
    try{
      op=await store.transaction(s=>{find(s,'projects',input.projectId);if(s.receipts.some(r=>r.operationId===input.operationId)||s.runs.some(r=>r.operationId===input.operationId)||s.events.some(e=>e.operationId===input.operationId))fail('OPERATION_REUSE','Operation identity is already reserved',409);return append(s,'operation',{operationId:input.operationId,fingerprint,method,input,status:'pending'},input.projectId);});
      const result=await fn(input,op);
      return await store.transaction(s=>{const o=record(s,'operation',op.id,input.projectId);o.status='completed';o.result=structuredClone(result);changed(o);s.receipts.push({operationId:input.operationId,fingerprint,result:structuredClone(result)});return result;});
    }catch(e){if(op)await store.transaction(s=>{const o=record(s,'operation',op.id,input.projectId);o.status=e.code?'failed':'unknown';o.error={code:e.code??'OUTCOME_UNKNOWN',message:e.message};changed(o);});throw e;}
    finally{locks.delete(lock);}
  }
  async function updateWorkspace(i,fn){return store.transaction(s=>{const w=get(s,i);revision(w,i.expectedRevision);return fn(s,w);});}
  async function observed(w){
    const s=store.read(),task=find(s,'tasks',w.taskId,w.projectId),plan=find(s,'plans',w.planId,w.projectId);
    if(taskSignature(task)!==w.taskSignature||planSignature(plan)!==w.planSignature)fail('REVISION_CONFLICT','The canonical task or approved plan changed; review a new workspace',409);
    const o=await inspectWorkspace(w,dataDir);if(o.sourceHead!==w.sourceHeadSha)fail('STALE_SOURCE','The original source head changed; review a new workspace/base',409);return o;
  }
  function quiescent(w){if(activeWorkspace(w)||w.stopRequested&&w.status==='unknown')fail('RECONCILE_REQUIRED','Reconcile the owned attempt before reviewing files',409);}
  function executionSupported(){return t3?.workspaceContextVersion===1&&typeof t3.startRun==='function'&&typeof t3.reconcile==='function'&&typeof t3.stop==='function';}
  function exactRun(s,w){const r=ownedRun(s,w);if(!r)fail('RUN_UNKNOWN','No authoritative T3 run has been observed; do not redispatch',409);return r;}
  function currentCheck(s,w,head){const c=w.checkId&&record(s,'check',w.checkId,w.projectId);if(!c||c.status!=='passed'||c.head!==head||c.baseSha!==w.baseSha||c.runId!==w.runId||c.attemptId!==w.attemptId)fail('CHECKS_REQUIRED','Run checks against the exact current head and attempt',409);return c;}
  const api={
    get researchComponentContextVersion(){return t3?.researchComponentContextVersion===1?1:0;},
    async state(input,caller){await identity('state',input,caller);find(store.read(),'projects',input.projectId);const s=store.read();return {projectId:input.projectId,stateRevision:s.revision,policy:policy(s,input.projectId),workspaces:records(s,'workspace',input.projectId),integrations:records(s,'integration',input.projectId),checks:records(s,'check',input.projectId),operations:records(s,'operation',input.projectId),capabilities:{executionSupported:executionSupported(),isolation:'git-worktree-files',osSandbox:false,automaticPush:false,checks:['diff','node-test'],capacitySource:'explicit-owner-ceilings'}};},
    configure(input,caller){return operation('configure',input,caller,async i=>store.transaction(s=>{
      const old=policy(s,i.projectId);if((old?.revision??0)!==i.expectedRevision)fail('REVISION_CONFLICT','Parallel policy changed',409);
      const maxConcurrent=integer(i.maxConcurrent,'maxConcurrent',1,32),providerLimit=integer(i.providerLimit,'providerLimit',1,32);
      if(!Array.isArray(i.checks)||!i.checks.length||new Set(i.checks).size!==i.checks.length||i.checks.some(k=>!['diff','node-test'].includes(k))||!i.checks.includes('diff'))fail('VALIDATION','Select diff and optional Node tests');
      // Append policy revisions; checks required for historical reviews stay fixed.
      const next=append(s,'policy',{maxConcurrent,providerLimit,checks:[...i.checks],previousId:old?.id??null,actor:'local-owner'},i.projectId);next.revision=(old?.revision??0)+1;return next;
    }));},
    create(input,caller){return operation('create',input,caller,async i=>{
      const p=find(store.read(),'projects',i.projectId),source=await inspectSource(p.workspace);
      const managed=pathKey(path.resolve(dataDir)),sourceKey=pathKey(source.sourceRoot);
      if(managed===sourceKey||managed.startsWith(sourceKey+path.sep))fail('PATH_SCOPE','Machine workspace storage must be outside the user repository',403);
      await noLinks(dataDir);
      const w=await store.transaction(s=>{
        const p=find(s,'projects',i.projectId);assertNoMixedControllers(s,i.projectId,i);const {task,plan}=approvedTask(s,i.projectId,i.taskId);
        revision(task,i.expectedTaskRevision);if(!['ready','backlog','blocked'].includes(task.status))fail('TASK_STATE','Choose a task ready for a new workspace',409);
        const configured=policy(s,i.projectId);if(!configured)fail('WORKSPACE_POLICY_REQUIRED','Configure explicit capacity and checks first',409);
        const w=append(s,'workspace',{taskId:task.id,botId:task.botId??null,botRevision:task.botId?find(s,'bots',task.botId,p.id).revision:null,taskRevision:task.revision,taskSignature:taskSignature(task),planId:plan.id,planRevision:plan.revision,planSignature:planSignature(plan),profileDigest:digest(p.profile),providerInstanceId:p.profile?.provider?.instanceId??null,...source,baseSha:source.sourceHeadSha,creationOperationId:i.operationId,status:'creating',requiredChecks:[...configured.checks],runOperationId:null,runId:null,attemptId:null},p.id);
        w.branch=`forge/workspaces/${w.id}`;w.worktreePath=checkoutPath(dataDir,w.id);return w;
      });
      try{await addWorktree(w,dataDir);return store.transaction(s=>{const r=get(s,{...i,workspaceId:w.id});r.status='ready';changed(r);return r;});}
      catch(e){await store.transaction(s=>{const r=get(s,{...i,workspaceId:w.id});r.status='creation-unknown';r.error=e.message;changed(r);});throw e;}
    });},
    start(input,caller,{researchContext,researchComponentContext}={}){
      if(input.researchContext!==undefined||input.researchComponentContext!==undefined)fail('RESEARCH_CONTEXT','Research context is host-only, not a Workspace body field',403);
      if(researchComponentContext&&api.researchComponentContextVersion!==1)fail('RESEARCH_COMPONENT_INTEGRATION','Canonical T3 component admission is required',409);
      return operation('start',{...input,...(researchContext?{researchContext:structuredClone(researchContext)}:{}),...(researchComponentContext?{researchComponentContext:structuredClone(researchComponentContext)}:{})},caller,async i=>{
      if(!executionSupported())fail('WORKSPACE_INTEGRATION_REQUIRED','T3 must retain and resolve the authoritative workspace context before dispatch',409);
      const before=get(store.read(),i);revision(before,i.expectedRevision);const files=await observed(before);
      if(files.head!==before.baseSha||files.dirty)fail('WORKSPACE_CHANGED','A new execution requires its unchanged reserved checkout',409);
      const w=await updateWorkspace(i,(s,w)=>{
        if(w.status!=='ready'||w.runOperationId)fail('REPLAY_FORBIDDEN','This workspace already owns an attempt; reconcile it',409);
        w.runOperationId=`workspace-run:${w.id}`;w.status='admitting';
        assertIsolatedWorkspaceAvailable(s,i.projectId,{projectId:i.projectId,taskId:w.taskId,operationId:w.runOperationId,workspaceContext:contextFor(w)});changed(w);return w;
      });
      let response;
      try{response=await t3.startRun({projectId:w.projectId,taskId:w.taskId,operationId:w.runOperationId,workspaceContext:contextFor(w),...(i.researchContext?{researchContext:i.researchContext}:{}),...(i.researchComponentContext?{researchComponentContext:i.researchComponentContext}:{})});}
      catch(e){await store.transaction(s=>{const w=get(s,i);w.status='unknown';w.error=e.message;changed(w);});return get(store.read(),i);}
      return store.transaction(s=>{const w=get(s,i);let run;try{run=ownedRun(s,w);}catch(e){w.status='unknown';w.error=e.message;changed(w);return w;}if(!run||response?.id!==run.id){w.status='unknown';w.error='T3 did not retain a matching authoritative run';}else{w.runId=run.id;w.attemptId=run.attemptId;w.status=terminal.has(run.status)?(w.stopRequested?'stopped':run.status==='completed'?'review':'failed'):run.status==='unknown'?'unknown':'running';}changed(w);return w;});
    });},
    reconcile(input,caller){return operation('reconcile',input,caller,async i=>{
      const w=get(store.read(),i);revision(w,i.expectedRevision);
      let files;try{files=await inspectWorkspace(w,dataDir);}catch(e){return updateWorkspace(i,(s,w)=>{w.error=e.message;if(w.status==='creating'||w.status==='creation-unknown')w.status='creation-unknown';changed(w);return w;});}
      if(!w.runOperationId)return updateWorkspace(i,(s,w)=>{if(files.head!==w.baseSha||files.dirty)fail('WORKSPACE_CHANGED','Preserved files need review; creation cannot be resumed automatically',409);w.status='ready';w.error=null;changed(w);return w;});
      let r=ownedRun(store.read(),w);if(r){try{await t3.reconcile(r.id);}catch{/* No execution effect is replayed. */}r=ownedRun(store.read(),w);}
      return updateWorkspace(i,(s,w)=>{if(!r){w.status='unknown';w.error='T3 outcome has not been observed; redispatch remains blocked';}else{w.runId=r.id;w.attemptId=r.attemptId;w.status=terminal.has(r.status)?(w.stopRequested?'stopped':r.status==='completed'?'review':'failed'):(w.stopRequested?'stopping':r.status==='unknown'?'unknown':'running');w.error=r.error??null;}w.observedHead=files.head;w.dirty=files.dirty;changed(w);return w;});
    });},
    stop(input,caller){return operation('stop',input,caller,async i=>{
      const w=await updateWorkspace(i,(s,w)=>{w.stopRequested=true;if(w.status==='ready')w.status='stopped';else if(activeWorkspace(w))w.status='stopping';changed(w);return w;});
      if(!w.runOperationId)return w;
      const r=ownedRun(store.read(),w);if(!r)return store.transaction(s=>{const w=get(s,i);w.status='unknown';w.error='Stop retained; no owned run is yet observable';changed(w);return w;});
      if(!terminal.has(r.status)){try{await t3.stop(r.id);}catch(e){return store.transaction(s=>{const w=get(s,i);w.status='unknown';w.error=e.message;changed(w);return w;});}}
      return store.transaction(s=>{const w=get(s,i),r=exactRun(s,w);w.status=terminal.has(r.status)?'stopped':'stopping';changed(w);return w;});
    });},
    check(input,caller){return operation('check',input,caller,async i=>{
      const w=get(store.read(),i);revision(w,i.expectedRevision);quiescent(w);
      const r=exactRun(store.read(),w);if(r.status!=='completed'||w.stopRequested)fail('RUN_INCOMPLETE','Only a completed owned attempt can enter review',409);
      const files=await observed(w);if(files.dirty||files.head===w.baseSha)fail('COMMIT_REQUIRED','Commit the actual task changes in its owned workspace first',409);
      const results=await runChecks(files.path,w.baseSha,files.head,w.requiredChecks),after=await observed(w);
      if(after.head!==files.head||after.dirty)fail('CHECK_CHANGED','Files changed while checks ran',409);
      return updateWorkspace(i,(s,w)=>{const r=exactRun(s,w);if(r.status!=='completed')fail('RUN_INCOMPLETE','Run state changed during checks',409);const c=append(s,'check',{workspaceId:w.id,runId:r.id,attemptId:r.attemptId,baseSha:w.baseSha,head:files.head,changes:files.changes,...results,evidenceDigest:digest(results),checkedAt:new Date().toISOString()},w.projectId);w.checkId=c.id;w.checkedHead=files.head;w.reviewId=null;w.status='review';changed(w);return w;});
    });},
    review(input,caller){return operation('review',input,caller,async i=>{
      const w=get(store.read(),i);revision(w,i.expectedRevision);quiescent(w);const files=await observed(w);
      if(files.dirty||files.head!==i.head)fail('HEAD_CHANGED','Review must name the exact clean current head',409);
      return updateWorkspace(i,(s,w)=>{const c=currentCheck(s,w,files.head),r=exactRun(s,w);if(r.status!=='completed'||w.stopRequested)fail('RUN_INCOMPLETE','A completed owned run is required',409);const review=append(s,'review',{workspaceId:w.id,head:files.head,baseSha:w.baseSha,checkId:c.id,evidenceDigest:c.evidenceDigest,runId:r.id,attemptId:r.attemptId,actor:'local-owner'},w.projectId);w.reviewId=review.id;w.status='approved';changed(w);return w;});
    });},
    enqueue(input,caller){return operation('enqueue',input,caller,async i=>{
      const w=get(store.read(),i);revision(w,i.expectedRevision);quiescent(w);const files=await observed(w);
      if(files.dirty||files.head!==i.head)fail('HEAD_CHANGED','Queue the exact reviewed clean source head',409);
      return updateWorkspace(i,(s,w)=>{
        const c=currentCheck(s,w,files.head),review=w.reviewId&&record(s,'review',w.reviewId,w.projectId);
        if(!review||review.head!==files.head||review.checkId!==c.id)fail('OWNER_REVIEW_REQUIRED','Owner must review these exact changes and evidence',409);
        if(records(s,'integration',w.projectId).some(q=>q.workspaceId===w.id&&q.status!=='abandoned'))fail('ALREADY_QUEUED','This workspace already has an integration record',409);
        const q=append(s,'integration',{workspaceId:w.id,sourceRoot:w.sourceRoot,sourceHeadSha:w.sourceHeadSha,commonDir:w.commonDir,candidateBase:w.baseSha,candidateHead:files.head,reviewId:review.id,checkId:c.id,requiredChecks:w.requiredChecks,status:'queued'},w.projectId);w.integrationId=q.id;changed(w);return q;
      });
    });},
    prepareIntegration(input,caller){return operation('prepareIntegration',input,caller,async i=>{
      const q=queue(store.read(),i);revision(q,i.expectedRevision);const w=record(store.read(),'workspace',q.workspaceId,i.projectId),files=await observed(w);
      if(files.dirty||files.head!==q.candidateHead)fail('HEAD_CHANGED','Queued candidate changed; no merge was attempted',409);
      const reserved=await store.transaction(s=>{
        const q=queue(s,i);revision(q,i.expectedRevision);if(q.status!=='queued')fail('RECONCILE_REQUIRED','Integration was already attempted; inspect its retained checkout',409);
        if(records(s,'integration',q.projectId).some(x=>x.id!==q.id&&['preparing','conflict','checks-failed','checking','committing','awaiting-owner','unknown'].includes(x.status)))fail('INTEGRATION_BUSY','Resolve the earlier integration before preparing another',409);
        const last=records(s,'integration',q.projectId).filter(x=>x.status==='integrated').at(-1),target=last?.integratedHead??q.sourceHeadSha;
        if(target!==i.targetHead)fail('STALE_BASE','Integration target moved; review the exact latest head',409);
        q.targetHead=target;q.baseSha=target;q.branch=`forge/integration/${q.id}`;q.worktreePath=checkoutPath(dataDir,q.id);q.status='preparing';changed(q);return q;
      });
      try{
        await addWorktree(reserved,dataDir);
        const merged=await git(reserved.worktreePath,['merge','--no-ff','--no-commit',reserved.candidateHead],{allowFailure:true});
        const conflicts=(await git(reserved.worktreePath,['diff','--name-only','--diff-filter=U','-z'])).stdout.split('\0').filter(Boolean);
        if(!merged.ok)return store.transaction(s=>{const q=queue(s,i);q.status=conflicts.length?'conflict':'unknown';q.conflicts=conflicts;q.error=merged.stderr.slice(-6000);changed(q);return q;});
        return await verifyIntegration(i);
      }catch(e){await store.transaction(s=>{const q=queue(s,i);q.status='unknown';q.error=e.message;changed(q);});throw e;}
    });},
    checkIntegration(input,caller){return operation('checkIntegration',input,caller,async i=>{const q=queue(store.read(),i);revision(q,i.expectedRevision);return verifyIntegration(i);});},
    approveIntegration(input,caller){return operation('approveIntegration',input,caller,async i=>{
      const q=queue(store.read(),i);revision(q,i.expectedRevision);const proof=await integrationProof(q);
      return store.transaction(s=>{const q=queue(s,i);revision(q,i.expectedRevision);if(q.status!=='awaiting-owner'||!q.combinedCheck||q.combinedCheck.status!=='passed'||q.combinedTree!==proof.tree||q.targetHead!==i.targetHead||q.candidateHead!==i.head)fail('INTEGRATION_REVIEW_REQUIRED','Review exact target, candidate and passing combined checks first',409);q.approval={actor:'local-owner',tree:proof.tree,targetHead:q.targetHead,candidateHead:q.candidateHead,evidenceDigest:digest(q.combinedCheck)};changed(q);return q;});
    });},
    integrate(input,caller){return operation('integrate',input,caller,async i=>{
      const q=queue(store.read(),i);revision(q,i.expectedRevision);const proof=await integrationProof(q);
      if(q.status!=='awaiting-owner'||!q.approval||q.approval.tree!==proof.tree||q.approval.evidenceDigest!==digest(q.combinedCheck)||q.targetHead!==i.targetHead||q.candidateHead!==i.head)fail('INTEGRATION_REVIEW_REQUIRED','Owner approval must cover the exact combined checked tree',409);
      await store.transaction(s=>{const q=queue(s,i);revision(q,i.expectedRevision);q.status='committing';changed(q);});
      // Only the new owned integration branch moves. Original user branch/index
      // and dirty files are never checked out, reset, cleaned, merged or pushed.
      await git(q.worktreePath,['-c','user.name=FORGE','-c','user.email=forge@localhost','commit','--no-gpg-sign','-m',`FORGE integrate reviewed task ${q.workspaceId}`]);
      const head=await gitText(q.worktreePath,['rev-parse','HEAD']),parents=(await gitText(q.worktreePath,['rev-list','--parents','-n','1',head])).split(' ');
      const tree=await gitText(q.worktreePath,['rev-parse',`${head}^{tree}`]);
      if(parents[1]!==q.targetHead||parents[2]!==q.candidateHead||tree!==q.approval.tree)fail('MERGE_CHANGED','Integration commit does not match the reviewed heads and tree',409);
      return store.transaction(s=>{const q=queue(s,i);q.status='integrated';q.integratedHead=head;changed(q);const w=record(s,'workspace',q.workspaceId,q.projectId);w.status='integrated';changed(w);return q;});
    });},
    reconcileIntegration(input,caller){return operation('reconcileIntegration',input,caller,async i=>{
      const q=queue(store.read(),i);revision(q,i.expectedRevision);const files=await inspectWorkspace(q,dataDir);
      const parents=(await gitText(files.path,['rev-list','--parents','-n','1',files.head])).split(' '),tree=await gitText(files.path,['rev-parse',`${files.head}^{tree}`]);
      if(q.approval&&parents[1]===q.targetHead&&parents[2]===q.candidateHead&&tree===q.approval.tree&&!files.dirty)return store.transaction(s=>{const q=queue(s,i);q.status='integrated';q.integratedHead=files.head;changed(q);const w=record(s,'workspace',q.workspaceId,q.projectId);w.status='integrated';changed(w);return q;});
      return verifyIntegration(i);
    });},
    async recover(){return store.transaction(s=>{
      for(const w of records(s,'workspace'))if(activeWorkspace(w)||w.status==='creating'){w.status=w.status==='creating'?'creation-unknown':'unknown';changed(w);}
      for(const q of records(s,'integration'))if(['preparing','checking','committing'].includes(q.status)){q.status='unknown';changed(q);}
      for(const o of records(s,'operation'))if(o.status==='pending'){o.status='unknown';changed(o);}
      return {recovered:true,redispatched:false};
    });},
    async close(){closed=true;await Promise.allSettled([...pending]);},
  };
  async function integrationProof(q){
    const w=record(store.read(),'workspace',q.workspaceId,q.projectId),candidate=await observed(w),target=await inspectWorkspace(q,dataDir);
    if(candidate.dirty||candidate.head!==q.candidateHead||target.head!==q.targetHead)fail('HEAD_CHANGED','Candidate or integration target changed',409);
    const latest=records(store.read(),'integration',q.projectId).filter(x=>x.status==='integrated'&&x.id!==q.id).at(-1);
    if((latest?.integratedHead??q.sourceHeadSha)!==q.targetHead)fail('STALE_BASE','Integration queue target advanced',409);
    const conflicts=(await git(q.worktreePath,['diff','--name-only','--diff-filter=U','-z'])).stdout.split('\0').filter(Boolean);
    if(conflicts.length)fail('MERGE_CONFLICT','Resolve conflicts in the retained integration checkout and stage those files',409,{conflicts});
    if(await gitText(q.worktreePath,['rev-parse','--verify','MERGE_HEAD'])!==q.candidateHead)fail('MERGE_CHANGED','Pending merge no longer names the reviewed candidate',409);
    if((await git(q.worktreePath,['diff','--quiet'],{allowFailure:true})).ok!==true||await gitText(q.worktreePath,['ls-files','--others','--exclude-standard']))fail('UNSTAGED_CHANGES','Stage reviewed conflict resolutions; preserve unrelated untracked work',409);
    return {tree:await gitText(q.worktreePath,['write-tree'])};
  }
  async function verifyIntegration(i){
    let q=queue(store.read(),i),proof;
    try{proof=await integrationProof(q);}catch(e){await store.transaction(s=>{const q=queue(s,i);q.status=e.code==='MERGE_CONFLICT'?'conflict':'unknown';q.error=e.message;q.conflicts=e.details?.conflicts??q.conflicts;changed(q);});throw e;}
    const results=await runChecks(q.worktreePath,q.targetHead,q.candidateHead,q.requiredChecks,{staged:true});
    const after=await integrationProof(q);if(after.tree!==proof.tree)fail('CHECK_CHANGED','Combined files changed during verification',409);
    return store.transaction(s=>{const q=queue(s,i);q.combinedTree=proof.tree;q.combinedCheck={...results,tree:proof.tree,targetHead:q.targetHead,candidateHead:q.candidateHead,checkedAt:new Date().toISOString()};q.status=results.status==='passed'?'awaiting-owner':'checks-failed';q.error=results.status==='passed'?null:'Combined verification failed';q.approval=null;q.conflicts=[];changed(q);return q;});
  }
  for(const method of Object.keys(api).filter(m=>typeof api[m]==='function'&&!['state','close','recover'].includes(m))){const fn=api[method];api[method]=(...args)=>closed?Promise.reject(Object.assign(new Error('Workspaces closed'),{code:'SHUTTING_DOWN',statusCode:409})):track(fn(...args));}
  // Host-only, stop-only capability. The HTTP dispatcher has an explicit
  // allowlist and never exposes this method or the private caller token.
  Object.defineProperty(api,'stopExisting',{value:(input,{runId,reason}={})=>{
    if(!['absolute-deadline','recovery','shutdown'].includes(reason))fail('WORKSPACE_STOP_SCOPE','Explicit recovery Stop reason required',403);
    const w=get(store.read(),input),r=ownedRun(store.read(),w);
    if(!r||r.id!==runId||!r.researchContext||r.workspaceContext?.workspaceId!==w.id)fail('WORKSPACE_STOP_SCOPE','Only the exact retained Research attempt can be stopped',403);
    return api.stop(input,recoveryStop);
  }});
  return api;
}
