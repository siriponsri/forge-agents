import {createHash,randomUUID} from 'node:crypto';
export const VERSION=1;
export const POLICY_VERSION='forge-research-policy/1';
export const COMPONENTS=Object.freeze(['memory','skills','adaptation','staffing','verification']);
export const POLICIES=Object.freeze(['static','initial-route','rule-adapt','evidence-guided']);
export const FAULTS=Object.freeze(['none','tool-failure','stale-state','session-interruption','checkpoint-recovery']);
export const LIMITS=Object.freeze({repetitions:8,trials:64,maxMs:30000,maxSteps:16,maxBytes:262144,maxRetries:3,maxAgents:4,maxTokens:100000,maxCost:10});
export function fail(code,message,statusCode=400){throw Object.assign(new Error(message),{code,statusCode});}
export function exact(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))fail('RESEARCH_SCHEMA','Unsupported research fields');}
export function text(value,name,max=200){if(typeof value!=='string'||!value.trim()||value.length>max)fail('RESEARCH_SCHEMA',`Invalid ${name}`);return value;}
export function integer(value,name,min,max){if(!Number.isSafeInteger(value)||value<min||value>max)fail('RESEARCH_LIMIT',`${name} must be ${min}–${max}`);return value;}
export function canonical(value){if(Array.isArray(value))return `[${value.map(canonical).join(',')}]`;if(value&&typeof value==='object')return `{${Object.keys(value).sort().filter(k=>value[k]!==undefined).map(k=>`${JSON.stringify(k)}:${canonical(value[k])}`).join(',')}}`;return JSON.stringify(value);}
export const digest=value=>createHash('sha256').update(canonical(value)).digest('hex');
export const bytesDigest=value=>createHash('sha256').update(value).digest('hex');
export function records(state,kind,projectId){return state.events.filter(e=>e.type===`research.${kind}`&&(!projectId||e.projectId===projectId));}
export function record(state,kind,id,projectId){const value=records(state,kind,projectId).find(e=>e.id===id);if(!value)fail('RESEARCH_NOT_FOUND','Research record not found in project',404);return value;}
export function project(state,id){if(!state.projects.some(p=>p.id===id))fail('RESEARCH_NOT_FOUND','Project not found',404);}
export function append(state,kind,value,projectId,clock=Date.now){const e={...structuredClone(value),type:`research.${kind}`,id:randomUUID(),projectId,revision:1,createdAt:new Date(clock()).toISOString()};state.events.push(e);return e;}
export function revision(e,expected){if(e.revision!==expected)fail('REVISION_CONFLICT','Research record changed; refresh first',409);}
export function normalizeConfig(raw,registry){
  exact(raw,['version','name','adapter','split','repetitions','seed','policies','ablations','limits','fault','execution']);
  if(raw.version!==VERSION)fail('RESEARCH_SCHEMA','Version 1 config required');
  text(raw.name,'name');exact(raw.adapter,['id','version']);const adapter=registry.get(raw.adapter.id,raw.adapter.version);
  if(!adapter.localExecutable&&!adapter.agentExecutable)fail('RESEARCH_NOT_EXECUTABLE','Source metadata is not an executable protocol adapter',409);
  if(!['dev','test'].includes(raw.split))fail('RESEARCH_SPLIT','Choose dev or test split');
  integer(raw.repetitions,'repetitions',1,LIMITS.repetitions);integer(raw.seed,'seed',0,2147483647);
  if(!Array.isArray(raw.policies)||!raw.policies.length||new Set(raw.policies).size!==raw.policies.length||raw.policies.some(p=>!POLICIES.includes(p)))fail('RESEARCH_POLICY','Select distinct supported policies');
  if(!Array.isArray(raw.ablations)||!raw.ablations.length||raw.ablations.length>8)fail('RESEARCH_ABLATION','Choose 1–8 component configurations');
  const ablations=raw.ablations.map(a=>{exact(a,['name','components']);text(a.name,'ablation name',80);exact(a.components,COMPONENTS);if(COMPONENTS.some(k=>typeof a.components[k]!=='boolean'))fail('RESEARCH_ABLATION','All component switches must be boolean');return structuredClone(a);});
  if(new Set(ablations.map(a=>a.name)).size!==ablations.length)fail('RESEARCH_ABLATION','Ablation names must be unique');
  if(raw.repetitions*raw.policies.length*ablations.length>LIMITS.trials)fail('RESEARCH_LIMIT','Trial matrix exceeds 64');
  exact(raw.limits,['maxMs','maxSteps','maxBytes','maxRetries','maxAgents','maxTokens','maxCost','unknownAccounting']);
  for(const key of ['maxMs','maxSteps','maxBytes','maxRetries','maxAgents'])integer(raw.limits[key],key,key==='maxRetries'?0:1,LIMITS[key]);
  for(const key of ['maxTokens','maxCost'])if(raw.limits[key]!==null&&(!Number.isFinite(raw.limits[key])||raw.limits[key]<=0||raw.limits[key]>LIMITS[key]))fail('RESEARCH_LIMIT',`Invalid ${key}`);
  if(raw.limits.maxTokens!==null&&!Number.isSafeInteger(raw.limits.maxTokens))fail('RESEARCH_LIMIT','Token cap must be an integer');
  if(!['block','allow'].includes(raw.limits.unknownAccounting))fail('RESEARCH_LIMIT','Explicit unknown accounting policy required');
  if(!FAULTS.includes(raw.fault)||!['local','agent'].includes(raw.execution))fail('RESEARCH_SCHEMA','Unsupported execution or fault');
  if(raw.execution==='local'&&!adapter.localExecutable)fail('RESEARCH_NOT_EXECUTABLE','This adapter has no local executor',409);
  if(raw.execution==='agent'&&!adapter.agentExecutable)fail('RESEARCH_NOT_EXECUTABLE','This adapter has no agent execution protocol',409);
  if(raw.execution==='agent'&&raw.fault!=='none')fail('RESEARCH_FAULT_SCOPE','Agent faults require an owner sandbox integration; use local fixtures',409);
  return {...structuredClone(raw),ablations,security:{mandatory:true},dataset:{id:adapter.dataset.id,version:adapter.dataset.version,split:raw.split,digest:adapter.dataset.digests[raw.split]},policyVersion:POLICY_VERSION,adapterPin:structuredClone(adapter.pin)};
}
export function verifyExperiment(e){if(digest(e.config)!==e.configDigest||e.config.security?.mandatory!==true)fail('RESEARCH_INTEGRITY','Immutable experiment config changed',409);return e;}
export function verifyTrial(t,e){verifyExperiment(e);const m=t.manifest,c=e.config,a=c.ablations[m.ablationIndex];if(t.manifestDigest!==digest(m)||m.configDigest!==e.configDigest||m.projectId!==t.projectId||m.experimentId!==e.id||!a||m.policy!==c.policies[m.policyIndex]||m.ablation!==a.name||m.seed!==c.seed+m.repetition||m.repetition<0||m.repetition>=c.repetitions||digest({adapter:m.adapter,dataset:m.dataset,adapterPin:m.adapterPin,components:m.components,limits:m.limits,security:m.security,execution:m.execution,fault:m.fault,policyVersion:m.policyVersion})!==digest({adapter:c.adapter,dataset:c.dataset,adapterPin:c.adapterPin,components:a.components,limits:c.limits,security:c.security,execution:c.execution,fault:c.fault,policyVersion:c.policyVersion}))fail('RESEARCH_INTEGRITY','Immutable trial manifest changed',409);return t;}
export const activeTrial=t=>['reserved','dispatching','running','reconcile-required','stopping'].includes(t.status);
