import {find,fail,digest,integer,keys,provenance,text,taskSignature,profileSignature,records,record} from './records.mjs';

export const CATALOG_TTL_MS=300000;
export const latestPolicy=(s,p)=>records(s,'policy',p).at(-1);
export const planSignature=p=>digest(p?{id:p.id,name:p.name,description:p.description}:null);
export const routeKey=r=>JSON.stringify([r.connectionId,r.model]);
// Only policy ordinals are compared. No model-name parsing, guessed prices,
// parameter counts, measured-quality claims or confidence percentages.
export function validatePolicy(policy){
  keys(policy,['classifications','qualityWeight','costWeight','unknownCost','provenance'],'policy');
  const result={qualityWeight:integer(policy.qualityWeight,'qualityWeight',1,100),costWeight:integer(policy.costWeight,'costWeight',1,100),unknownCost:policy.unknownCost,provenance:provenance(policy.provenance)};
  if(!['ask-owner','allow-ranked-last'].includes(result.unknownCost))fail('VALIDATION','Choose how unknown ordinal costs are handled');
  if(!Array.isArray(policy.classifications)||policy.classifications.length>1000)fail('VALIDATION','Use up to 1000 explicit classifications');
  result.classifications=policy.classifications.map(c=>{
    keys(c,['connectionId','model','roles','sizeRank','qualityRank','costRank','monetaryCost','options','provenance'],'classification');
    if(!Array.isArray(c.roles)||new Set(c.roles).size!==c.roles.length||c.roles.some(r=>!['executor','asst'].includes(r)))fail('ROLE_CONFLICT','Use distinct Executor/Asst roles; empty roles explicitly excludes the model',409);
    const monetary=c.monetaryCost??null;
    if(monetary!==null){keys(monetary,['amount','currency','unit','provenance'],'monetary cost');if(typeof monetary.amount!=='number'||!Number.isFinite(monetary.amount)||monetary.amount<0)fail('VALIDATION','Invalid reported monetary cost');text(monetary.currency,'currency',20);text(monetary.unit,'cost unit',100);provenance(monetary.provenance);}
    const options=c.options??[];
    if(!Array.isArray(options)||options.length>32||new Set(options.map(o=>o.id)).size!==options.length)fail('MODEL_OPTIONS','Use distinct options');
    for(const o of options){keys(o,['id','value'],'option');text(o.id,'option ID',200);if(!['string','boolean'].includes(typeof o.value))fail('MODEL_OPTIONS','Use advertised option values');}
    return {connectionId:text(c.connectionId,'connectionId',200),model:text(c.model,'model',256),roles:[...c.roles],sizeRank:integer(c.sizeRank,'sizeRank',0,100),qualityRank:integer(c.qualityRank,'qualityRank',0,100),costRank:c.costRank==null?null:integer(c.costRank,'costRank',0,100),monetaryCost:structuredClone(monetary),options:structuredClone(options),provenance:provenance(c.provenance)};
  });
  if(new Set(result.classifications.map(routeKey)).size!==result.classifications.length)fail('ROLE_CONFLICT','Conflicting classifications for the same route/model',409);
  return result;
}

export const connectionSignature=c=>digest({id:c.id,enabled:c.enabled,providerInstanceId:c.providerInstanceId,config:c.config,catalog:c.providerCatalog,lastCheck:c.lastCheck,catalogError:c.catalogError});
export function validateConstraints(c={}){
  keys(c,['minExecutorQuality','minAsstQuality','maxCostRank','requiredCapabilities','difficulty'],'constraints');
  const caps=c.requiredCapabilities??[];
  if(!Array.isArray(caps)||caps.length>32||new Set(caps).size!==caps.length||caps.some(x=>typeof x!=='string'||!x||x.length>200))fail('VALIDATION','Invalid required capabilities');
  const difficulty=c.difficulty??null;
  if(difficulty!==null){keys(difficulty,['kind','reason','provenance'],'difficulty');if(difficulty.kind!=='difficult')fail('VALIDATION','Only explicit difficult-work evidence triggers assistance');text(difficulty.reason,'difficulty reason');provenance(difficulty.provenance);}
  return {minExecutorQuality:integer(c.minExecutorQuality??0,'minExecutorQuality',0,100),minAsstQuality:integer(c.minAsstQuality??0,'minAsstQuality',0,100),maxCostRank:c.maxCostRank==null?null:integer(c.maxCostRank,'maxCostRank',0,100),requiredCapabilities:[...caps],difficulty:structuredClone(difficulty)};
}

