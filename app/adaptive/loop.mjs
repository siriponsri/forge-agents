import { append, record, records, replay, find, fail, revision, changed, boundedText, integer, digest } from './records.mjs';
import { validateDecision } from './selection.mjs';
import { checkEvidence, validateChecks } from './evidence.mjs';
import {assertWorkspaceAvailable} from '../server/admission.mjs';

const terminal = new Set(['completed','failed','cancelled','interrupted','rolled_back']);
const inactive = new Set(['completed','stopped','exhausted']);
export const LOOP_LIMITS = Object.freeze({maxAttempts:8,maxSteps:64,maxMs:3600000});
const at = () => new Date().toISOString();
function history(loop, action, data={}) {loop.history.push({at:at(),action,stage:loop.stage,status:loop.status,...data});changed(loop);}
function currentAttempt(loop) {return loop.attempts.at(-1);}
function observe(loop, run) {
  const attempt=currentAttempt(loop); attempt.runId=run.id;attempt.status=run.status;
  if (loop.stopRequested) {loop.status=terminal.has(run.status) ? (loop.stopReason === 'budget' ? 'exhausted' : 'stopped') : 'stopping';return;}
  // Observing the same finished provider run must not rewind inspection, human
  // review, an approved revision plan, or an already completed loop.
  if(loop.stage !== 'execute' || loop.status === 'completed')return;
  if (run.status === 'completed') {loop.stage='inspect';loop.status='ready';}
  else if (terminal.has(run.status)) {loop.stage='revise';loop.status='ready';}
  else loop.status=['unknown','submitting'].includes(run.status) ? 'unknown' : 'running';
}
function runFor(s, loop) {
  const attempt=currentAttempt(loop);
  if (!attempt) return null;
  const run=s.runs.find(r => r.operationId === attempt.operationId);
  if (!run) return null;
  if (run.projectId !== loop.projectId || run.taskId !== loop.taskId || (run.botId ?? null) !== loop.botId) fail('RUN_SCOPE','Run owner does not match loop task/bot',409);
  if (!run.adaptiveContext || digest(run.adaptiveContext) !== digest(attempt.context)) fail('CONTEXT_MISMATCH','T3 run did not retain the selected adaptive context',409);
  return run;
}

