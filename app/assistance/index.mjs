import {append,record,records,receipt,saveReceipt,find,fail,changed,revision,text,integer,keys,provenance} from './records.mjs';
import {validatePolicy,selectFromState,validateDecision,latestPolicy} from './selection.mjs';
import {terminal,durableRun,validateTaskScope} from './context.mjs';
export {validateAssistanceContext,assistancePrompt} from './context.mjs';
export {validatePolicy,validateDecision} from './selection.mjs';

const inactive=new Set(['completed','stopped','exhausted']);
export const ASSISTANCE_LIMITS=Object.freeze({maxAttempts:8,maxEscalations:3,maxSteps:32,maxMs:3600000});
function limitsOf(v={}){
  keys(v,['maxAttempts','maxEscalations','maxSteps','maxMs','reportedCost'],'limits');
  const c=v.reportedCost??{mode:'allow-unknown',maxAmount:null,currency:null};
  keys(c,['mode','maxAmount','currency'],'reported cost policy');
  if(!['allow-unknown','require-reported'].includes(c.mode)||c.maxAmount!=null&&(typeof c.maxAmount!=='number'||!Number.isFinite(c.maxAmount)||c.maxAmount<0))fail('VALIDATION','Invalid reported cost policy');
  if(c.maxAmount!=null)text(c.currency,'budget currency',20);
  return {maxAttempts:integer(v.maxAttempts??4,'maxAttempts',1,8),maxEscalations:integer(v.maxEscalations??1,'maxEscalations',0,3),maxSteps:integer(v.maxSteps??12,'maxSteps',1,32),maxMs:integer(v.maxMs??300000,'maxMs',1,3600000),reportedCost:{mode:c.mode,maxAmount:c.maxAmount??null,currency:c.currency??null}};
}

