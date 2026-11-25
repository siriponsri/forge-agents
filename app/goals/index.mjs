import {randomUUID} from 'node:crypto';
import {append,record,records,find,fail,changed,revision,digest,boundedText,exact,definition,validateDefinition,taskScope,workspaceFree,ownedRun,terminal,inactive} from './contracts.mjs';
import {inspectAttempt,recheckTask,observedUsage,usageStop} from './evidence.mjs';
export {validateGoalContext,goalPrompt} from './context.mjs';
export {GOAL_LIMITS} from './contracts.mjs';

export const GOAL_HTTP_METHODS=Object.freeze(['state','create','revise','resume','pause','cancel','advance','reconcile','blockTask','qa','review']);
const common=['projectId','operationId','goalId','expectedRevision'];
const extras={state:['projectId'],create:['planId','objective','taskIds','criteria','policy'],revise:['planId','objective','taskIds','criteria','policy'],resume:[],pause:[],cancel:[],advance:['taskId','conversationId'],reconcile:[],blockTask:['taskId','reason'],qa:['taskId'],review:[]};
export async function dispatchGoalRequest(service,method,input,caller) {
  if(!GOAL_HTTP_METHODS.includes(method))fail('NOT_FOUND','Unsupported Goals API method',404);
  exact(input,method==='state'?extras.state:[...common,...extras[method]]);
  return service[method](input,caller);
}

