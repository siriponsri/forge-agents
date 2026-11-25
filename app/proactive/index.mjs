import {randomUUID} from 'node:crypto';
import {find,fail,changed,revision,digest,boundedText,integer,exact,records,record,append,active,definitionKeys,definition,currentVersion,checkEnvelope,checkBudget,available,taskFor,ownedRun,usage,terminal} from './contracts.mjs';
import {nextSchedule} from './schedule.mjs';
import {proactiveEnforcementRequest,validateProactiveEnforcement} from './enforcement.mjs';
export {validateProactiveContext,proactivePrompt,validateProactiveAction} from './context.mjs';
export {proactiveEnforcementRequest,validateProactiveEnforcement} from './enforcement.mjs';
export {mergeProactiveSafety} from './recovery.mjs';

export const PROACTIVE_HTTP_METHODS=Object.freeze(['state','create','revise','approve','enable','pause','revoke','reconcile','resolve']);
const common=['projectId','operationId','recipeId','expectedRevision'];
const extras={create:definitionKeys,revise:definitionKeys,approve:[],enable:[],pause:[],revoke:[],reconcile:['occurrenceId'],resolve:['inboxId','note']};
export async function dispatchProactiveRequest(service,method,input,caller){
  if(!PROACTIVE_HTTP_METHODS.includes(method))fail('NOT_FOUND','Unsupported Proactive API method',404);
  exact(input,method==='state'?['projectId']:[...common,...extras[method]]);
  return service[method](input,caller);
}

/** Durable coordination only. T3 remains the sole execution/provider owner.
 * authorize/authenticateEvent receive opaque private callers, never JSON actors.
 * No HTTP listener or network credential handling is created by this module.
 */
