import { entity, find, fail, changed, revision, required } from '../server/domain.mjs';
import path from 'node:path';
import {realpathSync} from 'node:fs';
import { digest, boundedText, integer, strings } from '../adaptive/records.mjs';
export { entity, find, fail, changed, revision, required, digest, boundedText, integer };

export const terminal = new Set(['completed','failed','cancelled','interrupted','rolled_back']);
export const inactive = new Set(['completed','cancelled','exhausted']);
export const GOAL_LIMITS = Object.freeze({maxAttempts:64,maxAttemptsPerTask:8,maxMs:3600000,maxUnchangedFailures:8,maxTasks:64});
export const records = (s, kind, projectId) => s.events.filter(e => e.type === `goal.${kind}` && e.projectId === projectId);
export function record(s, kind, id, projectId) {
  const r=find(s,'events',id,projectId);
  if(r.type!==`goal.${kind}`)fail('NOT_FOUND',`Goal ${kind} not found`,404);
  return r;
}
export function append(s,kind,data,projectId){const r=entity({type:`goal.${kind}`,...data},projectId);s.events.push(r);return r;}
export function exact(value,keys,label='input') {
  if(!value || typeof value!=='object' || Array.isArray(value) || Object.keys(value).some(k=>!keys.includes(k)))fail('VALIDATION',`Unexpected ${label} fields`);
}
export const taskSignature = task => digest({id:task.id,title:task.title,description:task.description??'',planId:task.planId,phaseId:task.phaseId??null,botId:task.botId??null,dependsOn:task.dependsOn??[]});
export const planSignature = plan => digest({id:plan.id,name:plan.name,description:plan.description??'',approved:plan.approved,revision:plan.revision});

