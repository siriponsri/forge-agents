import {entity,find,fail,changed,revision} from '../server/domain.mjs';
import {digest} from '../memory/contracts.mjs';
import {exact,text} from '../missions/contracts.mjs';
export {entity,find,fail,changed,revision,digest,exact,text};
export const BRIEF_FIELDS=Object.freeze(['objective','inputsScope','acceptance','interfacesDependencies','risksDecisions']);
export const records=(s,kind,projectId)=>s.events.filter(e=>e.type===`playbook.${kind}`&&e.projectId===projectId);
export function record(s,kind,id,projectId){const r=find(s,'events',id,projectId);if(r.type!==`playbook.${kind}`)fail('NOT_FOUND',`Workflow ${kind} not found`,404);return r;}
export function append(s,kind,data,projectId){const r=entity({...data,type:`playbook.${kind}`},projectId);s.events.push(r);return r;}
export function brief(value){exact(value,BRIEF_FIELDS);return Object.fromEntries(BRIEF_FIELDS.map(k=>[k,text(value[k],k,4000)]));}
export function decisions(value){
  if(!Array.isArray(value)||value.length>12)fail('VALIDATION','Use at most 12 explicit decisions');
  const seen=new Set();return value.map(d=>{exact(d,['id','question','answer']);const id=text(d.id,'Decision id',100);if(seen.has(id))fail('VALIDATION','Duplicate decision');seen.add(id);return {id,question:text(d.question,'Decision question',2000),answer:text(d.answer,'Decision answer',2000,{empty:true})};});
}
export function findings(value,count){
  if(!Array.isArray(value)||!value.length||value.length>24)fail('VALIDATION','Use 1..24 evidence-linked findings');
  return value.map(f=>{exact(f,['label','text','evidenceIndexes']);if(!['observation','risk','blocker','question'].includes(f.label))fail('VALIDATION','Findings are observations, risks, blockers or questions');
    if(!Array.isArray(f.evidenceIndexes)||!f.evidenceIndexes.length||f.evidenceIndexes.length>12||new Set(f.evidenceIndexes).size!==f.evidenceIndexes.length||f.evidenceIndexes.some(i=>!Number.isSafeInteger(i)||i<0||i>=count))fail('EVIDENCE_SCOPE','Link each finding to selected evidence');
    return {label:f.label,text:text(f.text,'Finding',4000),evidenceIndexes:[...f.evidenceIndexes]};});
}
