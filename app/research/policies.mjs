import {POLICY_VERSION,fail,integer} from './contracts.mjs';
// Policies emit requests to existing owners. They grant no tools or authority.
export function decideResearchPolicy({policy,components,limits,observation,step=0}){
  integer(step,'policy step',0,limits.maxSteps);if(step>=limits.maxSteps) return {version:POLICY_VERSION,action:'stop',reason:'step-limit'};
  const failed=observation?.kind==='tool-failure',stale=observation?.kind==='stale-state',recover=observation?.kind==='checkpoint-recovery';
  const canAdapt=components.adaptation&&['rule-adapt','evidence-guided'].includes(policy);
  let action='execute',reason='fixed-policy';
  if(step===0&&policy!=='static'){action='initial-route';reason='declared-task-capabilities';}
  if(canAdapt&&(failed||stale||recover)){action=failed?'retry':stale?'refresh':'resume';reason=policy==='evidence-guided'?'independent-observation':'explicit-rule';}
  return {version:POLICY_VERSION,action,reason,route:policy==='static'?'fixed':'capability-qualified',memoryRetrieval:components.memory,skillSelection:components.skills,requestedAgents:components.staffing?Math.min(limits.maxAgents,2):1,optionalVerification:components.verification,mandatorySecurity:true,finalIndependentValidation:true,learning:false};
}
export const FUTURE_POLICY_INTERFACES=Object.freeze({version:1,observation:['taskFeatures','authorizedUsage','independentOutcome','policyAction','controllerOverhead'],supervisedRouting:{status:'DATA_INTERFACE_ONLY',training:false},contextualBandit:{status:'DATA_INTERFACE_ONLY',training:false,propensity:null},reinforcementLearning:{enabled:false}});
export function assertOwnerUsage(usage,limits){
  for(const k of ['tokens','cost'])if(usage[k]!==null&&(!Number.isFinite(usage[k])||usage[k]<0))fail('RESEARCH_TELEMETRY','Invalid authorized usage');
  const unknown=usage.tokens===null||usage.cost===null;
  if(unknown&&limits.unknownAccounting==='block')fail('RESEARCH_ACCOUNTING_UNKNOWN','Unknown usage blocks further dispatch',409);
  if(limits.maxTokens!==null&&usage.tokens!==null&&usage.tokens>=limits.maxTokens||limits.maxCost!==null&&usage.cost!==null&&usage.cost>=limits.maxCost)fail('RESEARCH_BUDGET','Observed research limit reached',409);
}