export function selectFromState(s,input,providers,t3,clock=Date.now){
  const project=find(s,'projects',input.projectId),task=find(s,'tasks',input.taskId,project.id),p=latestPolicy(s,project.id),constraints=validateConstraints(input.constraints);
  const base={taskId:task.id,botId:task.botId??null,taskSignature:taskSignature(task),profileSignature:profileSignature(project),constraints,policyId:p?.id??null,policy:p?.policy??null,observedAt:clock(),candidates:[],connections:[],issues:[],selection:null,method:'Explicit owner policy utility: qualityRank * qualityWeight - costRank * costWeight; unknown cost ranked last only with explicit permission. Ordinals are classifications, not measured quality or monetary estimates.',qualifications:{liveProvider:'NOT_RUN',qualityImprovement:'NOT_ESTABLISHED',homeUat:'NOT_RUN'}};
  base.planSignature=planSignature(task.planId?find(s,'plans',task.planId,project.id):null);
  if(!p)return {...base,status:'ask_owner',issues:[{code:'POLICY_REQUIRED',action:'Configure classified roles, quality and cost preferences with provenance.'}]};
  let setup=false,ask=false;
  const hooks=['startRun','reconcile','stop'];
  const connections=s.connections.filter(c=>c.projectId===project.id&&c.kind==='provider'&&c.enabled!==false);
  for(const c of connections){
    base.connections.push({id:c.id,signature:connectionSignature(c)});
    const catalog=c.providerCatalog;
    let ready=true,error;
    try{
      if(!providers?.catalog||!providers?.validateSelection)fail('PROVIDER_SERVICE_REQUIRED','Owned provider catalog validator is required',409);
      const observed=providers.catalog({projectId:project.id,connectionId:c.id});
      if(observed.stale||observed.error||!catalog||catalog.providerInstanceId!==c.providerInstanceId||clock()-catalog.observedAt>=CATALOG_TTL_MS||catalog.observedAt>clock())fail('CATALOG_STALE','Refresh the exact route catalog',409);
      if(catalog.omittedModels>0)fail('CATALOG_INCOMPLETE','Runtime omitted models; obtain a complete catalog before claiming selection across all connected models',409);
      const check=c.lastCheck;
      if(!check||check.providerInstanceId!==c.providerInstanceId||check.installed!==true||check.enabled!==true||check.authentication!=='authenticated'||check.status!=='ready'||!Number.isFinite(check.checkedAt)||clock()-check.checkedAt>=CATALOG_TTL_MS||check.checkedAt>clock())fail('AUTH_REQUIRED','Check this route installation/authentication again; catalog membership is insufficient',409);
      if(!catalog.runtimeModes?.includes('approval-required')||catalog.canRunChildTask!==true||hooks.some(h=>typeof t3?.[h]!=='function'))fail('CAPABILITY_REQUIRED','Observed supervised T3 execution/stop/reconcile capabilities required',409);
      const available=['t3.run','t3.reconcile','t3.stop','supervised'];
      if(constraints.requiredCapabilities.some(cap=>!available.includes(cap)))fail('CAPABILITY_REQUIRED','Required capability is not qualified by this assistance adapter',409);
    }catch(e){ready=false;error={code:e.code??'CATALOG_ERROR',action:e.message};setup=true;base.issues.push({connectionId:c.id,...error});}
    for(const model of catalog?.models??[]){
      const classification=p.policy.classifications.find(x=>x.connectionId===c.id&&x.model===model.id);
      const candidate={connectionId:c.id,instanceId:c.providerInstanceId,model:model.id,classification:classification??null,eligible:false,reason:null};base.candidates.push(candidate);
      if(!ready){candidate.reason=error.code;continue;}
      if(!classification){ask=true;candidate.reason='UNCLASSIFIED';base.issues.push({code:'UNCLASSIFIED',connectionId:c.id,model:model.id,action:'Classify or explicitly exclude this connected model.'});continue;}
      if(!classification.roles.length){candidate.reason='EXPLICITLY_EXCLUDED';continue;}
      try{
        const defaults=(model.options??[]).filter(o=>o.default!==undefined).map(o=>({id:o.id,value:o.default}));
        const options=[...defaults.filter(o=>!classification.options.some(x=>x.id===o.id)),...classification.options];
        candidate.selection=providers.validateSelection({projectId:project.id,connectionId:c.id,selection:{instanceId:c.providerInstanceId,model:model.id,options}});
      }catch(e){setup=true;candidate.reason=e.code??'MODEL_OPTIONS';base.issues.push({code:candidate.reason,connectionId:c.id,model:model.id,action:e.message});continue;}
      if(classification.costRank===null&&p.policy.unknownCost==='ask-owner'){ask=true;candidate.reason='COST_UNKNOWN';base.issues.push({code:'COST_UNKNOWN',connectionId:c.id,model:model.id,action:'Supply a sourced cost ordinal or explicitly permit ranking unknown costs last.'});continue;}
      if(constraints.maxCostRank!==null&&(classification.costRank===null||classification.costRank>constraints.maxCostRank)){candidate.reason='COST_LIMIT';continue;}
      candidate.eligible=true;
      candidate.utility=classification.costRank===null?null:classification.qualityRank*p.policy.qualityWeight-classification.costRank*p.policy.costWeight;
      candidate.reason='POLICY_CLASSIFICATION';
    }
  }
  const sort=(a,b)=>(a.utility===null)-(b.utility===null)||(b.utility??0)-(a.utility??0)||b.classification.qualityRank-a.classification.qualityRank||routeKey(a).localeCompare(routeKey(b));
  const executors=base.candidates.filter(c=>c.eligible&&c.classification.roles.includes('executor')&&c.classification.qualityRank>=constraints.minExecutorQuality).sort(sort);
  // Select the best feasible pair, allowing all connected providers. An Asst
  // must have a strictly greater configured size rank than its Executor.
  for(const executor of executors){
    const asst=base.candidates.filter(c=>c.eligible&&c.classification.roles.includes('asst')&&c.classification.qualityRank>=constraints.minAsstQuality&&c.classification.sizeRank>executor.classification.sizeRank&&routeKey(c)!==routeKey(executor)).sort(sort)[0];
    if(asst){base.selection={executor,asst};break;}
  }
  if(!base.selection){ask=true;base.issues.push({code:'ROLE_CONFLICT',action:'Configure a suitable Executor and a distinct larger Asst within the task constraints.'});}
  if(!connections.length){setup=true;base.issues.push({code:'CONNECTION_REQUIRED',action:'Connect and check a T3 provider route.'});}
  return {...base,status:setup?'needs_setup':ask?'ask_owner':'selected'};
}

