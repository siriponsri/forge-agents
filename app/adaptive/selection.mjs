import { find, fail, digest, snapshotSkill, strings, integer } from './records.mjs';

export const taskSignature = task => digest({title:task.title, description:task.description, botId:task.botId, planId:task.planId, phaseId:task.phaseId, dependsOn:task.dependsOn});
export const routeSignature = project => digest(project.profile?.provider ?? {});

export async function discover(t3) {
  if (!t3?.catalog) return {providers:[], error:'T3 catalog unavailable'};
  try {
    const result = await t3.catalog();
    const catalog = result.structuredContent ?? result;
    return {providers:Array.isArray(catalog.providers) ? catalog.providers : [], observedAt:new Date().toISOString()};
  } catch (e) {return {providers:[], error:e.message};}
}

export function selectFromState(s, input, inventory, t3, connectionService) {
  const project = find(s, 'projects', input.projectId), task = find(s, 'tasks', input.taskId, project.id);
  const constraints = input.constraints ?? {};
  if (Object.keys(constraints).some(k => !['requiredCapabilities','skillIds','maxSkills','providerInstanceId','model','candidateId'].includes(k))) fail('VALIDATION', 'Unsupported task constraint');
  const requiredCapabilities = strings(constraints.requiredCapabilities, 'required capabilities');
  const requested = strings(constraints.skillIds, 'skill IDs', 8), maxSkills = integer(constraints.maxSkills ?? 3, 'maxSkills', 1, 8);
  if (requested.length > maxSkills) fail('LIMIT', 'Selected skill count exceeds maxSkills');
  const available = [];
  if (t3?.startRun && inventory.providers.length) available.push('t3.run');
  if (t3?.reconcile && inventory.providers.length) available.push('t3.reconcile');
  if (t3?.stop && inventory.providers.length) available.push('t3.stop');
  const connections = connectionService?.call ? s.connections.filter(c => c.projectId === project.id && c.enabled === true && c.kind === 'mcp' && c.lastCheck?.status === 'ready' && Date.now() - Date.parse(c.lastCheck.checkedAt) < 15*60*1000) : [];
  for (const c of connections) for (const tool of c.lastCheck.capabilities ?? []) if (tool.name) available.push(`mcp:${c.id}:${tool.name}`);
  const capabilities = [...new Set(available)].sort();
  const rejections = [], provider = project.profile?.provider ?? {};
  const instance = inventory.providers.find(p => p.providerInstanceId === provider.instanceId);
  const model = instance?.models?.find(m => m.id === provider.model);
  if (!provider.instanceId || !provider.model || !instance || !model || instance.canRunChildTask === false) rejections.push({kind:'harness', reason:'Configured provider/model is not available in the actual T3 catalog'});
  if ((constraints.providerInstanceId && constraints.providerInstanceId !== provider.instanceId) || (constraints.model && constraints.model !== provider.model)) rejections.push({kind:'harness', reason:'Requested route differs from explicitly configured project route; update Settings and reselect'});
  const options = Array.isArray(provider.options) ? provider.options : Object.entries(provider.options ?? {}).map(([id,value]) => ({id,value}));
  if (options.length > 24 || options.some(o => !model?.options?.some(m => m.id === o.id && m.values?.includes(o.value))) || new Set(options.map(o => o.id)).size !== options.length) rejections.push({kind:'harness', reason:'Configured model options are not advertised by this route'});
  if (instance?.runtimeModes && !instance.runtimeModes.includes('approval-required')) rejections.push({kind:'harness', reason:'Configured route lacks the required human approval mode'});
  for (const cap of requiredCapabilities) if (!capabilities.includes(cap)) rejections.push({kind:'capability', capability:cap, reason:'Required capability unavailable'});
  const words = new Set(`${task.title} ${task.description ?? ''}`.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(w => w.length >= 3));
  const pool = s.skills.filter(x => x.projectId === project.id && x.status === 'active');
  if (constraints.candidateId) {
    const candidate = find(s, 'skills', constraints.candidateId, project.id);
    if (candidate.status !== 'candidate' || !candidate.provenance?.parentId) fail('VALIDATION', 'Choose an inactive improvement candidate');
    pool.unshift(candidate);
  }
  for (const id of requested) if (!pool.some(x => x.id === id)) rejections.push({kind:'skill', id, reason:'Requested skill is not active in this project'});
  const scored = [];
  for (const skill of pool) {
    const explicit = requested.includes(skill.id) || skill.id === constraints.candidateId;
    const relevant = explicit || skill.name?.toLowerCase().split(/[^\p{L}\p{N}]+/u).some(w => words.has(w));
    if (!relevant) continue;
    const missing = (skill.requires ?? []).filter(c => !capabilities.includes(c));
    if (!skill.version || typeof skill.instructions !== 'string' || !skill.instructions.trim() || skill.instructions.length > 32000 || missing.length) {
      rejections.push({kind:'skill', id:skill.id, required:explicit, reason:missing.length ? 'Skill prerequisites unavailable' : 'Versioned bounded instructions required', missing}); continue;
    }
    // No fabricated success score: explicit choices, then deterministic name relevance.
    scored.push({skill, rank:skill.id === constraints.candidateId ? 2 : explicit ? 1 : 0});
  }
  scored.sort((a,b) => b.rank - a.rank || a.skill.id.localeCompare(b.skill.id));
  const skills = scored.slice(0,maxSkills).map(x => snapshotSkill(x.skill));
  if (constraints.candidateId && !skills.some(x => x.id === constraints.candidateId)) rejections.push({kind:'skill', id:constraints.candidateId, required:true, reason:'Candidate unavailable'});
  const blocked = rejections.some(r => r.kind !== 'skill' || requested.includes(r.id) || r.required);
  return {taskId:task.id, botId:task.botId ?? null, taskSignature:taskSignature(task), profileRevision:project.revision, routeSignature:routeSignature(project), constraints:structuredClone(constraints),
    status:blocked ? 'needs_setup' : 'selected', skills, availableCapabilities:capabilities, rejections,
    harness:!blocked ? {kind:'t3', providerInstanceId:provider.instanceId, model:provider.model, options, runtimeMode:'approval-required', routeSignature:routeSignature(project)} : null,
    inventory:{observedAt:inventory.observedAt ?? null, error:inventory.error ?? null, connectionRevisions:connections.map(c => ({id:c.id, revision:c.revision}))},
    qualifications:{liveProvider:'NOT_RUN', capabilityExecution:'NOT_RUN', modelQuality:'NOT_RUN', homeUat:'NOT_RUN'},
    method:'configured T3 route, observed capabilities and explicit/name relevance filtering; not learned optimization'};
}