export function graph(s,projectId) {
  const visiting=new Set(),visited=new Set();
  function visit(id){
    if(visiting.has(id))fail('CYCLE','Canonical task graph contains a cycle',409);
    if(visited.has(id))return;
    const task=find(s,'tasks',id,projectId),deps=task.dependsOn??[];
    if(!Array.isArray(deps)||new Set(deps).size!==deps.length)fail('DEPENDENCY','Invalid or duplicate task dependencies',409);
    visiting.add(id);for(const dep of deps)visit(dep);visiting.delete(id);visited.add(id);
  }
  for(const task of s.tasks.filter(t=>t.projectId===projectId))visit(task.id);
}
export function definition(s,input) {
  const objective=boundedText(input.objective,'objective',4000),taskIds=strings(input.taskIds,'taskIds',GOAL_LIMITS.maxTasks);
  if(!taskIds.length)fail('VALIDATION','Select canonical tasks');
  const plan=find(s,'plans',input.planId,input.projectId);
  if(plan.approved!==true)fail('PLAN_REQUIRED','Approve the existing human plan first',409);
  graph(s,input.projectId);
  for(const id of taskIds){const task=find(s,'tasks',id,input.projectId);if(task.planId!==plan.id)fail('PLAN_SCOPE','Task belongs to a different plan',409);}
  if(!Array.isArray(input.criteria)||!input.criteria.length||input.criteria.length>24)fail('VALIDATION','Provide 1..24 measurable criteria');
  const seen=new Set();
  const criteria=input.criteria.map(c=>{
    exact(c,['id','taskId','description','kind','sha256','verifier']);
    const id=boundedText(c.id,'criterion id',120),description=boundedText(c.description,'criterion description',2000);
    if(seen.has(id)||!taskIds.includes(c.taskId))fail('CRITERIA_SCOPE','Criteria must uniquely identify a selected task');seen.add(id);
    if(c.kind==='artifactHash'){
      if(!/^[a-f0-9]{64}$/.test(c.sha256)||c.verifier!==undefined)fail('VALIDATION','Artifact criterion needs its fixed expected SHA-256');
      return {id,taskId:c.taskId,description,kind:c.kind,sha256:c.sha256};
    }
    if(c.kind==='verifierReceipt'){
      exact(c.verifier,['id','version'],'verifier');
      if(c.sha256!==undefined)fail('VALIDATION','Verifier criterion cannot use artifact hash');
      return {id,taskId:c.taskId,description,kind:c.kind,verifier:{id:boundedText(c.verifier.id,'verifier id',200),version:boundedText(c.verifier.version,'verifier version',100)}};
    }
    fail('UNSUPPORTED_CHECK','Criteria require actual artifact bytes or trusted versioned verifier receipts');
  });
  if(taskIds.some(id=>!criteria.some(c=>c.taskId===id)))fail('CRITERIA_REQUIRED','Each task needs a measurable criterion');
  const p=input.policy??{};
  exact(p,['mode','maxAttempts','maxAttemptsPerTask','maxMs','maxUnchangedFailures','tokens','reportedCost'],'policy');
  const mode=p.mode??'manual';if(!['manual','bounded-auto'].includes(mode))fail('VALIDATION','Invalid continuation mode');
  const tokens=p.tokens??{unknown:'block',maxTotal:null};exact(tokens,['unknown','maxTotal'],'tokens');
  const cost=p.reportedCost??{unknown:'block',maxAmount:null,currency:null};exact(cost,['unknown','maxAmount','currency'],'reportedCost');
  for(const item of [tokens,cost])if(!['block','allow'].includes(item.unknown))fail('VALIDATION','Choose block or allow unknown usage explicitly');
  if(tokens.maxTotal!==null)integer(tokens.maxTotal,'maxTotal',1,Number.MAX_SAFE_INTEGER);
  if(cost.currency!==null&&(typeof cost.currency!=='string'||!cost.currency.trim()||cost.currency.length>20))fail('VALIDATION','Invalid exact reported currency');
  if(cost.maxAmount!==null&&(typeof cost.maxAmount!=='number'||!Number.isFinite(cost.maxAmount)||cost.maxAmount<=0||typeof cost.currency!=='string'||!cost.currency.trim()||cost.currency.length>20))fail('VALIDATION','A cost cap requires a positive amount and exact reported currency');
  const policy={mode,maxAttempts:integer(p.maxAttempts??8,'maxAttempts',1,GOAL_LIMITS.maxAttempts),maxAttemptsPerTask:integer(p.maxAttemptsPerTask??3,'maxAttemptsPerTask',1,GOAL_LIMITS.maxAttemptsPerTask),maxMs:integer(p.maxMs??300000,'maxMs',1,GOAL_LIMITS.maxMs),maxUnchangedFailures:integer(p.maxUnchangedFailures??2,'maxUnchangedFailures',1,GOAL_LIMITS.maxUnchangedFailures),tokens:structuredClone(tokens),reportedCost:structuredClone(cost)};
  return {objective,planId:plan.id,planSignature:planSignature(plan),taskIds,criteria,criteriaDigest:digest(criteria),policy,taskSignatures:Object.fromEntries(taskIds.map(id=>[id,taskSignature(find(s,'tasks',id,input.projectId))]))};
}
export function validateDefinition(s,g) {
  graph(s,g.projectId);
  const plan=find(s,'plans',g.planId,g.projectId);
  if(plan.approved!==true||planSignature(plan)!==g.planSignature)fail('PLAN_CHANGED','Review a new goal revision against the current approved human plan',409);
  for(const id of g.taskIds)if(taskSignature(find(s,'tasks',id,g.projectId))!==g.taskSignatures[id])fail('TASK_CHANGED','Task definition or ownership changed; revise the goal explicitly',409);
}
export function taskScope(s,g,taskId) {
  validateDefinition(s,g);
  if(!g.taskIds.includes(taskId))fail('TASK_SCOPE','Task is outside this goal',409);
  const t=find(s,'tasks',taskId,g.projectId);
  if(t.botId){const b=find(s,'bots',t.botId,g.projectId);if(b.status==='retired'||b.kind==='helper'&&b.taskId!==t.id)fail('BOT_SCOPE','Task bot is retired or assigned elsewhere',409);}
  for(const id of t.dependsOn??[])if(find(s,'tasks',id,g.projectId).status!=='done')fail('DEPENDENCY','Task dependencies remain unfinished',409);
  return t;
}
export function activeClaims(s,projectId){return records(s,'claim',projectId).filter(c=>c.status==='held');}
export function workspaceProjects(s,projectId) {
  const canonical=p=>{try{return realpathSync(p);}catch{return path.resolve(p);}};
  const root=canonical(find(s,'projects',projectId).workspace).toLowerCase();
  const overlaps=(a,b)=>a===b||a.startsWith(b+path.sep)||b.startsWith(a+path.sep);
  return new Set(s.projects.filter(p=>p.workspace&&overlaps(root,canonical(p.workspace).toLowerCase())).map(p=>p.id));
}
export function workspaceFree(s,g,exceptClaimId) {
  // No execution adapter currently proves separate workspaces. Advisory task
  // scope and a goal checkout are never advertised as filesystem isolation.
  const projects=workspaceProjects(s,g.projectId);
  if(s.runs.some(r=>projects.has(r.projectId)&&!terminal.has(r.status))||s.events.some(c=>c.type==='goal.claim'&&projects.has(c.projectId)&&c.status==='held'&&c.id!==exceptClaimId))fail('WORKSPACE_BUSY','Active or unknown execution owns this workspace; reconcile it first',409);
  if(s.events.some(e=>['adaptive.loop','assistance.loop'].includes(e.type)&&projects.has(e.projectId)&&!['completed','stopped','exhausted'].includes(e.status)))fail('CONTROLLER_BUSY','An existing role/skill controller owns this workspace',409);
}

export function ownedRun(s,g,a,{context=true}={}) {
  const matches=s.runs.filter(r=>r.operationId===a.operationId);
  if(matches.length>1)fail('RUN_SCOPE','Multiple runs claim one goal operation',409);
  const r=matches[0];if(!r)return null;
  if(r.projectId!==g.projectId||r.taskId!==a.taskId||(r.botId??null)!==a.botId||(r.conversationId??null)!==a.conversationId)fail('RUN_SCOPE','Run does not match its exact persisted goal owner',409);
  if(context&&digest(r.goalContext??null)!==digest(a.context))fail('CONTEXT_MISMATCH','T3 did not retain exact goal context',409);
  return r;
}
