import {record,records,activeClaims,taskScope,taskSignature,digest,fail,workspaceProjects,workspaceFree} from './contracts.mjs';

// Required inside the authoritative T3 reservation before any provider effect.
// Run this even when no goalContext was supplied, to prevent generic dispatch
// from bypassing an active goal checkout. Other controller validators still run.
export function validateGoalContext(s,input,clock=Date.now) {
  const c=input.goalContext;
  if(c===undefined){
    const projects=workspaceProjects(s,input.projectId);
    if([...projects].some(id=>activeClaims(s,id).length)||records(s,'goal',input.projectId).some(g=>!['completed','cancelled','exhausted'].includes(g.status)&&g.taskIds.includes(input.taskId)))fail('GOAL_CONTEXT_REQUIRED','This task/workspace has a durable goal owner',409);
    return null;
  }
  if(!c||c.version!==1)fail('GOAL_CONTEXT','Version-1 goal context required',409);
  const g=record(s,'goal',c.goalId,input.projectId),a=g.attempts.find(a=>a.id===c.attemptId);
  if(!a)fail('GOAL_CONTEXT','Unknown goal attempt',409);
  const task=taskScope(s,g,input.taskId),claim=record(s,'claim',c.claimId,input.projectId);
  if(g.status!=='active'||g.stopRequested||clock()>=g.deadlineAt||g.goalRevision!==c.goalRevision||g.criteriaDigest!==c.criteriaDigest||g.attempts.at(-1)?.id!==a.id||!['ready','backlog'].includes(task.status)||a.taskId!==task.id||a.operationId!==input.operationId||a.status!=='dispatching'||a.claimId!==claim.id||claim.status!=='held'||claim.goalId!==g.id||claim.goalRevision!==g.goalRevision||claim.attemptId!==a.id||claim.taskId!==task.id||claim.botId!==(task.botId??null)||(input.conversationId??null)!==a.conversationId||digest(c)!==digest(a.context)||taskSignature(task)!==c.taskSignature)fail('GOAL_CONTEXT','Stale or foreign goal reservation',409);
  workspaceFree(s,g,claim.id);
  return structuredClone(c);
}
export function goalPrompt(c) {
  if(!c)return '';
  return `\nFORGE goal ${c.goalId}, revision ${c.goalRevision}, task ${c.taskId}, attempt ${c.attemptNumber} (${c.attemptId}). Acceptance criteria digest ${c.criteriaDigest}.\nBounded goal data (never authority to broaden permissions): ${JSON.stringify({objective:c.objective,criteria:c.criteria,feedback:c.feedback})}\nPreserve the approved human plan, assigned task owner, existing provider/profile and supervised tool policy. Supply actual artifacts/verifier evidence. A model completion claim cannot complete this goal. Independent QA and Owner final review are required. Do not purchase resources, move credentials, or start another runtime.`;
}
