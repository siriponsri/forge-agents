import {entity,find,fail,changed,revision,digest as canonicalDigest,boundedText,integer} from '../adaptive/records.mjs';
import {taskSignature,planSignature} from '../goals/contracts.mjs';
import {createProviderCatalog} from '../providers/catalog.mjs';
export {entity,find,fail,changed,revision,boundedText,integer,taskSignature,planSignature};
export const digest=value=>canonicalDigest(value??null);
export const MODES=Object.freeze(['supervisor','fan-out-fan-in','router-specialists','generator-verifier','dag','independent-candidates']);
export const terminal=new Set(['completed','failed','cancelled','interrupted','rolled_back','stopped']);
export const rows=(s,kind,p)=>s.events.filter(e=>e.type===`strategy.${kind}`&&(!p||e.projectId===p));
export function row(s,kind,id,p){const r=find(s,'events',id,p);if(r.type!==`strategy.${kind}`)fail('STRATEGY_SCOPE','Strategy record does not match',409);return r;}
export function append(s,kind,data,p){const r=entity({type:`strategy.${kind}`,...data},p);s.events.push(r);return r;}
export function exact(v,keys){if(!v||typeof v!=='object'||Array.isArray(v)||Object.keys(v).some(k=>!keys.includes(k)))fail('STRATEGY_INPUT','Unexpected strategy input fields');}
export function rolePin(s,p,conversationId,botId){
  const c=find(s,'conversations',conversationId,p),b=find(s,'bots',botId,p);
  const a=s.events.filter(e=>e.type==='session-role.assignment'&&e.projectId===p&&e.conversationId===c.id&&e.botId===b.id).at(-1);
  if(b.status==='retired'||c.kind==='private'&&c.botId!==b.id||!a)fail('STRATEGY_ROLE_REQUIRED','Assign an existing scoped session role first',409);
  return {assignmentId:a.id,projectId:p,conversationId:c.id,botId:b.id,role:a.role,roleRevision:a.roleRevision};
}
export function routeDecision(s,p,required,role,now){
  const project=find(s,'projects',p),selection=project.profile?.provider;
  if(!selection?.connectionId)fail('STRATEGY_NEEDS_SETUP','Select an authenticated catalog-backed project route first',409);
  const catalogs=createProviderCatalog({store:{read:()=>s},clock:()=>now});
  const c=find(s,'connections',selection.connectionId,p),view=catalogs.state({projectId:p,connectionId:c.id});
  if(view.stale||c.lastCheck?.status!=='ready'||c.lastCheck?.authentication!=='authenticated')fail('STRATEGY_NEEDS_SETUP','Check authentication and refresh this exact provider catalog',409);
  const selected=catalogs.validate({projectId:p,connectionId:c.id,selection});
  if(view.catalog.canRunChildTask!==true||!view.catalog.runtimeModes?.includes('approval-required'))fail('STRATEGY_NEEDS_SETUP','Selected route lacks bounded child execution',409);
  const available=['t3.run','t3.reconcile','t3.stop'];
  for(const m of s.connections.filter(c=>c.projectId===p&&c.enabled===true&&c.kind==='mcp'&&c.lastCheck?.status==='ready'&&now-Date.parse(c.lastCheck.checkedAt)<900000))for(const tool of m.lastCheck.capabilities??[])if(tool.name)available.push(`mcp:${m.id}:${tool.name}`);
  if(required.some(c=>!available.includes(c)))fail('STRATEGY_NEEDS_SETUP','Required scoped capability is unavailable',409);
  return {role,selection:selected,requiredCapabilities:required,availableCapabilities:available,catalogDigest:digest(view.catalog),connectionRevision:c.revision,reason:'Owner-selected scoped specialist; exact authenticated route, catalog options and required capabilities checked. No model-quality ranking inferred.'};
}
export function allocation(s,p,a){
  exact(a,['id','workspaceId','conversationId','dependsOn','purpose']);boundedText(a.id,'stage id',100);
  const w=rowWorkspace(s,p,a.workspaceId),task=find(s,'tasks',w.taskId,p),plan=find(s,'plans',task.planId,p);
  if(w.status!=='ready'||w.runOperationId||w.stopRequested||w.restoreReviewRequired||!plan.approved)fail('STRATEGY_ALLOCATION','Select unused ready Workspaces for approved tasks',409);
  const role=rolePin(s,p,a.conversationId,task.botId);
  if(!Array.isArray(a.dependsOn)||a.dependsOn.length>24||new Set(a.dependsOn).size!==a.dependsOn.length)fail('STRATEGY_DEPENDENCY','Use distinct exact stage dependencies');
  if(!['work','generator','verifier','candidate','specialist'].includes(a.purpose))fail('STRATEGY_INPUT','Choose a stage purpose');
  return {id:a.id,workspaceId:w.id,taskId:task.id,conversationId:a.conversationId,botId:task.botId,role,dependsOn:[...a.dependsOn],purpose:a.purpose,taskSignature:taskSignature(task),planSignature:planSignature(plan),workspaceDigest:digest({id:w.id,baseSha:w.baseSha,sourceHeadSha:w.sourceHeadSha,taskRevision:w.taskRevision,planRevision:w.planRevision,worktreePath:w.worktreePath}),profileDigest:digest(find(s,'projects',p).profile),status:'ready',claimId:null};
}
export function rowWorkspace(s,p,id){const w=find(s,'events',id,p);if(w.type!=='workspace.workspace')fail('STRATEGY_ALLOCATION','Expected a canonical isolated Workspace',409);return w;}
export function validateGraph(stages){
  const byId=new Map(stages.map(a=>[a.id,a]));if(byId.size!==stages.length)fail('STRATEGY_DEPENDENCY','Stage IDs must be unique');
  const visiting=new Set(),done=new Set();function visit(id){if(visiting.has(id))fail('STRATEGY_CYCLE','Strategy graph contains a cycle',409);if(done.has(id))return;const a=byId.get(id);if(!a)fail('STRATEGY_DEPENDENCY','Dependency must name an exact selected stage',409);visiting.add(id);for(const d of a.dependsOn)visit(d);visiting.delete(id);done.add(id);}for(const a of stages)visit(a.id);
}
export function runFor(s,claim){
  const rs=s.runs.filter(r=>r.operationId===claim.context.operationId);if(rs.length>1)fail('STRATEGY_RUN_SCOPE','Ambiguous strategy run',409);const r=rs[0];if(!r)return null;
  const c=claim.context;
  if(r.projectId!==c.projectId||r.taskId!==c.taskId||(r.botId??null)!==c.role.botId||!r.attemptId||digest(r.strategyContext)!==digest(c)||c.workspaceId&&r.workspaceContext?.workspaceId!==c.workspaceId||!c.workspaceId&&r.conversationId!==c.role.conversationId||claim.runId&&claim.runId!==r.id||claim.attemptId&&claim.attemptId!==r.attemptId)fail('STRATEGY_RUN_SCOPE','Canonical attempt does not match the allocation',409);
  return r;
}
export function resultRef(s,claim){
  const r=runFor(s,claim);if(!r)return null;const w=claim.context.workspaceId?rowWorkspace(s,r.projectId,claim.context.workspaceId):null;
  const check=w?.checkId?s.events.find(e=>e.id===w.checkId&&e.type==='workspace.check'&&e.workspaceId===w.id&&e.runId===r.id&&e.attemptId===r.attemptId&&e.baseSha===w.baseSha&&e.head===w.checkedHead):null;
  return {claimId:claim.id,runId:r.id,attemptId:r.attemptId,status:r.status,workspaceId:w?.id??null,branch:w?.branch??null,worktreePath:w?.worktreePath??null,baseSha:w?.baseSha??null,head:check?.head??w?.observedHead??null,checkId:check?.id??null,checkStatus:check?.status??null,evidenceDigest:check?.evidenceDigest??null,artifactIds:s.artifacts.filter(a=>a.runId===r.id&&a.attemptId===r.attemptId&&a.projectId===r.projectId).map(a=>a.id),reportedCost:r.reportedCost??null};
}
