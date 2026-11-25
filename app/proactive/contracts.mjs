import {entity,find,fail,changed,revision,digest,boundedText,integer,exact,taskSignature as canonicalTaskSignature,planSignature,graph,workspaceProjects,workspaceFree,terminal} from '../goals/contracts.mjs';
import {strings} from '../adaptive/records.mjs';
import {validateTrigger} from './schedule.mjs';
export {find,fail,changed,revision,digest,boundedText,integer,exact,taskSignature,workspaceProjects,terminal};
const taskSignature=task=>digest({canonical:canonicalTaskSignature(task),governance:task.governance??null});

export const records=(s,kind,projectId)=>s.events.filter(e=>e.type===`proactive.${kind}`&&e.projectId===projectId);
export function record(s,kind,id,projectId){const r=find(s,'events',id,projectId);if(r.type!==`proactive.${kind}`)fail('NOT_FOUND',`Proactive ${kind} not found`,404);return r;}
export function append(s,kind,data,projectId){const r=entity({type:`proactive.${kind}`,...data},projectId);s.events.push(r);return r;}
export const active=o=>o.held===true;
export const definitionKeys=['name','instructions','planId','taskIds','trigger','identity','scope','budget','expiresAt'];
const capabilities=new Set(['read','propose','workspace.write','external.write']);
export function identitySnapshot(s,projectId,ids){
  const p=find(s,'projects',projectId);
  // Include all enabled project connections, even when the user did not select
  // one: changed provider/MCP accounts must never inherit an old approval.
  const all=s.connections.filter(c=>c.projectId===projectId||!c.projectId).filter(c=>c.enabled!==false);
  for(const id of ids)if(find(s,'connections',id,projectId).enabled===false)fail('CONNECTION_DISABLED','Selected connection is disabled',409);
  return digest({workspace:p.workspace,profile:p.profile,connections:all.map(c=>({id:c.id,revision:c.revision,digest:digest(c)})).sort((a,b)=>a.id.localeCompare(b.id))});
}
export function definition(s,i,clock){
  const projectId=i.projectId,name=boundedText(i.name,'name',200),instructions=boundedText(i.instructions,'instructions',8000);
  const plan=find(s,'plans',i.planId,projectId),taskIds=strings(i.taskIds,'taskIds',32);
  if(!plan.approved||!taskIds.length||taskIds.length!==i.taskIds.length)fail('PLAN_REQUIRED','Select unique tasks in an existing approved plan',409);
  graph(s,projectId);
  const taskSignatures={},botSignatures={};
  for(const id of taskIds){
    const task=find(s,'tasks',id,projectId);if(task.planId!==plan.id)fail('TASK_SCOPE','Tasks must belong to the selected plan',409);
    taskSignatures[id]=taskSignature(task);
    if(task.botId){const b=find(s,'bots',task.botId,projectId);if(b.status==='retired'||b.kind==='helper'&&b.taskId!==task.id)fail('BOT_SCOPE','Selected bot is retired or assigned elsewhere',409);botSignatures[b.id]=digest(b);}
  }
  exact(i.identity,['connectionIds'],'identity');const connectionIds=strings(i.identity.connectionIds,'connectionIds',32);
  exact(i.scope,['paths','capabilities'],'scope');
  const paths=strings(i.scope.paths,'paths',32),caps=strings(i.scope.capabilities,'capabilities',4);
  if(!paths.length||paths.some(p=>p.startsWith('/')||p.includes('\\')||p.includes(':')||p.split('/').some(x=>x==='..'||x===''||x==='.')&&p!=='.')||!caps.length||caps.some(c=>!capabilities.has(c)))fail('SCOPE','Use relative workspace paths and supported action capabilities');
  exact(i.budget,['maxRuns','maxRunMs','maxTokens','maxCost','currency'],'budget');const b=i.budget;
  integer(b.maxRuns,'maxRuns',1,64);integer(b.maxRunMs,'maxRunMs',1000,3600000);
  if(b.maxTokens!==null)integer(b.maxTokens,'maxTokens',1,Number.MAX_SAFE_INTEGER);
  if(b.maxCost!==null&&(typeof b.maxCost!=='number'||!Number.isFinite(b.maxCost)||b.maxCost<=0||typeof b.currency!=='string'||!b.currency.trim()||b.currency.length>20))fail('BUDGET','Cost cap requires positive amount and exact reported currency');
  if(b.maxCost===null&&b.currency!==null)fail('BUDGET','Currency must be null without a monetary cap');
  integer(i.expiresAt,'expiresAt',clock()+1000,clock()+366*86400000);
  return {name,instructions,planId:plan.id,planSignature:planSignature(plan),taskIds,taskSignatures,botSignatures,trigger:validateTrigger(i.trigger),identity:{connectionIds,snapshot:identitySnapshot(s,projectId,connectionIds)},scope:{paths,capabilities:caps},budget:structuredClone(b),expiresAt:i.expiresAt};
}
export function currentVersion(s,r){return record(s,'version',r.versionId,r.projectId);}
export function checkEnvelope(s,r,clock){
  const v=currentVersion(s,r),d=v.definition;
  if(digest(d)!==v.digest)fail('VERSION_CHANGED','Immutable recipe version no longer matches its digest',409);
  if(r.status!=='enabled'||!r.grant||r.grant.versionId!==v.id||r.grant.digest!==v.digest)fail('GRANT_REQUIRED','Owner approval and enablement of this exact version are required',409);
  if(clock()>=d.expiresAt)fail('EXPIRED','Recipe approval expired',409);
  if(identitySnapshot(s,r.projectId,d.identity.connectionIds)!==d.identity.snapshot)fail('IDENTITY_CHANGED','Connection or execution identity changed; review a new version',409);
  const p=find(s,'plans',d.planId,r.projectId);if(!p.approved||planSignature(p)!==d.planSignature)fail('PLAN_CHANGED','Approved plan changed',409);
  for(const id of d.taskIds)if(taskSignature(find(s,'tasks',id,r.projectId))!==d.taskSignatures[id])fail('TASK_CHANGED','Canonical task changed',409);
  for(const [id,sig] of Object.entries(d.botSignatures))if(digest(find(s,'bots',id,r.projectId))!==sig)fail('BOT_CHANGED','Bot identity or capabilities changed',409);
  graph(s,r.projectId);return v;
}
export function available(s,projectId,except){
  workspaceFree(s,{projectId});const projects=workspaceProjects(s,projectId);
  if(s.events.some(e=>e.type==='proactive.occurrence'&&projects.has(e.projectId)&&active(e)&&e.id!==except))fail('PROACTIVE_BUSY','An active or unknown proactive attempt owns this workspace',409);
}
export function taskFor(s,r,v){
  const d=v.definition;
  for(const id of d.taskIds){
    const t=find(s,'tasks',id,r.projectId);
    // A task is consumed by its first possible submission, including older
    // recipe versions. An edit is never an implicit retry permission.
    if(records(s,'occurrence',r.projectId).some(o=>o.recipeId===r.id&&o.taskId===id&&o.dispatchedAt!==undefined))continue;
    if(!['backlog','ready'].includes(t.status))continue;
    if((t.dependsOn??[]).some(id=>find(s,'tasks',id,r.projectId).status!=='done'))continue;
    if(s.events.some(e=>e.type==='goal.goal'&&e.projectId===r.projectId&&!['completed','cancelled','exhausted'].includes(e.status)&&e.taskIds?.includes(id)))fail('GOAL_OWNS_TASK','Continue this task through its existing Goal controller',409);
    if(s.relay?.inbox?.some(x=>x.projectId===r.projectId&&x.taskId===t.id))fail('MOBILE_CHANNEL_APPROVAL_REQUIRED','New mobile work must use its originating-channel Owner approval',409);
    return t;
  }
  fail('NO_READY_TASK','No unconsumed canonical task is ready in this recipe',409);
}
export function ownedRun(s,o,{context=true}={}){
  const matches=s.runs.filter(r=>r.operationId===o.operationId);if(matches.length>1)fail('RUN_OWNERSHIP','Multiple runs claim one proactive operation',409);
  const r=matches[0];if(!r)return null;
  if(r.projectId!==o.projectId||r.taskId!==o.taskId||(r.botId??null)!==o.botId||(r.conversationId??null)!==null||context&&digest(r.proactiveContext??null)!==digest(o.context))fail('RUN_OWNERSHIP','Run does not retain the exact proactive claim',409);
  return r;
}
export function usage(s,recipeId,projectId){
  let reportedTokens=0,tokensUnknown=false,costUnknown=false;const reportedCost={},estimates=[],subscriptions=[];
  const occurrences=records(s,'occurrence',projectId).filter(o=>o.recipeId===recipeId&&o.dispatchedAt!==undefined);
  for(const o of occurrences){
    let r;try{r=ownedRun(s,o);}catch{ /* Foreign or mismatched observations remain unknown. */ }
    const u=r?.reportedUsage,c=r?.reportedCost;
    if(Number.isSafeInteger(u?.totalTokens)&&u.totalTokens>=0&&typeof u.source==='string'&&u.source&&(!u.basis||u.basis==='reported'))reportedTokens+=u.totalTokens;else tokensUnknown=true;
    if(typeof c?.amount==='number'&&Number.isFinite(c.amount)&&c.amount>=0&&typeof c.currency==='string'&&c.currency&&typeof c.source==='string'&&c.source&&(!c.basis||c.basis==='reported'))reportedCost[c.currency]=(Object.hasOwn(reportedCost,c.currency)?reportedCost[c.currency]:0)+c.amount;else costUnknown=true;
    if(r?.estimatedUsage||r?.estimatedCost)estimates.push({runId:r.id,usage:r.estimatedUsage??null,cost:r.estimatedCost??null});
    if(r?.subscriptionUsage||c?.basis==='subscription')subscriptions.push({runId:r.id,value:r.subscriptionUsage??c});
  }
  return {runs:occurrences.length,tokens:{reportedTotal:tokensUnknown?null:reportedTokens,knownSubtotal:reportedTokens,unknown:tokensUnknown},cost:{reportedByCurrency:reportedCost,unknown:costUnknown},estimates,subscriptions};
}
export function checkBudget(s,r,v){
  const u=usage(s,r.id,r.projectId),b=v.definition.budget;
  if(u.runs>=b.maxRuns)fail('RUN_LIMIT','Approved run budget is exhausted',409);
  if(b.maxTokens!==null&&(u.tokens.unknown||u.tokens.knownSubtotal>=b.maxTokens))fail(u.tokens.unknown?'TOKENS_UNKNOWN':'TOKEN_LIMIT','Reported tokens do not permit another run',409);
  if(b.maxCost!==null){
    if(u.cost.unknown||Object.keys(u.cost.reportedByCurrency).some(c=>c!==b.currency))fail('COST_UNKNOWN','Unknown or incompatible cost cannot satisfy the monetary cap',409);
    if((u.cost.reportedByCurrency[b.currency]??0)>=b.maxCost)fail('COST_LIMIT','Reported spending budget is exhausted',409);
  }
  return u;
}
