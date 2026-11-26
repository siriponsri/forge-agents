import {MODES,terminal,rows,row,append,exact,allocation,validateGraph,rolePin,routeDecision,rowWorkspace,runFor,resultRef,find,fail,changed,revision,digest,boundedText,integer,taskSignature,planSignature} from './contracts.mjs';
import {validateStrategyContext} from './context.mjs';
import {inspectWorkspace} from '../workspaces/git.mjs';

const fields={state:['projectId'],create:['projectId','operationId','mode','objective','stages','limits','rubric','requiredCapabilities','supervisor'],advance:['projectId','operationId','strategyId','expectedRevision','stageId'],reconcile:['projectId','operationId','strategyId','expectedRevision'],stop:['projectId','operationId','strategyId','expectedRevision'],select:['projectId','operationId','strategyId','expectedRevision','stageId','reason','rubricEvidence'],feedback:['projectId','operationId','strategyId','expectedRevision','stageId','text']};
export const STRATEGY_METHODS=Object.freeze(Object.keys(fields));
export function dispatchStrategyRequest(service,method,input,caller){if(!STRATEGY_METHODS.includes(method))fail('NOT_FOUND','Unknown strategy action',404);exact(input,fields[method]);return service[method](input,caller);}

/** Bounded Owner-driven scheduling over canonical Workspaces/sessionRoute.
 * The service owns no provider turn, credential, tool or second task store. */
