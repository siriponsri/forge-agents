import {canonicalJson, sha256, assertReadiness, nowIso} from './core.mjs';

const SAFE_SANDBOX = new Set(['read-only','workspace-write']);

export function evaluateCandidate(candidate, constraints = {}) {
  const reasons = [];
  const status = candidate.runtime_status || candidate.status || 'UNKNOWN';
  if (constraints.allowed_routes && !constraints.allowed_routes.includes(candidate.id)) reasons.push('ROUTE_NOT_ALLOWED');
  if (constraints.allowed_harnesses && !constraints.allowed_harnesses.includes(candidate.harness_id || candidate.runtime_id)) reasons.push('HARNESS_NOT_ALLOWED');
  if (constraints.required_role && !(candidate.roles || []).includes(constraints.required_role)) reasons.push('ROLE_UNSUPPORTED');
  if (constraints.required_capabilities && !constraints.required_capabilities.every(c => (candidate.capabilities || []).includes(c))) reasons.push('CAPABILITY_MISSING');
  if (constraints.require_status && status !== constraints.require_status) reasons.push('RUNTIME_STATUS_UNSUITABLE');
  if (constraints.require_callable && !['CALLABLE','HEALTHY','RUNTIME_SURFACE'].includes(status)) reasons.push('NOT_CALLABLE');
  if (constraints.max_cost !== undefined && Number.isFinite(candidate.estimated_cost) && candidate.estimated_cost > constraints.max_cost) reasons.push('COST_LIMIT');
  if (constraints.max_latency_ms !== undefined && Number.isFinite(candidate.latency_ms) && candidate.latency_ms > constraints.max_latency_ms) reasons.push('LATENCY_LIMIT');
  if (constraints.no_external_side_effects && candidate.external_side_effects === true) reasons.push('EXTERNAL_SIDE_EFFECT');
  if (constraints.sandbox && (candidate.sandbox_policy !== constraints.sandbox)) reasons.push('SANDBOX_MISMATCH');
  if (constraints.safe_only && !SAFE_SANDBOX.has(candidate.sandbox_policy || 'read-only')) reasons.push('UNSAFE_SANDBOX');
  return {ok:reasons.length===0, reasons};
}

function score(candidate, observations = {}) {
  const o = observations[candidate.id] || {};
  const evidence = Number.isFinite(o.evidence_score) ? o.evidence_score : Number.isFinite(candidate.evidence_score) ? candidate.evidence_score : 0;
  const health = Number.isFinite(o.health_score) ? o.health_score : Number.isFinite(candidate.health_score) ? candidate.health_score : 0;
  const cost = Number.isFinite(candidate.estimated_cost) ? candidate.estimated_cost : 0;
  const latency = Number.isFinite(candidate.latency_ms) ? candidate.latency_ms : 0;
  return (evidence * 1000) + (health * 100) - cost - (latency / 100000);
}

export function resolveCapability({capability, role, candidates=[], constraints={}, observations={}, readiness='READY_WITH_ASSUMPTIONS', exploration=false} = {}) {
  if (!capability) throw new Error('RESOLVER_CONTRACT_VIOLATION: capability is required');
  if (readiness) assertReadiness(readiness);
  const requested = {...constraints, required_role:constraints.required_role || role, required_capabilities:[...(constraints.required_capabilities || []), capability]};
  const evaluated = candidates.map(candidate => ({candidate, ...evaluateCandidate(candidate, requested), score:score(candidate, observations)}));
  const eligible = evaluated.filter(item=>item.ok).sort((a,b)=>b.score-a.score || a.candidate.id.localeCompare(b.candidate.id));
  const selected = eligible[0]?.candidate || null;
  const recommendations = eligible.map(item=>({route_id:item.candidate.id, score:item.score, runtime_id:item.candidate.runtime_id, evidence_score:item.candidate.evidence_score ?? null}));
  const rejected = evaluated.filter(item=>!item.ok).map(item=>({route_id:item.candidate.id, reasons:item.reasons}));
  return {schema_version:'1.0.0', decision_id:sha256(canonicalJson({capability,role,requested, candidates:candidates.map(c=>c.id).sort(), observations})), created_at:nowIso(), capability, role:role || null, exploration:!!exploration, selected_route:selected?.id || null, recommendations, rejected, hard_constraints:requested, readiness, production_route_mutation:false};
}

export function loadRuntimeCandidates(runtimeSurface, routeDefinitions=[]) {
  const statuses = Object.fromEntries((runtimeSurface.surfaces || []).map(surface=>[surface.runtime_id,surface]));
  return routeDefinitions.map(route=>({...route, ...(statuses[route.runtime_id] ? {runtime_status:statuses[route.runtime_id].status, surface_capabilities:statuses[route.runtime_id].capabilities} : {})}));
}