export function validateDecision(s,decision,projectId,clock=Date.now){
  if(decision.status!=='selected'||!decision.selection)fail('SELECTION_REQUIRED','Resolve selection setup or owner choices before execution',409);
  const task=find(s,'tasks',decision.taskId,projectId),project=find(s,'projects',projectId);
  if(planSignature(task.planId?find(s,'plans',task.planId,projectId):null)!==decision.planSignature)fail('STALE_DECISION','Concrete plan changed; select and review again',409);
  if(taskSignature(task)!==decision.taskSignature||profileSignature(project)!==decision.profileSignature||latestPolicy(s,projectId)?.id!==decision.policyId||clock()-decision.observedAt>=CATALOG_TTL_MS||decision.observedAt>clock())fail('STALE_DECISION','Task, profile, policy or catalog observation changed; select and review again',409);
  const current=s.connections.filter(c=>c.projectId===projectId&&c.kind==='provider'&&c.enabled!==false);
  if(current.length!==decision.connections.length||decision.connections.some(saved=>!current.some(c=>c.id===saved.id&&connectionSignature(c)===saved.signature)))fail('STALE_DECISION','Connected provider inventory changed; select again',409);
  for(const c of current)if(clock()-c.providerCatalog.observedAt>=CATALOG_TTL_MS||clock()-c.lastCheck.checkedAt>=CATALOG_TTL_MS)fail('CATALOG_STALE','Refresh/check connected providers and select again',409);
  return {task,project};
}
