import {fail} from './domain.mjs';
import {record,digest} from '../adaptive/records.mjs';
import {validateDecision} from '../adaptive/selection.mjs';

export function validateAdaptiveContext(state,input){
  const context=input.adaptiveContext;if(context===undefined)return null;
  if(!context||context.version!==1||typeof context.goal!=='string'||context.goal.length>4000||!(context.feedback===null||typeof context.feedback==='string'&&context.feedback.length<=4000))fail('ADAPTIVE_CONTEXT','Invalid version-1 adaptive context',409);
  const decision=record(state,'decision',context.decisionId,input.projectId),loop=record(state,'loop',context.loopId,input.projectId);
  const {task}=validateDecision(state,decision,input.projectId);
  const attempt=loop.attempts?.find(a=>a.operationId===input.operationId);
  if(task.id!==input.taskId||loop.taskId!==task.id||loop.decisionId!==decision.id||loop.stopRequested||loop.stage!=='execute'||!attempt||digest(attempt.context)!==digest(context))fail('ADAPTIVE_CONTEXT','Context does not match this approved task loop reservation',409);
  if(digest(context.skillSnapshots)!==digest(decision.skills)||digest(context.harness)!==digest(decision.harness)||context.taskSignature!==decision.taskSignature||context.goal!==task.title)fail('ADAPTIVE_CONTEXT','Selected skill or harness context changed',409);
  return structuredClone(context);
}

export function adaptivePrompt(context){
  if(!context)return '';
  return `\nSelected versioned instructions for this attempt:\n${context.skillSnapshots.map(s=>`[${s.name} ${s.version}; ${s.sha256}]\n${s.instructions}`).join('\n\n')}\nGoal: ${context.goal}${context.feedback?`\nHuman revision feedback: ${context.feedback}`:''}\nKeep the existing supervised tool policy and workspace boundary.`;
}