export function validateDecision(s, decision, projectId) {
  if (decision.status !== 'selected' || !decision.harness) fail('NEEDS_SETUP', 'Selection requires setup before execution', 409);
  if (!decision.inventory?.observedAt || Date.now() - Date.parse(decision.inventory.observedAt) >= 15*60*1000) fail('STALE_DECISION', 'T3 catalog observation expired; select again', 409);
  const task = find(s, 'tasks', decision.taskId, projectId), project = find(s, 'projects', projectId);
  if (decision.taskSignature !== taskSignature(task) || decision.routeSignature !== routeSignature(project)) fail('STALE_DECISION', 'Task or configured route changed; select again', 409);
  for (const skill of decision.skills) {
    const current = find(s, 'skills', skill.id, projectId);
    if (!['active','candidate'].includes(current.status) || snapshotSkill(current).sha256 !== skill.sha256 || current.version !== skill.version || current.revision !== skill.revision) fail('STALE_DECISION', 'Selected skill changed; select again', 409);
  }
  for (const saved of decision.inventory.connectionRevisions) {
    const c = find(s, 'connections', saved.id, projectId);
    if (c.revision !== saved.revision || !c.enabled || c.lastCheck?.status !== 'ready' || Date.now() - Date.parse(c.lastCheck.checkedAt) >= 15*60*1000) fail('STALE_DECISION', 'Capability observation changed or expired; discover and select again', 409);
  }
  return {task, project};
}
