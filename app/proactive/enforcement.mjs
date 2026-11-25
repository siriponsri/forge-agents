import {record,checkEnvelope,digest,exact,fail} from './contracts.mjs';

// Private runtime qualification is evidence about the selected execution route,
// not Owner authorization and never a model/HTTP asserted supported boolean.
export function proactiveEnforcementRequest(s,input,clock=Date.now){
  if(input.proactiveContext===undefined)return null;
  const r=record(s,'recipe',input.proactiveContext.recipeId,input.projectId),v=checkEnvelope(s,r,clock);
  if(!v.definition.taskIds.includes(input.taskId))fail('TASK_SCOPE','Task is outside the accepted recipe',409);
  return {projectId:input.projectId,taskId:input.taskId,envelopeDigest:v.digest,identitySnapshot:v.definition.identity.snapshot,scope:structuredClone(v.definition.scope)};
}
export function validateProactiveEnforcement(s,input,proof,clock=Date.now){
  const expected=proactiveEnforcementRequest(s,input,clock);if(!expected)return null;
  const denied=()=>fail('NATIVE_ENFORCEMENT_UNQUALIFIED','Automatic execution requires qualified enforcement of every native and normalized action; a prompt or MCP-only guard is insufficient',409);
  if(!proof||typeof proof!=='object'||Array.isArray(proof)||typeof proof.then==='function')denied();
  exact(proof,['version','projectId','taskId','envelopeDigest','identitySnapshot','scopeDigest','mode','nativeActions','normalizedActions','evidenceId','expiresAt'],'enforcement evidence');
  if(proof.version!==1||proof.projectId!==expected.projectId||proof.taskId!==expected.taskId||proof.envelopeDigest!==expected.envelopeDigest||proof.identitySnapshot!==expected.identitySnapshot||proof.scopeDigest!==digest(expected.scope)||!['read-propose-only','mediated-actions'].includes(proof.mode)||!['blocked','guarded'].includes(proof.nativeActions)||proof.normalizedActions!=='guarded'||typeof proof.evidenceId!=='string'||!proof.evidenceId||proof.evidenceId.length>200||!Number.isSafeInteger(proof.expiresAt)||proof.expiresAt<=clock())denied();
  if(proof.mode==='read-propose-only'&&expected.scope.capabilities.some(c=>!['read','propose'].includes(c)))denied();
  const accepted=input.proactiveContext.enforcement;
  // A renewed expiry may extend route qualification, but cannot extend this
  // attempt's original grant/deadline. Every other evidence field must match.
  if(accepted&&(digest({...accepted,expiresAt:null})!==digest({...proof,expiresAt:null})||accepted.expiresAt<=clock()))denied();
  return structuredClone(proof);
}