export function createStrategyService({store,workspaces,sessionRoute,sessionRoles,t3,dataDir,authorize,clock=Date.now}){
  let closed=false,restoring=false;const pending=new Set(),timers=new Map();
  function owner(input,caller){const a=authorize?.({action:'strategy',projectId:input.projectId,strategyId:input.strategyId??null},caller);if(a?.then||a?.kind!=='human'||a.role!=='owner')fail('STRATEGY_OWNER_REQUIRED','Authenticated local Owner required',403);}
  function get(s,i){return row(s,'strategy',i.strategyId,i.projectId);}
  async function operation(method,raw,caller,fn){
    exact(raw,fields[method]);const i=structuredClone(raw);owner(i,caller);if(closed)fail('SHUTTING_DOWN','Strategies are closed',409);if(restoring)fail('RESTORE_IN_PROGRESS','Strategies are draining for restore',409);boundedText(i.operationId,'operationId',200);
    const fingerprint=digest({method,input:i});let dispatch=false;
    const op=await store.transaction(s=>{owner(i,caller);find(s,'projects',i.projectId);const old=rows(s,'operation').find(x=>x.operationId===i.operationId);if(old){if(old.fingerprint!==fingerprint)fail('OPERATION_REUSE','Operation ID belongs to different strategy work',409);return old;}
      if(s.receipts.some(r=>r.operationId===i.operationId)||s.runs.some(r=>r.operationId===i.operationId)||s.events.some(r=>r.operationId===i.operationId))fail('OPERATION_REUSE','Operation identity is already consumed',409);
      if(restoring||closed)fail('RESTORE_IN_PROGRESS','Strategies are draining',409);dispatch=true;return append(s,'operation',{method,operationId:i.operationId,fingerprint,input:i,status:'pending'},i.projectId);});
    if(!dispatch){if(op.status==='failed')fail(op.errorCode??'STRATEGY_FAILED','The retained operation failed; inspect current state',409);return op.result??op;}
    try{const result=await fn(i);return await store.transaction(s=>{const o=row(s,'operation',op.id,i.projectId);o.status='completed';o.result=result;changed(o);s.receipts.push({type:'strategy.receipt',operationId:i.operationId,fingerprint,result});return result;});}
    catch(e){await store.transaction(s=>{const o=row(s,'operation',op.id,i.projectId);o.status=e.code?'failed':'unknown';o.errorCode=e.code??'STRATEGY_OUTCOME_UNKNOWN';changed(o);});throw e;}
  }
  function currentCost(s,g){const rs=s.runs.filter(r=>r.strategyContext?.strategyId===g.id),unknown=rs.filter(r=>!r.reportedCost).map(r=>r.id),totals={};for(const c of rows(s,'claim',g.projectId).filter(c=>c.context.strategyId===g.id&&!runFor(s,c)))unknown.push(`unobserved-claim:${c.id}`);for(const r of rs){const c=r.reportedCost;if(c&&Number.isFinite(c.amount)&&c.amount>=0&&c.currency&&c.source)totals[c.currency]=(totals[c.currency]??0)+c.amount;else if(c)unknown.push(r.id);}return {knownSubtotals:totals,unknownRunIds:unknown,actualTotal:rs.length&&!unknown.length?totals:null};}
  function limits(s,g){
    if(g.stopRequested||g.restoreReviewRequired||clock()>=g.deadlineAt)fail('STRATEGY_INACTIVE','Stopped, expired or restored strategy cannot dispatch',409);
    const cs=rows(s,'claim',g.projectId).filter(c=>c.context.strategyId===g.id);
    if(cs.length>=g.limits.maxAttempts||cs.filter(c=>!terminal.has(runFor(s,c)?.status)).length>=g.limits.maxConcurrent)fail('STRATEGY_LIMIT','Total/concurrent allocation limit reached',409);
    const cost=currentCost(s,g),p=g.limits.reportedCost;
    if(p.unknown==='block'&&cost.unknownRunIds.length)fail('STRATEGY_COST_UNKNOWN','Reconcile unknown reported cost before another allocation',409);
    if(p.maxAmount!==null&&(Object.keys(cost.knownSubtotals).some(c=>c!==p.currency)||(cost.knownSubtotals[p.currency]??0)>=p.maxAmount))fail('STRATEGY_COST_LIMIT','Reported cost cap/currency blocks continuation',409);
  }
  function limitDefinition(i){const l=i??{};exact(l,['maxAttempts','maxConcurrent','maxMs','reportedCost']);const cost=l.reportedCost??{unknown:'block',maxAmount:null,currency:null};exact(cost,['unknown','maxAmount','currency']);if(!['allow','block'].includes(cost.unknown)||cost.maxAmount!==null&&(!Number.isFinite(cost.maxAmount)||cost.maxAmount<=0||typeof cost.currency!=='string'||!cost.currency))fail('STRATEGY_INPUT','Choose explicit unknown-cost handling and a valid reported cap');return {maxAttempts:integer(l.maxAttempts??8,'maxAttempts',1,64),maxConcurrent:integer(l.maxConcurrent??2,'maxConcurrent',1,16),maxMs:integer(l.maxMs??300000,'maxMs',10000,900000),reportedCost:cost};}
  function view(s,g){
    const stages=g.stages.map(a=>{const c=a.claimId&&row(s,'claim',a.claimId,g.projectId),ref=c&&resultRef(s,c);return {...a,result:ref??null,eligible:!g.stopRequested&&!g.restoreReviewRequired&&clock()<g.deadlineAt&&a.status==='ready'&&a.dependsOn.every(id=>{const d=g.stages.find(x=>x.id===id);const ref=d?.claimId&&resultRef(s,row(s,'claim',d.claimId,g.projectId));return ref?.status==='completed'&&ref.checkStatus!=='failed'&&(g.mode!=='generator-verifier'||ref.checkStatus==='passed');})};});
    const joined=stages.filter(x=>x.result&&terminal.has(x.result.status)).map(x=>({stageId:x.id,...x.result}));
    const parent=stages[0]?.result,commands=g.mode==='supervisor'&&parent?s.events.filter(e=>e.type==='session-role.prompt'&&e.parentRunId===parent.runId&&e.context?.parentAttemptId===parent.attemptId):[];
    const unresolvedChildren=commands.some(c=>{const r=s.runs.find(r=>r.operationId===c.dispatchInput.operationId);return !r?!['not-dispatched','stopped'].includes(c.status):!terminal.has(r.status);});
    const all=stages.every(a=>a.result&&terminal.has(a.result.status))&&!unresolvedChildren;
    return {...g,stages,join:joined,cost:currentCost(s,g),status:g.stopRequested?g.parentStopPending||g.childStopPending||unresolvedChildren||stages.some(a=>a.claimId&&!terminal.has(a.result?.status))?'stopping':'stopped':g.status==='selected'?'selected':all?stages.every(a=>a.result.status==='completed'&&a.result.checkStatus!=='failed')?'awaiting_owner':'blocked':g.status,qualifications:{liveProvider:'NOT_RUN',homeUat:'NOT_RUN',qaAuthority:false,automaticMerge:false}};
  }
  function observedSupervisor(s,g,caller){
    if(g.mode!=='supervisor')return {};
    const c=g.stages[0].claimId&&row(s,'claim',g.stages[0].claimId,g.projectId),parent=c&&runFor(s,c);
    const commands=parent&&sessionRoles?.state?sessionRoles.state({projectId:g.projectId},caller).commands.filter(x=>x.parentRunId===parent.id&&x.context?.parentAttemptId===parent.attemptId):[];
    const observed=s.events.filter(e=>e.type==='agui'&&e.runId===parent?.id&&['TEXT_MESSAGE_START','TEXT_MESSAGE_CONTENT','TEXT_MESSAGE_END','RUN_FINISHED','RUN_ERROR'].includes(e.event?.type)).slice(-100).map(e=>({id:e.id,runId:e.runId,event:e.event}));
    return {children:commands,supervisorResult:{runId:parent?.id??null,attemptId:parent?.attemptId??null,observations:observed,narrativeIsQaAuthority:false}};
  }
  async function synchronize(id,p){return store.transaction(s=>{const g=row(s,'strategy',id,p);for(const a of g.stages){if(!a.claimId)continue;const c=row(s,'claim',a.claimId,p);let r;try{r=runFor(s,c);}catch{c.status='unknown';a.status='unknown';continue;}if(r){c.runId=r.id;c.attemptId=r.attemptId;c.status=terminal.has(r.status)?r.status:r.status==='unknown'?'unknown':'running';a.status=c.status;}else{c.status='unknown';a.status='unknown';}changed(c);}changed(g);const observed=view(s,g);g.status=observed.status;return observed;});}
  function schedule(g,caller){if(restoring||closed||timers.has(g.id))return;const timer=setTimeout(()=>{timers.delete(g.id);const p=stopOwned(g.id,g.projectId,caller,'deadline');pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));},Math.max(1,g.deadlineAt-clock()));timer.unref?.();timers.set(g.id,timer);}
  async function stopOwned(id,p,caller,reason){
    const g=await store.transaction(s=>{const g=row(s,'strategy',id,p);g.stopRequested=true;g.stopReason=reason;for(const a of g.stages)if(a.status==='ready')a.status='stopped';changed(g);return g;});
    if(g.mode==='supervisor'&&g.intentId){try{await sessionRoute.cancel({projectId:p,intentId:g.intentId,operationId:g.parentOperationId},caller);await store.transaction(s=>{row(s,'strategy',id,p).parentStopPending=false;});}catch{await store.transaction(s=>{const x=row(s,'strategy',id,p);x.parentStopPending=true;changed(x);});}}
    for(const a of g.stages.filter(a=>a.claimId&&g.mode!=='supervisor')){
      try{const w=rowWorkspace(store.read(),p,a.workspaceId);await workspaces.stop({projectId:p,workspaceId:w.id,expectedRevision:w.revision,operationId:`strategy-stop:${a.claimId}:${w.runId??'pending'}:${w.revision}`},caller);}
      catch{await store.transaction(s=>{const c=row(s,'claim',a.claimId,p);c.status='unknown';c.stopPending=true;changed(c);});}
    }
    if(g.mode==='supervisor'){
      await store.transaction(s=>{row(s,'strategy',id,p).childStopPending=false;});
      const parentClaim=g.stages[0].claimId&&row(store.read(),'claim',g.stages[0].claimId,p),parent=parentClaim&&runFor(store.read(),parentClaim);
      if(parent)for(const command of store.read().events.filter(e=>e.type==='session-role.prompt'&&e.projectId===p&&e.parentRunId===parent.id&&e.context?.parentAttemptId===parent.attemptId)){
        try{if(!sessionRoles?.stop)fail('STRATEGY_INTEGRATION_REQUIRED','Canonical child Stop service required',409);await sessionRoles.stop({projectId:p,commandId:command.id},caller);}
        catch{await store.transaction(s=>{const x=row(s,'strategy',id,p);x.childStopPending=true;changed(x);});}
      }
    }
    clearTimeout(timers.get(id));timers.delete(id);return synchronize(id,p);
  }
  const api={
    state(i,caller){exact(i,fields.state);owner(i,caller);const s=store.read();find(s,'projects',i.projectId);return {projectId:i.projectId,modes:MODES,strategies:rows(s,'strategy',i.projectId).map(g=>({...view(s,g),...observedSupervisor(s,g,caller),feedback:rows(s,'feedback',i.projectId).filter(f=>f.strategyId===g.id)})),operations:rows(s,'operation',i.projectId),capabilities:{workspace:workspaces?.strategyContextVersion===1,supervisor:!!sessionRoute,ownerDriven:true}};},
    create(i,caller){return operation('create',i,caller,async i=>{
      if(!MODES.includes(i.mode))fail('STRATEGY_INPUT','Choose one of six strategies');
      if(i.mode==='supervisor'&&(!sessionRoute?.createIntent||!sessionRoute.start||!sessionRoute.cancel||!sessionRoles?.state||!sessionRoles.stop))fail('STRATEGY_INTEGRATION_REQUIRED','Canonical sessionRoute and session-role owners are required',409);
      const g=await store.transaction(s=>{
        owner(i,caller);
        const limits=limitDefinition(i.limits),objective=boundedText(i.objective,'objective',4000);let stages;
        if(i.mode==='supervisor'){
          exact(i.supervisor,['taskId','conversationId','children']);const task=find(s,'tasks',i.supervisor.taskId,i.projectId),plan=find(s,'plans',task.planId,i.projectId),role=rolePin(s,i.projectId,i.supervisor.conversationId,task.botId);
          if(!plan.approved||role.role!=='orchestrator'||!['ready','backlog'].includes(task.status)||!Array.isArray(i.supervisor.children)||!i.supervisor.children.length||i.supervisor.children.length>8)fail('STRATEGY_SUPERVISOR','Approve an existing orchestrator task and exact child set first',409);
          for(const child of i.supervisor.children){exact(child,['conversationId','botId']);rolePin(s,i.projectId,child.conversationId,child.botId);}
          stages=[{id:'parent',taskId:task.id,conversationId:i.supervisor.conversationId,botId:task.botId,role,dependsOn:[],purpose:'work',workspaceId:null,status:'ready',claimId:null,taskSignature:taskSignature(task),planSignature:planSignature(plan),profileDigest:digest(find(s,'projects',i.projectId).profile)}];
          if(i.stages?.length||limits.maxAttempts<i.supervisor.children.length+1)fail('STRATEGY_LIMIT','Supervisor total cap must include parent and approved children',409);
        }else{
          if(i.supervisor!==undefined||!Array.isArray(i.stages)||!i.stages.length||i.stages.length>24)fail('STRATEGY_INPUT','Choose 1..24 explicit existing allocations');stages=i.stages.map(a=>allocation(s,i.projectId,a));validateGraph(stages);
          if(new Set(stages.map(a=>a.workspaceId)).size!==stages.length||new Set(stages.map(a=>a.taskId)).size!==stages.length)fail('STRATEGY_ALLOCATION','Each stage requires a distinct Workspace and canonical task',409);
          if(limits.maxAttempts<stages.length)fail('STRATEGY_LIMIT','Total cap must cover the selected allocations',409);
        }
        const held=rows(s,'strategy',i.projectId).filter(g=>!['stopped','selected','completed'].includes(view(s,g).status));if(held.some(g=>g.stages.some(a=>stages.some(b=>b.taskId===a.taskId||b.workspaceId&&b.workspaceId===a.workspaceId))))fail('STRATEGY_HELD','An existing strategy already holds this allocation',409);
        if(['fan-out-fan-in','independent-candidates','router-specialists'].includes(i.mode)&&stages.some(a=>a.dependsOn.length))fail('STRATEGY_DEPENDENCY','Independent allocations cannot depend on each other');
        if(['fan-out-fan-in','independent-candidates'].includes(i.mode)&&stages.length<2)fail('STRATEGY_INPUT','Select at least two independent allocations');
        if(i.mode==='independent-candidates'&&new Set(stages.map(a=>rowWorkspace(s,i.projectId,a.workspaceId).baseSha)).size!==1)fail('STRATEGY_ALLOCATION','Independent candidates require the same immutable source base',409);
        if(i.mode==='router-specialists'&&(stages.length!==1||stages[0].purpose!=='specialist'))fail('STRATEGY_INPUT','Select exactly one approved specialist allocation');
        if(i.mode==='generator-verifier'){
          const gen=stages.find(a=>a.purpose==='generator'),verify=stages.find(a=>a.purpose==='verifier');
          if(stages.length!==2||!gen||!verify||gen.dependsOn.length||digest(verify.dependsOn)!==digest([gen.id])||gen.botId===verify.botId||!['reviewer','tester'].includes(verify.role.role))fail('STRATEGY_VERIFIER','Choose independent generator and reviewer/tester with one exact dependency',409);
        }
        if(i.mode==='independent-candidates'&&stages.some(a=>a.purpose!=='candidate'))fail('STRATEGY_INPUT','Each independent allocation must be a candidate');
        const rubric=i.rubric??[];if(!Array.isArray(rubric)||rubric.length>12||rubric.some(x=>typeof x!=='string'||!x.trim()||x.length>2000)||i.mode==='independent-candidates'&&!rubric.length)fail('STRATEGY_INPUT','Candidates require an explicit bounded rubric');
        const required=i.requiredCapabilities??[];if(!Array.isArray(required)||required.length>24||new Set(required).size!==required.length||required.some(x=>typeof x!=='string'||x.length>200))fail('STRATEGY_INPUT','Invalid required capabilities');
        const decision=i.mode==='router-specialists'?routeDecision(s,i.projectId,required,stages[0].role,clock()):null;
        return append(s,'strategy',{mode:i.mode,objective,stages,limits,rubric,requiredCapabilities:required,routeDecision:decision,supervisor:i.supervisor??null,status:'ready',stopRequested:false,deadlineAt:clock()+limits.maxMs},i.projectId);
      });
      schedule(g,caller);
      if(g.mode==='supervisor'){
        // createIntent has its own durable once-only operation. An uncertain
        // return never causes a second createIntent or a parent start.
        try{const intent=await sessionRoute.createIntent({projectId:g.projectId,...g.supervisor,operationId:`strategy-intent:${g.id}`,maxMs:g.limits.maxMs},caller);await store.transaction(s=>{const x=row(s,'strategy',g.id,g.projectId);x.intentId=intent.intentId;x.parentOperationId=intent.operationId;changed(x);});}
        catch(e){await store.transaction(s=>{const x=row(s,'strategy',g.id,g.projectId);x.status='needs_setup';x.errorCode=e.code??'STRATEGY_INTENT_UNKNOWN';changed(x);});throw e;}
      }
      return view(store.read(),row(store.read(),'strategy',g.id,g.projectId));
    });},
    advance(i,caller){return operation('advance',i,caller,async i=>{
      const before=get(store.read(),i);revision(before,i.expectedRevision);
      const stage=before.stages.find(a=>a.id===i.stageId);
      for(const id of stage?.dependsOn??[]){
        const dep=before.stages.find(a=>a.id===id),ref=dep?.claimId&&resultRef(store.read(),row(store.read(),'claim',dep.claimId,i.projectId));
        if(ref?.checkStatus==='failed')fail('STRATEGY_DEPENDENCY','Observed dependency checks failed; continuation remains blocked',409);
        if(before.mode==='generator-verifier'&&(!ref||ref.checkStatus!=='passed'))fail('STRATEGY_EVIDENCE','Verifier requires actual checked generator output first',409);
        if(ref?.head&&ref.checkId){if(!dataDir)fail('STRATEGY_INTEGRATION_REQUIRED','Canonical Workspace storage is required for checked dependency handoff',409);const proof=await inspectWorkspace(rowWorkspace(store.read(),i.projectId,dep.workspaceId),dataDir);if(proof.dirty||proof.head!==ref.head)fail('STRATEGY_EVIDENCE','Dependency files changed since the retained check',409);}
      }
      const c=await store.transaction(s=>{
        owner(i,caller);const g=get(s,i);revision(g,i.expectedRevision);limits(s,g);
        if(g.mode!=='supervisor'&&workspaces?.strategyContextVersion!==1)fail('STRATEGY_INTEGRATION_REQUIRED','Canonical Workspace strategy reservation/final hooks are required',409);
        const a=g.stages.find(a=>a.id===i.stageId);if(!a||a.status!=='ready'||a.claimId)fail('STRATEGY_RECONCILE','Stage has a consumed allocation or is unavailable; reconcile it',409);
        const dependencyRefs=a.dependsOn.map(id=>{const dep=g.stages.find(d=>d.id===id),r=dep.claimId&&resultRef(s,row(s,'claim',dep.claimId,g.projectId));if(!r||r.status!=='completed'||r.checkStatus==='failed')fail('STRATEGY_DEPENDENCY','Exact predecessor attempt is incomplete or unknown',409);return {stageId:id,...r};});
        const id=crypto.randomUUID(),context={version:1,strategyId:g.id,stageId:a.id,claimId:id,projectId:g.projectId,taskId:a.taskId,workspaceId:a.workspaceId,operationId:g.mode==='supervisor'?g.parentOperationId:`workspace-run:${a.workspaceId}`,allocationDigest:digest({...a,status:undefined,claimId:undefined}),dependencyRefs,role:a.role};
        if(!context.operationId)fail('STRATEGY_SUPERVISOR','Retained parent intent is unavailable; set up a new allocation',409);
        const c=append(s,'claim',{context,status:'dispatching',stopPending:false},g.projectId);c.id=id;a.claimId=id;a.status='dispatching';g.status='running';changed(g);
        validateStrategyContext(s,{projectId:g.projectId,taskId:a.taskId,operationId:context.operationId,strategyContext:context,...(a.workspaceId?{workspaceContext:{workspaceId:a.workspaceId}}:{sessionContext:s.events.find(e=>e.id===g.intentId)?.context})},{preparing:true,now:clock()});return c;
      });
      const g=get(store.read(),i),a=g.stages.find(a=>a.claimId===c.id);
      try{if(g.mode==='supervisor')await sessionRoute.start({projectId:i.projectId,intentId:g.intentId,operationId:g.parentOperationId},caller);
        else{const w=rowWorkspace(store.read(),i.projectId,a.workspaceId);await workspaces.start({projectId:i.projectId,workspaceId:w.id,expectedRevision:w.revision,operationId:`strategy-dispatch:${c.id}`},caller,{strategyContext:c.context});}}
      catch(e){await store.transaction(s=>{const c=row(s,'claim',a.claimId,i.projectId);c.status='unknown';c.errorCode=e.code??'STRATEGY_OUTCOME_UNKNOWN';changed(c);});}
      const current=get(store.read(),i);if(current.stopRequested)await stopOwned(current.id,current.projectId,caller,'owner');return synchronize(current.id,current.projectId);
    });},
    reconcile(i,caller){return operation('reconcile',i,caller,async i=>{
      const g=get(store.read(),i);revision(g,i.expectedRevision);
      for(const a of g.stages.filter(a=>a.claimId)){
        const c=row(store.read(),'claim',a.claimId,i.projectId);
        try{if(g.mode==='supervisor'){const r=runFor(store.read(),c);if(r)await t3?.reconcile(r.id);}
          else{const w=rowWorkspace(store.read(),i.projectId,a.workspaceId);await workspaces.reconcile({projectId:i.projectId,workspaceId:w.id,expectedRevision:w.revision,operationId:`strategy-observe:${i.operationId}:${a.id}`},caller);}}
        catch{/* Uncertainty is retained. Reconciliation never calls start. */}
      }
      if(g.stopRequested||clock()>=g.deadlineAt)return stopOwned(g.id,g.projectId,caller,g.stopReason??'deadline');return synchronize(g.id,g.projectId);
    });},
    stop(i,caller){return operation('stop',i,caller,async i=>{const g=get(store.read(),i);revision(g,i.expectedRevision);return stopOwned(g.id,g.projectId,caller,'owner');});},
    feedback(i,caller){return operation('feedback',i,caller,async i=>store.transaction(s=>{const g=get(s,i);revision(g,i.expectedRevision);const a=g.stages.find(a=>a.id===i.stageId),ref=a?.claimId&&resultRef(s,row(s,'claim',a.claimId,i.projectId));if(!ref||!terminal.has(ref.status))fail('STRATEGY_FEEDBACK','Feedback must reference an observed exact terminal attempt',409);const f=append(s,'feedback',{strategyId:g.id,stageId:a.id,result:ref,text:boundedText(i.text,'feedback',8000),actor:'local-owner'},i.projectId);changed(g);return f;}));},
    select(i,caller){return operation('select',i,caller,async i=>{
      const initial=get(store.read(),i);revision(initial,i.expectedRevision);
      const a=initial.stages.find(a=>a.id===i.stageId),c=a?.claimId&&row(store.read(),'claim',a.claimId,i.projectId),ref=c&&resultRef(store.read(),c);
      if(initial.mode!=='independent-candidates'||!ref||ref.status!=='completed'||ref.checkStatus!=='passed')fail('STRATEGY_SELECTION','Select an observed completed checked candidate',409);
      if(!dataDir)fail('STRATEGY_INTEGRATION_REQUIRED','Canonical Workspace storage is required for current evidence selection',409);
      const selectedWorkspace=rowWorkspace(store.read(),i.projectId,a.workspaceId),proof=await inspectWorkspace(selectedWorkspace,dataDir);
      if(proof.dirty||proof.head!==ref.head||proof.sourceHead!==selectedWorkspace.sourceHeadSha)fail('STRATEGY_EVIDENCE','Candidate files or source base changed since their retained check',409);
      return store.transaction(s=>{
      owner(i,caller);const g=get(s,i);revision(g,i.expectedRevision);if(g.mode!=='independent-candidates'||g.stopRequested||g.restoreReviewRequired||g.selection)fail('STRATEGY_SELECTION','This strategy cannot accept a new selection',409);
      for(const stage of g.stages){const task=find(s,'tasks',stage.taskId,g.projectId),plan=find(s,'plans',task.planId,g.projectId);if(!plan.approved||taskSignature(task)!==stage.taskSignature||planSignature(plan)!==stage.planSignature||digest(rolePin(s,g.projectId,stage.conversationId,stage.botId))!==digest(stage.role)||digest(find(s,'projects',g.projectId).profile)!==stage.profileDigest)fail('STRATEGY_CHANGED','Approved allocations changed before selection',409);}
      const v=view(s,g);if(v.stages.some(a=>!a.result||!terminal.has(a.result.status)))fail('STRATEGY_SELECTION','Reconcile every independent candidate first',409);
      const a=v.stages.find(a=>a.id===i.stageId);if(a?.result?.status!=='completed'||a.result.checkStatus!=='passed'||digest(a.result)!==digest(ref)||a.result.head!==proof.head)fail('STRATEGY_EVIDENCE','Selected candidate needs its actual current completed attempt and passing Workspace check',409);
      if(!Array.isArray(i.rubricEvidence)||i.rubricEvidence.length!==g.rubric.length)fail('STRATEGY_EVIDENCE','Explain every fixed rubric item against retained evidence',409);
      const evidence=i.rubricEvidence.map((r,n)=>{exact(r,['criterion','checkId','note']);if(r.criterion!==g.rubric[n]||r.checkId!==a.result.checkId)fail('STRATEGY_EVIDENCE','Rubric evidence must reference the selected exact check',409);return {...r,note:boundedText(r.note,'rubric evidence',2000)};});
      const selection=append(s,'selection',{strategyId:g.id,stageId:a.id,result:a.result,allCandidates:v.join,rubric:g.rubric,rubricEvidence:evidence,reason:boundedText(i.reason,'selection reason',4000),actor:'local-owner',automaticMerge:false},i.projectId);g.selection=selection.id;g.status='selected';changed(g);return selection;
    });});},
    async recover(){for(const timer of timers.values())clearTimeout(timer);timers.clear();return store.transaction(s=>{for(const g of rows(s,'strategy')){if(g.stages.some(a=>a.claimId&&!terminal.has(a.status))){g.restoreReviewRequired=true;g.status='unknown';changed(g);}}for(const c of rows(s,'claim'))if(!terminal.has(c.status)){c.status='unknown';c.restoreReviewRequired=true;changed(c);}for(const o of rows(s,'operation'))if(o.status==='pending'){o.status='unknown';changed(o);}return {recovered:true,redispatched:false};});},
    async beforeRestore(){restoring=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();await Promise.allSettled([...pending]);return {drained:true,redispatched:false};},
    async afterRestore(){if(closed)fail('SHUTTING_DOWN','Closed strategy service cannot reopen',409);await api.recover();restoring=false;return {reopened:true,redispatched:false};},
    async close(){closed=true;for(const timer of timers.values())clearTimeout(timer);timers.clear();await Promise.allSettled([...pending]);},
  };
  for(const k of STRATEGY_METHODS.filter(k=>k!=='state')){const fn=api[k];api[k]=(...args)=>{const p=fn(...args);pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;};}return Object.freeze(api);
}