export function createGoalService({store,t3,authorize,clock=Date.now}) {
  let closed=false,driving=false,scheduled,suspended=false;const pending=new Set(),timers=new Map();
  const get=(i,s=store.read())=>record(s,'goal',i.goalId,i.projectId);
  const last=g=>g.attempts.at(-1);
  function trace(s,g,action,data={}){changed(g);append(s,'transition',{goalId:g.id,goalRevision:g.goalRevision,action,status:g.status,at:clock(),...data},g.projectId);}
  function release(s,a){const c=record(s,'claim',a.claimId,a.projectId);if(c.status==='held'){c.status='released';c.releasedAt=clock();changed(c);}}
  function unresolved(g){return g.attempts.some(a=>!a.reconciled&&a.status!=='cancelled_before_dispatch');}
  function settleStop(s,g){
    if(unresolved(g)){g.status=g.stopRequested==='pause'?'pausing':g.stopRequested==='cancel'?'cancelling':'stopping';return;}
    g.status=g.stopRequested==='pause'?'paused':g.stopRequested==='cancel'?'cancelled':'exhausted';
    for(const a of g.attempts)release(s,a);
    const a=last(g);
    if(a){const task=find(s,'tasks',a.taskId,g.projectId);if(task.status==='running'){task.status=g.stopRequested==='pause'?'ready':'blocked';changed(task);}}
  }
  function arm(g){
    clearTimeout(timers.get(g.id));timers.delete(g.id);
    if(closed||suspended||g.restoreReviewRequired||!g.deadlineAt||inactive.has(g.status)||g.stopRequested)return;
    const timer=setTimeout(()=>{timers.delete(g.id);track(stopGoal({projectId:g.projectId,goalId:g.id,operationId:`goal-deadline:${g.id}:${g.goalRevision}`},'budget')).catch(()=>{});},Math.max(1,g.deadlineAt-clock()));
    timer.unref?.();timers.set(g.id,timer);
  }
  function track(p){pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}
  function schedule(){if(closed||suspended||scheduled||driving)return;scheduled=setTimeout(()=>{scheduled=null;track(drive()).catch(()=>{});},10);scheduled.unref?.();}
  async function command(method,input,fn,{checkRevision=true}={}){
    exact(input,[...common,...(extras[method]??[])]);input=structuredClone(input);
    boundedText(input.operationId,'operationId',200);
    const fingerprint=digest({service:'goals',method,input});
    const result=await store.transaction(async s=>{
      find(s,'projects',input.projectId);
      const prior=s.receipts.find(r=>r.operationId===input.operationId);
      if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation belongs to another command',409);return {goal:prior.result,replayed:true};}
      const g=method==='create'?null:get(input,s);if(g&&checkRevision)revision(g,input.expectedRevision);
      const output=await fn(s,g,input);
      const goal=method==='create'?output:g;
      s.receipts.push({operationId:input.operationId,type:'goal.command',method,fingerprint,result:structuredClone(goal)});
      return {goal,effect:method==='create'?null:output};
    });
    arm(result.goal);return result;
  }
  async function update(input,fn){
    const g=await store.transaction(async s=>{const g=get(input,s);await fn(s,g);const r=s.receipts.find(r=>r.operationId===input.operationId&&r.type==='goal.command');if(r)r.result=structuredClone(g);return g;});arm(g);return g;
  }
  async function identity(action,g,input,caller){
    if(typeof authorize!=='function')fail('HUMAN_REVIEW_UNAVAILABLE','Private human authorization callback is not configured',409);
    const actor=await authorize({action,projectId:g.projectId,goalId:g.id,goalRevision:g.goalRevision,taskId:input.taskId??null,expectedRevision:input.expectedRevision},caller);
    if(!actor||actor.kind!=='human'||typeof actor.subject!=='string'||!actor.subject||actor.role!==(action==='qa'?'qa':'owner')||action==='qa'&&actor.independent!==true)fail('HUMAN_REVIEW_REQUIRED','Authenticated independent QA or Owner authorization required',403);
    return {kind:'human',subject:actor.subject,role:actor.role,...(action==='qa'?{independent:true}:{})};
  }
  function budget(s,g,{dispatch=false}={}){
    g.usage=observedUsage(s,g);
    if(g.deadlineAt&&clock()>=g.deadlineAt)return 'ELAPSED_LIMIT';
    const usage=usageStop(g,g.usage);if(usage)return usage;
    if(dispatch&&g.attempts.length>=g.policy.maxAttempts)return 'ATTEMPT_LIMIT';
    return null;
  }
  function budgetBlock(s,g,reason){
    g.blocker={code:reason,at:clock()};
    if(reason.endsWith('_UNKNOWN'))g.status='blocked';else {g.stopRequested='budget';settleStop(s,g);}
    trace(s,g,'budget_blocked',{reason});
  }
  async function stopOwned(input){
    const reservation=await store.transaction(s=>{
      const g=get(input,s),a=last(g);if(!a||a.reconciled)return null;
      // Context validation can fail while Stop still has an exact operation and
      // owner. Never trust a returned ID, or stop an unrelated newer run.
      const r=ownedRun(s,g,a,{context:false});if(!r)return null;
      if(terminal.has(r.status)){a.status=r.status;a.runId=r.id;a.reconciled=true;release(s,a);settleStop(s,g);trace(s,g,'stop_terminal_observed');return null;}
      if(a.stopRequest)return null;
      a.stopRequest={runId:r.id,status:'submitting',at:clock()};trace(s,g,'stop_claimed',{runId:r.id});return {runId:r.id,attemptId:a.id};
    });
    if(!reservation)return get(input);
    let error;
    try{if(typeof t3?.stop!=='function')fail('GOAL_CONTEXT_UNSUPPORTED','T3 Stop unavailable',409);await t3.stop(reservation.runId);}catch(e){error=e.code??'STOP_UNKNOWN';}
    return update(input,(s,g)=>{
      const a=g.attempts.find(a=>a.id===reservation.attemptId),r=ownedRun(s,g,a,{context:false});
      a.stopRequest.status=error?'unknown':'accepted';
      if(r){a.status=r.status;a.runId=r.id;if(terminal.has(r.status)){a.reconciled=true;release(s,a);}}
      settleStop(s,g);trace(s,g,'stop_observed',{error:error??null});
    });
  }
  async function dispatch(input){
    const claimed=await store.transaction(s=>{
      const g=get(input,s),a=last(g);if(a?.status!=='reserved')return false;
      if(g.stopRequested||clock()>=g.deadlineAt){a.status='cancelled_before_dispatch';a.reconciled=true;release(s,a);if(!g.stopRequested)g.stopRequested='budget';settleStop(s,g);trace(s,g,'cancelled_before_dispatch');return false;}
      taskScope(s,g,a.taskId);workspaceFree(s,g,a.claimId);
      a.status='dispatching';trace(s,g,'dispatch_claimed');return true;
    });
    if(!claimed)return get(input);
    const g=get(input),a=last(g);
    try{
      await t3.startRun({projectId:g.projectId,taskId:a.taskId,conversationId:a.conversationId,operationId:a.operationId,goalContext:structuredClone(a.context)});
      await update(input,(s,g)=>{const a=last(g),r=ownedRun(s,g,a);a.runId=r?.id??null;a.status=r?.status??'unknown';if(!r)g.status=g.stopRequested?g.status:'unknown';trace(s,g,r?'run_observed':'submission_uncertain');});
    }catch(e){
      await update(input,(s,g)=>{last(g).status='unknown';last(g).error=e.code??'T3_UNKNOWN';if(!g.stopRequested)g.status='unknown';trace(s,g,'submission_uncertain',{error:e.code??'T3_UNKNOWN'});});
    }
    const current=get(input);schedule();return current.stopRequested?stopOwned(input):current;
  }
  async function stopGoal(input,reason){
    const r=await command(reason==='pause'?'pause':reason==='cancel'?'cancel':'deadline',input,(s,g)=>{
      if(inactive.has(g.status))return;
      g.stopRequested=reason;const a=last(g);
      if(a?.status==='reserved'){a.status='cancelled_before_dispatch';a.reconciled=true;release(s,a);}
      settleStop(s,g);trace(s,g,'stop_requested',{reason});
    },{checkRevision:reason!=='budget'});
    return r.replayed?r.goal:stopOwned(input);
  }
  const api={
    state(input){
      exact(input,['projectId']);const s=store.read();find(s,'projects',input.projectId);
      return {goals:records(s,'goal',input.projectId),claims:records(s,'claim',input.projectId),capabilities:{goalContextVersion:t3?.goalContextVersion??null,executionSupported:t3?.goalContextVersion===1&&['startRun','stop','reconcile'].every(k=>typeof t3?.[k]==='function'),parallelExecution:false,isolation:'not provided; canonical checkout serializes workspace'},qualifications:{runtime:'NOT_RUN',liveProvider:'NOT_RUN',homeUat:'NOT_RUN'}};
    },
    async create(input){return (await command('create',input,(s,_g,i)=>{
      const d=definition(s,i);
      if(records(s,'goal',i.projectId).some(g=>!inactive.has(g.status)&&g.taskIds.some(id=>d.taskIds.includes(id))))fail('GOAL_EXISTS','A nonterminal goal already owns a selected task',409);
      const g=append(s,'goal',{...d,goalRevision:1,status:'paused',attempts:[],blockers:{},verifications:{},qa:{},stopRequested:'pause',startedAt:null,deadlineAt:null,usage:null,progress:{passed:0,total:d.criteria.length}},i.projectId);
      append(s,'revision',{goalId:g.id,goalRevision:1,definition:d},i.projectId);trace(s,g,'created');return g;
    })).goal;},
    async revise(input,caller){
      const actor=await identity('revise',get(input),input,caller);
      return (await command('revise',input,(s,g,i)=>{
        if(inactive.has(g.status)||unresolved(g))fail('RECONCILE_REQUIRED','Only quiescent unfinished goals can be revised',409);
        const d=definition(s,i);
        if(records(s,'goal',i.projectId).some(other=>other.id!==g.id&&!inactive.has(other.status)&&other.taskIds.some(id=>d.taskIds.includes(id))))fail('GOAL_EXISTS','Another goal owns a selected task',409);
        for(const id of d.taskIds){if(g.qa[id]){const task=find(s,'tasks',id,g.projectId);task.status='ready';changed(task);}}
        Object.assign(g,d);g.goalRevision++;g.verifications={};g.qa={};g.blockers={};g.review=null;g.progress={passed:0,total:d.criteria.length};g.status='paused';g.stopRequested='pause';
        // Editing never grants more elapsed time, or erases previous attempts.
        if(g.startedAt)g.deadlineAt=Math.min(g.deadlineAt,g.startedAt+g.policy.maxMs);
        append(s,'revision',{goalId:g.id,goalRevision:g.goalRevision,definition:d,actor},g.projectId);trace(s,g,'revised');
      })).goal;
    },
    async resume(input){const r=await command('resume',input,(s,g)=>{
      if(inactive.has(g.status)||unresolved(g))fail('RECONCILE_REQUIRED','Reconcile the exact prior attempt before resume; unknown dispatch is never replayed',409);
      validateDefinition(s,g);const reason=budget(s,g);if(reason){budgetBlock(s,g,reason);return;}
      if(!g.startedAt){g.startedAt=clock();g.deadlineAt=clock()+g.policy.maxMs;}
      delete g.restoreReviewRequired;g.stopRequested=null;g.blocker=null;g.status='active';trace(s,g,'resumed');
    });schedule();return r.goal;},
    pause:input=>stopGoal(input,'pause'),
    cancel:input=>stopGoal(input,'cancel'),
    async advance(input){
      const r=await command('advance',input,(s,g,i)=>{
        if(g.status!=='active'||g.stopRequested)fail('GOAL_INACTIVE','Resume this goal before dispatch',409);
        if(unresolved(g))fail('RECONCILE_REQUIRED','Reconcile current execution before another attempt',409);
        validateDefinition(s,g);
        if(t3?.goalContextVersion!==1||['startRun','stop','reconcile'].some(k=>typeof t3?.[k]!=='function'))fail('GOAL_CONTEXT_UNSUPPORTED','Authoritative T3 must validate, persist and prompt version-1 goal context',409);
        const reason=budget(s,g,{dispatch:true});if(reason){budgetBlock(s,g,reason);return;}
        workspaceFree(s,g);
        let ids=i.taskId?[i.taskId]:g.taskIds;
        if(i.taskId&&!g.taskIds.includes(i.taskId))fail('TASK_SCOPE','Task is outside this goal',409);
        let task;
        for(const id of ids){
          const candidate=find(s,'tasks',id,g.projectId);
          if(g.verifications[id]||g.blockers[id])continue;
          if(!['ready','backlog'].includes(candidate.status)){g.blockers[id]={code:'CANONICAL_TASK_NOT_READY',observedStatus:candidate.status,at:clock()};continue;}
          if(g.attempts.filter(a=>a.taskId===id).length>=g.policy.maxAttemptsPerTask){g.blockers[id]={code:'TASK_ATTEMPT_LIMIT',at:clock()};candidate.status='blocked';changed(candidate);continue;}
          if((candidate.dependsOn??[]).some(d=>find(s,'tasks',d,g.projectId).status!=='done'))continue;
          task=taskScope(s,g,id);break;
        }
        if(!task){
          if(g.taskIds.every(id=>g.qa[id]))g.status='awaiting_owner';
          else if(g.taskIds.some(id=>g.verifications[id]&&!g.qa[id]))g.status='awaiting_qa';
          else {g.status='blocked';g.blocker={code:'NO_READY_TASK',at:clock()};}
          trace(s,g,'no_ready_task');return;
        }
        const conversationId=i.conversationId??null;
        if(conversationId){const c=find(s,'conversations',conversationId,g.projectId);if(c.botId&&c.botId!==task.botId)fail('CONVERSATION_SCOPE','Conversation belongs to another task bot',409);}
        const number=g.attempts.length+1,id=randomUUID();
        const claim=append(s,'claim',{goalId:g.id,goalRevision:g.goalRevision,taskId:task.id,botId:task.botId??null,attemptId:id,status:'held',isolation:'not provided',workspaceOwner:g.projectId},g.projectId);
        const context={version:1,goalId:g.id,goalRevision:g.goalRevision,criteriaDigest:g.criteriaDigest,taskId:task.id,taskSignature:g.taskSignatures[task.id],attemptId:id,attemptNumber:number,claimId:claim.id,objective:g.objective,criteria:g.criteria.filter(c=>c.taskId===task.id),feedback:g.attempts.filter(a=>a.taskId===task.id).at(-1)?.feedback??null};
        g.attempts.push({id,number,projectId:g.projectId,taskId:task.id,botId:task.botId??null,conversationId,operationId:`goal:${g.id}:attempt:${id}`,claimId:claim.id,context,status:'reserved',reconciled:false,runId:null,startedAt:clock()});
        trace(s,g,'dispatch_reserved');return 'dispatch';
      });
      return !r.replayed&&r.effect==='dispatch'?dispatch(input):r.goal;
    },
    async reconcile(input){
      const r=await command('reconcile',input,(s,g)=>{trace(s,g,'reconcile_requested');});if(r.replayed)return r.goal;
      const g=get(input),a=last(g);let error;
      if(a){try{const run=ownedRun(store.read(),g,a);if(run)await t3?.reconcile?.(run.id);}catch(e){error=e.code??'RECONCILE_UNKNOWN';}}
      const result=await update(input,async(s,g)=>{
        const a=last(g);if(!a||a.status==='cancelled_before_dispatch')return;
        let run;try{run=ownedRun(s,g,a);}catch(e){error=e.code??'CONTEXT_MISMATCH';}
        if(!run||error){a.status='unknown';a.reconciled=false;if(!g.stopRequested)g.status='unknown';trace(s,g,'outcome_unknown',{error:error??'RUN_NOT_OBSERVED'});return;}
        a.runId=run.id;a.status=run.status;
        if(!terminal.has(run.status)){if(!g.stopRequested)g.status=['submitting','unknown'].includes(run.status)?'unknown':'active';trace(s,g,'run_pending');return;}
        // A terminal attempt can acquire trusted verification after its first
        // observation (for example reviewed local tests in Mission Studio).
        // Re-read that same attempt; never create or dispatch another run here.
        const previous=a.verificationId?record(s,'verification',a.verificationId,g.projectId):null;
        let refreshed;
        if(a.reconciled&&!g.stopRequested&&!g.qa[a.taskId]&&g.blockers[a.taskId]?.code!=='EXPLICIT_BLOCKER'&&run.status==='completed'&&previous?.status==='FAILED'){
          validateDefinition(s,g);
          const inspected=await inspectAttempt(s,g,a);
          if(inspected.status!==previous.status||inspected.fingerprint!==previous.fingerprint)refreshed=inspected;
        }
        if(!a.reconciled||refreshed){
          a.reconciled=true;release(s,a);
          if(!g.stopRequested){
            try{validateDefinition(s,g);}catch(e){g.status='blocked';g.blocker={code:e.code??'DEFINITION_CHANGED',at:clock()};trace(s,g,'definition_changed');return;}
            const result=refreshed??await inspectAttempt(s,g,a),v=append(s,'verification',{goalId:g.id,taskId:a.taskId,...result,...(refreshed?{supersedes:previous.id}:{})},g.projectId);
            if(refreshed)a.verificationHistory=[...(a.verificationHistory??[]),previous.id];
            a.verificationId=v.id;
            const task=find(s,'tasks',a.taskId,g.projectId);
            if(result.status==='PASSED'){g.verifications[a.taskId]=v.id;task.status='review';if(g.blockers[a.taskId]?.verificationId===previous?.id)delete g.blockers[a.taskId];}
            else {
              a.failureFingerprint=result.fingerprint;a.feedback=JSON.stringify(result.outcomes.map(o=>({criterionId:o.criterionId,status:o.status,reason:o.reason??o.result?.outcomes[0]?.reason}))).slice(0,4000);
              let unchanged=0;
              for(const prior of g.attempts.filter(x=>x.taskId===a.taskId).reverse()){if(prior.failureFingerprint!==a.failureFingerprint)break;unchanged++;}
              const count=g.attempts.filter(x=>x.taskId===a.taskId).length;
              if(unchanged>=g.policy.maxUnchangedFailures||count>=g.policy.maxAttemptsPerTask){g.blockers[a.taskId]={code:unchanged>=g.policy.maxUnchangedFailures?'UNCHANGED_FAILURE':'TASK_ATTEMPT_LIMIT',verificationId:v.id,at:clock()};task.status='blocked';}else task.status='ready';
            }
            changed(task);
            const perTask=Object.fromEntries(g.taskIds.map(id=>{
              const latest=g.attempts.filter(a=>a.taskId===id&&a.context.goalRevision===g.goalRevision&&a.verificationId).at(-1);
              const result=latest?record(s,'verification',latest.verificationId,g.projectId):null;
              return [id,{passed:result?.outcomes.filter(o=>o.status==='PASSED').length??0,total:g.criteria.filter(c=>c.taskId===id).length,status:result?.status??'NOT_CHECKED'}];
            }));
            g.progress={passed:Object.values(perTask).reduce((n,t)=>n+t.passed,0),total:g.criteria.length,perTask};g.status='active';
          }
        }
        if(g.stopRequested)settleStop(s,g);
        else {const reason=budget(s,g);if(reason)budgetBlock(s,g,reason);}
        trace(s,g,'reconciled');
      });
      schedule();return result.stopRequested?stopOwned(input):result;
    },
    async blockTask(input){return (await command('blockTask',input,(s,g,i)=>{
      if(inactive.has(g.status)||unresolved(g))fail('RECONCILE_REQUIRED','Cannot block an active or unknown attempt',409);
      if(!g.taskIds.includes(i.taskId))fail('TASK_SCOPE','Task is outside goal',409);
      const task=find(s,'tasks',i.taskId,g.projectId);g.blockers[i.taskId]={code:'EXPLICIT_BLOCKER',reason:boundedText(i.reason,'blocker',4000),at:clock()};task.status='blocked';changed(task);trace(s,g,'task_blocked',{taskId:task.id});
    })).goal;},
    async qa(input,caller){
      const actor=await identity('qa',get(input),input,caller);
      const r=await command('qa',input,async(s,g,i)=>{
        if(g.stopRequested||inactive.has(g.status)||unresolved(g))fail('RECONCILE_REQUIRED','QA requires a quiescent active goal',409);
        validateDefinition(s,g);const {verification,attempt,task}=await recheckTask(s,g,i.taskId);
        const run=ownedRun(s,g,attempt);
        if(actor.subject===attempt.botId||actor.subject===run.actorId||actor.subject===run.executedBy)fail('INDEPENDENT_QA_REQUIRED','Executor cannot approve its own work',403);
        const q=append(s,'qa',{goalId:g.id,goalRevision:g.goalRevision,taskId:task.id,verificationId:verification.id,actor,at:clock()},g.projectId);g.qa[task.id]=q.id;
        task.status='done';task.evidence=[...(task.evidence??[]),{kind:'goal.qa',id:q.id,verificationId:verification.id}];changed(task);
        g.status=g.taskIds.every(id=>g.qa[id])?'awaiting_owner':'active';trace(s,g,'qa_passed',{taskId:task.id});
      });schedule();return r.goal;
    },
    async review(input,caller){
      const actor=await identity('review',get(input),input,caller);
      return (await command('review',input,async(s,g)=>{
        if(g.stopRequested||g.status!=='awaiting_owner'||unresolved(g)||g.taskIds.some(id=>!g.qa[id]))fail('QA_REQUIRED','All tasks require independent QA before Owner review',409);
        validateDefinition(s,g);
        for(const id of g.taskIds){await recheckTask(s,g,id);const qa=record(s,'qa',g.qa[id],g.projectId);if(qa.goalRevision!==g.goalRevision)fail('INDEPENDENT_REVIEW_REQUIRED','QA must cover the current goal revision',403);}
        const review=append(s,'owner-review',{goalId:g.id,goalRevision:g.goalRevision,criteriaDigest:g.criteriaDigest,qaIds:Object.values(g.qa),actor,at:clock()},g.projectId);g.review=review.id;g.status='completed';trace(s,g,'owner_accepted');
      })).goal;
    },
    async recover(){
      const goals=await store.transaction(s=>{
        const result=[];
        for(const g of s.events.filter(e=>e.type==='goal.goal'&&!inactive.has(e.status))){
          const a=last(g);
          if(unresolved(g)){a.status='unknown';a.reconciled=false;if(!g.stopRequested)g.status='unknown';trace(s,g,'restart_requires_reconciliation');}
          // Restart requires explicit resume even between known terminal rounds.
          else if(!g.stopRequested){g.status='paused';g.stopRequested='pause';trace(s,g,'restart_paused');}
          result.push(g);
        }return result;
      });for(const g of goals)arm(g);return goals;
    },
    async suspendForRestore(){suspended=true;clearTimeout(scheduled);scheduled=null;for(const t of timers.values())clearTimeout(t);timers.clear();await Promise.allSettled([...pending]);},
    async afterRestore(){await store.transaction(s=>{for(const g of s.events.filter(e=>e.type==='goal.goal')){if(inactive.has(g.status))continue;g.restoreReviewRequired=true;g.stopRequested='pause';g.status=unresolved(g)?'unknown':'paused';trace(s,g,'restored_requires_owner_review');}});suspended=false;},
    cancelRestore(){suspended=false;for(const g of store.read().events.filter(e=>e.type==='goal.goal'))arm(g);schedule();},
    async close(){closed=true;unsubscribe();clearTimeout(scheduled);for(const t of timers.values())clearTimeout(t);timers.clear();await Promise.allSettled([...pending]);},
  };
  async function drive(){
    if(driving||closed||suspended)return;driving=true;
    try{
      // A late durable observation after Stop/deadline still belongs to that
      // stopped goal. Stop only that exact owner, once; do not dispatch or poll.
      for(const g of store.read().events.filter(e=>e.type==='goal.goal'&&!e.restoreReviewRequired&&e.stopRequested&&unresolved(e))){
        if(closed)break;
        const a=last(g);
        try{const r=ownedRun(store.read(),g,a,{context:false});if(r&&(!a.stopRequest||terminal.has(r.status)))await stopOwned({projectId:g.projectId,goalId:g.id});}catch{/* Foreign/ambiguous owners remain unresolved for explicit reconciliation. */}
      }
      for(const g of store.read().events.filter(e=>e.type==='goal.goal'&&!e.restoreReviewRequired&&e.policy.mode==='bounded-auto'&&!e.stopRequested&&e.status==='active')){
        if(closed)break;
        const a=last(g),input={projectId:g.projectId,goalId:g.id,expectedRevision:g.revision,operationId:`goal-auto:${g.id}:${g.revision}`};
        try{
          if(unresolved(g)){
            const r=a&&ownedRun(store.read(),g,a);if(r&&terminal.has(r.status))await api.reconcile(input);
          }else await api.advance(input);
        }catch(e){
          if(e.code==='REVISION_CONFLICT')continue;
          await update(input,(s,current)=>{current.status='blocked';current.blocker={code:e.code??'GOAL_DRIVER_FAILED',at:clock()};trace(s,current,'continuation_blocked');});
        }
      }
    }finally{driving=false;}
    // Continue only a ready bounded round. Do not poll unknown provider effects.
    const s=store.read();
    if(s.events.some(g=>{
      if(g.type!=='goal.goal'||g.policy.mode!=='bounded-auto'||g.status!=='active'||g.stopRequested)return false;
      if(!unresolved(g))return true;
      try{return terminal.has(ownedRun(s,g,last(g))?.status);}catch{return false;}
    }))schedule();
  }
  const unsubscribe=store.subscribe(schedule);
  // Recovery is local state only. No effect reservation is ever replayed.
  const ready=track(api.recover());
  for(const method of GOAL_HTTP_METHODS.filter(x=>x!=='state')){
    const fn=api[method];api[method]=(...args)=>closed?Promise.reject(Object.assign(new Error('Goals service closed'),{code:'SHUTTING_DOWN',statusCode:409})):track(ready.then(()=>fn(...args)));
  }
  for(const g of store.read().events.filter(e=>e.type==='goal.goal'))arm(g);
  return api;
}
