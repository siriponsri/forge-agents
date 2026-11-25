import {randomUUID} from 'node:crypto';
import {normalizeConfig,digest,fail} from './contracts.mjs';
import {createResearchAdapterRegistry} from './adapters.mjs';
const CONFIG_FIELDS=['version','name','adapter','split','repetitions','seed','policies','ablations','limits','fault','execution'];
export function readPinnedResearchConfig(payload,registry=createResearchAdapterRegistry()){
  const experiment=payload?.data?.experiment;
  if(!experiment)return {config:payload,expectedConfigDigest:null};
  if(payload.sha256!==digest(payload.data)||experiment.configDigest!==digest(experiment.config))fail('RESEARCH_INTEGRITY','Export/config digest mismatch');
  const config=Object.fromEntries(CONFIG_FIELDS.map(k=>[k,structuredClone(experiment.config[k])]));
  if(digest(normalizeConfig(config,registry))!==experiment.configDigest)fail('RESEARCH_ADAPTER_PIN','Pinned export requires its exact adapter implementation and dataset');
  return {config,expectedConfigDigest:experiment.configDigest};
}
// Headless caller uses the SAME authenticated service, not a competing runtime.
export async function runResearchExperiment({service,caller,projectId,config,expectedConfigDigest=null,onProgress=()=>{}}){
  if(config.execution!=='local')throw Object.assign(new Error('Headless automatic qualification is limited to local fixtures'),{code:'RESEARCH_OWNER_INTEGRATION'});
  const experiment=await service.create({projectId,operationId:randomUUID(),config},caller);
  if(expectedConfigDigest&&experiment.configDigest!==expectedConfigDigest)fail('RESEARCH_ADAPTER_PIN','The admitted configuration differs from the requested pin');
  for(let repetition=0;repetition<config.repetitions;repetition++)for(let policyIndex=0;policyIndex<config.policies.length;policyIndex++)for(let ablationIndex=0;ablationIndex<config.ablations.length;ablationIndex++){
    let trial=await service.reserve({projectId,operationId:randomUUID(),experimentId:experiment.id,repetition,policyIndex,ablationIndex},caller);
    trial=await service.execute({projectId,operationId:randomUUID(),trialId:trial.id,expectedRevision:trial.revision},caller);
    if(trial.status==='interrupted')trial=await service.reconcile({projectId,operationId:randomUUID(),trialId:trial.id,expectedRevision:trial.revision},caller);
    await onProgress({trialId:trial.id,status:trial.status});
  }
  return service.export({projectId,experimentId:experiment.id},caller);
}
