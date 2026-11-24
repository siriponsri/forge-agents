import {createHash} from 'node:crypto';
export {entity,find,fail,changed,revision,required} from '../server/domain.mjs';
import {entity,find,fail,required} from '../server/domain.mjs';

const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>[k,canonical(v[k])])):v;
export const digest=v=>createHash('sha256').update(JSON.stringify(canonical(v??null))).digest('hex');
export const taskSignature=t=>digest({title:t.title,description:t.description,botId:t.botId,planId:t.planId,phaseId:t.phaseId,dependsOn:t.dependsOn});
export const profileSignature=p=>digest({workspace:p.workspace,profile:p.profile});
export const records=(s,kind,projectId)=>s.events.filter(e=>e.type===`assistance.${kind}`&&e.projectId===projectId);
export function record(s,kind,id,projectId){const r=find(s,'events',id,projectId);if(r.type!==`assistance.${kind}`)fail('NOT_FOUND',`Assistance ${kind} not found`,404);return r;}
export function append(s,kind,data,projectId){const r=entity({...data,type:`assistance.${kind}`},projectId);s.events.push(r);return r;}
export function text(v,label,max=4000){const r=required(v,label);if(r.length>max)fail('LIMIT',`${label} exceeds ${max} characters`);return r;}
export function integer(v,label,min,max){if(!Number.isSafeInteger(v)||v<min||v>max)fail('LIMIT',`${label} must be ${min}..${max}`);return v;}
export function keys(v,allowed,label){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!allowed.includes(k)))fail('VALIDATION',`Invalid ${label}`);}
export function provenance(v){keys(v,['source','recordedBy','reason'],'provenance');return {source:text(v.source,'source',1000),recordedBy:text(v.recordedBy,'recordedBy',200),reason:text(v.reason,'reason',2000)};}
export function receipt(s,method,input){
  text(input.operationId,'operationId',200);
  const fingerprint=digest({method,input}),prior=s.receipts.find(r=>r.operationId===input.operationId);
  if(prior&&(prior.type!=='assistance.command'||prior.fingerprint!==fingerprint)||!prior&&(s.runs.some(r=>r.operationId===input.operationId)||s.events.some(r=>r.operationId===input.operationId)))fail('OPERATION_REUSE','Operation ID belongs to different work',409);
  return {fingerprint,prior};
}
export function saveReceipt(s,input,fingerprint,result){s.receipts.push({operationId:input.operationId,type:'assistance.command',projectId:input.projectId,fingerprint,result:structuredClone(result)});}
