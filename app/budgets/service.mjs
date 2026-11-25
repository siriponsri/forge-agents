import {append,records,find,fail,changed,exact,text,integer,digest,money,compare,binding,owned,policy,terminal,reservation,accounting} from './contracts.mjs';
import {exposure,reserveBudget,validateBudgetAdmission} from './admission.mjs';
export {reserveBudget,validateBudgetAdmission,exposure};

export const BUDGET_HTTP_METHODS=Object.freeze(['state','configure']);
export async function dispatchBudgetRequest(service,method,input,caller){
  if(!BUDGET_HTTP_METHODS.includes(method))fail('NOT_FOUND','Budget route not found',404);
  return service[method](input,caller);
}

export function createBudgetService({store,t3,authorize}){
  if(!store?.transaction||!store?.read)throw new TypeError('Canonical FORGE store required');
  async function owner(action,input,caller,s=store.read()){
    const identity=await authorize?.({action,projectId:input.projectId},caller,s);
    if(identity?.kind!=='human'||(identity.role??'owner')!=='owner')fail('OWNER_REQUIRED','Use an authenticated Owner session',403);
    return {kind:'human',subject:text(identity.subject,'Owner subject')};
  }
  async function command(method,input,caller,fn){
    const actor=await owner(method,input,caller);text(input.operationId,'operationId');text(input.projectId,'projectId');
    const fingerprint=digest({method,input}),operationId=`budget:command:${digest(input.operationId)}`;
    return store.transaction(async s=>{
      await owner(method,input,caller,s);find(s,'projects',input.projectId);
      const prior=s.receipts.find(r=>r.operationId===operationId);
      if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Budget command ID belongs to another input',409);return prior.result;}
      const result=fn(s,actor);s.receipts.push({operationId,type:`budget.${method}`,projectId:input.projectId,fingerprint,result:structuredClone(result)});return result;
    });
  }
  function scoped(s,input){text(input.projectId,'projectId');find(s,'projects',input.projectId);if(input.botId)find(s,'bots',input.botId,input.projectId);}
  function stoppedByPolicy(s,r,now){
    return records(s,'policy',r.projectId).filter(p=>p.enabled&&(p.botId===null||p.botId===r.binding.botId)&&policy(s,p.projectId,p.botId)?.id===p.id).find(p=>{
      let e;try{e=exposure(s,p,now);}catch(error){if(error.code==='BUDGET_OVERFLOW')return true;throw error;}
      return compare(e.knownSpend,p.limit)>=0||p.unknown==='block'&&e.unknownRunIds.some(id=>{
        const other=reservation(s,id);return !other||accounting(s,other).latest!==null;
      })||e.currencyMismatch.length>0;
    });
  }
  async function enforce(projectId,runId){
    // Durable Stop intent precedes any external call. An interrupted/lost Stop
    // response is never retried by this module, including after process restart.
    const claims=await store.transaction(s=>{
      const claims=[];
      for(const r of records(s,'reservation',projectId).filter(r=>r.held&&(!runId||r.binding.runId===runId))){
        let run;try{run=owned(s,r.binding);}catch{continue;}
        if(terminal(run)||r.notDispatched||r.restored&&!r.reconciledAfterRestore)continue;
        const p=stoppedByPolicy(s,r,Date.now());if(!p)continue;
        if(records(s,'stop').some(e=>digest(e.binding)===digest(r.binding)))continue;
        const stop=append(s,'stop',{binding:r.binding,policyId:p.id,policyRevision:p.policyRevision,status:'unknown',delivery:'intent-recorded',reason:'budget_threshold'},r.projectId);
        claims.push(stop);
      }
      return claims;
    });
    for(const c of claims){
      let status='unknown',delivery='unavailable',message=null;
      try{
        const s=store.read(),r=reservation(s,c.binding.runId),run=owned(s,c.binding);
        if(terminal(run)||!stoppedByPolicy(s,r,Date.now()))delivery='not-needed';
        else if(t3?.stop){delivery='attempted';await t3.stop(run.id);status='returned';}
      }catch(error){message=String(error.code??'STOP_UNCERTAIN');}
      await store.transaction(s=>{const e=find(s,'events',c.id);e.status=status;e.delivery=delivery;e.error=message;changed(e);});
    }
    return claims.length;
  }
  const api={
    async state(input,caller){
      exact(input,['projectId','botId']);await owner('read',input,caller);const s=store.read();scoped(s,input);
      const rs=records(s,'reservation',input.projectId).filter(r=>!input.botId||r.binding.botId===input.botId);
      const attempts=rs.map(r=>{const a=accounting(s,r);return {...r,...a,latestReceipt:a.latest?.sourceReceiptId??null};});
      // Include legacy/unintegrated runs as visibly unknown; never quietly omit
      // them from a report or use their floats as canonical billed amounts.
      const untrackedRuns=s.runs.filter(r=>r.projectId===input.projectId&&(!input.botId||r.botId===input.botId)&&!rs.some(x=>x.binding.runId===r.id)).map(r=>({runId:r.id,botId:r.botId??null,status:r.status,pricingStatus:'unknown',cost:null,reportedUsage:r.reportedUsage??null,legacyObservation:true}));
      const scopes=[null,...s.bots.filter(b=>b.projectId===input.projectId).map(b=>b.id)].filter(id=>!input.botId||id===input.botId);
      const policies=scopes.map(botId=>{
        const p=policy(s,input.projectId,botId);return p?{...p,exposure:exposure(s,p),untrackedCount:untrackedRuns.filter(r=>botId===null||r.botId===botId).length}:{projectId:input.projectId,botId,policyRevision:0,enabled:false,unknown:null,period:null,limit:null,reserve:null,exposure:null};
      });
      return {projectId:input.projectId,stateRevision:s.revision,policies,attempts,untrackedRuns,observations:records(s,'observation',input.projectId).filter(o=>!input.botId||o.binding.botId===input.botId),stops:records(s,'stop',input.projectId).filter(o=>!input.botId||o.binding.botId===input.botId),pricingStatus:untrackedRuns.length||attempts.some(a=>a.pricingStatus==='unknown')?'unknown':'reported',defaultAdmission:'supervised',readOnly:true};
    },
    async configure(input,caller){
      exact(input,['operationId','projectId','botId','expectedRevision','enabled','unknown','period','limit','reserve']);
      const result=await command('configure',input,caller,(s,actor)=>{
        scoped(s,input);const botId=input.botId??null,p=policy(s,input.projectId,botId);
        if((p?.policyRevision??0)!==input.expectedRevision)fail('REVISION_CONFLICT','Budget settings changed; reload before saving',409);
        if(typeof input.enabled!=='boolean'||!['allow','block'].includes(input.unknown)||!['lifetime','month'].includes(input.period))fail('VALIDATION','Choose enabled, unknown handling and accounting period explicitly');
        const limit=money(input.limit),reserve=money(input.reserve);if(limit.minorUnits===0||compare(reserve,limit)>0)fail('VALIDATION','Use a positive limit and a reservation no larger than it');
        return append(s,'policy',{botId,policyRevision:(p?.policyRevision??0)+1,enabled:input.enabled,unknown:input.unknown,period:input.period,limit,reserve,actor},input.projectId);
      });
      await enforce(input.projectId);return result;
    },
    /** INTERNAL: host/native feed only. Source snapshots MUST be cumulative. */
    async observe(input){
      exact(input,['projectId','botId','runId','attemptId','providerInstanceId','model','source','sourceReceiptId','sequence','cost','usage','final','occurredAt']);
      const b={projectId:text(input.projectId,'projectId'),botId:input.botId??null,runId:text(input.runId,'runId'),attemptId:text(input.attemptId,'attemptId'),providerInstanceId:text(input.providerInstanceId,'providerInstanceId'),model:text(input.model,'model')};
      const source=text(input.source,'source'),sourceReceiptId=text(input.sourceReceiptId,'sourceReceiptId'),sequence=integer(input.sequence,'sequence');
      const cost=input.cost===null?null:money(input.cost);let usage=null;
      if(input.usage!==null){exact(input.usage,['totalTokens'],'usage');usage={totalTokens:integer(input.usage.totalTokens,'totalTokens')};}
      if(typeof input.final!=='boolean')fail('VALIDATION','Native accounting finality must be explicit');
      const occurredAt=input.occurredAt??null;if(occurredAt!==null)integer(occurredAt,'occurredAt');
      const data={binding:b,source,sourceReceiptId,sequence,cost,usage,final:input.final,occurredAt},fingerprint=digest(data);
      const result=await store.transaction(s=>{
        const run=owned(s,b);let r=reservation(s,b.runId);
        // Retrospective native accounting must not be refused merely because
        // historical/unintegrated work already exceeds a newly configured cap.
        // This record can NEVER authorize a provider dispatch.
        if(!r){const at=Date.parse(run.createdAt??'');r=append(s,'reservation',{binding:b,admittedAt:Number.isFinite(at)?at:Date.now(),policyFence:[],holds:[],held:true,status:'unknown',restored:false,accountingOnly:true},b.projectId);}
        if(digest(r.binding)!==digest(b)||r.notDispatched)fail('BUDGET_RESERVATION','A matching canonical reservation is required',409);
        const prior=records(s,'observation').find(o=>o.binding.providerInstanceId===b.providerInstanceId&&o.sourceReceiptId===sourceReceiptId);
        if(prior){if(prior.fingerprint!==fingerprint)fail('BUDGET_RECEIPT_REUSE','Immutable source receipt changed',409);return prior;}
        const a=accounting(s,r);
        if(a.latest&&a.latest.source!==source)fail('BUDGET_SOURCE','One authoritative cumulative source per attempt is required',409);
        const same=records(s,'observation',b.projectId).find(o=>o.binding.runId===b.runId&&o.sequence===sequence);
        if(same)fail('BUDGET_SEQUENCE_REUSE','Sequence already belongs to another receipt',409);
        const stale=!!a.latest&&sequence<a.latest.sequence;
        if(!stale){
          if(cost&&a.cost&&compare(cost,a.cost)<0)fail('BUDGET_REGRESSION','Cumulative billed cost cannot decrease',409);
          if(usage&&a.usage&&usage.totalTokens<a.usage.totalTokens)fail('BUDGET_REGRESSION','Cumulative usage cannot decrease',409);
        }
        const e=append(s,'observation',{...data,fingerprint,stale,pricingStatus:cost===null?'unknown':'reported',receivedAt:Date.now()},b.projectId);
        if(r.restored&&!stale&&cost!==null&&input.final){r.reconciledAfterRestore=sourceReceiptId;changed(r);}
        return e;
      });
      await api.reconcile({projectId:b.projectId});return result;
    },
    /** INTERNAL: requires the dispatch owner's durable proof of no dispatch. */
    async confirmNotDispatched(input){
      exact(input,['projectId','runId','attemptId','sourceReceiptId']);text(input.sourceReceiptId,'sourceReceiptId');
      return store.transaction(s=>{
        const r=reservation(s,input.runId);if(!r||r.projectId!==input.projectId||r.binding.attemptId!==input.attemptId)fail('BUDGET_OWNERSHIP','No-dispatch proof does not match reservation',409);
        const run=owned(s,r.binding);
        if(!terminal(run)||run.threadId||run.providerRunId||accounting(s,r).latest)fail('BUDGET_RECONCILE','Observed or potentially live dispatch cannot be released as absent',409);
        if(r.notDispatched){if(r.notDispatched!==input.sourceReceiptId)fail('BUDGET_RECEIPT_REUSE','No-dispatch proof changed',409);return r;}
        r.notDispatched=input.sourceReceiptId;r.held=false;r.status='not-dispatched';changed(r);append(s,'reconciliation',{binding:r.binding,sourceReceiptId:input.sourceReceiptId,outcome:'confirmed-not-dispatched'},r.projectId);return r;
      });
    },
    /** INTERNAL: no polling, timers, new turn or automatic effect retry. */
    async reconcile(input={}){
      exact(input,['projectId','runId']);
      const stopped=await enforce(input.projectId,input.runId);
      const released=await store.transaction(s=>{
        let n=0;
        for(const r of records(s,'reservation',input.projectId).filter(r=>r.held&&(!input.runId||r.binding.runId===input.runId))){
          let run;try{run=owned(s,r.binding);}catch{continue;}
          const a=accounting(s,r);
          if(terminal(run)&&a.latest?.final&&a.pricingStatus==='reported'&&(!r.restored||r.reconciledAfterRestore)){r.held=false;r.status='reconciled';r.finalReceiptId=a.latest.sourceReceiptId;changed(r);n++;}
          else if(run.status==='unknown'&&r.status!=='unknown'){r.status='unknown';changed(r);}
        }
        return n;
      });return {stopped,released,redispatched:0};
    },
  };
  return api;
}