export function createProactiveService({store,t3,authorize,authenticateEvent,clock=Date.now}){
  let closed=false,suspended=false,timer=null,ticking=null,started=false,starting=null,closing=null;const pending=new Set();
  const get=(i,s=store.read())=>record(s,'recipe',i.recipeId,i.projectId);
  const trace=(s,r,action,data={})=>{changed(r);append(s,'transition',{recipeId:r.id,versionId:r.versionId,action,at:clock(),...data},r.projectId);};
  function inbox(s,r,code,o=null){
    const prior=records(s,'inbox',r.projectId).find(x=>x.recipeId===r.id&&x.occurrenceId===(o?.id??null)&&x.code===code&&x.status==='open');
    if(prior)return prior;
    return append(s,'inbox',{recipeId:r.id,versionId:o?.versionId??r.versionId,occurrenceId:o?.id??null,code,status:'open',at:clock(),automaticRetry:false},r.projectId);
  }
  function track(p){pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}
  function ensureOpen(){if(closed)fail('CLOSED','Proactive service is closed',409);}
  async function actor(method,input,caller){
    if(typeof authorize!=='function')fail('OWNER_AUTH_UNAVAILABLE','Private Owner authorization is not configured',409);
    const a=await authorize({service:'proactive',action:method,projectId:input.projectId,recipeId:input.recipeId??null,expectedRevision:input.expectedRevision??null,definitionDigest:method==='create'||method==='revise'?digest(Object.fromEntries(definitionKeys.map(k=>[k,input[k]]))):null},caller);
    if(a?.kind!=='human'||a.role!=='owner'||typeof a.subject!=='string'||!a.subject.trim())fail('OWNER_REQUIRED','Authenticated Owner action is required',403);
    return {kind:'human',role:'owner',subject:a.subject};
  }
  async function command(method,input,caller,fn){
    ensureOpen();if(suspended)fail('RESTORE_BUSY','Proactive work is suspended during metadata restore',409);exact(input,[...common,...extras[method]]);input=structuredClone(input);
    boundedText(input.operationId,'operationId',200);const who=await actor(method,input,caller),fingerprint=digest({service:'proactive',method,input});
    return store.transaction(async s=>{
      ensureOpen();if(suspended)fail('RESTORE_BUSY','Proactive work is suspended during metadata restore',409);
      find(s,'projects',input.projectId);
      const prior=s.receipts.find(x=>x.operationId===input.operationId);
      if(prior){if(prior.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation belongs to another command',409);return prior.result;}
      const r=method==='create'?null:get(input,s);if(r)revision(r,input.expectedRevision);
      const result=await fn(s,r,input,who);
      s.receipts.push({operationId:input.operationId,type:'proactive.command',method,fingerprint,result:structuredClone(result),actor:who});return result;
    });
  }
  function invalidate(s,r,reason){
    r.status='needs_approval';r.grant=null;r.nextDue=null;trace(s,r,'invalidated',{reason});inbox(s,r,reason);
    for(const o of records(s,'occurrence',r.projectId).filter(o=>o.recipeId===r.id&&active(o))){
      o.stopRequested=reason;
      if(o.dispatchedAt===undefined){o.status='cancelled';o.held=false;changed(o);}else inbox(s,r,reason,o);
    }
  }
  function newVersion(s,r,i,who){
    const d=definition(s,i,clock),v=append(s,'version',{recipeId:r.id,number:(currentVersionSafe(s,r)?.number??0)+1,definition:d,digest:digest(d),createdBy:who,at:clock()},r.projectId);
    r.versionId=v.id;r.grant=null;r.nextDue=null;r.status='draft';trace(s,r,'version_saved');return r;
  }
  const currentVersionSafe=(s,r)=>r.versionId?currentVersion(s,r):null;
  function occurrence(s,r,key,scheduledAt,kind){
    const prior=records(s,'occurrence',r.projectId).find(o=>o.recipeId===r.id&&o.key===key);
    if(prior)return prior;
    const o=append(s,'occurrence',{recipeId:r.id,versionId:r.versionId,grantId:r.grant?.id??null,key,kind,scheduledAt,status:'scheduled',held:false,taskId:null,botId:null,runId:null,at:clock()},r.projectId);
    o.operationId=`proactive:${o.id}`;trace(s,r,'scheduled',{occurrenceId:o.id});return o;
  }
  async function stopOwned(id,projectId){
    const target=await store.transaction(s=>{
      const o=record(s,'occurrence',id,projectId);if(!o.held||!o.stopRequested||o.stopRequest)return null;
      let run;try{run=ownedRun(s,o);}catch(e){inbox(s,get({projectId,recipeId:o.recipeId},s),e.code,o);return null;}
      if(!run)return null;
      if(terminal.has(run.status)||run.status==='stopped'){o.status=run.status;o.held=false;changed(o);return null;}
      o.stopRequest={runId:run.id,status:'submitting',at:clock()};changed(o);return {runId:run.id};
    });
    if(!target)return;
    let error;try{await t3.stop(target.runId);}catch(e){error=e.code??'STOP_UNKNOWN';}
    await store.transaction(s=>{const o=record(s,'occurrence',id,projectId);o.stopRequest.status=error?'unknown':'accepted';changed(o);if(error)inbox(s,get({projectId,recipeId:o.recipeId},s),error,o);});
  }
  async function reconcileOccurrence(id,projectId,{poll=true}={}){
    let o=record(store.read(),'occurrence',id,projectId),observed,error;
    if(o.dispatchedAt===undefined||o.deliveryId&&!o.held)return o;
    try{observed=ownedRun(store.read(),o);if(observed&&poll)await t3.reconcile(observed.id);}catch(e){error=e.code??'RECONCILE_UNKNOWN';}
    return store.transaction(s=>{
      const o=record(s,'occurrence',id,projectId),r=get({recipeId:o.recipeId,projectId},s);
      let run;try{run=ownedRun(s,o);}catch(e){error=e.code??'RUN_OWNERSHIP';}
      if(!run||error){o.status='unknown';o.held=true;inbox(s,r,error??'SUBMISSION_UNKNOWN',o);changed(o);return o;}
      o.runId=run.id;o.observedStatus=run.status;
      if(terminal.has(run.status)||run.status==='stopped'){
        o.status='delivered';o.outcome=run.status;o.held=false;
        if(!o.deliveryId){const delivery=append(s,'delivery',{recipeId:r.id,versionId:o.versionId,occurrenceId:o.id,operationId:o.operationId,runId:run.id,outcome:run.status,artifactIds:run.artifactIds??[],reportedUsage:run.reportedUsage??null,reportedCost:run.reportedCost??null,at:clock(),acceptance:'not implied by completion'},projectId);o.deliveryId=delivery.id;}
        if(run.status!=='completed')inbox(s,r,'RUN_NOT_COMPLETED',o);
      }else if(['submitting','unknown','disconnected'].includes(run.status)){o.status='unknown';inbox(s,r,'OUTCOME_UNKNOWN',o);}else o.status='dispatched';
      changed(o);return o;
    });
  }
  async function dispatch(id,projectId){
    const reservation=await store.transaction(s=>{
      const o=record(s,'occurrence',id,projectId),r=get({recipeId:o.recipeId,projectId},s);
      if(o.status!=='scheduled'||closed||suspended)return null;
      try{
        const v=checkEnvelope(s,r,clock);if(o.versionId!==v.id||o.grantId!==r.grant.id)fail('STALE_TRIGGER','Trigger grant is stale',409);
        if(t3?.proactiveContextVersion!==1||['startRun','stop','reconcile'].some(k=>typeof t3?.[k]!=='function'))fail('PROACTIVE_CONTEXT_UNSUPPORTED','T3 must validate, persist and prompt proactive context version 1',409);
        checkBudget(s,r,v);available(s,projectId);const task=taskFor(s,r,v);
        if(t3.proactiveEnforcementVersion!==1||typeof t3.qualifyProactive!=='function')fail('NATIVE_ENFORCEMENT_UNQUALIFIED','Selected runtime has no qualified native action enforcement',409);
        const qualificationInput={projectId,taskId:task.id,proactiveContext:{recipeId:r.id}};
        const proof=validateProactiveEnforcement(s,qualificationInput,t3.qualifyProactive(s,proactiveEnforcementRequest(s,qualificationInput,clock)),clock);
        o.taskId=task.id;o.botId=task.botId??null;o.status='claimed';o.held=true;o.deadlineAt=Math.min(clock()+v.definition.budget.maxRunMs,v.definition.expiresAt);
        o.context={version:1,recipeId:r.id,versionId:v.id,envelopeDigest:v.digest,grantId:r.grant.id,occurrenceId:o.id,taskId:task.id,taskSignature:v.definition.taskSignatures[task.id],triggerKey:o.key,instructions:v.definition.instructions,scope:v.definition.scope,budget:v.definition.budget,expiresAt:v.definition.expiresAt,deadlineAt:o.deadlineAt,enforcement:proof};
        trace(s,r,'claimed',{occurrenceId:o.id});changed(o);return structuredClone(o);
      }catch(e){o.status='inbox';o.held=false;o.error=e.code??'ENVELOPE_REJECTED';inbox(s,r,o.error,o);changed(o);return null;}
    });
    if(!reservation)return;
    // Separate durable claim and submission boundaries. Recheck immediately
    // before the one and only call; T3 must repeat the authoritative validation.
    const input=await store.transaction(s=>{
      const o=record(s,'occurrence',id,projectId),r=get({recipeId:o.recipeId,projectId},s);
      if(o.status!=='claimed'||o.stopRequested||closed||suspended)return null;
      try{checkEnvelope(s,r,clock);checkBudget(s,r,currentVersion(s,r));available(s,projectId,o.id);const input={projectId,taskId:o.taskId,proactiveContext:o.context};validateProactiveEnforcement(s,input,t3.qualifyProactive(s,proactiveEnforcementRequest(s,input,clock)),clock);}catch(e){o.status='inbox';o.held=false;o.error=e.code??'NATIVE_ENFORCEMENT_UNQUALIFIED';inbox(s,r,o.error,o);changed(o);return null;}
      o.status='dispatching';o.dispatchedAt=clock();changed(o);trace(s,r,'dispatching',{occurrenceId:o.id});
      return {projectId,taskId:o.taskId,conversationId:null,operationId:o.operationId,proactiveContext:structuredClone(o.context)};
    });
    if(!input)return;
    try{await t3.startRun(input);}catch(e){await store.transaction(s=>{const o=record(s,'occurrence',id,projectId);o.error=e.code??'SUBMISSION_UNKNOWN';inbox(s,get({recipeId:o.recipeId,projectId},s),o.error,o);});}
    // Never trust the response's run ID. The canonical durable run is evidence.
    await reconcileOccurrence(id,projectId,{poll:false});
    await stopOwned(id,projectId);
  }
  async function tick(){
    ensureOpen();if(suspended)return;if(ticking)return ticking;
    // Do not turn an idle scheduler heartbeat into a canonical data revision.
    // It otherwise continually invalidates Owner CAS and metadata restore.
    const snapshot=store.read();
    const needsWork=snapshot.events.some(e=>e.type==='proactive.occurrence'&&['scheduled','claimed','dispatching','dispatched','unknown'].includes(e.status))||snapshot.events.some(r=>{
      if(r.type!=='proactive.recipe'||r.status!=='enabled')return false;
      try{checkEnvelope(snapshot,r,clock);}catch{return true;}
      return r.nextDue&&clock()>=r.nextDue.at;
    });
    if(!needsWork)return;
    const submissions=[];
    ticking=(async()=>{
      await store.transaction(s=>{
        for(const r of s.events.filter(e=>e.type==='proactive.recipe'&&e.status==='enabled')){
          try{checkEnvelope(s,r,clock);}catch(e){invalidate(s,r,e.code??'ENVELOPE_REJECTED');continue;}
          const d=currentVersion(s,r).definition;
          if(d.trigger.kind==='schedule'&&r.nextDue&&clock()>=r.nextDue.at){
            const due=r.nextDue,o=occurrence(s,r,`schedule:${r.versionId}:${due.key}`,due.at,'schedule');
            if(clock()-due.at>d.trigger.maxLatenessMs){o.status='inbox';inbox(s,r,'MISSED_SCHEDULE',o);changed(o);}
            r.nextDue=nextSchedule(d.trigger,clock(),due.key);trace(s,r,'schedule_advanced');
          }
        }
        for(const o of s.events.filter(e=>e.type==='proactive.occurrence'&&active(e)&&clock()>=e.deadlineAt)){
          o.stopRequested='RUN_DEADLINE';changed(o);inbox(s,get({recipeId:o.recipeId,projectId:o.projectId},s),'RUN_DEADLINE',o);
        }
        for(const o of s.events.filter(e=>e.type==='proactive.occurrence'&&active(e)&&e.context)){
          const r=get({recipeId:o.recipeId,projectId:o.projectId},s);if(r.status!=='enabled'||!r.grant)continue;
          const input={projectId:o.projectId,taskId:o.taskId,proactiveContext:o.context};
          try{validateProactiveEnforcement(s,input,t3.qualifyProactive?.(s,proactiveEnforcementRequest(s,input,clock)),clock);}
          catch(e){invalidate(s,r,e.code??'NATIVE_ENFORCEMENT_UNQUALIFIED');}
        }
      });
      for(const o of store.read().events.filter(e=>e.type==='proactive.occurrence'&&['scheduled','claimed','dispatching','dispatched','unknown'].includes(e.status))){
        if(closed)break;
        if(o.status==='scheduled')submissions.push(track(dispatch(o.id,o.projectId)));
        else if(o.dispatchedAt!==undefined){await stopOwned(o.id,o.projectId);await reconcileOccurrence(o.id,o.projectId);}
      }
    })().finally(()=>{ticking=null;});
    await ticking;
    // Waiting for a start response must not hold the scheduler's tick lock.
    // The next tick can enforce a deadline/Stop on an observed pending run.
    await Promise.all(submissions);
  }
  const api={
    state(input){
      exact(input,['projectId']);const s=store.read();find(s,'projects',input.projectId);
      return {recipes:records(s,'recipe',input.projectId).map(r=>({...r,version:currentVersion(s,r),usage:usage(s,r.id,r.projectId)})),occurrences:records(s,'occurrence',input.projectId),deliveries:records(s,'delivery',input.projectId),inbox:records(s,'inbox',input.projectId),capabilities:{proactiveContextVersion:t3?.proactiveContextVersion??null,proactiveEnforcementVersion:t3?.proactiveEnforcementVersion??null,executionSupported:t3?.proactiveContextVersion===1&&t3?.proactiveEnforcementVersion===1&&['startRun','stop','reconcile','qualifyProactive'].every(k=>typeof t3?.[k]==='function'),scheduler:'internal, daily/weekday IANA time',scopeEnforcement:'qualified native + normalized action guards and existing supervised governance; prompt is not a sandbox'},qualification:{runtimeEnforcement:'per-trigger evidence required; capability version alone is not qualification',liveProvider:'NOT_RUN',mobile:'NOT_RUN',homeUat:'HOME_UAT_NOT_RUN'}};
    },
    create:(i,c)=>command('create',i,c,(s,_r,i,who)=>{const r=append(s,'recipe',{name:i.name,versionId:null,status:'draft',grant:null,nextDue:null},i.projectId);return newVersion(s,r,i,who);}),
    revise:(i,c)=>command('revise',i,c,(s,r,i,who)=>{if(records(s,'occurrence',r.projectId).some(o=>o.recipeId===r.id&&active(o)))fail('RECONCILE_REQUIRED','Stop and reconcile owned or unknown work before editing',409);r.name=i.name;return newVersion(s,r,i,who);}),
    approve:(i,c)=>command('approve',i,c,(s,r,_i,who)=>{
      if(records(s,'occurrence',r.projectId).some(o=>o.recipeId===r.id&&active(o)))fail('RECONCILE_REQUIRED','Reconcile owned work before approval',409);
      // Validate fresh state through the same envelope checker using a tentative
      // grant that is committed only with this authenticated Owner transaction.
      const v=currentVersion(s,r);r.grant={id:randomUUID(),versionId:v.id,digest:v.digest,actor:who,at:clock()};r.status='enabled';checkEnvelope(s,r,clock);r.status='approved';trace(s,r,'approved');return r;
    }),
    enable:(i,c)=>command('enable',i,c,(s,r)=>{
      if(r.status!=='approved')fail('APPROVAL_REQUIRED','Approve the exact version before enabling',409);
      if(records(s,'occurrence',r.projectId).some(o=>o.recipeId===r.id&&active(o)))fail('RECONCILE_REQUIRED','Resolve owned work first',409);
      r.status='enabled';const v=checkEnvelope(s,r,clock);checkBudget(s,r,v);r.nextDue=v.definition.trigger.kind==='schedule'?nextSchedule(v.definition.trigger,clock()):null;trace(s,r,'enabled');return r;
    }),
    async pause(i,c){const result=await command('pause',i,c,(s,r)=>{invalidate(s,r,'OWNER_PAUSED');r.status='paused';trace(s,r,'paused');return r;});await stopRecipe(result);return get(i);},
    async revoke(i,c){const result=await command('revoke',i,c,(s,r)=>{invalidate(s,r,'OWNER_REVOKED');r.status='revoked';trace(s,r,'revoked');return r;});await stopRecipe(result);return get(i);},
    async reconcile(i,c){const result=await command('reconcile',i,c,(s,r,i)=>{const o=record(s,'occurrence',i.occurrenceId,i.projectId);if(o.recipeId!==r.id)fail('SCOPE','Occurrence belongs to another recipe',409);trace(s,r,'reconcile_requested',{occurrenceId:o.id});return r;});await reconcileOccurrence(i.occurrenceId,i.projectId);await stopRecipe(result);return get(i);},
    resolve:(i,c)=>command('resolve',i,c,(s,r,i,who)=>{
      const item=record(s,'inbox',i.inboxId,i.projectId);if(item.recipeId!==r.id)fail('SCOPE','Inbox belongs to another recipe',409);
      if(item.occurrenceId&&active(record(s,'occurrence',item.occurrenceId,i.projectId)))fail('RECONCILE_REQUIRED','Unknown or active effects cannot be dismissed or retried',409);
      item.status='resolved';item.resolution={note:boundedText(i.note,'note',2000),actor:who,at:clock(),retryAuthorized:false};changed(item);trace(s,r,'inbox_resolved',{inboxId:item.id});return r;
    }),
    // INTERNAL seam only. authenticateEvent must verify an existing transport's
    // signature/session/replay evidence and bind source/subject/project/type.
    async ingestEvent(input,caller){
      ensureOpen();if(suspended)fail('RESTORE_BUSY','Proactive work is suspended during metadata restore',409);exact(input,['projectId','recipeId','eventId','occurredAt']);input=structuredClone(input);boundedText(input.eventId,'eventId',200);integer(input.occurredAt,'occurredAt',0,Number.MAX_SAFE_INTEGER);
      const auth=await authenticateEvent?.({projectId:input.projectId,recipeId:input.recipeId,eventId:input.eventId,occurredAt:input.occurredAt},caller);
      if(!auth||auth.projectId!==input.projectId||!['source','subject','eventType'].every(k=>typeof auth[k]==='string'&&auth[k]))fail('EVENT_AUTH_REQUIRED','Authenticated event transport identity required',403);
      const result=await store.transaction(s=>{
        ensureOpen();
        const r=get(input,s),v=currentVersion(s,r),t=v.definition.trigger;
        const key=`event:${digest({source:auth.source,subject:auth.subject,eventId:input.eventId})}`;
        const prior=records(s,'occurrence',r.projectId).find(o=>o.recipeId===r.id&&o.key===key);
        const fingerprint=digest({input,auth:{projectId:auth.projectId,source:auth.source,subject:auth.subject,eventType:auth.eventType}});
        if(prior){if(prior.eventFingerprint!==fingerprint)fail('EVENT_REUSE','Event identity was reused with a different contract',409);return prior;}
        const o=occurrence(s,r,key,input.occurredAt,'event');o.eventFingerprint=fingerprint;
        if(t.kind!=='event'||t.source!==auth.source||t.subject!==auth.subject||t.eventType!==auth.eventType||clock()-input.occurredAt>t.maxAgeMs||input.occurredAt>clock()+5000){o.status='inbox';inbox(s,r,'EVENT_OUTSIDE_ENVELOPE',o);changed(o);}
        return o;
      });
      if(result.status==='scheduled')await track(dispatch(result.id,input.projectId));
      return record(store.read(),'occurrence',result.id,input.projectId);
    },
    tick:()=>track(tick()),
    async recover(){
      ensureOpen();await store.transaction(s=>{
        for(const r of s.events.filter(e=>e.type==='proactive.recipe'&&(e.grant||e.status==='enabled')))invalidate(s,r,'RUNTIME_RESTARTED');
        for(const o of s.events.filter(e=>e.type==='proactive.occurrence'&&['scheduled','claimed'].includes(e.status))){o.status='cancelled';o.held=false;changed(o);inbox(s,get({recipeId:o.recipeId,projectId:o.projectId},s),'RUNTIME_RESTARTED',o);}
      });
      for(const o of store.read().events.filter(e=>e.type==='proactive.occurrence'&&active(e))){await stopOwned(o.id,o.projectId);await reconcileOccurrence(o.id,o.projectId);}
    },
    async start({intervalMs=1000}={}){
      ensureOpen();integer(intervalMs,'intervalMs',50,60000);if(started)return;if(starting)return starting;
      starting=(async()=>{await api.recover();if(closed)return;started=true;timer=setInterval(()=>{track(tick()).catch(()=>{});},intervalMs);timer.unref?.();})();
      try{await starting;}finally{starting=null;}
    },
    async suspendForRestore(){suspended=true;await Promise.allSettled([...pending]);},
    async afterRestore(){await api.recover();},
    cancelRestore(){suspended=false;},
    close(){
      if(closing)return closing;closed=true;clearInterval(timer);
      closing=(async()=>{
        await store.transaction(s=>{for(const r of s.events.filter(e=>e.type==='proactive.recipe'&&e.grant))invalidate(s,r,'RUNTIME_CLOSED');});
        await Promise.allSettled([...pending]);
        for(const o of store.read().events.filter(e=>e.type==='proactive.occurrence'&&active(e))){await stopOwned(o.id,o.projectId);await reconcileOccurrence(o.id,o.projectId);}
        await Promise.allSettled([...pending]);
      })();return closing;
    },
  };
  async function stopRecipe(r){for(const o of records(store.read(),'occurrence',r.projectId).filter(o=>o.recipeId===r.id&&active(o))){await stopOwned(o.id,o.projectId);await reconcileOccurrence(o.id,o.projectId,{poll:false});}}
  // Track externally initiated work so close waits for the exact owned attempts.
  for(const method of [...PROACTIVE_HTTP_METHODS.filter(m=>m!=='state'),'ingestEvent','start','recover']){const fn=api[method];api[method]=(...args)=>track(fn(...args));}
  return api;
}
