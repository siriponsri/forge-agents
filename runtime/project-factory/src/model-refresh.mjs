import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {canonicalJson, nowIso, parseFreshness, redact, sha256, sortedUnique} from './core.mjs';

export const REFRESH_OPERATIONS = ['refresh-provider','refresh-model-lineup','refresh-pricing','refresh-runtime-health','validate-freshness'];
export const SOURCE_CLASSES = ['OFFICIAL_MACHINE_READABLE','OFFICIAL_DOCUMENTATION','OFFICIAL_LOCAL_CLI','OFFICIAL_MODEL_CARD','EXISTING_RESEARCH_INPUT','LOCAL_RUNTIME_EVIDENCE'];
function observation({provider_id,fact_type,observed_at=nowIso(),source,source_class,status='OBSERVED',value='UNKNOWN',freshness_window='7d',error=null}={}) {
  const freshness=status==='UNKNOWN'||value==='UNKNOWN'?'UNKNOWN':parseFreshness(observed_at,freshness_window,new Date());
  return {schema_version:'1.0.0',observation_id:`OBS-${sha256(canonicalJson({provider_id,fact_type,observed_at,source,value})).slice(0,12)}`,provider_id,fact_type,observed_at,source,source_class,status,value,freshness_window,freshness,evidence_hash:sha256(canonicalJson({provider_id,fact_type,source,value,status})),error};
}
function readJson(filePath) { return JSON.parse(fs.readFileSync(filePath,'utf8').replace(/^\uFEFF/,'')); }
export function validateObservation(item) {
  if (!item?.provider_id||!item?.fact_type||!item?.observed_at||!item?.source||!SOURCE_CLASSES.includes(item.source_class)) throw new Error('MODEL_REFRESH_OBSERVATION_CONTRACT');
  if (!['OBSERVED','UNKNOWN','FAILED'].includes(item.status)) throw new Error('MODEL_REFRESH_STATUS');
  if (!['FRESH','STALE','UNKNOWN'].includes(item.freshness)) throw new Error('MODEL_REFRESH_FRESHNESS');
  return true;
}
export function refreshModelIntelligence({inputRoot,previousObservations=[],at=new Date()}={}) {
  const resolved=path.resolve(inputRoot); const modelRegistry=readJson(path.join(resolved,'MODEL_REGISTRY.json')); const providerRegistry=readJson(path.join(resolved,'PROVIDER_REGISTRY.json')); const generatedAt=at.toISOString(); const observations=[];
  for (const provider of providerRegistry.providers) observations.push(observation({provider_id:provider.provider,fact_type:'provider_lineup_source',observed_at:generatedAt,source:'inputs/Model_Intelligence/PROVIDER_REGISTRY.json',source_class:'EXISTING_RESEARCH_INPUT',value:{provider:provider.provider,freshness_window:provider.freshness_window},freshness_window:provider.freshness_window??'7d'}));
  const openCode=spawnSync('opencode',['--version'],{encoding:'utf8',windowsHide:true}); const openCodeVersion=(openCode.stdout||'').trim()||'UNKNOWN';
  observations.push(observation({provider_id:'opencode-go',fact_type:'runtime_health',observed_at:generatedAt,source:'opencode --version',source_class:'OFFICIAL_LOCAL_CLI',status:openCode.status===0?'OBSERVED':'FAILED',value:openCode.status===0?{available:true,version:openCodeVersion}:'UNKNOWN',freshness_window:'1d',error:openCode.status===0?null:(openCode.stderr||'OPENCODE_VERSION_FAILED').trim()}));
  const lineup=modelRegistry.models.flatMap(model=>model.provider_surfaces.filter(surface=>String(surface.provider).toLowerCase().includes('opencode')).map(surface=>surface.model_id));
  observations.push(observation({provider_id:'opencode-go',fact_type:'model_lineup',observed_at:generatedAt,source:'inputs/Model_Intelligence/MODEL_REGISTRY.json',source_class:'EXISTING_RESEARCH_INPUT',value:lineup.length?sortedUnique(lineup):'UNKNOWN',freshness_window:'7d'}));
  observations.push(observation({provider_id:'opencode-go',fact_type:'pricing',observed_at:generatedAt,source:'NO_SAFE_PRICING_SOURCE',source_class:'LOCAL_RUNTIME_EVIDENCE',status:'UNKNOWN',value:'UNKNOWN',freshness_window:'7d',error:'NO_PAID_OR_UNVERIFIED_PRICING_FETCH'}));
  const history=[...previousObservations,...observations].map(item=>redact(item)); for(const item of observations) validateObservation(item);
  return {schema_version:'1.0.0',refresh_id:`REFRESH-${sha256(canonicalJson({inputRoot:resolved,generatedAt})).slice(0,12)}`,generated_at:generatedAt,input_root:resolved,operations:REFRESH_OPERATIONS,source_precedence:['OFFICIAL_MACHINE_READABLE','OFFICIAL_DOCUMENTATION','OFFICIAL_LOCAL_CLI','OFFICIAL_MODEL_CARD','EXISTING_RESEARCH_INPUT'],observations,observation_history:history,freshness_summary:{FRESH:observations.filter(item=>item.freshness==='FRESH').length,STALE:observations.filter(item=>item.freshness==='STALE').length,UNKNOWN:observations.filter(item=>item.freshness==='UNKNOWN').length},preservation:{unknown_preserved:observations.some(item=>item.value==='UNKNOWN'),previous_history_preserved:previousObservations.every(previous=>history.some(item=>item.observation_id===previous.observation_id)),provider_reported_does_not_overwrite_local_outcome:true},failures:observations.filter(item=>item.status==='FAILED'||item.status==='UNKNOWN').map(item=>({fact_type:item.fact_type,error:item.error})),paid_model_call:false,provider_auth_modified:false};
}
export function mergeObservationHistory(previous=[],next=[]) { return [...previous,...next].map(item=>redact(item)); }