export function createAssistanceService({store,providers,t3,clock=Date.now}){
  const timers=new Map(),pending=new Set();let closed=false;
  const read=(input,s=store.read())=>record(s,'loop',input.loopId,input.projectId);
  function trace(l,action,extra={}){l.history.push({at:clock(),action,status:l.status,...extra});changed(l);}
  function arm(l){
    clearTimeout(timers.get(l.id));timers.delete(l.id);
    if(closed||inactive.has(l.status)||l.stopRequested)return;
    const timer=setTimeout(()=>{timers.delete(l.id);api.stop({projectId:l.projectId,loopId:l.id,operationId:`assistance-deadline:${l.id}`,reason:'budget'}).catch(()=>{});},Math.max(1,l.deadlineAt-clock()));timer.unref?.();timers.set(l.id,timer);
  }
  async function command(method,input,fn){
    input=structuredClone(input);
    return store.transaction(s=>{
      find(s,'projects',input.projectId);const r=receipt(s,method,input);
      if(r.prior)return {result:r.prior.result,replayed:true};
      const result=fn(s,input);saveReceipt(s,input,r.fingerprint,result);return {result};
    });
  }
  async function update(input,fn){
    const l=await store.transaction(s=>{const l=read(input,s);fn(s,l);const r=s.receipts.find(r=>r.operationId===input.operationId);if(r?.type==='assistance.command')r.result=structuredClone(l);return l;});arm(l);return l;
  }
  function observe(l,r){
    const a=l.attempts.at(-1);if(!a||!r)return;
    a.runId=r.id;a.status=r.status;
    // A returned value is insufficient: only durable T3 state advances roles.
    a.reportedCost=r.reportedCost??null;
    if(l.stopRequested){l.status=terminal.has(r.status)?l.stopReason==='budget'?'exhausted':'stopped':'stopping';return;}
    if(inactive.has(l.status))return;
    if(!terminal.has(r.status)){l.status=['submitting','unknown'].includes(r.status)?'unknown':'running';return;}
    if(l.pendingRole)return;
    l.status=a.role==='asst'?(r.status==='completed'?'awaiting_return':'awaiting_owner'):'awaiting_review';
  }
  function checkBudget(s,l){
    if(l.steps>=l.limits.maxSteps||clock()>=l.deadlineAt||l.attempts.length>=l.limits.maxAttempts)return 'Task attempt, step or elapsed-time limit reached';
    const c=l.limits.reportedCost;
    let unknown=false;const perCurrency={};
    for(const a of l.attempts){const r=s.runs.find(r=>r.operationId===a.operationId),cost=r?.reportedCost;if(!cost||typeof cost.amount!=='number'||!Number.isFinite(cost.amount)||cost.amount<0||typeof cost.currency!=='string'||!cost.currency||typeof cost.source!=='string'||!cost.source){unknown=true;continue;}Object.defineProperty(perCurrency,cost.currency,{value:(Object.hasOwn(perCurrency,cost.currency)?perCurrency[cost.currency]:0)+cost.amount,enumerable:true,configurable:true});if(c.currency&&cost.currency!==c.currency)unknown=true;}
    const currency=c.currency??(Object.keys(perCurrency).length===1?Object.keys(perCurrency)[0]:null),total=currency?perCurrency[currency]??0:0;
    if(!currency&&Object.keys(perCurrency).length>1)unknown=true;
    l.reportedCost={amount:unknown?null:total,currency,knownSubtotal:currency?total:null,perCurrency,unknown,source:'durable T3 reportedCost; no estimation or currency conversion'};
    if(c.mode==='require-reported'&&unknown)fail('COST_UNKNOWN','Previous attempt cost is unreported; ask the owner before further dispatch',409);
    if(c.maxAmount!==null&&total>=c.maxAmount)return 'Reported expenditure limit reached (unreported expenditure remains unknown)';
    return null;
  }
  async function stopObserved(input){
    const l=read(input),a=l.attempts.at(-1);
    // Stop remains available when T3 ignored a role/context. Use only the exact
    // persisted owner operation + task/bot/project, never a returned foreign ID.
    const owned=s=>s.runs.filter(r=>r.operationId===a?.operationId&&r.projectId===l.projectId&&r.taskId===l.taskId&&(r.botId??null)===l.botId);
    const matches=owned(store.read());if(matches.length>1)fail('RUN_SCOPE','Ambiguous run identity; T3 owner must reconcile',409);
    const r=matches[0];
    if(!r)return l;
    let errorCode=null;
    const claim=await store.transaction(s=>{
      const current=read(input,s),attempt=current.attempts.at(-1);
      if(terminal.has(r.status)||attempt.stopRequest)return false;
      attempt.stopRequest={runId:r.id,status:'submitting',at:clock()};trace(current,'stop_dispatch_claimed');return true;
    });
    try{if(claim)await t3.stop(r.id);}catch(e){errorCode=e.code??'STOP_UNKNOWN';}
    return update(input,(s,l)=>{
      if(claim)l.attempts.at(-1).stopRequest.status=errorCode?'unknown':'accepted';
      try{observe(l,durableRun(s,l));}catch(e){errorCode=e.code??'CONTEXT_MISMATCH';const stopped=owned(s)[0];l.attempts.at(-1).status=stopped?.status??'unknown';l.status=terminal.has(stopped?.status)?l.stopReason==='budget'?'exhausted':'stopped':'stopping';}
      trace(l,'stop_observed',{errorCode});
    });
  }
  async function dispatch(input){
    // A second durable claim closes the stop/reservation race. This claim is
    // never replayed after restart, even if no durable T3 run can be found.
    const claimed=await store.transaction(s=>{
      const l=read(input,s),a=l.attempts.at(-1);if(a?.status!=='reserved')return false;
      if(l.stopRequested||clock()>=l.deadlineAt){a.status='cancelled_before_dispatch';l.stopRequested=true;l.stopReason=clock()>=l.deadlineAt?'budget':'human';l.status=l.stopReason==='budget'?'exhausted':'stopped';trace(l,'cancelled_before_dispatch');return false;}
      a.status='dispatching';trace(l,'dispatch_claimed');return true;
    });
    if(!claimed)return read(input);
    const l=read(input),a=l.attempts.at(-1);
    try{
      await t3.startRun({projectId:l.projectId,taskId:l.taskId,conversationId:l.conversationId,operationId:a.operationId,assistanceContext:structuredClone(a.context)});
      await update(input,(s,l)=>{const r=durableRun(s,l);if(r)observe(l,r);else{l.status='unknown';l.attempts.at(-1).status='unknown';}trace(l,r?'run_observed':'submission_uncertain');});
    }catch(e){await update(input,(_s,l)=>{l.status=l.stopRequested?'stopping':'unknown';l.attempts.at(-1).status='unknown';trace(l,'submission_uncertain',{errorCode:e.code??'T3_UNKNOWN'});});}
    const current=read(input);return current.stopRequested?stopObserved(input):current;
  }
  const api={
    state({projectId}){find(store.read(),'projects',projectId);const s=store.read();return {policy:latestPolicy(s,projectId)??null,decisions:records(s,'decision',projectId),loops:records(s,'loop',projectId),implementation:'service; HTTP and GUI require lead integration',qualityImprovement:'NOT_ESTABLISHED'};},
    async configure(input){return (await command('configure',input,(s,i)=>{
      const prior=latestPolicy(s,i.projectId);if((i.expectedPolicyId??null)!==(prior?.id??null))fail('REVISION_CONFLICT','Reload the current assistance policy',409);
      return append(s,'policy',{policy:validatePolicy(i.policy)},i.projectId);
    })).result;},
    async select(input){return (await command('select',input,(s,i)=>append(s,'decision',selectFromState(s,i,providers,t3,clock),i.projectId))).result;},
    async createLoop(input){
      const {result}=await command('createLoop',input,(s,i)=>{
        const d=record(s,'decision',i.decisionId,i.projectId);if(d.taskId!==i.taskId)fail('SCOPE','Selection belongs to another task',409);
        validateDecision(s,d,i.projectId,clock);
        if(records(s,'loop',i.projectId).some(l=>!inactive.has(l.status))||s.events.some(e=>e.type==='adaptive.loop'&&e.projectId===i.projectId&&!inactive.has(e.status)))fail('LOOP_EXISTS','Reconcile the existing project task loop before creating assistance',409);
        const limits=limitsOf(i.limits),l=append(s,'loop',{decisionId:d.id,taskId:d.taskId,botId:d.botId,conversationId:i.conversationId??null,status:'ready',pendingRole:'executor',reason:{kind:'initial',reason:'Start with the Executor selected by the configured policy.'},feedback:null,limits,steps:0,escalations:0,attempts:[],history:[],stopRequested:false,startedAt:clock(),deadlineAt:clock()+limits.maxMs},i.projectId);
        validateTaskScope(s,l);trace(l,'created');return l;
      });arm(result);return result;
    },
    async advance(input){
      let effect;
      const {result,replayed}=await command('advance',input,(s,i)=>{
        const l=read(i,s);revision(l,i.expectedRevision);
        if(l.stopRequested||inactive.has(l.status))fail('LOOP_STOPPED','Loop stopped, exhausted or complete',409);
        if(!l.pendingRole||l.status!=='ready')fail('RECONCILE_REQUIRED','Reconcile and review the current attempt before another dispatch',409);
        if(t3?.assistanceContextVersion!==1||['startRun','stop','reconcile'].some(k=>typeof t3?.[k]!=='function'))fail('ASSISTANCE_CONTEXT_UNSUPPORTED','T3 must validate, honor and persist version-1 assistance routes before execution',409);
        const d=record(s,'decision',l.decisionId,i.projectId);validateDecision(s,d,i.projectId,clock);validateTaskScope(s,l);
        const previous=durableRun(s,l);if(l.attempts.length&&(!previous||!terminal.has(previous.status)||l.attempts.at(-1).reconciled!==true))fail('RECONCILE_REQUIRED','Reconcile the exact previous attempt to a terminal outcome',409);
        if(s.runs.some(r=>r.projectId===i.projectId&&!terminal.has(r.status)))fail('WORKSPACE_BUSY','Another task or chat is active/unknown in this workspace',409);
        const budget=checkBudget(s,l);if(budget){l.status='exhausted';trace(l,'limit_reached',{reason:budget});return l;}
        const role=l.pendingRole,number=l.attempts.length+1;
        const context={version:1,decisionId:d.id,loopId:l.id,attemptNumber:number,role,taskSignature:d.taskSignature,selection:structuredClone(d.selection[role].selection),feedback:l.feedback,reason:structuredClone(l.reason),runtimeMode:'approval-required'};
        l.attempts.push({number,role,operationId:`assistance:${l.id}:attempt:${number}`,context,runId:null,status:'reserved',reconciled:false,reportedCost:null});
        l.pendingRole=null;l.status='submitting';l.steps++;trace(l,'dispatch_reserved');effect='dispatch';return l;
      });arm(result);return !replayed&&effect==='dispatch'?dispatch(input):result;
    },
    async reconcile(input){
      const r=await command('reconcile',input,(s,i)=>{const l=read(i,s);trace(l,'reconcile_requested');return l;});
      if(r.replayed)return r.result;
      const l=read(input),a=l.attempts.at(-1),known=a?store.read().runs.find(r=>r.operationId===a.operationId&&r.projectId===l.projectId&&r.taskId===l.taskId&&(r.botId??null)===l.botId):null;
      let errorCode=null;
      try{if(known)await t3.reconcile(known.id);}catch(e){errorCode=e.code??'RECONCILE_UNKNOWN';}
      const result=await update(input,(s,l)=>{
        try{const r=durableRun(s,l);if(r){observe(l,r);l.attempts.at(-1).reconciled=terminal.has(r.status)&&!errorCode;}else if(l.attempts.length&&!inactive.has(l.status))l.status=l.stopRequested?'stopping':'unknown';}catch(e){errorCode=e.code??'CONTEXT_MISMATCH';l.status=l.stopRequested?'stopping':'unknown';}
        if(clock()>=l.deadlineAt&&!inactive.has(l.status)){l.stopRequested=true;l.stopReason='budget';l.status='stopping';}
        trace(l,'reconciled',{errorCode});
      });return result.stopRequested&&!inactive.has(result.status)?stopObserved(input):result;
    },
    async transition(input){return (await command('transition',input,(s,i)=>{
      const l=read(i,s);revision(l,i.expectedRevision);
      if(l.stopRequested||inactive.has(l.status))fail('LOOP_STOPPED','Loop is inactive',409);
      const a=l.attempts.at(-1),r=durableRun(s,l);if(!a||!r||!terminal.has(r.status)||!a.reconciled||l.pendingRole)fail('RECONCILE_REQUIRED','Reconcile the existing terminal attempt before changing roles',409);
      const d=record(s,'decision',l.decisionId,i.projectId);validateDecision(s,d,i.projectId,clock);validateTaskScope(s,l);
      if(l.steps>=l.limits.maxSteps||clock()>=l.deadlineAt){l.status='exhausted';trace(l,'limit_reached');return l;}
      if(i.action==='escalate'){
        if(a.role!=='executor')fail('ROLE_CONFLICT','Only Executor work can escalate to Asst',409);
        if(l.escalations>=l.limits.maxEscalations)fail('ESCALATION_LIMIT','Assistance escalation limit reached',409);
        let reason;
        if(i.trigger==='difficult'&&d.constraints.difficulty)reason=structuredClone(d.constraints.difficulty);
        else if(i.trigger==='stuck')reason={kind:'stuck',runId:r.id,reason:text(i.reason,'observed stuck reason'),provenance:provenance(i.provenance)};
        else fail('TRIGGER_REQUIRED','Asst is permitted only for explicitly difficult work or an observed stuck Executor',409);
        l.escalations++;l.pendingRole='asst';l.reason=reason;l.feedback=text(i.feedback??reason.reason,'assistance handoff');
      }else if(i.action==='return'){
        if(a.role!=='asst'||r.status!=='completed')fail('ROLE_CONFLICT','A completed Asst attempt is required before returning to Executor',409);
        l.pendingRole='executor';l.feedback=text(i.feedback,'reviewed Asst handoff');l.reason={kind:'return',runId:r.id,reason:'Continue Executor work from the reviewed Asst handoff.',provenance:provenance(i.provenance)};
      }else if(i.action==='approve'){
        if(a.role!=='executor'||r.status!=='completed')fail('REVIEW_REQUIRED','Only completed Executor work can be human-reviewed',409);
        l.review={reviewer:text(i.reviewer,'reviewer',200),evidence:text(i.evidence,'verification evidence'),runId:r.id,at:clock()};l.status='completed';l.steps++;trace(l,'human_reviewed');return l;
      }else fail('VALIDATION','Use escalate, return or approve');
      l.status='ready';l.steps++;trace(l,i.action);return l;
    })).result;},
    async stop(input){
      const r=await command('stop',input,(s,i)=>{
        const l=read(i,s);if(l.status==='completed')return l;
        l.stopRequested=true;l.stopReason=i.reason==='budget'?'budget':'human';const a=l.attempts.at(-1);
        if(a?.status==='reserved')a.status='cancelled_before_dispatch';
        l.status=!a||a.status==='cancelled_before_dispatch'||terminal.has(a.status)?l.stopReason==='budget'?'exhausted':'stopped':'stopping';
        trace(l,'stop_requested');return l;
      });arm(r.result);if(r.replayed||inactive.has(r.result.status))return r.result;return stopObserved(input);
    },
    async recover(){
      const loops=await store.transaction(s=>{
        const loops=[];
        for(const l of s.events.filter(e=>e.type==='assistance.loop'&&!inactive.has(e.status))){
          if(l.attempts.length&&['submitting','running','unknown','stopping'].includes(l.status)){l.status=l.stopRequested?'stopping':'unknown';l.attempts.at(-1).reconciled=false;trace(l,'restart_requires_reconciliation');}
          loops.push(l);
        }return loops;
      });for(const l of loops)arm(l);return loops; // Read/stop only; never redispatch.
    },
    async close(){closed=true;for(const t of timers.values())clearTimeout(t);timers.clear();await Promise.allSettled([...pending]);},
  };
  for(const name of ['configure','select','createLoop','advance','reconcile','transition','stop','recover']){
    const fn=api[name];api[name]=(...args)=>{if(closed)return Promise.reject(Object.assign(new Error('Assistance service closed'),{code:'SHUTTING_DOWN',statusCode:409}));const p=Promise.resolve().then(()=>fn(...args));pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};
  }
  return api;
}
