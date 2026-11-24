import {checkEvidence} from '../adaptive/evidence.mjs';
import {digest,find,ownedRun,fail,record} from './contracts.mjs';

export function observedUsage(s,g) {
  let tokenSubtotal=0,unknownTokens=false,unknownCost=false;const perCurrency={},refs=[];
  for(const a of g.attempts){
    if(a.status==='cancelled_before_dispatch')continue;
    const r=ownedRun(s,g,a),u=r?.reportedUsage,c=r?.reportedCost;
    if(u&&Number.isSafeInteger(u.totalTokens)&&u.totalTokens>=0&&typeof u.source==='string'&&u.source)tokenSubtotal+=u.totalTokens;else unknownTokens=true;
    if(c&&typeof c.amount==='number'&&Number.isFinite(c.amount)&&c.amount>=0&&typeof c.currency==='string'&&c.currency&&typeof c.source==='string'&&c.source){
      Object.defineProperty(perCurrency,c.currency,{value:(Object.hasOwn(perCurrency,c.currency)?perCurrency[c.currency]:0)+c.amount,enumerable:true,configurable:true});
      if(g.policy.reportedCost.currency&&c.currency!==g.policy.reportedCost.currency)unknownCost=true;
    }else unknownCost=true;
    if(r)refs.push({kind:'run',id:r.id,revision:r.revision,sha256:digest({reportedUsage:u??null,reportedCost:c??null})});
  }
  return {tokens:{total:unknownTokens?null:tokenSubtotal,knownSubtotal:tokenSubtotal,unknown:unknownTokens},reportedCost:{perCurrency,unknown:unknownCost},refs,source:'durable T3 run.reportedUsage and run.reportedCost only; no estimation or currency conversion'};
}
export function usageStop(g,usage) {
  const p=g.policy;
  if(p.tokens.maxTotal!==null&&usage.tokens.knownSubtotal>=p.tokens.maxTotal)return 'TOKEN_LIMIT';
  if(p.reportedCost.maxAmount!==null&&(usage.reportedCost.perCurrency[p.reportedCost.currency]??0)>=p.reportedCost.maxAmount)return 'REPORTED_SPENDING_LIMIT';
  if(p.tokens.unknown==='block'&&usage.tokens.unknown)return 'TOKENS_UNKNOWN';
  if(p.reportedCost.unknown==='block'&&usage.reportedCost.unknown)return 'SPENDING_UNKNOWN';
  return null;
}

// Select only records already linked to the exact attempt. The criterion fixes
// the expected hash/verifier version, so a caller cannot redefine success after
// observing output. checkEvidence then reads actual bytes or trusted receipts.
export async function inspectAttempt(s,g,a) {
  const r=ownedRun(s,g,a);if(!r)fail('RECONCILE_REQUIRED','No durable run observed',409);
  const criteria=g.criteria.filter(c=>c.taskId===a.taskId),outcomes=[];
  for(const c of criteria){
    if(r.status!=='completed'){outcomes.push({criterionId:c.id,status:'FAILED',reason:'RUN_FAILED',observedStatus:r.status,error:r.error??null});continue;}
    let check;
    if(c.kind==='artifactHash'){
      const artifacts=s.artifacts.filter(x=>x.projectId===g.projectId&&(x.runId===r.id||x.source?.runId===r.id||r.artifactIds?.includes(x.id)));
      const artifact=artifacts.find(x=>x.sha256===c.sha256);
      if(artifact)check={key:c.id,kind:c.kind,runId:r.id,artifactId:artifact.id,sha256:c.sha256};
      else {outcomes.push({criterionId:c.id,status:'FAILED',reason:'ARTIFACT_MISSING',observedHashes:artifacts.map(x=>x.sha256??null).sort()});continue;}
    }else{
      const receipt=s.events.find(x=>x.projectId===g.projectId&&x.type==='verification.result'&&x.runId===r.id&&x.verifier?.id===c.verifier.id&&x.verifier?.version===c.verifier.version&&x.status==='PASSED');
      if(receipt)check={key:c.id,kind:c.kind,runId:r.id,receiptId:receipt.id};
      else {outcomes.push({criterionId:c.id,status:'FAILED',reason:'VERIFIER_MISSING'});continue;}
    }
    const result=await checkEvidence(s,g.projectId,[check],{taskId:a.taskId});
    outcomes.push({criterionId:c.id,status:result.status,check,result});
  }
  const failed=outcomes.filter(o=>o.status!=='PASSED');
  const fingerprint=digest(failed.map(o=>({criterionId:o.criterionId,reason:o.reason??o.result.outcomes[0].reason,observedHashes:o.observedHashes,observedStatus:o.observedStatus,error:o.error})));
  return {status:failed.length?'FAILED':'PASSED',outcomes,fingerprint,runId:r.id,attemptId:a.id,goalRevision:g.goalRevision,criteriaDigest:g.criteriaDigest};
}
export async function recheckTask(s,g,taskId) {
  const id=g.verifications[taskId];if(!id)fail('EVIDENCE_REQUIRED','No passed task verification',409);
  const v=record(s,'verification',id,g.projectId),a=g.attempts.find(a=>a.id===v.attemptId);
  if(v.goalRevision!==g.goalRevision||v.criteriaDigest!==g.criteriaDigest||!a)fail('EVIDENCE_STALE','Verification belongs to an older goal revision',409);
  const current=await inspectAttempt(s,g,a);
  if(current.status!=='PASSED')fail('EVIDENCE_REGRESSION','Actual evidence no longer satisfies the criteria',409,current);
  return {verification:v,current,attempt:a,task:find(s,'tasks',taskId,g.projectId)};
}