export function createLoopMethods({store,t3}) {
  const timers=new Map(); let closed=false;
  function arm(loop) {
    clearTimeout(timers.get(loop.id));timers.delete(loop.id);
    if (closed || !loop.deadlineAt || inactive.has(loop.status) || loop.stopRequested) return;
    const timer=setTimeout(async () => {
      timers.delete(loop.id);
      try {
        const current=record(store.read(),'loop',loop.id,loop.projectId);
        await methods.stop({projectId:loop.projectId,loopId:loop.id,expectedRevision:current.revision,operationId:`adaptive-budget:${loop.id}`,reason:'budget'});
      } catch(e) {
        // A concurrent GUI transition may win the revision race. Re-arm against
        // current durable state rather than silently dropping time enforcement.
        if(e.code === 'REVISION_CONFLICT')arm(record(store.read(),'loop',loop.id,loop.projectId));
        // Other failures leave uncertain execution explicit for reconciliation.
      }
    },Math.max(1,Date.parse(loop.deadlineAt)-Date.now()));timer.unref?.();timers.set(loop.id,timer);
  }
  async function command(method,input,fn) {
    input=structuredClone(input);
    const result=await store.transaction(async s => {
      find(s,'projects',input.projectId);const receipt=replay(s,input,method);
      if (receipt.prior) return {loop:receipt.prior.result,replayed:true};
      const loop=record(s,'loop',input.loopId,input.projectId);revision(loop,input.expectedRevision);
      const effect=await fn(s,loop,input);
      s.receipts.push({operationId:input.operationId,fingerprint:receipt.fingerprint,result:structuredClone(loop)});
      return {loop,effect};
    });
    arm(result.loop);return result;
  }
  async function finish(input,fn) {
    const loop=await store.transaction(s => {
      const loop=record(s,'loop',input.loopId,input.projectId);fn(s,loop);
      const receipt=s.receipts.find(r => r.operationId === input.operationId);if(receipt)receipt.result=structuredClone(loop);
      return loop;
    });arm(loop);return loop;
  }
  async function dispatch(input) {
    let loop=record(store.read(),'loop',input.loopId,input.projectId),attempt=currentAttempt(loop);
    if (!attempt) return loop;
    if(loop.deadlineAt && Date.now() >= Date.parse(loop.deadlineAt) && !loop.stopRequested){
      loop=await finish(input,(_s,l) => {l.stopRequested=true;l.stopReason='budget';l.status='stopping';history(l,'dispatch_deadline_expired');});
    }
    // A stop racing the durable reservation prevents dispatch when still local.
    if (loop.stopRequested && !runFor(store.read(),loop)) return finish(input,(_s,l) => {currentAttempt(l).status='cancelled_before_dispatch';l.status=l.stopReason === 'budget' ? 'exhausted' : 'stopped';history(l,'dispatch_cancelled');});
    try {
      await t3.startRun({projectId:loop.projectId,taskId:loop.taskId,conversationId:loop.conversationId,
        operationId:attempt.operationId,adaptiveContext:structuredClone(attempt.context)});
      loop=await finish(input,(s,l) => {
        const run=runFor(s,l);
        if (!run) {l.status='unknown';currentAttempt(l).status='unknown';history(l,'submission_uncertain',{error:'No durable T3 run observed'});}
        else {observe(l,run);history(l,'run_observed',{runId:run.id,runStatus:run.status});}
      });
    } catch(e) {
      loop=await finish(input,(_s,l) => {l.status=l.stopRequested ? 'stopping' : 'unknown';currentAttempt(l).status='unknown';history(l,'submission_uncertain',{error:e.message});});
    }
    if (loop.stopRequested) return stopRun(input);
    return loop;
  }
  async function stopRun(input) {
    const loop=record(store.read(),'loop',input.loopId,input.projectId),run=runFor(store.read(),loop);
    if (!run) return loop; // Submission may still be in flight. Never claim cancellation.
    let error;
    try {if(!terminal.has(run.status))await t3.stop(run.id);}catch(e){error=e.message;}
    return finish(input,(s,l) => {const observed=runFor(s,l);if(observed)observe(l,observed);history(l,'stop_observed',{runId:run.id,runStatus:observed?.status ?? 'unknown',...(error?{error}:{})});});
  }
  const methods={
    async createLoop(input) {
      const loop=await store.transaction(s => {
        find(s,'projects',input.projectId);const {prior,fingerprint}=replay(s,input,'createLoop');if(prior)return prior.result;
        const task=find(s,'tasks',input.taskId,input.projectId),decision=record(s,'decision',input.decisionId,input.projectId);
        if(decision.taskId !== task.id)fail('SCOPE','Decision belongs to another task');validateDecision(s,decision,input.projectId);
        if(records(s,'loop',input.projectId).some(l => !inactive.has(l.status))||s.events.some(e=>e.projectId===input.projectId&&e.type==='assistance.loop'&&!inactive.has(e.status)))fail('LOOP_EXISTS','Reconcile the existing project task strategy',409);
        if(task.botId){const bot=find(s,'bots',task.botId,input.projectId);if(bot.kind === 'helper' && bot.taskId !== task.id)fail('BOT_SCOPE','Helper belongs to another task',409);}
        if(input.conversationId){const c=find(s,'conversations',input.conversationId,input.projectId);if(c.botId && c.botId !== task.botId)fail('SCOPE','Conversation belongs to another bot');}
        const limits={maxAttempts:integer(input.limits?.maxAttempts ?? 2,'maxAttempts',1,LOOP_LIMITS.maxAttempts),maxSteps:integer(input.limits?.maxSteps ?? 16,'maxSteps',1,LOOP_LIMITS.maxSteps),maxMs:integer(input.limits?.maxMs ?? 300000,'maxMs',1,LOOP_LIMITS.maxMs)};
        const loop=append(s,'loop',{taskId:task.id,botId:task.botId ?? null,conversationId:input.conversationId ?? null,decisionId:decision.id,
          stage:'plan',status:'awaiting_plan',steps:0,limits,attempts:[],history:[{at:at(),action:'created',stage:'plan',status:'awaiting_plan'}],startedAt:null,deadlineAt:null,stopRequested:false},input.projectId);
        s.receipts.push({operationId:input.operationId,fingerprint,result:structuredClone(loop)});return loop;
      });arm(loop);return loop;
    },
    async advance(input) {
      const reserved=await command('advance',input,async(s,loop,i) => {
        if(inactive.has(loop.status) || loop.stopRequested)fail('LOOP_STOPPED','Loop is stopped, exhausted or complete',409);
        if(loop.steps >= loop.limits.maxSteps || (loop.deadlineAt && Date.now() >= Date.parse(loop.deadlineAt))) {
          loop.stopRequested=true;loop.stopReason='budget';loop.status=currentAttempt(loop) && !terminal.has(currentAttempt(loop).status) ? 'stopping' : 'exhausted';history(loop,'budget_exhausted');return 'stop';
        }
        if(loop.stage === 'execute' && ['submitting','running','unknown'].includes(loop.status))fail('RECONCILE_REQUIRED','Observe the existing attempt before another transition',409);
        // A revised task/route needs a newly reviewed decision before validation.
        if(loop.stage === 'revise' && i.decisionId){const replacement=record(s,'decision',i.decisionId,i.projectId);if(replacement.taskId !== loop.taskId)fail('SCOPE','Replacement decision belongs to another task');validateDecision(s,replacement,i.projectId);loop.decisionId=replacement.id;}
        const decision=record(s,'decision',loop.decisionId,i.projectId),{task}=validateDecision(s,decision,i.projectId);
        if(loop.stage === 'plan') {
          if(!task.planId || !find(s,'plans',task.planId,i.projectId).approved)fail('PLAN_REQUIRED','Approve the concrete human plan before executing',409);
          loop.stage='execute';loop.status='ready';
          if(!loop.startedAt){loop.startedAt=at();loop.deadlineAt=new Date(Date.now()+loop.limits.maxMs).toISOString();}
        } else if(loop.stage === 'execute') {
          if(!t3?.startRun || !t3?.reconcile || !t3?.stop || t3.adaptiveContextVersion !== 1)fail('ADAPTIVE_CONTEXT_UNSUPPORTED','T3 owner must support version 1 adaptive context before dispatch',409);
          if(loop.attempts.length >= loop.limits.maxAttempts){loop.status='exhausted';history(loop,'attempt_budget_exhausted');return;}
          assertWorkspaceAvailable(s,i.projectId,{adaptiveLoopId:loop.id});
          const number=loop.attempts.length+1;
          const context={version:1,decisionId:decision.id,loopId:loop.id,skillSnapshots:structuredClone(decision.skills),harness:structuredClone(decision.harness),
            taskSignature:decision.taskSignature,goal:task.title,feedback:loop.feedback ?? null};
          loop.attempts.push({number,operationId:`adaptive:${loop.id}:attempt:${number}`,runId:null,status:'reserved',context});
          loop.status='submitting';loop.steps++;history(loop,'dispatch_reserved');return 'dispatch';
        } else if(loop.stage === 'inspect') {
          const run=runFor(s,loop);if(!run || run.status !== 'completed')fail('RECONCILE_REQUIRED','Observe a completed run before inspection',409);
          const checks=validateChecks(i.checks);
          if(checks.some(c => c.runId !== run.id) || !checks.some(c => c.kind !== 'runStatus'))fail('EVIDENCE_SCOPE','Inspect this attempt with artifact or verifier evidence',409);
          const result=await checkEvidence(s,i.projectId,checks,{taskId:loop.taskId});
          const inspection=append(s,'inspection',{loopId:loop.id,runId:run.id,checks,result},i.projectId);loop.inspectionId=inspection.id;
          loop.stage=result.status === 'PASSED' ? 'review' : 'revise';loop.status='ready';
        } else if(loop.stage === 'revise') {
          loop.feedback=boundedText(i.feedback,'feedback',4000);
          if(loop.attempts.length >= loop.limits.maxAttempts){loop.status='exhausted';}else{loop.stage='plan';loop.status='awaiting_plan';}
        } else if(loop.stage === 'review') {
          if(i.action !== 'approve')fail('REVIEW_REQUIRED','Explicit human review approval is required',409);
          const reviewer=boundedText(i.reviewer,'reviewer',200),inspection=record(s,'inspection',loop.inspectionId,i.projectId);
          const result=await checkEvidence(s,i.projectId,inspection.checks,{taskId:loop.taskId});
          if(result.status !== 'PASSED')fail('EVIDENCE_REGRESSION','Inspection evidence changed before review',409,result);
          loop.review={reviewer,at:at(),inspectionId:inspection.id,result};loop.status='completed';
        } else fail('STAGE','Unsupported loop stage');
        loop.steps++;history(loop,'advanced');
      });
      if(reserved.replayed)return reserved.loop;
      if(reserved.effect === 'dispatch')return dispatch(input);
      if(reserved.effect === 'stop')return stopRun(input);
      return reserved.loop;
    },
    async reconcile(input) {
      const reservation=await command('reconcile',input,(_s,loop) => {history(loop,'reconcile_requested');return 'reconcile';});
      if(reservation.replayed)return reservation.loop;
      const run=runFor(store.read(),reservation.loop);let error;
      if(run){try{await t3?.reconcile?.(run.id);}catch(e){error=e.message;}}
      let loop=await finish(input,(s,l) => {
        const observed=runFor(s,l);
        if(observed)observe(l,observed);
        else if(currentAttempt(l)){l.status=l.stopRequested?'stopping':'unknown';}
        if(l.deadlineAt && Date.now() >= Date.parse(l.deadlineAt) && !inactive.has(l.status)){l.stopRequested=true;l.stopReason='budget';l.status=(observed && !terminal.has(observed.status)) || (!observed && currentAttempt(l) && currentAttempt(l).status !== 'cancelled_before_dispatch')?'stopping':'exhausted';}
        history(l,'reconciled',{...(error?{error}:{})});
      });
      if(loop.stopRequested && !inactive.has(loop.status))loop=await stopRun(input);
      return loop;
    },
    async stop(input) {
      const reservation=await command('stop',input,(_s,loop,i) => {
        if(loop.status === 'completed')fail('LOOP_COMPLETED','Completed loop needs no stop',409);
        loop.stopRequested=true;loop.stopReason=i.reason === 'budget'?'budget':'human';
        const attempt=currentAttempt(loop);
        loop.status=!attempt || terminal.has(attempt.status) || attempt.status === 'cancelled_before_dispatch' ? (loop.stopReason === 'budget'?'exhausted':'stopped') : 'stopping';
        history(loop,'stop_requested');return 'stop';
      });
      if(reservation.replayed || inactive.has(reservation.loop.status))return reservation.loop;
      return stopRun(input);
    },
    async resume(input) {
      const reservation=await command('resume',input,(s,loop) => {
        if(loop.status === 'completed' || loop.status === 'exhausted' || loop.stopReason === 'budget')fail('LOOP_STOPPED','Start a newly reviewed loop after completion/budget exhaustion',409);
        if(loop.deadlineAt && Date.now() >= Date.parse(loop.deadlineAt))fail('BUDGET_EXHAUSTED','Elapsed task deadline cannot be extended by resume; reconcile first',409);
        const attempt=currentAttempt(loop),run=runFor(s,loop);
        if(run && !terminal.has(run.status))fail('RECONCILE_REQUIRED','Existing provider outcome remains active or unknown',409);
        if(attempt && !run && attempt.status !== 'cancelled_before_dispatch' && input.retryReservation !== true)fail('RECONCILE_REQUIRED','No observed T3 run. Explicit retryReservation can replay the same durable owner operation; never create a new attempt',409);
        const decision=record(s,'decision',loop.decisionId,input.projectId);validateDecision(s,decision,input.projectId);
        if(attempt && !run && attempt.status !== 'cancelled_before_dispatch'){
          if(t3?.adaptiveContextVersion !== 1 || !t3?.startRun)fail('ADAPTIVE_CONTEXT_UNSUPPORTED','T3 owner must support durable adaptive replay',409);
          const task=find(s,'tasks',loop.taskId,input.projectId);
          if(!task.planId || !find(s,'plans',task.planId,input.projectId).approved)fail('PLAN_REQUIRED','Human plan approval is required before replay',409);
          loop.stopRequested=false;loop.stopReason=null;loop.status='submitting';history(loop,'reservation_replay_requested');return 'dispatch';
        }
        loop.stopRequested=false;loop.stopReason=null;
        if(run?.status === 'completed'){loop.stage='inspect';loop.status='ready';}
        else{loop.stage=attempt?'revise':'plan';loop.status=attempt?'ready':'awaiting_plan';}
        history(loop,'resumed');
      });
      if(!reservation.replayed && reservation.effect === 'dispatch')return dispatch(input);
      return reservation.loop;
    },
    shutdown(){closed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();},
  };
  // Restart restores only deadline enforcement, never submits a provider turn.
  for(const loop of store.read().events.filter(e => e.type === 'adaptive.loop'))arm(loop);
  return methods;
}
